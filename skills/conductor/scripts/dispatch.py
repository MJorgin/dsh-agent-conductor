#!/usr/bin/env python3
"""向外部 agent CLI 派活并回收结果（DSH 指挥家技能）。

用法:
  python3 dispatch.py <agent> "<任务>"     派活给某个 agent CLI
  python3 dispatch.py --dry-run <agent> "<任务>"
                                          预览目标、工作目录和命令，不实际执行
  python3 dispatch.py doctor               自检：哪些 agent CLI 已安装/可用
  python3 dispatch.py list                 同 doctor

结果打印到 stdout，作为模型回答的依据；失败以非零退出码 + stderr 提示。

配置（可选，环境变量或 ~/.dsh/secrets/media-tools.env）:
  CONDUCTOR_CWD=/path/to/git/repo   派活的工作目录（Codex 要求在受信任的
                                    git 仓库里运行）；缺省用当前目录。
  CONDUCTOR_CODEX_MODEL=<model>     覆盖 Codex 默认模型。Codex 会读共享的
                                    ~/.codex/config.toml，若其中的模型当前账号
                                    不可用，用这个变量插入 `exec -m <model>`。

平台说明:
  * Windows：脚本按 PATHEXT 解析 npm 的 .CMD shim 后再启动；输出统一按
    UTF-8 解码（errors="replace"），不会因 GBK/ANSI 代码页丢结果。
  * 输出在内存里有界：只保留头部 + 滚动尾部 + 真实总长度（与 bundle 版一致，
    agent CLI 的最终答案通常在最后）；超时会终止整个进程树，不留孤儿进程。
"""
import os
import shlex
import shutil
import signal
import subprocess
import sys
import threading
from pathlib import Path

MAX_OUTPUT_CHARS = 20_000
HEAD_CHARS = int(MAX_OUTPUT_CHARS * 0.7)      # 14_000
TAIL_CHARS = int(MAX_OUTPUT_CHARS * 0.25)     # 5_000
STDERR_HEAD_CHARS = 4_000
STDERR_TAIL_CHARS = 2_000
ERROR_DETAIL_CHARS = 500
DISPATCH_TIMEOUT_SECONDS = 600
VERSION_PROBE_TIMEOUT_SECONDS = 6

AGENTS = {
    "codex":        {"name": "Codex",       "argv": ["codex", "exec", "{task}"],
                     "bin": "codex",
                     "install": "npm i -g @openai/codex（或软链已有 codex-cli：ln -s ~/.codex/plugins/.plugin-appserver/codex ~/.local/bin/codex）"},
    "claude-code":  {"name": "Claude Code", "argv": ["claude", "-p", "{task}", "--output-format", "text"],
                     "bin": "claude",
                     "install": "npm i -g @anthropic-ai/claude-code"},
    "trae":         {"name": "TraeCode",    "argv": ["traecli", "exec", "{task}"],
                     "bin": "traecli",
                     "install": "TraeCode CLI：https://docs.trae.cn/cli_command-line-parameters"},
    "opencode":     {"name": "OpenCode",    "argv": ["opencode", "run", "{task}"],
                     "bin": "opencode",
                     "install": "npm i -g opencode-ai"},
    "gemini":       {"name": "Gemini CLI",  "argv": ["gemini", "-p", "{task}"],
                     "bin": "gemini",
                     "install": "npm i -g @google/gemini-cli"},
    "cursor":       {"name": "Cursor CLI",  "argv": ["cursor-agent", "-p", "{task}"],
                     "bin": "cursor-agent",
                     "install": "cursor.com/install"},
    "kimi":         {"name": "Kimi CLI",    "argv": ["kimi", "--prompt", "{task}"],
                     "bin": "kimi",
                     "install": "npm i -g @moonshot-ai/kimi-code"},
    "qwen":         {"name": "Qwen Code",   "argv": ["qwen", "--prompt", "{task}"],
                     "bin": "qwen",
                     "install": "npm i -g @qwen-code/qwen-code"},
    "copilot":      {"name": "Copilot CLI", "argv": ["copilot", "-p", "{task}", "--allow-all-tools"],
                     "bin": "copilot",
                     "install": "npm i -g @github/copilot（无头模式自动带 --allow-all-tools 放行工具）"},
    "workbuddy":    {"name": "WorkBuddy",   "argv": ["workbuddy", "-p", "{task}"],
                     "bin": "workbuddy",
                     "install": "见官方教程"},
    "grok":         {"name": "Grok CLI",    "argv": ["grok", "-p", "{task}"],
                     "bin": "grok",
                     "install": "npm i -g @xai-official/grok（或 curl -fsSL https://x.ai/cli/install.sh | bash）"},
}


def load_conf(name):
    """Read one optional setting: environment first, then ~/.dsh/secrets/media-tools.env."""
    value = os.environ.get(name)
    if value:
        return value.strip()
    env_path = Path.home() / ".dsh/secrets/media-tools.env"
    try:
        lines = env_path.read_text(encoding="utf-8", errors="replace").splitlines()
    except OSError:
        return None
    for line in lines:
        if line.startswith(name + "="):
            return line.split("=", 1)[1].strip()
    return None


def resolve_binary(cfg):
    """Resolve the configured executable without invoking it (handles Windows .CMD via PATHEXT)."""
    for candidate in (cfg.get("bin"), cfg["argv"][0]):
        if not candidate:
            continue
        found = shutil.which(candidate)
        if found:
            return found
    return None


def build_argv(agent_id, cfg, task):
    """Template argv for one agent, with the optional Codex model override applied."""
    argv = [part.replace("{task}", task) for part in cfg["argv"]]
    if agent_id == "codex":
        model = load_conf("CONDUCTOR_CODEX_MODEL")
        if model:
            argv = argv[:2] + ["-m", model] + argv[2:]  # codex exec -m <model> <task>
    return argv


def resolved_argv(cfg, argv):
    """Launch the PATH-resolved executable so Windows .CMD shims work without a shell."""
    resolved = resolve_binary(cfg)
    if not resolved:
        return argv
    return [resolved, *argv[1:]]


def render_plan(agent_id, cfg, task, cwd):
    """Render a dispatch preview without contacting the agent provider."""
    argv = resolved_argv(cfg, build_argv(agent_id, cfg, task))
    resolved = resolve_binary(cfg)
    print("Conductor Dry-run · 调度预览（未执行）")
    print(f"  Target agent    : {cfg['name']} ({agent_id})")
    print(f"  Working dir     : {cwd}")
    print(f"  Executable      : {resolved or 'NOT FOUND'}")
    print(f"  Arguments       : {argv}")
    print(f"  Shell-equivalent: {shlex.join(argv)}")
    print(f"  Task length     : {len(task)} chars")
    print("  Safety          : argv is passed directly; no shell is used")
    if not resolved:
        print(f"  Install         : {cfg['install']}")
        return 1
    print("\n确认目标、工作目录和任务无误后，去掉 --dry-run 正式派活。")
    return 0


class _OutputBuffer:
    """Bounded output: the first `head_cap` chars, a rolling tail, and the true length."""

    def __init__(self, head_cap, tail_cap):
        self.head_cap = head_cap
        self.tail_cap = tail_cap
        self._head = []
        self._head_len = 0
        self.tail = ""
        self.total = 0

    def feed(self, text):
        if not text:
            return
        self.total += len(text)
        if self._head_len < self.head_cap:
            room = self.head_cap - self._head_len
            piece = text if len(text) <= room else text[:room]
            self._head.append(piece)
            self._head_len += len(piece)
        if self.tail_cap:
            self.tail = (self.tail + text)[-self.tail_cap:]

    def head(self):
        return "".join(self._head)


def clip(head, tail, total, cap=MAX_OUTPUT_CHARS):
    """Head + true tail of an over-long result, with an elision marker in between."""
    if total <= cap:
        return head.strip()
    head_text = head[: min(len(head), HEAD_CHARS)]
    tail_text = tail[-min(len(tail), TAIL_CHARS):]
    omitted = max(0, total - len(head_text) - len(tail_text))
    return f"{head_text}\n\n…[输出过长，已省略中间 {omitted} 字符]…\n{tail_text}".strip()


def format_stderr(buf):
    """Rebuild a bounded stderr transcript as head + optional elision marker + tail."""
    if buf.total == 0 or not buf.head():
        return ""
    head = buf.head()
    tail = buf.tail
    tail_start = buf.total - len(tail)
    if len(head) > tail_start:
        return head + tail[len(head) - tail_start:]
    omitted = max(0, buf.total - len(head) - len(tail))
    return f"{head}\n\n…[stderr 已省略 {omitted} 字符]…\n{tail}"


def error_detail(text, cap=ERROR_DETAIL_CHARS):
    """Keep the first and last part of a diagnostic so the real (trailing) error survives."""
    text = text.strip()
    if not text:
        return "(无输出)"
    if len(text) <= cap:
        return text
    half = cap // 2
    return f"{text[:half].rstrip()} … {text[-half:].lstrip()}"


def doctor():
    """Probe which agent CLIs are resolvable on PATH (best-effort version check)."""
    print("Conductor 自检：在 PATH 上探测各 agent CLI\n")
    available = 0
    for aid, cfg in AGENTS.items():
        binary = cfg.get("bin", cfg["argv"][0])
        path = resolve_binary(cfg)
        if path is None:
            print(f"  ❌ {cfg['name']:<13} ({aid}) 未找到 `{binary}`  →  安装：{cfg['install']}")
            continue
        available += 1
        ver = ""
        for flag in ("--version", "-v", "version"):
            try:
                probe = subprocess.run(
                    [path, flag],
                    capture_output=True,
                    encoding="utf-8",
                    errors="replace",
                    timeout=VERSION_PROBE_TIMEOUT_SECONDS,
                )
                lines = (probe.stdout or probe.stderr).strip().splitlines()
                ver = (lines[0] if lines else "").strip()[:60]
                if ver:
                    break
            except (OSError, subprocess.SubprocessError):
                continue
        print(f"  ✅ {cfg['name']:<13} ({aid}) {path}" + (f"  — {ver}" if ver else ""))
    print(f"\n可用 {available} / 不可用 {len(AGENTS) - available}")
    print("提示：列出 ✅ 的 CLI 才能派活；命令能找到但派活报错，多为未登录/未授权；Windows 上会按 PATHEXT 解析 .CMD shim。")


def _kill_tree(proc):
    """Terminate the CLI and every process it spawned (POSIX process group / taskkill)."""
    if os.name == "nt":
        try:
            subprocess.run(
                ["taskkill", "/F", "/T", "/PID", str(proc.pid)],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                timeout=10,
            )
        except (OSError, subprocess.SubprocessError):
            pass
    else:
        try:
            os.killpg(proc.pid, signal.SIGKILL)
        except (ProcessLookupError, PermissionError, OSError):
            pass
    try:
        proc.kill()
    except OSError:
        pass


def _pump(stream, buf):
    """Read one decoded stream into a bounded buffer until EOF."""
    try:
        while True:
            chunk = stream.read(65536)
            if not chunk:
                return
            buf.feed(chunk)
    except (OSError, ValueError):
        pass  # pipe torn down by _kill_tree / interpreter shutdown
    finally:
        try:
            stream.close()
        except OSError:
            pass


def run_agent(argv, cwd, timeout=DISPATCH_TIMEOUT_SECONDS):
    """Run one agent CLI with bounded output; return (code, out_buf, err_buf, timed_out).

    On timeout the whole process tree is terminated, so a hung CLI cannot
    outlive the call and leave orphaned grandchildren behind.
    """
    popen_kwargs = {}
    if os.name != "nt":
        popen_kwargs["start_new_session"] = True  # own process group → os.killpg works
    proc = subprocess.Popen(
        argv,
        stdin=subprocess.DEVNULL,  # never let a CLI block on the caller's stdin
        cwd=cwd,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        encoding="utf-8",
        errors="replace",  # ANSI/GBK bytes must not kill the reader thread
        **popen_kwargs,
    )
    out_buf = _OutputBuffer(MAX_OUTPUT_CHARS, TAIL_CHARS)
    err_buf = _OutputBuffer(STDERR_HEAD_CHARS, STDERR_TAIL_CHARS)
    readers = []
    for stream, buf in ((proc.stdout, out_buf), (proc.stderr, err_buf)):
        if stream is None:
            continue
        reader = threading.Thread(target=_pump, args=(stream, buf), daemon=True)
        reader.start()
        readers.append(reader)
    timed_out = False
    try:
        exit_code = proc.wait(timeout=timeout)
    except subprocess.TimeoutExpired:
        timed_out = True
        _kill_tree(proc)
        try:
            exit_code = proc.wait(timeout=10)
        except subprocess.TimeoutExpired:
            exit_code = -1
    for reader in readers:
        reader.join(timeout=5)
    if any(reader.is_alive() for reader in readers):
        # A daemonized grandchild inherited the pipes and is still writing; kill
        # the tree so it cannot outlive the call or append after we return.
        _kill_tree(proc)
        for reader in readers:
            reader.join(timeout=2)
    return exit_code, out_buf, err_buf, timed_out


def main():
    if len(sys.argv) < 2:
        sys.exit("用法: dispatch.py <agent> \"<任务>\"  |  doctor（自检已安装 CLI）\n"
                 "agent 可选: " + ", ".join(AGENTS))
    raw_args = sys.argv[1:]
    if raw_args[0] in ("doctor", "list", "--list", "-l"):
        doctor()
        return
    dry_run = raw_args[0] in ("plan", "--plan")
    if dry_run:
        raw_args = raw_args[1:]
    if raw_args and raw_args[0] in ("--dry-run", "--plan"):
        dry_run = True
        raw_args = raw_args[1:]
    if not raw_args:
        sys.exit("Dry-run 用法: dispatch.py --dry-run <agent> \"<任务>\"")
    agent_id, task = raw_args[0], " ".join(raw_args[1:])
    agent = AGENTS.get(agent_id)
    if not agent:
        sys.exit(f"未知 agent \"{agent_id}\"；可选: {', '.join(AGENTS)}（或运行 doctor 自检）")
    if not task.strip():
        sys.exit("任务不能为空")
    cwd = load_conf("CONDUCTOR_CWD") or os.getcwd()
    if dry_run:
        sys.exit(render_plan(agent_id, agent, task, cwd))
    argv = resolved_argv(agent, build_argv(agent_id, agent, task))
    try:
        code, out_buf, err_buf, timed_out = run_agent(argv, cwd)
    except FileNotFoundError:
        sys.exit(f"{agent['name']} 未安装（或不在 PATH）。安装：{agent['install']}（可先运行 dispatch.py doctor）")
    except OSError as error:
        sys.exit(f"{agent['name']} 启动失败：{error}。安装：{agent['install']}")
    if timed_out:
        sys.exit(f"{agent['name']} 超时（10 分钟），进程树已终止。")
    if code != 0:
        stderr_text = format_stderr(err_buf).strip()
        stdout_text = clip(out_buf.head(), out_buf.tail, out_buf.total)
        detail = error_detail(stderr_text or stdout_text)
        sys.exit(f"{agent['name']} 退出码 {code}：{detail}")
    print(clip(out_buf.head(), out_buf.tail, out_buf.total))


if __name__ == "__main__":
    main()

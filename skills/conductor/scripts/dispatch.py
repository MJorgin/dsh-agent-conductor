#!/usr/bin/env python3
"""向外部 agent CLI 派活并回收结果（DSH 指挥家技能）。

用法:
  python3 dispatch.py <agent> "<任务>"     派活给某个 agent CLI
  python3 dispatch.py doctor               自检：哪些 agent CLI 已安装/可用
  python3 dispatch.py list                 同 doctor

结果打印到 stdout，作为模型回答的依据；失败以非零退出码 + stderr 提示。

配置（可选）: CONDUCTOR_CWD 环境变量或 ~/.dsh/secrets/media-tools.env 里写
CONDUCTOR_CWD=/path/to/git/repo —— 派活的工作目录（Codex 要求在受信任的
git 仓库里运行）。不配置时默认当前目录（通常就是会话工作区）。
"""
import os, shutil, subprocess, sys
from pathlib import Path

MAX_OUTPUT_CHARS = 20_000

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
    v = os.environ.get(name)
    if v:
        return v.strip()
    env = Path.home() / ".dsh/secrets/media-tools.env"
    if env.exists():
        for line in env.read_text().splitlines():
            if line.startswith(name + "="):
                return line.split("=", 1)[1].strip()
    return None

def clip(text, cap=MAX_OUTPUT_CHARS):
    """Head + tail of an over-long result with an elision marker in between."""
    if len(text) <= cap:
        return text
    head = text[: int(cap * 0.7)]
    tail = text[-int(cap * 0.25):]
    return f"{head}\n\n…[输出过长，已省略中间 {len(text) - cap} 字符]…\n{tail}"

def doctor():
    """Probe which agent CLIs are resolvable on PATH (best-effort version check)."""
    print("Conductor 自检：在 PATH 上探测各 agent CLI\n")
    for aid, cfg in AGENTS.items():
        binary = cfg.get("bin", cfg["argv"][0])
        path = shutil.which(binary)
        if path is None:
            # fall back to the first argv token in case `bin` differs
            path = shutil.which(cfg["argv"][0])
        if path is None:
            print(f"  ❌ {cfg['name']:<13} ({aid}) 未找到 `{binary}`  →  安装：{cfg['install']}")
            continue
        ver = ""
        for flag in ("--version", "-v", "version"):
            try:
                r = subprocess.run([binary, flag], capture_output=True, text=True,
                                   timeout=6)
                line = (r.stdout or r.stderr).strip().splitlines()
                ver = (line[0] if line else "").strip()[:60]
                if ver:
                    break
            except Exception:
                continue
        print(f"  ✅ {cfg['name']:<13} ({aid}) {path}" + (f"  — {ver}" if ver else ""))
    print("\n提示：列出 ✅ 的 CLI 才能派活；命令能找到但派活报错，多为未登录/未授权。")

def main():
    if len(sys.argv) < 2:
        sys.exit("用法: dispatch.py <agent> \"<任务>\"  |  doctor（自检已安装 CLI）\n"
                 "agent 可选: " + ", ".join(AGENTS))
    if sys.argv[1] in ("doctor", "list", "--list", "-l"):
        doctor()
        return
    agent_id, task = sys.argv[1], " ".join(sys.argv[2:])
    agent = AGENTS.get(agent_id)
    if not agent:
        sys.exit(f"未知 agent \"{agent_id}\"；可选: {', '.join(AGENTS)}（或运行 doctor 自检）")
    if not task.strip():
        sys.exit("任务不能为空")
    cwd = load_conf("CONDUCTOR_CWD") or os.getcwd()
    argv = [a.replace("{task}", task) for a in agent["argv"]]
    try:
        proc = subprocess.run(argv, capture_output=True, text=True, cwd=cwd, timeout=600)
    except FileNotFoundError:
        sys.exit(f"{agent['name']} 未安装（或不在 PATH）。安装：{agent['install']}（可先运行 dispatch.py doctor）")
    except subprocess.TimeoutExpired:
        sys.exit(f"{agent['name']} 超时（10 分钟）")
    if proc.returncode != 0:
        detail = (proc.stderr or proc.stdout).strip()
        sys.exit(f"{agent['name']} 退出码 {proc.returncode}：{detail[:500] or '(无输出)'}")
    print(clip(proc.stdout.strip()))

if __name__ == "__main__":
    main()

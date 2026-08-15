#!/usr/bin/env python3
"""向外部 agent CLI 派活并回收结果（DSH 指挥家技能）。

用法: python3 dispatch.py <agent> "<任务>"
结果打印到 stdout，作为模型回答的依据；失败以非零退出码 + stderr 提示。

配置（可选）: CONDUCTOR_CWD 环境变量或 ~/.dsh/secrets/media-tools.env 里写
CONDUCTOR_CWD=/path/to/git/repo —— 派活的工作目录（Codex 要求在受信任的
git 仓库里运行）。
"""
import os, subprocess, sys
from pathlib import Path

AGENTS = {
    "codex":        {"name": "Codex",       "argv": ["codex", "exec", "{task}"],
                     "install": "codex CLI（已有 codex-cli 时：ln -s ~/.codex/plugins/.plugin-appserver/codex ~/.local/bin/codex）"},
    "claude-code":  {"name": "Claude Code", "argv": ["claude", "-p", "{task}", "--output-format", "text"],
                     "install": "npm i -g @anthropic-ai/claude-code"},
    "trae":         {"name": "TraeCode",    "argv": ["traecli", "exec", "{task}"],
                     "install": "TraeCode CLI：https://docs.trae.cn/cli_command-line-parameters"},
    "opencode":     {"name": "OpenCode",    "argv": ["opencode", "run", "{task}"],
                     "install": "npm i -g opencode-ai"},
    "gemini":       {"name": "Gemini CLI",  "argv": ["gemini", "-p", "{task}"],
                     "install": "npm i -g @google/gemini-cli"},
    "cursor":       {"name": "Cursor CLI",  "argv": ["cursor-agent", "-p", "{task}"],
                     "install": "cursor.com/install"},
    "kimi":         {"name": "Kimi CLI",    "argv": ["kimi", "--prompt", "{task}"],
                     "install": "npm i -g kimi-cli"},
    "qwen":         {"name": "Qwen Code",   "argv": ["qwen", "--prompt", "{task}"],
                     "install": "npm i -g @qwen-code/qwen-code"},
    "copilot":      {"name": "Copilot CLI", "argv": ["github-copilot", "--prompt", "{task}"],
                     "install": "npm i -g @github/copilot"},
    "workbuddy":    {"name": "WorkBuddy",   "argv": ["workbuddy", "-p", "{task}"],
                     "install": "见官方教程"},
    "grok":         {"name": "Grok CLI",    "argv": ["grok", "-p", "{task}"],
                     "install": "xAI 官方安装"},
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

def main():
    if len(sys.argv) < 3:
        sys.exit("用法: dispatch.py <agent> \"<任务>\"\nagent 可选: " + ", ".join(AGENTS))
    agent_id, task = sys.argv[1], " ".join(sys.argv[2:])
    agent = AGENTS.get(agent_id)
    if not agent:
        sys.exit(f"未知 agent \"{agent_id}\"；可选: {', '.join(AGENTS)}")
    if not task.strip():
        sys.exit("任务不能为空")
    cwd = load_conf("CONDUCTOR_CWD") or os.getcwd()
    argv = [a.replace("{task}", task) for a in agent["argv"]]
    try:
        proc = subprocess.run(argv, capture_output=True, text=True, cwd=cwd, timeout=600)
    except FileNotFoundError:
        sys.exit(f"{agent['name']} 未安装（或不在 PATH）。安装：{agent['install']}")
    except subprocess.TimeoutExpired:
        sys.exit(f"{agent['name']} 超时（10 分钟）")
    if proc.returncode != 0:
        detail = (proc.stderr or proc.stdout).strip()
        sys.exit(f"{agent['name']} 退出码 {proc.returncode}：{detail[:500] or '(无输出)'}")
    print(proc.stdout.strip())

if __name__ == "__main__":
    main()

---
name: conductor
description: "派活给外部 agent CLI（DSH 指挥家）。当用户想让另一家的编码代理——Codex、Claude Code、TraeCode、OpenCode、Gemini、Cursor、Kimi、Qwen、Copilot、WorkBuddy、Grok——独立完成研究、实现、分析、翻译等任务，或用户提到「派 Codex 干」「让 Claude Code 帮我」等需求时使用。执行消耗对应 CLI 的登录额度。"
---

# Conductor（指挥家 / 跨 agent 派活）

把自包含的任务派给其他 agent CLI 无头执行，结果回传本会话。

## 用法

```bash
python3 scripts/dispatch.py <agent> "<任务>"
```

- `agent` 可选：`codex` / `claude-code` / `trae` / `opencode` / `gemini` / `cursor` / `kimi` / `qwen` / `copilot` / `workbuddy` / `grok`
- 任务必须**自包含**：对方看不到本会话的任何上下文，背景、约束、期望产出全部写进任务文本。
- 结果直接打印到 stdout，作为回答依据；不要复述"我派了活"，直接给用户交付结论。
- 一次派一件；多件事按依赖顺序分多次派。

## 规则

- **沙箱权限**：脚本在 DSH 的 bash 工具沙箱里运行，多数 agent CLI 需要写自己的运行时目录（Codex 尤为明显）。第一次运行若报 `Operation not permitted` 或被沙箱拒绝，**用同一命令带 `sandbox_permissions: danger-full-access` 重试一次**（会弹出授权给用户确认）；不要反复用普通权限重试。
- **未安装**：脚本会报错并附安装命令——把安装命令转告用户，征得同意前不要替用户安装 CLI。
- **Codex 报「不信任目录」**：把 `CONDUCTOR_CWD=/path/to/git/repo` 写进 `~/.dsh/secrets/media-tools.env`（或环境变量），指向受信任的 git 仓库。
- **失败重试**：先读报错定位原因（未登录 / 未安装 / 网络 / 任务描述不清），修正任务文本后重派一次；同一失败不要连试三次以上。
- **配额透明**：派活消耗的是对方 CLI 的登录额度（如 Codex 订阅），派之前任务必须明确、值得跑，不派无意义的小事。

## 隐私

- 任务文本会发给对应 CLI 的服务商，敏感信息（密钥、内部数据）不要写进任务。
- 结果的版权/合规归属对应 CLI 的服务条款，交付时如实标注「由 <agent 名> 完成」。

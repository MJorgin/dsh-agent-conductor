# ⚡ dsh-agent-conductor · DSH 指挥家

**在 DeepSeek Harness 会话里直接派活给 11 种外部 agent CLI（Codex、Claude Code、TraeCode、OpenCode、Gemini、Cursor、Kimi、Qwen、Copilot、WorkBuddy、Grok），结果带回会话。**

> 灵感来自 [Multica](https://github.com/multica-ai/multica)（46k 星的多 agent 工作台）——把"agent 小队"概念搬进 DSH 会话。

## 实现路线：动态插件（热更新）

本项目采用 **DSH 动态插件** 路线：通过会话内的 `cordis_define` / `cordis_run` 加载，**不写 profile、不重启 dsh、改代码秒级热更新**，且天然与宿主隔离（不会影响 Web UI 稳定性）。

> 早期尝试过 profile-bundle 路线，因其客户端半边在某些 DSH 版本上会影响 Web UI，已移除（历史见 git log）。

## 安装（在任意 DSH 会话里）

把 [`conductor-dynamic.js`](conductor-dynamic.js) 的函数体作为 `code.host` 交给 `cordis_define`，然后 `cordis_run`。**最省事的做法**：直接对本会话的 agent 说：

> 「按 https://github.com/akqwpeter-prog/dsh-agent-conductor 的 conductor-dynamic.js 定义并运行动态插件 conductor-hot，然后派一单给 codex 试试」

agent 会完成定义、运行和验证。之后正常聊天即可：

- 「用 conductor_dispatch 派 codex 查一下 XX 项目的提交规范」
- 「派 Claude Code 把这份 README 翻译成繁体中文」

## 特性

| 能力 | 说明 |
|---|---|
| 🧭 11 种 CLI 小队 | Codex / Claude Code / TraeCode / OpenCode / Gemini CLI / Cursor CLI / Kimi CLI / Qwen Code / Copilot CLI / WorkBuddy / Grok CLI |
| 💬 聊天即派活 | `conductor_dispatch` 工具：agent（模型）在对话里直接指挥外部 CLI |
| 🔍 友好报错 | CLI 未安装 → 报错附安装命令；工作目录未受信任 → 报错附原因 |
| 🔒 本地执行 | CLI 都在你机器上跑，消耗对应 CLI 的登录额度，由你掌控 |
| 🚫 不碰宿主 | 会话级插件，停止/会话结束即消失，不写任何 profile 文件 |

## 前置：想派谁就装谁的 CLI

```sh
# Codex（机器上已有 codex-cli 时软链到 PATH）
ln -s ~/.codex/plugins/.plugin-appserver/codex ~/.local/bin/codex
# Claude Code
npm i -g @anthropic-ai/claude-code
# OpenCode
npm i -g opencode-ai
# TraeCode CLI：https://docs.trae.cn/cli_command-line-parameters
```

> 派给 Codex 的任务默认在受信任的 git 目录执行（`conductor-dynamic.js` 里的 `cwd` 字段，换机器请修改）。若需让派出的 agent 能写文件，把 Codex 的 `~/.codex/config.toml` 加上 `sandbox_mode = "workspace-write"`。

## 已验证 vs 待验证

| CLI | 无头命令 | 状态 |
|---|---|---|
| Codex | `codex exec "{task}"` | ✅ 真机实测（翻译任务已产出交付） |
| Claude Code | `claude -p "{task}" --output-format text` | ✅ 官方文档 |
| TraeCode | `traecli exec "{task}"` | ✅ 官方文档 |
| OpenCode | `opencode run "{task}"` | ✅ 官方文档 |
| Gemini / Cursor / Kimi / Qwen / Copilot / WorkBuddy / Grok | 见代码注册表 | ⏳ 命令形态待实测 |

## 路线图

- [ ] 客户端面板（动态插件 client 半边）：agent 卡片 + 图标 + 派活反馈
- [ ] 任务看板回收：派活结果写入 dsh-task-board 卡片
- [ ] 后台派活 + 进度回填
- [ ] 小队编排：一个任务分发给多个 agent 汇总（Multica squads 形态）

## License

[MIT](LICENSE)

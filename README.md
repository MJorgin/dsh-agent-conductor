> ⚠️ **重要声明（2026-08-16）**：当前 profile-bundle 安装方式**已废弃**——在某些 DSH 版本上会导致 Web UI 无法打开。请**不要安装**本仓库的 bundle 版本。
> 项目正在重构为 **DSH 动态插件（热更新）路线**：通过会话内 `cordis_define / cordis_run` 加载，不动 profile、无需重启。完成前，本仓库仅作设计与源码参考。

# ⚡ dsh-agent-conductor · DSH 指挥家

**把 DeepSeek Harness 变成一支 agent 小队的指挥家：在 DSH 里直接派活给 Codex、Claude Code、TraeCode、OpenCode、Gemini、Cursor、Kimi、Qwen、Copilot、WorkBuddy、Grok 等 11 种外部 agent CLI，结果自动回收到任务看板。**

> "Your next 10 hires won't be human." —— 对标 Multica，但我们把工位直接开在 DSH 会话里。

## 特性

| 能力 | 说明 |
|---|---|
| 🧭 11 种 CLI 小队 | Codex / Claude Code / TraeCode / OpenCode / Gemini CLI / Cursor CLI / Kimi CLI / Qwen Code / Copilot CLI / WorkBuddy / Grok CLI；面板实时检测「已安装 / 未安装」，附安装方式 |
| 💬 聊天即派活 | `conductor_dispatch` 工具 + 原生 `subagent_codex` / `subagent_claude_code` 子代理工具，模型在对话里直接指挥别的 agent 干活 |
| 🎛️ 指挥家面板 | 侧边栏入口 + 浮层面板：品牌图标、安装状态、任务输入、**派活中实时反馈（旋转动画 + 耗时）**、结果卡、最近派活历史 |
| 📋 任务看板回收 | 每笔派活自动成为 [dsh-task-board](https://github.com/zhu1090093659/dsh-web-ui) 的一张卡片：**进行中 → 完成/失败**，结果附在卡片详情里，面板与看板实时同步 |
| 🔒 本地执行 | 所有 CLI 都在你机器上跑，代码不出本机；消耗对应 CLI 的登录额度，完全由你掌控 |

## 对标（为什么不是 Multica，也不是裸调 CLI）

| | Multica | dsh-task-board | DSH 原生 subagents | **dsh-agent-conductor** |
|---|---|---|---|---|
| 形态 | 独立自托管工作台（Go + Docker） | DSH 侧边栏看板 | 宿主内 spawn/fork | **DSH 内一个插件** |
| 指挥谁 | 20 种 agent CLI | 只有 DSH 自己 | DSH 自己的子代理 | **11 种外部 CLI + DSH 子代理** |
| 派活入口 | Issue 指派 | 看板卡片 | 模型调工具 | **聊天工具 + 图形面板双入口** |
| 结果去向 | Issue 评论区 | 看板卡片 | 工具结果 | **看板卡片（状态机 + 结果详情）** |
| 部署成本 | Docker 一整套 | 一条 plugin 命令 | 无 | **一条 plugin 命令** |
| 借鉴 Multica | — | — | — | 任务生命周期（接单→进行→交回）、结果回收、agent 小队概念 |

一句话：**Multica 是给团队用的外部工作台，指挥家是给你一个人用的 DSH 内置小队。** 两者不冲突，甚至可以联动（看板卡片 → 指挥家 → 外部 CLI）。

## 安装

```sh
dsh plugin --profile web add github:akqwpeter-prog/dsh-agent-conductor
```

前置：想派谁就装谁的 CLI（无头模式），并保证它在 PATH 上：

```sh
# Codex（你机器上可能已有：~/.codex/plugins/.plugin-appserver/codex，软链到 PATH 即可）
ln -s ~/.codex/plugins/.plugin-appserver/codex ~/.local/bin/codex

# Claude Code
npm i -g @anthropic-ai/claude-code

# OpenCode
npm i -g opencode-ai

# TraeCode CLI（官方文档确认 traecli exec 为非交互模式）
# 见 https://docs.trae.cn/cli_command-line-parameters
```

> pnpm 11 发布龄门禁：若安装时被静默装回旧版，在 profile 的 `pnpm-workspace.yaml` 加：
> `minimumReleaseAgeExclude: ['dsh-agent-conductor', '@deepseek-ai/*']`

## 用法

1. **图形面板**：侧边栏「⚡ 指挥家」（在「任务看板」旁）→ 填任务 → 点某个 agent 的「派活」→ 看实时反馈 → 结果自动进任务看板。
2. **聊天派活**：
   - 「用 conductor_dispatch 派 codex 查一下 XX」
   - 「用 subagent_codex 把 YY 翻译成英文」（原生 Codex 子代理通道）

## 原理

- **原生通道**：DSH 的 subagents 注册表自带 `codex` / `claude-code` 产品后端（官方包），本插件在 profile 层挂载 provider 行 + 委托工具行，不改任何 preset。
- **通用通道**：其余 CLI 走无头命令派发（`conductor_dispatch` 工具 / 面板 RPC），宿主记录每次派活（id、agent、状态、耗时、输出），`/conductor/runs` 供面板轮询。
- **任务看板回收**：客户端按看板的数据契约（localStorage `dsh.taskBoard.v1`）写入/更新任务卡片，并用同源 storage 事件让看板即时刷新。

## 已验证 vs 待验证

| CLI | 无头命令 | 状态 |
|---|---|---|
| Codex | `codex exec "{task}"` | ✅ 本机实测通过 |
| Claude Code | `claude -p "{task}" --output-format text` | ✅ 官方文档 |
| TraeCode | `traecli exec "{task}"` | ✅ 官方文档 |
| OpenCode | `opencode run "{task}"` | ✅ 官方文档 |
| Gemini / Cursor / Kimi / Qwen / Copilot / WorkBuddy / Grok | 见面板提示 | ⏳ 命令形态待实测（面板标 `*`） |

## 路线图

- [ ] 后台派活（`enableRunInBackground`）+ 面板进度回填
- [ ] 与 dsh-task-board 深度联动：看板卡片直接选择外部 CLI 执行
- [ ] 更多 CLI（按 Multica 清单继续扩）+ 已实测标记回写
- [ ] 小队编排：一个任务自动分发给多个 agent 汇总（Multica squads 形态）

## License

[MIT](LICENSE)

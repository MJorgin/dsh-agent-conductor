# ⚡ dsh-agent-conductor · DSH 指挥家（Skill 版）

**让 DeepSeek Harness 的 agent 自动识别派活需求，把任务派给 11 种外部 agent CLI（Codex、Claude Code、TraeCode、OpenCode、Gemini、Cursor、Kimi、Qwen、Copilot、WorkBuddy、Grok）无头执行，结果回传会话。**

> 灵感来自 [Multica](https://github.com/multica-ai/multica)——把"agent 小队"概念做成一个零安装成本的 DSH 技能。

## 为什么是 Skill

| | profile 插件 / bundle | 动态插件 | **Skill（本方案）** |
|---|---|---|---|
| 安装 | 写 profile + 重启 | 会话内定义 | **复制一个文件夹** |
| 触发 | 手动 | 模型调工具 | **描述匹配，模型自动识别** |
| 风险 | 可能影响 Web UI | 会话级、重启消失 | 只读脚本，宿主无感 |
| 结果 | 工具结果 | 工具结果 | **stdout 直接成为回答依据** |

一个 `SKILL.md` + 一个 90 行的 `dispatch.py`，完事。

## 安装

把 `skills/conductor/` 复制到任意技能根目录（项目级 `.dsh/skills/` 或全局 `~/.dsh/skills/`）：

```sh
mkdir -p .dsh/skills/conductor
cp -R skills/conductor/. .dsh/skills/conductor/
```

装完无需重启——下次对话直接说：

- 「派 codex 把这份 README 翻译成繁体中文」
- 「让 Claude Code 查一下这个报错的成因」
- 「用 Codex 独立实现一个 XXX」

agent 会**自动识别**（SKILL.md 描述匹配）→ 执行 `dispatch.py` → 结果回传。

## 前置：想派谁就装谁的 CLI

```sh
# Codex（机器上已有 codex-cli 时软链到 PATH）
ln -s ~/.codex/plugins/.plugin-appserver/codex ~/.local/bin/codex
# Claude Code / OpenCode
npm i -g @anthropic-ai/claude-code
npm i -g opencode-ai
# TraeCode CLI：https://docs.trae.cn/cli_command-line-parameters
```

> Codex 要求在受信任的 git 仓库运行：把 `CONDUCTOR_CWD=/path/to/git/repo` 写进 `~/.dsh/secrets/media-tools.env`。
> 想让派出的 agent 能写文件：Codex 的 `~/.codex/config.toml` 加 `sandbox_mode = "workspace-write"`。
> 派活消耗对方 CLI 的登录额度。

## 已验证 vs 待验证

| CLI | 无头命令 | 状态 |
|---|---|---|
| Codex | `codex exec "{task}"` | ✅ 真机实测（翻译任务已产出交付） |
| Claude Code | `claude -p "{task}" --output-format text` | ✅ 官方文档 |
| TraeCode | `traecli exec "{task}"` | ✅ 官方文档 |
| OpenCode | `opencode run "{task}"` | ✅ 官方文档 |
| Gemini / Cursor / Kimi / Qwen / Copilot / WorkBuddy / Grok | 见 `dispatch.py` 注册表 | ⏳ 命令形态待实测 |

## 仓库内容

```
skills/conductor/SKILL.md      # 技能定义：触发描述 + 派活规则 + 隐私
skills/conductor/scripts/dispatch.py  # 派活引擎（Python 标准库，零依赖）
conductor-dynamic.js           # 备选：动态插件版（cordis_define 路线）
```

## 路线图

- [ ] 面板 UI（可选，动态插件 client 半边）
- [ ] 任务看板回收：派活结果写入 dsh-task-board 卡片
- [ ] 小队编排：一个任务分发给多个 agent 汇总（Multica squads 形态）

## License

[MIT](LICENSE)

<div align="center">

<img src="docs/social-preview.png" alt="dsh-agent-conductor — in-session cross-agent dispatch for DeepSeek Harness" width="100%">

# ⚡ dsh-agent-conductor

### *Let your DeepSeek Harness agent dispatch tasks to 11 external agent CLIs — Codex, Claude Code, TraeCode, OpenCode, Gemini, Cursor, Kimi, Qwen, Copilot, WorkBuddy, Grok — headlessly, and bring results back into the conversation.*

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![DeepSeek Harness](https://img.shields.io/badge/DeepSeek%20Harness-plugin-4D6BFE)](https://github.com/topics/dsh-plugin)
[![Zero deps](https://img.shields.io/badge/deps-zero-2EA44F)](skills/conductor/scripts/dispatch.py)
[![Agents](https://img.shields.io/badge/agents-11-blue)](README.md#-agents)

**English** · [**简体中文**](docs/lang/README_ZH.md)

</div>

---

DeepSeek Harness is a great reasoning engine — but sometimes the job is better done by *another* coding agent: a Codex translation, a Claude Code investigation, a Cursor refactor. This plugin lets your DSH agent **recognize when to delegate** (by skill-description matching), **dispatch a self-contained task** to one of 11 external agent CLIs in headless mode, and **bring the stdout result back as the answer**.

> Inspired by [Multica](https://github.com/multica-ai/multica) — the "agent squad" idea as a zero-install DSH skill.

## ✨ What you get

| Capability | What it does | Cost |
|---|---|---|
| 🧠 Auto-triggered dispatch | Say "have Codex translate this README" — the model matches the skill, runs the dispatch script, and answers from the result | Free (uses the target CLI's quota) |
| 🔧 `conductor_dispatch` tool (optional bundle) | The same registry as a first-class DSH tool, installed into a profile with one command | Free |
| 🩺 `doctor` self-check | `python3 dispatch.py doctor` probes which CLIs are installed (resolves PATH + tries `--version`) before you dispatch | Free |
| 👥 11 agent CLIs | Codex, Claude Code, TraeCode, OpenCode, Gemini, Cursor, Kimi, Qwen, Copilot, WorkBuddy, Grok | Their login quotas |
| 🔒 Privacy | Task text goes only to the CLI's own provider; keys stay local | — |

## 🧭 Why a Skill (and not just a plugin)

| | profile plugin / bundle | dynamic plugin | **Skill (this repo)** |
|---|---|---|---|
| Install | write profile + restart | define in-session | **copy a folder** |
| Trigger | manual | model calls a tool | **description matching, model auto-recognizes** |
| Risk | touches the host | session-scoped, gone on restart | read-only script, host-agnostic |
| Result | tool result | tool result | **stdout directly becomes the answer** |

One `SKILL.md` + a ~90-line zero-dependency `dispatch.py` (Python stdlib only).

## ⚡ Quick start (Skill)

Copy `skills/conductor/` to any skill root (project-level `.dsh/skills/` or global `~/.dsh/skills/`):

```sh
mkdir -p .dsh/skills/conductor
cp -R skills/conductor/. .dsh/skills/conductor/
```

No restart needed — from the next message on, just say:

- "派 codex 把这份 README 翻译成繁体中文" (have Codex translate this README)
- "让 Claude Code 查一下这个报错的成因" (ask Claude Code to investigate this error)
- "用 Codex 独立实现一个 XXX" (have Codex implement XXX independently)

The agent auto-recognizes the need (SKILL.md description matching) → runs `dispatch.py` → returns the result.

## 🛠️ Prereqs: install the CLIs you want to dispatch to

```sh
# Codex / Claude Code / OpenCode / Gemini / Qwen
npm i -g @openai/codex
npm i -g @anthropic-ai/claude-code
npm i -g opencode-ai
npm i -g @google/gemini-cli
npm i -g @qwen-code/qwen-code
# Kimi / Grok / Copilot (headless flags verified against each CLI's own --help)
npm i -g @moonshot-ai/kimi-code
npm i -g @xai-official/grok
npm i -g @github/copilot
# TraeCode CLI: https://docs.trae.cn/cli_command-line-parameters
# (already have codex-cli? symlink instead: ln -s ~/.codex/plugins/.plugin-appserver/codex ~/.local/bin/codex)
```

> Headless note: Copilot non-interactive mode must auto-approve tools, so the registry runs `copilot -p "<task>" --allow-all-tools`. The other CLIs run their standard print/headless flag.

Then check what's actually dispatchable on this machine:

```sh
python3 skills/conductor/scripts/dispatch.py doctor
# ✅ Codex  …/codex — codex-cli 0.151.0 …
# ❌ Gemini … 未找到 `gemini`  →  安装：npm i -g @google/gemini-cli
```

> **Working directory is auto-detected.** The bundle tool runs each CLI in the current session's workspace (`exec.agent.session.header.cwd`), then `CONDUCTOR_CWD`, then the harness cwd — no hardcoded paths. Codex still requires a *trusted* git repo: point `CONDUCTOR_CWD=/path/to/git/repo` (env or `~/.dsh/secrets/media-tools.env`) at one if the auto-detected folder isn't trusted. The skill script honors `CONDUCTOR_CWD` and falls back to the current directory.
> To let the dispatched agent write files: add `sandbox_mode = "workspace-write"` to Codex's `~/.codex/config.toml`.
> Dispatching consumes the target CLI's login quota.

## ✅ Verified vs ⏳ pending

| CLI | Headless command | Status |
|---|---|---|
| Codex | `codex exec "{task}"` | ✅ field-tested (translation task delivered) |
| Claude Code | `claude -p "{task}" --output-format text` | ✅ installed; per official docs |
| TraeCode | `traecli exec "{task}"` | ✅ per official docs |
| OpenCode | `opencode run "{task}"` | ✅ per official docs |
| Gemini CLI | `gemini -p "{task}"` | ✅ per official docs |
| Qwen Code | `qwen --prompt "{task}"` | ✅ per official docs (Gemini-CLI fork) |
| Kimi CLI | `kimi --prompt "{task}"` | ✅ flag confirmed from the CLI's own help (`-p, --prompt` = non-interactive) |
| Copilot CLI | `copilot -p "{task}" --allow-all-tools` | ✅ flag confirmed from `copilot --help` (bin is `copilot`, not `github-copilot`; `--allow-all-tools` is required headless) |
| Grok CLI | `grok -p "{task}"` | ✅ per official README (`grok -p "..."` = run one task) |
| Cursor CLI | `cursor-agent -p "{task}"` | ⏳ command shape pending field test (install via cursor.com; the npm `cursor-agent` package is unrelated) |
| WorkBuddy | `workbuddy -p "{task}"` | ⏳ command shape pending field test |

> Install packages were verified against the npm registry: Kimi is `@moonshot-ai/kimi-code` (bin `kimi`), Grok is `@xai-official/grok` (bin `grok`), Copilot is `@github/copilot` (bin `copilot`), Codex is `@openai/codex`. The `kimi-cli` npm package is an unrelated placeholder with no binary — do not use it.

## 📦 Optional: bundle install (host-only tool)

This repo is also a **host-only** dsh bundle (declares `dsh.bundle`, **zero client code** — the Web UI is untouched). One command installs the `conductor_dispatch` tool into a profile:

```sh
dsh plugin --profile web add github:MJorgin/dsh-agent-conductor
```

- The tool and the skill share the same CLI registry (`index.js` ⇄ `conductor-dynamic.js` ⇄ `dispatch.py` — keep the three in sync when adding CLIs);
- No client half, so the Web UI is never affected (the early panel-carrying client version was removed — see git log);
- Hardened host execution: explicitly declares the `subprocess` dependency, enforces a real 10-minute timeout that **terminates the whole process tree** (also on cancel — no orphaned CLIs), and clips over-long output (head + tail, ~20k chars) so a chatty agent can't blow up the context;
- Panels / task-board recycling are on the roadmap.

## 📂 Repo layout

```
index.js                      # bundle host half: conductor_dispatch tool (host-only)
cordis.patch.yml              # bundle layer (one row, no client)
skills/conductor/SKILL.md      # skill definition: trigger description + dispatch rules + privacy
skills/conductor/scripts/dispatch.py  # dispatch engine (Python stdlib, zero deps)
conductor-dynamic.js           # alternative: dynamic-plugin edition (cordis_define route)
```

## 🗺️ Roadmap

- [ ] Panel UI (optional, dynamic-plugin client half)
- [ ] Task-board recycling: dispatch results written back to dsh-task-board cards
- [ ] Squad orchestration: one task fanned out to several agents and merged (Multica squads shape)

## 🔑 Keys & privacy

- Keys are never stored in this repo. The skill script reads env vars, then `~/.dsh/secrets/media-tools.env` (same convention as dsh-media-skills).
- Task text is sent to the target CLI's provider — never put secrets or internal data into a task.
- Results belong to the target CLI's terms of service; mark deliverables as "done by <agent name>".

## License

[MIT](LICENSE)

## Related

- 🎨 [dsh-media-skills](https://github.com/MJorgin/dsh-media-skills) — free vision & image generation for DSH (GLM-4V-Flash + Qwen3-VL + Gemini failover)
- 📬 Community listing PR: [awesome-dsh-plugin#664](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/pull/664)
- 📋 [awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin) · ecosystem index: [dsh-plugin topic](https://github.com/topics/dsh-plugin)
- 🎯 Benchmarks: [Multica](https://github.com/multica-ai/multica) (multi-agent workbench) · [dsh-web-ui](https://github.com/zhu1090093659/dsh-web-ui) (task board)

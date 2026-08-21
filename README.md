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
# Codex (symlink to PATH when you already have codex-cli)
ln -s ~/.codex/plugins/.plugin-appserver/codex ~/.local/bin/codex
# Claude Code / OpenCode
npm i -g @anthropic-ai/claude-code
npm i -g opencode-ai
# TraeCode CLI: https://docs.trae.cn/cli_command-line-parameters
```

> Codex requires a trusted git repo as its working directory: write `CONDUCTOR_CWD=/path/to/git/repo` into `~/.dsh/secrets/media-tools.env` (or export it). The skill script and the bundle tool both honor it, falling back to the current working directory.
> To let the dispatched agent write files: add `sandbox_mode = "workspace-write"` to Codex's `~/.codex/config.toml`.
> Dispatching consumes the target CLI's login quota.

## ✅ Verified vs ⏳ pending

| CLI | Headless command | Status |
|---|---|---|
| Codex | `codex exec "{task}"` | ✅ field-tested (translation task delivered) |
| Claude Code | `claude -p "{task}" --output-format text` | ✅ per official docs |
| TraeCode | `traecli exec "{task}"` | ✅ per official docs |
| OpenCode | `opencode run "{task}"` | ✅ per official docs |
| Gemini / Cursor / Kimi / Qwen / Copilot / WorkBuddy / Grok | see the `dispatch.py` registry | ⏳ command shape pending field test |

## 📦 Optional: bundle install (host-only tool)

This repo is also a **host-only** dsh bundle (declares `dsh.bundle`, **zero client code** — the Web UI is untouched). One command installs the `conductor_dispatch` tool into a profile:

```sh
dsh plugin --profile web add github:MJorgin/dsh-agent-conductor
```

- The tool and the skill share the same CLI registry (`index.js` ⇄ `dispatch.py` — keep them in sync when adding CLIs);
- No client half, so the Web UI is never affected (the early panel-carrying client version was removed — see git log);
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

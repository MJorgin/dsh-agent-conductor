/**
 * Browser half of dsh-agent-conductor: 大肥鱼指挥官 (Big Fat Fish Commander).
 *
 * A full page in the layout's `main` slot plus one navigation row in the
 * left `sidebar.panellist` — the same pair the shipped Plugins page and
 * dsh-media-skills use. The page reads the host-side run registry from the
 * same-origin `/conductor` route; it never talks to child processes directly.
 *
 * Registration order is high (1000) so the row sits immediately above the
 * built-in 更多 menu. The fleet uses original character artwork bundled with the plugin.
 */
window.__ModuleLoader__.load({
  id: 'dsh-agent-conductor',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    const React = require('react')
    const h = React.createElement

    const STYLE_ID = 'dsh-agent-conductor-style'
    const PANEL_ID = 'conductor'
    const NS = 'conductorCrew'
    const POLL_MS = 1500

    const STATUS_COLORS = {
      running: '#39b980',
      cancelling: '#d9a441',
      done: '#4c8dff',
      failed: '#e5534b',
      cancelled: '#9aa4ad',
      timeout: '#e0a72e',
      idle: '#8b949e',
    }

    function hexToRgba(hex, alpha) {
      const value = typeof hex === 'string' && /^#[0-9a-f]{6}$/i.test(hex) ? hex.slice(1) : '8b949e'
      const r = parseInt(value.slice(0, 2), 16)
      const g = parseInt(value.slice(2, 4), 16)
      const b = parseInt(value.slice(4, 6), 16)
      return `rgba(${r}, ${g}, ${b}, ${alpha})`
    }

    const COPY = {
      zh: {
        panel: '指挥官',
        title: '大肥鱼指挥官',
        subtitle: '深海作战室 · 鱼群编队实时战报',
        'chips.active': '出击中 {n}',
        'chips.done': '凯旋 {n}',
        'chips.failed': '折戟 {n}',
        'section.fleet': '鱼群编队',
        'section.log': '航海日志',
        'section.log.empty': '海面平静，还没有派活记录。用 conductor_dispatch 派第一件任务吧。',
        'section.log.hint': '最近 {n} 条战报，点击查看详情',
        'state.offline': '无法连接宿主：{message}',
        'state.offline.hint': '检查 Web 服务是否可用后重试。',
        'btn.refresh': '刷新',
        'btn.detail': '详情',
        'btn.connect': '连接',
        'btn.checkLogin': '检查登录',
        'btn.dispatch': '派遣',
        'btn.recheck': '重新检测',
        'btn.openChat': '打开对话并填写',
        'availability.available': '已检测到 CLI · 登录待确认',
        'availability.missing': '等待连接 · 未找到 CLI',
        'availability.unsupported': '等待连接 · 入口不受支持',
        'availability.unknown': '连接状态待检测',
        'availability.loading': '正在检测 CLI…',
        'connect.title': '连接 {name}',
        'connect.intro': '先检查本机 CLI，再在 DSH 对话中完成安装或登录。不会自动安装或执行命令。',
        'connect.skill': '使用技能',
        'connect.skillName': 'Conductor · 外部智能体派遣',
        'connect.found': '已找到可执行程序；登录状态需在对话中确认。',
        'connect.missing': '尚未找到可用程序。可在对话中获取安装与登录指导。',
        'connect.unsupported': '找到的 Windows 命令入口暂不支持直接运行，请在对话中了解替代方式。',
        'connect.unknown': '暂时无法确认 CLI 状态，请重新检测或在对话中排查。',
        'connect.install': '安装参考',
        'connect.note': '打开对话后，请核对所选工作区和预填内容，再自行发送；安装与登录按 DSH 的授权流程进行。',
        'dispatch.title': '派遣给 {name}',
        'dispatch.intro': '先写清任务。打开对话后核对工作区，可修改示例，再自行发送。',
        'dispatch.task': '任务内容',
        'dispatch.example': '请阅读当前工作区的 README，概括项目用途、主要功能和本地运行方式。只做分析，不修改文件。',
        'dispatch.note': '派遣会使用目标 CLI 的账号额度；目标无法看到本对话的上下文，请写明所需背景。',
        'chat.unavailable': '当前 DSH 版本无法打开对话，请在会话中使用 conductor 技能。',
        'chat.connectPrompt': '请使用 conductor 技能，帮我检查 {name} CLI 是否安装并已登录，说明连接步骤；如果未安装，请先向我说明安装方式并等待我确认，不要直接安装。',
        'chat.dispatchPrompt': '请使用 conductor_dispatch 工具将以下任务派给 {name}（{id}），并在完成后汇总结果。请先确认工作区与所需权限。\n\n任务：{task}',
        'btn.cancel': '终止',
        'btn.cancelling': '返航中…',
        'btn.close': '关闭',
        'btn.save': '保存',
        'btn.saving': '保存中…',
        'status.running': '出击中',
        'status.cancelling': '返航中',
        'status.done': '凯旋',
        'status.failed': '折戟',
        'status.cancelled': '返航',
        'status.timeout': '失联',
        'status.idle': '待命',
        'status.unconnected': '等待连接',
        'status.checking': '检测中',
        'task.idle': '待命中，随时可以出发。',
        'task.connect': '完成连接后即可派遣任务。',
        'task.empty': '（无任务描述）',
        'meta.elapsed': '计时',
        'meta.output': '输出',
        'meta.exit': '退出码',
        'meta.started': '出发',
        'meta.ended': '收队',
        'meta.duration': '耗时',
        'meta.chars': '字',
        'tail.empty': '（暂无输出）',
        'hint.dispatch': '等待派活',
        'hint.idle': '（还没出过海）',
        'detail.title': '战报详情',
        'detail.id': '编号',
        'detail.agent': '船员',
        'detail.cwd': '工作目录',
        'detail.argv': '命令',
        'detail.task': '任务',
        'detail.stdout': '标准输出（尾部）',
        'detail.stderr': '标准错误（尾部）',
        'detail.error': '错误',
        'detail.none': '（无）',
        'detail.loading': '正在读取战报…',
        'detail.missing': '这条战报不存在，可能已被清理。',
        'detail.running': '任务仍在执行，输出会持续更新。',
        'settings.label': '航海日志保留',
        'settings.unit': '条',
        'settings.hint': '1–200，保存后立即生效',
        'notice.cancelled': '已请求终止：{name}',
        'notice.saved': '保留条数已保存为 {n}。',
        'notice.invalid': '保留条数需为 1–200 的整数。',
        'notice.error': '操作失败：{message}',
        'confirm.cancel': '确定要终止「{name}」正在执行的任务吗？这会结束整个进程树。',
        'avatar.alt': '{name} 的二次元头像',
        'unit.seconds': '秒',
        'time.justNow': '刚刚',
        'time.secondsAgo': '{n} 秒前',
        'time.minutesAgo': '{n} 分钟前',
        'time.hoursAgo': '{n} 小时前',
        'footer.note': '同源只读轮询 · 数据留在本机 · 输出默认保留尾部',
      },
      en: {
        panel: 'Commander',
        title: 'Big Fat Fish Commander',
        subtitle: 'Deep-Sea War Room · live fleet dispatches',
        'chips.active': 'Active {n}',
        'chips.done': 'Returned {n}',
        'chips.failed': 'Lost {n}',
        'section.fleet': 'Fleet',
        'section.log': 'Ship log',
        'section.log.empty': 'Calm seas — no dispatches yet. Fire the first task with conductor_dispatch.',
        'section.log.hint': 'Last {n} dispatches, click for details',
        'state.offline': 'Cannot reach host: {message}',
        'state.offline.hint': 'Check that the Web service is running, then retry.',
        'btn.refresh': 'Refresh',
        'btn.detail': 'Details',
        'btn.connect': 'Connect',
        'btn.checkLogin': 'Check sign-in',
        'btn.dispatch': 'Dispatch',
        'btn.recheck': 'Check again',
        'btn.openChat': 'Open a draft chat',
        'availability.available': 'CLI found · sign-in unverified',
        'availability.missing': 'Awaiting connection · CLI not found',
        'availability.unsupported': 'Awaiting connection · unsupported entry point',
        'availability.unknown': 'Connection not yet verified',
        'availability.loading': 'Checking CLI…',
        'connect.title': 'Connect {name}',
        'connect.intro': 'Check the local CLI, then use a DSH chat for installation or sign-in. Nothing is installed or executed automatically.',
        'connect.skill': 'Skill',
        'connect.skillName': 'Conductor · external agent dispatch',
        'connect.found': 'Executable found; confirm sign-in in the chat.',
        'connect.missing': 'No usable executable found. Open a chat for installation and sign-in guidance.',
        'connect.unsupported': 'The Windows entry point is not supported by the bundle; ask in chat about alternatives.',
        'connect.unknown': 'The CLI status could not be determined. Check again or troubleshoot in chat.',
        'connect.install': 'Installation reference',
        'connect.note': 'Check the selected workspace, review and send the draft yourself; installation and sign-in follow DSH approval.',
        'dispatch.title': 'Dispatch to {name}',
        'dispatch.intro': 'Describe the task. Check the workspace and edit the example in chat before sending it.',
        'dispatch.task': 'Task',
        'dispatch.example': 'Read the README in the current workspace and summarize the project, its main features and how to run it locally. Analyze only; do not edit files.',
        'dispatch.note': 'Dispatch uses the target CLI account quota. The target cannot see this conversation, so include the necessary context.',
        'chat.unavailable': 'This DSH version cannot open a draft chat. Use the conductor skill in a conversation.',
        'chat.connectPrompt': 'Use the conductor skill to check whether {name} CLI is installed and signed in, and explain how to connect it. If installation is needed, explain the steps and wait for my confirmation; do not install it automatically.',
        'chat.dispatchPrompt': 'Use the conductor_dispatch tool to delegate the task below to {name} ({id}) and summarize the result. First check the workspace and required permissions.\n\nTask: {task}',
        'btn.cancel': 'Terminate',
        'btn.cancelling': 'Returning…',
        'btn.close': 'Close',
        'btn.save': 'Save',
        'btn.saving': 'Saving…',
        'status.running': 'Underway',
        'status.cancelling': 'Returning',
        'status.done': 'Returned',
        'status.failed': 'Lost',
        'status.cancelled': 'Recalled',
        'status.timeout': 'Overdue',
        'status.idle': 'Standing by',
        'status.unconnected': 'Awaiting connection',
        'status.checking': 'Checking',
        'task.idle': 'Standing by, ready to sail.',
        'task.connect': 'Connect to start dispatching.',
        'task.empty': '(no task text)',
        'meta.elapsed': 'Elapsed',
        'meta.output': 'Output',
        'meta.exit': 'Exit',
        'meta.started': 'Cast off',
        'meta.ended': 'Docked',
        'meta.duration': 'Duration',
        'meta.chars': 'chars',
        'tail.empty': '(no output yet)',
        'hint.dispatch': 'Awaiting dispatch',
        'hint.idle': '(has not sailed yet)',
        'detail.title': 'Dispatch detail',
        'detail.id': 'ID',
        'detail.agent': 'Crew',
        'detail.cwd': 'Working dir',
        'detail.argv': 'Command',
        'detail.task': 'Task',
        'detail.stdout': 'stdout (tail)',
        'detail.stderr': 'stderr (tail)',
        'detail.error': 'Error',
        'detail.none': '(none)',
        'detail.loading': 'Reading dispatch…',
        'detail.missing': 'This dispatch no longer exists.',
        'detail.running': 'Still running — output updates live.',
        'settings.label': 'Ship-log retention',
        'settings.unit': 'runs',
        'settings.hint': '1–200, applies immediately',
        'notice.cancelled': 'Termination requested: {name}',
        'notice.saved': 'Retention saved: {n}.',
        'notice.invalid': 'Retention must be an integer between 1 and 200.',
        'notice.error': 'Action failed: {message}',
        'confirm.cancel': 'Terminate “{name}”? This ends the whole process tree.',
        'avatar.alt': 'Chibi avatar of {name}',
        'unit.seconds': 's',
        'time.justNow': 'just now',
        'time.secondsAgo': '{n}s ago',
        'time.minutesAgo': '{n}m ago',
        'time.hoursAgo': '{n}h ago',
        'footer.note': 'Same-origin polling · data stays on this machine · tails only',
      },
    }

    /** Placeholder chibi crew. `gear` picks the head accessory drawn on the avatar. */
    const CREW = [
      { id: 'codex', name: 'Codex', skin: '#ffd9b8', hair: '#2f6f4f', suit: '#0f2a1e', accent: '#9fe3b5', gear: 'goggles' },
      { id: 'claude-code', name: 'Claude Code', skin: '#ffe0c2', hair: '#c96a3a', suit: '#2b1710', accent: '#ffb27a', gear: 'headset' },
      { id: 'trae', name: 'TraeCode', skin: '#ffd9b8', hair: '#b23b34', suit: '#2a1212', accent: '#ff8f8a', gear: 'cap' },
      { id: 'opencode', name: 'OpenCode', skin: '#f2c9a4', hair: '#1f2933', suit: '#0b1220', accent: '#7fb3ff', gear: 'visor' },
      { id: 'gemini', name: 'Gemini CLI', skin: '#ffe3c8', hair: '#3d6bd8', suit: '#101a3a', accent: '#9fc2ff', gear: 'antenna' },
      { id: 'cursor', name: 'Cursor CLI', skin: '#f6d2b3', hair: '#5b6472', suit: '#1a1d24', accent: '#c9d3e3', gear: 'star' },
      { id: 'kimi', name: 'Kimi CLI', skin: '#ffd9c9', hair: '#d65f8f', suit: '#2b1120', accent: '#ffb3d1', gear: 'crown' },
      { id: 'qwen', name: 'Qwen Code', skin: '#ffdcc0', hair: '#7a4bd0', suit: '#1b1130', accent: '#c9b3ff', gear: 'horns' },
      { id: 'copilot', name: 'Copilot CLI', skin: '#ffd9b8', hair: '#2f4a7a', suit: '#0d1b33', accent: '#7fd0ff', gear: 'helmet' },
      { id: 'workbuddy', name: 'WorkBuddy', skin: '#ffe0b0', hair: '#62a983', suit: '#16372e', accent: '#a6e1b9', gear: 'bolt' },
      { id: 'grok', name: 'Grok CLI', skin: '#e8c7a6', hair: '#262626', suit: '#0c0c10', accent: '#9aa0a6', gear: 'scarf' },
    ]

    let localeCtx = null
    let t = (key, vars) => interpolate(COPY.zh[key] ?? key, vars)

    function interpolate(template, vars) {
      if (vars === undefined || template === undefined) return template
      return String(template).replace(/\{(\w+)\}/g, (match, name) => (vars[name] === undefined ? match : String(vars[name])))
    }

    function ensureStyles() {
      if (typeof document === 'undefined') return
      const existing = document.getElementById(STYLE_ID)
      const style = existing ?? document.createElement('style')
      style.id = STYLE_ID
      style.textContent = `
.dshc-page {
  height: 100%; overflow: auto; box-sizing: border-box;
  padding: calc(var(--dsh-frame-top-clearance, 48px) + 20px) 40px 40px;
  color: var(--dsw-alias-label-primary, #0f1115);
  font-family: var(--dsw-font-family, -apple-system, "PingFang SC", system-ui, sans-serif);
}
.dshc-inner { max-width: 1120px; margin: 0 auto; }
.dshc-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 20px; }
.dshc-headline { display: flex; align-items: center; gap: 14px; min-width: 0; }
.dshc-headtext h1 { margin: 0; font-size: 22px; font-weight: 600; letter-spacing: .01em; }
.dshc-headtext p { margin: 6px 0 0; font-size: 13px; color: var(--dsw-alias-label-tertiary, #81858c); }
.dshc-chips { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px; }
.dshc-chip {
  display: inline-flex; align-items: center; gap: 6px; font-size: 12px;
  color: var(--dsw-alias-label-secondary, #5c6169);
  background: var(--dsw-alias-bg-layer-2, rgba(0,0,0,.035));
  border: 1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.06));
  border-radius: 999px; padding: 3px 10px;
}
.dshc-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--dshc-status, #8b949e); box-shadow: 0 0 0 2px var(--dshc-status-soft, rgba(139,148,158,.22)); }
.dshc-header-actions { display: flex; align-items: center; gap: 10px; flex: none; }
.dshc-settings {
  display: flex; align-items: center; gap: 8px; font-size: 12px; white-space: nowrap;
  color: var(--dsw-alias-label-tertiary, #81858c);
  background: var(--dsw-alias-bg-layer-2, rgba(0,0,0,.035));
  border: 1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.06));
  border-radius: 999px; padding: 4px 6px 4px 12px;
}
.dshc-settings input {
  width: 54px; font: inherit; font-size: 12px; text-align: right; box-sizing: border-box;
  border: 1px solid var(--dsw-alias-border-l2, rgba(0,0,0,.12)); border-radius: 7px;
  background: var(--dsw-alias-bg-base, #fff); color: inherit; padding: 3px 6px; outline: none;
}
.dshc-settings input:focus { border-color: var(--dsw-alias-label-secondary, #5c6169); }
.dshc-btn {
  font: inherit; font-size: 12.5px; cursor: pointer; border-radius: 8px; padding: 5px 12px;
  border: 1px solid var(--dsw-alias-border-l2, rgba(0,0,0,.12));
  background: var(--dsw-alias-bg-elevated, rgba(0,0,0,.02));
  color: var(--dsw-alias-label-primary, #0f1115);
  transition: background .15s ease, border-color .15s ease;
}
.dshc-btn:hover:not(:disabled) { background: var(--dsw-alias-bg-layer-2, rgba(0,0,0,.05)); }
.dshc-btn:disabled { opacity: .55; cursor: default; }
.dshc-btn-primary { background: var(--dsw-alias-button-primary-fill, #0f1115); color: var(--dsw-alias-label-primary-foreground, #fff); border-color: transparent; }
.dshc-btn-danger { color: #e5534b; border-color: rgba(229,83,75,.35); }
.dshc-banner {
  margin-top: 16px; padding: 10px 14px; border-radius: 10px; font-size: 12.5px;
  color: #b23b34; background: rgba(229,83,75,.08); border: 1px solid rgba(229,83,75,.25);
}
.dshc-notice {
  margin-top: 16px; padding: 8px 14px; border-radius: 10px; font-size: 12.5px;
  color: var(--dsw-alias-label-secondary, #5c6169);
  background: var(--dsw-alias-bg-layer-2, rgba(0,0,0,.035));
  border: 1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.06));
}
.dshc-section-title {
  display: flex; align-items: baseline; justify-content: space-between; gap: 12px;
  margin: 30px 0 12px;
}
.dshc-section-title h2 { margin: 0; font-size: 15px; font-weight: 600; }
.dshc-section-title span { font-size: 12px; color: var(--dsw-alias-label-tertiary, #81858c); }
.dshc-fleet { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 14px; }
.dshc-card {
  position: relative; display: flex; flex-direction: column; gap: 9px;
  border: 1px solid var(--dsw-alias-border-l2, rgba(0,0,0,.12));
  border-radius: 14px; padding: 14px; overflow: hidden;
  background: var(--dsw-alias-bg-layer-2, rgba(0,0,0,.03));
  transition: border-color .16s ease, box-shadow .16s ease;
}
.dshc-card[data-status="running"] {
  border-color: rgba(57,185,128,.55);
  box-shadow: inset 0 0 0 1px rgba(57,185,128,.16), 0 0 26px rgba(57,185,128,.08);
}
.dshc-card[data-status="failed"] { border-color: rgba(229,83,75,.38); }
.dshc-cardhead { display: flex; align-items: center; gap: 10px; }
.dshc-avatar { display: inline-flex; flex: none; filter: drop-shadow(0 2px 3px rgba(0,0,0,.18)); }
.dshc-id { min-width: 0; flex: 1; }
.dshc-name { font-size: 14px; font-weight: 600; line-height: 1.25; }
.dshc-callsign { margin-top: 1px; font-size: 11px; color: var(--dsw-alias-label-tertiary, #81858c); font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
.dshc-pill {
  flex: none; display: inline-flex; align-items: center; gap: 5px;
  font-size: 11.5px; font-weight: 500; border-radius: 999px; padding: 2px 9px;
  color: var(--dshc-status, #8b949e);
  background: var(--dshc-status-soft, rgba(139,148,158,.13));
  border: 1px solid var(--dshc-status-ring, rgba(139,148,158,.32));
}
.dshc-pill .dshc-dot { width: 6px; height: 6px; box-shadow: none; }
.dshc-task {
  font-size: 12.5px; line-height: 1.55; color: var(--dsw-alias-label-secondary, #5c6169);
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
  min-height: 39px;
}
.dshc-meta { display: flex; flex-wrap: wrap; gap: 4px 14px; font-size: 11.5px; color: var(--dsw-alias-label-tertiary, #81858c); }
.dshc-tail {
  margin: 0; padding: 8px 10px; max-height: 52px; overflow: hidden; white-space: pre-wrap; word-break: break-all;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 11px; line-height: 1.5;
  color: var(--dsw-alias-label-caption, #8b9097);
  background: var(--dsw-alias-bg-base, rgba(0,0,0,.03));
  border: 1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.06)); border-radius: 8px;
}
.dshc-tail-empty { color: var(--dsw-alias-label-caption, #a6abb2); font-style: normal; }
.dshc-actions { display: flex; align-items: center; gap: 8px; margin-top: auto; padding-top: 2px; }
.dshc-actions-hint { font-size: 11.5px; color: var(--dsw-alias-label-caption, #a6abb2); }
.dshc-log {
  border: 1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.06));
  border-radius: 14px; overflow: hidden;
  background: var(--dsw-alias-bg-layer-2, rgba(0,0,0,.02));
}
.dshc-logrow {
  display: flex; align-items: center; gap: 10px; width: 100%; text-align: left;
  padding: 10px 14px; border: 0; border-bottom: 1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.05));
  background: none; color: inherit; font: inherit; cursor: pointer;
}
.dshc-logrow:last-child { border-bottom: 0; }
.dshc-logrow:hover { background: var(--dsw-alias-bg-base, rgba(0,0,0,.04)); }
.dshc-logtime {
  flex: none; width: 68px; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 11px; color: var(--dsw-alias-label-tertiary, #81858c);
}
.dshc-logtext { flex: 1; min-width: 0; font-size: 12.5px; }
.dshc-logtext b { font-weight: 600; }
.dshc-logtext span { color: var(--dsw-alias-label-tertiary, #81858c); }
.dshc-logrow .dshc-pill { font-size: 11px; }
.dshc-empty { padding: 26px 14px; text-align: center; font-size: 13px; color: var(--dsw-alias-label-tertiary, #81858c); }
.dshc-foot { margin-top: 26px; font-size: 11.5px; color: var(--dsw-alias-label-caption, #a6abb2); text-align: center; }
.dshc-mask {
  position: fixed; inset: 0; z-index: 60; display: flex; align-items: center; justify-content: center;
  background: rgba(8, 14, 20, .42); backdrop-filter: blur(2px); padding: 24px;
}
.dshc-drawer {
  width: min(760px, 94vw); max-height: 86vh; overflow: auto; box-sizing: border-box;
  background: var(--dsw-alias-bg-elevated, #fff); color: var(--dsw-alias-label-primary, #0f1115);
  border: 1px solid var(--dsw-alias-border-l2, rgba(0,0,0,.12)); border-radius: 16px;
  box-shadow: 0 28px 70px rgba(0,0,0,.32); padding: 20px 22px;
}
.dshc-drawer-head { display: flex; align-items: center; gap: 12px; }
.dshc-drawer-head h3 { margin: 0; font-size: 16px; font-weight: 600; flex: 1; }
.dshc-drawer-head .dshc-btn { flex: none; }
.dshc-kv { display: grid; grid-template-columns: 96px 1fr; gap: 6px 12px; margin-top: 16px; font-size: 12.5px; }
.dshc-kv dt { color: var(--dsw-alias-label-tertiary, #81858c); }
.dshc-kv dd { margin: 0; word-break: break-all; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 12px; }
.dshc-block { margin-top: 16px; }
.dshc-block h4 { margin: 0 0 6px; font-size: 12.5px; font-weight: 600; color: var(--dsw-alias-label-secondary, #5c6169); }
.dshc-block pre {
  margin: 0; max-height: 220px; overflow: auto; padding: 10px 12px; white-space: pre-wrap; word-break: break-all;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 11.5px; line-height: 1.55;
  color: var(--dsw-alias-label-secondary, #5c6169);
  background: var(--dsw-alias-bg-base, rgba(0,0,0,.03));
  border: 1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.07)); border-radius: 9px;
}
.dshc-taskquote {
  margin: 0; padding: 10px 12px; font-size: 12.5px; line-height: 1.65;
  color: var(--dsw-alias-label-secondary, #5c6169);
  background: var(--dsw-alias-bg-layer-2, rgba(0,0,0,.03));
  border-left: 3px solid var(--dsw-alias-border-l3, rgba(0,0,0,.18)); border-radius: 0 8px 8px 0;
  max-height: 160px; overflow: auto;
}
@media (max-width: 760px) {
  .dshc-page { padding: calc(var(--dsh-frame-top-clearance, 48px) + 14px) 18px 30px; }
  .dshc-head { flex-direction: column; }
}

/* Naval field journal: retain host theme tokens for the working surfaces. */
.dshc-page { padding-left: 36px; padding-right: 36px; }
.dshc-inner { max-width: 1380px; }
.dshc-head { position: relative; overflow: hidden; align-items: center; min-height: 184px; padding: 26px 30px; border-radius: 20px; color: #f4f8f7; background: radial-gradient(ellipse at 17% 5%, #2a6873 0, transparent 42%), linear-gradient(115deg, #102d3a, #0c2333 68%, #163e4a); box-shadow: 0 18px 42px rgba(14,42,53,.16); }
.dshc-head::after { content: ''; position: absolute; right: -90px; bottom: -160px; width: 380px; height: 380px; border: 1px solid rgba(173,224,221,.16); border-radius: 50%; box-shadow: 0 0 0 35px rgba(173,224,221,.035), 0 0 0 70px rgba(173,224,221,.025), 0 0 0 105px rgba(173,224,221,.02); pointer-events: none; }
.dshc-headline, .dshc-header-actions { position: relative; z-index: 1; }
.dshc-headline { gap: 22px; }
.dshc-captain-wrap { position: relative; flex: none; display: block; }
.dshc-captain-wrap .dshc-mascot { position: absolute; inset: 0; width: 100%; height: 100%; }
.dshc-captain { position: absolute; z-index: 1; width: 100%; height: 100%; object-fit: contain; filter: drop-shadow(0 8px 18px rgba(0,0,0,.24)); }
.dshc-eyebrow, .dshc-section-kicker { font: 700 10px/1.2 ui-monospace, SFMono-Regular, Menlo, monospace; letter-spacing: .16em; }
.dshc-eyebrow { color: #90c6c4; margin-bottom: 10px; }
.dshc-headtext h1 { font-size: 27px; font-weight: 700; letter-spacing: .04em; }
.dshc-headtext p { color: #b4ccce; margin-top: 7px; }
.dshc-chips { margin-top: 16px; }
.dshc-chip { color: #edf7f4; border-color: rgba(218,246,240,.14); background: rgba(255,255,255,.08); padding: 5px 10px; }
.dshc-header-actions { align-self: flex-end; flex-wrap: wrap; justify-content: flex-end; }
.dshc-head .dshc-settings { color: #d4e6e3; background: rgba(5,24,32,.34); border-color: rgba(218,246,240,.16); }
.dshc-head .dshc-settings input { background: rgba(255,255,255,.10); color: white; border-color: rgba(255,255,255,.17); }
.dshc-head .dshc-btn { color: #e7f3f1; background: rgba(255,255,255,.1); border-color: rgba(255,255,255,.17); }
.dshc-head .dshc-btn-primary { background: #d7ede3; color: #123b3d; border-color: transparent; }
.dshc-head .dshc-btn:hover:not(:disabled) { background: #badbd1; color: #123b3d; }
.dshc-section-title { align-items: end; margin: 34px 2px 14px; }
.dshc-section-title h2 { font-size: 19px; margin-top: 6px; letter-spacing: .02em; }
.dshc-section-kicker { color: #508b8c; }
.dshc-section-title > span { font: 600 10px/1.2 ui-monospace, monospace; letter-spacing: .12em; }
.dshc-fleet { grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 12px; }
.dshc-card { min-width: 0; gap: 11px; padding: 16px; border-radius: 14px; background: var(--dsw-alias-bg-elevated, #fff); box-shadow: 0 3px 14px rgba(17,43,52,.035); }
.dshc-card::before { content: ''; position: absolute; top: 0; left: 16px; width: 34px; height: 3px; border-radius: 0 0 3px 3px; background: var(--crew-accent, #87a7a4); opacity: .85; }
.dshc-card:hover { transform: translateY(-2px); box-shadow: 0 10px 24px rgba(17,43,52,.1); }
.dshc-card { transition: transform .2s ease, border-color .2s ease, box-shadow .2s ease; }
.dshc-card[data-status="running"] { border-color: #65bfa7; box-shadow: 0 0 0 1px rgba(57,185,128,.12), 0 10px 24px rgba(57,185,128,.10); }
.dshc-card[data-status="running"] .dshc-avatar { animation: dshc-float 2.8s ease-in-out infinite; }
.dshc-card[data-status="running"] .dshc-pill .dshc-dot { animation: dshc-pulse 1.6s ease-in-out infinite; }
.dshc-cardhead { gap: 12px; }
.dshc-name { font-size: 14px; }
.dshc-callsign { margin-top: 4px; font-size: 10px; letter-spacing: .04em; }
.dshc-avatar { position: relative; border-radius: 50%; overflow: hidden; background: #d5edf7; }
.dshc-avatar-atlas { position: absolute; width: 400%; height: 300%; max-width: none; object-fit: fill; }
.dshc-task { min-height: 0; line-height: 1.55; }
.dshc-card[data-status="idle"] .dshc-meta { display: none; }
.dshc-card[data-status="idle"] .dshc-actions { padding-top: 0; border-top: 0; }
.dshc-actions { border-top: 1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.06)); padding-top: 10px; }
.dshc-actions-hint { color: #679897; }
.dshc-availability { display: flex; align-items: center; gap: 6px; font-size: 11px; line-height: 1.4; color: var(--dsw-alias-label-tertiary, #81858c); }
.dshc-availability-dot { width: 6px; height: 6px; flex: none; border-radius: 50%; background: #d3a35a; }
.dshc-availability[data-availability="available"] .dshc-availability-dot { background: #39b980; }
.dshc-availability[data-availability="loading"] .dshc-availability-dot { background: #9aa4ad; }
.dshc-dispatch { color: #16745f; border-color: rgba(42,155,126,.3); background: rgba(68,177,143,.08); }
.dshc-action-dialog { width: min(560px, 94vw); }
.dshc-dialog-intro { font-size: 13px; line-height: 1.65; color: var(--dsw-alias-label-secondary, #5c6169); margin: 18px 0; }
.dshc-dialog-note { font-size: 12px; line-height: 1.6; color: var(--dsw-alias-label-tertiary, #81858c); }
.dshc-skill-choice { display: flex; align-items: center; gap: 12px; border: 1px solid rgba(52,151,131,.35); background: rgba(64,171,146,.07); border-radius: 12px; padding: 13px; }
.dshc-skill-choice small, .dshc-skill-choice b, .dshc-install small { display: block; }
.dshc-skill-choice small, .dshc-install small { font-size: 11px; color: var(--dsw-alias-label-tertiary, #81858c); margin-bottom: 4px; }
.dshc-skill-choice b { font-size: 13px; }
.dshc-skill-symbol { display: grid; place-items: center; width: 34px; height: 34px; border-radius: 10px; background: #d8eee7; color: #247f6a; }
.dshc-install { padding: 10px 12px; border-radius: 8px; background: var(--dsw-alias-bg-layer-2, rgba(0,0,0,.035)); overflow-wrap: anywhere; font-size: 12px; }
.dshc-task-label { display: block; margin-bottom: 7px; font-size: 12px; font-weight: 600; }
.dshc-task-input { box-sizing: border-box; width: 100%; resize: vertical; min-height: 120px; border: 1px solid var(--dsw-alias-border-l2, rgba(0,0,0,.15)); border-radius: 10px; padding: 12px; font: inherit; font-size: 13px; line-height: 1.6; background: var(--dsw-alias-bg-base, #fff); color: inherit; }
.dshc-task-input:focus-visible { outline: 2px solid #51bda9; outline-offset: 2px; }
.dshc-dialog-actions { display: flex; justify-content: flex-end; flex-wrap: wrap; gap: 8px; margin-top: 18px; }
.dshc-log { border-radius: 14px; background: var(--dsw-alias-bg-elevated, #fff); }
.dshc-empty { padding: 30px 20px; }
.dshc-foot { text-align: left; margin: 26px 2px; }
.dshc-btn:focus-visible, .dshc-logrow:focus-visible, .dshc-settings input:focus-visible { outline: 2px solid #51bda9; outline-offset: 2px; }
@keyframes dshc-float { 50% { transform: translateY(-3px); } }
@keyframes dshc-pulse { 50% { opacity: .45; } }
@media (prefers-reduced-motion: reduce) { .dshc-card, .dshc-avatar, .dshc-dot { animation: none !important; transition: none !important; } }
@media (max-width: 900px) { .dshc-head { align-items: flex-start; flex-direction: column; gap: 18px; } .dshc-header-actions { align-self: flex-start; justify-content: flex-start; } }
@media (max-width: 760px) { .dshc-page { padding-left: 18px; padding-right: 18px; } .dshc-head { padding: 22px; } .dshc-headline { gap: 12px; } .dshc-captain-wrap { width: 88px !important; height: 88px !important; } .dshc-headtext h1 { font-size: 22px; } .dshc-settings { white-space: normal; flex-wrap: wrap; } .dshc-fleet { grid-template-columns: repeat(auto-fill, minmax(min(100%, 260px), 1fr)); } }

      `
      if (existing === null) document.head.appendChild(style)
    }

    /* ------------------------------ artwork ------------------------------ */

    function PanelIcon() {
      // A compact naval cap: the same currentColor outline weight as the
      // surrounding DSH navigation icons, with a small anchor at its centre.
      return h('svg', {
        viewBox: '0 0 24 24', width: 16, height: 16, fill: 'none',
        stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round', strokeLinejoin: 'round',
        'aria-hidden': 'true',
      },
        h('path', { d: 'M4.6 12 2.5 7.2c-.4-.9 0-1.7.9-2.1l4.5-2a10.2 10.2 0 0 1 8.2 0l4.5 2c.9.4 1.3 1.2.9 2.1L19.4 12' }),
        h('path', { d: 'M4.6 12h14.8v2.4H4.6z' }),
        h('path', { d: 'M4.6 14.4c-1.1.8-1.6 1.5-1.6 2.3 0 1.9 4 3.3 9 3.3s9-1.4 9-3.3c0-.8-.5-1.5-1.6-2.3' }),
        h('path', { d: 'M12 5.7v4.5m-1.5-2.8h3M9.8 9.3c0 1.1 1 1.9 2.2 1.9s2.2-.8 2.2-1.9', strokeWidth: 1.45 }))
    }

    function CommanderMascot({ size = 92 }) {
      return h('span', { className: 'dshc-captain-wrap', style: { width: size, height: size } },
        h('img', { className: 'dshc-captain', src: '/conductor/assets/captain.webp', alt: '', onError: (event) => { event.currentTarget.style.display = 'none' } }),
        h('svg', { viewBox: '0 0 96 96', width: size, height: size, 'aria-hidden': 'true', className: 'dshc-mascot' },
        h('defs', null,
          h('linearGradient', { id: 'dshc-sea', x1: '0', y1: '0', x2: '0', y2: '1' },
            h('stop', { offset: '0%', stopColor: '#1d6f8c' }),
            h('stop', { offset: '100%', stopColor: '#0b3d55' }))),
        h('circle', { cx: 48, cy: 50, r: 42, fill: 'url(#dshc-sea)', opacity: 0.9 }),
        h('path', { d: 'M14 68c8-6 16-6 24 0s16 6 24 0 16-6 22-1v10c-6 5-14 5-22 1s-16-6-24 0-16 6-22 0Z', fill: '#7fd0ff', opacity: 0.16 }),
        h('path', { d: 'M48 26c14 0 25 10 25 24 0 15-11 27-25 27S23 65 23 50c0-14 11-24 25-24Z', fill: '#ffd9a8' }),
        h('path', { d: 'M28 35c-9-3-15-9-16-17 8 1 14 4 19 9Z', fill: '#ff9f68' }),
        h('path', { d: 'M68 35c9-3 15-9 16-17-8 1-14 4-19 9Z', fill: '#ff9f68' }),
        h('path', { d: 'M48 70c-2 8-7 12-14 13 5-5 7-10 7-15Z', fill: '#ff9f68' }),
        h('path', { d: 'M48 70c2 8 7 12 14 13-5-5-7-10-7-15Z', fill: '#ff9f68' }),
        h('path', { d: 'M25 38c2-13 12-20 23-20s21 7 23 20c-7-4-15-6-23-6s-16 2-23 6Z', fill: '#12384a' }),
        h('path', { d: 'M31 24c4-9 12-13 17-13s13 4 17 13c-5-3-11-4-17-4s-12 1-17 4Z', fill: '#1b4f66' }),
        h('path', { d: 'M25 38c-4-16 5-26 23-26s27 10 23 26l-7-4c1-11-6-16-16-16s-17 5-16 16Z', fill: '#f3f6f9' }),
        h('path', { d: 'M24 35h48l-3 6H27Z', fill: '#0f2a3a' }),
        h('circle', { cx: 26, cy: 38, r: 4, fill: '#e8b84b' }),
        h('path', { d: 'M38 48c1.6 2 4.4 2 6 0M56 48c1.6 2 4.4 2 6 0', fill: 'none', stroke: '#12384a', strokeWidth: 2.6, strokeLinecap: 'round' }),
        h('circle', { cx: 39, cy: 47, r: 4.4, fill: '#fff' }),
        h('circle', { cx: 59, cy: 47, r: 4.4, fill: '#fff' }),
        h('circle', { cx: 40, cy: 47.5, r: 2.7, fill: '#12374a' }),
        h('circle', { cx: 60, cy: 47.5, r: 2.7, fill: '#12374a' }),
        h('circle', { cx: 41.2, cy: 46.2, r: 1, fill: '#fff' }),
        h('circle', { cx: 61.2, cy: 46.2, r: 1, fill: '#fff' }),
        h('ellipse', { cx: 33, cy: 56, rx: 4, ry: 2.2, fill: '#ff8fa6', opacity: 0.5 }),
        h('ellipse', { cx: 65, cy: 56, rx: 4, ry: 2.2, fill: '#ff8fa6', opacity: 0.5 }),
        h('path', { d: 'M44 57c2.6 2.6 6.4 2.6 9 0', fill: 'none', stroke: '#a35c3f', strokeWidth: 2.2, strokeLinecap: 'round' }),
        h('circle', { cx: 72, cy: 24, r: 3.2, fill: '#d9f0ff', opacity: 0.55 }),
        h('circle', { cx: 80, cy: 17, r: 2.1, fill: '#d9f0ff', opacity: 0.4 })))
    }

    function avatarEyes(offsetY, gear) {
      if (gear === 'visor') {
        return [
          h('rect', { x: 22, y: 33, width: 20, height: 9, rx: 4, fill: '#7fd0ff', opacity: 0.55 }),
          h('rect', { x: 22, y: 33, width: 20, height: 9, rx: 4, fill: 'none', stroke: '#153847', strokeWidth: 1.4 }),
          h('path', { d: 'M25 37h6', stroke: '#fff', strokeWidth: 1.4, strokeLinecap: 'round', opacity: 0.8 }),
        ]
      }
      const eye = (cx) => [
        h('ellipse', { cx, cy: 36 + offsetY, rx: 3.6, ry: 4.4, fill: '#fff' }),
        h('ellipse', { cx: cx + 0.6, cy: 36.3 + offsetY, rx: 2.4, ry: 3.1, fill: '#24313d' }),
        h('circle', { cx: cx + 1.5, cy: 34.9 + offsetY, r: 0.9, fill: '#fff' }),
      ]
      return [...eye(26), ...eye(38)]
    }

    function avatarGear(gear) {
      switch (gear) {
        case 'goggles':
          return [
            h('rect', { x: 19.5, y: 31.5, width: 13, height: 9.5, rx: 4, fill: '#2bd4a0', opacity: 0.32 }),
            h('rect', { x: 31.5, y: 31.5, width: 13, height: 9.5, rx: 4, fill: '#2bd4a0', opacity: 0.32 }),
            h('rect', { x: 19.5, y: 31.5, width: 13, height: 9.5, rx: 4, fill: 'none', stroke: '#0f2a1e', strokeWidth: 1.6 }),
            h('rect', { x: 31.5, y: 31.5, width: 13, height: 9.5, rx: 4, fill: 'none', stroke: '#0f2a1e', strokeWidth: 1.6 }),
            h('path', { d: 'M32.5 36h-1', stroke: '#0f2a1e', strokeWidth: 1.6 }),
          ]
        case 'headset':
          return [
            h('path', { d: 'M20 34c0-9 5.5-14 12-14s12 5 12 14', fill: 'none', stroke: '#c96a3a', strokeWidth: 2.6, strokeLinecap: 'round' }),
            h('circle', { cx: 19.5, cy: 38, r: 4, fill: '#c96a3a' }),
            h('circle', { cx: 44.5, cy: 38, r: 4, fill: '#c96a3a' }),
            h('path', { d: 'M44 45c3 1 4 3 4 6', fill: 'none', stroke: '#c96a3a', strokeWidth: 2, strokeLinecap: 'round' }),
          ]
        case 'cap':
          return [
            h('path', { d: 'M22 28c4-9 16-11 21-2 1 2 1 4 1 6H21c0-2 0-3 1-4Z', fill: '#b23b34' }),
            h('path', { d: 'M20 22h20c2 0 3 2 3 4H19c-1-2 0-4 1-4Z', fill: '#ff8f8a' }),
          ]
        case 'visor':
          return avatarEyes(2, 'visor')
        case 'antenna':
          return [
            h('path', { d: 'M36 16c0-6 3-9 8-9', fill: 'none', stroke: '#3d6bd8', strokeWidth: 2.2, strokeLinecap: 'round' }),
            h('circle', { cx: 44, cy: 7.5, r: 2.6, fill: '#9fc2ff' }),
          ]
        case 'star':
          return [
            h('path', { d: 'M47 12l1.8 4 4.2.4-3.2 3 .9 4.2-3.7-2.3-3.7 2.3.9-4.2-3.2-3 4.2-.4Z', fill: '#ffd76a', stroke: '#c9a227', strokeWidth: 0.8 }),
          ]
        case 'crown':
          return [
            h('path', { d: 'M28 22l3-8 5 5 4-8 4 8 5-5 3 8Z', fill: '#ffd76a', stroke: '#c9a227', strokeWidth: 1.2, strokeLinejoin: 'round' }),
            h('circle', { cx: 32, cy: 15, r: 1.3, fill: '#fff' }),
            h('circle', { cx: 40, cy: 12, r: 1.3, fill: '#fff' }),
            h('circle', { cx: 48, cy: 15, r: 1.3, fill: '#fff' }),
          ]
        case 'horns':
          return [
            h('path', { d: 'M25 20c-2-6 0-10 2-12 2 3 3 7 3 11Z', fill: '#e7d6ff', stroke: '#7a4bd0', strokeWidth: 1.2 }),
            h('path', { d: 'M39 20c2-6 0-10-2-12-2 3-3 7-3 11Z', fill: '#e7d6ff', stroke: '#7a4bd0', strokeWidth: 1.2 }),
          ]
        case 'helmet':
          return [
            h('path', { d: 'M19 36c0-10 6-17 13-17s13 7 13 17', fill: 'none', stroke: '#2f4a7a', strokeWidth: 3, strokeLinecap: 'round' }),
            h('path', { d: 'M31 19c1 3 3 4 1 7', fill: 'none', stroke: '#7fd0ff', strokeWidth: 1.6, strokeLinecap: 'round' }),
          ]
        case 'bolt':
          return [
            h('path', { d: 'M42 11l-6 9h4l-2 7 7-9h-4Z', fill: '#ffd76a', stroke: '#c9a227', strokeWidth: 1 }),
          ]
        case 'scarf':
          return [
            h('path', { d: 'M20 45c6 4 14 4 20 0 1 4-1 7-3 9-5 3-11 3-15 0-2-2-3-5-2-9Z', fill: '#8b949e', opacity: 0.85 }),
          ]
        default:
          return []
      }
    }

    function CrewAvatar({ crew, size = 46, status = 'idle' }) {
      const gear = avatarGear(crew.gear)
      const showEyes = true
      const index = Math.max(0, CREW.findIndex((item) => item.id === crew.id))
      return h('span', { className: 'dshc-avatar', style: { width: size, height: size }, role: 'img', 'aria-label': t('avatar.alt', { name: crew.name }) },
        h('svg', {
          viewBox: '0 0 64 64', width: size, height: size, 'aria-hidden': 'true',
        },
          h('circle', { cx: 32, cy: 34, r: 29, fill: crew.suit }),
          h('path', { d: 'M6 44c8-4 14-4 22 0s14 4 22 0 8-3 8-3v17H6Z', fill: crew.accent, opacity: 0.14 }),
          h('path', { d: 'M9 34c-5-6-4-15 2-20 3 5 4 12 3 20Z', fill: crew.hair }),
          h('path', { d: 'M55 34c5-6 4-15-2-20-3 5-4 12-3 20Z', fill: crew.hair }),
          h('circle', { cx: 32, cy: 36, r: 17.5, fill: crew.skin }),
          h('path', { d: 'M17 36c-1-12 7-19 15-19s16 7 15 19c-4-5-9-7-15-7s-11 2-15 7Z', fill: crew.hair }),
          h('path', { d: 'M18 33c-2-11 6-18 14-18s16 7 14 18l-4-3c1-8-4-11-10-11s-11 3-10 11Z', fill: crew.hair, opacity: 0.75 }),
          ...gear,
          showEyes ? [
            h('ellipse', { cx: 26, cy: 36, rx: 3.6, ry: 4.4, fill: '#fff' }),
            h('ellipse', { cx: 26.6, cy: 36.3, rx: 2.4, ry: 3.1, fill: '#24313d' }),
            h('circle', { cx: 27.5, cy: 34.9, r: 0.9, fill: '#fff' }),
            h('ellipse', { cx: 38, cy: 36, rx: 3.6, ry: 4.4, fill: '#fff' }),
            h('ellipse', { cx: 38.6, cy: 36.3, rx: 2.4, ry: 3.1, fill: '#24313d' }),
            h('circle', { cx: 39.5, cy: 34.9, r: 0.9, fill: '#fff' }),
          ] : null,
          h('ellipse', { cx: 22.5, cy: 42, rx: 3.2, ry: 1.8, fill: '#ff9eb0', opacity: 0.5 }),
          h('ellipse', { cx: 41.5, cy: 42, rx: 3.2, ry: 1.8, fill: '#ff9eb0', opacity: 0.5 }),
          h('path', { d: 'M29.5 45c1.5 1.7 3.5 1.7 5 0', fill: 'none', stroke: '#8c4a3c', strokeWidth: 1.4, strokeLinecap: 'round' }),
          h('circle', { cx: 52, cy: 52, r: 7.6, fill: '#ffffff' }),
          h('circle', { cx: 52, cy: 52, r: 5.2, fill: STATUS_COLORS[status] ?? STATUS_COLORS.idle })),
        h('img', { className: 'dshc-avatar-atlas', src: '/conductor/assets/crew-atlas.webp', alt: '', style: { left: `${-(index % 4) * 100}%`, top: `${-Math.floor(index / 4) * 100}%` }, onError: (event) => { event.currentTarget.style.display = 'none' } })
      )
    }

    /* ------------------------------ helpers ------------------------------ */

    function statusStyle(status) {
      const color = STATUS_COLORS[status] ?? STATUS_COLORS.idle
      return {
        '--dshc-status': color,
        '--dshc-status-soft': hexToRgba(color, 0.14),
        '--dshc-status-ring': hexToRgba(color, 0.33),
      }
    }

    function statusKey(run) {
      if (run === null) return 'idle'
      if (run.status === 'running' && run.cancelRequested) return 'cancelling'
      return run.status
    }

    function statusLabel(run) {
      return t(`status.${statusKey(run)}`)
    }

    function formatDuration(ms) {
      if (typeof ms !== 'number' || !Number.isFinite(ms) || ms < 0) return '—'
      const total = Math.floor(ms / 1000)
      const h = Math.floor(total / 3600)
      const m = Math.floor((total % 3600) / 60)
      const s = total % 60
      if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
      return `${m}:${String(s).padStart(2, '0')}`
    }

    function formatClock(ts) {
      if (typeof ts !== 'number' || !Number.isFinite(ts)) return '—'
      const date = new Date(ts)
      return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}:${String(date.getSeconds()).padStart(2, '0')}`
    }

    function formatAgo(ts, nowMs) {
      if (typeof ts !== 'number' || !Number.isFinite(ts)) return t('time.justNow')
      const diff = Math.max(0, nowMs - ts)
      if (diff < 10_000) return t('time.justNow')
      if (diff < 60_000) return t('time.secondsAgo', { n: Math.floor(diff / 1000) })
      if (diff < 3_600_000) return t('time.minutesAgo', { n: Math.floor(diff / 60_000) })
      return t('time.hoursAgo', { n: Math.floor(diff / 3_600_000) })
    }

    function elapsedOf(run, nowMs) {
      if (run === null) return null
      if (run.endedAt !== null && typeof run.endedAt === 'number') return run.durationMs
      return Math.max(0, nowMs - run.startedAt)
    }

    /** Newest run per agent id: live runs win over history. */
    function crewState(state) {
      const map = new Map()
      const history = Array.isArray(state?.history) ? state.history : []
      for (const run of history) {
        if (run && typeof run.agentId === 'string' && !map.has(run.agentId)) map.set(run.agentId, run)
      }
      const active = Array.isArray(state?.active) ? state.active : []
      for (const run of active) {
        if (run && typeof run.agentId === 'string') map.set(run.agentId, run)
      }
      return map
    }

    function readStats(state) {
      const stats = state?.stats ?? {}
      return {
        active: Number(stats.active) || 0,
        done: Number(stats.done) || 0,
        failed: Number(stats.failed) || 0,
        cancelled: Number(stats.cancelled) || 0,
        timeout: Number(stats.timeout) || 0,
      }
    }

    async function api(path, init) {
      const response = await fetch(`/conductor${path}`, { cache: 'no-store', ...init })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(body.message ?? `HTTP ${response.status}`)
      return body
    }

    /* ------------------------------ widgets ------------------------------ */

    function StatusPill({ status, label }) {
      return h('span', { className: 'dshc-pill', style: statusStyle(status) },
        h('span', { className: 'dshc-dot' }), label)
    }

    function FleetCard({ crew, run, availability, nowMs, busyId, onDetail, onCancel, onConnect, onDispatch }) {
      const status = statusKey(run)
      const elapsed = elapsedOf(run, nowMs)
      return h('div', { className: 'dshc-card', 'data-status': status === 'idle' ? 'idle' : status, style: { '--crew-accent': crew.accent } },
        h('div', { className: 'dshc-cardhead' },
          h(CrewAvatar, { crew, size: 62, status: status === 'idle' ? 'idle' : status }),
          h('div', { className: 'dshc-id' },
            h('div', { className: 'dshc-name' }, crew.name),
            h('div', { className: 'dshc-callsign' }, crew.id)),
          h(StatusPill, { status, label: run !== null ? statusLabel(run) : !availability ? t('status.checking') : availability.status === 'available' ? t('status.idle') : t('status.unconnected') })),
        h('div', { className: 'dshc-availability', 'data-availability': availability?.status ?? 'loading' },
          h('span', { className: 'dshc-availability-dot' }), t(availability ? `availability.${availability.status}` : 'availability.loading')),
        h('div', { className: 'dshc-task' }, run === null ? t(availability?.status === 'available' ? 'task.idle' : 'task.connect') : (run.taskPreview || t('task.empty'))),
        run === null
          ? h('div', { className: 'dshc-meta' }, h('span', null, t('hint.idle')))
          : h('div', { className: 'dshc-meta' },
              h('span', null, `${t('meta.elapsed')} ${formatDuration(elapsed)}`),
              h('span', null, `${t('meta.output')} ${(run.outputChars ?? 0).toLocaleString()} ${t('meta.chars')}`),
              typeof run.exitCode === 'number' ? h('span', null, `${t('meta.exit')} ${run.exitCode}`) : null,
              run.status !== 'running' ? h('span', null, formatAgo(run.endedAt, nowMs)) : null),
        run !== null ? h('pre', { className: run.outputTail ? 'dshc-tail' : 'dshc-tail dshc-tail-empty' },
          run.outputTail || t('tail.empty')) : null,
        h('div', { className: 'dshc-actions' },
          availability?.status === 'available' && status !== 'running' && status !== 'cancelling'
            ? h('button', { type: 'button', className: 'dshc-btn dshc-dispatch', onClick: () => onDispatch(crew) }, t('btn.dispatch'))
            : availability?.status !== 'available'
              ? h('button', { type: 'button', className: 'dshc-btn', onClick: () => onConnect(crew) }, t('btn.connect')) : null,
          availability?.status === 'available' && status !== 'running' && status !== 'cancelling' ? h('button', { type: 'button', className: 'dshc-btn', onClick: () => onConnect(crew) }, t('btn.checkLogin')) : null,
          run !== null ? h('button', { type: 'button', className: 'dshc-btn', onClick: () => onDetail(run.id) }, t('btn.detail')) : null,
          status === 'running'
            ? h('button', {
                type: 'button',
                className: 'dshc-btn dshc-btn-danger',
                disabled: busyId === run.id,
                onClick: () => onCancel(run),
              }, busyId === run.id ? t('btn.cancelling') : t('btn.cancel'))
            : null))
    }

    function LogRow({ event, nowMs, onDetail }) {
      const type = event.type === 'start' ? 'running' : event.type
      const label = type === 'running'
        ? t('status.running')
        : (type === 'done' ? t('status.done')
          : type === 'failed' ? t('status.failed')
            : type === 'cancelled' ? t('status.cancelled')
              : type === 'timeout' ? t('status.timeout') : t('status.idle'))
      return h('button', { type: 'button', className: 'dshc-logrow', onClick: () => onDetail(event.runId) },
        h('span', { className: 'dshc-logtime' }, formatClock(event.at)),
        h('span', { className: 'dshc-pill', style: statusStyle(type) }, h('span', { className: 'dshc-dot' }), label),
        h('span', { className: 'dshc-logtext' },
          h('b', null, event.agentName || event.agentId || '—'), ' ',
          h('span', null, event.taskPreview || t('task.empty'))),
        type !== 'running' && typeof event.durationMs === 'number'
          ? h('span', { className: 'dshc-logtime' }, formatDuration(event.durationMs))
          : h('span', { className: 'dshc-logtime' }, formatAgo(event.at, nowMs)))
    }

    function DetailDrawer({ open, run, error, busyId, onClose, onCancel }) {
      if (!open) return null
      const status = run === null ? 'failed' : statusKey(run)
      return h('div', { className: 'dshc-mask', onClick: onClose },
        h('div', { className: 'dshc-drawer', onClick: (event) => event.stopPropagation() },
          h('div', { className: 'dshc-drawer-head' },
            run === null
              ? h('h3', null, t('detail.title'))
              : h(CrewAvatar, { crew: CREW.find((crew) => crew.id === run.agentId) ?? CREW[0], size: 42, status }),
            run === null ? null : h('h3', null, `${run.agentName || run.agentId} · ${statusLabel(run)}`),
            h('button', { type: 'button', className: 'dshc-btn', onClick: onClose }, t('btn.close'))),
          error !== null
            ? h('div', { className: 'dshc-banner' }, error)
            : run === null ? h('div', { className: 'dshc-notice' }, t('detail.loading')) : [
                run.status === 'running' ? h('div', { className: 'dshc-notice', style: { marginTop: '12px' } }, t('detail.running')) : null,
                h('dl', { className: 'dshc-kv' },
                  h('dt', null, t('detail.id')), h('dd', null, run.id),
                  h('dt', null, t('detail.cwd')), h('dd', null, run.cwd || '—'),
                  h('dt', null, t('meta.started')), h('dd', null, `${formatClock(run.startedAt)} (${formatAgo(run.startedAt, Date.now())})`),
                  h('dt', null, t('meta.duration')), h('dd', null, run.endedAt !== null ? formatDuration(run.durationMs) : formatDuration(Math.max(0, Date.now() - run.startedAt))),
                  h('dt', null, t('meta.output')), h('dd', null, `${(run.outputChars ?? 0).toLocaleString()} ${t('meta.chars')}`),
                  run.exitCode === null ? null : h('dt', null, t('meta.exit')),
                  run.exitCode === null ? null : h('dd', null, String(run.exitCode))),
                h('div', { className: 'dshc-block' },
                  h('h4', null, t('detail.task')),
                  h('p', { className: 'dshc-taskquote' }, run.taskPreview || t('detail.none'))),
                h('div', { className: 'dshc-block' },
                  h('h4', null, t('detail.argv')),
                  h('pre', null, Array.isArray(run.argv) ? run.argv.join(' ') : '—')),
                h('div', { className: 'dshc-block' },
                  h('h4', null, t('detail.stdout')),
                  h('pre', null, run.outputTail || t('detail.none'))),
                run.stderrTail
                  ? h('div', { className: 'dshc-block' },
                      h('h4', null, t('detail.stderr')),
                      h('pre', null, run.stderrTail))
                  : null,
                run.error
                  ? h('div', { className: 'dshc-block' },
                      h('h4', null, t('detail.error')),
                      h('pre', null, run.error))
                  : null,
                run.status === 'running'
                  ? h('div', { className: 'dshc-actions', style: { marginTop: '18px' } },
                      h('button', {
                        type: 'button',
                        className: 'dshc-btn dshc-btn-danger',
                        disabled: busyId === run.id,
                        onClick: () => onCancel(run),
                      }, busyId === run.id ? t('btn.cancelling') : t('btn.cancel')))
                  : null,
              ]))
    }

    function ActionDialog({ action, info, task, checking, onTask, onClose, onRecheck, onOpenChat }) {
      if (action === null) return null
      const { kind, crew } = action
      const connect = kind === 'connect'
      return h('div', { className: 'dshc-mask', onClick: onClose },
        h('div', { className: 'dshc-drawer dshc-action-dialog', role: 'dialog', 'aria-modal': 'true', 'aria-label': t(connect ? 'connect.title' : 'dispatch.title', { name: crew.name }), onClick: (event) => event.stopPropagation() },
          h('div', { className: 'dshc-drawer-head' },
            h(CrewAvatar, { crew, size: 54 }),
            h('h3', null, t(connect ? 'connect.title' : 'dispatch.title', { name: crew.name })),
            h('button', { type: 'button', className: 'dshc-btn', onClick: onClose }, t('btn.close'))),
          h('p', { className: 'dshc-dialog-intro' }, t(connect ? 'connect.intro' : 'dispatch.intro')),
          connect ? [
            h('div', { className: 'dshc-skill-choice' },
              h('span', { className: 'dshc-skill-symbol', 'aria-hidden': 'true' }, '✦'),
              h('span', null, h('small', null, t('connect.skill')), h('b', null, t('connect.skillName')))),
            h('p', { className: 'dshc-dialog-note' }, t(info?.status === 'available' ? 'connect.found' : info?.status === 'missing' ? 'connect.missing' : info?.status === 'unsupported' ? 'connect.unsupported' : 'connect.unknown')),
            info?.install ? h('div', { className: 'dshc-install' }, h('small', null, t('connect.install')), h('code', null, info.install)) : null,
            h('p', { className: 'dshc-dialog-note' }, t('connect.note')),
          ] : [
            h('label', { className: 'dshc-task-label', htmlFor: 'dshc-dispatch-task' }, t('dispatch.task')),
            h('textarea', { id: 'dshc-dispatch-task', className: 'dshc-task-input', value: task, onChange: (event) => onTask(event.target.value), rows: 5 }),
            h('p', { className: 'dshc-dialog-note' }, t('dispatch.note')),
          ],
          h('div', { className: 'dshc-dialog-actions' },
            connect ? h('button', { type: 'button', className: 'dshc-btn', disabled: checking, onClick: () => onRecheck(crew.id) }, checking ? t('availability.loading') : t('btn.recheck')) : null,
            h('button', { type: 'button', className: 'dshc-btn dshc-btn-primary', disabled: !connect && task.trim() === '', onClick: onOpenChat }, t('btn.openChat')))))
    }

    /* ------------------------------ page ------------------------------ */

    function App({ startSession } = {}) {
      const [state, setState] = React.useState(null)
      const [loadError, setLoadError] = React.useState(null)
      const [tick, setTick] = React.useState(0)
      const [nowMs, setNowMs] = React.useState(Date.now())
      const [detailId, setDetailId] = React.useState(null)
      const [detail, setDetail] = React.useState(null)
      const [detailError, setDetailError] = React.useState(null)
      const [busyId, setBusyId] = React.useState(null)
      const [limitDraft, setLimitDraft] = React.useState('')
      const [notice, setNotice] = React.useState('')
      const [availability, setAvailability] = React.useState(null)
      const [checking, setChecking] = React.useState(false)
      const [action, setAction] = React.useState(null)
      const [taskDraft, setTaskDraft] = React.useState('')

      React.useEffect(() => {
        const id = setInterval(() => setNowMs(Date.now()), 1000)
        return () => clearInterval(id)
      }, [])

      React.useEffect(() => {
        let alive = true
        let timer = null
        const load = () => {
          if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
          api('/state')
            .then((body) => {
              if (!alive) return
              setState(body)
              setLoadError(null)
              setLimitDraft((previous) => (previous === '' ? String(body?.settings?.historyLimit ?? '') : previous))
            })
            .catch((error) => { if (alive) setLoadError(error.message ?? String(error)) })
        }
        load()
        timer = setInterval(load, POLL_MS)
        const onVisible = () => {
          if (document.visibilityState === 'visible') load()
        }
        document.addEventListener('visibilitychange', onVisible)
        return () => {
          alive = false
          clearInterval(timer)
          document.removeEventListener('visibilitychange', onVisible)
        }
      }, [tick])

      React.useEffect(() => {
        if (notice === '') return undefined
        const id = setTimeout(() => setNotice(''), 4200)
        return () => clearTimeout(id)
      }, [notice])

      const refresh = () => setTick((value) => value + 1)

      const checkAvailability = React.useCallback(async () => {
        setChecking(true)
        try {
          const body = await api('/availability')
          setAvailability(Object.fromEntries((body.agents ?? []).map((item) => [item.id, item])))
        } catch {
          setAvailability(Object.fromEntries(CREW.map((crew) => [crew.id, { id: crew.id, status: 'unknown' }])))
        } finally { setChecking(false) }
      }, [])
      React.useEffect(() => { checkAvailability() }, [checkAvailability])

      const openAction = (kind, crew) => {
        setTaskDraft(kind === 'dispatch' ? t('dispatch.example') : '')
        setAction({ kind, crew })
      }
      const openActionChat = () => {
        if (!action) return
        if (typeof startSession !== 'function') { setNotice(t('chat.unavailable')); setAction(null); return }
        const prompt = action.kind === 'connect'
          ? t('chat.connectPrompt', { name: action.crew.name })
          : t('chat.dispatchPrompt', { name: action.crew.name, id: action.crew.id, task: taskDraft.trim() })
        startSession(prompt)
        setAction(null)
      }

      // Keep an open report current; ignore late replies after it is closed or changed.
      React.useEffect(() => {
        if (detailId === null) return undefined
        let alive = true
        let timer
        const load = async () => {
          if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
            if (alive) timer = setTimeout(load, POLL_MS)
            return
          }
          try {
            const body = await api(`/run?id=${encodeURIComponent(detailId)}`)
            if (alive) { setDetail(body.run ?? null); setDetailError(body.run ? null : t('detail.missing')) }
          } catch (error) {
            if (alive) setDetailError(error.message ?? String(error))
          } finally {
            if (alive) timer = setTimeout(load, POLL_MS)
          }
        }
        load()
        return () => { alive = false; clearTimeout(timer) }
      }, [detailId])

      const openDetail = (id) => {
        setDetail(null)
        setDetailError(null)
        setDetailId(id)
      }

      const closeDetail = () => {
        setDetailId(null)
        setDetail(null)
        setDetailError(null)
      }

      const cancelRun = async (run) => {
        const name = run.agentName || run.agentId || '?'
        if (typeof window !== 'undefined' && typeof window.confirm === 'function' && !window.confirm(t('confirm.cancel', { name }))) return
        setBusyId(run.id)
        try {
          await api('/cancel', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ id: run.id }),
          })
          setNotice(t('notice.cancelled', { name }))
          refresh()
        } catch (error) {
          setNotice(t('notice.error', { message: error.message ?? String(error) }))
        } finally {
          setBusyId(null)
        }
      }

      const saveLimit = async () => {
        const value = Number(limitDraft)
        if (!Number.isInteger(value) || value < 1 || value > 200) {
          setNotice(t('notice.invalid'))
          return
        }
        setBusyId('settings')
        try {
          await api('/settings', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ historyLimit: value }),
          })
          setNotice(t('notice.saved', { n: value }))
          refresh()
        } catch (error) {
          setNotice(t('notice.error', { message: error.message ?? String(error) }))
        } finally {
          setBusyId(null)
        }
      }

      const runs = crewState(state)
      const stats = readStats(state)
      const historyLimit = Number(state?.settings?.historyLimit) || 50
      // One row per run: do not count both the start and completion as two logs.
      const events = [...(Array.isArray(state?.active) ? state.active : []),
        ...(Array.isArray(state?.history) ? state.history : [])]
        .sort((a, b) => (b.endedAt ?? b.startedAt) - (a.endedAt ?? a.startedAt))
        .slice(0, historyLimit)
        .map((run) => ({ type: run.status, runId: run.id, agentId: run.agentId,
          agentName: run.agentName, taskPreview: run.taskPreview,
          at: run.endedAt ?? run.startedAt, durationMs: run.durationMs }))

      return h('div', { className: 'dshc-page' },
        h('div', { className: 'dshc-inner' },
          h('div', { className: 'dshc-head' },
            h('div', { className: 'dshc-headline' },
              h(CommanderMascot, { size: 142 }),
              h('div', { className: 'dshc-headtext' },
                h('div', { className: 'dshc-eyebrow', 'aria-hidden': 'true' }, 'FAT FISH FLEET  /  COMMAND CENTER'),
                h('h1', null, t('title')),
                h('p', null, t('subtitle')),
                h('div', { className: 'dshc-chips' },
                  h('span', { className: 'dshc-chip', style: statusStyle('running') }, h('span', { className: 'dshc-dot' }), t('chips.active', { n: stats.active })),
                  h('span', { className: 'dshc-chip', style: statusStyle('done') }, h('span', { className: 'dshc-dot' }), t('chips.done', { n: stats.done })),
                  h('span', { className: 'dshc-chip', style: statusStyle('failed') }, h('span', { className: 'dshc-dot' }), t('chips.failed', { n: stats.failed }))))),
            h('div', { className: 'dshc-header-actions' },
              h('div', { className: 'dshc-settings' },
                h('span', null, `${t('settings.label')}`),
                h('input', {
                  value: limitDraft,
                  inputMode: 'numeric',
                  min: 1,
                  max: 200,
                  onChange: (event) => setLimitDraft(event.target.value),
                  'aria-label': t('settings.label'),
                }),
                h('span', null, t('settings.unit')),
                h('button', {
                  type: 'button',
                  className: 'dshc-btn dshc-btn-primary',
                  disabled: busyId === 'settings',
                  onClick: saveLimit,
                }, busyId === 'settings' ? t('btn.saving') : t('btn.save'))),
              h('button', { type: 'button', className: 'dshc-btn', onClick: refresh }, t('btn.refresh')))),
          loadError !== null
            ? h('div', { className: 'dshc-banner' }, `${t('state.offline', { message: loadError })} ${t('state.offline.hint')}`)
            : null,
          notice !== ''
            ? h('div', { className: 'dshc-notice' }, notice)
            : null,
          h('div', { className: 'dshc-section-title' },
            h('div', null, h('div', { className: 'dshc-section-kicker', 'aria-hidden': 'true' }, '01 / THE CREW'), h('h2', null, t('section.fleet'))),
            h('span', null, `${CREW.length} AGENTS`)),
          h('div', { className: 'dshc-fleet' },
            CREW.map((crew) => h(FleetCard, {
              key: crew.id,
              crew,
              run: runs.get(crew.id) ?? null,
              availability: availability?.[crew.id] ?? null,
              onConnect: (item) => openAction('connect', item),
              onDispatch: (item) => openAction('dispatch', item),
              nowMs,
              busyId,
              onDetail: openDetail,
              onCancel: cancelRun,
            }))),
          h('div', { className: 'dshc-section-title' },
            h('div', null, h('div', { className: 'dshc-section-kicker', 'aria-hidden': 'true' }, '02 / SHIP LOG'), h('h2', null, t('section.log'))),
            h('span', null, events.length === 0 ? '' : t('section.log.hint', { n: historyLimit }))),
          h('div', { className: 'dshc-log' },
            events.length === 0
              ? h('div', { className: 'dshc-empty' }, t('section.log.empty'))
              : events.map((event, index) => h(LogRow, {
                  key: `${event.runId}-${event.type}-${index}`,
                  event,
                  nowMs,
                  onDetail: openDetail,
                }))),
          h('div', { className: 'dshc-foot' },
            [t('footer.note'), state?.version ? `v${state.version}` : null].filter(Boolean).join(' · '))),
        h(ActionDialog, { action, info: action ? availability?.[action.crew.id] : null, task: taskDraft, checking, onTask: setTaskDraft, onClose: () => setAction(null), onRecheck: checkAvailability, onOpenChat: openActionChat }),
        h(DetailDrawer, {
          open: detailId !== null,
          run: detail,
          error: detailError,
          busyId,
          onClose: closeDetail,
          onCancel: (run) => {
            cancelRun(run)
            closeDetail()
          },
        })
      )
    }

    function apply(ctx) {
      ensureStyles()
      if (ctx.locale !== undefined) {
        localeCtx = ctx.locale
        ctx.effect(() => ctx.locale.register(NS, COPY), 'dsh-agent-conductor: dictionaries')
        t = ctx.locale.bind(NS)
      }
      // One row in the left sidebar, immediately above the built-in 更多 menu.
      ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
        name: 'sidebar.panellist',
        id: PANEL_ID,
        order: 1000,
        label: () => t('panel'),
        locale: NS,
      }, PanelIcon))
      // The matching full page in the main area.
      ctx.slots.inject('main', () => ctx.slots.register({
        name: 'main',
        key: PANEL_ID,
        inject: () => ({ startSession: (prompt) => ctx.uiWorkspace.startSession(undefined, { prompt, whenDraftExists: 'append' }) }),
      }, App))
    }

    exports.name = 'dsh-agent-conductor'
    exports.apply = apply
    exports.inject = ['slots', 'locale', 'uiWorkspace']
    return module.exports
  },
})

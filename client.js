// dsh-agent-conductor client half v3:
//  - sidebar nav entry 「⚡ 指挥家」 (DOM-injected next to the task board entry)
//  - floating panel: agent cards with brand icons + install status, dispatch
//    with live feedback (spinner + elapsed), result card, and a recent-runs
//    history fed by /conductor/runs
//  - task-board recycling: every dispatch lands on the dsh task board
//    (localStorage dsh.taskBoard.v1) as a task — running while busy, done /
//    failed when settled, with the result attached to the description — and a
//    synthetic storage event refreshes the board view live in this tab.
window.__ModuleLoader__.load({
  id: 'dsh-agent-conductor',
  factory: function (require) {
    var module = { exports: {} }
    var exports = module.exports
    var React = require('react')
    var R = React

    var BOARD_KEY = 'dsh.taskBoard.v1'

    var state = { open: false, agents: null, loading: false, busy: null, result: null, history: [], error: null }
    var listeners = []
    function emit() { for (var i = 0; i < listeners.length; i += 1) listeners[i]() }
    function subscribe(fn) { listeners.push(fn); return function () { var i = listeners.indexOf(fn); if (i >= 0) listeners.splice(i, 1) } }

    function icon(slug) { return 'https://cdn.simpleicons.org/' + encodeURIComponent(slug) + '/white' }

    // ---------- 任务看板账本 ----------
    function loadLedger() {
      try {
        var raw = localStorage.getItem(BOARD_KEY)
        var parsed = raw ? JSON.parse(raw) : []
        return Array.isArray(parsed) ? parsed : []
      } catch { return [] }
    }
    function saveLedger(tasks) {
      try {
        localStorage.setItem(BOARD_KEY, JSON.stringify(tasks))
        // 同一标签页手动派发 storage 事件：看板监听器收到后立即重载账本。
        try { window.dispatchEvent(new StorageEvent('storage', { key: BOARD_KEY })) } catch { /* 忽略 */ }
      } catch { /* 存储不可用时静默 */ }
    }
    function boardUpsert(run) {
      var tasks = loadLedger()
      var record = null
      for (var i = 0; i < tasks.length; i += 1) {
        if (tasks[i].id === run.id) { record = tasks[i]; break }
      }
      var status = run.status === 'running' ? 'running' : (run.status === 'succeeded' ? 'done' : 'failed')
      var outputSection = run.output ? '\n\n—— 执行结果（' + run.name + '）——\n' + run.output.slice(0, 1500) : ''
      var now = Date.now()
      if (!record) {
        record = {
          id: run.id,
          title: '[' + run.name + '] ' + run.task.slice(0, 24),
          description: run.task + outputSection,
          prompt: run.task,
          status: status,
          createdAt: run.startedAt,
          updatedAt: now,
          executions: [{
            id: run.id,
            startedAt: run.startedAt,
            endedAt: run.endedAt || undefined,
            result: run.status === 'succeeded' ? 'succeeded' : (run.status === 'failed' ? 'failed' : undefined),
            error: run.error || undefined,
          }],
        }
        tasks.push(record)
      } else {
        record.status = status
        record.description = run.task + outputSection
        record.updatedAt = now
        var exec = record.executions && record.executions[0]
        if (exec) {
          exec.endedAt = run.endedAt || exec.endedAt
          exec.result = run.status === 'succeeded' ? 'succeeded' : (run.status === 'failed' ? 'failed' : exec.result)
          exec.error = run.error || exec.error
        }
      }
      saveLedger(tasks)
    }

    // ---------- 数据 ----------
    function loadAgents() {
      state.loading = true
      emit()
      fetch('/conductor/agents')
        .then(function (r) { return r.json() })
        .then(function (d) {
          state.agents = d.agents || []
          state.loading = false
          state.error = null
          emit()
        })
        .catch(function (e) {
          state.loading = false
          state.error = '加载清单失败：' + String(e)
          emit()
        })
    }
    function pollRuns() {
      fetch('/conductor/runs')
        .then(function (r) { return r.json() })
        .then(function (d) {
          var runs = (d.runs || []).slice(0, 8)
          for (var i = 0; i < runs.length; i += 1) boardUpsert(runs[i])
          var old = JSON.stringify(state.history)
          state.history = runs
          if (old !== JSON.stringify(state.history)) emit()
        })
        .catch(function () { /* 轮询失败静默，下一轮再试 */ })
    }
    function dispatch(agentId, task) {
      state.busy = { agent: agentId, startedAt: Date.now() }
      state.result = null
      emit()
      fetch('/conductor/dispatch', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ agent: agentId, task: task }),
      })
        .then(function (r) { return r.json().then(function (d) { return { status: r.status, body: d } }) })
        .then(function (r) {
          state.busy = null
          state.result = r.body.ok
            ? { agent: r.body.agent, text: r.body.text, status: 'succeeded' }
            : { agent: agentId, text: '失败：' + (r.body.error || 'HTTP ' + r.status), status: 'failed' }
          pollRuns()
          emit()
        })
        .catch(function (e) {
          state.busy = null
          state.result = { agent: agentId, text: '失败：' + String(e), status: 'failed' }
          pollRuns()
          emit()
        })
    }
    function openPanel() {
      state.open = true
      emit()
      if (state.agents === null) loadAgents()
      pollRuns()
    }

    // ---------- 样式（硬编码深色，避免主题变量在浮层不解析） ----------
    var s = {
      panel: { position: 'fixed', top: 64, right: 24, width: 430, maxHeight: 'calc(100vh - 96px)', overflow: 'auto',
        background: '#0e1630', border: '1px solid rgba(120,140,200,.35)', borderRadius: 16, padding: 16, zIndex: 2000,
        boxShadow: '0 16px 48px rgba(0,0,0,.6)', color: '#e6e9f5', fontFamily: 'inherit' },
      head: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, fontWeight: 700, fontSize: 15 },
      sub: { fontSize: 11, opacity: .6, fontWeight: 400 },
      close: { marginLeft: 'auto', cursor: 'pointer', background: 'none', border: 'none', color: '#9fb0d8', fontSize: 18, padding: '0 4px' },
      task: { width: '100%', boxSizing: 'border-box', minHeight: 62, borderRadius: 10, border: '1px solid rgba(120,140,200,.35)',
        background: 'rgba(8,12,28,.85)', color: '#e6e9f5', padding: 9, fontSize: 13, resize: 'vertical', outline: 'none', fontFamily: 'inherit' },
      sectionTitle: { fontSize: 11, fontWeight: 700, opacity: .55, margin: '12px 0 6px', letterSpacing: .3 },
      grid: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 },
      card: { background: 'rgba(20,30,62,.9)', border: '1px solid rgba(120,140,200,.22)', borderRadius: 12, padding: 10, display: 'flex', flexDirection: 'column', gap: 6 },
      cardHead: { display: 'flex', alignItems: 'center', gap: 7 },
      cardIcon: { width: 22, height: 22, borderRadius: 6, objectFit: 'contain', background: 'rgba(120,140,200,.18)' },
      cardName: { fontSize: 13, fontWeight: 600, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
      pill: { fontSize: 10, padding: '1px 7px', borderRadius: 8, fontWeight: 600, flex: 'none' },
      pillOn: { background: 'rgba(94,216,130,.22)', color: '#8ee9b0' },
      pillOff: { background: 'rgba(255,199,92,.18)', color: '#f4c266' },
      cmd: { fontSize: 10, opacity: .55, fontFamily: 'ui-monospace, monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
      note: { fontSize: 10, opacity: .5, lineHeight: 1.4, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' },
      btn: { width: '100%', background: '#4D6BFE', border: 'none', color: '#fff', borderRadius: 8, padding: '6px 0', cursor: 'pointer', fontSize: 12, fontWeight: 600 },
      btnOff: { background: 'rgba(120,140,200,.16)', color: '#8fa0c8', cursor: 'not-allowed' },
      feedback: { marginTop: 12, borderRadius: 12, padding: 12, border: '1px solid rgba(120,140,200,.25)', background: 'rgba(20,30,62,.9)' },
      feedbackOk: { borderColor: 'rgba(94,216,130,.5)' },
      feedbackFail: { borderColor: 'rgba(255,120,120,.5)' },
      out: { whiteSpace: 'pre-wrap', fontSize: 12, lineHeight: 1.5, maxHeight: 240, overflow: 'auto', margin: '8px 0 0', color: '#dbe3f8' },
      spin: { display: 'inline-block', width: 12, height: 12, borderRadius: '50%', border: '2px solid rgba(120,140,200,.3)', borderTopColor: '#4D6BFE', animation: 'conductor-spin 0.8s linear infinite', verticalAlign: -2, marginRight: 6 },
      histRow: { display: 'flex', alignItems: 'center', gap: 8, padding: '6px 4px', borderBottom: '1px solid rgba(120,140,200,.12)', fontSize: 12 },
      dot: { width: 8, height: 8, borderRadius: '50%', flex: 'none' },
    }
    var spinKeyframes = '@keyframes conductor-spin{to{transform:rotate(360deg)}}'

    function Elapsed(props) {
      var tick = React.useState(0)[1]
      React.useEffect(function () {
        var id = setInterval(function () { tick(function (t) { return t + 1 }) }, 1000)
        return function () { clearInterval(id) }
      }, [])
      var secs = Math.floor((Date.now() - props.startedAt) / 1000)
      return R.createElement('span', null, secs + 's')
    }

    function AgentCard(props) {
      var agent = props.agent
      var pillStyle = agent.installed ? s.pillOn : s.pillOff
      var busy = state.busy && state.busy.agent === agent.id
      return R.createElement('div', { style: s.card },
        R.createElement('div', { style: s.cardHead },
          R.createElement('img', { src: icon(agent.icon), alt: '', style: s.cardIcon,
            onError: function (e) { e.target.style.visibility = 'hidden' } }),
          R.createElement('span', { style: s.cardName, title: agent.name }, agent.name),
          R.createElement('span', { style: Object.assign({}, s.pill, pillStyle) }, agent.installed ? '已装' : '未装'),
        ),
        R.createElement('div', { style: s.cmd, title: agent.command }, agent.command),
        R.createElement('div', { style: s.note, title: agent.note + ' 安装：' + agent.install }, agent.note),
        R.createElement('button', {
          style: agent.installed ? s.btn : Object.assign({}, s.btn, s.btnOff),
          disabled: !agent.installed || !!state.busy,
          title: agent.installed ? '' : '安装：' + agent.install,
          onClick: function () {
            var el = document.querySelector('[data-conductor-task]')
            var task = el ? el.value : ''
            if (!task.trim()) { el && el.focus(); return }
            dispatch(agent.id, task)
          },
        }, busy ? '干活中…' : (agent.installed ? '派活' : '先安装')),
      )
    }

    function Feedback() {
      if (state.busy) {
        var name = state.busy.agent
        return R.createElement('div', { style: s.feedback },
          R.createElement('span', { style: s.spin }), ' 正在派给 ' + name + '，已耗时 ',
          R.createElement(Elapsed, { startedAt: state.busy.startedAt }),
        )
      }
      if (state.result) {
        var ok = state.result.status === 'succeeded'
        var box = ok ? Object.assign({}, s.feedback, s.feedbackOk) : Object.assign({}, s.feedback, s.feedbackFail)
        return R.createElement('div', { style: box },
          R.createElement('div', { style: { fontSize: 12, fontWeight: 700 } },
            ok ? '✅ ' + state.result.agent + ' 干完了，结果已回收至任务看板' : '❌ ' + state.result.agent + ' 失败了，详情已回收至任务看板'),
          R.createElement('div', { style: s.out }, state.result.text),
        )
      }
      return null
    }

    function HistoryRow(props) {
      var run = props.run
      var color = run.status === 'succeeded' ? '#5ed682' : (run.status === 'failed' ? '#ff7878' : '#f4c266')
      return R.createElement('div', { style: s.histRow },
        R.createElement('span', { style: Object.assign({}, s.dot, { background: color }) }),
        R.createElement('img', { src: icon(run.icon || 'openai'), alt: '', style: { width: 14, height: 14, flex: 'none' },
          onError: function (e) { e.target.style.visibility = 'hidden' } }),
        R.createElement('span', { style: { flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } },
          '[' + run.name + '] ' + run.task.slice(0, 30)),
        R.createElement('span', { style: { fontSize: 10, opacity: .55, flex: 'none' } },
          run.status === 'running' ? '进行中' : (run.status === 'succeeded' ? '完成' : '失败')),
      )
    }

    function Panel() {
      var setTick = React.useState(0)[1]
      React.useEffect(function () {
        return subscribe(function () { setTick(function (t) { return t + 1 }) })
      }, [])
      if (!state.open) return null
      var agents = state.agents
      var installed = agents ? agents.filter(function (a) { return a.installed }).length : 0
      return R.createElement('div', { style: s.panel },
        R.createElement('style', null, spinKeyframes),
        R.createElement('div', { style: s.head },
          '⚡ 指挥家',
          R.createElement('span', { style: s.sub }, agents ? '已装 ' + installed + '/' + agents.length : ''),
          R.createElement('button', { style: s.close, onClick: function () { state.open = false; emit() } }, '×'),
        ),
        R.createElement('textarea', { 'data-conductor-task': '1', style: s.task,
          placeholder: '任务描述（对方看不到本会话上下文）…' }),
        R.createElement('div', { style: s.sectionTitle }, 'AGENT 小队（点击「派活」把上面任务派给它）'),
        state.loading && !agents
          ? R.createElement('div', { style: { fontSize: 12, opacity: .7, padding: 8 } }, '检测已安装的 CLI…')
          : state.error
          ? R.createElement('div', { style: { fontSize: 12, color: '#ff9d9d', padding: 8 } }, state.error)
          : R.createElement('div', { style: s.grid },
              (agents || []).map(function (a) { return R.createElement(AgentCard, { key: a.id, agent: a }) })),
        R.createElement(Feedback, null),
        R.createElement('div', { style: s.sectionTitle }, '最近派活（与任务看板同步）'),
        state.history.length === 0
          ? R.createElement('div', { style: { fontSize: 11, opacity: .5, padding: '4px 0 2px' } }, '还没有派活记录')
          : state.history.map(function (r) { return R.createElement(HistoryRow, { key: r.id, run: r }) }),
        R.createElement('div', { style: { fontSize: 10, opacity: .45, marginTop: 10, lineHeight: 1.5 } },
          '每笔派活都会以卡片形式回收进「任务看板」（进行中 → 完成/失败，结果附在卡片详情里）。消耗对应 CLI 的登录额度；也可以在聊天里说「用 conductor_dispatch 派 codex 干…」。'),
      )
    }

    // ---------- 侧边栏导航入口（照任务看板的 DOM 注入方式） ----------
    var navMounted = false
    function mountNavEntry() {
      if (navMounted || typeof document === 'undefined') return
      var sidebar = document.querySelector('[data-pane="sidebar"], [class*="sidebarCol"]')
      var taskboard = document.querySelector('[data-dsh-taskboard-entry]')
      var anchor = taskboard || document.querySelector('button[class*="newSession"]')
      if (!sidebar || !anchor) return
      var entry = document.createElement('div')
      entry.setAttribute('data-conductor-entry', '1')
      entry.style.cssText = 'display:flex;align-items:center;gap:10px;width:100%;padding:7px 10px;border-radius:8px;cursor:pointer;color:var(--dsw-alias-label-primary);font-size:13px;font-weight:500;box-sizing:border-box;user-select:none'
      entry.onmouseenter = function () { entry.style.background = 'var(--dsw-alias-interactive-bg-hover)' }
      entry.onmouseleave = function () { entry.style.background = '' }
      entry.onclick = function () { openPanel() }
      var iconEl = document.createElement('span')
      iconEl.textContent = '⚡'
      iconEl.style.cssText = 'flex:none;font-size:15px;line-height:1'
      var label = document.createElement('span')
      label.textContent = '指挥家'
      label.style.cssText = 'flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap'
      entry.appendChild(iconEl)
      entry.appendChild(label)
      anchor.parentElement.insertBefore(entry, anchor.nextSibling)
      navMounted = true
    }
    var navObserver = new MutationObserver(function () {
      if (!navMounted) {
        mountNavEntry()
      } else if (!document.querySelector('[data-conductor-entry]')) {
        navMounted = false
        mountNavEntry()
      }
    })

    function apply(ctx) {
      var slots = ctx.get('slots')
      if (slots === undefined) { console.error('[conductor] slots service missing'); return }

      slots.inject('sidebar.footer.action', function () {
        return slots.register(
          { name: 'sidebar.footer.action', id: 'conductor-open', order: 800, label: '指挥家' },
          function () {
            return R.createElement('button', {
              style: { background: 'none', border: 'none', cursor: 'pointer', fontSize: 15, color: 'inherit', padding: 4 },
              title: '指挥家：把活派给别的 agent CLI',
              onClick: function () { openPanel() },
            }, '⚡')
          },
        )
      })

      slots.inject('shell.overlay', function () {
        return slots.register(
          { name: 'shell.overlay', id: 'conductor-panel', order: 10, label: '指挥家面板' },
          function () { return R.createElement(Panel) },
        )
      })

      mountNavEntry()
      navObserver.observe(document.body, { childList: true, subtree: true })
      var pollTimer = setInterval(function () {
        if (state.open || state.busy) pollRuns()
      }, 4000)

      ctx.effect(function () {
        return function () {
          navObserver.disconnect()
          clearInterval(pollTimer)
          var entry = document.querySelector('[data-conductor-entry]')
          if (entry) entry.remove()
          navMounted = false
        }
      }, 'conductor: client side effects')
    }

    exports.apply = apply
    exports.inject = []
    return module.exports
  },
})

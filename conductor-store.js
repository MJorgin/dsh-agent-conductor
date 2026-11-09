/**
 * Host-side run registry for the 大肥鱼指挥官 panel.
 *
 * The conductor bundle keeps one registry per host plugin instance: every
 * `conductor_dispatch` execution gets a run record, live stdout/stderr tails
 * are copied in while the child runs, and finished runs roll into a bounded
 * history (default 50, configurable in the panel). The panel reads this
 * registry over the same-origin `/conductor` prefix route.
 *
 * This module is intentionally free of harness imports so it can be unit
 * tested with plain Node.
 */

export const DEFAULT_HISTORY_LIMIT = 50
export const MAX_HISTORY_LIMIT = 200
export const MIN_HISTORY_LIMIT = 1

/** Collapse whitespace so one run can render inside a one-line card. */
const TASK_PREVIEW_CHARS = 180
const ERROR_PREVIEW_CHARS = 300
/** Bytes of each stream kept per run; the panel shows the tail. */
const ROLLING_OUTPUT_CHARS = 4_000
const VIEW_OUTPUT_CHARS = 1_600
const VIEW_STDERR_CHARS = 800
const DETAIL_OUTPUT_CHARS = 4_000
const DETAIL_STDERR_CHARS = 4_000
// Retain room for both a start and a finish for each configurable history row.
const MAX_EVENTS = MAX_HISTORY_LIMIT * 2

const FINAL_STATUSES = new Set(['done', 'failed', 'cancelled', 'timeout'])

// Only the fields required to identify and summarize a completed run are
// stored on disk. Full command arguments and output may contain credentials.
function persistable(run) {
  return {
    id: run.id, agentId: run.agentId, agentName: run.agentName,
    taskPreview: run.taskPreview, taskLength: run.taskLength, cwd: run.cwd.slice(0, 4096),
    status: run.status, startedAt: run.startedAt, endedAt: run.endedAt,
    exitCode: run.exitCode, outputChars: run.outputChars, error: run.error,
  }
}

function restoreRun(value) {
  if (!value || typeof value !== 'object' || !/^crew-\d{1,12}$/.test(value.id)
      || !FINAL_STATUSES.has(value.status)
      || !Number.isFinite(value.startedAt) || !Number.isFinite(value.endedAt)
      || value.startedAt < 0 || value.endedAt < value.startedAt) return null
  const count = (n) => Number.isSafeInteger(n) && n >= 0 ? n : 0
  return {
    id: value.id, agentId: preview(value.agentId, 80), agentName: preview(value.agentName, 120),
    taskPreview: preview(value.taskPreview, TASK_PREVIEW_CHARS), taskLength: count(value.taskLength),
    cwd: typeof value.cwd === 'string' ? value.cwd.slice(0, 4096) : '',
    status: value.status, startedAt: value.startedAt, endedAt: value.endedAt,
    exitCode: Number.isSafeInteger(value.exitCode) ? value.exitCode : null,
    outputChars: count(value.outputChars), error: preview(value.error, ERROR_PREVIEW_CHARS) || null,
    argv: [], stdout: '', stderr: '', cancelRequested: false, cancel: null, lastOutputAt: null,
  }
}

function preview(text, max) {
  if (typeof text !== 'string') return ''
  const flat = text.replace(/\s+/g, ' ').trim()
  if (flat === '') return ''
  return flat.length <= max ? flat : `${flat.slice(0, Math.max(0, max - 1))}…`
}

function tailText(text, max) {
  if (typeof text !== 'string' || text === '') return ''
  return text.length <= max ? text : text.slice(-max)
}

/** Accept a user-entered limit; returns null when it is not a sane integer. */
export function normalizeHistoryLimit(value) {
  const n = Number(value)
  if (!Number.isFinite(n)) return null
  const int = Math.floor(n)
  if (int < MIN_HISTORY_LIMIT) return null
  return Math.min(int, MAX_HISTORY_LIMIT)
}

/**
 * @param {object} [options]
 * @param {number} [options.historyLimit]  initial retained-run count
 * @param {() => number} [options.now]     injectable clock (tests)
 * @param {object[]} [options.history]     previously completed run summaries
 * @param {(history: object[], limit: number) => void} [options.onHistoryChange]
 */
export function createRunStore(options = {}) {
  const now = typeof options.now === 'function' ? options.now : () => Date.now()
  let historyLimit = normalizeHistoryLimit(options.historyLimit) ?? DEFAULT_HISTORY_LIMIT
  let seq = 0
  const active = new Map()
  const history = []
  const events = []

  if (Array.isArray(options.history)) {
    const seen = new Set()
    // Bound work even when the saved file has been externally modified.
    for (const candidate of options.history.slice(0, MAX_HISTORY_LIMIT)) {
      const run = restoreRun(candidate)
      if (!run || seen.has(run.id)) continue
      seen.add(run.id)
      seq = Math.max(seq, Number(run.id.slice(5)))
      history.push(run)
      if (history.length >= historyLimit) break
    }
    // The UI reads events oldest-first and reverses them for its log. Restore a
    // single completion event per persisted run; running processes do not survive
    // a host restart and are deliberately never resurrected.
    for (const run of [...history].reverse()) {
      events.push({
        type: run.status, runId: run.id, agentId: run.agentId,
        agentName: run.agentName, taskPreview: run.taskPreview, at: run.endedAt,
        durationMs: run.endedAt - run.startedAt, exitCode: run.exitCode,
      })
    }
  }

  function exportHistory() { return history.map(persistable) }
  function persistHistory() {
    if (typeof options.onHistoryChange === 'function') options.onHistoryChange(exportHistory(), historyLimit)
  }

  function pushEvent(event) {
    events.push(event)
    if (events.length > MAX_EVENTS) events.splice(0, events.length - MAX_EVENTS)
  }

  function trimHistory() {
    if (history.length > historyLimit) history.length = historyLimit
  }

  function toView(run, detail = false) {
    const endedAt = run.endedAt
    const view = {
      id: run.id,
      agentId: run.agentId,
      agentName: run.agentName,
      taskPreview: run.taskPreview,
      taskLength: run.taskLength,
      cwd: run.cwd,
      status: run.status,
      startedAt: run.startedAt,
      endedAt,
      durationMs: endedAt === null ? null : Math.max(0, endedAt - run.startedAt),
      exitCode: run.exitCode,
      outputChars: run.outputChars,
      outputTail: tailText(run.stdout, detail ? DETAIL_OUTPUT_CHARS : VIEW_OUTPUT_CHARS),
      stderrTail: tailText(run.stderr, detail ? DETAIL_STDERR_CHARS : VIEW_STDERR_CHARS),
      error: run.error,
      cancelRequested: run.cancelRequested,
      lastOutputAt: run.lastOutputAt,
    }
    if (detail) view.argv = run.argv
    return view
  }

  function begin(init) {
    const startedAt = now()
    const task = typeof init?.task === 'string' ? init.task : ''
    const run = {
      id: `crew-${String(++seq).padStart(3, '0')}`,
      agentId: typeof init?.agentId === 'string' ? init.agentId : '',
      agentName: typeof init?.agentName === 'string' ? init.agentName : '',
      taskPreview: preview(task, TASK_PREVIEW_CHARS),
      taskLength: task.length,
      cwd: typeof init?.cwd === 'string' ? init.cwd : '',
      argv: Array.isArray(init?.argv) ? init.argv.slice() : [],
      status: 'running',
      startedAt,
      endedAt: null,
      exitCode: null,
      outputChars: 0,
      stdout: '',
      stderr: '',
      lastOutputAt: null,
      error: null,
      cancelRequested: false,
      cancel: null,
    }
    active.set(run.id, run)
    pushEvent({
      type: 'start',
      runId: run.id,
      agentId: run.agentId,
      agentName: run.agentName,
      taskPreview: run.taskPreview,
      at: startedAt,
    })
    return run
  }

  function setArgv(runId, argv) {
    const run = active.get(runId)
    if (run && Array.isArray(argv)) run.argv = argv.slice()
  }

  function noteOutput(runId, stream, text) {
    const run = active.get(runId)
    if (!run || typeof text !== 'string' || text === '') return
    if (stream === 'stderr') {
      run.stderr = (run.stderr + text).slice(-ROLLING_OUTPUT_CHARS)
      run.lastOutputAt = now()
      return
    }
    run.outputChars += text.length
    run.stdout = (run.stdout + text).slice(-ROLLING_OUTPUT_CHARS)
    run.lastOutputAt = now()
  }

  /** Bind the host process-tree kill switch so the panel can terminate a run. */
  function attachCancel(runId, cancel) {
    const run = active.get(runId)
    if (!run || typeof cancel !== 'function') return
    run.cancel = cancel
    // The panel may have pressed 终止 between spawn and attach.
    if (run.cancelRequested) cancel()
  }

  function requestCancel(runId) {
    const run = active.get(runId)
    if (!run) return { ok: false, message: '这条战报已经结束，或不存在。' }
    if (run.cancelRequested) return { ok: true, message: `已经在终止 ${run.agentName}，稍等片刻。` }
    run.cancelRequested = true
    try {
      run.cancel?.()
    } catch { /* teardown is best-effort; the exit path settles the record */ }
    return { ok: true, message: `已发送终止信号：${run.agentName}` }
  }

  /**
   * Settle a run exactly once. Later calls for the same id are no-ops, which
   * keeps the tool error path ("spawn failed" → "exit code" → "timeout") safe.
   */
  function finish(runId, status, extra = {}) {
    if (!FINAL_STATUSES.has(status)) throw new Error(`unknown run status: ${status}`)
    const run = active.get(runId)
    if (!run) return null
    active.delete(runId)
    run.cancel = null
    run.status = status
    run.endedAt = Math.max(run.startedAt, now())
    if (typeof extra.exitCode === 'number') run.exitCode = extra.exitCode
    run.error = extra.error === undefined ? null : preview(String(extra.error), ERROR_PREVIEW_CHARS)
    history.unshift(run)
    trimHistory()
    persistHistory()
    pushEvent({
      type: status,
      runId: run.id,
      agentId: run.agentId,
      agentName: run.agentName,
      taskPreview: run.taskPreview,
      at: run.endedAt,
      durationMs: Math.max(0, run.endedAt - run.startedAt),
      exitCode: run.exitCode,
    })
    return toView(run)
  }

  function find(id) {
    if (typeof id !== 'string' || id === '') return null
    return active.get(id) ?? history.find((run) => run.id === id) ?? null
  }

  function detail(id) {
    const run = find(id)
    if (!run) return { ok: false, message: '这条战报不存在，可能已被清理。' }
    return { ok: true, now: now(), run: toView(run, true) }
  }

  function setHistoryLimit(value) {
    const next = normalizeHistoryLimit(value)
    if (next === null) {
      throw new Error(`保留条数需为 ${MIN_HISTORY_LIMIT}–${MAX_HISTORY_LIMIT} 的整数。`)
    }
    historyLimit = next
    trimHistory()
    persistHistory()
    return historyLimit
  }

  function snapshot() {
    const tally = { active: active.size, done: 0, failed: 0, cancelled: 0, timeout: 0 }
    for (const run of history) {
      if (run.status in tally && run.status !== 'active') tally[run.status] += 1
    }
    return {
      ok: true,
      now: now(),
      settings: { historyLimit },
      active: [...active.values()].map((run) => toView(run)),
      history: history.map((run) => toView(run)),
      events: events.slice(),
      stats: { ...tally, total: history.length },
    }
  }

  return {
    begin,
    setArgv,
    noteOutput,
    attachCancel,
    requestCancel,
    finish,
    detail,
    snapshot,
    setHistoryLimit,
    exportHistory,
    getHistoryLimit: () => historyLimit,
  }
}

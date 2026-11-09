// Unit tests for the host-side run registry that feeds the 大肥鱼指挥官 panel.

import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  createRunStore,
  normalizeHistoryLimit,
  DEFAULT_HISTORY_LIMIT,
  MAX_HISTORY_LIMIT,
  MIN_HISTORY_LIMIT,
} from '../conductor-store.js'

test('normalizeHistoryLimit accepts sane integers and clamps the upper bound', () => {
  assert.equal(normalizeHistoryLimit(50), 50)
  assert.equal(normalizeHistoryLimit('7'), 7)
  assert.equal(normalizeHistoryLimit(1), MIN_HISTORY_LIMIT)
  assert.equal(normalizeHistoryLimit(1.9), 1)
  assert.equal(normalizeHistoryLimit(MAX_HISTORY_LIMIT + 1), MAX_HISTORY_LIMIT)
  assert.equal(normalizeHistoryLimit(0), null)
  assert.equal(normalizeHistoryLimit(-3), null)
  assert.equal(normalizeHistoryLimit('abc'), null)
  assert.equal(normalizeHistoryLimit(undefined), null)
  assert.equal(normalizeHistoryLimit(NaN), null)
})

test('begin/noteOutput/finish produce a bounded, truthful run view', () => {
  let clock = 1_000
  const store = createRunStore({ historyLimit: 2, now: () => clock })
  const run = store.begin({
    agentId: 'codex',
    agentName: 'Codex',
    task: '  do   the thing\nplease ',
    cwd: '/tmp/work',
    argv: ['codex', 'exec', 'do the thing'],
  })
  assert.equal(run.id, 'crew-001')

  let snapshot = store.snapshot()
  assert.equal(snapshot.ok, true)
  assert.equal(snapshot.active.length, 1)
  assert.equal(snapshot.active[0].status, 'running')
  assert.equal(snapshot.active[0].taskPreview, 'do the thing please')
  assert.equal(snapshot.active[0].durationMs, null)
  assert.equal(snapshot.active[0].argv, undefined, 'argv is detail-only')
  assert.equal(snapshot.history.length, 0)

  store.noteOutput(run.id, 'stdout', 'hello ')
  store.noteOutput(run.id, 'stdout', 'world')
  store.noteOutput(run.id, 'stderr', 'warning: low tide')
  store.setArgv(run.id, ['/opt/codex', 'exec', 'do the thing'])

  clock = 3_500
  store.finish(run.id, 'done', { exitCode: 0 })

  snapshot = store.snapshot()
  assert.equal(snapshot.active.length, 0)
  assert.equal(snapshot.history.length, 1)
  const view = snapshot.history[0]
  assert.equal(view.status, 'done')
  assert.equal(view.durationMs, 2_500)
  assert.equal(view.outputChars, 11)
  assert.equal(view.outputTail, 'hello world')
  assert.equal(view.stderrTail, 'warning: low tide')
  assert.equal(view.exitCode, 0)
  assert.equal(snapshot.stats.done, 1)
  assert.equal(snapshot.stats.total, 1)
  assert.deepEqual(snapshot.events.map((event) => event.type), ['start', 'done'])

  const detail = store.detail(run.id)
  assert.equal(detail.ok, true)
  assert.deepEqual(detail.run.argv, ['/opt/codex', 'exec', 'do the thing'])

  // Settling twice is a no-op, which keeps the tool error paths idempotent.
  assert.equal(store.finish(run.id, 'failed'), null)
  assert.equal(store.snapshot().history.length, 1)
})

test('output buffers stay bounded while outputChars keeps the true length', () => {
  const store = createRunStore()
  const run = store.begin({ agentId: 'claude-code', agentName: 'Claude Code', task: 'long' })
  const chunk = 'x'.repeat(8_192)
  for (let index = 0; index < 20; index += 1) store.noteOutput(run.id, 'stdout', chunk)
  store.noteOutput(run.id, 'stderr', 'e'.repeat(9_000))
  const view = store.snapshot().active[0]
  assert.equal(view.outputChars, 163_840)
  assert.equal(view.outputTail.length, 1_600)
  assert.equal(view.stderrTail.length, 800)
  const detail = store.detail(run.id).run
  assert.equal(detail.outputTail.length, 4_000)
  assert.equal(detail.stderrTail.length, 4_000)
})

test('history keeps the newest N runs and drops the rest', () => {
  let clock = 0
  const store = createRunStore({ historyLimit: 2, now: () => clock })
  for (let index = 1; index <= 5; index += 1) {
    const run = store.begin({ agentId: 'codex', agentName: 'Codex', task: `task ${index}` })
    clock += 10
    store.finish(run.id, 'done', { exitCode: 0 })
  }
  const snapshot = store.snapshot()
  assert.equal(snapshot.history.length, 2)
  assert.deepEqual(snapshot.history.map((run) => run.taskPreview), ['task 5', 'task 4'])
  assert.equal(snapshot.stats.total, 2)
  assert.equal(snapshot.events.filter((event) => event.type === 'start').length, 5)
  assert.equal(snapshot.events.filter((event) => event.type === 'done').length, 5)
})

test('cancel requests reach the kill switch once and are visible in the view', () => {
  const store = createRunStore()
  const run = store.begin({ agentId: 'opencode', agentName: 'OpenCode', task: 'hang' })
  let calls = 0
  store.attachCancel(run.id, () => { calls += 1 })
  const first = store.requestCancel(run.id)
  assert.equal(first.ok, true)
  assert.equal(calls, 1)
  assert.equal(store.snapshot().active[0].cancelRequested, true)
  const second = store.requestCancel(run.id)
  assert.equal(second.ok, true)
  assert.equal(calls, 1, 'repeat presses do not re-kill')
  store.finish(run.id, 'cancelled')
  assert.equal(store.requestCancel(run.id).ok, false)
  assert.equal(store.detail(run.id).run.status, 'cancelled')
})

test('a cancel requested before attach fires as soon as the switch is bound', () => {
  const store = createRunStore()
  const run = store.begin({ agentId: 'gemini', agentName: 'Gemini CLI', task: 'race' })
  // No run.cancel bound yet, so the first request just records the intent.
  assert.equal(store.requestCancel(run.id).ok, true)
  let killed = 0
  store.attachCancel(run.id, () => { killed += 1 })
  assert.equal(killed, 1)
})

test('detail and limit handling: unknown ids and invalid limits are guarded', () => {
  const store = createRunStore()
  assert.equal(store.detail('crew-nope').ok, false)
  assert.equal(store.detail('').ok, false)
  assert.equal(store.getHistoryLimit(), DEFAULT_HISTORY_LIMIT)
  assert.equal(store.setHistoryLimit(9), 9)
  assert.equal(store.getHistoryLimit(), 9)
  assert.throws(() => store.setHistoryLimit(0), /保留条数/)
  assert.equal(store.setHistoryLimit(MAX_HISTORY_LIMIT + 1), MAX_HISTORY_LIMIT)
  assert.throws(() => store.setHistoryLimit('nope'), /保留条数/)
})

test('restored data is validated, limited, and cannot resurrect running processes', () => {
  const valid = {
    id: 'crew-007', agentId: 'codex', agentName: 'Codex', taskPreview: 'a'.repeat(300),
    taskLength: 300, cwd: '/x'.repeat(3000), status: 'done', startedAt: 1, endedAt: 2,
    exitCode: 0, outputChars: 5, stdout: 'private', argv: ['secret'],
  }
  const store = createRunStore({ historyLimit: 2, history: [
    { ...valid, status: 'running' }, valid, valid,
    { ...valid, id: 'crew-008', status: 'failed' },
    { ...valid, id: 'crew-009', status: 'done' },
  ] })
  const snapshot = store.snapshot()
  assert.equal(snapshot.active.length, 0)
  assert.deepEqual(snapshot.history.map((run) => run.id), ['crew-007', 'crew-008'])
  assert.equal(snapshot.history[0].taskPreview.length, 180)
  assert.equal(snapshot.history[0].cwd.length, 4096)
  assert.equal(store.detail('crew-007').run.outputTail, '')
  assert.deepEqual(store.detail('crew-007').run.argv, [])
  assert.deepEqual(snapshot.events.map((event) => event.runId), ['crew-008', 'crew-007'])
  assert.equal(store.begin({ task: 'new' }).id, 'crew-009')
})

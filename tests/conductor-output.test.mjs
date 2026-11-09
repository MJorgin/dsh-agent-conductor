// Regression tests for the conductor_dispatch output buffer + host integration.
//
// Bug (issue #3): the stdout handler stopped appending at 2 × MAX_OUTPUT_CHARS,
// so a long CLI transcript was truncated to its first ~40k characters before
// clipping. Since agent CLIs print their final answer last, the "tail" of the
// clipped result was the middle of the real output — the answer was lost.
//
// The fix keeps the first MAX_OUTPUT_CHARS characters, a rolling window of the
// true last characters, and the real total length. These tests stream a long
// transcript through both the bundle handler (index.js) and the dynamic-plugin
// handler (conductor-dynamic.js) with a fake subprocess service.

import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const MAX_OUTPUT_CHARS = 20_000
const HEAD_CHARS = Math.floor(MAX_OUTPUT_CHARS * 0.7)
const TAIL_CHARS = Math.floor(MAX_OUTPUT_CHARS * 0.25)
const LOADERS = [
  ['bundle', () => loadIndexTool()],
  ['dynamic plugin', () => loadDynamicTool()],
]

const indexModule = await import(pathToFileURL(join(ROOT, 'index.js')).href)

function chunkify(text, size = 4096) {
  const chunks = []
  for (let i = 0; i < text.length; i += size) chunks.push(text.slice(i, i + size))
  return chunks
}

/** Minimal stand-in for the host `subprocess` service. */
function fakeSubprocess(chunks, { exitCode = 0, stderr = '', resolveExecutable } = {}) {
  const service = {
    spawn(spec) {
      service.spec = spec
      const stdout = new EventEmitter()
      const stderrStream = new EventEmitter()
      let resolveDone
      const done = new Promise((resolve) => { resolveDone = resolve })
      const child = {
        stdout,
        stderr: stderrStream,
        stdin: { end() {} },
        terminate() {},
        done,
      }
      setImmediate(() => {
        for (const chunk of chunks) stdout.emit('data', Buffer.from(chunk))
        if (stderr !== '') stderrStream.emit('data', Buffer.from(stderr))
        resolveDone({ exitCode })
      })
      return child
    },
  }
  if (resolveExecutable !== undefined) {
    service.resolveExecutable = async () => {
      if (resolveExecutable instanceof Error) throw resolveExecutable
      return resolveExecutable
    }
  }
  return service
}

function makeContext() {
  const state = { subprocess: undefined, tool: undefined }
  const ctx = {
    get: (name) => (name === 'subprocess' ? state.subprocess : undefined),
    tools: { register(tool) { state.tool = tool } },
  }
  return { state, ctx }
}

function loadIndexTool() {
  const { state, ctx } = makeContext()
  indexModule.apply(ctx)
  assert.ok(state.tool, 'index.js should register conductor_dispatch')
  return { state, tool: state.tool }
}

function loadDynamicTool() {
  const source = readFileSync(join(ROOT, 'conductor-dynamic.js'), 'utf8')
  const harness = {
    defineTool: (tool) => tool,
    registerTool: (_ctx, tool) => { harness.tool = tool },
  }
  // The dynamic plugin ships as a function body that returns the plugin.
  const plugin = new Function('harness', source)(harness)
  const { state, ctx } = makeContext()
  plugin.apply(ctx)
  assert.ok(harness.tool, 'conductor-dynamic.js should register conductor_dispatch')
  return { state, tool: harness.tool }
}

async function dispatch({ state, tool }, payload, opts = {}) {
  state.subprocess = fakeSubprocess(chunkify(payload), opts)
  return tool.execute(
    { agent: 'codex', task: 'review the patch' },
    { agent: {}, signal: undefined },
  )
}

const EXEC = { agent: {}, signal: undefined }

function runTool(loader, payload, opts = {}, args = { agent: 'codex', task: 'review the patch' }) {
  const { state, tool } = loader()
  state.subprocess = fakeSubprocess(chunkify(payload), opts)
  return tool.execute(args, EXEC)
}

const LONG_MARKER = '\nFINAL ANSWER: implementation complete. Tests: 42 passed.'

function longTranscript() {
  return 'HEAD: first line of the transcript\n' + 'x'.repeat(300_000) + LONG_MARKER
}

function assertLongTranscriptPreserved(output, payload) {
  const omitted = payload.length - HEAD_CHARS - TAIL_CHARS
  assert.ok(output.startsWith(payload.slice(0, HEAD_CHARS)), 'head must be kept')
  assert.ok(output.endsWith(payload.slice(-TAIL_CHARS)), 'true tail must be kept')
  assert.ok(output.includes('FINAL ANSWER'), 'the CLI’s final answer must survive')
  assert.ok(output.includes('output truncated'), 'elision marker must be present')
  assert.ok(output.includes(`已省略中间 ${omitted} 字符`), 'omitted count must use the true total')
  assert.ok(output.length <= MAX_OUTPUT_CHARS + 120, `clipped result too long: ${output.length}`)
}

for (const [label, loader] of LOADERS) {
  test(`${label}: long output keeps the true tail instead of the middle`, async () => {
    const payload = longTranscript()
    assertLongTranscriptPreserved(await dispatch(loader(), payload), payload)
  })

  test(`${label}: output under the cap is returned in full`, async () => {
    const payload = 'line one\nline two\n' + 'y'.repeat(15_000)
    assert.equal(await dispatch(loader(), payload), payload)
  })

  test(`${label}: output exactly at the cap is not clipped`, async () => {
    const payload = 'z'.repeat(MAX_OUTPUT_CHARS)
    const output = await dispatch(loader(), payload)
    assert.equal(output.length, MAX_OUTPUT_CHARS)
    assert.ok(!output.includes('output truncated'))
  })

  test(`${label}: exit-code errors still surface stderr with huge stdout`, async () => {
    const { state, tool } = loader()
    state.subprocess = fakeSubprocess(chunkify('x'.repeat(200_000)), {
      exitCode: 1,
      stderr: 'boom: not logged in',
    })
    await assert.rejects(
      tool.execute({ agent: 'codex', task: 't' }, EXEC),
      /退出码 1：boom: not logged in/,
    )
  })

  test(`${label}: whitespace-only stderr falls back to stdout in the error`, async () => {
    const { state, tool } = loader()
    state.subprocess = fakeSubprocess(chunkify('REAL STDOUT ERROR: quota exhausted'), {
      exitCode: 3,
      stderr: ' \n\t\n',
    })
    await assert.rejects(
      tool.execute({ agent: 'codex', task: 't' }, EXEC),
      /退出码 3：REAL STDOUT ERROR: quota exhausted/,
    )
  })

  test(`${label}: long stderr keeps the real trailing error`, async () => {
    const { state, tool } = loader()
    const warnings = 'warning: deprecated flag\n'.repeat(1_000)
    state.subprocess = fakeSubprocess(chunkify('x'), {
      exitCode: 2,
      stderr: warnings + 'REAL ERROR: auth expired\n',
    })
    await assert.rejects(tool.execute({ agent: 'codex', task: 't' }, EXEC), (error) => {
      assert.match(error.message, /退出码 2/)
      assert.match(error.message, /REAL ERROR: auth expired/, 'the trailing error must survive')
      assert.match(error.message, /…/, 'long diagnostics are elided in the middle')
      return true
    })
  })

  test(`${label}: host-resolved executable is used for spawn`, async () => {
    const { state, tool } = loader()
    state.subprocess = fakeSubprocess(chunkify('done'), {
      resolveExecutable: '/opt/shims/claude-code',
    })
    const output = await tool.execute({ agent: 'claude-code', task: 'hello' }, EXEC)
    assert.equal(output, 'done')
    assert.equal(state.subprocess.spec.argv[0], '/opt/shims/claude-code')
    assert.equal(state.subprocess.spec.argv[1], '-p')
  })

  test(`${label}: dry-run previews the host-resolved executable`, async () => {
    const { state, tool } = loader()
    state.subprocess = fakeSubprocess([], { resolveExecutable: '/opt/shims/claude-code' })
    const preview = await tool.execute(
      { agent: 'claude-code', task: 'hello', dryRun: true },
      EXEC,
    )
    assert.ok(preview.includes('/opt/shims/claude-code'), preview)
  })

  test(`${label}: unresolved executable reports the install hint`, async () => {
    const { state, tool } = loader()
    state.subprocess = fakeSubprocess([], { resolveExecutable: new Error('not found on PATH') })
    await assert.rejects(
      tool.execute({ agent: 'codex', task: 't' }, EXEC),
      /Codex 未安装（或不在 PATH）/,
    )
  })

  test(`${label}: CONDUCTOR_CODEX_MODEL is inserted before the task`, async () => {
    const previous = process.env.CONDUCTOR_CODEX_MODEL
    process.env.CONDUCTOR_CODEX_MODEL = 'gpt-5-codex'
    try {
      const { state, tool } = loader()
      state.subprocess = fakeSubprocess(chunkify('done'))
      await tool.execute({ agent: 'codex', task: 'do the thing' }, EXEC)
      assert.deepEqual(
        state.subprocess.spec.argv.slice(0, 5),
        ['codex', 'exec', '-m', 'gpt-5-codex', 'do the thing'],
      )
    } finally {
      if (previous === undefined) delete process.env.CONDUCTOR_CODEX_MODEL
      else process.env.CONDUCTOR_CODEX_MODEL = previous
    }
  })

  test(`${label}: clipping never splits a surrogate pair`, async () => {
    const emoji = '😀'
    const payload = 'a'.repeat(HEAD_CHARS - 1) + emoji
      + 'b'.repeat(200_000)
      + emoji + 'c'.repeat(TAIL_CHARS - 1)
    const output = await dispatch(loader(), payload)
    assert.ok(!/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/.test(output), 'no lone high surrogate')
    assert.ok(!/(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(output), 'no lone low surrogate')
    assert.ok(output.endsWith(payload.slice(-(TAIL_CHARS - 1))), 'tail after the dropped half is kept')
  })
}

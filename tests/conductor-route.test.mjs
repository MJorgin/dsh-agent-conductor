// Tests for the same-origin /conductor JSON route that feeds the panel.

import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const { createConductorHandler } = await import(pathToFileURL(join(ROOT, 'index.js')).href)
const { createRunStore } = await import(pathToFileURL(join(ROOT, 'conductor-store.js')).href)

const HOST = '127.0.0.1:56109'

function makeReq({ method = 'GET', url = '/', headers = {}, body = null } = {}) {
  return {
    method,
    url,
    headers,
    async *[Symbol.asyncIterator]() {
      if (body !== null) yield Buffer.from(body)
    },
  }
}

function makeRes() {
  const res = {
    statusCode: null,
    headers: null,
    body: null,
    writeHead(status, headers) {
      res.statusCode = status
      res.headers = headers
    },
    end(body) {
      res.body = body
    },
  }
  return res
}

async function hit(handler, options) {
  const req = makeReq(options)
  const res = makeRes()
  await handler(req, res)
  let json = null
  if (typeof res.body === 'string' && res.body !== '') {
    try { json = JSON.parse(res.body) } catch { json = null }
  }
  return { status: res.statusCode, headers: res.headers, json }
}

function makeHandler(extra = {}) {
  const store = extra.store ?? createRunStore()
  const handler = createConductorHandler({
    store,
    version: '0.4.0-test',
    agents: [{ id: 'codex', name: 'Codex' }],
  })
  return { store, handler }
}

test('GET /conductor/state returns the registry snapshot', async () => {
  const { store, handler } = makeHandler()
  const run = store.begin({ agentId: 'codex', agentName: 'Codex', task: 'inspect the reef' })
  const { status, headers, json } = await hit(handler, { url: '/conductor/state', headers: { host: HOST } })
  assert.equal(status, 200)
  assert.equal(headers['content-type'], 'application/json; charset=utf-8')
  assert.equal(headers['cache-control'], 'no-store')
  assert.equal(json.ok, true)
  assert.equal(json.version, '0.4.0-test')
  assert.equal(json.agents.length, 1)
  assert.equal(json.active.length, 1)
  assert.equal(json.active[0].id, run.id)
  store.finish(run.id, 'done')
})

test('the route refuses cross-site callers and bad origins', async () => {
  const { handler } = makeHandler()
  const crossSite = await hit(handler, {
    url: '/conductor/state',
    headers: { host: HOST, origin: 'https://evil.example' },
  })
  assert.equal(crossSite.status, 403)
  assert.equal(crossSite.json.ok, false)

  const noHost = await hit(handler, { url: '/conductor/state', headers: {} })
  assert.equal(noHost.status, 403)

  const malformed = await hit(handler, {
    url: '/conductor/state',
    headers: { host: HOST, referer: 'not a url' },
  })
  assert.equal(malformed.status, 403)

  const sameOrigin = await hit(handler, {
    url: '/conductor/state',
    headers: { host: HOST, origin: `http://${HOST}` },
  })
  assert.equal(sameOrigin.status, 200)
})

test('GET /conductor/run serves detail and 404s unknown ids', async () => {
  const { store, handler } = makeHandler()
  const run = store.begin({
    agentId: 'codex',
    agentName: 'Codex',
    task: 'deep dive',
    cwd: '/tmp/reef',
    argv: ['codex', 'exec', 'deep dive'],
  })
  store.noteOutput(run.id, 'stdout', 'FINAL ANSWER')
  store.finish(run.id, 'done', { exitCode: 0 })

  const found = await hit(handler, {
    url: `/conductor/run?id=${encodeURIComponent(run.id)}`,
    headers: { host: HOST },
  })
  assert.equal(found.status, 200)
  assert.equal(found.json.ok, true)
  assert.equal(found.json.run.id, run.id)
  assert.deepEqual(found.json.run.argv, ['codex', 'exec', 'deep dive'])
  assert.match(found.json.run.outputTail, /FINAL ANSWER/)

  const missing = await hit(handler, {
    url: '/conductor/run?id=crew-nope',
    headers: { host: HOST },
  })
  assert.equal(missing.status, 404)
  assert.equal(missing.json.ok, false)
})

test('POST /conductor/cancel reaches the run kill switch', async () => {
  const { store, handler } = makeHandler()
  const run = store.begin({ agentId: 'codex', agentName: 'Codex', task: 'hang' })
  let killed = 0
  store.attachCancel(run.id, () => { killed += 1 })

  const ok = await hit(handler, {
    method: 'POST',
    url: '/conductor/cancel',
    headers: { host: HOST, 'content-type': 'application/json' },
    body: JSON.stringify({ id: run.id }),
  })
  assert.equal(ok.status, 200)
  assert.equal(ok.json.ok, true)
  assert.equal(killed, 1)
  assert.equal(store.snapshot().active[0].cancelRequested, true)

  const unknown = await hit(handler, {
    method: 'POST',
    url: '/conductor/cancel',
    headers: { host: HOST },
    body: JSON.stringify({ id: 'crew-nope' }),
  })
  assert.equal(unknown.status, 404)
  store.finish(run.id, 'cancelled')
})

test('POST /conductor/settings validates and persists the retention limit', async () => {
  const { store, handler } = makeHandler()
  const previous = process.env.DSH_HOME
  const home = mkdtempSync(join(tmpdir(), 'conductor-home-'))
  process.env.DSH_HOME = home
  try {
    const saved = await hit(handler, {
      method: 'POST',
      url: '/conductor/settings',
      headers: { host: HOST, 'content-type': 'application/json' },
      body: JSON.stringify({ historyLimit: 7 }),
    })
    assert.equal(saved.status, 200)
    assert.deepEqual(saved.json, { ok: true, settings: { historyLimit: 7 } })
    assert.equal(store.getHistoryLimit(), 7)
    const persisted = JSON.parse(readFileSync(join(home, 'conductor-crew.json'), 'utf8'))
    assert.equal(persisted.historyLimit, 7)

    const invalid = await hit(handler, {
      method: 'POST',
      url: '/conductor/settings',
      headers: { host: HOST },
      body: JSON.stringify({ historyLimit: 0 }),
    })
    assert.equal(invalid.status, 400)
    assert.equal(invalid.json.ok, false)
    assert.match(invalid.json.message, /保留条数/)

    const broken = await hit(handler, {
      method: 'POST',
      url: '/conductor/settings',
      headers: { host: HOST },
      body: 'not json',
    })
    assert.equal(broken.status, 400)
    assert.equal(store.getHistoryLimit(), 7)
  } finally {
    if (previous === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previous
    rmSync(home, { recursive: true, force: true })
  }
})

test('unknown /conductor routes return 404 JSON', async () => {
  const { handler } = makeHandler()
  const response = await hit(handler, { url: '/conductor/nope', headers: { host: HOST } })
  assert.equal(response.status, 404)
  assert.equal(response.json.ok, false)
})

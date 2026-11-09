// Smoke tests for the browser half: the client module must load through the
// real __ModuleLoader__ contract, register the panel pair (sidebar row + main
// page) with the expected ids/order, and the initial page render must not
// throw. Components are evaluated with a tiny hook-aware fake renderer.

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SOURCE = readFileSync(join(ROOT, 'client.js'), 'utf8')
const MODULE_ID = 'dsh-agent-conductor'

function makeDocument(styleNodes = []) {
  return {
    visibilityState: 'visible',
    getElementById: () => null,
    createElement: (tag) => ({ tag, textContent: '' }),
    head: { appendChild: (node) => styleNodes.push(node) },
  }
}

function loadClientModule() {
  let loaded = null
  const styleNodes = []
  const previousWindow = globalThis.window
  const previousDocument = globalThis.document
  globalThis.window = { __ModuleLoader__: { load: (options) => { loaded = options } } }
  globalThis.document = makeDocument(styleNodes)
  try {
    // The bundle is a plain script; evaluating it only calls __ModuleLoader__.load.
    new Function(SOURCE)()
  } finally {
    if (previousWindow === undefined) delete globalThis.window
    else globalThis.window = previousWindow
    if (previousDocument === undefined) delete globalThis.document
    else globalThis.document = previousDocument
  }
  assert.ok(loaded !== null, 'client.js called __ModuleLoader__.load')
  return { loaded, styleNodes }
}

function makeExports(react) {
  const { loaded } = loadClientModule()
  assert.equal(loaded.id, MODULE_ID)
  return loaded.factory((id) => {
    if (id === 'react') return react
    throw new Error(`unexpected require(${id})`)
  })
}

function makeCtx() {
  const registrations = []
  const dictionaries = []
  const ctx = {
    locale: {
      register(namespace, dictionary) { dictionaries.push({ namespace, dictionary }) },
      bind(namespace) {
        const found = dictionaries.find((entry) => entry.namespace === namespace)
        return (key) => found?.dictionary?.zh?.[key] ?? key
      },
    },
    effect(callback, label) { callback() },
    slots: {
      inject(name, register) {
        assert.ok(['sidebar.panellist', 'main'].includes(name))
        register()
      },
      register(spec, component) {
        registrations.push({ spec, component })
      },
    },
  }
  return { ctx, registrations, dictionaries }
}

function fakeReact() {
  const createElement = (type, props, ...children) => ({ type, props: props ?? {}, children })
  const noop = () => {}
  return {
    createElement,
    useState: (value) => [value, noop],
    useEffect: noop,
    useCallback: (callback) => callback,
  }
}

test('client module exposes the bundle contract', () => {
  const exports = makeExports(fakeReact())
  assert.equal(exports.name, MODULE_ID)
  assert.equal(typeof exports.apply, 'function')
  assert.deepEqual(exports.inject, ['slots', 'locale'])
})

test('apply registers the panel row above 更多 and its main page', () => {
  const exports = makeExports(fakeReact())
  const { ctx, registrations, dictionaries } = makeCtx()

  exports.apply(ctx)

  const sidebar = registrations.find((entry) => entry.spec.name === 'sidebar.panellist')
  const main = registrations.find((entry) => entry.spec.name === 'main')
  assert.ok(sidebar, 'sidebar.panellist registered')
  assert.equal(sidebar.spec.id, 'conductor')
  assert.equal(sidebar.spec.order, 1000, 'row sits immediately above the built-in 更多 menu')
  assert.equal(typeof sidebar.spec.label, 'function')
  assert.equal(sidebar.spec.label(), '指挥官')
  assert.equal(sidebar.spec.locale, 'conductorCrew')
  assert.equal(typeof sidebar.component, 'function')

  assert.ok(main, 'main page registered')
  assert.equal(main.spec.key, 'conductor')
  assert.equal(typeof main.component, 'function')

  assert.equal(dictionaries.length, 1)
  assert.equal(dictionaries[0].namespace, 'conductorCrew')
  assert.equal(typeof dictionaries[0].dictionary.zh, 'object')
  assert.equal(typeof dictionaries[0].dictionary.en, 'object')
})

test('the initial page render produces the war-room header and fleet', () => {
  // Minimal hook-aware renderer: enough to execute the component tree once and
  // catch render-time crashes (undefined helpers, bad hooks order, etc.).
  let hooks = []
  let cursor = 0
  const React = {
    createElement(type, props, ...children) {
      const merged = { ...(props ?? {}) }
      if (children.length === 1) merged.children = children[0]
      else if (children.length > 1) merged.children = children
      return { type, props: merged }
    },
    useState(initial) {
      const index = cursor++
      if (!(index in hooks)) hooks[index] = typeof initial === 'function' ? initial() : initial
      return [hooks[index], () => {}]
    },
    useEffect() { cursor++ },
    useCallback(callback) { cursor++; return callback },
    render(node) {
      const walk = (value) => {
        if (value === null || value === undefined || typeof value === 'boolean') return ''
        if (typeof value === 'string' || typeof value === 'number') return String(value)
        if (Array.isArray(value)) return value.map(walk).join('')
        if (typeof value.type === 'function') {
          const parentHooks = hooks
          const parentCursor = cursor
          hooks = []
          cursor = 0
          try {
            return walk(value.type(value.props ?? {}))
          } finally {
            hooks = parentHooks
            cursor = parentCursor
          }
        }
        if (typeof value.type === 'string') return walk(value.props?.children)
        return ''
      }
      return walk(node)
    },
  }

  const exports = makeExports(React)
  const { ctx, registrations } = makeCtx()
  exports.apply(ctx)

  const main = registrations.find((entry) => entry.spec.name === 'main')
  const text = React.render(React.createElement(main.component))
  assert.ok(text.includes('大肥鱼指挥官'), 'page header renders the panel name')
  assert.ok(text.includes('指挥官'), 'localized panel copy is available')
})

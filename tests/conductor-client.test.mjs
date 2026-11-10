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
        return (key, vars = {}) => String(found?.dictionary?.zh?.[key] ?? key).replace(/\{(\w+)\}/g, (match, name) => vars[name] === undefined ? match : String(vars[name]))
      },
    },
    uiWorkspace: { startSession() {} },
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
  assert.deepEqual(exports.inject, ['slots', 'locale', 'uiWorkspace'])
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


// The renderer retains App state across user actions, while effects are held so
// the tests can supply the exact availability response without real network or
// timers. Nothing is dispatched until the user reviews and sends a DSH draft.
function makeInteractionHarness(availability, testContext, snapshot = null) {
  const network = []
  const originalFetch = globalThis.fetch
  globalThis.fetch = (...args) => { network.push(args); throw new Error('unexpected network call') }
  testContext.after(() => { globalThis.fetch = originalFetch })
  const state = []
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
      if (!(index in state)) state[index] = index === 0 ? snapshot : index === 10 ? availability : (typeof initial === 'function' ? initial() : initial)
      return [state[index], (value) => { state[index] = typeof value === 'function' ? value(state[index]) : value }]
    },
    useEffect() {},
    useCallback(callback) { return callback },
  }
  const { ctx, registrations } = makeCtx()
  const calls = []
  ctx.uiWorkspace.startSession = (...args) => calls.push(args)
  makeExports(React).apply(ctx)
  const main = registrations.find((entry) => entry.spec.name === 'main')
  assert.equal(typeof main.spec.inject, 'function')
  const props = main.spec.inject()
  const expand = (node) => {
    if (Array.isArray(node)) return node.flatMap((child) => expand(child))
    if (node === null || node === undefined || typeof node === 'boolean') return []
    if (typeof node === 'string' || typeof node === 'number') return [String(node)]
    if (typeof node.type === 'function') return expand(node.type(node.props ?? {}))
    return [{ ...node, children: expand(node.props?.children) }]
  }
  const render = () => { cursor = 0; return expand(React.createElement(main.component, props)) }
  const descendants = (tree) => tree.flatMap((item) => typeof item === 'string' ? [] : [item, ...descendants(item.children)])
  const textOf = (node) => typeof node === 'string' ? node : node.children.map(textOf).join('')
  const card = (tree, name) => descendants(tree).find((node) => node.props.className === 'dshc-card' && descendants([node]).some((child) => child.props.className === 'dshc-name' && textOf(child) === name))
  const button = (tree, label) => descendants(tree).find((node) => node.type === 'button' && textOf(node) === label)
  return { calls, network, render, card, button, descendants, textOf }
}

test('available CLI offers dispatch; missing CLI offers connect; opening a dialog does not execute', (t) => {
  const ui = makeInteractionHarness({ codex: { id: 'codex', status: 'available' }, 'claude-code': { id: 'claude-code', status: 'missing' } }, t)
  const tree = ui.render()
  const codex = ui.card(tree, 'Codex')
  const claude = ui.card(tree, 'Claude Code')
  assert.ok(ui.button([codex], '派遣'))
  assert.equal(ui.button([codex], '连接'), undefined)
  assert.ok(ui.button([claude], '连接'))
  assert.equal(ui.button([claude], '派遣'), undefined)
  assert.match(ui.textOf(codex), /登录待确认/)
  assert.match(ui.textOf(codex), /待命/)
  assert.match(ui.textOf(claude), /等待连接/)
  ui.button([claude], '连接').props.onClick()
  assert.deepEqual(ui.calls, [])
  const dialog = ui.descendants(ui.render()).find((node) => node.props.role === 'dialog')
  assert.ok(dialog)
  assert.match(ui.textOf(dialog), /不会自动安装或执行/)
  assert.deepEqual(ui.calls, [])
  assert.deepEqual(ui.network, [])
})

test('connect opens a reviewable draft with append semantics, without running a command', (t) => {
  const ui = makeInteractionHarness({ 'claude-code': { id: 'claude-code', status: 'missing' } }, t)
  const tree = ui.render()
  ui.button([ui.card(tree, 'Claude Code')], '连接').props.onClick()
  ui.button(ui.render(), '打开对话并填写').props.onClick()
  assert.equal(ui.calls.length, 1)
  const [workspace, options] = ui.calls[0]
  assert.equal(workspace, undefined)
  assert.equal(options.whenDraftExists, 'append')
  assert.match(options.prompt, /Claude Code/)
  assert.match(options.prompt, /等待我确认/)
  assert.match(options.prompt, /不要直接安装/)
  assert.deepEqual(ui.network, [])
})

test('dispatch opens an editable example and only creates a draft with the chosen agent and task', (t) => {
  const ui = makeInteractionHarness({ codex: { id: 'codex', status: 'available' } }, t)
  const tree = ui.render()
  ui.button([ui.card(tree, 'Codex')], '派遣').props.onClick()
  let dialogTree = ui.render()
  const textarea = ui.descendants(dialogTree).find((node) => node.type === 'textarea')
  assert.match(textarea.props.value, /README/)
  assert.deepEqual(ui.calls, [])
  textarea.props.onChange({ target: { value: '只读检查项目结构' } })
  dialogTree = ui.render()
  ui.button(dialogTree, '打开对话并填写').props.onClick()
  assert.equal(ui.calls.length, 1)
  const [workspace, options] = ui.calls[0]
  assert.equal(workspace, undefined)
  assert.equal(options.whenDraftExists, 'append')
  assert.match(options.prompt, /conductor_dispatch/)
  assert.match(options.prompt, /Codex/)
  assert.match(options.prompt, /只读检查项目结构/)
  assert.deepEqual(ui.network, [])
})


test('an active CLI cannot be dispatched again from its card', (t) => {
  const snapshot = { active: [{ id: 'crew-001', agentId: 'codex', status: 'running', startedAt: 1, endedAt: null, taskPreview: 'test', outputChars: 0 }], history: [], settings: { historyLimit: 50 } }
  const ui = makeInteractionHarness({ codex: { id: 'codex', status: 'available' } }, t, snapshot)
  const card = ui.card(ui.render(), 'Codex')
  assert.equal(ui.button([card], '派遣'), undefined)
  assert.ok(ui.button([card], '终止'))
  assert.deepEqual(ui.network, [])
})

test('empty task cannot be opened as a dispatch draft', (t) => {
  const ui = makeInteractionHarness({ codex: { id: 'codex', status: 'available' } }, t)
  const tree = ui.render()
  ui.button([ui.card(tree, 'Codex')], '派遣').props.onClick()
  let dialogTree = ui.render()
  const textarea = ui.descendants(dialogTree).find((node) => node.type === 'textarea')
  textarea.props.onChange({ target: { value: '  ' } })
  dialogTree = ui.render()
  assert.equal(ui.button(dialogTree, '打开对话并填写').props.disabled, true)
  assert.deepEqual(ui.calls, [])
  assert.deepEqual(ui.network, [])
})

test('Kimi and Qwen use the intended reference portraits', (t) => {
  const ui = makeInteractionHarness({}, t)
  const tree = ui.render()
  const portrait = (name) => ui.descendants([ui.card(tree, name)])
    .find((node) => node.type === 'img' && node.props.className === 'dshc-avatar-atlas')
  assert.deepEqual(portrait('Kimi CLI').props.style, { left: '-200%', top: '-100%' })
  assert.deepEqual(portrait('Qwen Code').props.style, { left: '-300%', top: '-100%' })
})

test('OpenCode and Cursor use the requested swapped portraits', (t) => {
  const ui = makeInteractionHarness({}, t)
  const tree = ui.render()
  const portrait = (name) => ui.descendants([ui.card(tree, name)])
    .find((node) => node.type === 'img' && node.props.className === 'dshc-avatar-atlas')
  assert.deepEqual(portrait('OpenCode').props.style, { left: '-100%', top: '-100%' })
  assert.deepEqual(portrait('Cursor CLI').props.style, { left: '-300%', top: '0%' })
})

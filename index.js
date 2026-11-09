/**
 * dsh-agent-conductor (host half, bundle form).
 *
 * Two surfaces share one package:
 *   1. the `conductor_dispatch` tool — dispatch a self-contained task to one of
 *      11 external agent CLIs and bring the result back into the conversation;
 *   2. the 大肥鱼指挥官 panel (client.js) — a read-only view of live and recent
 *      dispatches, fed by this half's run registry over the same-origin
 *      `/conductor` prefix route.
 *
 * The route is registered lazily through `ctx.inject(['webServer'], ...)` so
 * headless CLI profiles without a web server still load the tool normally.
 *
 * The same agent registry powers skills/conductor/scripts/dispatch.py — keep
 * the two in sync when adding CLIs.
 */
import { mkdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { createRunStore, normalizeHistoryLimit } from './conductor-store.js'

export const name = 'dsh-agent-conductor'
export const inject = ['tools', 'subprocess']

const AGENTS = [
  { id: 'codex', name: 'Codex', argv: ['codex', 'exec', '{task}'], install: 'npm i -g @openai/codex（或软链已有 codex-cli：ln -s ~/.codex/plugins/.plugin-appserver/codex ~/.local/bin/codex）' },
  { id: 'claude-code', name: 'Claude Code', argv: ['claude', '-p', '{task}', '--output-format', 'text'], install: 'npm i -g @anthropic-ai/claude-code' },
  { id: 'trae', name: 'TraeCode', argv: ['traecli', 'exec', '{task}'], install: 'TraeCode CLI：https://docs.trae.cn/cli_command-line-parameters' },
  { id: 'opencode', name: 'OpenCode', argv: ['opencode', 'run', '{task}'], install: 'npm i -g opencode-ai' },
  { id: 'gemini', name: 'Gemini CLI', argv: ['gemini', '-p', '{task}'], install: 'npm i -g @google/gemini-cli' },
  { id: 'cursor', name: 'Cursor CLI', argv: ['cursor-agent', '-p', '{task}'], install: 'cursor.com/install' },
  { id: 'kimi', name: 'Kimi CLI', argv: ['kimi', '--prompt', '{task}'], install: 'npm i -g @moonshot-ai/kimi-code' },
  { id: 'qwen', name: 'Qwen Code', argv: ['qwen', '--prompt', '{task}'], install: 'npm i -g @qwen-code/qwen-code' },
  { id: 'copilot', name: 'Copilot CLI', argv: ['copilot', '-p', '{task}', '--allow-all-tools'], install: 'npm i -g @github/copilot（无头模式自动带 --allow-all-tools 放行工具）' },
  { id: 'workbuddy', name: 'WorkBuddy', argv: ['workbuddy', '-p', '{task}'], install: '见官方教程' },
  { id: 'grok', name: 'Grok CLI', argv: ['grok', '-p', '{task}'], install: 'npm i -g @xai-official/grok（或 curl -fsSL https://x.ai/cli/install.sh | bash）' },
]

const DISPATCH_TIMEOUT_MS = 10 * 60 * 1000
/** Cap the result text handed back to the model so a chatty CLI can't blow up the context. */
const MAX_OUTPUT_CHARS = 20_000
/** Streaming buffer shape: keep the first MAX chars plus a rolling tail window. */
const OUTPUT_HEAD_RATIO = 0.7
const OUTPUT_TAIL_RATIO = 0.25
const OUTPUT_HEAD_CHARS = Math.floor(MAX_OUTPUT_CHARS * OUTPUT_HEAD_RATIO)
const OUTPUT_TAIL_CHARS = Math.floor(MAX_OUTPUT_CHARS * OUTPUT_TAIL_RATIO)
/** stderr is diagnostics only: keep a bounded head + rolling tail (the real error prints last). */
const STDERR_HEAD_CHARS = 4_000
const STDERR_TAIL_CHARS = 2_000
/** Cap the error snippet embedded in an Error message (first + last part of it). */
const ERROR_DETAIL_CHARS = 500

const CONDUCTOR_PREFIX = '/conductor'
const SETTINGS_FILE = 'conductor-crew.json'
const ASSETS = Object.freeze({
  '/assets/crew-atlas.webp': 'crew-atlas.webp',
  '/assets/captain.webp': 'captain.webp',
})

function readPackageVersion() {
  try {
    const parsed = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'))
    return typeof parsed?.version === 'string' && parsed.version !== '' ? parsed.version : '0.4.0'
  } catch {
    return '0.4.0'
  }
}

const PACKAGE_VERSION = readPackageVersion()

function settingsPath() {
  const home = typeof process.env.DSH_HOME === 'string' && process.env.DSH_HOME.trim() !== ''
    ? process.env.DSH_HOME.trim()
    : join(homedir(), '.dsh')
  return join(home, SETTINGS_FILE)
}

function readSettings() {
  try {
    const file = settingsPath()
    if (statSync(file).size > 2_000_000) return {}
    const parsed = JSON.parse(readFileSync(file, 'utf8'))
    const historyLimit = normalizeHistoryLimit(parsed?.historyLimit)
    return {
      ...(historyLimit === null ? {} : { historyLimit }),
      ...(Array.isArray(parsed?.history) ? { history: parsed.history } : {}),
    }
  } catch {
    return {}
  }
}

function writeSettings(settings) {
  let temporary
  try {
    const file = settingsPath()
    mkdirSync(dirname(file), { recursive: true })
    const body = `${JSON.stringify({ historyLimit: settings.historyLimit, history: settings.history ?? [] }, null, 2)}\n`
    temporary = `${file}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`
    writeFileSync(temporary, body, { encoding: 'utf8', mode: 0o600, flag: 'wx' })
    renameSync(temporary, file)
  } catch (error) {
    if (temporary) { try { unlinkSync(temporary) } catch { /* no temporary file */ } }
    const message = error instanceof Error ? error.message : String(error)
    console.error(`[conductor] crew settings write skipped: ${message}`)
  }
}

/**
 * Keep the head and tail of an over-long output with an elision marker in
 * between. Built from the streaming buffers rather than the whole text:
 * `head` holds the first MAX_OUTPUT_CHARS characters, `tail` the rolling last
 * OUTPUT_TAIL_CHARS, and `total` the true stdout length. Agent CLIs print their
 * final answer last, so the tail is exactly what must not be lost.
 */
function clipOutput(head, tail, total, max = MAX_OUTPUT_CHARS) {
  if (total <= max) return head.trim()
  const headChars = Math.min(head.length, OUTPUT_HEAD_CHARS)
  const tailChars = Math.min(tail.length, OUTPUT_TAIL_CHARS)
  let headText = head.slice(0, headChars)
  // Never hand the model half of a surrogate pair when a cut lands inside an emoji.
  if (/[\uD800-\uDBFF]$/.test(headText)) headText = headText.slice(0, -1)
  let tailText = tail.slice(-tailChars)
  if (/^[\uDC00-\uDFFF]/.test(tailText)) tailText = tailText.slice(1)
  const omitted = Math.max(0, total - headText.length - tailText.length)
  return `${headText}\n\n…[输出过长，已省略中间 ${omitted} 字符 / output truncated]…\n${tailText}`.trim()
}

function shellQuote(part) {
  if (/^[A-Za-z0-9_./=-]+$/.test(part)) return part
  return `'${part.replaceAll("'", "'\\''")}'`
}

function resolveCwd(exec) {
  const sessionCwd = exec?.agent?.session?.header?.cwd
  return (typeof sessionCwd === 'string' && sessionCwd.trim())
    || process.env.CONDUCTOR_CWD?.trim()
    || process.cwd()
}

/**
 * Template argv for one agent. Codex reads its model from a shared
 * ~/.codex/config.toml, which may name a model the current account cannot use;
 * CONDUCTOR_CODEX_MODEL overrides it without touching that file.
 */
function buildArgv(agent, task, env = process.env) {
  const argv = agent.argv.map((a) => a.split('{task}').join(task))
  if (agent.id === 'codex') {
    const model = env?.CONDUCTOR_CODEX_MODEL?.trim()
    if (model) argv.splice(2, 0, '-m', model) // codex exec -m <model> <task>
  }
  return argv
}

/**
 * Resolve argv[0] through the host subprocess service before spawning. Node's
 * spawn does not apply Windows PATHEXT, so npm-installed .CMD shims would
 * otherwise look "not installed" even though they are on PATH. The host
 * subprocess service never shell-interprets argv, so .CMD/.BAT shims cannot be
 * launched at all — report that instead of a confusing spawn failure.
 */
async function resolveArgv0(subprocess, agent, argv, platform = process.platform) {
  if (typeof subprocess.resolveExecutable !== 'function') return argv
  let executable
  try {
    executable = await subprocess.resolveExecutable(argv[0])
  } catch {
    throw new Error(`${agent.name} 未安装（或不在 PATH）。安装：${agent.install}`)
  }
  if (typeof executable !== 'string' || executable === '') return argv
  if (platform === 'win32' && /\.(cmd|bat)$/i.test(executable)) {
    throw new Error(`${agent.name} 只提供了 Windows npm shim（${executable}），宿主 subprocess 不能直接启动 .cmd/.bat；请改用 conductor skill 的 dispatch.py（已支持 PATHEXT），或安装该 CLI 的原生可执行版本。`)
  }
  return [executable, ...argv.slice(1)]
}

/**
 * Read-only discovery: resolving a binary proves only that it can be found,
 * not that the provider is authenticated or that a dispatch will succeed.
 * Never execute the CLI or expose its absolute filesystem path to the panel.
 */
async function probeAgentAvailability(agent, subprocess, platform = process.platform) {
  const result = {
    id: agent.id, name: agent.name, status: 'unknown', authentication: 'unknown',
    command: agent.argv[0], install: agent.install,
  }
  if (!subprocess || typeof subprocess.resolveExecutable !== 'function') return result
  let timer
  try {
    const resolution = Promise.resolve().then(() => subprocess.resolveExecutable(agent.argv[0]))
    const timeout = new Promise((resolve) => { timer = setTimeout(() => resolve(null), 3000) })
    const executable = await Promise.race([resolution, timeout])
    if (typeof executable !== 'string' || executable.trim() === '') return result
    result.status = platform === 'win32' && /\.(cmd|bat)$/i.test(executable) ? 'unsupported' : 'available'
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (/ENOENT|not found|cannot find|not installed|未找到|不存在|未安装/i.test(message)) result.status = 'missing'
  } finally {
    clearTimeout(timer)
  }
  return result
}

/** Rebuild a bounded stderr transcript as head + optional elision marker + tail. */
function formatStderr(head, tail, total) {
  if (total === 0 || head === '') return ''
  const tailStart = total - tail.length
  if (head.length > tailStart) return head + tail.slice(head.length - tailStart)
  const omitted = Math.max(0, total - head.length - tail.length)
  return `${head}\n\n…[stderr 已省略 ${omitted} 字符 / stderr truncated]…\n${tail}`
}

/** Keep the first and last part of a diagnostic so the real (trailing) error survives. */
function errorDetail(text) {
  const trimmed = text.trim()
  if (trimmed === '') return '(无输出)'
  if (trimmed.length <= ERROR_DETAIL_CHARS) return trimmed
  const half = Math.floor(ERROR_DETAIL_CHARS / 2)
  let head = trimmed.slice(0, half).trimEnd()
  if (/[\uD800-\uDBFF]$/.test(head)) head = head.slice(0, -1)
  let tail = trimmed.slice(-half).trimStart()
  if (/^[\uDC00-\uDFFF]/.test(tail)) tail = tail.slice(1)
  return `${head} … ${tail}`
}

function renderPlan({ agent, task, cwd, argv }) {
  return [
    'Conductor Dry-run · 调度预览（未执行）',
    `  Target agent    : ${agent.name}`,
    `  Working dir     : ${cwd}`,
    `  Arguments       : ${JSON.stringify(argv)}`,
    `  Shell-equivalent: ${argv.map(shellQuote).join(' ')}`,
    `  Task length     : ${task.length} chars`,
    '  Safety          : argv is passed directly; no shell is used',
    '',
    '确认目标、工作目录和任务无误后，将 dryRun 设为 false 正式派活。',
  ].join('\n')
}

/* ------------------------------------------------------------------ */
/* Panel data route (/conductor)                                       */
/* ------------------------------------------------------------------ */

/** Reject cross-site callers: the panel is same-origin, a web page is not. */
function originAllowed(req) {
  const host = req?.headers?.host
  if (typeof host !== 'string' || host === '') return false
  const origin = req.headers.origin ?? req.headers.referer
  if (origin === undefined) return true
  try {
    return new URL(origin).host === host
  } catch {
    return false
  }
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  })
  res.end(body)
}

async function readJsonBody(req) {
  let raw = ''
  for await (const chunk of req) raw += String(chunk)
  try {
    return JSON.parse(raw || '{}')
  } catch {
    return {}
  }
}

/**
 * Same-origin JSON API for the panel:
 *   GET  /conductor/state            -> registry snapshot
 *   GET  /conductor/availability     -> binary availability (not authentication)
 *   GET  /conductor/run?id=...       -> one run with full tails
 *   POST /conductor/cancel {id}      -> request process-tree termination
 *   POST /conductor/settings {historyLimit} -> persist retention
 */
export function createConductorHandler({ store, version = PACKAGE_VERSION, agents = [], assetDirectory = new URL('./assets/', import.meta.url), persistSettings = writeSettings, getSubprocess = () => null, probeAgents = AGENTS, platform = process.platform } = {}) {
  return async function conductorHandler(req, res) {
    try {
      if (!originAllowed(req)) {
        sendJson(res, 403, { ok: false, message: 'cross-site request refused' })
        return
      }
      const url = new URL(req.url ?? '/', 'http://localhost')
      const route = url.pathname.slice(CONDUCTOR_PREFIX.length) || '/'
      // Fixed names only: never resolve a path supplied by the request.
      if (req.method === 'GET' && Object.hasOwn(ASSETS, route)) {
        let body
        try {
          body = await readFile(new URL(ASSETS[route], assetDirectory))
        } catch {
          sendJson(res, 404, { ok: false, message: 'conductor asset not found' })
          return
        }
        res.writeHead(200, {
          'content-type': 'image/webp',
          'content-length': body.length,
          'x-content-type-options': 'nosniff',
          'cache-control': 'no-cache',
        })
        res.end(body)
        return
      }
      if (req.method === 'GET' && route === '/availability') {
        const id = url.searchParams.get('id')
        const selected = id === null ? probeAgents : probeAgents.filter((agent) => agent.id === id)
        if (selected.length === 0) {
          sendJson(res, 404, { ok: false, message: 'unknown agent' })
          return
        }
        let subprocess = null
        try { subprocess = getSubprocess() } catch { /* service unavailable */ }
        const availability = await Promise.all(selected.map((agent) => probeAgentAvailability(agent, subprocess, platform)))
        sendJson(res, 200, { ok: true, agents: availability })
        return
      }
      if (req.method === 'GET' && route === '/state') {
        sendJson(res, 200, { ...store.snapshot(), version, agents })
        return
      }
      if (req.method === 'GET' && route === '/run') {
        const result = store.detail(url.searchParams.get('id') ?? '')
        sendJson(res, result.ok ? 200 : 404, result)
        return
      }
      if (req.method === 'POST' && route === '/cancel') {
        const payload = await readJsonBody(req)
        const result = store.requestCancel(typeof payload.id === 'string' ? payload.id : '')
        sendJson(res, result.ok ? 200 : 404, result)
        return
      }
      if (req.method === 'POST' && route === '/settings') {
        const payload = await readJsonBody(req)
        const historyLimit = store.setHistoryLimit(payload.historyLimit)
        // The production store persists on every change, including this one.
        // Standalone handlers can provide their own settings persistence.
        persistSettings?.({ historyLimit, history: store.exportHistory() })
        sendJson(res, 200, { ok: true, settings: { historyLimit } })
        return
      }
      sendJson(res, 404, { ok: false, message: 'unknown conductor route' })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      try {
        sendJson(res, 400, { ok: false, message })
      } catch { /* response already gone */ }
    }
  }
}

export function apply(ctx) {
  const saved = readSettings()
  const store = createRunStore({
    historyLimit: saved.historyLimit,
    history: saved.history,
    onHistoryChange: (history, historyLimit) => writeSettings({ historyLimit, history }),
  })

  const tool = {
    name: 'conductor_dispatch',
    description:
      '派一件自包含的任务给外部 agent CLI（Codex、Claude Code、TraeCode、OpenCode、Gemini、Cursor、Kimi、Qwen、Copilot、WorkBuddy、Grok）在无头模式下执行，并把结果带回会话；支持 dryRun 先预览目标、工作目录和命令。CLI 未安装或未登录时会报错并附安装提示。适合：让另一家的编码代理做独立的研究、实现或分析。执行消耗对应 CLI 的登录额度。',
    parameters: {
      type: 'object',
      properties: {
        agent: {
          type: 'string',
          description: '目标 CLI 的 id：codex / claude-code / trae / opencode / gemini / cursor / kimi / qwen / copilot / workbuddy / grok',
        },
        task: { type: 'string', description: '完整的自包含任务描述（对方看不到本会话上下文）。' },
        dryRun: { type: 'boolean', description: 'true 时只返回调度预览，不启动外部 CLI。' },
      },
      required: ['agent', 'task'],
    },
    output: {
      schema: { type: 'string' },
      render(_args, value) { return [{ type: 'text', text: value }] },
    },
    timeoutMs: DISPATCH_TIMEOUT_MS + 30_000,
    isConcurrencySafe: () => true,
    presentCall: (args) => ({
      card: 'generic',
      title: `指挥家 → ${args?.agent ?? '?'}`,
      kind: args?.dryRun === true ? 'read' : 'execute',
      rawInput: args,
    }),
    async execute(args, exec) {
      if (typeof args?.task !== 'string' || args.task.trim() === '') {
        throw new Error('conductor_dispatch 需要非空 "task"。')
      }
      const agent = AGENTS.find((e) => e.id === args.agent)
      if (!agent) {
        throw new Error(`未知 agent "${args.agent}"；可用：${AGENTS.map((e) => e.id).join(', ')}`)
      }
      const argv = buildArgv(agent, args.task)
      const cwd = resolveCwd(exec)
      if (args.dryRun === true) {
        const subprocess = ctx.get('subprocess')
        let previewArgv = argv
        if (subprocess && typeof subprocess.resolveExecutable === 'function') {
          try {
            previewArgv = await resolveArgv0(subprocess, agent, argv)
          } catch { /* preview keeps the template argv; real dispatch reports the install hint */ }
        }
        return renderPlan({ agent, task: args.task, cwd, argv: previewArgv })
      }

      // Track every real dispatch for the 大肥鱼指挥官 panel; dry-runs are not runs.
      const run = store.begin({ agentId: agent.id, agentName: agent.name, task: args.task, cwd, argv })
      const subprocess = ctx.get('subprocess')
      if (!subprocess) {
        store.finish(run.id, 'failed', { error: '宿主 subprocess 服务不可用' })
        throw new Error('宿主 subprocess 服务不可用')
      }
      let spawnArgv
      try {
        if (exec.signal?.aborted) throw new Error('已取消')
        spawnArgv = await resolveArgv0(subprocess, agent, argv)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        if (exec.signal?.aborted || run.cancelRequested) {
          store.finish(run.id, 'cancelled')
          throw new Error(run.cancelRequested ? `${agent.name} 已被指挥官面板终止。` : '已取消')
        }
        store.finish(run.id, 'failed', { error: message })
        throw error
      }
      // Resolution can be asynchronous; do not start a CLI after cancellation.
      if (exec.signal?.aborted || run.cancelRequested) {
        store.finish(run.id, 'cancelled')
        throw new Error(run.cancelRequested ? `${agent.name} 已被指挥官面板终止。` : '已取消')
      }
      store.setArgv(run.id, spawnArgv)
      let child
      try {
        child = subprocess.spawn({
          argv: spawnArgv,
          cwd,
          stdio: { stdin: 'pipe', stdout: 'pipe', stderr: 'pipe' },
          graceMs: 15000,
        })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        const detail = `${agent.name} 启动失败：${message}。安装：${agent.install}`
        store.finish(run.id, 'failed', { error: detail })
        throw new Error(detail)
      }
      // Bound in-memory buffering without dropping the end of the stream: keep
      // the first MAX_OUTPUT_CHARS characters plus a rolling window of the last
      // OUTPUT_TAIL_CHARS, and count the true length. Agent CLIs print their
      // final answer last, so the tail is exactly the part that must survive.
      let out = ''
      let tail = ''
      let total = 0
      let errHead = ''
      let errTail = ''
      let errTotal = 0
      child.stdout?.setEncoding?.('utf8')
      child.stdout?.on('data', (chunk) => {
        const text = typeof chunk === 'string' ? chunk : String(chunk)
        if (text === '') return
        total += text.length
        if (out.length < MAX_OUTPUT_CHARS) {
          const room = MAX_OUTPUT_CHARS - out.length
          out += text.length <= room ? text : text.slice(0, room)
        }
        tail = (tail + text).slice(-OUTPUT_TAIL_CHARS)
        store.noteOutput(run.id, 'stdout', text)
      })
      child.stderr?.setEncoding?.('utf8')
      child.stderr?.on('data', (chunk) => {
        const text = typeof chunk === 'string' ? chunk : String(chunk)
        if (text === '') return
        errTotal += text.length
        if (errHead.length < STDERR_HEAD_CHARS) {
          const room = STDERR_HEAD_CHARS - errHead.length
          errHead += text.length <= room ? text : text.slice(0, room)
        }
        errTail = (errTail + text).slice(-STDERR_TAIL_CHARS)
        store.noteOutput(run.id, 'stderr', text)
      })
      try { child.stdin?.end() } catch { /* 忽略 */ }
      // Tear down the whole process tree on cancel or on the 10-minute budget
      // so a hung agent CLI cannot outlive the tool call.
      const kill = () => { try { child.terminate?.() } catch { /* 忽略 */ } }
      store.attachCancel(run.id, kill)
      let timer
      const timedOut = new Promise((_, reject) => {
        timer = setTimeout(() => { kill(); reject(new Error('TIMEOUT')) }, DISPATCH_TIMEOUT_MS)
      })
      let onAbort
      const aborted = new Promise((_, reject) => {
        if (!exec.signal) return
        onAbort = () => { kill(); reject(new Error('已取消')) }
        exec.signal.addEventListener('abort', onAbort, { once: true })
        if (exec.signal.aborted) onAbort()
      })
      try {
        const outcome = await Promise.race([child.done, aborted, timedOut])
        // The panel's 终止 button terminates the tree, but that still looks like
        // a normal exit; prefer the explanation the operator actually requested.
        if (run.cancelRequested) {
          store.finish(run.id, 'cancelled')
          throw new Error('CONDUCTOR_CANCELLED_BY_PANEL')
        }
        if (outcome && outcome.exitCode !== 0) {
          const stderrText = formatStderr(errHead, errTail, errTotal).trim()
          const detail = stderrText || clipOutput(out, tail, total)
          const message = `${agent.name} 退出码 ${outcome.exitCode}：${errorDetail(detail)}`
          store.finish(run.id, 'failed', { exitCode: outcome.exitCode, error: message })
          throw new Error(message)
        }
        store.finish(run.id, 'done', { exitCode: outcome?.exitCode ?? 0 })
      } catch (error) {
        kill()
        const message = error instanceof Error ? error.message : String(error)
        if (message === 'CONDUCTOR_CANCELLED_BY_PANEL' || run.cancelRequested) {
          store.finish(run.id, 'cancelled')
          throw new Error(`${agent.name} 已被指挥官面板终止。`)
        }
        if (message === '已取消') {
          store.finish(run.id, 'cancelled')
          throw error
        }
        if (message === 'TIMEOUT') {
          store.finish(run.id, 'timeout')
          throw new Error(`${agent.name} 超时（10 分钟），进程已终止。`)
        }
        if (/exitCode|退出码/.test(message)) {
          // `child.done` itself may reject with an exit-code diagnostic. The
          // explicit non-zero path has already settled, so finish is a no-op
          // there; otherwise ensure the panel does not retain a phantom run.
          store.finish(run.id, 'failed', { error: message })
          throw error
        }
        if (/ENOENT|not found/i.test(message)) {
          const hint = `${agent.name} 未安装（或不在 PATH）。安装：${agent.install}`
          store.finish(run.id, 'failed', { error: hint })
          throw new Error(hint)
        }
        store.finish(run.id, 'failed', { error: message })
        throw error
      } finally {
        clearTimeout(timer)
        if (onAbort) exec.signal?.removeEventListener?.('abort', onAbort)
      }
      return clipOutput(out, tail, total)
    },
  }

  try {
    ctx.tools.register(tool)
  } catch (error) {
    console.error(`[conductor] conductor_dispatch registration skipped: ${error}`)
  }

  // Panel data route is optional: a CLI-only profile has no web server, and the
  // bundle must still load so conductor_dispatch keeps working there.
  if (typeof ctx.inject === 'function') {
    ctx.inject(['webServer'], (webCtx) => {
      webCtx.effect(() => {
        const handler = createConductorHandler({
          store,
          version: PACKAGE_VERSION,
          agents: AGENTS.map((agent) => ({ id: agent.id, name: agent.name })),
          persistSettings: null,
          getSubprocess: () => ctx.get('subprocess'),
        })
        const unregister = webCtx.webServer.register({ kind: 'prefix', path: CONDUCTOR_PREFIX, handler })
        return () => unregister()
      }, 'dsh-agent-conductor: /conductor routes')
    })
  }
}

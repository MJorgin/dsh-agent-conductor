/**
 * dsh-agent-conductor (host half): a generic one-shot dispatcher to external
 * agent CLIs, plus the conductor_dispatch tool the model can call in chat.
 *
 * Each entry in AGENTS describes one external CLI: an argv template with the
 * `{task}` placeholder (substituted with the user's task text), a simple-icons
 * slug for the UI, and how to install it. Unverified command shapes are marked
 * `unverified: true` and reported as such in the UI.
 *
 * Two surfaces:
 * - `conductor_dispatch` tool: model-facing, chat-native.
 * - POST /conductor/dispatch + GET /conductor/agents: the browser panel's RPC.
 */
import { spawn } from 'node:child_process'

export const name = 'dsh-agent-conductor'
export const inject = ['tools']

const DISPATCH_TIMEOUT_MS = 10 * 60 * 1000

// {task} 会被替换为任务文本；single-arg 时若命令不支持参数传递可走 stdin。
export const AGENTS = [
  {
    id: 'codex', name: 'Codex', icon: 'openai', unverified: false,
    argv: ['codex', 'exec', '{task}'],
    note: 'OpenAI 的编码代理 CLI（你机器上已装，可用原生 subagent_codex 或这里直接派活）',
    install: 'brew install codex 或 npm i -g @openai/codex',
  },
  {
    id: 'claude-code', name: 'Claude Code', icon: 'claude', unverified: false,
    argv: ['claude', '-p', '{task}', '--output-format', 'text'],
    note: 'Anthropic 的编码代理 CLI（-p 无头模式）',
    install: 'npm i -g @anthropic-ai/claude-code',
  },
  {
    id: 'gemini', name: 'Gemini CLI', icon: 'googlegemini', unverified: true,
    argv: ['gemini', '-p', '{task}'],
    note: 'Google 的开源代理 CLI',
    install: 'npm i -g @google/gemini-cli',
  },
  {
    id: 'cursor', name: 'Cursor CLI', icon: 'cursor', unverified: true,
    argv: ['cursor-agent', '-p', '{task}'],
    note: 'Cursor 的编码代理 CLI',
    install: 'curl -fsSL https://cursor.com/install -o /tmp/i && bash /tmp/i',
  },
  {
    id: 'opencode', name: 'OpenCode', icon: 'opencode', unverified: false,
    argv: ['opencode', 'run', '{task}'],
    note: '开源的终端编码代理',
    install: 'npm i -g opencode-ai',
  },
  {
    id: 'kimi', name: 'Kimi CLI', icon: 'moonshotai', unverified: true,
    argv: ['kimi', '--prompt', '{task}'],
    note: '月之暗面 Kimi 的编码代理 CLI',
    install: 'npm i -g kimi-cli',
  },
  {
    id: 'qwen', name: 'Qwen Code', icon: 'alibabacloud', unverified: true,
    argv: ['qwen', '--prompt', '{task}'],
    note: '通义千问的编码代理 CLI',
    install: 'npm i -g @qwen-code/qwen-code',
  },
  {
    id: 'copilot', name: 'Copilot CLI', icon: 'githubcopilot', unverified: true,
    argv: ['github-copilot', '--prompt', '{task}'],
    note: 'GitHub Copilot 的终端代理',
    install: 'npm i -g @github/copilot',
  },
  {
    id: 'trae', name: 'TraeCode', icon: 'bytedance', unverified: false,
    argv: ['traecli', 'exec', '{task}'],
    note: '字节的编码代理 CLI；`traecli exec` 为非交互（脚本/CI）模式，官方文档确认',
    install: '安装 TraeCode CLI（见 https://docs.trae.cn/cli_command-line-parameters）',
  },
  {
    id: 'workbuddy', name: 'WorkBuddy', icon: '', unverified: true,
    argv: ['workbuddy', '-p', '{task}'],
    note: '国内 AI 编程工作流 CLI；无头命令形态未验证，待实测',
    install: '官网/社区教程安装（命令形态待实测）',
  },
  {
    id: 'grok', name: 'Grok CLI', icon: 'x', unverified: true,
    argv: ['grok', '-p', '{task}'],
    note: 'xAI 的 Grok CLI（SuperGrok）；官方有 headless 文档，命令形态待实测',
    install: 'xAI 官方安装（https://docs.x.ai/build/cli/headless-scripting）',
  },
]

function run(command, args, task, signal) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      signal,
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => { stdout += chunk })
    child.stderr.on('data', (chunk) => { stderr += chunk })
    child.on('error', reject)
    child.on('close', (code) => resolve({ stdout, stderr, code }))
  })
}

async function dispatch(agent, task, signal) {
  const argv = agent.argv.map((arg) => arg.replaceAll('{task}', task))
  const command = argv[0]
  const args = argv.slice(1)
  const { stdout, stderr, code } = await run(command, args, task, signal)
  if (code !== 0) {
    throw new Error(
      `${agent.name} exited ${code}: ${(stderr || stdout).trim().slice(0, 500) || '(no output)'}`,
    )
  }
  return stdout.trim()
}

const dispatchTool = (toolName) => ({
  name: toolName,
  description:
    '派一件自包含的任务给外部 agent CLI（Codex、Claude Code、OpenCode、Gemini、Cursor、Kimi、Qwen、Copilot 等）在无头模式下执行，并把结果带回会话。CLI 未安装或未登录时会报错并附上安装命令。适合：让另一家的编码代理做独立的研究、实现或分析。执行消耗对应 CLI 的登录额度。',
  parameters: {
    type: 'object',
    properties: {
      agent: {
        type: 'string',
        description: '目标 CLI 的 id（codex / claude-code / gemini / cursor / opencode / kimi / qwen / copilot），先检查是否已安装。',
      },
      task: {
        type: 'string',
        description: '完整的自包含任务描述（对方看不到本会话上下文）。',
      },
    },
    required: ['agent', 'task'],
  },
  output: {
    schema: { type: 'string' },
    render: (_args, value) => [{ type: 'text', text: value }],
  },
  timeoutMs: DISPATCH_TIMEOUT_MS + 30_000,
  isConcurrencySafe: () => true,
  presentCall: (args) => ({
    card: 'generic',
    title: `指挥家 → ${args?.agent ?? '?'}`,
    kind: 'run',
    rawInput: args,
  }),
  async execute(args, exec) {
    if (typeof args?.task !== 'string' || args.task.trim() === '') {
      throw new Error('conductor_dispatch 需要非空的 "task"。')
    }
    return runDispatch(args.agent, args.task, exec.signal, (message) => {
      const agent = AGENTS.find((entry) => entry.id === args.agent)
      if (agent && /ENOENT|not found/i.test(message)) {
        throw new Error(`${agent.name} 未安装（或不在 PATH）。安装：${agent.install}`)
      }
    })
  },
})

/** Which CLIs resolve on this machine (best-effort: `command -v`). */
async function installedStatus() {
  const { execFile } = await import('node:child_process')
  const entries = []
  for (const agent of AGENTS) {
    let installed = false
    try {
      await new Promise((resolve, reject) => {
        execFile('/bin/sh', ['-c', `command -v "${agent.argv[0]}"`], { timeout: 5000 }, (error, stdout) => {
          if (!error && stdout.trim()) { installed = true; resolve() } else { resolve() }
        })
      })
    } catch { installed = false }
    entries.push({
      id: agent.id, name: agent.name, icon: agent.icon,
      unverified: agent.unverified, note: agent.note, install: agent.install,
      command: agent.argv.join(' ').replace('{task}', '<任务>'),
      installed,
    })
  }
  return entries
}

export function apply(ctx) {
  /** 本进程内最近的派活记录（面板历史 + 任务看板回收共用）。 */
  const recentRuns = []

  /** 客户端上报的运行日志（诊断通道：浏览器端把加载/执行情况 POST 回来）。 */
  const clientLogs = []

  async function runDispatch(agentId, task, signal, onFriendlyError) {
    const agent = AGENTS.find((entry) => entry.id === agentId)
    if (!agent) {
      throw new Error(`未知 agent "${agentId}"；可用：${AGENTS.map((e) => e.id).join(', ')}`)
    }
    const run = {
      id: `cond-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      agent: agent.id, name: agent.name, icon: agent.icon,
      task, startedAt: Date.now(), endedAt: null,
      status: 'running', output: null, error: null,
    }
    recentRuns.unshift(run)
    if (recentRuns.length > 20) recentRuns.pop()
    try {
      const output = await dispatch(agent, task, signal)
      run.status = 'succeeded'
      run.output = output
      run.endedAt = Date.now()
      return { id: run.id, ok: true, agent: agent.id, text: output }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      run.status = 'failed'
      run.error = message
      run.endedAt = Date.now()
      if (onFriendlyError) onFriendlyError(message)
      throw error
    }
  }

  const toolName = 'conductor_dispatch'
  try {
    ctx.tools.register(dispatchTool(toolName))
  } catch (error) {
    console.error(`[conductor] ${toolName} registration skipped: ${error}`)
  }

  if (typeof ctx.inject === 'function') {
    ctx.inject(['webServer'], (scope) => {
      try {
        scope.webServer.register({
          name: 'conductor-rpc',
          kind: 'exact',
          path: '/conductor/agents',
          handler: async (_req, res) => {
            try {
              const agents = await installedStatus()
              res.writeHead(200, { 'content-type': 'application/json' })
              res.end(JSON.stringify({ agents }))
            } catch (error) {
              res.writeHead(500, { 'content-type': 'application/json' })
              res.end(JSON.stringify({ error: String(error?.message ?? error) }))
            }
          },
        })
        scope.webServer.register({
          name: 'conductor-client-log',
          kind: 'exact',
          path: '/conductor/client-log',
          handler: async (req, res) => {
            if (req.method === 'GET') {
              res.writeHead(200, { 'content-type': 'application/json' })
              res.end(JSON.stringify({ logs: clientLogs }))
              return
            }
            if (req.method !== 'POST') {
              res.writeHead(405).end()
              return
            }
            try {
              const chunks = []
              for await (const chunk of req) chunks.push(chunk)
              const body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
              clientLogs.push({ ts: Date.now(), msg: String(body?.msg || '').slice(0, 800) })
              if (clientLogs.length > 50) clientLogs.shift()
              res.writeHead(200, { 'content-type': 'application/json' })
              res.end(JSON.stringify({ ok: true }))
            } catch (error) {
              res.writeHead(500, { 'content-type': 'application/json' })
              res.end(JSON.stringify({ error: String(error?.message ?? error) }))
            }
          },
        })
        scope.webServer.register({
          name: 'conductor-runs',
          kind: 'exact',
          path: '/conductor/runs',
          handler: async (_req, res) => {
            res.writeHead(200, { 'content-type': 'application/json' })
            res.end(JSON.stringify({ runs: recentRuns }))
          },
        })
        scope.webServer.register({
          name: 'conductor-dispatch',
          kind: 'exact',
          path: '/conductor/dispatch',
          handler: async (req, res) => {
            if (req.method !== 'POST') {
              res.writeHead(405).end()
              return
            }
            try {
              const chunks = []
              for await (const chunk of req) chunks.push(chunk)
              const body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
              if (typeof body?.task !== 'string' || !body.task.trim()) throw new Error('task 不能为空')
              const result = await runDispatch(body.agent, body.task, AbortSignal.timeout(DISPATCH_TIMEOUT_MS))
              res.writeHead(200, { 'content-type': 'application/json' })
              res.end(JSON.stringify(result))
            } catch (error) {
              const message = error instanceof Error ? error.message : String(error)
              if (/ENOENT|not found/i.test(message)) {
                res.writeHead(200, { 'content-type': 'application/json' })
                res.end(JSON.stringify({ ok: false, error: `CLI 未安装：${message}` }))
                return
              }
              res.writeHead(500, { 'content-type': 'application/json' })
              res.end(JSON.stringify({ ok: false, error: message }))
            }
          },
        })
      } catch (error) {
        console.error(`[conductor] web routes skipped: ${error}`)
      }
    })
  }
}

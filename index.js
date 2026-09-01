/**
 * dsh-agent-conductor (host half, bundle form): registers the
 * `conductor_dispatch` tool — dispatch a self-contained task to one of 11
 * external agent CLIs and bring the result back into the conversation.
 *
 * Host-only by design: this package declares NO dsh.client manifest, so no
 * browser code is shipped and the Web UI cannot be affected. The friendly
 * panel UI lives in the skill/README docs, not in the bundle.
 *
 * The same registry powers skills/conductor/scripts/dispatch.py — keep the
 * two in sync when adding CLIs.
 */
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

/** Keep the head and tail of an over-long output with an elision marker in between. */
function clipOutput(text, max = MAX_OUTPUT_CHARS) {
  if (text.length <= max) return text
  const head = text.slice(0, Math.floor(max * 0.7))
  const tail = text.slice(-Math.floor(max * 0.25))
  return `${head}\n\n…[输出过长，已省略中间 ${text.length - max} 字符 / output truncated]…\n${tail}`
}

export function apply(ctx) {
  const tool = {
    name: 'conductor_dispatch',
    description:
      '派一件自包含的任务给外部 agent CLI（Codex、Claude Code、TraeCode、OpenCode、Gemini、Cursor、Kimi、Qwen、Copilot、WorkBuddy、Grok）在无头模式下执行，并把结果带回会话。CLI 未安装或未登录时会报错并附安装提示。适合：让另一家的编码代理做独立的研究、实现或分析。执行消耗对应 CLI 的登录额度。',
    parameters: {
      type: 'object',
      properties: {
        agent: {
          type: 'string',
          description: '目标 CLI 的 id：codex / claude-code / trae / opencode / gemini / cursor / kimi / qwen / copilot / workbuddy / grok',
        },
        task: { type: 'string', description: '完整的自包含任务描述（对方看不到本会话上下文）。' },
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
      kind: 'execute',
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
      const subprocess = ctx.get('subprocess')
      if (!subprocess) {
        throw new Error('宿主 subprocess 服务不可用')
      }
      const argv = agent.argv.map((a) => a.split('{task}').join(args.task))
      // Work directory: prefer the current session's workspace (so the CLI
      // runs where the user is working — Codex in particular needs a trusted
      // git repo), then an explicit CONDUCTOR_CWD override, then the harness cwd.
      const sessionCwd = exec?.agent?.session?.header?.cwd
      const cwd = (typeof sessionCwd === 'string' && sessionCwd.trim())
        || process.env.CONDUCTOR_CWD?.trim()
        || process.cwd()
      let child
      try {
        child = subprocess.spawn({
          argv,
          cwd,
          stdio: { stdin: 'pipe', stdout: 'pipe', stderr: 'pipe' },
          graceMs: 15000,
        })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        throw new Error(`${agent.name} 启动失败：${message}。安装：${agent.install}`)
      }
      let out = ''
      let err = ''
      // Bound in-memory buffering; the final result is clipped anyway.
      child.stdout?.on('data', (chunk) => { if (out.length < MAX_OUTPUT_CHARS * 2) out += chunk })
      child.stderr?.on('data', (chunk) => { if (err.length < 8000) err += chunk })
      try { child.stdin?.end() } catch { /* 忽略 */ }
      // Tear down the whole process tree on cancel or on the 10-minute budget
      // so a hung agent CLI cannot outlive the tool call.
      const kill = () => { try { child.terminate?.() } catch { /* 忽略 */ } }
      const onAbort = () => kill()
      exec.signal?.addEventListener?.('abort', onAbort, { once: true })
      let timer
      const timedOut = new Promise((_, reject) => {
        timer = setTimeout(() => { kill(); reject(new Error('TIMEOUT')) }, DISPATCH_TIMEOUT_MS)
      })
      const aborted = new Promise((_, reject) => {
        if (!exec.signal) return
        exec.signal.addEventListener('abort', () => reject(new Error('已取消')), { once: true })
      })
      try {
        const outcome = await Promise.race([child.done, aborted, timedOut])
        if (outcome && outcome.exitCode !== 0) {
          throw new Error(`${agent.name} 退出码 ${outcome.exitCode}：${(err || out).trim().slice(0, 400) || '(无输出)'}`)
        }
      } catch (error) {
        kill()
        const message = error instanceof Error ? error.message : String(error)
        if (message === '已取消') throw error
        if (message === 'TIMEOUT') throw new Error(`${agent.name} 超时（10 分钟），进程已终止。`)
        if (/exitCode|退出码/.test(message)) throw error
        if (/ENOENT|not found/i.test(message)) {
          throw new Error(`${agent.name} 未安装（或不在 PATH）。安装：${agent.install}`)
        }
        throw error
      } finally {
        clearTimeout(timer)
        exec.signal?.removeEventListener?.('abort', onAbort)
      }
      return clipOutput(out.trim())
    },
  }

  try {
    ctx.tools.register(tool)
  } catch (error) {
    console.error(`[conductor] conductor_dispatch registration skipped: ${error}`)
  }
}

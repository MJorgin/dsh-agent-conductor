// dsh-agent-conductor · 动态插件版（热更新路线）
//
// 用法：把本文件的函数体（return { ... } 部分）作为 cordis_define 的
// code.host 在 DSH 会话里定义并运行。全程不写 profile、不重启 dsh，
// 工具即时生效；dsh 重启后需重新定义（会话级插件的天然特性）。
//
//   cordis_define({ plugin: {kind:'new', idPrefix:'cond'}, name:'conductor-hot',
//     purpose:'...', code: { host: <本文件函数体> } })
//   → cordis_run({ pluginId, packageId, mode:'run' })
//
// 之后在会话里说「用 conductor_dispatch 派 codex 干 XXX」即可。
return {
  name: 'conductor-hot',
  inject: ['tools', 'subprocess'],
  apply(ctx) {
    const AGENTS = [
      { id: 'codex', name: 'Codex', argv: ['codex', 'exec', '{task}'], install: 'npm i -g @openai/codex' },
      { id: 'claude-code', name: 'Claude Code', argv: ['claude', '-p', '{task}', '--output-format', 'text'], install: 'npm i -g @anthropic-ai/claude-code' },
      { id: 'trae', name: 'TraeCode', argv: ['traecli', 'exec', '{task}'], install: 'TraeCode CLI（docs.trae.cn）' },
      { id: 'opencode', name: 'OpenCode', argv: ['opencode', 'run', '{task}'], install: 'npm i -g opencode-ai' },
      { id: 'gemini', name: 'Gemini CLI', argv: ['gemini', '-p', '{task}'], install: 'npm i -g @google/gemini-cli' },
      { id: 'cursor', name: 'Cursor CLI', argv: ['cursor-agent', '-p', '{task}'], install: 'cursor.com/install' },
      { id: 'kimi', name: 'Kimi CLI', argv: ['kimi', '--prompt', '{task}'], install: 'npm i -g @moonshot-ai/kimi-code' },
      { id: 'qwen', name: 'Qwen Code', argv: ['qwen', '--prompt', '{task}'], install: 'npm i -g @qwen-code/qwen-code' },
      { id: 'copilot', name: 'Copilot CLI', argv: ['copilot', '-p', '{task}', '--allow-all-tools'], install: 'npm i -g @github/copilot' },
      { id: 'workbuddy', name: 'WorkBuddy', argv: ['workbuddy', '-p', '{task}'], install: '见官方教程' },
      { id: 'grok', name: 'Grok CLI', argv: ['grok', '-p', '{task}'], install: 'npm i -g @xai-official/grok' },
    ]

    const tool = harness.defineTool({
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
      timeoutMs: 10 * 60 * 1000 + 30_000,
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
        // Work directory: the current session's workspace first (Codex needs a
        // trusted git repo), then CONDUCTOR_CWD / harness cwd. No hardcoded path.
        const sessionCwd = exec?.agent?.session?.header?.cwd
        const hasProcess = typeof process !== 'undefined'
        const cwd = (typeof sessionCwd === 'string' && sessionCwd.trim())
          || (hasProcess && process.env && process.env.CONDUCTOR_CWD && process.env.CONDUCTOR_CWD.trim())
          || (hasProcess && process.cwd && process.cwd())
          || '.'
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
        const MAX = 20000
        let out = ''
        let err = ''
        child.stdout?.on('data', (chunk) => { if (out.length < MAX * 2) out += chunk })
        child.stderr?.on('data', (chunk) => { if (err.length < 8000) err += chunk })
        try { child.stdin?.end() } catch { /* 忽略 */ }
        const kill = () => { try { child.terminate?.() } catch { /* 忽略 */ } }
        const onAbort = () => kill()
        exec.signal?.addEventListener?.('abort', onAbort, { once: true })
        let timer
        const timedOut = new Promise((_, reject) => {
          timer = setTimeout(() => { kill(); reject(new Error('TIMEOUT')) }, 10 * 60 * 1000)
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
        let text = out.trim()
        if (text.length > MAX) {
          text = text.slice(0, Math.floor(MAX * 0.7))
            + `\n\n…[输出过长，已省略 ${text.length - MAX} 字符]…\n`
            + text.slice(-Math.floor(MAX * 0.25))
        }
        return text
      },
    })

    harness.registerTool(ctx, tool)
  },
}

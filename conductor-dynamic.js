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

    const shellQuote = (part) => {
      if (/^[A-Za-z0-9_./=-]+$/.test(part)) return part
      return `'${part.replaceAll("'", "'\\''")}'`
    }
    const resolveCwd = (exec) => {
      const sessionCwd = exec?.agent?.session?.header?.cwd
      const hasProcess = typeof process !== 'undefined'
      return (typeof sessionCwd === 'string' && sessionCwd.trim())
        || (hasProcess && process.env.CONDUCTOR_CWD?.trim())
        || (hasProcess && process.cwd())
        || '.'
    }
    const MAX_OUTPUT_CHARS = 20_000
    const OUTPUT_HEAD_CHARS = Math.floor(MAX_OUTPUT_CHARS * 0.7)
    const OUTPUT_TAIL_CHARS = Math.floor(MAX_OUTPUT_CHARS * 0.25)
    /** stderr is diagnostics only: bounded head + rolling tail (the real error prints last). */
    const STDERR_HEAD_CHARS = 4_000
    const STDERR_TAIL_CHARS = 2_000
    const ERROR_DETAIL_CHARS = 500
    /** Keep the head + rolling tail of an over-long result (true tail, true total). */
    const clipOutput = (head, tail, total, max = MAX_OUTPUT_CHARS) => {
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
    /** Template argv; CONDUCTOR_CODEX_MODEL overrides Codex's shared config.toml model. */
    const buildArgv = (agent, task, env) => {
      const argv = agent.argv.map((a) => a.split('{task}').join(task))
      if (agent.id === 'codex') {
        const model = env?.CONDUCTOR_CODEX_MODEL?.trim()
        if (model) argv.splice(2, 0, '-m', model) // codex exec -m <model> <task>
      }
      return argv
    }
    /**
     * Resolve argv[0] through the host subprocess service before spawning
     * (Node's spawn does not apply Windows PATHEXT; .CMD/.BAT shims can never be
     * launched because the provider never shell-interprets argv).
     */
    const resolveArgv0 = async (subprocess, agent, argv) => {
      if (typeof subprocess.resolveExecutable !== 'function') return argv
      const platform = typeof process !== 'undefined' ? process.platform : undefined
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
    /** Rebuild a bounded stderr transcript as head + optional elision marker + tail. */
    const formatStderr = (head, tail, total) => {
      if (total === 0 || head === '') return ''
      const tailStart = total - tail.length
      if (head.length > tailStart) return head + tail.slice(head.length - tailStart)
      const omitted = Math.max(0, total - head.length - tail.length)
      return `${head}\n\n…[stderr 已省略 ${omitted} 字符 / stderr truncated]…\n${tail}`
    }
    /** Keep the first and last part of a diagnostic so the real (trailing) error survives. */
    const errorDetail = (text) => {
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
    const renderPlan = ({ agent, task, cwd, argv }) => [
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

    const tool = harness.defineTool({
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
      timeoutMs: 10 * 60 * 1000 + 30_000,
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
        const env = typeof process !== 'undefined' ? process.env : undefined
        const argv = buildArgv(agent, args.task, env)
        const hasProcess = typeof process !== 'undefined'
        if (args.dryRun === true) {
          const plannedCwd = resolveCwd(exec)
          const subprocess = ctx.get('subprocess')
          let previewArgv = argv
          if (subprocess && typeof subprocess.resolveExecutable === 'function') {
            try {
              previewArgv = await resolveArgv0(subprocess, agent, argv)
            } catch { /* preview keeps the template argv; real dispatch reports the install hint */ }
          }
          return renderPlan({ agent, task: args.task, cwd: plannedCwd, argv: previewArgv })
        }
        // Work directory: the current session's workspace first (Codex needs a
        // trusted git repo), then CONDUCTOR_CWD / harness cwd. No hardcoded path.
        const sessionCwd = exec?.agent?.session?.header?.cwd
        const cwd = (typeof sessionCwd === 'string' && sessionCwd.trim())
          || (hasProcess && process.env && process.env.CONDUCTOR_CWD && process.env.CONDUCTOR_CWD.trim())
          || (hasProcess && process.cwd && process.cwd())
          || '.'
        const subprocess = ctx.get('subprocess')
        if (!subprocess) {
          throw new Error('宿主 subprocess 服务不可用')
        }
        if (exec.signal?.aborted) throw new Error('已取消')
        let spawnArgv
        try {
          spawnArgv = await resolveArgv0(subprocess, agent, argv)
        } catch (error) {
          if (exec.signal?.aborted) throw new Error('已取消')
          throw error
        }
        if (exec.signal?.aborted) throw new Error('已取消')
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
          throw new Error(`${agent.name} 启动失败：${message}。安装：${agent.install}`)
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
        })
        try { child.stdin?.end() } catch { /* 忽略 */ }
        const kill = () => { try { child.terminate?.() } catch { /* 忽略 */ } }
        let timer
        const timedOut = new Promise((_, reject) => {
          timer = setTimeout(() => { kill(); reject(new Error('TIMEOUT')) }, 10 * 60 * 1000)
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
          if (outcome && outcome.exitCode !== 0) {
            const stderrText = formatStderr(errHead, errTail, errTotal).trim()
            const detail = stderrText || clipOutput(out, tail, total)
            throw new Error(`${agent.name} 退出码 ${outcome.exitCode}：${errorDetail(detail)}`)
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
          if (onAbort) exec.signal?.removeEventListener?.('abort', onAbort)
        }
        return clipOutput(out, tail, total)
      },
    })

    harness.registerTool(ctx, tool)
  },
}

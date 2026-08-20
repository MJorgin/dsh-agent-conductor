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
  inject: ['tools'],
  apply(ctx) {
    const AGENTS = [
      { id: 'codex', name: 'Codex', argv: ['codex', 'exec', '{task}'], install: 'codex CLI（~/.codex/plugins/.plugin-appserver/codex 可软链到 PATH）' },
      { id: 'claude-code', name: 'Claude Code', argv: ['claude', '-p', '{task}', '--output-format', 'text'], install: 'npm i -g @anthropic-ai/claude-code' },
      { id: 'trae', name: 'TraeCode', argv: ['traecli', 'exec', '{task}'], install: 'TraeCode CLI（docs.trae.cn）' },
      { id: 'opencode', name: 'OpenCode', argv: ['opencode', 'run', '{task}'], install: 'npm i -g opencode-ai' },
      { id: 'gemini', name: 'Gemini CLI', argv: ['gemini', '-p', '{task}'], install: 'npm i -g @google/gemini-cli' },
      { id: 'cursor', name: 'Cursor CLI', argv: ['cursor-agent', '-p', '{task}'], install: 'cursor.com/install' },
      { id: 'kimi', name: 'Kimi CLI', argv: ['kimi', '--prompt', '{task}'], install: 'npm i -g kimi-cli' },
      { id: 'qwen', name: 'Qwen Code', argv: ['qwen', '--prompt', '{task}'], install: 'npm i -g @qwen-code/qwen-code' },
      { id: 'copilot', name: 'Copilot CLI', argv: ['github-copilot', '--prompt', '{task}'], install: 'npm i -g @github/copilot' },
      { id: 'workbuddy', name: 'WorkBuddy', argv: ['workbuddy', '-p', '{task}'], install: '见官方教程' },
      { id: 'grok', name: 'Grok CLI', argv: ['grok', '-p', '{task}'], install: 'xAI 官方安装' },
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
        let child
        try {
          child = subprocess.spawn({
            argv,
            cwd: '/Users/mj/deepseek-harness',
            stdio: { stdin: 'pipe', stdout: 'pipe', stderr: 'pipe' },
            graceMs: 15000,
          })
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          throw new Error(`${agent.name} 启动失败：${message}。安装：${agent.install}`)
        }
        let out = ''
        let err = ''
        child.stdout.on('data', (chunk) => { out += chunk })
        child.stderr.on('data', (chunk) => { err += chunk })
        try { child.stdin.end() } catch { /* 忽略 */ }
        const aborted = new Promise((_, reject) => {
          if (!exec.signal) return
          exec.signal.addEventListener('abort', () => reject(new Error('已取消')), { once: true })
        })
        try {
          const outcome = await Promise.race([child.done, aborted])
          if (outcome && outcome.exitCode !== 0) {
            throw new Error(`${agent.name} 退出码 ${outcome.exitCode}：${(err || out).trim().slice(0, 400) || '(无输出)'}`)
          }
        } catch (error) {
          if (error && /exitCode|退出码/.test(String(error.message))) throw error
          const message = error instanceof Error ? error.message : String(error)
          if (/ENOENT|not found/i.test(message)) {
            throw new Error(`${agent.name} 未安装（或不在 PATH）。安装：${agent.install}`)
          }
          throw error
        }
        return out.trim()
      },
    })

    harness.registerTool(ctx, tool)
  },
}

/**
 * Independent QA harness (Agent D). Deliberately does NOT reuse any test
 * helper from the implementers' suites: it wires the REAL
 * `registerTaskboardRoutes` + REAL `ExecutionService` + REAL
 * `SchedulerService` + REAL `TaskStore` behind a real node:http server, so
 * every assertion exercises the production composition rather than a stub.
 *
 * Only the process-external faces are faked: the agent runtime (`agents`),
 * the event bus, and the workspace registry. The default task isolation is
 * `none`, so no git face is needed.
 *
 * @module dsh-taskboard/tests/qa/harness
 */
import { createServer, type Server } from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { registerTaskboardRoutes } from '../../src/host/routes.ts'
import { registerTaskboardTools, type WorkspaceFace } from '../../src/host/tools.ts'
import { TaskStore } from '../../src/host/store.ts'
import { ExecutionService, type AgentsFace, type EventsFace } from '../../src/host/execution.ts'
import { SchedulerService } from '../../src/host/scheduler.ts'
import type { TaskRecord } from '../../src/shared/protocol.ts'

/** The primary project every QA task lives in. */
export const QA_WS = { id: 'ws-qa', path: '/proj/qa', title: 'QA' }

/** A second project, used by the cross-workspace hierarchy/dependency negatives. */
export const QA_WS2 = { id: 'ws-qa-2', path: '/proj/qa2', title: 'QA2' }

/** A deterministic epoch (whole UTC + local minute). */
export const T0 = 1_700_000_040_000

/** Capturing agent-runtime fake: records sessions, resolves `whenIdle` on demand. */
export function fakeAgents(): AgentsFace & {
  created: Array<{ sessionId: string; cwd?: string }>
  disposed: string[]
  idle: (sessionId?: string) => void
} {
  const created: Array<{ sessionId: string; cwd?: string }> = []
  const disposed: string[] = []
  const idles = new Map<string, () => void>()
  const face = {
    created,
    disposed,
    idle: (sessionId?: string): void => {
      if (sessionId !== undefined) {
        idles.get(sessionId)?.()
        return
      }
      for (const resolve of [...idles.values()]) resolve()
    },
    async create(options: {
      sessionId: string
      meta?: { cwd?: string }
    }): Promise<{
      agent: {
        id: string
        followup(message: unknown): void
        inject(message: unknown): void
        whenIdle(): Promise<void>
      }
      dispose(): Promise<void>
    }> {
      created.push({ sessionId: options.sessionId, cwd: options.meta?.cwd })
      return {
        agent: {
          id: options.sessionId,
          followup: () => {},
          inject: () => {},
          whenIdle: () => new Promise<void>(resolve => { idles.set(options.sessionId, resolve) }),
        },
        dispose: async () => { disposed.push(options.sessionId) },
      }
    },
  }
  return face as never
}

/** Event-bus fake: no session events are ever produced in these tests. */
function fakeEvents(): EventsFace {
  return { onSessionEvent: () => () => {} }
}

/** A route/tool/execution/scheduler composition over one fresh ledger. */
export interface QaHost {
  dir: string
  base: string
  store: InstanceType<typeof TaskStore>
  execution: ExecutionService
  scheduler: SchedulerService
  agents: ReturnType<typeof fakeAgents>
  /** Mutable wall clock shared by routes, tools, execution and scheduler. */
  clock: { now: number }
  post(path: string, body?: unknown): Promise<{ status: number; json: any }>
  get(path: string): Promise<{ status: number; json: any }>
  /** Invoke one agent tool by name with the QA agent session. */
  tool(name: string, args: Record<string, unknown>): Promise<any>
  /** Render one tool output the way the model would see it. */
  render(name: string, args: Record<string, unknown>, value: unknown): string
  dispose(): Promise<void>
}

/** Build one isolated host (fresh ledger file, fresh HTTP server). */
export async function createQaHost(options: {
  /** Freeze the clock at this epoch (default T0). */
  at?: number
  /** Scheduler knobs (defaults: no throttle, 5min missed window, no queue shelf life). */
  scheduler?: { dispatchIntervalMs?: number; skipAfterMs?: number; queueMaxAgeMs?: number }
} = {}): Promise<QaHost> {
  const dir = await mkdtemp(join(tmpdir(), 'tb-qa-'))
  const store = new TaskStore({ file: join(dir, 'dsh-taskboard.json') })
  const clock = { now: options.at ?? T0 }
  const agents = fakeAgents()
  const now = (): number => clock.now

  const workspaces: WorkspaceFace = {
    resolveByPath: async path =>
      path === QA_WS.path ? { id: QA_WS.id } : path === QA_WS2.path ? { id: QA_WS2.id } : undefined,
    get: id =>
      id === QA_WS.id ? { ...QA_WS } : id === QA_WS2.id ? { ...QA_WS2 } : undefined,
    list: () => [{ ...QA_WS }, { ...QA_WS2 }],
  }

  const execution = new ExecutionService({
    store,
    agents,
    workspaces: {
      get: id =>
        id === QA_WS.id ? { id: QA_WS.id, path: QA_WS.path }
          : id === QA_WS2.id ? { id: QA_WS2.id, path: QA_WS2.path }
            : undefined,
      attach: async () => {},
    },
    events: fakeEvents(),
    now,
    mintSessionId: (() => { let n = 0; return () => `qa-session-${++n}` })(),
    mintMessageId: (() => { let n = 0; return () => `qa-msg-${++n}` })(),
    settlementRetryDelaysMs: [],
  })

  const scheduler = new SchedulerService({
    store,
    execution,
    now,
    dispatchIntervalMs: options.scheduler?.dispatchIntervalMs ?? 0,
    skipAfterMs: options.scheduler?.skipAfterMs ?? 5 * 60_000,
    queueMaxAgeMs: options.scheduler?.queueMaxAgeMs ?? 0,
  })

  // ---------------------------------------------------------------- routes
  const routes: Array<{ kind: string; path: string; handler: (req: never, res: never) => void }> = []
  const ctxFace = {
    webServer: {
      register: (route: { kind: string; path: string; handler: (req: never, res: never) => void }) => {
        routes.push(route)
        return () => {}
      },
    },
  }
  const disposeRoutes = registerTaskboardRoutes(ctxFace as never, {
    store,
    workspaces,
    now,
    run: (taskId, runOptions) => execution.run(taskId, 'manual', runOptions),
    commentRun: taskId => execution.deliverComments(taskId),
    cancel: taskId => execution.cancel(taskId),
    clearQueue: () => scheduler.clearQueue(),
    modelProviders: () => ['prov-qa'],
  })

  const server: Server = createServer()
  server.on('request', (req, res) => {
    const url = new URL(req.url ?? '/', 'http://x')
    const hit = routes.find(r => r.kind === 'exact' && url.pathname === r.path)
      ?? routes.find(r => r.kind === 'prefix' && url.pathname.startsWith(r.path))
    if (hit !== undefined) hit.handler(req as never, res as never)
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`

  // ----------------------------------------------------------------- tools
  const registered = new Map<string, {
    execute(args: unknown, exec: unknown): Promise<unknown>
    output: { render(args: unknown, value: unknown): Array<{ type: string; text: string }> }
  }>()
  const disposeTools = registerTaskboardTools(
    { tools: { register: (tool: never) => { registered.set((tool as { name: string }).name, tool); return () => {} } } } as never,
    { store, workspaces, now, modelProviders: () => ['prov-qa'] },
  )
  const exec = { agent: { id: 'qa-agent-session', session: { header: { cwd: QA_WS.path } } } }

  const post = async (path: string, body?: unknown): Promise<{ status: number; json: any }> => {
    const res = await fetch(`${base}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    })
    return { status: res.status, json: await res.json().catch(() => null) }
  }
  const get = async (path: string): Promise<{ status: number; json: any }> => {
    const res = await fetch(`${base}${path}`)
    return { status: res.status, json: await res.json().catch(() => null) }
  }

  return {
    dir,
    base,
    store,
    execution,
    scheduler,
    agents,
    clock,
    post,
    get,
    async tool(name, args) {
      const tool = registered.get(name)
      if (tool === undefined) throw new Error(`tool not registered: ${name}`)
      return tool.execute(args, exec)
    },
    render(name, args, value) {
      const tool = registered.get(name)
      if (tool === undefined) throw new Error(`tool not registered: ${name}`)
      return tool.output.render(args, value)[0]!.text
    },
    async dispose() {
      execution.dispose?.()
      scheduler.dispose()
      for (const dispose of disposeTools.splice(0)) dispose()
      disposeRoutes()
      await new Promise<void>(resolve => server.close(() => resolve()))
      await rm(dir, { recursive: true, force: true })
    },
  }
}

/** A complete plausible task record (bypasses routes; used to seed ledgers). */
export function taskRecord(overrides: Partial<TaskRecord> & { id: string }): TaskRecord {
  const { id, ...rest } = overrides
  return {
    id,
    title: `task ${id}`,
    description: '',
    prompt: '',
    workspaceId: QA_WS.id,
    urgency: 'normal',
    status: 'todo',
    blocked: false,
    execution: { mode: 'claim' },
    version: 1,
    createdAt: T0,
    updatedAt: T0,
    createdBy: { kind: 'user' },
    updatedBy: { kind: 'user' },
    comments: [],
    executions: [],
    ...rest,
  }
}

/** Seed a ledger FILE and return a fresh unloaded store (simulates restart). */
export async function seedLedger(dir: string, name: string, tasks: TaskRecord[]): Promise<InstanceType<typeof TaskStore>> {
  const { writeFile } = await import('node:fs/promises')
  const file = join(dir, name)
  await writeFile(file, JSON.stringify({ schemaVersion: 1, revision: 1, tasks }, null, 2))
  return new TaskStore({ file })
}

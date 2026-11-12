/**
 * Regression suite for the 2026-11-12 autonomy audit remediation.
 * Every test exercises the production composition (routes/services/tools),
 * with temporary ledgers only.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ExecutionService } from '../../src/host/execution.ts'
import { PublicApiService } from '../../src/host/public-api.ts'
import { TaskStore } from '../../src/host/store.ts'
import { registerTaskboardTools } from '../../src/host/tools.ts'
import { PUBLIC_API_PREFIX } from '../../src/shared/public-api.ts'
import type { TaskRecord } from '../../src/shared/protocol.ts'
import { createQaHost, QA_WS, QA_WS2, T0, taskRecord, seedLedger, type QaHost } from './harness.ts'

const hosts: QaHost[] = []
const dirs: string[] = []
afterEach(async () => {
  while (hosts.length > 0) await hosts.pop()!.dispose()
  while (dirs.length > 0) await rm(dirs.pop()!, { recursive: true, force: true })
})

async function host(): Promise<QaHost> {
  const h = await createQaHost({ at: T0 })
  hosts.push(h)
  return h
}

async function tmp(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'tb-audit-remediation-'))
  dirs.push(dir)
  return dir
}

const workspacesFace = {
  resolveByPath: async (path: string) => path === '/proj/a' ? { id: 'ws-a' } : path === '/proj/b' ? { id: 'ws-b' } : undefined,
  get: (id: string) => id === 'ws-a' ? { id: 'ws-a', path: '/proj/a', title: 'A' } : id === 'ws-b' ? { id: 'ws-b', path: '/proj/b', title: 'B' } : undefined,
  list: () => [{ id: 'ws-a', path: '/proj/a', title: 'A' }, { id: 'ws-b', path: '/proj/b', title: 'B' }],
}

describe('audit A08 — human-facing flags are execution barriers', () => {
  it('the scheduler never fires a blocked or waiting one-shot', async () => {
    for (const flag of ['blocked', 'waitingForHuman'] as const) {
      const h = await host()
      await h.store.mutate('task-created', ledger => {
        const task = taskRecord({ id: `one-${flag}`, execution: { mode: 'scheduled', runAt: T0 - 1000 } })
        if (flag === 'blocked') task.blocked = true
        else task.waitingForHuman = true
        ledger.tasks.push(task)
        return [task]
      })
      await h.scheduler.tick()
      const task = h.store.get(`one-${flag}`)!
      expect(task.executions).toHaveLength(0)
      expect(task.execution.runAt).toBe(T0 - 1000)
      expect(h.agents.created).toHaveLength(0)
    }
  })

  it('the execution gate refuses an automatic trigger on a blocked card', async () => {
    const h = await host()
    const id = (await h.post('/dsh-taskboard/tasks', { title: 'blocked', workspaceId: QA_WS.id, urgency: 'normal' })).json.value.id as string
    await h.store.mutate('task-updated', ledger => {
      const task = ledger.tasks.find(entry => entry.id === id)!
      task.blocked = true
      return [task]
    })
    const result = await h.execution.run(id, 'scheduled')
    expect(result.ok).toBe(false)
    expect(String((result as { error: string }).error)).toContain('blocked')
    expect(h.store.get(id)!.executions).toHaveLength(0)
  })

  it('the public API refuses a card waiting for a human decision', async () => {
    const dir = await tmp()
    const store = new TaskStore({ file: join(dir, 'tasks.json') })
    const api = new PublicApiService({ store, workspaces: workspacesFace, now: () => T0, token: () => 'audit-token' })
    try {
      await store.mutate('task-created', ledger => {
        const task = taskRecord({ id: 'waiting', waitingForHuman: true, waitingReason: 'decision' })
        ledger.tasks.push(task)
        return [task]
      })
      let status = 0; let raw = ''
      await api.handle({ method: 'POST', headers: { authorization: 'Bearer audit-token' } } as never,
        { writeHead: (value: number) => { status = value }, write: (chunk: string) => { raw += chunk; return true }, end: (chunk?: string) => { raw += chunk ?? '' } } as never,
        new URL(`http://localhost${PUBLIC_API_PREFIX}/executions/claim`),
        { taskId: 'waiting', actor: 'engine', idempotencyKey: 'k1' })
      expect(status).toBe(409)
      expect(JSON.parse(raw).error.message).toContain('waiting for a human')
      expect(store.get('waiting')!.executions).toHaveLength(0)
    } finally { api.dispose() }
  })
})

describe('audit A10/A11 — the project boundary covers every write', () => {
  it('a foreign session cannot edit another project checklist', async () => {
    const dir = await tmp()
    const store = new TaskStore({ file: join(dir, 'tasks.json') })
    await store.load()
    await store.mutate('task-created', ledger => {
      const task = taskRecord({ id: 'foreign', workspaceId: 'ws-b', checklist: [{ id: 'c1', text: 'x', checked: false }] })
      ledger.tasks.push(task)
      return [task]
    })
    const registered = new Map<string, { execute(args: unknown, exec: unknown): Promise<unknown> }>()
    registerTaskboardTools({ tools: { register: (tool: never) => { const t = tool as { name: string; execute(args: unknown, exec: unknown): Promise<unknown> }; registered.set(t.name, t); return () => {} } } } as never,
      { store, workspaces: workspacesFace as never, now: () => T0 })
    const foreignExec = { agent: { id: 'sess-b', session: { header: { cwd: '/proj/b' } } } }
    const localExec = { agent: { id: 'sess-a', session: { header: { cwd: '/proj/a' } } } }
    await expect(registered.get('taskboard_checklist')!.execute({ id: 'foreign', action: 'add', ifVersion: 1, items: ['hack'] }, localExec))
      .rejects.toThrow('workspace_mismatch')
    const own = await registered.get('taskboard_checklist')!.execute({ id: 'foreign', action: 'add', ifVersion: 1, items: ['ok'] }, foreignExec) as { total: number }
    expect(own.total).toBe(2)
  })

  it('an agent session cannot run a global sync or push a foreign card', async () => {
    const dir = await tmp()
    const store = new TaskStore({ file: join(dir, 'tasks.json') })
    await store.load()
    await store.mutate('task-created', ledger => {
      const task = taskRecord({ id: 'foreign-card', workspaceId: 'ws-b' })
      ledger.tasks.push(task)
      return [task]
    })
    const calls = { sync: 0, push: 0 }
    const face = { sync: async () => { calls.sync += 1; return { created: 0, updated: 0, unchanged: 0, conflicts: 0, ignored: 0, at: T0 } }, pushTask: async () => { calls.push += 1; throw new Error('must not be reached') } }
    const registered = new Map<string, { execute(args: unknown, exec: unknown): Promise<unknown> }>()
    registerTaskboardTools({ tools: { register: (tool: never) => { const t = tool as { name: string; execute(args: unknown, exec: unknown): Promise<unknown> }; registered.set(t.name, t); return () => {} } } } as never,
      { store, workspaces: workspacesFace as never, now: () => T0, externalSync: () => face as never })
    const exec = { agent: { id: 'sess-a', session: { header: { cwd: '/proj/a' } } } }
    await expect(registered.get('taskboard_external_sync')!.execute({}, exec)).rejects.toThrow('full external sync spans every project')
    await expect(registered.get('taskboard_external_sync')!.execute({ taskId: 'foreign-card' }, exec)).rejects.toThrow('workspace_mismatch')
    expect(calls).toEqual({ sync: 0, push: 0 })
  })
})

describe('audit A15 — a manual claim can submit its structured report', () => {
  it('stores the report on the task when the session holds the claim', async () => {
    const h = await host()
    const created = await h.post('/dsh-taskboard/tasks', { title: 'manual', workspaceId: QA_WS.id, urgency: 'normal' })
    const id = created.json.value.id as string
    await h.tool('taskboard_move', { id, status: 'in_progress', ifVersion: 1 })
    const value = await h.tool('taskboard_execution_report', {
      summary: 'manual work done', changedFiles: ['src/a.ts'], checks: ['npm test'],
    }) as { taskId: string; executionId?: string }
    expect(value.taskId).toBe(id)
    expect(value.executionId).toBeUndefined()
    expect(h.store.get(id)!.report?.summary).toBe('manual work done')
    const read = await h.tool('taskboard_get', { id }) as { task: TaskRecord }
    expect(read.task.report?.summary).toBe('manual work done')
  })
})

describe('audit A09 — an interrupted one-shot is never silently lost or replayed', () => {
  async function reconcileFixture(task: TaskRecord) {
    const dir = await tmp()
    const store = await seedLedger(dir, 'tasks.json', [task])
    const execution = new ExecutionService({
      store,
      agents: { create: async () => { throw new Error('must not create') } } as never,
      workspaces: { get: () => ({ id: 'ws-a', path: '/proj/a' }), attach: async () => {} } as never,
      events: { onSessionEvent: () => () => {} },
      now: () => T0 + 5000,
      liveAgent: () => undefined,
    })
    await execution.reconcile()
    return { store, execution }
  }

  it('re-arms a run that never started', async () => {
    const { store, execution } = await reconcileFixture(taskRecord({
      id: 'never-started',
      execution: { mode: 'scheduled' },
      executions: [{ id: 'e1', trigger: 'scheduled', startedAt: T0, outcome: 'running' }],
    }))
    try {
      const task = store.get('never-started')!
      expect(task.executions[0]!.outcome).toBe('failed')
      expect(task.execution.runAt).toBe(T0 + 5000)
      expect(task.comments.some(comment => comment.systemKey === 'sys.execution.rearmed')).toBe(true)
    } finally { execution.dispose() }
  })

  it('marks a started run as requiring an explicit recovery decision', async () => {
    const { store, execution } = await reconcileFixture(taskRecord({
      id: 'started',
      execution: { mode: 'scheduled' },
      executions: [{ id: 'e2', trigger: 'scheduled', startedAt: T0, sessionId: 'sess-x', outcome: 'running' }],
    }))
    try {
      const task = store.get('started')!
      expect(task.executions[0]!.outcome).toBe('failed')
      expect(task.execution.recoveryRequired).toBe(true)
      expect(task.comments.some(comment => comment.systemKey === 'sys.execution.recoveryRequired')).toBe(true)
      const scheduled = await execution.run('started', 'scheduled')
      expect(scheduled.ok).toBe(false)
      expect(String((scheduled as { error: string }).error)).toContain('recovery')
    } finally { execution.dispose() }
  })
})

describe('audit A02 — an explicit permission fails closed', () => {
  it('refuses to start a read-only card when the host cannot apply it', async () => {
    const h = await host()
    const created = await h.post('/dsh-taskboard/tasks', { title: 'readonly', workspaceId: QA_WS.id, urgency: 'normal', permission: 'read-only' })
    const id = created.json.value.id as string
    const result = await h.execution.run(id, 'manual')
    expect(result.ok).toBe(false)
    expect(String((result as { error: string }).error)).toContain('permission could not be applied')
    // The session is created first (the preset switch needs it), then closed
    // without ever receiving the prompt; the card returns to todo.
    expect(h.agents.disposed).toHaveLength(1)
    expect(h.store.get(id)!.status).toBe('todo')
    expect(h.store.get(id)!.executions.at(-1)).toMatchObject({ outcome: 'failed' })
  })
})

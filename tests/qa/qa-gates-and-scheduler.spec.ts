/**
 * QA (Agent D) — the five start paths, scheduler deferral and no-burst
 * behavior, and trash-during-claim coherence.
 *
 * @module dsh-taskboard/tests/qa/gates-and-scheduler
 */
import { afterEach, describe, expect, it } from 'vitest'
import type { TaskRecord } from '../../src/shared/protocol.ts'
import { createQaHost, QA_WS, T0, taskRecord, type QaHost } from './harness.ts'

const hosts: QaHost[] = []
afterEach(async () => {
  while (hosts.length > 0) await hosts.pop()!.dispose()
})

async function host(at = T0): Promise<QaHost> {
  const h = await createQaHost({ at })
  hosts.push(h)
  return h
}

async function createTask(h: QaHost, title: string, extra: Record<string, unknown> = {}): Promise<string> {
  const res = await h.post('/dsh-taskboard/tasks', { title, workspaceId: QA_WS.id, urgency: 'normal', ...extra })
  expect(res.status).toBe(201)
  return res.json.value.id as string
}

async function move(h: QaHost, id: string, status: string): Promise<{ status: number; json: any }> {
  return h.post(`/dsh-taskboard/tasks/${id}/move`, { ifVersion: h.store.get(id)!.version, status })
}

/** Drive A to done through the user route. */
async function driveDone(h: QaHost, id: string): Promise<void> {
  expect((await move(h, id, 'in_progress')).status).toBe(200)
  expect((await move(h, id, 'in_review')).status).toBe(200)
  expect((await move(h, id, 'done')).status).toBe(200)
}

describe('QA — all five start paths enforce unmet prerequisites (§7.2 / D4)', () => {
  it('path 1: agent claim via taskboard_move is refused', async () => {
    const h = await host()
    const a = await createTask(h, 'A')
    const b = await createTask(h, 'B', { dependsOn: [a] })
    await expect(
      h.tool('taskboard_move', { id: b, status: 'in_progress', ifVersion: 1 }),
    ).rejects.toThrow(/dependen/i)
    expect(h.store.get(b)!.status).toBe('todo')
  })

  it('path 2: GUI move to in_progress is refused', async () => {
    const h = await host()
    const a = await createTask(h, 'A')
    const b = await createTask(h, 'B', { dependsOn: [a] })
    const res = await move(h, b, 'in_progress')
    expect(res.status).toBeGreaterThanOrEqual(400)
    expect(h.store.get(b)!.status).toBe('todo')
  })

  it('path 3: GUI manual run is refused', async () => {
    const h = await host()
    const a = await createTask(h, 'A')
    const b = await createTask(h, 'B', { dependsOn: [a] })
    const res = await h.post(`/dsh-taskboard/tasks/${b}/run`, {})
    expect(res.status).toBeGreaterThanOrEqual(400)
    expect(h.store.get(b)!.executions).toHaveLength(0)
    expect(h.store.get(b)!.status).toBe('todo')
  })

  it('path 4: scheduled dispatch never fires a blocked task', async () => {
    const h = await host()
    await h.store.mutate('task-created', ledger => {
      ledger.tasks.push(
        taskRecord({ id: 'sched-a', status: 'todo' }),
        taskRecord({
          id: 'sched-b',
          status: 'todo',
          dependsOn: ['sched-a'],
          execution: { mode: 'scheduled', cron: '* * * * *', nextRunAt: T0 - 60_000 },
        }),
      )
      return []
    })
    await h.scheduler.tick()
    // The blocked task may be queued (deferred) but must never be dispatched.
    expect(h.agents.created).toHaveLength(0)
    expect(h.store.get('sched-b')!.status).toBe('todo')
  })

  it('path 5: comment wake is refused while a prerequisite is unmet', async () => {
    const h = await host()
    const a = await createTask(h, 'A')
    const b = await createTask(h, 'B', { dependsOn: [a] })
    await driveDone(h, a)
    // B reaches in_review through the normal workflow.
    expect((await move(h, b, 'in_progress')).status).toBe(200)
    expect((await move(h, b, 'in_review')).status).toBe(200)
    // Reopen the prerequisite: B is now in_review with an unmet prerequisite.
    expect((await move(h, a, 'todo')).status).toBe(200)
    const wake = await h.post(`/dsh-taskboard/tasks/${b}/comment-run`, { body: 'please look again' })
    expect(wake.status).toBeGreaterThanOrEqual(400)
    expect(String(wake.json?.error?.message ?? '')).toMatch(/dependen/i)
    expect(h.store.get(b)!.executions.filter(e => e.outcome === 'running')).toHaveLength(0)
  })
})

describe('QA — scheduler deferral (D3 / §7.6)', () => {
  it('a blocked one-shot missed while offline is DEFERRED, not spent, then dispatches exactly once', async () => {
    const h = await host()
    const due = T0 - 6 * 60_000
    await h.store.mutate('task-created', ledger => {
      ledger.tasks.push(
        taskRecord({ id: 'dep-a', status: 'todo' }),
        taskRecord({
          id: 'dep-b',
          status: 'todo',
          dependsOn: ['dep-a'],
          execution: { mode: 'scheduled', runAt: due },
        }),
      )
      return []
    })

    await h.scheduler.tick()
    const afterFirstTick = h.store.get('dep-b')!
    // NOT spent: a blocked one-shot keeps its schedule (claim conversion is
    // what "spent" looks like) and gets no "missed window" audit comment.
    expect(afterFirstTick.execution.mode).toBe('scheduled')
    expect(afterFirstTick.comments.some(c => c.systemKey === 'sys.runAtMissed')).toBe(false)
    // Deferred: the durable window is preserved somewhere (queued entry or runAt).
    expect(
      afterFirstTick.execution.queuedRunAt !== undefined || afterFirstTick.execution.runAt !== undefined,
    ).toBe(true)
    expect(h.agents.created).toHaveLength(0)

    // Unblock: the deferred work dispatches exactly once.
    await h.store.mutate('task-moved', ledger => {
      const a = ledger.tasks.find(t => t.id === 'dep-a')!
      a.status = 'done'
      a.version += 1
      return [a]
    })
    await h.scheduler.tick()
    expect(h.agents.created).toHaveLength(1)
    expect(h.store.get('dep-b')!.executions.filter(e => e.outcome === 'running')).toHaveLength(1)

    // No burst: another tick on the same clock must not open a second run.
    await h.scheduler.tick()
    expect(h.agents.created).toHaveLength(1)
    expect(h.store.get('dep-b')!.executions).toHaveLength(1)
  })

  it('a blocked periodic cron does not consume a missed window and does not burst after unblock', async () => {
    const h = await host()
    await h.store.mutate('task-created', ledger => {
      ledger.tasks.push(
        taskRecord({ id: 'cron-a', status: 'todo' }),
        taskRecord({
          id: 'cron-b',
          status: 'todo',
          dependsOn: ['cron-a'],
          execution: { mode: 'scheduled', cron: '* * * * *', nextRunAt: T0 - 6 * 60_000 },
        }),
      )
      return []
    })

    await h.scheduler.tick()
    const blocked = h.store.get('cron-b')!
    expect(blocked.comments.some(c => c.systemKey === 'sys.cronMissed')).toBe(false)
    expect(h.agents.created).toHaveLength(0)

    await h.store.mutate('task-moved', ledger => {
      const a = ledger.tasks.find(t => t.id === 'cron-a')!
      a.status = 'done'
      a.version += 1
      return [a]
    })
    await h.scheduler.tick()
    expect(h.agents.created).toHaveLength(1)
    await h.scheduler.tick()
    expect(h.agents.created).toHaveLength(1)
  })

  it('blocked queued work is not consumed by queueMaxAge expiry', async () => {
    const h = await createQaHost({ at: T0, scheduler: { queueMaxAgeMs: 60_000 } })
    hosts.push(h)
    await h.store.mutate('task-created', ledger => {
      ledger.tasks.push(
        taskRecord({ id: 'age-a', status: 'todo' }),
        taskRecord({
          id: 'age-b',
          status: 'todo',
          dependsOn: ['age-a'],
          execution: { mode: 'scheduled', cron: '* * * * *', nextRunAt: T0 + 60_000, queuedRunAt: T0 - 120_000, queuedAt: T0 - 61_000 },
        }),
      )
      return []
    })
    await h.scheduler.tick()
    const task = h.store.get('age-b')!
    // Deferred, never spent by the shelf-life policy while blocked.
    expect(task.execution.queuedRunAt).toBe(T0 - 120_000)
    expect(task.comments.some(c => c.systemKey === 'sys.queuedExpired')).toBe(false)
  })

  it('TOCTOU: a prerequisite reopened between queue selection and expiry must not spend the entry', async () => {
    // The scheduler selects `age-b` as ready from a snapshot, then the user
    // reopens `age-a` just before the expiry mutation commits. A correct
    // implementation re-checks readiness INSIDE that mutation and keeps the
    // one-shot deferred instead of converting it to a spent `claim`.
    const h = await createQaHost({ at: T0, scheduler: { queueMaxAgeMs: 60_000 } })
    hosts.push(h)
    await h.store.mutate('task-created', ledger => {
      ledger.tasks.push(
        taskRecord({ id: 'race-a', status: 'done' }),
        taskRecord({
          id: 'race-b',
          status: 'todo',
          dependsOn: ['race-a'],
          execution: { mode: 'scheduled', runAt: T0 - 120_000, queuedRunAt: T0 - 120_000, queuedAt: T0 - 61_000 },
        }),
      )
      return []
    })
    const originalMutate = h.store.mutate.bind(h.store)
    let injected = false
    ;(h.store as unknown as { mutate: typeof h.store.mutate }).mutate = async (kind, mutator) => {
      if (!injected && kind === 'task-updated') {
        injected = true
        // Concurrent user write that commits BEFORE the expiry mutation.
        await originalMutate('task-moved', ledger => {
          const a = ledger.tasks.find(t => t.id === 'race-a')!
          a.status = 'todo'
          a.version += 1
          return [a]
        })
      }
      return originalMutate(kind, mutator)
    }
    await h.scheduler.tick()
    expect(injected).toBe(true)
    const task = h.store.get('race-b')!
    // Not spent: mode stays scheduled, the durable entry survives, no audit
    // comment claims the window was dropped.
    expect(task.execution.mode).toBe('scheduled')
    expect(task.comments.some(c => c.systemKey === 'sys.queuedExpired')).toBe(false)
    expect(task.execution.queuedRunAt).toBe(T0 - 120_000)
    // And it must not have been dispatched either.
    expect(h.agents.created).toHaveLength(0)
  })

  it('TOCTOU: a prerequisite reopened before reserveDispatch must not dispatch or spend', async () => {
    const h = await host()
    await h.store.mutate('task-created', ledger => {
      ledger.tasks.push(
        taskRecord({ id: 'res-a', status: 'done' }),
        taskRecord({
          id: 'res-b',
          status: 'todo',
          dependsOn: ['res-a'],
          execution: { mode: 'scheduled', cron: '* * * * *', nextRunAt: T0 + 60_000, queuedRunAt: T0, queuedAt: T0 },
        }),
      )
      return []
    })
    const originalMutate = h.store.mutate.bind(h.store)
    let injected = false
    ;(h.store as unknown as { mutate: typeof h.store.mutate }).mutate = async (kind, mutator) => {
      if (!injected && kind === 'task-updated') {
        injected = true
        await originalMutate('task-moved', ledger => {
          const a = ledger.tasks.find(t => t.id === 'res-a')!
          a.status = 'todo'
          a.version += 1
          return [a]
        })
      }
      return originalMutate(kind, mutator)
    }
    await h.scheduler.tick()
    expect(injected).toBe(true)
    const task = h.store.get('res-b')!
    // Nothing opened; the durable entry survives for the next tick (deferred).
    expect(h.agents.created).toHaveLength(0)
    expect(task.executions).toHaveLength(0)
    expect(task.execution.queuedRunAt).toBe(T0)
    expect(task.execution.dispatchingRunAt).toBeUndefined()
  })
})

describe('QA — trash-during-claim coherence', () => {
  it('refuses to soft-delete a task with a running execution', async () => {
    const h = await host()
    const b = await createTask(h, 'running')
    expect((await h.post(`/dsh-taskboard/tasks/${b}/run`, {})).status).toBe(202)
    const deleted = await h.post(`/dsh-taskboard/tasks/${b}/delete`, { ifVersion: h.store.get(b)!.version })
    expect(deleted.status).toBeGreaterThanOrEqual(400)
    expect(h.store.get(b)!.trashedAt).toBeUndefined()
    h.agents.idle()
    await new Promise(resolve => setTimeout(resolve, 50))
  })

  it('trashing a prerequisite while a dependent is in_progress leaves that dependent running/unaffected', async () => {
    const h = await host()
    const a = await createTask(h, 'A')
    const b = await createTask(h, 'B', { dependsOn: [a] })
    await driveDone(h, a)
    expect((await h.post(`/dsh-taskboard/tasks/${b}/run`, {})).status).toBe(202)
    expect(h.store.get(b)!.executions.filter(e => e.outcome === 'running')).toHaveLength(1)

    const trashed = await h.post(`/dsh-taskboard/tasks/${a}/delete`, { ifVersion: h.store.get(a)!.version })
    expect(trashed.status).toBe(200)

    const after = h.store.get(b)!
    expect(after.status).toBe('in_progress')
    expect(after.executions.filter(e => e.outcome === 'running')).toHaveLength(1)
    expect(after.dependsOn ?? []).not.toContain(a)
    expect(after.comments.some(c => c.systemKey === 'sys.prerequisiteRemoved')).toBe(true)
    h.agents.idle()
    await new Promise(resolve => setTimeout(resolve, 50))
  })
})

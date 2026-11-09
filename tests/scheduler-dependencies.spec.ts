/**
 * Scheduler dependency-deferral tests (F3/F4, D3): blocked scheduled work is
 * DEFERRED, never spent, survives restart unchanged, does not burst after
 * unblocking — while ordinary queued work keeps its existing shelf-life /
 * dispatch behaviour.
 *
 * Harness mirrors tests/scheduler-lifecycle.spec.ts: a REAL TaskStore over a
 * mkdtemp ledger file seeded directly, an injected clock (no fake timers
 * needed because dispatchIntervalMs=0 disables the rate gate), and a
 * run-counting execution face. Every assertion is deterministic: the clock is
 * only moved explicitly when a test needs "time passed while blocked".
 *
 * @module dsh-taskboard/tests/scheduler-dependencies
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import type { ExecutionService } from '../src/host/execution.ts'
import { SchedulerService } from '../src/host/scheduler.ts'
import { TaskStore } from '../src/host/store.ts'
import type { ExecutionConfig, TaskRecord } from '../src/shared/protocol.ts'

/** Deterministic epoch base: a whole UTC minute. */
const T0 = 1_700_000_040_000
const MINUTE = 60_000

let dir: string
let storeSeq = 0
let scheduler: SchedulerService | undefined
const cleanups: Array<() => void> = []

/** A complete plausible scheduled task record for the seeded ledger file. */
function task(id: string, execution: ExecutionConfig, extra: Partial<TaskRecord> = {}): TaskRecord {
  return {
    id,
    title: `task ${id}`,
    description: '',
    prompt: '',
    workspaceId: 'ws-sched',
    urgency: 'normal',
    status: 'todo',
    blocked: false,
    execution,
    version: 1,
    createdAt: T0,
    updatedAt: T0,
    createdBy: { kind: 'user' },
    updatedBy: { kind: 'user' },
    comments: [],
    executions: [],
    ...extra,
  }
}

/** Seed a ledger FILE and hand back a fresh, not-yet-loaded store. */
async function seed(tasks: TaskRecord[]): Promise<InstanceType<typeof TaskStore>> {
  storeSeq += 1
  const file = join(dir, `ledger-${storeSeq}.json`)
  await writeFile(file, JSON.stringify({ schemaVersion: 1, revision: 1, tasks }, null, 2))
  return new TaskStore({ file })
}

/** Scheduler over one store: records dispatches, one-at-a-time, no rate gate. */
function makeScheduler(target: InstanceType<typeof TaskStore>, runs: Array<{ id: string }>, clock: { now: number }, options: { queueMaxAgeMs?: number } = {}): SchedulerService {
  const executionFace: Pick<ExecutionService, 'run' | 'inFlight'> = {
    run: async (taskId, trigger) => {
      runs.push({ id: taskId })
      return { ok: true, executionId: `e-${taskId}`, sessionId: `s-${taskId}` }
    },
    inFlight: () => 0,
  }
  const created = new SchedulerService({
    store: target,
    execution: executionFace,
    now: () => clock.now,
    queueMaxAgeMs: options.queueMaxAgeMs ?? 0,
    dispatchIntervalMs: 0,
  })
  cleanups.push(() => created.dispose())
  return created
}

/** Mark a prerequisite accepted by the human (the only satisfying state). */
async function accept(target: InstanceType<typeof TaskStore>, id: string): Promise<void> {
  await target.mutate('task-moved', ledger => {
    const prerequisite = ledger.tasks.find(item => item.id === id)!
    prerequisite.status = 'done'
    prerequisite.version += 1
    return [prerequisite]
  })
}

beforeAll(async () => { dir = await mkdtemp(join(tmpdir(), 'tb-sched-deps-')) })
afterEach(() => { while (cleanups.length > 0) cleanups.pop()?.(); scheduler = undefined })
afterAll(async () => { await rm(dir, { recursive: true, force: true }) })

describe('scheduler dependency deferral (F3/D3)', () => {
  it('defers a dependency-blocked one-shot instead of spending it as a missed window', async () => {
    const clock = { now: T0 }
    const store = await seed([
      task('prereq', { mode: 'claim' }),
      task('one-shot', { mode: 'scheduled', runAt: T0 - 10 * MINUTE }, { dependsOn: ['prereq'] }),
    ])
    const runs: Array<{ id: string }> = []
    scheduler = makeScheduler(store, runs, clock)

    await scheduler.tick()

    // Not spent: the runAt became a durable queue entry, with NO "missed" comment.
    expect(runs).toEqual([])
    const deferred = store.get('one-shot')!
    expect(deferred.execution.runAt).toBeUndefined()
    expect(deferred.execution.queuedRunAt).toBe(T0 - 10 * MINUTE)
    expect(deferred.execution.queuedAt).toBe(T0)
    expect(deferred.execution.mode).toBe('scheduled')
    expect(deferred.comments.some(comment => comment.systemKey === 'sys.runAtMissed')).toBe(false)
    // The ledger revision moved (queue write) but the card was not dispatched.
    expect(store.get('prereq')!.status).toBe('todo')

    // A second tick while still blocked dispatches nothing and keeps the entry.
    await scheduler.tick()
    expect(runs).toEqual([])
    expect(store.get('one-shot')!.execution.queuedRunAt).toBe(T0 - 10 * MINUTE)

    // Unblocking dispatches exactly once, then the queue entry is consumed.
    await accept(store, 'prereq')
    await scheduler.tick()
    expect(runs).toEqual([{ id: 'one-shot' }])
    const dispatched = store.get('one-shot')!
    expect(dispatched.execution.queuedRunAt).toBeUndefined()
    expect(dispatched.execution.dispatchingRunAt).toBeUndefined()
    expect(dispatched.execution.lastTriggeredAt).toBe(T0 - 10 * MINUTE)

    // No burst: another tick immediately after must not re-dispatch.
    await scheduler.tick()
    expect(runs).toHaveLength(1)
  })

  it('exempts a dependency-blocked queued entry from queueMaxAgeMs expiry', async () => {
    const clock = { now: T0 }
    const store = await seed([
      task('prereq', { mode: 'claim' }),
      task('queued', {
        mode: 'scheduled',
        queuedRunAt: T0 - 5 * MINUTE,
        queuedAt: T0 - 5 * MINUTE,
      }, { dependsOn: ['prereq'] }),
    ])
    const runs: Array<{ id: string }> = []
    scheduler = makeScheduler(store, runs, clock, { queueMaxAgeMs: MINUTE })

    await scheduler.tick()

    // The shelf life would normally have expired this entry (age 5min > 1min);
    // dependency-blocked work is exempt: still queued, no "expired" comment.
    expect(runs).toEqual([])
    const queued = store.get('queued')!
    expect(queued.execution.queuedRunAt).toBe(T0 - 5 * MINUTE)
    expect(queued.execution.queuedAt).toBeUndefined()
    expect(queued.comments.some(comment => comment.systemKey === 'sys.queuedExpired')).toBe(false)
    expect(queued.execution.mode).toBe('scheduled')

    // Let an hour pass while blocked, then accept: it dispatches once.
    clock.now = T0 + 60 * MINUTE
    await scheduler.tick()
    expect(runs).toEqual([])
    await accept(store, 'prereq')
    await scheduler.tick()
    expect(runs).toEqual([{ id: 'queued' }])
  })

  it('queues a blocked periodic window instead of applying the missed-window policy, and never bursts', async () => {
    const clock = { now: T0 }
    const store = await seed([
      task('prereq', { mode: 'claim' }),
      task('cron', { mode: 'scheduled', cron: '* * * * *', nextRunAt: T0 - 10 * MINUTE }, { dependsOn: ['prereq'] }),
    ])
    const runs: Array<{ id: string }> = []
    scheduler = makeScheduler(store, runs, clock)

    await scheduler.tick()

    expect(runs).toEqual([])
    const deferred = store.get('cron')!
    // The overdue window is the durable queue entry, not a silently skipped one.
    expect(deferred.execution.queuedRunAt).toBe(T0 - 10 * MINUTE)
    expect(deferred.execution.nextRunAt).toBe(T0 + MINUTE) // advancing, no catch-up
    expect(deferred.comments.some(comment => comment.systemKey === 'sys.cronMissed')).toBe(false)

    // Three more minutes pass while still blocked: the window is NOT re-queued
    // or consumed, and nothing runs.
    clock.now = T0 + 3 * MINUTE
    await scheduler.tick()
    expect(runs).toEqual([])
    expect(store.get('cron')!.execution.queuedRunAt).toBe(T0 - 10 * MINUTE)

    // Unblock: exactly one dispatch, and the next window is computed from the
    // DISPATCH time (clock = T0+3min → next whole minute T0+4min), so the
    // backlog cannot replay.
    await accept(store, 'prereq')
    await scheduler.tick()
    expect(runs).toEqual([{ id: 'cron' }])
    const dispatched = store.get('cron')!
    expect(dispatched.execution.nextRunAt).toBe(T0 + 4 * MINUTE)
    expect(dispatched.execution.nextRunAt!).toBeGreaterThan(clock.now)

    await scheduler.tick()
    expect(runs).toHaveLength(1)
  })

  it('defers across a host restart and dispatches once after the prerequisites are met', async () => {
    const clock = { now: T0 }
    const firstStore = await seed([
      task('prereq', { mode: 'claim' }),
      task('one-shot', { mode: 'scheduled', runAt: T0 - 10 * MINUTE }, { dependsOn: ['prereq'] }),
    ])
    const firstRuns: Array<{ id: string }> = []
    scheduler = makeScheduler(firstStore, firstRuns, clock)
    await scheduler.tick()
    expect(firstRuns).toEqual([])
    expect(firstStore.get('one-shot')!.execution.queuedRunAt).toBe(T0 - 10 * MINUTE)

    // Restart: a brand-new store + scheduler over the same ledger file.
    const restartedStore = new TaskStore({ file: firstStore.location() })
    const restartedRuns: Array<{ id: string }> = []
    const restarted = makeScheduler(restartedStore, restartedRuns, clock)
    clock.now = T0 + 30 * MINUTE
    await restarted.tick()
    // Still blocked: the durable entry survived the restart unchanged.
    expect(restartedRuns).toEqual([])
    expect(restartedStore.get('one-shot')!.execution.queuedRunAt).toBe(T0 - 10 * MINUTE)

    await accept(restartedStore, 'prereq')
    await restarted.tick()
    expect(restartedRuns).toEqual([{ id: 'one-shot' }])
    expect(restartedStore.get('one-shot')!.execution.queuedRunAt).toBeUndefined()
  })

  it('keeps normal queue behaviour: a blocked entry neither dispatches nor starves ready work', async () => {
    const clock = { now: T0 }
    const store = await seed([
      task('prereq', { mode: 'claim' }),
      task('blocked', { mode: 'scheduled', queuedRunAt: T0 - 2 * MINUTE, queuedAt: T0 - 2 * MINUTE }, { dependsOn: ['prereq'] }),
      task('ready', { mode: 'scheduled', queuedRunAt: T0 - MINUTE, queuedAt: T0 - 30_000 }),
      task('stale', { mode: 'scheduled', queuedRunAt: T0 - 120 * MINUTE, queuedAt: T0 - 120 * MINUTE }),
    ])
    const runs: Array<{ id: string }> = []
    scheduler = makeScheduler(store, runs, clock, { queueMaxAgeMs: MINUTE })

    await scheduler.tick()

    // Ready + expired → spent with the audit comment; ready → dispatched;
    // blocked → untouched and exempt.
    expect(runs).toEqual([{ id: 'ready' }])
    expect(store.get('stale')!.execution.queuedRunAt).toBeUndefined()
    expect(store.get('stale')!.comments.some(comment => comment.systemKey === 'sys.queuedExpired')).toBe(true)
    expect(store.get('blocked')!.execution.queuedRunAt).toBe(T0 - 2 * MINUTE)
    expect(store.get('blocked')!.execution.queuedAt).toBeUndefined()
    expect(store.get('blocked')!.comments.some(comment => comment.systemKey === 'sys.queuedExpired')).toBe(false)
  })
})

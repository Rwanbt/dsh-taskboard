/**
 * Host-side cron scheduler: one tick per minute over the ledger's scheduled
 * tasks. Due tasks are first durably queued, then dispatched FIFO as global
 * capacity becomes available. A queued window remains eligible across a host
 * restart; only a window that was never queued can be classified as missed.
 *
 * DEPENDENCY DEFERRAL (D3/F3, binding policy): a scheduled task whose
 * prerequisites are not all `done` is DEFERRED, never spent. Concretely:
 * - a due window of a blocked task is moved into the durable queue instead of
 *   being consumed by the offline missed-window policy (which would otherwise
 *   burn a one-shot or skip a cron window for a reason unrelated to
 *   dependencies);
 * - a queued entry that stays dependency-blocked is exempt from the
 *   `queueMaxAgeMs` shelf life (its expiry clock is cleared) and is never
 *   dispatched — it survives restarts until it becomes ready or the user
 *   explicitly clears/changes the schedule;
 * - readiness is re-checked inside `reserveDispatch()`, `expireQueued()` and the
 *   two missed-window spend paths (`consumeRunAt` / `advanceAndMark`), so a
 *   prerequisite that reopens between the tick snapshot and the write can
 *   never let a blocked entry start or be spent;
 * - when the entry becomes ready it dispatches ONCE; a cron window's next run
 *   is recomputed from the DISPATCH time, so a long deferral cannot burst into
 *   a catch-up run after unblocking.
 * One ledger id index is built per tick and reused for every readiness check
 * (F4: the old per-task `Map` build was O(n²) per tick).
 *
 * @module dsh-taskboard/host/scheduler
 */
import { DEFAULT_DISPATCH_INTERVAL_MS, DEFAULT_MAX_CONCURRENT, isSpentOneShot, newCommentId, nextCronTime, normalizeBody, parseCron, type TaskLedger, type TaskRecord } from '../shared/protocol.ts'
import type { ExecutionService } from './execution.ts'
import { buildDependencyIndex, isDependencyReady } from '../shared/dependencies.ts'
import type { TaskStore } from './store.ts'

/** Tick cadence. */
const TICK_MS = 60_000

/** Everything the scheduler needs. */
export interface SchedulerDeps {
  store: TaskStore
  execution: Pick<ExecutionService, 'run' | 'inFlight'>
  now: () => number
  /** Max concurrently running executions (default 3; must match the execution service). */
  maxConcurrent?: number | (() => number)
  /** Offline missed-window threshold in milliseconds. Queued work never uses it. */
  skipAfterMs?: number | (() => number)
  /** Optional shelf life for a durable queue entry in milliseconds; zero keeps it indefinitely. */
  queueMaxAgeMs?: number | (() => number)
  /** Minimum time between scheduler-created sessions; zero explicitly disables throttling. */
  dispatchIntervalMs?: number | (() => number)
  /** Timer face (injectable for tests). The timeout pair is optional so
   *  older injections keep working; gaps fall back to the globals. */
  timers?: {
    setInterval(fn: () => void, ms: number): unknown
    clearInterval(handle: unknown): void
    setTimeout?(fn: () => void, ms: number): unknown
    clearTimeout?(handle: unknown): void
  }
}

type SchedulerTimers = NonNullable<SchedulerDeps['timers']>

const DEFAULT_TIMERS: Required<SchedulerTimers> = {
  setInterval: (fn: () => void, ms: number): unknown => setInterval(fn, ms),
  clearInterval: (handle: unknown): void => { clearInterval(handle as Parameters<typeof clearInterval>[0]) },
  setTimeout: (fn: () => void, ms: number): unknown => setTimeout(fn, ms),
  clearTimeout: (handle: unknown): void => { clearTimeout(handle as Parameters<typeof clearTimeout>[0]) },
}

/**
 * The cron scheduler.
 */
export class SchedulerService {
  private handle: unknown
  private catchup: unknown
  private timers: Required<SchedulerTimers> = DEFAULT_TIMERS
  /** Reservations actively being handed to this scheduler instance's gate. */
  private readonly dispatching = new Set<string>()
  /** The one active pass: interval and catchup must never dispatch in parallel. */
  private ticking: Promise<void> | undefined
  /** Earliest time a new scheduled session may be opened. */
  private nextDispatchAt = 0
  private disposed = false
  private dispatchWait: { handle: unknown; resolve: () => void } | undefined

  /** @param deps - store + execution + clock. */
  constructor(private readonly deps: SchedulerDeps) {}

  private maxConcurrent(): number {
    return typeof this.deps.maxConcurrent === 'function' ? this.deps.maxConcurrent() : this.deps.maxConcurrent ?? DEFAULT_MAX_CONCURRENT
  }

  private skipAfterMs(): number {
    return typeof this.deps.skipAfterMs === 'function' ? this.deps.skipAfterMs() : this.deps.skipAfterMs ?? 5 * 60_000
  }

  private queueMaxAgeMs(): number {
    return typeof this.deps.queueMaxAgeMs === 'function' ? this.deps.queueMaxAgeMs() : this.deps.queueMaxAgeMs ?? 0
  }

  private dispatchIntervalMs(): number {
    return typeof this.deps.dispatchIntervalMs === 'function' ? this.deps.dispatchIntervalMs() : this.deps.dispatchIntervalMs ?? DEFAULT_DISPATCH_INTERVAL_MS
  }

  /** Start ticking. */
  start(): void {
    this.disposed = false
    // Fill optional timer slots from the globals so a legacy injection that
    // only carries the interval pair still works end to end.
    this.timers = this.deps.timers === undefined ? DEFAULT_TIMERS : { ...DEFAULT_TIMERS, ...this.deps.timers }
    // A tick rejection (disk error inside a mutation) must never surface as
    // an unhandled rejection — log it and keep the schedule alive.
    this.handle = this.timers.setInterval(() => { void this.tick().catch(error => {
      console.error('[dsh-taskboard] scheduler tick failed:', error)
    }) }, TICK_MS)
    // Catch up promptly on host restart: run one tick soon after start. The
    // handles are cleared on dispose so a torn-down scheduler never fires.
    this.catchup = this.timers.setTimeout(() => { void this.tick().catch(error => {
      console.error('[dsh-taskboard] scheduler tick failed:', error)
    }) }, 3_000)
  }

  /** Stop ticking. */
  dispose(): void {
    this.disposed = true
    if (this.dispatchWait !== undefined) {
      this.timers.clearTimeout(this.dispatchWait.handle)
      this.dispatchWait.resolve()
      this.dispatchWait = undefined
    }
    if (this.catchup !== undefined) {
      this.timers.clearTimeout(this.catchup)
      this.catchup = undefined
    }
    if (this.handle === undefined) return
    this.timers.clearInterval(this.handle)
    this.handle = undefined
  }

  /** One scheduler pass (exported for tests). */
  async tick(): Promise<void> {
    if (this.ticking !== undefined) return this.ticking
    let pass: Promise<void>
    pass = this.tickOnce().finally(() => {
      if (this.ticking === pass) this.ticking = undefined
    })
    this.ticking = pass
    return pass
  }

  private async tickOnce(): Promise<void> {
    // Load once before reading: snapshot() does not trigger a load, and the
    // scheduler may be the first consumer after a host restart (otherwise it
    // would tick over an empty ledger until something else loads it).
    await this.deps.store.load()
    const now = this.deps.now()
    const snapshot: TaskLedger = this.deps.store.snapshot()
    // F4: ONE dependency index per tick. Phase 1 (queueing) only writes queue
    // and timing fields — never dependsOn — so a snapshot index stays valid
    // for every readiness check in this phase.
    const dependencyIndex: ReadonlyMap<string, TaskRecord> = buildDependencyIndex(snapshot.tasks)

    for (const task of snapshot.tasks) {
      if (task.execution.mode !== 'scheduled' || task.trashedAt !== undefined) continue
      // Only todo fires. A finished periodic run settles in review (its cron
      // moves to a freshly minted successor todo card), and terminal/parked
      // states retain their config so an explicit reopen can resume — none
      // of these ever refire from here.
      if (task.status !== 'todo') continue
      // Already queued while this host was online: do not apply the offline
      // missed-window policy to it. Dispatch happens in the FIFO pass below.
      if (task.execution.queuedRunAt !== undefined) continue
      if (task.execution.dispatchingRunAt !== undefined) {
        // A prior host died after reserving but before opening the execution.
        // Live reservations are protected by the in-memory guard; stale ones
        // are returned to the durable queue on the first tick after restart.
        const key = `${task.id}:${task.execution.dispatchingRunAt}`
        if (!this.dispatching.has(key)) await this.restoreQueued(task.id, task.execution.dispatchingRunAt)
        continue
      }

      // D3: readiness decides between SPENDING the pending window and
      // DEFERRING it. A blocked task is never subject to the offline
      // missed-window policy: its window becomes a durable queue entry, which
      // the restart-safe FIFO pass keeps until the prerequisites are met.
      const prerequisitesReady = isDependencyReady(task, dependencyIndex)

      if (task.execution.cron !== undefined) {
        // Periodic (定期执行): refire at every cron match.
        if (task.execution.nextRunAt === undefined) continue
        if (task.execution.nextRunAt > now) continue
        if (!prerequisitesReady) {
          await this.queueCron(task.id, now, task.execution.nextRunAt)
          continue
        }
        const missed = now - task.execution.nextRunAt > this.skipAfterMs()
        if (missed) await this.advanceAndMark(task.id, now, undefined, task.execution.nextRunAt)
        else await this.queueCron(task.id, now, task.execution.nextRunAt)
      } else if (task.execution.runAt !== undefined) {
        // One-shot (定时执行): fire once at the instant, then consume it.
        const due = task.execution.runAt
        if (due > now) continue
        if (!prerequisitesReady) {
          // Deferred, not spent: queue the one-shot even when the host was
          // offline past skipAfterMs (the queue entry cannot be expired while
          // the prerequisites are unmet — see releaseExpiryClock below).
          await this.queueRunAt(task.id, now, due)
          continue
        }
        const missed = now - due > this.skipAfterMs()
        if (missed) await this.consumeRunAt(task.id, now, due)
        else await this.queueRunAt(task.id, now, due)
      }
    }

    // Re-read after the queue mutations. Stable due-time order prevents cards
    // later in the ledger from starving behind a fixed snapshot order.
    const queuedTasks = this.deps.store.snapshot().tasks
    // F4: ONE index for the whole dispatch phase. Readiness is re-checked
    // atomically in reserveDispatch/expireQueued before an entry is taken.
    const dispatchIndex: ReadonlyMap<string, TaskRecord> = buildDependencyIndex(queuedTasks)
    const ready: TaskRecord[] = []
    const deferred: string[] = []
    for (const task of queuedTasks) {
      if (task.execution.mode !== 'scheduled' || task.status !== 'todo'
        || task.trashedAt !== undefined || task.execution.queuedRunAt === undefined) continue
      if (isDependencyReady(task, dispatchIndex)) ready.push(task)
      else deferred.push(task.id)
    }
    // D3: a dependency-deferred queue entry must never be spent by the
    // queueMaxAgeMs shelf life. Drop its expiry clock once, in ONE mutation
    // for the whole tick (no write at all when the shelf life is disabled).
    // The durable entry itself stays queued across restarts; only an explicit
    // user clear/cancel consumes it.
    if (deferred.length > 0 && this.queueMaxAgeMs() > 0) await this.releaseExpiryClock(deferred)

    const queued = ready.sort((a, b) => (a.execution.queuedRunAt! - b.execution.queuedRunAt!)
      || ((a.execution.queuedAt ?? 0) - (b.execution.queuedAt ?? 0)) || a.id.localeCompare(b.id))
    for (const task of queued) {
      const queuedWindow = task.execution.queuedRunAt!
      if (this.isExpired(task.execution.queuedAt, now)) {
        await this.expireQueued(task.id, queuedWindow)
        continue
      }
      if (this.deps.execution.inFlight() >= this.maxConcurrent()) break
      await this.waitForDispatchSlot()
      if (this.disposed || this.deps.execution.inFlight() >= this.maxConcurrent()) break
      // Time may have advanced while waiting for a rate slot.
      if (this.isExpired(task.execution.queuedAt, this.deps.now())) {
        await this.expireQueued(task.id, queuedWindow)
        continue
      }
      if (!await this.reserveDispatch(task.id, queuedWindow)) continue
      this.nextDispatchAt = this.deps.now() + this.dispatchIntervalMs()
      const key = `${task.id}:${queuedWindow}`
      this.dispatching.add(key)
      try {
        const result = await this.deps.execution.run(task.id, 'scheduled', { scheduledWindow: queuedWindow }).catch(error => {
          console.error('[dsh-taskboard] scheduled run failed:', error)
          return undefined
        })
        // The production execution gate consumes this marker atomically with
        // opening its running record. Retain this idempotent cleanup for narrow
        // execution adapters (and test faces) that only report a successful
        // dispatch and do not own the ledger mutation.
        if (result?.ok) await this.markDispatched(task.id, queuedWindow)
        else await this.restoreQueued(task.id, queuedWindow)
        // A capacity race leaves the durable entry intact for the next pump.
        if (result !== undefined && !result.ok && !result.error.includes('concurrency')) {
          console.error('[dsh-taskboard] scheduled dispatch rejected:', result.error)
        }
      } finally {
        this.dispatching.delete(key)
      }
    }
  }

  /**
   * Exempt dependency-deferred queue entries from the shelf-life policy (D3).
   * Clearing `queuedAt` (the expiry clock) leaves the durable queue entry
   * untouched, so the work is deferred rather than spent. Runs in ONE mutation
   * and recomputes readiness on the fresh draft: a task whose prerequisites
   * became done in the meantime keeps its original clock and normal policy.
   */
  private async releaseExpiryClock(taskIds: readonly string[]): Promise<void> {
    const ids = new Set(taskIds)
    await this.deps.store.mutate('task-updated', ledger => {
      const index: ReadonlyMap<string, TaskRecord> = buildDependencyIndex(ledger.tasks)
      const changed: TaskRecord[] = []
      for (const task of ledger.tasks) {
        if (!ids.has(task.id) || task.execution.queuedAt === undefined) continue
        if (isDependencyReady(task, index)) continue
        delete task.execution.queuedAt
        changed.push(task)
      }
      return changed.length === 0 ? undefined : changed
    })
  }

  private isExpired(queuedAt: number | undefined, now: number): boolean {
    const maxAge = this.queueMaxAgeMs()
    return maxAge > 0 && queuedAt !== undefined && now - queuedAt >= maxAge
  }

  /** Yield until the scheduler-wide dispatch rate gate opens; never block Node's event loop. */
  private async waitForDispatchSlot(): Promise<void> {
    const wait = this.nextDispatchAt - this.deps.now()
    if (wait <= 0 || this.disposed) return
    await new Promise<void>(resolve => {
      const handle = this.timers.setTimeout(() => {
        if (this.dispatchWait?.handle === handle) this.dispatchWait = undefined
        resolve()
      }, wait)
      this.dispatchWait = { handle, resolve }
    })
  }

  /** Queue one periodic window and advance its next cron time atomically. */
  private async queueCron(taskId: string, now: number, due: number): Promise<void> {
    await this.deps.store.mutate('task-updated', ledger => {
      const task = ledger.tasks.find(t => t.id === taskId)
      if (task === undefined || task.execution.cron === undefined || task.execution.queuedRunAt !== undefined) return undefined
      if (task.status !== 'todo' || task.trashedAt !== undefined || task.execution.nextRunAt !== due) return undefined
      const match = parseCron(task.execution.cron)
      const next = match === null ? undefined : nextCronTime(match, now) ?? undefined
      if (next === undefined) return undefined
      task.execution.nextRunAt = next
      task.execution.queuedRunAt = due
      task.execution.queuedAt = now
      return [task]
    })
  }

  /** Queue a one-shot window atomically, consuming its public runAt field. */
  private async queueRunAt(taskId: string, now: number, due: number): Promise<void> {
    await this.deps.store.mutate('task-updated', ledger => {
      const task = ledger.tasks.find(t => t.id === taskId)
      if (task === undefined || task.execution.runAt !== due || task.execution.queuedRunAt !== undefined) return undefined
      if (task.status !== 'todo' || task.trashedAt !== undefined) return undefined
      delete task.execution.runAt
      task.execution.nextRunAt = undefined
      task.execution.queuedRunAt = due
      task.execution.queuedAt = now
      return [task]
    })
  }

  /** Consume a durable queue entry without creating an execution: either an
   *  overdue shelf-life drop or a manual queue clear from the board. */
  private async expireQueued(taskId: string, queuedWindow: number, reason: 'expired' | 'cleared' = 'expired'): Promise<void> {
    const now = this.deps.now()
    await this.deps.store.mutate('task-updated', ledger => {
      const task = ledger.tasks.find(t => t.id === taskId)
      if (task === undefined || task.execution.queuedRunAt !== queuedWindow) return undefined
      if (reason !== 'cleared' && !this.isExpired(task.execution.queuedAt, now)) return undefined
      // D3: never SPEND dependency-blocked work. A prerequisite may have
      // reopened since the tick snapshot, so readiness is re-checked on the
      // fresh draft; a blocked entry is left queued for a later tick. An
      // explicit manual clear ('cleared') stays unconditional — it is user
      // intent, not a policy drop.
      if (reason !== 'cleared') {
        const dependencyIndex: ReadonlyMap<string, TaskRecord> = buildDependencyIndex(ledger.tasks)
        if (!isDependencyReady(task, dependencyIndex)) return undefined
      }
      delete task.execution.queuedRunAt
      delete task.execution.queuedAt
      // A dropped queue entry spends a one-shot (its runAt was already
      // consumed at queue time): normalize to claim (#95).
      if (isSpentOneShot(task.execution)) task.execution.mode = 'claim'
      task.comments.push({
        id: newCommentId(),
        body: normalizeBody(reason === 'cleared'
          ? '[系统] 已被手动清出执行队列，本次不再补跑；可手动执行或修改定时。'
          : '[系统] 排队中的定时执行已超过保留时长，本次不再补跑；可手动执行或修改定时。'),
        systemKey: reason === 'cleared' ? 'sys.queueCleared' : 'sys.queuedExpired',
        threadId: 'sched',
        version: 1,
        createdAt: now,
      })
      return [task]
    })
  }

  /** Drop every currently queued entry in one durable mutation; dispatching work is untouched. */
  async clearQueue(): Promise<number> {
    await this.deps.store.load()
    let cleared = 0
    const now = this.deps.now()
    await this.deps.store.mutate('task-updated', ledger => {
      const changed = []
      for (const task of ledger.tasks) {
        if (task.execution.queuedRunAt === undefined) continue
        delete task.execution.queuedRunAt
        delete task.execution.queuedAt
        if (isSpentOneShot(task.execution)) task.execution.mode = 'claim'
        task.comments.push({
          id: newCommentId(),
          body: normalizeBody('[系统] 已被手动清出执行队列，本次不再补跑；可手动执行或修改定时。'),
          systemKey: 'sys.queueCleared',
          threadId: 'sched',
          version: 1,
          createdAt: now,
        })
        changed.push(task)
        cleared += 1
      }
      return changed.length === 0 ? undefined : changed
    })
    return cleared
  }

  /** Finalize a queue entry when a lightweight execution adapter accepted it. */
  private async markDispatched(taskId: string, queuedWindow: number): Promise<void> {
    await this.deps.store.mutate('task-updated', ledger => {
      const task = ledger.tasks.find(t => t.id === taskId)
      if (task === undefined || task.execution.dispatchingRunAt !== queuedWindow) return undefined
      delete task.execution.dispatchingRunAt
      delete task.execution.queuedAt
      task.execution.lastTriggeredAt = queuedWindow
      return [task]
    })
  }

  /**
   * Reserve one FIFO entry before calling an execution face.
   *
   * D4: readiness is re-checked INSIDE the reservation mutation — the tick
   * snapshot can be stale (a human may reopen a prerequisite while this
   * callback waited for a rate/capacity slot), and a blocked entry must never
   * leave the durable queue.
   * D3: when a cron entry is taken, a next run that is already in the past is
   * recomputed from the DISPATCH time; a long dependency deferral therefore
   * dispatches once and schedules the following window forward instead of
   * replaying the missed windows as a burst.
   */
  private async reserveDispatch(taskId: string, queuedWindow: number): Promise<boolean> {
    let reserved = false
    await this.deps.store.mutate('task-updated', ledger => {
      const task = ledger.tasks.find(t => t.id === taskId)
      if (task === undefined || task.execution.queuedRunAt !== queuedWindow) return undefined
      if (task.status !== 'todo' || task.trashedAt !== undefined) return undefined
      const dependencyIndex: ReadonlyMap<string, TaskRecord> = buildDependencyIndex(ledger.tasks)
      if (!isDependencyReady(task, dependencyIndex)) return undefined
      if (task.execution.cron !== undefined) {
        const dispatchAt = this.deps.now()
        if (task.execution.nextRunAt === undefined || task.execution.nextRunAt <= dispatchAt) {
          const match = parseCron(task.execution.cron)
          const next = match === null ? undefined : nextCronTime(match, dispatchAt) ?? undefined
          if (next !== undefined) task.execution.nextRunAt = next
        }
      }
      delete task.execution.queuedRunAt
      task.execution.dispatchingRunAt = queuedWindow
      reserved = true
      return [task]
    })
    return reserved
  }

  /** Return an execution-gate rejection to the durable FIFO queue. */
  private async restoreQueued(taskId: string, queuedWindow: number): Promise<void> {
    await this.deps.store.mutate('task-updated', ledger => {
      const task = ledger.tasks.find(t => t.id === taskId)
      if (task === undefined || task.execution.dispatchingRunAt !== queuedWindow) return undefined
      delete task.execution.dispatchingRunAt
      task.execution.queuedRunAt = queuedWindow
      return [task]
    })
  }

  /**
   * Consume a one-shot task's runAt in one serial-queue mutation: the field
   * and nextRunAt are cleared the moment the trigger fires, so the task can
   * never fire twice. A window missed while the host was down is consumed
   * too, with a system comment instead of a silent drop.
   */
  private async consumeRunAt(taskId: string, now: number, missedDue: number | undefined): Promise<void> {
    await this.deps.store.mutate('task-updated', (ledger) => {
      const task = ledger.tasks.find(t => t.id === taskId)
      if (task === undefined || task.execution.runAt === undefined) return undefined
      if (task.status !== 'todo' || task.trashedAt !== undefined) return undefined
      // D3: the offline missed-window policy must never SPEND a
      // dependency-blocked one-shot. Re-check on the fresh draft; when still
      // blocked the window is left in place and the next tick queues it as a
      // deferred durable entry instead.
      if (missedDue !== undefined) {
        const dependencyIndex: ReadonlyMap<string, TaskRecord> = buildDependencyIndex(ledger.tasks)
        if (!isDependencyReady(task, dependencyIndex)) return undefined
      }
      delete task.execution.runAt
      task.execution.nextRunAt = undefined
      task.execution.lastTriggeredAt = now
      // Missed window ⇒ the one-shot is spent: fall back to a plain claim
      // card (manual run / re-schedule via edit) instead of a scheduled
      // ghost with no trigger (#95).
      if (isSpentOneShot(task.execution)) task.execution.mode = 'claim'
      if (missedDue !== undefined) {
        task.comments.push({
          id: newCommentId(),
          body: normalizeBody('[系统] 定时执行错过触发时间（主机当时未运行），本次不再补跑；可手动执行或修改定时。'),
          systemKey: 'sys.runAtMissed',
          threadId: 'sched',
          version: 1,
          createdAt: now,
        })
      }
      return [task]
    })
  }

  /**
   * Recompute the next run and record the trigger instant for one scheduled
   * task, in one serial-queue mutation. S12: a cron that can no longer match
   * anything within the 4-year scan window (only reachable through a
   * hand-edited ledger — every normal entry point validates) would otherwise
   * leave nextRunAt in the past and spin a full ~2M-iteration scan every
   * tick; it is cleared with a system comment instead of dying silently.
   */
  private async advanceAndMark(taskId: string, now: number, triggeredAt: number | undefined, missedDue?: number): Promise<void> {
    await this.deps.store.mutate('task-updated', (ledger) => {
      const task = ledger.tasks.find(t => t.id === taskId)
      if (task === undefined || task.execution.cron === undefined) return undefined
      if (task.status !== 'todo' || task.trashedAt !== undefined) return undefined
      // D3: the offline missed-window policy must never SPEND a
      // dependency-blocked periodic window. Re-check on the fresh draft; when
      // still blocked the window is left due and the next tick queues it as a
      // deferred durable entry instead.
      if (missedDue !== undefined) {
        const dependencyIndex: ReadonlyMap<string, TaskRecord> = buildDependencyIndex(ledger.tasks)
        if (!isDependencyReady(task, dependencyIndex)) return undefined
      }
      const match = parseCron(task.execution.cron)
      const next = match === null ? undefined : nextCronTime(match, now) ?? undefined
      if (next === undefined) {
        const deadCron = task.execution.cron
        task.execution.cron = undefined
        task.execution.nextRunAt = undefined
        // Dead cron ⇒ scheduling is over: same spent-card normalization as
        // a consumed one-shot (#95).
        if (isSpentOneShot(task.execution)) task.execution.mode = 'claim'
        task.comments.push({
          id: newCommentId(),
          body: normalizeBody(`[系统] 定时表达式 ${deadCron} 在 4 年内没有可触发时间，已停用定时；请修正 cron 后重新开启。`),
          systemKey: 'sys.cronDead',
          systemParams: { cron: deadCron },
          threadId: 'sched',
          version: 1,
          createdAt: now,
        })
        return [task]
      }
      task.execution.nextRunAt = next
      if (triggeredAt !== undefined) task.execution.lastTriggeredAt = triggeredAt
      if (missedDue !== undefined) {
        task.comments.push({
          id: newCommentId(),
          body: normalizeBody('[系统] 定期执行错过触发时间（主机当时未运行），本次不再补跑；可手动执行或修改定时。'),
          systemKey: 'sys.cronMissed',
          threadId: 'sched',
          version: 1,
          createdAt: now,
        })
      }
      return [task]
    })
  }
}

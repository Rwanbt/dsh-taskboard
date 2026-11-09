/**
 * P0 regression: import (REPLACE and MERGE) must never drop a queued scheduled
 * one-shot. `SchedulerService.queueRunAt` consumes the public `runAt` when the
 * window enters the durable queue, so the persisted record is
 * `{ mode: 'scheduled', queuedRunAt, queuedAt }` with no cron and no runAt.
 * That is valid pending work, not an invalid execution.
 */
import { describe, expect, it } from 'vitest'
import {
  LEDGER_SCHEMA_VERSION, normalizeExecution, summarize, validateImportedTask,
  validateLedgerImport, type TaskRecord,
} from '../src/shared/protocol.ts'

/** Fixed clock: 2026-01-01T00:00:00Z. */
const NOW = Date.UTC(2026, 0, 1)
/** A deferred one-shot may legitimately be queued for a PAST window (D3). */
const QUEUED_WINDOW = NOW - 60_000
const QUEUED_AT = NOW - 120_000
const MAX_DATE_MS = 8_640_000_000_000_000

/** Minimal import payload; `execution` is the value under test. */
const payload = (id: string, execution: unknown): unknown => ({
  id,
  title: 'Queued one-shot',
  workspaceId: 'ws-a',
  urgency: 'normal',
  status: 'todo',
  blocked: false,
  comments: [],
  executions: [],
  execution,
})

/** Import one task and require success. */
function importOk(execution: unknown, id = 't-queue'): TaskRecord {
  const result = validateImportedTask(payload(id, execution), NOW)
  expect(result.ok).toBe(true)
  if (!result.ok) throw new Error(result.reason)
  return result.task
}

/** Import one task and require rejection; returns the reason. */
function importReason(execution: unknown, id = 't-queue'): string {
  const result = validateImportedTask(payload(id, execution), NOW)
  expect(result.ok).toBe(false)
  if (result.ok) throw new Error('expected the execution shape to be rejected')
  return result.reason
}

/** Wrap tasks in a whole-ledger import file. */
const ledgerFile = (...tasks: unknown[]): unknown => ({
  schemaVersion: LEDGER_SCHEMA_VERSION,
  revision: 7,
  tasks,
})

describe('import — queued one-shot round-trip (P0)', () => {
  it('keeps a queued one-shot whose runAt was already consumed by the queue', () => {
    const task = importOk({ mode: 'scheduled', queuedRunAt: QUEUED_WINDOW, queuedAt: QUEUED_AT })
    expect(task.execution).toEqual({
      mode: 'scheduled',
      queuedRunAt: QUEUED_WINDOW,
      queuedAt: QUEUED_AT,
    })
    expect('runAt' in task.execution).toBe(false)
    expect('cron' in task.execution).toBe(false)
    // The list projection must not invent a trigger.
    const summary = summarize(task)
    expect(summary.executionMode).toBe('scheduled')
    expect(summary.nextRunAt).toBeUndefined()
  })

  it('keeps a queue marker without queuedAt (queuedAt is optional)', () => {
    const task = importOk({ mode: 'scheduled', queuedRunAt: QUEUED_WINDOW })
    expect(task.execution).toEqual({ mode: 'scheduled', queuedRunAt: QUEUED_WINDOW })
  })

  it('preserves lastTriggeredAt and the scheduled-session binding', () => {
    const task = importOk({
      mode: 'scheduled',
      queuedRunAt: QUEUED_WINDOW,
      queuedAt: QUEUED_AT,
      lastTriggeredAt: NOW - 5_000,
      reuseSessionId: 'sess-1',
    })
    expect(task.execution.queuedRunAt).toBe(QUEUED_WINDOW)
    expect(task.execution.queuedAt).toBe(QUEUED_AT)
    expect(task.execution.lastTriggeredAt).toBe(NOW - 5_000)
    expect(task.execution.reuseSessionId).toBe('sess-1')
  })

  it('recovers a host that died while dispatching (dispatchingRunAt only)', () => {
    const task = importOk({ mode: 'scheduled', dispatchingRunAt: QUEUED_WINDOW, queuedAt: QUEUED_AT })
    // An in-flight reservation cannot survive the move: it is demoted to a
    // queued window (loss-free, dispatch is idempotent).
    expect(task.execution.queuedRunAt).toBe(QUEUED_WINDOW)
    expect(task.execution.queuedAt).toBe(QUEUED_AT)
    expect(task.execution.dispatchingRunAt).toBeUndefined()
  })

  it('survives a JSON export/import round-trip unchanged', () => {
    const once = importOk({ mode: 'scheduled', queuedRunAt: QUEUED_WINDOW, queuedAt: QUEUED_AT })
    const twice = validateImportedTask(JSON.parse(JSON.stringify(once)), NOW + 1_000)
    expect(twice.ok).toBe(true)
    if (!twice.ok) throw new Error(twice.reason)
    expect(twice.task.execution).toEqual(once.execution)
  })
})

describe('import — rejection rules stay strict (P0)', () => {
  it('still rejects a scheduled execution with no cron, runAt or queue marker', () => {
    expect(importReason({ mode: 'scheduled' })).toMatch(/cron/)
    expect(importReason({ mode: 'scheduled', queuedAt: QUEUED_AT })).toMatch(/cron/)
    expect(importReason({ mode: 'scheduled', lastTriggeredAt: NOW })).toMatch(/cron/)
  })

  it('rejects garbage queue windows instead of storing them', () => {
    const garbage: unknown[] = [
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
      -1,
      0,
      1.5,
      1e300,
      MAX_DATE_MS + 1,
      '123',
      null,
      {},
    ]
    for (const queuedRunAt of garbage) {
      expect(importReason({ mode: 'scheduled', queuedRunAt })).toMatch(/cron/)
      // A garbage marker never becomes a record on its own.
      expect(validateImportedTask(payload('t-bad', { mode: 'scheduled', queuedRunAt }), NOW)).toMatchObject({ ok: false })
    }
  })

  it('drops garbage optional markers but keeps the valid queue window', () => {
    const task = importOk({
      mode: 'scheduled',
      queuedRunAt: QUEUED_WINDOW,
      queuedAt: Number.NaN,
      lastTriggeredAt: -5,
    })
    expect(task.execution.queuedRunAt).toBe(QUEUED_WINDOW)
    expect(task.execution.queuedAt).toBeUndefined()
    expect(task.execution.lastTriggeredAt).toBeUndefined()
  })

  it('does not let request paths fabricate queued work', () => {
    // normalizeExecution without the import-only option keeps the old rule.
    expect(() => normalizeExecution({ mode: 'scheduled', queuedRunAt: QUEUED_WINDOW }, NOW)).toThrow(/cron/)
    expect(normalizeExecution(
      { mode: 'scheduled', queuedRunAt: QUEUED_WINDOW },
      NOW,
      { allowQueueMarkers: true },
    )).toEqual({ mode: 'scheduled', queuedRunAt: QUEUED_WINDOW })
  })
})

describe('import — normal scheduled records are unchanged (P0)', () => {
  it('keeps a periodic cron record on the cron path', () => {
    const task = importOk({ mode: 'scheduled', cron: '0 * * * *' })
    expect(task.execution.mode).toBe('scheduled')
    expect(task.execution.cron).toBe('0 * * * *')
    expect(task.execution.periodicCompletion).toBe('spawn')
    expect(task.execution.queuedRunAt).toBeUndefined()
    expect(task.execution.runAt).toBeUndefined()
    expect(task.execution.nextRunAt).toBeGreaterThan(NOW)
  })

  it('keeps a normal one-shot runAt record intact', () => {
    const future = NOW + 3_600_000
    const task = importOk({ mode: 'scheduled', runAt: future })
    expect(task.execution.runAt).toBe(future)
    expect(task.execution.nextRunAt).toBe(future)
    expect(task.execution.queuedRunAt).toBeUndefined()
    expect(task.execution.cron).toBeUndefined()
  })

  it('keeps a periodic cron record together with its queue marker', () => {
    const task = importOk({
      mode: 'scheduled',
      cron: '0 * * * *',
      queuedRunAt: QUEUED_WINDOW,
      queuedAt: QUEUED_AT,
      lastTriggeredAt: NOW - 1_000,
    })
    expect(task.execution.cron).toBe('0 * * * *')
    expect(task.execution.queuedRunAt).toBe(QUEUED_WINDOW)
    expect(task.execution.queuedAt).toBe(QUEUED_AT)
    expect(task.execution.lastTriggeredAt).toBe(NOW - 1_000)
  })
})

describe('validateLedgerImport — REPLACE and MERGE both keep queued work (P0)', () => {
  const queuedRecord = payload('t-queued', { mode: 'scheduled', queuedRunAt: QUEUED_WINDOW, queuedAt: QUEUED_AT })

  it('replace classification: unknown id becomes a valid create, never invalid', () => {
    const plan = validateLedgerImport(ledgerFile(queuedRecord), new Set(), NOW)
    expect(plan.invalid).toEqual([])
    expect(plan.overwrite).toEqual([])
    expect(plan.create).toHaveLength(1)
    expect(plan.create[0]!.execution).toEqual({
      mode: 'scheduled',
      queuedRunAt: QUEUED_WINDOW,
      queuedAt: QUEUED_AT,
    })
  })

  it('merge classification: known id becomes a valid overwrite, never invalid', () => {
    const plan = validateLedgerImport(ledgerFile(queuedRecord), new Set(['t-queued']), NOW)
    expect(plan.invalid).toEqual([])
    expect(plan.create).toEqual([])
    expect(plan.overwrite).toHaveLength(1)
    expect(plan.overwrite[0]!.execution.queuedRunAt).toBe(QUEUED_WINDOW)
  })

  it('does not drop the queued record next to normal scheduled records in one file', () => {
    const plan = validateLedgerImport(ledgerFile(
      queuedRecord,
      payload('t-cron', { mode: 'scheduled', cron: '0 * * * *' }),
      payload('t-once', { mode: 'scheduled', runAt: NOW + 60_000 }),
    ), new Set(), NOW)
    expect(plan.invalid).toEqual([])
    expect(plan.create).toHaveLength(3)
    const byId = new Map(plan.create.map(task => [task.id, task]))
    expect(byId.get('t-queued')!.execution.queuedRunAt).toBe(QUEUED_WINDOW)
    expect(byId.get('t-cron')!.execution.cron).toBe('0 * * * *')
    expect(byId.get('t-once')!.execution.runAt).toBe(NOW + 60_000)
  })
})

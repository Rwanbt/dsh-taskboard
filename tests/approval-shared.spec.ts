/**
 * Shared-layer tests for the 0.10.1 dependency-change approval contract:
 * request shape normalization (load/import), upsert/remove helpers, summary
 * projection, needs-human integration and the protocol-text rule.
 *
 * Pure module tests only — the host/tools/routes behaviour lives in
 * tests/approval-host.spec.ts.
 *
 * @module dsh-taskboard/tests/approval-shared
 */
import { describe, expect, it } from 'vitest'
import { humanWaiting } from '../src/shared/human-wait.ts'
import {
  dependencyChangeIds,
  newDependencyChangeId,
  newSystemComment,
  normalizePendingChanges,
  removeDependencyChange,
  summarize,
  upsertDependencyChange,
  validateImportedTask,
  type DependencyChangeRequest,
  type TaskRecord,
} from '../src/shared/protocol.ts'
import { TASKBOARD_PROTOCOL } from '../src/host/protocol-text.ts'

const NOW = 1_700_000_040_000

/** Minimal complete record for pure tests. */
function record(overrides: Partial<TaskRecord> & Pick<TaskRecord, 'id'>): TaskRecord {
  return {
    title: `task ${overrides.id}`,
    description: '',
    prompt: '',
    workspaceId: 'ws-a',
    urgency: 'normal',
    status: 'todo',
    blocked: false,
    execution: { mode: 'claim' },
    version: 1,
    createdAt: NOW,
    updatedAt: NOW,
    createdBy: { kind: 'user' },
    updatedBy: { kind: 'user' },
    comments: [],
    executions: [],
    ...overrides,
  }
}

/** A well-formed remove-prerequisites request. */
function request(overrides: Partial<DependencyChangeRequest> = {}): DependencyChangeRequest {
  return {
    id: 'dcr-test-1',
    kind: 'remove-prerequisites',
    taskId: 't-owner',
    remove: ['t-gone'],
    reason: 'the prerequisite turned out to be unrelated',
    requestedBy: { kind: 'agent', sessionId: 'session-1' },
    createdAt: NOW,
    ...overrides,
  }
}

describe('dependency change request normalization (0.10.1)', () => {
  it('keeps well-formed requests, forces taskId to the storing record and allows unknown ids', () => {
    const accepted = normalizePendingChanges([request({ taskId: 'someone-else' })], 't-owner')
    expect(accepted).toEqual([request()])
    // Unknown prerequisite ids are allowed (the target may already be gone).
    expect(normalizePendingChanges([request({ remove: ['t-never-existed'] })], 't-owner')[0]!.remove).toEqual(['t-never-existed'])
    // Both kinds can coexist on one record.
    const both = normalizePendingChanges([
      request(),
      request({ id: 'dcr-test-2', kind: 'trash-prerequisite', remove: undefined, affected: ['t-dep'] }),
    ], 't-owner')
    expect(both.map(change => change.kind)).toEqual(['remove-prerequisites', 'trash-prerequisite'])
  })

  it('drops malformed entries instead of failing the whole field', () => {
    const invalid: unknown[] = [
      null,
      42,
      { ...request(), kind: 'weaken-everything' },
      { ...request(), id: '' },
      { ...request(), reason: '' },
      { ...request(), reason: 'x'.repeat(501) },
      { ...request(), requestedBy: { kind: 'user' } },
      { ...request(), createdAt: 'yesterday' },
      { ...request(), remove: ['bad id'] },
      { ...request(), remove: 'not-an-array' },
    ]
    expect(normalizePendingChanges(invalid, 't-owner')).toEqual([])
    expect(normalizePendingChanges('not-an-array', 't-owner')).toEqual([])
    expect(normalizePendingChanges(undefined, 't-owner')).toEqual([])
  })

  it('keeps at most one request per kind (duplicates are ignored)', () => {
    const accepted = normalizePendingChanges([
      request({ id: 'dcr-first' }),
      request({ id: 'dcr-second', reason: 'second attempt' }),
    ], 't-owner')
    expect(accepted).toHaveLength(1)
    expect(accepted[0]!.id).toBe('dcr-first')
  })

  it('validateImportedTask preserves normalized requests and drops malformed ones', () => {
    const raw = {
      id: 't-imported',
      title: 'Imported',
      workspaceId: 'ws-a',
      status: 'todo',
      comments: [],
      executions: [],
      execution: { mode: 'claim' },
      pendingChanges: [request({ taskId: 'spoofed' }), { kind: 'nonsense' }],
    }
    const result = validateImportedTask(raw, NOW)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.task.pendingChanges).toEqual([request({ taskId: 't-imported' })])
  })
})

describe('dependency change helpers', () => {
  it('upsert replaces the same kind keeping its id; remove drops only that request', () => {
    const task = record({ id: 't-owner' })
    const trash = request({ id: 'dcr-trash', kind: 'trash-prerequisite', remove: undefined, affected: ['t-dep'] })
    const first = upsertDependencyChange(task, request())
    expect(first.id).toBe('dcr-test-1')
    const again = upsertDependencyChange(task, request({ id: 'dcr-new-id', reason: 'updated reason', remove: ['t-gone', 't-other'] }))
    // Same kind → the existing id survives, fields refresh.
    expect(again.id).toBe('dcr-test-1')
    expect(task.pendingChanges).toHaveLength(1)
    expect(task.pendingChanges![0]!.reason).toBe('updated reason')
    expect(task.pendingChanges![0]!.remove).toEqual(['t-gone', 't-other'])
    // A different kind coexists.
    upsertDependencyChange(task, trash)
    expect(task.pendingChanges!.map(change => change.kind)).toEqual(['remove-prerequisites', 'trash-prerequisite'])
    // Removing the last request clears the field entirely.
    expect(removeDependencyChange(task, 'dcr-test-1')?.id).toBe('dcr-test-1')
    expect(removeDependencyChange(task, 'dcr-trash')?.id).toBe('dcr-trash')
    expect(task.pendingChanges).toBeUndefined()
    expect(removeDependencyChange(task, 'dcr-missing')).toBeUndefined()
  })

  it('exposes the ids each request is about', () => {
    expect(dependencyChangeIds(request({ remove: ['a', 'b'] }))).toEqual(['a', 'b'])
    expect(dependencyChangeIds(request({ kind: 'trash-prerequisite', remove: undefined, affected: ['c'] }))).toEqual(['c'])
    expect(dependencyChangeIds(request({ remove: undefined }))).toEqual([])
  })

  it('summarize carries a copy of pendingChanges (list/SSE exposure)', () => {
    const task = record({ id: 't-owner', pendingChanges: [request()] })
    const summary = summarize(task)
    expect(summary.pendingChanges).toEqual([request()])
    summary.pendingChanges![0]!.reason = 'mutated summary'
    expect(task.pendingChanges![0]!.reason).toBe(request().reason)
  })

  it('builds a host system comment with the dotted sys.* key and flat params', () => {
    const comment = newSystemComment('sys.dcr.approved', '[系统] approved', { kind: 'remove-prerequisites', ids: 'a,b', reason: 'r' }, NOW)
    expect(comment.systemKey).toBe('sys.dcr.approved')
    expect(comment.systemParams).toEqual({ kind: 'remove-prerequisites', ids: 'a,b', reason: 'r' })
    expect(comment.threadId).toBe('host')
    expect(comment.version).toBe(1)
    expect(comment.createdAt).toBe(NOW)
  })

  it('mints dcr ids', () => {
    expect(newDependencyChangeId()).toMatch(/^dcr-[a-z0-9]+-[a-z0-9]+$/)
  })
})

describe('needs-human integration (source approval)', () => {
  it('a pending request needs the human and WINS over an explicit waitingForHuman=false', () => {
    const task = record({ id: 't-owner', pendingChanges: [request()] })
    expect(humanWaiting(task)).toMatchObject({ needs: true, source: 'approval', reasonKey: 'human.reason.approval' })
    task.waitingForHuman = false
    expect(humanWaiting(task)).toMatchObject({ needs: true, source: 'approval' })
  })

  it('a done prerequisite with a pending deletion request still needs the human (real-host E2E finding)', () => {
    expect(humanWaiting(record({ id: 't-done', status: 'done', pendingChanges: [request()] })))
      .toEqual({ needs: true, source: 'approval', reasonKey: 'human.reason.approval' })
    expect(humanWaiting(record({ id: 't-done-quiet', status: 'done' }))).toEqual({ needs: false })
  })

  it('trashed cards and request-less cards keep the old semantics', () => {
    expect(humanWaiting(record({ id: 't-trash', trashedAt: NOW, pendingChanges: [request()] }))).toEqual({ needs: false })
    expect(humanWaiting(record({ id: 't-quiet', pendingChanges: [] }))).toEqual({ needs: false })
    expect(humanWaiting(record({ id: 't-clear', waitingForHuman: false }))).toEqual({ needs: false })
  })
})

describe('protocol text', () => {
  it('documents the approval rule in zh and en', () => {
    expect(TASKBOARD_PROTOCOL).toContain('依赖审批')
    expect(TASKBOARD_PROTOCOL).toContain('pending_approval')
    expect(TASKBOARD_PROTOCOL).toContain('Dependency approval')
    expect(TASKBOARD_PROTOCOL).toContain('workspace_mismatch')
  })
})

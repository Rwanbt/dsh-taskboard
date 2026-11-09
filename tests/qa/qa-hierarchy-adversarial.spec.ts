/**
 * QA (Agent D) — adversarial hierarchy checks (D6/D7/D9).
 *
 * Part 1 drives the pure `src/shared/hierarchy.ts` contract directly.
 * Part 2 drives the real host routes: parentId on create/update, derived
 * subtaskProgress, delete-with-children refusal, no auto-completion, and the
 * hierarchy-is-not-a-gate rule.
 *
 * @module dsh-taskboard/tests/qa/hierarchy-adversarial
 */
import { afterEach, describe, expect, it } from 'vitest'
import {
  ancestorsOf,
  assertNoChildren,
  descendantsOf,
  detachIsDeleted,
  HierarchyError,
  MAX_TASK_DEPTH,
  subtaskProgress,
  validateHierarchyLinks,
  validateParent,
  type HierarchyTask,
} from '../../src/shared/hierarchy.ts'
import { createQaHost, QA_WS, QA_WS2, type QaHost } from './harness.ts'

const hosts: QaHost[] = []
afterEach(async () => {
  while (hosts.length > 0) await hosts.pop()!.dispose()
})

async function host(): Promise<QaHost> {
  const h = await createQaHost()
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

/** A hierarchy fixture record. */
function ht(id: string, extra: Partial<HierarchyTask> = {}): HierarchyTask {
  return { id, workspaceId: QA_WS.id, status: 'todo', ...extra }
}

function codeOf(fn: () => unknown): string | undefined {
  try {
    fn()
    return undefined
  } catch (error) {
    return error instanceof HierarchyError ? error.code : `unexpected:${String(error)}`
  }
}

describe('QA — hierarchy contract (pure)', () => {
  it('refuses self-parent, missing/trashed parent and cross-workspace parent', () => {
    const tasks = [ht('a'), ht('b', { trashedAt: 1 }), ht('c', { workspaceId: QA_WS2.id })]
    expect(codeOf(() => validateParent({ id: 'a', workspaceId: QA_WS.id }, 'a', tasks))).toBe('self')
    expect(codeOf(() => validateParent({ id: 'a', workspaceId: QA_WS.id }, 'b', tasks))).toBe('missing')
    expect(codeOf(() => validateParent({ id: 'a', workspaceId: QA_WS.id }, 'nope', tasks))).toBe('missing')
    expect(codeOf(() => validateParent({ id: 'a', workspaceId: QA_WS.id }, 'c', tasks))).toBe('cross_workspace')
  })

  it('detects an ancestor cycle and a pre-existing cyclic ledger without hanging', () => {
    // a <- b means b.parentId = a (a is the parent).
    const tasks = [ht('a', { parentId: 'b' }), ht('b', { parentId: 'a' })]
    expect(codeOf(() => validateParent({ id: 'a', workspaceId: QA_WS.id }, 'b', tasks))).toBe('cycle')
    // A hand-edited cyclic ledger must be refused, not looped.
    expect(codeOf(() => validateHierarchyLinks(tasks[0]!, tasks))).toBe('cycle')
  })

  it('enforces MAX_TASK_DEPTH=8: depth 8 accepted, depth 9 refused', () => {
    expect(MAX_TASK_DEPTH).toBe(8)
    const tasks: HierarchyTask[] = []
    // r is depth 1 ... c8 is depth 8.
    tasks.push(ht('r'))
    for (let i = 2; i <= 8; i++) tasks.push(ht(`c${i}`, { parentId: i === 2 ? 'r' : `c${i - 1}` }))
    // Linking a new task under c8 would be depth 9.
    expect(codeOf(() => validateParent({ id: 'new9', workspaceId: QA_WS.id }, 'c8', tasks))).toBe('depth')
    // Linking a new task under c7 is exactly depth 8 → accepted.
    expect(validateParent({ id: 'new8', workspaceId: QA_WS.id }, 'c7', tasks)).toBe('c7')
    // Re-parenting an existing deep subtree cannot be pushed past the cap.
    const withSub = [...tasks, ht('sub', { parentId: 'new8' })]
    expect(codeOf(() => validateParent({ id: 'new8', workspaceId: QA_WS.id }, 'c8', withSub))).toBe('depth')
  })

  it('counts subtaskProgress over direct children only, with trashed children as missing', () => {
    const tasks = [
      ht('p'),
      ht('k1', { parentId: 'p', status: 'done' }),
      ht('k2', { parentId: 'p', status: 'in_review' }),
      ht('k3', { parentId: 'p', status: 'todo', blocked: true }),
      ht('k4', { parentId: 'p', trashedAt: 5 }),
      ht('grand', { parentId: 'k1' }),
    ]
    expect(subtaskProgress('p', tasks)).toEqual({ total: 3, done: 1, open: 2, blocked: 1, missing: 1 })
    // Index form must agree with the array form (the host passes an index).
    const index = new Map(tasks.map(t => [t.id, t]))
    expect(subtaskProgress('p', tasks, index)).toEqual(subtaskProgress('p', tasks))
    // A done parent with open children is a legal state — progress is a
    // projection, never a gate and never an auto-completion trigger.
    const doneParent = [...tasks]
    doneParent[0] = ht('p', { status: 'done' })
    expect(subtaskProgress('p', doneParent)).toMatchObject({ open: 2 })
  })

  it('ancestors/descendants stop at trashed records and survive hand-edited cycles', () => {
    const tasks = [
      ht('root'),
      ht('mid', { parentId: 'root' }),
      ht('leaf', { parentId: 'mid' }),
      ht('gone', { parentId: 'root', trashedAt: 2 }),
    ]
    expect(ancestorsOf('leaf', tasks)).toEqual(['mid', 'root'])
    expect(descendantsOf('root', tasks)).toEqual(['mid', 'gone', 'leaf'].filter(id => id !== 'gone'))
    const cyclic = [ht('x', { parentId: 'y' }), ht('y', { parentId: 'x' })]
    expect(() => ancestorsOf('x', cyclic)).not.toThrow()
    expect(() => descendantsOf('x', cyclic)).not.toThrow()
  })

  it('assertNoChildren refuses live children only; detachIsDeleted clears the links', () => {
    const tasks = [ht('p'), ht('live', { parentId: 'p' }), ht('gone', { parentId: 'p', trashedAt: 3 })]
    expect(codeOf(() => assertNoChildren('p', tasks))).toBe('has_children')
    const inert = [ht('p'), ht('gone', { parentId: 'p', trashedAt: 3 })]
    expect(() => assertNoChildren('p', inert)).not.toThrow()
    const detached = detachIsDeleted('p', inert)
    expect(detached).toEqual(['gone'])
    expect(inert[1]!.parentId).toBeUndefined()
  })
})

describe('QA — hierarchy on the real host routes (D6/D7)', () => {
  it('creates a subtask and exposes derived subtaskProgress (never persisted)', async () => {
    const h = await host()
    const parent = await createTask(h, 'parent')
    const child = await createTask(h, 'child', { parentId: parent })
    expect(h.store.get(child)!.parentId).toBe(parent)
    expect((h.store.get(child) as unknown as Record<string, unknown>).subtaskProgress).toBeUndefined()
    const state = await h.get('/dsh-taskboard/state')
    const parentView = state.json.value.tasks.find((t: { id: string }) => t.id === parent)
    expect(parentView.subtaskProgress).toMatchObject({ total: 1, done: 0, open: 1 })
  })

  it('a done parent with open children is allowed but auto-completes nothing', async () => {
    const h = await host()
    const parent = await createTask(h, 'parent')
    const child = await createTask(h, 'child', { parentId: parent })
    expect((await move(h, parent, 'in_progress')).status).toBe(200)
    expect((await move(h, parent, 'in_review')).status).toBe(200)
    expect((await move(h, parent, 'done')).status).toBe(200)
    // The child is untouched: no cascade, no auto-completion.
    expect(h.store.get(child)!.status).toBe('todo')
    const state = await h.get('/dsh-taskboard/state')
    const parentView = state.json.value.tasks.find((t: { id: string }) => t.id === parent)
    expect(parentView.subtaskProgress).toMatchObject({ total: 1, done: 0, open: 1 })
  })

  it('hierarchy is NOT an execution gate (a child starts while the parent is todo)', async () => {
    const h = await host()
    const parent = await createTask(h, 'parent')
    const child = await createTask(h, 'child', { parentId: parent })
    expect(h.store.get(parent)!.status).toBe('todo')
    expect((await move(h, child, 'in_progress')).status).toBe(200)
    expect(h.store.get(child)!.status).toBe('in_progress')
  })

  it('refuses to soft-delete or purge a task with live children (has_children, D7)', async () => {
    const h = await host()
    const parent = await createTask(h, 'parent')
    const child = await createTask(h, 'child', { parentId: parent })
    const soft = await h.post(`/dsh-taskboard/tasks/${parent}/delete`, { ifVersion: h.store.get(parent)!.version })
    expect(soft.status).toBeGreaterThanOrEqual(400)
    expect(String(soft.json?.error?.message ?? '')).toMatch(/child|子/i)
    expect(h.store.get(parent)!.trashedAt).toBeUndefined()
    // Agent tool path refuses too.
    await expect(h.tool('taskboard_delete', { id: parent, ifVersion: h.store.get(parent)!.version })).rejects.toThrow(/child|子/i)
    // Once the child is trashed, the parent may be trashed; purging it detaches
    // the inert child link in the same transaction.
    expect((await h.post(`/dsh-taskboard/tasks/${child}/delete`, { ifVersion: h.store.get(child)!.version })).status).toBe(200)
    expect((await h.post(`/dsh-taskboard/tasks/${parent}/delete`, { ifVersion: h.store.get(parent)!.version })).status).toBe(200)
    const childVersionBefore = h.store.get(child)!.version
    const purge = await h.post(`/dsh-taskboard/tasks/${parent}/delete`, { purge: true })
    expect(purge.status).toBe(200)
    expect(h.store.get(child)!.parentId).toBeUndefined()
    expect(h.store.get(child)!.version).toBeGreaterThan(childVersionBefore)
  })

  it('rejects self-parent, ancestor cycle, cross-workspace parent and workspace rebind (D6/D7)', async () => {
    const h = await host()
    const p1 = await createTask(h, 'p1')
    const p2 = await createTask(h, 'p2', { parentId: p1 })
    const self = await h.post(`/dsh-taskboard/tasks/${p1}/update`, { ifVersion: h.store.get(p1)!.version, parentId: p1 })
    expect(self.status).toBeGreaterThanOrEqual(400)
    expect(String(self.json?.error?.message ?? '')).toMatch(/self|own parent/i)
    const cycle = await h.post(`/dsh-taskboard/tasks/${p1}/update`, { ifVersion: h.store.get(p1)!.version, parentId: p2 })
    expect(cycle.status).toBeGreaterThanOrEqual(400)
    expect(String(cycle.json?.error?.message ?? '')).toMatch(/cycle/i)
    // Cross-workspace parent: create a task in ws2, then try to parent it under p1.
    const other = (await h.post('/dsh-taskboard/tasks', { title: 'other ws', workspaceId: QA_WS2.id, urgency: 'normal' })).json.value.id
    const cross = await h.post(`/dsh-taskboard/tasks/${other}/update`, { ifVersion: h.store.get(other)!.version, parentId: p1 })
    expect(cross.status).toBeGreaterThanOrEqual(400)
    expect(String(cross.json?.error?.message ?? '')).toMatch(/workspace/i)
    // Workspace rebind of a parent with a same-workspace child is refused.
    const rebind = await h.post(`/dsh-taskboard/tasks/${p1}/update`, { ifVersion: h.store.get(p1)!.version, workspaceId: QA_WS2.id })
    expect(rebind.status).toBeGreaterThanOrEqual(400)
    expect(String(rebind.json?.error?.message ?? '')).toMatch(/workspace/i)
  })

  it('refuses creating a subtask below the depth cap (depth 9)', async () => {
    const h = await host()
    let current = await createTask(h, 'depth-1')
    for (let depth = 2; depth <= 8; depth++) {
      current = await createTask(h, `depth-${depth}`, { parentId: current })
    }
    // depth-8 sits at the cap; one more level must be refused.
    const tooDeep = await h.post('/dsh-taskboard/tasks', {
      title: 'depth-9', workspaceId: QA_WS.id, urgency: 'normal', parentId: current,
    })
    expect(tooDeep.status).toBeGreaterThanOrEqual(400)
    expect(String(tooDeep.json?.error?.message ?? '')).toMatch(/depth|层级|深度/i)
  })

  it('counts a trashed child as missing in the parent projection', async () => {
    const h = await host()
    const parent = await createTask(h, 'parent')
    const child = await createTask(h, 'child', { parentId: parent })
    expect((await h.post(`/dsh-taskboard/tasks/${child}/delete`, { ifVersion: h.store.get(child)!.version })).status).toBe(200)
    const state = await h.get('/dsh-taskboard/state')
    const parentView = state.json.value.tasks.find((t: { id: string }) => t.id === parent)
    expect(parentView.subtaskProgress).toMatchObject({ total: 0, missing: 1 })
  })
})

describe('QA — hierarchy invariants at the IMPORT boundary (D6/D7)', () => {
  /** A plausible ledger document for POST /import (schemaVersion 1). */
  function ledgerDoc(tasks: unknown[]): unknown {
    return { schemaVersion: 1, revision: 1, tasks }
  }
  /** Minimal plausible imported task with a hierarchy link. */
  function importedTask(id: string, parentId?: string, workspaceId = QA_WS.id): Record<string, unknown> {
    return {
      id, title: `imported ${id}`, description: '', prompt: '', workspaceId,
      urgency: 'normal', status: 'todo', blocked: false,
      execution: { mode: 'claim' }, version: 1, createdAt: 1, updatedAt: 1,
      createdBy: { kind: 'user' }, updatedBy: { kind: 'user' },
      comments: [], executions: [],
      ...(parentId !== undefined ? { parentId } : {}),
    }
  }

  it('import REPLACE refuses a dangling parentId', async () => {
    const h = await host()
    const res = await h.post('/dsh-taskboard/import', {
      mode: 'replace',
      ledger: ledgerDoc([importedTask('orphan', 'no-such-parent')]),
    })
    expect(res.status, 'replace accepted a dangling parentId').toBeGreaterThanOrEqual(400)
    expect(h.store.get('orphan')).toBeUndefined()
  })

  it('import REPLACE refuses a parent cycle and an over-depth chain', async () => {
    const h = await host()
    const cyclic = await h.post('/dsh-taskboard/import', {
      mode: 'replace',
      ledger: ledgerDoc([importedTask('cyc-a', 'cyc-b'), importedTask('cyc-b', 'cyc-a')]),
    })
    expect(cyclic.status, 'replace accepted a parent cycle').toBeGreaterThanOrEqual(400)
    const deep = Array.from({ length: 9 }, (_, i) => importedTask(`deep-${i}`, i === 0 ? undefined : `deep-${i - 1}`))
    const tooDeep = await h.post('/dsh-taskboard/import', { mode: 'replace', ledger: ledgerDoc(deep) })
    expect(tooDeep.status, 'replace accepted a depth-9 hierarchy').toBeGreaterThanOrEqual(400)
  })

  it('import REPLACE refuses a cross-workspace parent', async () => {
    const h = await host()
    const res = await h.post('/dsh-taskboard/import', {
      mode: 'replace',
      ledger: ledgerDoc([
        importedTask('parent-ws2', undefined, QA_WS2.id),
        importedTask('child-ws1', 'parent-ws2', QA_WS.id),
      ]),
    })
    expect(res.status, 'replace accepted a cross-workspace parent').toBeGreaterThanOrEqual(400)
  })

  it('import MERGE refuses an incoming record whose parentId is dangling or cross-workspace', async () => {
    const h = await host()
    const dangling = await h.post('/dsh-taskboard/import', {
      mode: 'merge',
      ledger: ledgerDoc([importedTask('merge-orphan', 'no-such-parent')]),
    })
    expect(dangling.status, 'merge accepted a dangling parentId').toBeGreaterThanOrEqual(400)
    const cross = await h.post('/dsh-taskboard/import', {
      mode: 'merge',
      ledger: ledgerDoc([importedTask('merge-parent', undefined, QA_WS2.id), importedTask('merge-child', 'merge-parent', QA_WS.id)]),
    })
    expect(cross.status, 'merge accepted a cross-workspace parent').toBeGreaterThanOrEqual(400)
  })
})

describe('QA — hierarchy links pointing at a TRASHED parent (merge, D6/D7)', () => {
  function ledgerDoc(tasks: unknown[]): unknown { return { schemaVersion: 1, revision: 1, tasks } }
  function importedTask(id: string, parentId?: string, workspaceId = QA_WS.id, trashedAt?: number): Record<string, unknown> {
    return {
      id, title: `imported ${id}`, description: '', prompt: '', workspaceId,
      urgency: 'normal', status: 'todo', blocked: false,
      execution: { mode: 'claim' }, version: 1, createdAt: 1, updatedAt: 1,
      createdBy: { kind: 'user' }, updatedBy: { kind: 'user' },
      comments: [], executions: [],
      ...(parentId !== undefined ? { parentId } : {}),
      ...(trashedAt !== undefined ? { trashedAt } : {}),
    }
  }

  it('merge refuses (or repairs) a parentId pointing at a live-ledger TRASHED parent', async () => {
    const h = await host()
    const parent = await createTask(h, 'parent')
    expect((await h.post(`/dsh-taskboard/tasks/${parent}/delete`, { ifVersion: h.store.get(parent)!.version })).status).toBe(200)
    const res = await h.post('/dsh-taskboard/import', { mode: 'merge', ledger: ledgerDoc([importedTask('child-of-trashed', parent)]) })
    // Either refused outright, or accepted with the link repaired — never a
    // silently accepted dangling parentId.
    const created = h.store.get('child-of-trashed')
    expect(res.status >= 400 || (created !== undefined && created.parentId === undefined), 'merge accepted a dangling/trashed parentId').toBe(true)
  })

  it('merge refuses (or repairs) a parentId whose parent is trashed in the SAME incoming batch', async () => {
    const h = await host()
    const res = await h.post('/dsh-taskboard/import', {
      mode: 'merge',
      ledger: ledgerDoc([
        importedTask('batch-parent', undefined, QA_WS.id, 12345),
        importedTask('batch-child', 'batch-parent'),
      ]),
    })
    const created = h.store.get('batch-child')
    expect(res.status >= 400 || (created !== undefined && created.parentId === undefined), 'same-batch trashed parent silently accepted').toBe(true)
  })
})

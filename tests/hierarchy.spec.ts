import { describe, expect, it } from 'vitest'
import {
  HierarchyError, MAX_TASK_DEPTH, ancestorsOf, assertNoChildren, descendantsOf,
  detachIsDeleted, subtaskProgress, validateHierarchyLinks, validateParent,
  type HierarchyTask,
} from '../src/shared/hierarchy.ts'
import {
  isPlausibleTaskRecord, repairTaskLinks, spawnNextCycle, summarize, validateImportedTask,
  type TaskRecord,
} from '../src/shared/protocol.ts'
import { MAX_TASK_DEPENDENCIES } from '../src/shared/dependencies.ts'

const WS = 'ws-a'

/** A task fixture; only hierarchy-relevant fields are interesting. */
const node = (id: string, overrides: Partial<HierarchyTask> = {}): HierarchyTask => ({
  id,
  workspaceId: WS,
  status: 'todo',
  ...overrides,
})

/** `t-0` (root) → `t-1` → … → `t-(size-1)`. */
const chainOf = (size: number, prefix = 't'): HierarchyTask[] =>
  Array.from({ length: size }, (_, i) => node(`${prefix}-${i}`, i > 0 ? { parentId: `${prefix}-${i - 1}` } : {}))

const rejects = (cb: () => unknown, code: string): void => {
  try {
    cb()
    throw new Error('Expected HierarchyError')
  } catch (error) {
    expect(error).toBeInstanceOf(HierarchyError)
    expect((error as HierarchyError).code).toBe(code)
  }
}

describe('hierarchy — parent validation (D6)', () => {
  const tasks: HierarchyTask[] = [node('t-parent'), node('t-child')]

  it('accepts an existing same-workspace parent and returns its id', () => {
    expect(validateParent({ id: 't-child', workspaceId: WS }, 't-parent', tasks)).toBe('t-parent')
  })
  it('treats undefined/null as detach and rejects malformed input', () => {
    expect(validateParent({ id: 't-child', workspaceId: WS }, undefined, tasks)).toBeUndefined()
    expect(validateParent({ id: 't-child', workspaceId: WS }, null, tasks)).toBeUndefined()
    rejects(() => validateParent({ id: 't-child', workspaceId: WS }, 42, tasks), 'invalid_input')
    rejects(() => validateParent({ id: 't-child', workspaceId: WS }, '', tasks), 'invalid_input')
    rejects(() => validateParent({ id: 't-child', workspaceId: WS }, 'bad id!', tasks), 'invalid_input')
  })
  it('rejects a self parent', () => {
    rejects(() => validateParent({ id: 't-parent', workspaceId: WS }, 't-parent', tasks), 'self')
  })
  it('rejects missing and soft-trashed parents', () => {
    rejects(() => validateParent({ id: 't-child', workspaceId: WS }, 'ghost', tasks), 'missing')
    rejects(() => validateParent({ id: 't-child', workspaceId: WS }, 't-parent', [
      node('t-parent', { trashedAt: 1 }), node('t-child'),
    ]), 'missing')
  })
  it('refuses cross-workspace links in both directions', () => {
    rejects(() => validateParent({ id: 't-child', workspaceId: WS }, 't-parent', [
      node('t-parent', { workspaceId: 'ws-b' }), node('t-child'),
    ]), 'cross_workspace')
    rejects(() => validateParent({ id: 't-child', workspaceId: 'ws-b' }, 't-parent', tasks), 'cross_workspace')
  })
  it('rejects direct and indirect ancestor cycles', () => {
    const direct: HierarchyTask[] = [node('t-a', { parentId: 't-b' }), node('t-b', { parentId: 't-a' })]
    rejects(() => validateParent({ id: 't-a', workspaceId: WS }, 't-b', direct), 'cycle')
    // a → b → c already: re-parenting c under a closes the cycle two hops away.
    const indirect: HierarchyTask[] = [
      node('t-a', { parentId: 't-b' }),
      node('t-b', { parentId: 't-c' }),
      node('t-c'),
    ]
    rejects(() => validateParent({ id: 't-c', workspaceId: WS }, 't-a', indirect), 'cycle')
    // A brand-new node under c is fine.
    expect(validateParent({ id: 't-new', workspaceId: WS }, 't-c', indirect)).toBe('t-c')
  })
  it('stays bounded on a hand-edited cyclic hierarchy', () => {
    const cyclic: HierarchyTask[] = [node('t-a', { parentId: 't-b' }), node('t-b', { parentId: 't-a' })]
    rejects(() => validateParent({ id: 't-new', workspaceId: WS }, 't-a', cyclic), 'cycle')
    expect(ancestorsOf('t-a', cyclic)).toEqual(['t-b'])
  })
})

describe('hierarchy — depth cap (D6)', () => {
  it('allows depth MAX_TASK_DEPTH and rejects MAX_TASK_DEPTH + 1', () => {
    expect(MAX_TASK_DEPTH).toBe(8)
    const deep = chainOf(MAX_TASK_DEPTH)
    // The leaf already sits at depth 8: a child would be depth 9.
    rejects(() => validateParent({ id: 't-new', workspaceId: WS }, 't-7', deep), 'depth')
    // One level up the new task lands exactly on depth 8.
    expect(validateParent({ id: 't-new', workspaceId: WS }, 't-6', deep)).toBe('t-6')
  })
  it('counts the existing subtree when a task is re-parented', () => {
    const tasks: HierarchyTask[] = [
      ...chainOf(6),
      node('t-s1', { parentId: 't-5' }),
      node('t-s2', { parentId: 't-s1' }),
      ...chainOf(6, 'r'),
    ]
    // t-5 has a 3-node subtree; new depth 6 + height 3 - 1 = 8 → allowed.
    expect(validateParent({ id: 't-5', workspaceId: WS }, 'r-4', tasks)).toBe('r-4')
    // One level lower pushes the deepest descendant to depth 9 → refused.
    rejects(() => validateParent({ id: 't-5', workspaceId: WS }, 'r-5', tasks), 'depth')
  })
  it('validateHierarchyLinks refuses a record whose subtree exceeds the cap', () => {
    const tasks: HierarchyTask[] = [...chainOf(MAX_TASK_DEPTH), node('t-8', { parentId: 't-7' })]
    const leaf = tasks.find(entry => entry.id === 't-7')
    expect(leaf).toBeDefined()
    if (leaf === undefined) return
    rejects(() => validateHierarchyLinks(leaf, tasks), 'depth')
    // The child is also past the cap on its own parent chain.
    const child = tasks.find(entry => entry.id === 't-8')
    if (child === undefined) throw new Error('fixture missing t-8')
    rejects(() => validateHierarchyLinks(child, tasks), 'depth')
  })
})

describe('hierarchy — progress projection (D6/D9)', () => {
  it('counts direct children only, splitting done/open/blocked/missing', () => {
    const tasks: HierarchyTask[] = [
      node('p', { status: 'in_progress' }),
      node('d-one', { parentId: 'p', status: 'done' }),
      node('d-two', { parentId: 'p', status: 'todo' }),
      node('d-blocked', { parentId: 'p', status: 'todo', blocked: true }),
      // canceled is not done, so it stays open work for the human (D6).
      node('d-canceled', { parentId: 'p', status: 'canceled' }),
      node('d-trashed', { parentId: 'p', status: 'in_review', trashedAt: 5 }),
      // A grandchild is NOT counted by this parent's progress.
      node('g-done', { parentId: 'd-two', status: 'done' }),
    ]
    expect(subtaskProgress('p', tasks)).toEqual({
      total: 4, done: 1, open: 3, blocked: 1, missing: 1,
    })
    expect(subtaskProgress('p', tasks, new Map(tasks.map(entry => [entry.id, entry])))).toEqual({
      total: 4, done: 1, open: 3, blocked: 1, missing: 1,
    })
  })
  it('reports zeros for a leaf or an unknown parent', () => {
    expect(subtaskProgress('d-one', chainOf(3))).toEqual({ total: 0, done: 0, open: 0, blocked: 0, missing: 0 })
    expect(subtaskProgress('ghost', [])).toEqual({ total: 0, done: 0, open: 0, blocked: 0, missing: 0 })
  })
})

describe('hierarchy — navigation helpers', () => {
  it('walks ancestors nearest-parent first and stops at a trashed ancestor', () => {
    const tasks = chainOf(4)
    expect(ancestorsOf('t-3', tasks)).toEqual(['t-2', 't-1', 't-0'])
    expect(ancestorsOf('t-0', tasks)).toEqual([])
    const withTrashed = chainOf(4)
    withTrashed[2] = node('t-2', { trashedAt: 1, parentId: 't-1' })
    expect(ancestorsOf('t-3', withTrashed)).toEqual([])
  })
  it('walks active descendants breadth-first without duplicates', () => {
    const tree: HierarchyTask[] = [
      node('r'),
      node('a', { parentId: 'r' }),
      node('b', { parentId: 'r' }),
      node('a-one', { parentId: 'a' }),
      node('a-two', { parentId: 'a' }),
      node('b-gone', { parentId: 'b', trashedAt: 2 }),
      node('behind-gone', { parentId: 'b-gone' }),
    ]
    expect(descendantsOf('r', tree)).toEqual(['a', 'b', 'a-one', 'a-two'])
    expect(descendantsOf('a-one', tree)).toEqual([])
    // Cyclic hand edit: finite, no duplicate.
    const cyclic: HierarchyTask[] = [node('x', { parentId: 'y' }), node('y', { parentId: 'x' })]
    expect(descendantsOf('x', cyclic)).toEqual(['y'])
  })
})

describe('hierarchy — deletion guards and repair (D7)', () => {
  it('refuses deletion while a non-trashed child exists', () => {
    rejects(() => assertNoChildren('p', [node('p'), node('c', { parentId: 'p' })]), 'has_children')
    expect(() => assertNoChildren('p', [
      node('p'),
      node('c', { parentId: 'p', trashedAt: 3 }),
    ])).not.toThrow()
    expect(() => assertNoChildren('p', [node('p')])).not.toThrow()
  })
  it('detachIsDeleted clears direct child links in place and returns the ids', () => {
    const tasks: HierarchyTask[] = [
      node('p'),
      node('c-one', { parentId: 'p' }),
      node('c-two', { parentId: 'p' }),
      node('g', { parentId: 'c-one' }),
      node('other'),
    ]
    expect(detachIsDeleted('p', tasks)).toEqual(['c-one', 'c-two'])
    expect(tasks.find(entry => entry.id === 'c-one')?.parentId).toBeUndefined()
    expect(tasks.find(entry => entry.id === 'c-two')?.parentId).toBeUndefined()
    // Descendants keep their own parent: only the deleted link is repaired.
    expect(tasks.find(entry => entry.id === 'g')?.parentId).toBe('c-one')
    expect(subtaskProgress('p', tasks).total).toBe(0)
    expect(detachIsDeleted('ghost', tasks)).toEqual([])
  })
})

describe('hierarchy — full link revalidation (import / rebind)', () => {
  it('accepts a coherent record and rejects dangling or cross-workspace links', () => {
    const tasks: HierarchyTask[] = [node('t-parent'), node('t-child', { parentId: 't-parent' })]
    expect(() => validateHierarchyLinks(tasks[1]!, tasks)).not.toThrow()
    expect(() => validateHierarchyLinks(tasks[0]!, tasks)).not.toThrow()
    rejects(() => validateHierarchyLinks(node('t-child', { parentId: 'ghost' }), tasks), 'missing')
    // Parent in another workspace…
    rejects(() => validateHierarchyLinks(
      node('t-child', { parentId: 't-parent' }),
      [node('t-parent', { workspaceId: 'ws-b' }), node('t-child')],
    ), 'cross_workspace')
    // …or child in another workspace (the rebind direction of D7).
    const crossed: HierarchyTask[] = [node('t-parent'), node('t-child', { parentId: 't-parent', workspaceId: 'ws-b' })]
    rejects(() => validateHierarchyLinks(crossed[0]!, crossed), 'cross_workspace')
  })
  it('treats a trashed record as inert but still checks its stored shape', () => {
    expect(() => validateHierarchyLinks(
      node('t-z', { trashedAt: 1, parentId: 'ghost' }),
      [node('t-z', { trashedAt: 1, parentId: 'ghost' })],
    )).not.toThrow()
    rejects(() => validateHierarchyLinks(node('t-z', { trashedAt: 1, parentId: 'bad id!' }), []), 'invalid_input')
    rejects(() => validateHierarchyLinks(node('t-z', { trashedAt: 1, parentId: 't-z' }), []), 'self')
  })
  it('rejects an ancestor cycle on the record itself', () => {
    const cyclic: HierarchyTask[] = [node('t-a', { parentId: 't-b' }), node('t-b', { parentId: 't-a' })]
    rejects(() => validateHierarchyLinks(cyclic[0]!, cyclic), 'cycle')
  })
})

// ---------------------------------------------------------------------------
// protocol integration: parentId in the wire model, import and summarization
// ---------------------------------------------------------------------------

/** Minimal imported-task payload; overrides add the field under test. */
const imported = (extra: Record<string, unknown> = {}): unknown => ({
  id: 't-imp',
  title: 'Imported',
  workspaceId: WS,
  comments: [],
  executions: [],
  ...extra,
})

/** Minimal load-time record shape (what store.load accepts). */
const plausible = (extra: Record<string, unknown> = {}): unknown => ({
  id: 't-ok',
  title: 'Ok',
  workspaceId: WS,
  status: 'todo',
  version: 1,
  execution: { mode: 'claim' },
  comments: [],
  executions: [],
  ...extra,
})

/** Full TaskRecord fixture for summarize/spawnNextCycle. */
function record(overrides: Partial<TaskRecord> = {}): TaskRecord {
  return {
    id: 't-source',
    title: 'Source',
    description: '',
    prompt: '',
    workspaceId: WS,
    urgency: 'normal',
    status: 'todo',
    blocked: false,
    execution: { mode: 'scheduled', cron: '0 * * * *' },
    version: 1,
    createdAt: 0,
    updatedAt: 0,
    createdBy: { kind: 'user' },
    updatedBy: { kind: 'user' },
    comments: [],
    executions: [],
    ...overrides,
  }
}

describe('protocol — parentId import and plausibility (F8/D10)', () => {
  it('round-trips parentId and drops forged derived projections (D9)', () => {
    const result = validateImportedTask(imported({
      parentId: 't-parent',
      dependsOn: ['t-dep'],
      // A hand-edited file must never smuggle derived state into the ledger.
      dependencyProgress: { total: 1, completed: 1, pendingIds: [], missingIds: [], ready: true },
      subtaskProgress: { total: 2, done: 2, open: 0, blocked: 0, missing: 0 },
    }), 0)
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error(result.reason)
    expect(result.task.parentId).toBe('t-parent')
    expect(result.task.dependsOn).toEqual(['t-dep'])
    expect(result.task.dependencyProgress).toBeUndefined()
    expect(result.task.subtaskProgress).toBeUndefined()
  })
  it('loads a legacy record without dependsOn/parentId unchanged (D10)', () => {
    const result = validateImportedTask(imported(), 0)
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error(result.reason)
    expect(result.task.parentId).toBeUndefined()
    expect(result.task.dependsOn).toBeUndefined()
    expect('parentId' in result.task).toBe(false)
    expect('dependsOn' in result.task).toBe(false)
  })
  it('rejects malformed, self, duplicate and self-referencing links', () => {
    for (const parentId of [42, 'bad id!', 't-imp']) {
      expect(validateImportedTask(imported({ parentId }), 0)).toMatchObject({ ok: false, reason: 'invalid parentId' })
    }
    expect(validateImportedTask(imported({ dependsOn: ['t-a', 't-a'] }), 0)).toMatchObject({ ok: false })
    expect(validateImportedTask(imported({ dependsOn: ['t-imp'] }), 0)).toMatchObject({ ok: false })
    expect(validateImportedTask(imported({ dependsOn: ['t-a'] }), 0)).toMatchObject({ ok: true })
  })
  it('isPlausibleTaskRecord is structural and lets load repair bad link CONTENT', () => {
    expect(isPlausibleTaskRecord(plausible())).toBe(true)
    expect(isPlausibleTaskRecord(plausible({ dependsOn: ['t-a'] }))).toBe(true)
    expect(isPlausibleTaskRecord(plausible({ parentId: 't-a' }))).toBe(true)
    // Duplicate/self link content is repaired on load (F8/D10): a corrupt
    // optional field must not make the whole board unloadable.
    expect(isPlausibleTaskRecord(plausible({ dependsOn: ['t-a', 't-a'] }))).toBe(true)
    expect(isPlausibleTaskRecord(plausible({ dependsOn: ['t-ok'] }))).toBe(true)
    expect(isPlausibleTaskRecord(plausible({ parentId: 't-ok' }))).toBe(true)
    // Structural corruption is still fatal: an illegal id or a non-string
    // parentId cannot be repaired safely and keeps the existing hard gate.
    expect(isPlausibleTaskRecord(plausible({ parentId: 42 }))).toBe(false)
    expect(isPlausibleTaskRecord(plausible({ dependsOn: ['bad id!'] }))).toBe(false)
  })
  it('repairTaskLinks drops duplicate/self/invalid links and reports each drop', () => {
    const corrupt = record({
      id: 't-ok',
      dependsOn: ['t-a', 't-a', 't-ok', 't-b'],
      parentId: 't-ok',
    })
    expect(repairTaskLinks(corrupt)).toEqual([
      "dependsOn: dropped duplicate 't-a'",
      "dependsOn: dropped self reference 't-ok'",
      'parentId: dropped self reference',
    ])
    expect(corrupt.dependsOn).toEqual(['t-a', 't-b'])
    expect(corrupt.parentId).toBeUndefined()

    const illegal = record({ id: 't-illegal', dependsOn: ['bad id!'] })
    expect(repairTaskLinks(illegal)).toEqual(["dependsOn: dropped invalid id 'bad id!'"])
    expect(illegal.dependsOn).toBeUndefined()

    const wide = record({
      id: 't-wide',
      dependsOn: Array.from({ length: MAX_TASK_DEPENDENCIES + 2 }, (_, i) => `p-${i}`),
    })
    expect(repairTaskLinks(wide)).toEqual([
      `dependsOn: truncated ${MAX_TASK_DEPENDENCIES + 2} links to ${MAX_TASK_DEPENDENCIES}`,
    ])
    expect(wide.dependsOn).toHaveLength(MAX_TASK_DEPENDENCIES)

    const clean = record({ dependsOn: ['t-a'], parentId: 't-parent' })
    expect(repairTaskLinks(clean)).toEqual([])
    expect(clean.dependsOn).toEqual(['t-a'])
    expect(clean.parentId).toBe('t-parent')
  })
})

describe('protocol — parentId in summaries and cycle succession', () => {
  it('summarize emits parentId only when set', () => {
    expect(summarize(record({ parentId: 't-parent' })).parentId).toBe('t-parent')
    expect('parentId' in summarize(record())).toBe(false)
  })
  it('spawnNextCycle keeps the parent slot and prerequisites', () => {
    const next = spawnNextCycle(record({ parentId: 't-parent', dependsOn: ['t-dep'] }), undefined, 1_700_000_000_000)
    expect(next.parentId).toBe('t-parent')
    expect(next.dependsOn).toEqual(['t-dep'])
    expect(next.spawnedFrom).toBe('t-source')
  })
})

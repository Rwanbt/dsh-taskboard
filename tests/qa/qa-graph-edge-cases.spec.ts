/**
 * Edge-case tests for the two pure graph modules (`dependencies.ts`,
 * `hierarchy.ts`) aimed at the traversal branches the existing suites do not
 * reach: multi-hop cycles, dangling intermediate ids, shared reachability and
 * a hand-edited cyclic subtree.
 *
 * @module dsh-taskboard/tests/qa/graph-edge-cases
 */
import { describe, expect, it } from 'vitest'
import {
  DependencyError,
  MAX_TASK_DEPENDENCIES,
  buildDependencyIndex,
  dependencyState,
  downstreamDependents,
  isDependencyReady,
  prerequisiteDetails,
  validateDependencies,
  validateWorkspaceLinks,
  type DependencyTask,
} from '../../src/shared/dependencies.ts'
import {
  HierarchyError,
  MAX_TASK_DEPTH,
  assertNoChildren,
  ancestorsOf,
  descendantsOf,
  detachIsDeleted,
  subtaskProgress,
  validateHierarchyLinks,
  validateParent,
  type HierarchyTask,
} from '../../src/shared/hierarchy.ts'

const WS = 'ws-edge'
const OTHER = 'ws-other'

/** A dependency fixture. */
function dep(id: string, extra: Partial<DependencyTask> = {}): DependencyTask {
  return { id, workspaceId: WS, status: 'todo', ...extra }
}

/** A hierarchy fixture. */
function hier(id: string, extra: Partial<HierarchyTask> = {}): HierarchyTask {
  return { id, workspaceId: WS, status: 'todo', ...extra }
}

/** Capture the stable code of a thrown graph error. */
function codeOf(fn: () => unknown): string | undefined {
  try {
    fn()
    return undefined
  } catch (error) {
    if (error instanceof DependencyError || error instanceof HierarchyError) return error.code
    return `unexpected:${String(error)}`
  }
}

describe('dependencies — traversal edge cases', () => {
  it('detects a MULTI-HOP cycle through the whole prerequisite chain', () => {
    // t-new -> a -> b -> c -> t-new
    const tasks = [
      dep('a', { dependsOn: ['b'] }),
      dep('b', { dependsOn: ['c'] }),
      dep('c', { dependsOn: ['t-new'] }),
    ]
    expect(codeOf(() => validateDependencies({ id: 't-new', workspaceId: WS }, ['a'], tasks))).toBe('cycle')
    // The error names the candidate responsible for the cycle.
    try {
      validateDependencies({ id: 't-new', workspaceId: WS }, ['a'], tasks)
      throw new Error('expected a cycle')
    } catch (error) {
      expect(error).toBeInstanceOf(DependencyError)
      expect((error as DependencyError).message).toMatch(/cycle via a/)
    }
  })

  it('walks THROUGH a dangling intermediate id without hanging or throwing', () => {
    // a -> ghost (absent). A new dependent on a is legal; the traversal must
    // skip the missing node instead of aborting.
    const tasks = [dep('a', { dependsOn: ['ghost'] })]
    expect(validateDependencies({ id: 't-new', workspaceId: WS }, ['a'], tasks)).toEqual(['a'])
  })

  it('handles SHARED reachability between candidates without a false cycle', () => {
    const tasks = [
      dep('a', { dependsOn: ['shared'] }),
      dep('b', { dependsOn: ['shared'] }),
      dep('shared'),
    ]
    expect(validateDependencies({ id: 't-new', workspaceId: WS }, ['a', 'b'], tasks)).toEqual(['a', 'b'])
  })

  it('finds a cycle that only exists through a shared intermediate', () => {
    // t-new -> a -> shared -> b -> t-new
    const tasks = [
      dep('a', { dependsOn: ['shared'] }),
      dep('b', { dependsOn: ['t-new'] }),
      dep('shared', { dependsOn: ['b'] }),
    ]
    expect(codeOf(() => validateDependencies({ id: 't-new', workspaceId: WS }, ['a'], tasks))).toBe('cycle')
  })

  it('accepts exactly MAX_TASK_DEPENDENCIES links and rejects one more', () => {
    const targets = Array.from({ length: MAX_TASK_DEPENDENCIES + 1 }, (_, index) => dep(`p${index}`))
    const atLimit = targets.slice(0, MAX_TASK_DEPENDENCIES).map(target => target.id)
    expect(validateDependencies({ id: 't', workspaceId: WS }, atLimit, targets)).toHaveLength(MAX_TASK_DEPENDENCIES)
    expect(codeOf(() => validateDependencies({ id: 't', workspaceId: WS }, [...atLimit, targets.at(-1)!.id], targets)))
      .toBe('too_many')
  })

  it('rejects non-string entries and traversal-shaped ids', () => {
    const tasks = [dep('ok')]
    expect(codeOf(() => validateDependencies({ id: 't', workspaceId: WS }, [42], tasks))).toBe('invalid_input')
    expect(codeOf(() => validateDependencies({ id: 't', workspaceId: WS }, ['../escape'], tasks))).toBe('invalid_id')
    expect(codeOf(() => validateDependencies({ id: 't', workspaceId: WS }, ['ok', 'ok'], tasks))).toBe('duplicate')
    expect(codeOf(() => validateDependencies({ id: 't', workspaceId: WS }, ['t'], tasks))).toBe('self')
    expect(codeOf(() => validateDependencies({ id: 't', workspaceId: WS }, ['missing'], tasks))).toBe('missing')
  })

  it('treats a TRASHED prerequisite as missing at write time and as blocking at read time', () => {
    const tasks = [dep('gone', { trashedAt: 5 })]
    expect(codeOf(() => validateDependencies({ id: 't', workspaceId: WS }, ['gone'], tasks))).toBe('missing')
    expect(dependencyState({ dependsOn: ['gone'] }, tasks)).toMatchObject({
      ready: false, pendingIds: ['gone'], missingIds: ['gone'], completed: 0, total: 1,
    })
  })

  it('the prebuilt index answers exactly like the array form', () => {
    const tasks = [dep('a', { status: 'done' }), dep('b'), dep('t', { dependsOn: ['a', 'b'] })]
    const index = buildDependencyIndex(tasks)
    expect(dependencyState(tasks[2]!, tasks, index)).toEqual(dependencyState(tasks[2]!, tasks))
    expect(isDependencyReady(tasks[2]!, index)).toBe(false)
    expect(isDependencyReady(dep('x', { dependsOn: ['a'] }), index)).toBe(true)
    expect(prerequisiteDetails(tasks[2]!, tasks, index)).toEqual([
      { id: 'a', state: 'done', status: 'done' },
      { id: 'b', state: 'pending', status: 'todo' },
    ])
  })

  it('prerequisiteDetails distinguishes absent, trashed and pending records', () => {
    const tasks = [dep('trashed', { title: 'T', status: 'todo', trashedAt: 9 })]
    expect(prerequisiteDetails({ dependsOn: ['absent', 'trashed'] }, tasks)).toEqual([
      { id: 'absent', state: 'missing' },
      { id: 'trashed', title: 'T', status: 'todo', trashed: true, state: 'missing' },
    ])
  })

  it('downstreamDependents is transitive, de-duplicated and skips trashed work', () => {
    const tasks = [
      dep('a'),
      dep('b', { dependsOn: ['a'] }),
      dep('c', { dependsOn: ['b'] }),
      dep('d', { dependsOn: ['a', 'b'] }),
      dep('trashed', { dependsOn: ['a'], trashedAt: 1 }),
      dep('under-trashed', { dependsOn: ['trashed'] }),
    ]
    const downstream = downstreamDependents('a', tasks)
    expect(downstream).toEqual(['b', 'd', 'c'])
    expect(new Set(downstream).size).toBe(downstream.length)
    expect(downstream).not.toContain('trashed')
    expect(downstream).not.toContain('under-trashed')
  })

  it('validateWorkspaceLinks rejects an outgoing dependency in another workspace', () => {
    const tasks = [dep('foreign', { workspaceId: OTHER })]
    expect(codeOf(() => validateWorkspaceLinks(
      { id: 't', workspaceId: WS, dependsOn: ['foreign'] }, tasks,
    ))).toBe('cross_workspace')
  })

  it('validateWorkspaceLinks rejects moving a task that a live dependent still requires', () => {
    const tasks = [dep('dependent', { workspaceId: WS, dependsOn: ['t'] })]
    expect(codeOf(() => validateWorkspaceLinks({ id: 't', workspaceId: OTHER }, tasks))).toBe('cross_workspace')
    // A trashed dependent no longer pins the task to its workspace.
    const trashed = [dep('dependent', { workspaceId: WS, dependsOn: ['t'], trashedAt: 3 })]
    expect(codeOf(() => validateWorkspaceLinks({ id: 't', workspaceId: OTHER }, trashed))).toBeUndefined()
  })
})

describe('hierarchy — traversal edge cases', () => {
  it('refuses a re-link when the task has a hand-edited cyclic subtree below it', () => {
    // `a` is its own child in a corrupt ledger: assertSubtreeFits must report
    // the cycle instead of looping.
    const tasks = [hier('p'), hier('a', { parentId: 'a' })]
    expect(codeOf(() => validateParent({ id: 'a', workspaceId: WS }, 'p', tasks))).toBe('cycle')
  })

  it('validateHierarchyLinks reports a cyclic chain and a self link', () => {
    const cyclic = [hier('a', { parentId: 'b' }), hier('b', { parentId: 'a' })]
    expect(codeOf(() => validateHierarchyLinks(cyclic[0]!, cyclic))).toBe('cycle')
    expect(codeOf(() => validateHierarchyLinks(hier('solo', { parentId: 'solo' }), [hier('solo', { parentId: 'solo' })]))).toBe('self')
  })

  it('validateHierarchyLinks rejects a live child in another workspace (D7 rebind guard)', () => {
    const tasks = [hier('parent'), hier('child', { parentId: 'parent', workspaceId: OTHER })]
    expect(codeOf(() => validateHierarchyLinks(tasks[0]!, tasks))).toBe('cross_workspace')
  })

  it('a trashed record only gets shape validation, so a corrupt legacy link stays importable', () => {
    const trashed = hier('old', { parentId: 'ghost-parent', trashedAt: 4 })
    expect(() => validateHierarchyLinks(trashed, [trashed])).not.toThrow()
    // …but an invalid SHAPE is still refused, trashed or not.
    expect(codeOf(() => validateHierarchyLinks(hier('bad', { parentId: 'not a valid id' }), []))).toBe('invalid_input')
  })

  it('enforces the depth cap on a re-link that would push an existing subtree over the limit', () => {
    // A target chain of depth 2 plus an unrelated 7-deep subtree: moving the
    // subtree root under child2 would put its leaf at depth 9.
    const tasks: HierarchyTask[] = [
      hier('root2'),
      hier('child2', { parentId: 'root2' }),
      hier('s1'),
      hier('s2', { parentId: 's1' }),
      hier('s3', { parentId: 's2' }),
      hier('s4', { parentId: 's3' }),
      hier('s5', { parentId: 's4' }),
      hier('s6', { parentId: 's5' }),
      hier('s7', { parentId: 's6' }),
    ]
    expect(MAX_TASK_DEPTH).toBe(8)
    // s1 would sit at depth 3; s7 would sit at depth 9 → refused.
    expect(codeOf(() => validateParent({ id: 's1', workspaceId: WS }, 'child2', tasks))).toBe('depth')
    // The same subtree attached at the root (depth 1) fits exactly (7 ≤ 8).
    expect(validateParent({ id: 's1', workspaceId: WS }, 'root2', tasks)).toBe('root2')
  })

  it('ancestorsOf stops at a missing or trashed ancestor; descendantsOf skips trashed children', () => {
    const tasks = [
      hier('root'),
      hier('mid', { parentId: 'root' }),
      hier('leaf', { parentId: 'mid' }),
      hier('gone', { parentId: 'root', trashedAt: 2 }),
      hier('orphan', { parentId: 'missing-parent' }),
    ]
    expect(ancestorsOf('leaf', tasks)).toEqual(['mid', 'root'])
    expect(ancestorsOf('orphan', tasks)).toEqual([])
    expect(descendantsOf('root', tasks)).toEqual(['mid', 'leaf'])
    expect(descendantsOf('missing-parent', tasks)).toEqual(['orphan'])
  })

  it('subtaskProgress counts only direct children and reports trashed ones as missing', () => {
    const tasks = [
      hier('p'),
      hier('k1', { parentId: 'p', status: 'done' }),
      hier('k2', { parentId: 'p', status: 'todo', blocked: true }),
      hier('k3', { parentId: 'p', trashedAt: 7 }),
      hier('grand', { parentId: 'k1' }),
    ]
    expect(subtaskProgress('p', tasks)).toEqual({ total: 2, done: 1, open: 1, blocked: 1, missing: 1 })
  })

  it('assertNoChildren only refuses live children; detachIsDeleted clears every direct link', () => {
    const live = [hier('p'), hier('child', { parentId: 'p' })]
    expect(codeOf(() => assertNoChildren('p', live))).toBe('has_children')
    const inert = [hier('p'), hier('gone', { parentId: 'p', trashedAt: 2 })]
    expect(() => assertNoChildren('p', inert)).not.toThrow()
    expect(detachIsDeleted('p', inert)).toEqual(['gone'])
    expect(inert[1]!.parentId).toBeUndefined()
    expect(detachIsDeleted('nobody', inert)).toEqual([])
  })
})

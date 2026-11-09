import { describe, expect, it } from 'vitest'
import {
  DependencyError, MAX_TASK_DEPENDENCIES, buildDependencyIndex, dependencyState,
  downstreamDependents, isDependencyReady, prerequisiteDetails,
  validateDependencies, validateWorkspaceLinks, type DependencyTask,
} from '../src/shared/dependencies.ts'

const base: DependencyTask[] = [
  { id: 't-a', workspaceId: 'repo', status: 'done', dependsOn: [] },
  { id: 't-b', workspaceId: 'repo', status: 'todo', dependsOn: ['t-a'] },
  { id: 't-c', workspaceId: 'repo', status: 'in_review', dependsOn: ['t-b'] },
]
const task = { id: 't-d', workspaceId: 'repo' }
const rejects = (cb: () => unknown, code: string): void => {
  try {
    cb()
    throw new Error('Expected DependencyError')
  } catch (error) {
    expect(error).toBeInstanceOf(DependencyError)
    expect((error as DependencyError).code).toBe(code)
  }
}
/** The code of the thrown DependencyError, or undefined when the call passed. */
const failureCode = (cb: () => unknown): string | undefined => {
  try {
    cb()
    return undefined
  } catch (error) {
    return error instanceof DependencyError ? error.code : 'unexpected:' + String(error)
  }
}
/** A linear ledger t-0 → t-1 → … whose root is the only accepted task. */
const chainTasks = (size: number, workspaceId = 'repo'): DependencyTask[] => {
  const tasks: DependencyTask[] = []
  for (let i = 0; i < size; i++) {
    tasks.push({
      id: `t-${i}`,
      workspaceId,
      status: i === 0 ? 'done' : 'todo',
      ...(i > 0 ? { dependsOn: [`t-${i - 1}`] } : {}),
    })
  }
  return tasks
}
/** A deterministic 80-task DAG (each task depends on two earlier ones). */
const dagTasks = (size: number): DependencyTask[] => {
  const tasks: DependencyTask[] = []
  for (let i = 0; i < size; i++) {
    const deps: string[] = []
    if (i > 0) deps.push(`t-${i - 1}`)
    if (i > 2) deps.push(`t-${i - 3}`)
    tasks.push({
      id: `t-${i}`,
      workspaceId: 'repo',
      status: i % 4 === 0 ? 'done' : 'todo',
      ...(deps.length > 0 ? { dependsOn: deps } : {}),
    })
  }
  return tasks
}

describe('task dependencies', () => {
  it('accepts multiple valid prerequisites', () => {
    expect(validateDependencies(task, ['t-a', 't-b'], base)).toEqual(['t-a', 't-b'])
    expect(validateDependencies(task, [], base)).toEqual([])
  })
  it('requires human-accepted done, not in_review', () => {
    expect(dependencyState({ dependsOn: ['t-a', 't-c'] }, base)).toEqual({
      total: 2, completed: 1, pendingIds: ['t-c'], missingIds: [], ready: false,
    })
    expect(dependencyState({ dependsOn: ['t-a'] }, base).ready).toBe(true)
  })
  it('treats missing and trashed prerequisite as blocking', () => {
    expect(dependencyState({ dependsOn: ['missing'] }, base).missingIds).toEqual(['missing'])
    expect(dependencyState({ dependsOn: ['t-a'] }, [{ ...base[0]!, trashedAt: 1 }]).ready).toBe(false)
  })
  it('reblocks if a completed prerequisite reopens', () => {
    expect(dependencyState({ dependsOn: ['t-a'] }, base).ready).toBe(true)
    expect(dependencyState({ dependsOn: ['t-a'] }, [{ ...base[0]!, status: 'todo' }]).ready).toBe(false)
  })
  it('rejects invalid arrays, duplicate IDs, cycles and cross-workspace links', () => {
    rejects(() => validateDependencies(task, 't-a', base), 'invalid_input')
    rejects(() => validateDependencies(task, ['t-a', 't-a'], base), 'duplicate')
    rejects(() => validateDependencies(task, ['t-d'], base), 'self')
    rejects(() => validateDependencies(task, ['absent'], base), 'missing')
    rejects(() => validateDependencies(task, ['external'], [
      ...base, { id: 'external', workspaceId: 'other', status: 'todo' },
    ]), 'cross_workspace')
    rejects(() => validateDependencies({ id: 't-a', workspaceId: 'repo' }, ['t-c'], base), 'cycle')
  })
  it('rejects moving a task when another project has a reverse dependency', () => {
    rejects(() => validateWorkspaceLinks({ ...base[0]!, workspaceId: 'other' }, base), 'cross_workspace')
  })
  it('enumerates downstream dependents without duplicates', () => {
    expect(downstreamDependents('t-a', base)).toEqual(['t-b', 't-c'])
  })
})

describe('task dependencies — scale', () => {
  it('handles a 500-task chain end to end', () => {
    const chain = chainTasks(500)
    // A fresh task may depend on any existing link of a deep chain.
    expect(validateDependencies({ id: 't-fresh', workspaceId: 'repo' }, ['t-0'], chain)).toEqual(['t-0'])
    expect(validateDependencies({ id: 't-fresh', workspaceId: 'repo' }, ['t-499'], chain)).toEqual(['t-499'])
    // Adding a link back to the root closes a 500-node cycle.
    rejects(() => validateDependencies({ id: 't-0', workspaceId: 'repo' }, ['t-499'], chain), 'cycle')
    // The downstream walk covers the whole chain exactly once.
    const dependents = downstreamDependents('t-0', chain)
    expect(dependents).toHaveLength(499)
    expect(dependents[0]).toBe('t-1')
    expect(dependents.at(-1)).toBe('t-499')
    expect(new Set(dependents).size).toBe(499)
    // Readiness projection stays O(prerequisites) on the same deep chain.
    const index = buildDependencyIndex(chain)
    expect(isDependencyReady({ dependsOn: ['t-0'] }, index)).toBe(true)
    expect(isDependencyReady({ dependsOn: ['t-499'] }, index)).toBe(false)
  })

  it('keeps the same results for an 80-task DAG with and without an index', () => {
    const ledger = dagTasks(80)
    const index = buildDependencyIndex(ledger)
    for (const candidate of ledger) {
      const state = dependencyState(candidate, ledger)
      expect(dependencyState(candidate, ledger, index)).toEqual(state)
      expect(isDependencyReady(candidate, index)).toBe(state.ready)
      expect(prerequisiteDetails(candidate, ledger, index)).toEqual(prerequisiteDetails(candidate, ledger))
    }
    const fresh = { id: 't-fresh', workspaceId: 'repo' }
    expect(validateDependencies(fresh, ['t-0', 't-2'], ledger, index))
      .toEqual(validateDependencies(fresh, ['t-0', 't-2'], ledger))
    // A cycle through the deep chain is detected identically with or without
    // the prebuilt index (same code, not some incidental failure).
    const cyclicCandidate = { id: 't-0', workspaceId: 'repo' }
    expect(failureCode(() => validateDependencies(cyclicCandidate, ['t-79'], ledger, index)))
      .toBe(failureCode(() => validateDependencies(cyclicCandidate, ['t-79'], ledger)))
    expect(failureCode(() => validateDependencies(cyclicCandidate, ['t-79'], ledger))).toBe('cycle')
  })
})

describe('task dependencies — cycle handling', () => {
  it('rejects indirect cycles but accepts a diamond that is acyclic', () => {
    const diamond: DependencyTask[] = [
      { id: 't-root', workspaceId: 'repo', status: 'done' },
      { id: 't-b', workspaceId: 'repo', status: 'todo', dependsOn: ['t-root'] },
      { id: 't-c', workspaceId: 'repo', status: 'todo', dependsOn: ['t-root'] },
      { id: 't-d', workspaceId: 'repo', status: 'todo', dependsOn: ['t-b', 't-c'] },
    ]
    // root would depend on d which transitively depends on root: cycle.
    rejects(() => validateDependencies({ id: 't-root', workspaceId: 'repo' }, ['t-d'], diamond), 'cycle')
    // A fresh task above d is fine: the diamond has no cycle.
    expect(validateDependencies({ id: 't-e', workspaceId: 'repo' }, ['t-d'], diamond)).toEqual(['t-d'])
    // Four nodes, cycle closed by a link two hops away.
    const line = chainTasks(4)
    rejects(() => validateDependencies({ id: 't-0', workspaceId: 'repo' }, ['t-3'], line), 'cycle')
    rejects(() => validateDependencies({ id: 't-1', workspaceId: 'repo' }, ['t-3'], line), 'cycle')
  })

  it('stays finite and safe on a hand-edited cyclic ledger', () => {
    const cyclic: DependencyTask[] = [
      { id: 't-a', workspaceId: 'repo', status: 'todo', dependsOn: ['t-b'] },
      { id: 't-b', workspaceId: 'repo', status: 'done', dependsOn: ['t-c'] },
      { id: 't-c', workspaceId: 'repo', status: 'todo', dependsOn: ['t-a'] },
      { id: 't-d', workspaceId: 'repo', status: 'todo', dependsOn: ['t-a'] },
      { id: 't-e', workspaceId: 'repo', status: 'todo', dependsOn: ['t-e'] },
    ]
    // Classification never traverses, so it simply reports the two live links.
    expect(dependencyState({ dependsOn: ['t-a', 't-e'] }, cyclic)).toEqual({
      total: 2, completed: 0, pendingIds: ['t-a', 't-e'], missingIds: [], ready: false,
    })
    // Downstream walks terminate and never duplicate a node, including a
    // self-referencing record.
    const dependents = downstreamDependents('t-a', cyclic)
    expect(dependents).toEqual(['t-c', 't-d', 't-b'])
    expect(new Set(dependents).size).toBe(dependents.length)
    expect(downstreamDependents('t-e', cyclic)).toEqual([])
    // Linking a new task into the cycle's upstream side is safe (no new cycle).
    expect(validateDependencies({ id: 't-x', workspaceId: 'repo' }, ['t-a'], cyclic)).toEqual(['t-a'])
    // Linking an EXISTING cycle member to its downstream still detects it.
    rejects(() => validateDependencies({ id: 't-a', workspaceId: 'repo' }, ['t-c'], cyclic), 'cycle')
    expect(isDependencyReady({ dependsOn: ['t-b'] }, buildDependencyIndex(cyclic))).toBe(true)
  })

  it('stays finite on a 500-node ledger closed into one cycle', () => {
    const ledger = chainTasks(500)
    // Hand edit: the root now depends on the leaf, so every node is on a cycle.
    const root = ledger[0]!
    root.dependsOn = ['t-499']
    // Classification still terminates; the root itself is done but a blocked
    // downstream task stays blocked without any traversal.
    expect(dependencyState({ dependsOn: ['t-0'] }, ledger).ready).toBe(true)
    expect(dependencyState({ dependsOn: ['t-1'] }, ledger).ready).toBe(false)
    const dependents = downstreamDependents('t-0', ledger)
    expect(dependents).toHaveLength(499)
    expect(new Set(dependents).size).toBe(499)
    // A brand-new link into the middle cannot reach the new id: accepted.
    expect(validateDependencies({ id: 't-fresh', workspaceId: 'repo' }, ['t-250'], ledger)).toEqual(['t-250'])
    // Re-pointing the root at its own descendant stays detected.
    rejects(() => validateDependencies({ id: 't-0', workspaceId: 'repo' }, ['t-250'], ledger), 'cycle')
  })
})

describe('task dependencies — prerequisite detail (F6)', () => {
  const ledger: DependencyTask[] = [
    { id: 't-done', workspaceId: 'repo', status: 'done', title: 'Done work' },
    { id: 't-todo', workspaceId: 'repo', status: 'todo', title: 'Todo work' },
    { id: 't-trashed', workspaceId: 'repo', status: 'in_review', title: 'Gone work', trashedAt: 7 },
  ]
  it('explains each prerequisite with title, status and state', () => {
    expect(prerequisiteDetails({ dependsOn: ['t-done', 't-todo', 't-trashed', 'ghost'] }, ledger)).toEqual([
      { id: 't-done', title: 'Done work', status: 'done', state: 'done' },
      { id: 't-todo', title: 'Todo work', status: 'todo', state: 'pending' },
      { id: 't-trashed', title: 'Gone work', status: 'in_review', trashed: true, state: 'missing' },
      { id: 'ghost', state: 'missing' },
    ])
    // The projection agrees with the gate it is meant to explain.
    expect(dependencyState({ dependsOn: ['t-done', 't-todo', 't-trashed', 'ghost'] }, ledger)).toEqual({
      total: 4,
      completed: 1,
      pendingIds: ['t-todo', 't-trashed', 'ghost'],
      missingIds: ['t-trashed', 'ghost'],
      ready: false,
    })
  })
  it('returns no detail for a task without prerequisites (legacy ledger)', () => {
    expect(prerequisiteDetails({}, ledger)).toEqual([])
    expect(prerequisiteDetails({ dependsOn: [] }, ledger)).toEqual([])
    expect(dependencyState({}, ledger)).toEqual({ total: 0, completed: 0, pendingIds: [], missingIds: [], ready: true })
  })
})

describe('task dependencies — limits and ordering', () => {
  it('accepts exactly MAX_TASK_DEPENDENCIES and rejects one more', () => {
    expect(MAX_TASK_DEPENDENCIES).toBe(32)
    const targets: DependencyTask[] = Array.from({ length: MAX_TASK_DEPENDENCIES + 1 }, (_, i) => ({
      id: `p-${i}`,
      workspaceId: 'repo',
      status: 'done',
    }))
    const ids = targets.map(entry => entry.id)
    const candidate = { id: 't-many', workspaceId: 'repo' }
    expect(validateDependencies(candidate, ids.slice(0, MAX_TASK_DEPENDENCIES), targets))
      .toHaveLength(MAX_TASK_DEPENDENCIES)
    rejects(() => validateDependencies(candidate, ids, targets), 'too_many')
    rejects(() => validateDependencies(candidate, [1, 2] as unknown[], targets), 'invalid_input')
  })
  it('preserves the caller order of accepted ids and rejects duplicates', () => {
    const ordered: DependencyTask[] = [
      { id: 'p-1', workspaceId: 'repo', status: 'done' },
      { id: 'p-2', workspaceId: 'repo', status: 'todo' },
      { id: 'p-3', workspaceId: 'repo', status: 'done' },
    ]
    expect(validateDependencies({ id: 't-order', workspaceId: 'repo' }, ['p-3', 'p-1'], ordered))
      .toEqual(['p-3', 'p-1'])
    rejects(() => validateDependencies({ id: 't-order', workspaceId: 'repo' }, ['p-1', 'p-1'], ordered), 'duplicate')
    rejects(() => validateDependencies({ id: 't-order', workspaceId: 'repo' }, ['p-1', 'bad id!'], ordered), 'invalid_id')
  })
})

describe('task dependencies — workspace boundaries', () => {
  it('rejects cross-workspace links in both directions', () => {
    const tasks: DependencyTask[] = [
      { id: 't-a', workspaceId: 'ws-a', status: 'todo' },
      { id: 't-b', workspaceId: 'ws-b', status: 'todo', dependsOn: ['t-a'] },
    ]
    rejects(() => validateDependencies({ id: 't-new', workspaceId: 'ws-b' }, ['t-a'], tasks), 'cross_workspace')
    rejects(() => validateDependencies({ id: 't-new', workspaceId: 'ws-a' }, ['t-b'], tasks), 'cross_workspace')
    // Rebinding t-a away from the workspace of its dependent is refused…
    rejects(() => validateWorkspaceLinks({ ...tasks[0]!, workspaceId: 'ws-c' }, tasks), 'cross_workspace')
    // …while rebinding it INTO the dependent's workspace keeps the links legal.
    expect(() => validateWorkspaceLinks({ ...tasks[0]!, workspaceId: 'ws-b' }, tasks)).not.toThrow()
  })
  it('ignores trashed dependents when checking a reverse link', () => {
    const tasks: DependencyTask[] = [
      { id: 't-a', workspaceId: 'ws-a', status: 'todo' },
      { id: 't-b', workspaceId: 'ws-b', status: 'todo', dependsOn: ['t-a'], trashedAt: 1 },
    ]
    expect(() => validateWorkspaceLinks({ ...tasks[0]!, workspaceId: 'ws-c' }, tasks)).not.toThrow()
  })
})

describe('task dependencies — downstream projection', () => {
  const diamond: DependencyTask[] = [
    { id: 't-root', workspaceId: 'repo', status: 'done' },
    { id: 't-b', workspaceId: 'repo', status: 'todo', dependsOn: ['t-root'] },
    { id: 't-c', workspaceId: 'repo', status: 'todo', dependsOn: ['t-root'] },
    { id: 't-d', workspaceId: 'repo', status: 'todo', dependsOn: ['t-b', 't-c'] },
    { id: 't-gone', workspaceId: 'repo', status: 'todo', dependsOn: ['t-root'], trashedAt: 1 },
    { id: 't-behind-gone', workspaceId: 'repo', status: 'todo', dependsOn: ['t-gone'] },
  ]
  it('dedupes a diamond and never traverses through trashed work', () => {
    expect(downstreamDependents('t-root', diamond)).toEqual(['t-b', 't-c', 't-d'])
    expect(downstreamDependents('t-missing', diamond)).toEqual([])
  })
  it('is stable when called twice and on an empty ledger', () => {
    expect(downstreamDependents('t-root', diamond)).toEqual(downstreamDependents('t-root', diamond))
    expect(downstreamDependents('t-root', [])).toEqual([])
  })
})

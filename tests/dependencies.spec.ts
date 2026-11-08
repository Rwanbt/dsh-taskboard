import { describe, expect, it } from 'vitest'
import {
  DependencyError, dependencyState, downstreamDependents,
  validateDependencies, validateWorkspaceLinks,
} from '../src/shared/dependencies.ts'

const base = [
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
    expect(dependencyState({ dependsOn: ['t-a'] }, [{ ...base[0], trashedAt: 1 }]).ready).toBe(false)
  })
  it('reblocks if a completed prerequisite reopens', () => {
    expect(dependencyState({ dependsOn: ['t-a'] }, base).ready).toBe(true)
    expect(dependencyState({ dependsOn: ['t-a'] }, [{ ...base[0], status: 'todo' }]).ready).toBe(false)
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
    rejects(() => validateWorkspaceLinks({ ...base[0], workspaceId: 'other' }, base), 'cross_workspace')
  })
  it('enumerates downstream dependents without duplicates', () => {
    expect(downstreamDependents('t-a', base)).toEqual(['t-b', 't-c'])
  })
})

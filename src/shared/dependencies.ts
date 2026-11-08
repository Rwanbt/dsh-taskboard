/** Pure dependency graph: no host, I/O or React dependencies. */
export const MAX_TASK_DEPENDENCIES = 32

export interface DependencyTask {
  id: string
  workspaceId: string
  status: string
  trashedAt?: number
  dependsOn?: readonly string[]
}

export type DependencyErrorCode =
  | 'invalid_input' | 'too_many' | 'invalid_id' | 'duplicate'
  | 'self' | 'missing' | 'cross_workspace' | 'cycle'

export class DependencyError extends Error {
  constructor(readonly code: DependencyErrorCode, message: string) {
    super(message)
    this.name = 'DependencyError'
  }
}

const VALID_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/

export interface DependencyState {
  total: number
  completed: number
  pendingIds: string[]
  missingIds: string[]
  /** Only prerequisite readiness: independent from manual blocked, status and ownership. */
  ready: boolean
}

/** A prerequisite is satisfied only when the task is present, untrashed and accepted by a human. */
export function dependencyState(
  task: Pick<DependencyTask, 'dependsOn'>,
  tasks: readonly DependencyTask[],
): DependencyState {
  const byId = new Map(tasks.map(t => [t.id, t]))
  const ids = task.dependsOn ?? []
  const pendingIds: string[] = []
  const missingIds: string[] = []
  let completed = 0
  for (const id of ids) {
    const prerequisite = byId.get(id)
    if (prerequisite === undefined || prerequisite.trashedAt !== undefined) {
      missingIds.push(id)
      pendingIds.push(id)
    } else if (prerequisite.status === 'done') {
      completed++
    } else {
      pendingIds.push(id)
    }
  }
  return { total: ids.length, completed, pendingIds, missingIds, ready: pendingIds.length === 0 }
}

/**
 * Validate a full replacement against the fresh ledger INSIDE store.mutate.
 * Dependencies are restricted to the same workspace in the first version.
 */
export function validateDependencies(
  task: Pick<DependencyTask, 'id' | 'workspaceId'>,
  proposed: unknown,
  tasks: readonly DependencyTask[],
): string[] {
  if (!Array.isArray(proposed) || proposed.some(id => typeof id !== 'string')) {
    throw new DependencyError('invalid_input', 'dependsOn must be an array of task ids')
  }
  const ids = proposed as string[]
  if (ids.length > MAX_TASK_DEPENDENCIES) {
    throw new DependencyError('too_many', 'at most ' + MAX_TASK_DEPENDENCIES + ' dependencies are supported')
  }
  const byId = new Map(tasks.map(t => [t.id, t]))
  const seen = new Set<string>()
  for (const id of ids) {
    if (!VALID_ID.test(id)) throw new DependencyError('invalid_id', 'invalid task id: ' + id)
    if (id === task.id) throw new DependencyError('self', 'a task cannot depend on itself')
    if (seen.has(id)) throw new DependencyError('duplicate', 'duplicate dependency: ' + id)
    seen.add(id)
    const target = byId.get(id)
    if (target === undefined || target.trashedAt !== undefined) {
      throw new DependencyError('missing', 'dependency not found or trashed: ' + id)
    }
    if (target.workspaceId !== task.workspaceId) {
      throw new DependencyError('cross_workspace', 'dependency belongs to another workspace: ' + id)
    }
  }
  // A new link task -> id closes a cycle iff id already reaches task.
  for (const id of ids) {
    const visited = new Set<string>()
    const stack = [id]
    while (stack.length > 0) {
      const current = stack.pop()!
      if (current === task.id) throw new DependencyError('cycle', 'dependency cycle via ' + id)
      if (visited.has(current)) continue
      visited.add(current)
      const node = byId.get(current)
      if (node !== undefined) stack.push(...(node.dependsOn ?? []))
    }
  }
  return [...ids]
}

/** Reject workspace moves that would invalidate incoming and outgoing links. */
export function validateWorkspaceLinks(
  task: Pick<DependencyTask, 'id' | 'workspaceId' | 'dependsOn'>,
  tasks: readonly DependencyTask[],
): void {
  if (task.dependsOn?.length) validateDependencies(task, task.dependsOn, tasks)
  for (const other of tasks) {
    if (other.trashedAt === undefined && other.dependsOn?.includes(task.id)
        && other.workspaceId !== task.workspaceId) {
      throw new DependencyError('cross_workspace', 'task is required by another workspace: ' + other.id)
    }
  }
}

/** Transitive downstream dependents, without duplicates. */
export function downstreamDependents(id: string, tasks: readonly DependencyTask[]): string[] {
  const result: string[] = []
  const seen = new Set<string>([id])
  const queue = [id]
  while (queue.length) {
    const current = queue.shift()!
    for (const task of tasks) {
      if (task.trashedAt !== undefined || seen.has(task.id) || !(task.dependsOn ?? []).includes(current)) continue
      seen.add(task.id)
      result.push(task.id)
      queue.push(task.id)
    }
  }
  return result
}

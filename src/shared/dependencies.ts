/** Pure dependency graph: no host, I/O or React dependencies. */
export const MAX_TASK_DEPENDENCIES = 32

export interface DependencyTask {
  id: string
  workspaceId: string
  status: string
  trashedAt?: number
  dependsOn?: readonly string[]
  /**
   * Optional display title. The graph logic never reads it; it exists so the
   * per-prerequisite projection (F6) can explain a blocked task in one pass.
   */
  title?: string
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

/** Per-prerequisite classification rendered by `taskboard_get` / the detail panel (F6). */
export type PrerequisiteState = 'done' | 'pending' | 'missing'

/**
 * Why one prerequisite is or is not satisfied. `missing` covers both an
 * absent record and a soft-trashed one (D2: a dangling id keeps blocking);
 * `trashed` tells the renderer which of the two it is so it can explain it.
 */
export interface PrerequisiteDetail {
  id: string
  /** The surviving record's title; absent when the record was hard-deleted. */
  title?: string
  /** The surviving record's status; absent when the record was hard-deleted. */
  status?: string
  /** True only when the record still exists in the ledger but is soft-trashed. */
  trashed?: boolean
  state: PrerequisiteState
}

/**
 * Build the id→task lookup ONCE per ledger revision and reuse it for every
 * readiness check in that pass (F4): a scheduler tick must not rebuild a Map
 * per queued task (that was the O(n²) defect). Generic in the record type so
 * a host can keep its richer `TaskRecord` through every lookup and full
 * records can then be projected (summaries, prerequisite titles) from the
 * same index instead of mixing `DependencyTask` with `TaskRecord`.
 * @param tasks - the whole accessible ledger (trashed records included).
 * @returns an immutable-by-convention index.
 */
export function buildDependencyIndex<T extends DependencyTask>(tasks: readonly T[]): ReadonlyMap<string, T> {
  return new Map(tasks.map(t => [t.id, t]))
}

/** A prerequisite is satisfied only when present, untrashed and human-accepted. */
function isSatisfied(prerequisite: DependencyTask | undefined): boolean {
  return prerequisite !== undefined && prerequisite.trashedAt === undefined && prerequisite.status === 'done'
}

/** A prerequisite is *missing* when it is absent or soft-trashed. */
function isMissing(prerequisite: DependencyTask | undefined): boolean {
  return prerequisite === undefined || prerequisite.trashedAt !== undefined
}

/** A prerequisite is satisfied only when the task is present, untrashed and accepted by a human. */
export function dependencyState(
  task: Pick<DependencyTask, 'dependsOn'>,
  tasks: readonly DependencyTask[],
  index?: ReadonlyMap<string, DependencyTask>,
): DependencyState {
  const byId = index ?? buildDependencyIndex(tasks)
  const ids = task.dependsOn ?? []
  const pendingIds: string[] = []
  const missingIds: string[] = []
  let completed = 0
  for (const id of ids) {
    const prerequisite = byId.get(id)
    if (isSatisfied(prerequisite)) {
      completed++
      continue
    }
    pendingIds.push(id)
    if (isMissing(prerequisite)) missingIds.push(id)
  }
  return { total: ids.length, completed, pendingIds, missingIds, ready: pendingIds.length === 0 }
}

/**
 * O(1)-per-prerequisite readiness test against a prebuilt index. Unlike
 * {@link dependencyState} it allocates nothing, so a tick can ask "may this
 * queued task run?" for hundreds of entries without churn (F4). The gate
 * itself is still recommended inside the atomic execution mutation (D4);
 * this helper only makes the cheap pre-check cheap.
 * @param task - the candidate task.
 * @param index - result of {@link buildDependencyIndex} for the same ledger.
 */
export function isDependencyReady(
  task: Pick<DependencyTask, 'dependsOn'>,
  index: ReadonlyMap<string, DependencyTask>,
): boolean {
  for (const id of task.dependsOn ?? []) {
    if (!isSatisfied(index.get(id))) return false
  }
  return true
}

/**
 * Per-prerequisite detail for explaining WHY a task is blocked (F6). It is a
 * read-only projection of the same ledger the execution gate uses, so an
 * agent cannot see a different answer than the gate would give.
 * @param task - the dependent task.
 * @param tasks - the whole accessible ledger.
 * @param index - optional prebuilt {@link buildDependencyIndex} result.
 */
export function prerequisiteDetails(
  task: Pick<DependencyTask, 'dependsOn'>,
  tasks: readonly DependencyTask[],
  index?: ReadonlyMap<string, DependencyTask>,
): PrerequisiteDetail[] {
  const byId = index ?? buildDependencyIndex(tasks)
  const details: PrerequisiteDetail[] = []
  for (const id of task.dependsOn ?? []) {
    const prerequisite = byId.get(id)
    if (prerequisite === undefined) {
      details.push({ id, state: 'missing' })
      continue
    }
    const identity = { id, ...(prerequisite.title !== undefined ? { title: prerequisite.title } : {}) }
    if (prerequisite.trashedAt !== undefined) {
      details.push({ ...identity, status: prerequisite.status, trashed: true, state: 'missing' })
    } else {
      details.push({
        ...identity,
        status: prerequisite.status,
        state: prerequisite.status === 'done' ? 'done' : 'pending',
      })
    }
  }
  return details
}

/**
 * Validate a full replacement against the fresh ledger INSIDE store.mutate.
 * Dependencies are restricted to the same workspace in the first version.
 * Cycle detection is one bounded multi-source traversal with a shared visited
 * set, so a hand-edited cyclic ledger can never spin here (F8) and the cost
 * stays O(reachable tasks + edges) instead of one full walk per candidate.
 * @param task - the task whose links are being replaced.
 * @param proposed - raw `dependsOn` input.
 * @param tasks - the fresh ledger.
 * @param index - optional prebuilt {@link buildDependencyIndex} result.
 * @returns the accepted ids, in input order.
 */
export function validateDependencies(
  task: Pick<DependencyTask, 'id' | 'workspaceId'>,
  proposed: unknown,
  tasks: readonly DependencyTask[],
  index?: ReadonlyMap<string, DependencyTask>,
): string[] {
  if (!Array.isArray(proposed) || proposed.some(id => typeof id !== 'string')) {
    throw new DependencyError('invalid_input', 'dependsOn must be an array of task ids')
  }
  const ids = proposed as string[]
  if (ids.length > MAX_TASK_DEPENDENCIES) {
    throw new DependencyError('too_many', 'at most ' + MAX_TASK_DEPENDENCIES + ' dependencies are supported')
  }
  const byId = index ?? buildDependencyIndex(tasks)
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
  // The new links close a cycle iff an accepted prerequisite can already reach
  // `task` through its own dependsOn chain. Seed the traversal with every
  // candidate and carry the originating candidate along, so one pass covers
  // all of them and the error still names a responsible id.
  const origin = new Map<string, string>()
  const queue: string[] = []
  for (const id of ids) {
    origin.set(id, id)
    queue.push(id)
  }
  for (let head = 0; head < queue.length; head++) {
    const current = queue[head]!
    if (current === task.id) {
      throw new DependencyError('cycle', 'dependency cycle via ' + (origin.get(current) ?? current))
    }
    const node = byId.get(current)
    if (node === undefined) continue
    for (const next of node.dependsOn ?? []) {
      if (origin.has(next)) continue
      origin.set(next, origin.get(current) ?? current)
      queue.push(next)
    }
  }
  return [...ids]
}

/** Reject workspace moves that would invalidate incoming and outgoing links. */
export function validateWorkspaceLinks(
  task: Pick<DependencyTask, 'id' | 'workspaceId' | 'dependsOn'>,
  tasks: readonly DependencyTask[],
  index?: ReadonlyMap<string, DependencyTask>,
): void {
  if (task.dependsOn?.length) validateDependencies(task, task.dependsOn, tasks, index)
  for (const other of tasks) {
    if (other.trashedAt === undefined && other.dependsOn?.includes(task.id)
        && other.workspaceId !== task.workspaceId) {
      throw new DependencyError('cross_workspace', 'task is required by another workspace: ' + other.id)
    }
  }
}

/**
 * Transitive downstream dependents, without duplicates.
 * Uses one reverse adjacency pass so a 1000-task diamond is answered in
 * O(tasks + edges) rather than the previous per-level full-ledger scan.
 * Trashed tasks are excluded and never traversed through, matching the
 * "trashed work is off the active board" rule.
 * @param id - the prerequisite whose dependents are wanted.
 * @param tasks - the whole accessible ledger.
 */
export function downstreamDependents(id: string, tasks: readonly DependencyTask[]): string[] {
  const dependentsById = new Map<string, DependencyTask[]>()
  for (const task of tasks) {
    if (task.trashedAt !== undefined) continue
    for (const prerequisiteId of task.dependsOn ?? []) {
      const bucket = dependentsById.get(prerequisiteId)
      if (bucket === undefined) dependentsById.set(prerequisiteId, [task])
      else bucket.push(task)
    }
  }
  const result: string[] = []
  const seen = new Set<string>([id])
  const queue = [id]
  for (let head = 0; head < queue.length; head++) {
    for (const dependent of dependentsById.get(queue[head]!) ?? []) {
      if (seen.has(dependent.id)) continue
      seen.add(dependent.id)
      result.push(dependent.id)
      queue.push(dependent.id)
    }
  }
  return result
}

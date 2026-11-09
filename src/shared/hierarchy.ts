/**
 * Pure task hierarchy model (parent ↔ direct subtasks): no host, I/O or React
 * dependencies.
 *
 * Hierarchy is deliberately a SEPARATE concept from dependencies (D6):
 * - it never gates execution (a parent is not a prerequisite);
 * - a parent is never auto-completed (the human stays the only actor reaching
 *   `done`);
 * - its write rules are its own: same workspace, no self-parent, no ancestor
 *   cycle, root-to-leaf depth ≤ {@link MAX_TASK_DEPTH}.
 *
 * Statuses are plain strings here on purpose: this module must not depend on
 * the protocol status vocabulary, and hierarchy never interprets a status
 * except counting `done` in a progress projection.
 */
import { isValidTaskId } from './protocol.ts'

/**
 * Maximum number of records on one root-to-leaf path (a root has depth 1).
 * Eight keeps the detail breadcrumb and the board usable and bounds every
 * traversal below; it is a product decision, not a technical limit.
 */
export const MAX_TASK_DEPTH = 8

export interface HierarchyTask {
  id: string
  workspaceId: string
  status: string
  trashedAt?: number
  parentId?: string
  /**
   * Manual horizontal blocked marker (same meaning as `TaskRecord.blocked`).
   * Optional so minimal callers stay valid; hierarchy never reads it as a
   * gate — {@link subtaskProgress} only counts it for the parent badge.
   */
  blocked?: boolean
}

/** Derived progress of ONE parent over its DIRECT children (never stored, D9). */
export interface SubtaskProgress {
  /** Untrashed direct children. */
  total: number
  /** Direct children the human accepted (`done`). */
  done: number
  /** Untrashed direct children that are not done yet (`total - done`). */
  open: number
  /** Open direct children carrying the manual blocked marker. */
  blocked: number
  /** Soft-trashed direct children that are still linked to this parent. */
  missing: number
}

export type HierarchyErrorCode =
  | 'invalid_input' | 'self' | 'missing' | 'cross_workspace'
  | 'cycle' | 'depth' | 'has_children'

export class HierarchyError extends Error {
  constructor(readonly code: HierarchyErrorCode, message: string) {
    super(message)
    this.name = 'HierarchyError'
  }
}

/** id → record lookup. Callers validate a handful of writes, not a tick. */
function indexTasks(tasks: readonly HierarchyTask[]): Map<string, HierarchyTask> {
  const byId = new Map<string, HierarchyTask>()
  for (const task of tasks) byId.set(task.id, task)
  return byId
}

/** parentId → direct children, in ledger order. */
function childrenByParent(tasks: readonly HierarchyTask[]): Map<string, HierarchyTask[]> {
  const byParent = new Map<string, HierarchyTask[]>()
  for (const task of tasks) {
    if (task.parentId === undefined) continue
    const bucket = byParent.get(task.parentId)
    if (bucket === undefined) byParent.set(task.parentId, [task])
    else bucket.push(task)
  }
  return byParent
}

interface AncestorChain {
  /** From the immediate parent upwards; dangling ids are included then stop. */
  ids: string[]
  cyclic: boolean
}

/**
 * Walk the parent chain starting at `parentId`. A hand-edited cyclic ledger
 * is reported as `cyclic` instead of looping (or throwing RangeError).
 */
function ancestorChainOf(parentId: string, byId: ReadonlyMap<string, HierarchyTask>): AncestorChain {
  const ids: string[] = []
  const seen = new Set<string>()
  let current: string | undefined = parentId
  while (current !== undefined) {
    if (seen.has(current)) return { ids, cyclic: true }
    seen.add(current)
    ids.push(current)
    current = byId.get(current)?.parentId
  }
  return { ids, cyclic: false }
}

/** A resolved, validated parent link plus the depth the task would sit at. */
interface ResolvedParent {
  id: string
  taskDepth: number
}

/**
 * Core parent-link validation, shared by both public entry points.
 * Returns undefined for "no parent" (undefined/null proposal) and throws a
 * {@link HierarchyError} for every refused link.
 */
function resolveParent(
  task: Pick<HierarchyTask, 'id' | 'workspaceId'>,
  proposedParentId: unknown,
  byId: ReadonlyMap<string, HierarchyTask>,
): ResolvedParent | undefined {
  if (proposedParentId === undefined || proposedParentId === null) return undefined
  if (typeof proposedParentId !== 'string') {
    throw new HierarchyError('invalid_input', 'parentId must be a task id or null')
  }
  const parentId = proposedParentId
  if (!isValidTaskId(parentId)) {
    throw new HierarchyError('invalid_input', 'invalid parent task id: ' + parentId)
  }
  if (parentId === task.id) {
    throw new HierarchyError('self', 'a task cannot be its own parent')
  }
  const parent = byId.get(parentId)
  if (parent === undefined || parent.trashedAt !== undefined) {
    throw new HierarchyError('missing', 'parent task not found or trashed: ' + parentId)
  }
  if (parent.workspaceId !== task.workspaceId) {
    throw new HierarchyError('cross_workspace', 'parent task belongs to another workspace: ' + parentId)
  }
  const chain = ancestorChainOf(parentId, byId)
  if (chain.cyclic) {
    throw new HierarchyError('cycle', 'hierarchy already contains a cycle above parent: ' + parentId)
  }
  if (chain.ids.includes(task.id)) {
    throw new HierarchyError('cycle', 'parent chain returns to this task: ' + parentId)
  }
  // `chain.ids` includes the proposed parent itself, so a root parent yields
  // length 1 and the task sits at depth 2. Dangling ancestors count towards
  // the limit on purpose: a broken chain must not be used to sneak past it.
  const taskDepth = chain.ids.length + 1
  if (taskDepth > MAX_TASK_DEPTH) {
    throw new HierarchyError('depth', 'hierarchy depth would exceed ' + MAX_TASK_DEPTH + ' (task depth ' + taskDepth + ')')
  }
  return { id: parentId, taskDepth }
}

/**
 * Refuse a re-link that would push an existing DESCENDANT past the depth cap.
 * BFS is bounded by the remaining depth budget, so a wide or deep hand-edited
 * subtree cannot cost more than a few levels of traversal.
 */
function assertSubtreeFits(
  taskId: string,
  taskDepth: number,
  children: ReadonlyMap<string, HierarchyTask[]>,
): void {
  const visited = new Set<string>([taskId])
  let frontier = [taskId]
  let level = 0
  while (frontier.length > 0) {
    level++
    const next: string[] = []
    for (const parentId of frontier) {
      for (const child of children.get(parentId) ?? []) {
        if (visited.has(child.id)) {
          throw new HierarchyError('cycle', 'hierarchy contains a cycle below task: ' + taskId)
        }
        visited.add(child.id)
        next.push(child.id)
      }
    }
    if (next.length > 0 && taskDepth + level > MAX_TASK_DEPTH) {
      throw new HierarchyError('depth', 'moving this task would push a descendant past depth ' + MAX_TASK_DEPTH)
    }
    frontier = next
  }
}

/**
 * Validate a proposed parent link for a task that is being created or
 * re-parented (D6). Same-workspace, untrashed, existing parent; no self link;
 * no ancestor cycle; depth ≤ {@link MAX_TASK_DEPTH} including the task's
 * existing subtree.
 * @param task - the task being linked (id + the workspace it will live in).
 * @param proposedParentId - raw input: undefined/null detaches, anything else
 *   must be the id of an existing untrashed same-workspace task.
 * @returns the accepted parent id, or undefined when the proposal detaches.
 * @throws {HierarchyError} with a stable code on refusal.
 */
export function validateParent(
  task: Pick<HierarchyTask, 'id' | 'workspaceId'>,
  proposedParentId: unknown,
  tasks: readonly HierarchyTask[],
): string | undefined {
  const resolved = resolveParent(task, proposedParentId, indexTasks(tasks))
  if (resolved === undefined) return undefined
  assertSubtreeFits(task.id, resolved.taskDepth, childrenByParent(tasks))
  return resolved.id
}

/**
 * Validate the stored links of an existing record against the current ledger
 * (import, load repair, workspace rebind). Unlike {@link validateParent} it
 * reads `task.parentId` from the record itself and additionally checks the
 * DOWNWARD links: every child must share the task's workspace (D7: no silent
 * cross-workspace re-parenting) and the subtree must fit the depth cap.
 *
 * A soft-trashed record is inert — only the stored shape is checked, because
 * its children were already moved/deleted before trashing (D7) and an
 * exported ledger must stay importable.
 * @param task - the record to revalidate.
 * @param tasks - the ledger the record lives in.
 * @throws {HierarchyError} with a stable code on refusal.
 */
export function validateHierarchyLinks(task: HierarchyTask, tasks: readonly HierarchyTask[]): void {
  if (task.parentId !== undefined && !isValidTaskId(task.parentId)) {
    throw new HierarchyError('invalid_input', 'invalid parent task id: ' + task.parentId)
  }
  if (task.parentId !== undefined && task.parentId === task.id) {
    throw new HierarchyError('self', 'a task cannot be its own parent')
  }
  if (task.trashedAt !== undefined) return
  const children = childrenByParent(tasks)
  const resolved = resolveParent(
    { id: task.id, workspaceId: task.workspaceId },
    task.parentId,
    indexTasks(tasks),
  )
  assertSubtreeFits(task.id, resolved?.taskDepth ?? 1, children)
  for (const other of tasks) {
    if (other.id === task.id || other.parentId !== task.id) continue
    if (other.workspaceId !== task.workspaceId) {
      throw new HierarchyError('cross_workspace', 'child task belongs to another workspace: ' + other.id)
    }
  }
}

/**
 * Derived progress for ONE parent over its DIRECT children (D6/D9): never
 * stored, never a gate. `missing` counts soft-trashed children that still
 * carry the link, so the panel can offer to detach them.
 * @param parentId - the parent whose children are counted.
 * @param tasks - the ledger holding the children.
 * @param index - optional prebuilt id→task map (same shape as the ledger's).
 */
export function subtaskProgress(
  parentId: string,
  tasks: readonly HierarchyTask[],
  index?: ReadonlyMap<string, HierarchyTask>,
): SubtaskProgress {
  const source: Iterable<HierarchyTask> = index !== undefined ? index.values() : tasks
  let total = 0
  let done = 0
  let blocked = 0
  let missing = 0
  for (const child of source) {
    if (child.parentId !== parentId || child.id === parentId) continue
    if (child.trashedAt !== undefined) {
      missing++
      continue
    }
    total++
    if (child.status === 'done') done++
    else if (child.blocked === true) blocked++
  }
  return { total, done, open: total - done, blocked, missing }
}

/**
 * Ancestor ids of a task, nearest parent first (breadcrumb order), limited to
 * records still on the active board: the walk stops at the first missing or
 * soft-trashed ancestor and never repeats a node (hand-edited cycles are
 * bounded instead of looping).
 */
export function ancestorsOf(id: string, tasks: readonly HierarchyTask[]): string[] {
  const byId = indexTasks(tasks)
  const result: string[] = []
  const seen = new Set<string>([id])
  let current = byId.get(id)?.parentId
  while (current !== undefined) {
    const node = byId.get(current)
    if (node === undefined || node.trashedAt !== undefined) break
    if (seen.has(current)) break
    result.push(current)
    seen.add(current)
    current = node.parentId
  }
  return result
}

/**
 * Active descendants of a task, breadth-first (direct children first). Trashed
 * records are neither returned nor traversed through, matching the "off the
 * active board" rule; the walk is bounded by a visited set on cyclic ledgers.
 */
export function descendantsOf(id: string, tasks: readonly HierarchyTask[]): string[] {
  const children = childrenByParent(tasks)
  const result: string[] = []
  const seen = new Set<string>([id])
  const queue = [id]
  for (let head = 0; head < queue.length; head++) {
    for (const child of children.get(queue[head]!) ?? []) {
      if (seen.has(child.id) || child.trashedAt !== undefined) continue
      seen.add(child.id)
      result.push(child.id)
      queue.push(child.id)
    }
  }
  return result
}

/**
 * Deletion guard (D7): soft-delete and purge are refused while any NON-trashed
 * direct child exists. Trashed children are inert and are detached by
 * {@link detachIsDeleted} when the record is finally purged.
 * @throws {HierarchyError} code `has_children`.
 */
export function assertNoChildren(id: string, tasks: readonly HierarchyTask[]): void {
  for (const task of tasks) {
    if (task.id !== id && task.parentId === id && task.trashedAt === undefined) {
      throw new HierarchyError('has_children', 'task still has non-trashed subtasks: ' + task.id)
    }
  }
}

/**
 * Host-only repair helper for a purge that would otherwise leave dangling
 * `parentId` links: clear the link on every direct child of the deleted id
 * (in place) and return the affected child ids so the host can bump their
 * versions and append a system comment in the SAME mutation.
 * @param id - the id being removed from the ledger.
 * @param tasks - the mutable ledger task array.
 * @returns the ids whose parentId was cleared, in ledger order.
 */
export function detachIsDeleted(id: string, tasks: HierarchyTask[]): string[] {
  const detached: string[] = []
  for (const task of tasks) {
    if (task.id === id || task.parentId !== id) continue
    delete task.parentId
    detached.push(task.id)
  }
  return detached
}

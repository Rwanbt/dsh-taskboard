import { createHash, timingSafeEqual } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import {
  canTransition,
  newCommentId,
  newExecutionId,
  normalizeBody,
  normalizeExecutionReport,
  syncClaim,
  type ExecutionAttempt,
  type ExecutionRecord,
  type TaskLedger,
  type TaskRecord,
} from '../shared/protocol.ts'
import { buildDependencyIndex, dependencyState, prerequisiteDetails } from '../shared/dependencies.ts'
import type { ExternalReference } from '../shared/external.ts'
import {
  PUBLIC_API_PREFIX,
  PUBLIC_API_VERSION,
  PUBLIC_EVENT_TYPES,
  type PublicApiResult,
  type PublicClaimRequest,
  type PublicCompleteRequest,
  type PublicErrorCode,
  type PublicEvent,
  type PublicEventType,
  type PublicExecutionView,
  type PublicLifecycleRequest,
  type PublicProject,
  type PublicTaskSummary,
  type PublicTaskView,
} from '../shared/public-api.ts'
import type { TaskStore, LedgerChange } from './store.ts'

/** Workspace/project face required by the public contract. */
export type PublicWorkspaceFace = {
  list(): Array<{ id: string; title: string; path: string }>
  get(id: string): { id: string; title: string; path: string } | undefined
}

/** Options of the public API service. */
export type PublicApiOptions = {
  store: TaskStore
  workspaces: PublicWorkspaceFace
  now: () => number
  /** Token reader; returning undefined/'' disables the surface (503). */
  token: () => string | undefined
}

/** Bounded event ring size. */
const MAX_EVENTS = 2_000
/** Maximum executions returned in one task view. */
const MAX_EXECUTIONS_VIEW = 10

class PublicApiError extends Error {
  constructor(readonly code: PublicErrorCode, message: string, readonly status: number) {
    super(message)
  }
}

function fail(code: PublicErrorCode, message: string, status: number): never {
  throw new PublicApiError(code, message, status)
}

function json(res: ServerResponse, payload: unknown, status = 200): void {
  const body = JSON.stringify(payload)
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(body)
}

function ok<T>(res: ServerResponse, value: T, status = 200): void {
  const payload: PublicApiResult<T> = { ok: true, value }
  json(res, payload, status)
}

function error(res: ServerResponse, code: PublicErrorCode, message: string, status: number): void {
  const payload: PublicApiResult<never> = { ok: false, error: { code, message } }
  json(res, payload, status)
}

/** Length-independent constant-time token comparison. */
function secureEqual(candidate: string, expected: string): boolean {
  const a = createHash('sha256').update(candidate).digest()
  const b = createHash('sha256').update(expected).digest()
  return timingSafeEqual(a, b)
}

function str(value: unknown, max = 200): string | undefined {
  return typeof value === 'string' && value.length > 0 && value.length <= max ? value : undefined
}

function numeric(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function summaryOf(task: TaskRecord): PublicTaskSummary {
  const checklist = task.checklist ?? []
  const latest = task.executions[task.executions.length - 1]
  return {
    id: task.id,
    title: task.title,
    status: task.status,
    urgency: task.urgency,
    workspaceId: task.workspaceId,
    version: task.version,
    blocked: task.blocked,
    ...(task.claimedBy !== undefined ? { claimedBy: task.claimedBy } : {}),
    executionMode: task.execution.mode,
    ...(task.dependsOn !== undefined ? { dependsOn: [...task.dependsOn] } : {}),
    ...(task.parentId !== undefined ? { parentId: task.parentId } : {}),
    checklist: { total: checklist.length, checked: checklist.filter(item => item.checked).length },
    ...(latest === undefined ? {} : { latestExecution: { id: latest.id, outcome: latest.outcome, ...(latest.sessionId !== undefined ? { sessionId: latest.sessionId } : {}) } }),
    ...(task.externalRefs !== undefined ? { externalRefs: structuredClone(task.externalRefs) as ExternalReference[] } : {}),
  }
}

function attemptList(execution: ExecutionRecord): ExecutionAttempt[] {
  if (execution.attempts !== undefined && execution.attempts.length > 0) return execution.attempts.map(entry => ({ ...entry }))
  return [{ n: 1, ...(execution.sessionId === undefined ? {} : { sessionId: execution.sessionId }),
    startedAt: execution.startedAt ?? 0, ...(execution.endedAt === undefined ? {} : { endedAt: execution.endedAt }),
    outcome: execution.outcome }]
}

function executionView(task: TaskRecord, execution: ExecutionRecord): PublicExecutionView {
  const attempts = attemptList(execution)
  const sessions = [...new Set(attempts.flatMap(attempt => attempt.sessionId === undefined ? [] : [attempt.sessionId]))]
  return {
    executionId: execution.id,
    taskId: task.id,
    workspaceId: task.workspaceId,
    attempt: Math.max(...attempts.map(attempt => attempt.n), 1),
    outcome: execution.outcome,
    trigger: execution.trigger,
    managedBy: execution.managedBy ?? 'board',
    fencingToken: execution.fencingToken ?? 1,
    ...(execution.sessionId === undefined ? {} : { sessionId: execution.sessionId }),
    sessions,
    attempts,
    ...(execution.startedAt === undefined ? {} : { startedAt: execution.startedAt }),
    ...(execution.endedAt === undefined ? {} : { endedAt: execution.endedAt }),
    ...(execution.isolation === undefined ? {} : { isolation: execution.isolation }),
    ...(execution.branch === undefined ? {} : { branch: execution.branch }),
    ...(execution.worktreePath === undefined ? {} : { worktreePath: execution.worktreePath }),
    ...(execution.error === undefined ? {} : { error: execution.error }),
    ...(execution.report === undefined ? {} : { report: structuredClone(execution.report) }),
    taskVersion: task.version,
  }
}

/**
 * Task Board public execution API (contract v1).
 *
 * Read-only discovery + the execution-envelope lifecycle. It never touches
 * ledger files outside `TaskStore.mutate`, never marks a task `done`, and
 * refuses to manage host-driven (`managedBy: 'board'`) executions.
 */
export class PublicApiService {
  private readonly events: PublicEvent[] = []
  private unsubscribe?: () => void
  private readonly streams = new Set<ServerResponse>()
  private heartbeat?: ReturnType<typeof setInterval>
  private disposed = false
  private readonly storeReady: Promise<void>
  constructor(private readonly options: PublicApiOptions) {
    this.unsubscribe = options.store.subscribe(change => this.record(change))
    // A cold process must read the persisted ledger before answering a public
    // GET: serving an empty board (or masking a corrupt ledger) is unsafe.
    const load = (options.store as { load?: () => Promise<void> }).load
    this.storeReady = typeof load === 'function' ? load.call(options.store) : Promise.resolve()
    void this.storeReady.catch(error => console.warn('[dsh-taskboard] public API store load failed:', error))
  }
  dispose(): void {
    this.disposed = true
    this.unsubscribe?.(); this.unsubscribe = undefined
    if (this.heartbeat !== undefined) { clearInterval(this.heartbeat); this.heartbeat = undefined }
    for (const res of this.streams) { try { res.end() } catch { /* closed */ } }
    this.streams.clear()
  }
  private now(): number { return this.options.now() }
  private authorised(req: IncomingMessage): void {
    const token = this.options.token()?.trim()
    if (token === undefined || token.length === 0) fail('public_api_disabled', 'public API is disabled: configure DSH_TASKBOARD_PUBLIC_TOKEN', 503)
    const header = req.headers.authorization
    if (typeof header !== 'string' || !header.startsWith('Bearer ')) fail('unauthorized', 'Bearer token required', 401)
    if (!secureEqual(header.slice(7).trim(), token)) fail('unauthorized', 'invalid bearer token', 401)
  }
  /**
   * Authenticate BEFORE the transport buffers a request body. Renders the
   * 503/401 response itself and returns false when the caller must stop.
   */
  preflight(req: IncomingMessage, res: ServerResponse): boolean {
    try { this.authorised(req); return true } catch (errorValue) {
      if (errorValue instanceof PublicApiError) error(res, errorValue.code, errorValue.message, errorValue.status)
      else error(res, 'internal', 'internal error', 500)
      return false
    }
  }
  /**
   * Handle one request under {@link PUBLIC_API_PREFIX}.
   * @returns true when the request belonged to the public API.
   */
  async handle(req: IncomingMessage, res: ServerResponse, url: URL, body: Record<string, unknown> | null): Promise<boolean> {
    const pathname = url.pathname
    if (!pathname.startsWith(PUBLIC_API_PREFIX)) return false
    if (this.disposed) { error(res, 'internal', 'service stopped', 503); return true }
    try {
      this.authorised(req)
      await this.storeReady
      const path = pathname.slice(PUBLIC_API_PREFIX.length) || '/'
      await this.route(req, res, path, url, body)
    } catch (errorValue) {
      if (errorValue instanceof PublicApiError) error(res, errorValue.code, errorValue.message, errorValue.status)
      else error(res, 'internal', 'internal error', 500)
    }
    return true
  }
  private async route(req: IncomingMessage, res: ServerResponse, path: string, url: URL, body: Record<string, unknown> | null): Promise<void> {
    const method = req.method ?? 'GET'
    if (method === 'GET' && path === '/meta') {
      ok(res, {
        apiVersion: PUBLIC_API_VERSION, name: 'dsh-taskboard', eventTypes: [...PUBLIC_EVENT_TYPES], auth: 'bearer',
        writePolicy: 'explicit', donePolicy: 'user-only',
        features: { claim: true, attempts: true, handoff: true, reports: true, events: 'replay+resync', worktree: true, externalSync: true },
        taskStatuses: ['backlog', 'todo', 'in_progress', 'in_review', 'done', 'canceled', 'archived'],
      })
      return
    }
    if (method === 'GET' && path === '/projects') { ok(res, this.projects()); return }
    if (method === 'GET' && path === '/tasks') { ok(res, this.listTasks(url)); return }
    if (method === 'GET' && path === '/events') { ok(res, this.readEvents(url)); return }
    if (method === 'GET' && path === '/events/stream') { this.streamEvents(req, res, url); return }
    let match = /^\/tasks\/([^/]+)$/.exec(path)
    if (method === 'GET' && match?.[1] !== undefined) { ok(res, this.taskView(this.decode(match[1]))); return }
    match = /^\/tasks\/([^/]+)\/dependencies$/.exec(path)
    if (method === 'GET' && match?.[1] !== undefined) { ok(res, this.dependenciesOf(this.decode(match[1]))); return }
    match = /^\/executions\/([^/]+)$/.exec(path)
    if (method === 'GET' && match?.[1] !== undefined) { ok(res, this.executionOf(this.decode(match[1]))); return }
    if (method === 'POST' && path === '/executions/claim') { ok(res, await this.claim(body), 201); return }
    match = /^\/executions\/([^/]+)\/(session|attempts|handoff|complete|interrupt|report)$/.exec(path)
    if (method === 'POST' && match?.[1] !== undefined && match[2] !== undefined) {
      const executionId = this.decode(match[1])
      const action = match[2]
      if (action === 'session') ok(res, await this.bindSession(executionId, body))
      else if (action === 'attempts') ok(res, await this.newAttempt(executionId, body))
      else if (action === 'handoff') ok(res, await this.handoff(executionId, body))
      else if (action === 'complete') ok(res, await this.complete(executionId, body))
      else if (action === 'interrupt') ok(res, await this.interrupt(executionId, body))
      else ok(res, await this.report(executionId, body))
      return
    }
    fail('not_found', 'unknown public API route', 404)
  }
  /** Percent-decoding is client input: malformed escapes are a 400, never a 500. */
  private decode(value: string): string {
    try { return decodeURIComponent(value) } catch { fail('invalid_input', 'malformed path encoding', 400) }
  }
  private projects(): PublicProject[] {
    return this.options.workspaces.list().map(workspace => ({ id: workspace.id, title: workspace.title, path: workspace.path }))
  }
  private liveTasks(): TaskRecord[] {
    return this.options.store.snapshot().tasks.filter(task => task.trashedAt === undefined)
  }
  private listTasks(url: URL): { tasks: PublicTaskSummary[]; next?: string } {
    const tasks = this.liveTasks()
    const statuses = (url.searchParams.get('status') ?? '').split(',').map(value => value.trim()).filter(Boolean)
    const workspaceId = url.searchParams.get('workspaceId') ?? undefined
    const eligible = url.searchParams.get('eligible') === 'true'
    const limitRaw = Number.parseInt(url.searchParams.get('limit') ?? '50', 10)
    const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 100) : 50
    const offset = Math.max(Number.parseInt(url.searchParams.get('cursor') ?? '0', 10) || 0, 0)
    // One index per request: `dependencyState` without it rebuilds the whole
    // index for every card (the documented O(n²) trap).
    const index = eligible ? buildDependencyIndex(tasks) : undefined
    const filtered = tasks.filter(task =>
      (statuses.length === 0 || statuses.includes(task.status))
      && (workspaceId === undefined || task.workspaceId === workspaceId)
      && (!eligible || (task.status === 'todo' && !task.blocked && dependencyState(task, tasks, index).ready)))
      .sort((left, right) => right.updatedAt - left.updatedAt)
    return { tasks: filtered.slice(offset, offset + limit).map(summaryOf), ...(offset + limit < filtered.length ? { next: String(offset + limit) } : {}) }
  }
  private findTask(id: string): TaskRecord {
    const task = this.liveTasks().find(candidate => candidate.id === id)
    if (task === undefined) fail('not_found', 'no such task', 404)
    return task
  }
  private taskView(id: string): PublicTaskView {
    const task = this.findTask(id)
    const tasks = this.liveTasks()
    const dependency = dependencyState(task, tasks)
    const details = prerequisiteDetails(task, tasks).map(detail => ({
      id: detail.id, ...(detail.title === undefined ? {} : { title: detail.title }),
      ...(detail.status === undefined ? {} : { status: detail.status }), state: detail.state,
      ...(detail.trashed === true ? { trashed: true } : {}),
    }))
    const running = task.executions.find(execution => execution.outcome === 'running')
    const allowedActions: string[] = []
    if (task.status === 'todo' && dependency.ready) allowedActions.push('claim')
    if (task.status === 'in_progress' && task.claimedBy !== undefined && running !== undefined) allowedActions.push('complete', 'interrupt', 'attempts', 'handoff')
    if (task.status === 'in_review') allowedActions.push('await_user_validation')
    return {
      ...summaryOf(task),
      description: task.description,
      prompt: task.prompt,
      ...(task.permission === undefined ? {} : { permission: task.permission }),
      ...(task.isolation === undefined ? {} : { isolation: task.isolation }),
      ...(task.waitingForHuman === undefined ? {} : { waitingForHuman: task.waitingForHuman }),
      ...(task.waitingReason === undefined ? {} : { waitingReason: task.waitingReason }),
      createdAt: task.createdAt,
      updatedAt: task.updatedAt,
      executions: task.executions.slice(-MAX_EXECUTIONS_VIEW).map(execution => executionView(task, execution)),
      dependencies: { ...dependency, details },
      allowedActions,
    }
  }
  private dependenciesOf(id: string) {
    const task = this.findTask(id)
    const tasks = this.liveTasks()
    return { taskId: task.id, ...dependencyState(task, tasks), details: prerequisiteDetails(task, tasks) }
  }
  private findExecution(executionId: string): { task: TaskRecord; execution: ExecutionRecord } {
    const task = this.liveTasks().find(candidate => candidate.executions.some(execution => execution.id === executionId))
    const execution = task?.executions.find(candidate => candidate.id === executionId)
    if (task === undefined || execution === undefined) fail('not_found', 'no such execution', 404)
    return { task, execution }
  }
  private executionOf(executionId: string) {
    const { task, execution } = this.findExecution(executionId)
    return executionView(task, execution)
  }
  private requireActor(body: Record<string, unknown> | null): string {
    const actor = str(body?.actor, 200)
    if (actor === undefined) fail('invalid_input', 'actor is required (1..200 chars)', 400)
    return actor
  }
  private guardClaim(task: TaskRecord, actor: string): void {
    if (task.claimedBy !== undefined && task.claimedBy !== actor) fail('already_claimed', `task is held by ${task.claimedBy}`, 409)
  }
  private async claim(body: Record<string, unknown> | null): Promise<{ execution: PublicExecutionView; task: PublicTaskSummary }> {
    if (body === null) fail('invalid_input', 'JSON body required', 400)
    const taskId = str(body.taskId, 200)
    if (taskId === undefined) fail('invalid_input', 'taskId is required', 400)
    const actor = this.requireActor(body)
    const workspaceId = str(body.workspaceId, 200)
    const sessionId = str(body.sessionId, 300)
    const idempotencyKey = str(body.idempotencyKey, 200)
    let existingId: string | undefined
    let failure: PublicApiError | undefined
    const now = this.now()
    const mutate = this.options.store.mutate('execution-recorded', ledger => {
      const task = ledger.tasks.find(candidate => candidate.id === taskId)
      if (task === undefined || task.trashedAt !== undefined) { failure = new PublicApiError('not_found', 'no such task', 404); return undefined }
      if (workspaceId !== undefined && task.workspaceId !== workspaceId) { failure = new PublicApiError('forbidden', 'task belongs to another project', 403); return undefined }
      if (idempotencyKey !== undefined) {
        const replay = task.executions.find(execution => execution.idempotencyKey === idempotencyKey)
        if (replay !== undefined) {
          if (replay.externalActor !== undefined && replay.externalActor !== actor) {
            failure = new PublicApiError('already_claimed', 'idempotency key belongs to another actor', 409)
            return undefined
          }
          existingId = replay.id
          return undefined
        }
      }
      if (task.status === 'in_progress') {
        this.guardClaim(task, actor)
        failure = new PublicApiError('already_claimed', 'task already has a running execution', 409)
        return undefined
      }
      if (task.status !== 'todo') { failure = new PublicApiError('version_conflict', `task is ${task.status}, not todo`, 409); return undefined }
      if (task.blocked) { failure = new PublicApiError('version_conflict', 'task is blocked', 409); return undefined }
      const dependency = dependencyState(task, ledger.tasks)
      if (!dependency.ready) {
        failure = new PublicApiError('dependency_blocked', `unsatisfied dependencies: ${dependency.pendingIds.join(', ')}`, 409)
        return undefined
      }
      const execution: ExecutionRecord = {
        id: newExecutionId(), trigger: 'manual', startedAt: now, outcome: 'running', managedBy: 'external',
        fencingToken: 1, attempts: [{ n: 1, startedAt: now, outcome: 'running', ...(sessionId === undefined ? {} : { sessionId }) }],
        externalActor: actor,
        ...(sessionId === undefined ? {} : { sessionId }),
        ...(idempotencyKey === undefined ? {} : { idempotencyKey }),
      }
      task.executions.push(execution)
      task.status = 'in_progress'
      task.blocked = false
      syncClaim(task, 'in_progress', now, actor)
      task.version += 1; task.updatedAt = now; task.updatedBy = { kind: 'agent', sessionId: actor }
      existingId = execution.id
      return [task]
    })
    await mutate
    if (failure !== undefined) throw failure
    const current = this.findTask(taskId)
    const execution = current.executions.find(entry => entry.id === existingId)
    if (execution === undefined) fail('internal', 'claim could not be read back', 500)
    return { execution: executionView(current, execution), task: summaryOf(current) }
  }
  /** Verify the caller drives this external execution envelope. */
  private requireExternal(task: TaskRecord, execution: ExecutionRecord, actor: string): void {
    if (execution.managedBy !== 'external') fail('forbidden', 'this execution is managed by the host, not by an external engine', 403)
    if (task.claimedBy !== actor) fail('forbidden', 'only the claiming actor may change this execution', 403)
    if (execution.outcome !== 'running') fail('version_conflict', 'execution already settled', 409)
  }
  private checkFence(execution: ExecutionRecord, ifFencingToken: number | undefined): void {
    const current = execution.fencingToken ?? 1
    // Once a handoff/attempt changed the fence, the guard is MANDATORY: an old
    // engine that never observed token 2+ must not settle or edit the envelope.
    if (current > 1 && ifFencingToken === undefined) fail('stale_execution', 'fencing token required after a handoff or attempt change', 409)
    if (ifFencingToken !== undefined && ifFencingToken !== current) fail('stale_execution', 'stale fencing token', 409)
  }
  private currentAttempt(execution: ExecutionRecord): ExecutionAttempt {
    const attempts = execution.attempts ?? []
    const last = attempts[attempts.length - 1]
    if (last !== undefined) return last
    const fallback: ExecutionAttempt = { n: 1, startedAt: execution.startedAt ?? this.now(), outcome: execution.outcome,
      ...(execution.sessionId === undefined ? {} : { sessionId: execution.sessionId }) }
    execution.attempts = [fallback]
    return fallback
  }
  private readExecutionBody(body: Record<string, unknown> | null): Required<Pick<PublicLifecycleRequest, 'actor'>> & PublicLifecycleRequest {
    if (body === null) fail('invalid_input', 'JSON body required', 400)
    const actor = this.requireActor(body)
    return { actor, ...(str(body.sessionId, 300) === undefined ? {} : { sessionId: str(body.sessionId, 300)! }),
      ...(str(body.reason, 1_000) === undefined ? {} : { reason: str(body.reason, 1_000)! }),
      ...(numeric(body.ifFencingToken) === undefined ? {} : { ifFencingToken: numeric(body.ifFencingToken)! }) }
  }
  private async bindSession(executionId: string, body: Record<string, unknown> | null): Promise<PublicExecutionView> {
    const request = this.readExecutionBody(body)
    const sessionId = str(body?.sessionId, 300)
    if (sessionId === undefined) fail('invalid_input', 'sessionId is required', 400)
    const now = this.now()
    let failure: PublicApiError | undefined
    await this.options.store.mutate('execution-recorded', ledger => {
      const found = this.locate(ledger, executionId)
      if (found === undefined) { failure = new PublicApiError('not_found', 'no such execution', 404); return undefined }
      const { task, execution } = found
      try {
        this.requireExternal(task, execution, request.actor)
        this.checkFence(execution, request.ifFencingToken)
        if (execution.sessionId !== undefined && execution.sessionId !== sessionId) {
          fail('version_conflict', 'execution already has a different session; use attempts or handoff', 409)
        }
        execution.sessionId = sessionId
        this.currentAttempt(execution).sessionId = sessionId
        task.version += 1; task.updatedAt = now
        return [task]
      } catch (errorValue) { failure = errorValue as PublicApiError; return undefined }
    })
    if (failure !== undefined) throw failure
    return this.executionOf(executionId)
  }
  private async newAttempt(executionId: string, body: Record<string, unknown> | null): Promise<PublicExecutionView> {
    const request = this.readExecutionBody(body)
    if (request.reason === undefined) fail('invalid_input', 'reason is required for a new attempt', 400)
    const sessionId = str(body?.sessionId, 300)
    const now = this.now()
    let failure: PublicApiError | undefined
    await this.options.store.mutate('execution-recorded', ledger => {
      const found = this.locate(ledger, executionId)
      if (found === undefined) { failure = new PublicApiError('not_found', 'no such execution', 404); return undefined }
      const { task, execution } = found
      try {
        this.requireExternal(task, execution, request.actor)
        this.checkFence(execution, request.ifFencingToken)
        const previous = this.currentAttempt(execution)
        previous.endedAt = now
        previous.outcome = 'failed'
        previous.reason = request.reason!.slice(0, 500)
        const next: ExecutionAttempt = { n: previous.n + 1, startedAt: now, outcome: 'running',
          ...(sessionId === undefined ? {} : { sessionId }) }
        execution.attempts = [...(execution.attempts ?? []), next]
        if (sessionId !== undefined) execution.sessionId = sessionId
        else delete execution.sessionId
        execution.fencingToken = (execution.fencingToken ?? 1) + 1
        task.comments.push({ id: newCommentId(), body: normalizeBody(`[att] attempt ${next.n} started: ${request.reason}`),
          threadId: request.actor, version: 1, createdAt: now })
        task.version += 1; task.updatedAt = now
        return [task]
      } catch (errorValue) { failure = errorValue as PublicApiError; return undefined }
    })
    if (failure !== undefined) throw failure
    return this.executionOf(executionId)
  }
  private async handoff(executionId: string, body: Record<string, unknown> | null): Promise<PublicExecutionView> {
    const request = this.readExecutionBody(body)
    const fromSessionId = str(body?.fromSessionId, 300)
    const toSessionId = str(body?.toSessionId, 300)
    if (fromSessionId === undefined || toSessionId === undefined) fail('invalid_input', 'fromSessionId and toSessionId are required', 400)
    const now = this.now()
    let failure: PublicApiError | undefined
    await this.options.store.mutate('execution-recorded', ledger => {
      const found = this.locate(ledger, executionId)
      if (found === undefined) { failure = new PublicApiError('not_found', 'no such execution', 404); return undefined }
      const { task, execution } = found
      try {
        this.requireExternal(task, execution, request.actor)
        this.checkFence(execution, request.ifFencingToken)
        if (execution.sessionId !== fromSessionId) fail('stale_execution', 'fromSessionId is not the current session', 409)
        if (toSessionId === fromSessionId) fail('invalid_input', 'handoff target equals the current session', 400)
        const previous = this.currentAttempt(execution)
        previous.endedAt = now; previous.outcome = 'failed'
        previous.reason = (request.reason ?? 'handoff').slice(0, 500)
        const next: ExecutionAttempt = { n: previous.n + 1, sessionId: toSessionId, startedAt: now, outcome: 'running' }
        execution.attempts = [...(execution.attempts ?? []), next]
        execution.sessionId = toSessionId
        execution.fencingToken = (execution.fencingToken ?? 1) + 1
        task.comments.push({ id: newCommentId(), body: normalizeBody(`[handoff] ${fromSessionId} → ${toSessionId}: ${request.reason ?? ''}`.trim()),
          threadId: request.actor, version: 1, createdAt: now })
        task.version += 1; task.updatedAt = now
        return [task]
      } catch (errorValue) { failure = errorValue as PublicApiError; return undefined }
    })
    if (failure !== undefined) throw failure
    return this.executionOf(executionId)
  }
  private async complete(executionId: string, body: Record<string, unknown> | null): Promise<PublicExecutionView> {
    const request = this.readExecutionBody(body)
    const outcome = str(body?.outcome, 20)
    if (outcome !== 'succeeded' && outcome !== 'failed' && outcome !== 'cancelled') {
      fail('invalid_input', 'outcome must be succeeded, failed or cancelled', 400)
    }
    const comment = str(body?.comment, 4_000)
    let report
    try { report = body?.report === undefined ? undefined : normalizeExecutionReport(body.report) }
    catch (errorValue) { fail('invalid_input', errorValue instanceof Error ? errorValue.message : 'invalid report', 400) }
    const now = this.now()
    let failure: PublicApiError | undefined
    let alreadySettled = false
    await this.options.store.mutate('execution-recorded', ledger => {
      const found = this.locate(ledger, executionId)
      if (found === undefined) { failure = new PublicApiError('not_found', 'no such execution', 404); return undefined }
      const { task, execution } = found
      try {
        if (execution.managedBy !== 'external') fail('forbidden', 'this execution is managed by the host', 403)
        if (execution.outcome !== 'running') {
          if (execution.externalActor !== undefined && execution.externalActor !== request.actor) {
            fail('forbidden', 'only the claiming actor may read or replay this execution', 403)
          }
          if (execution.outcome === outcome) { alreadySettled = true; return undefined }
          fail('version_conflict', 'execution already settled with another outcome', 409)
        }
        if (task.claimedBy !== request.actor) fail('forbidden', 'only the claiming actor may settle this execution', 403)
        this.checkFence(execution, request.ifFencingToken)
        execution.outcome = outcome
        execution.endedAt = now
        const attempt = this.currentAttempt(execution)
        attempt.endedAt = now
        attempt.outcome = outcome === 'succeeded' ? 'succeeded' : outcome === 'cancelled' ? 'cancelled' : 'failed'
        if (outcome === 'failed' && request.reason !== undefined) execution.error = request.reason.slice(0, 500)
        if (report !== undefined) execution.report = report
        if (comment !== undefined) task.comments.push({ id: newCommentId(), body: normalizeBody(comment), threadId: request.actor, version: 1, createdAt: now })
        if (outcome === 'succeeded') {
          if (task.status === 'in_progress' && canTransition('in_progress', 'in_review')) {
            task.status = 'in_review'
            delete task.claimedBy; delete task.claimedAt
          }
        } else {
          if (task.status === 'in_progress') {
            task.status = 'todo'
            delete task.claimedBy; delete task.claimedAt
          }
        }
        task.version += 1; task.updatedAt = now; task.updatedBy = { kind: 'agent', sessionId: request.actor }
        return [task]
      } catch (errorValue) { failure = errorValue as PublicApiError; return undefined }
    })
    if (failure !== undefined) throw failure
    if (alreadySettled) return this.executionOf(executionId)
    return this.executionOf(executionId)
  }
  private async interrupt(executionId: string, body: Record<string, unknown> | null): Promise<PublicExecutionView> {
    return this.complete(executionId, { ...(body ?? {}), outcome: 'cancelled' })
  }
  private async report(executionId: string, body: Record<string, unknown> | null): Promise<PublicExecutionView> {
    const request = this.readExecutionBody(body)
    let report
    try { report = normalizeExecutionReport(body?.report) }
    catch (errorValue) { fail('invalid_input', errorValue instanceof Error ? errorValue.message : 'invalid report', 400) }
    const now = this.now()
    let failure: PublicApiError | undefined
    await this.options.store.mutate('execution-recorded', ledger => {
      const found = this.locate(ledger, executionId)
      if (found === undefined) { failure = new PublicApiError('not_found', 'no such execution', 404); return undefined }
      const { task, execution } = found
      try {
        if (execution.managedBy !== 'external') fail('forbidden', 'this execution is managed by the host', 403)
        this.checkFence(execution, request.ifFencingToken)
        const involved = execution.sessionId === request.actor || task.claimedBy === request.actor
          || (execution.attempts ?? []).some(attempt => attempt.sessionId === request.actor)
        if (!involved) fail('forbidden', 'actor does not hold this execution', 403)
        execution.report = report
        task.version += 1; task.updatedAt = now
        return [task]
      } catch (errorValue) { failure = errorValue as PublicApiError; return undefined }
    })
    if (failure !== undefined) throw failure
    return this.executionOf(executionId)
  }
  private locate(ledger: TaskLedger, executionId: string): { task: TaskRecord; execution: ExecutionRecord } | undefined {
    for (const task of ledger.tasks) {
      const execution = task.executions.find(candidate => candidate.id === executionId)
      if (execution !== undefined) return { task, execution }
    }
    return undefined
  }
  // ------------------------------------------------------------------ events
  private record(change: LedgerChange): void {
    if (this.disposed) return
    const at = this.now()
    // One snapshot (and one index) for the whole notification: looking it up
    // per dependant deep-clones and freezes the entire ledger inside the store
    // write lane, which is the O(n²) memory/latency trap.
    const ledgerTasks = this.options.store.snapshot().tasks
    const dependencyIndex = buildDependencyIndex(ledgerTasks)
    const events: PublicEvent[] = []
    const ordinal = () => events.length
    const push = (task: TaskRecord, type: PublicEventType, data?: Record<string, unknown>) => {
      const seq = change.revision * 1_000 + ordinal()
      events.push({ id: `evt_${seq}`, seq, type, at, provenance: 'taskboard', taskId: task.id,
        taskVersion: task.version, status: task.status, workspaceId: task.workspaceId, ...(data === undefined ? {} : { data }) })
    }
    for (const task of change.tasks) {
      if (change.kind === 'task-created') push(task, 'task.created')
      else if (change.kind === 'task-updated') push(task, 'task.updated')
      else if (change.kind === 'task-moved' || change.kind === 'task-deleted') {
        const type: PublicEventType = task.status === 'in_progress' ? 'task.claimed'
          : task.status === 'in_review' ? 'task.in_review'
            : task.status === 'done' ? 'task.done'
              : task.status === 'canceled' ? 'task.rejected' : 'task.updated'
        push(task, type)
      } else if (change.kind === 'comment-added') push(task, 'task.updated', { comment: true })
      else if (change.kind === 'execution-recorded') {
        const execution = task.executions[task.executions.length - 1]
        if (execution !== undefined) {
          if (task.status === 'in_progress' && task.claimedBy !== undefined && execution.outcome === 'running') push(task, 'task.claimed')
          const type: PublicEventType = execution.outcome === 'running' ? 'execution.started'
            : execution.outcome === 'cancelled' ? 'execution.interrupted' : 'execution.completed'
          push(task, type, { executionId: execution.id, outcome: execution.outcome })
          if ((execution.attempts?.length ?? 0) > 1) push(task, 'execution.attempt_changed', { executionId: execution.id, attempt: execution.attempts!.length })
        }
      }
      if (task.blocked) push(task, 'task.blocked')
      if (!task.blocked && task.status === 'todo' && dependencyState(task, ledgerTasks, dependencyIndex).ready) {
        push(task, 'task.ready')
      }
      if (task.status === 'done') {
        for (const dependent of ledgerTasks) {
          if (dependent.trashedAt !== undefined || !(dependent.dependsOn ?? []).includes(task.id)) continue
          if (dependencyState(dependent, ledgerTasks, dependencyIndex).ready) push(dependent, 'task.ready')
        }
      }
    }
    if (events.length === 0) return
    this.events.push(...events)
    if (this.events.length > MAX_EVENTS) this.events.splice(0, this.events.length - MAX_EVENTS)
    const frame = events.map(event => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join('')
    for (const stream of this.streams) { try { stream.write(frame) } catch { this.streams.delete(stream) } }
  }
  private readEvents(url: URL): { events: PublicEvent[]; oldestSeq: number; latestSeq: number; resync: boolean } {
    const since = Math.max(Number.parseInt(url.searchParams.get('since') ?? '0', 10) || 0, 0)
    const limit = Math.min(Math.max(Number.parseInt(url.searchParams.get('limit') ?? '200', 10) || 200, 1), 500)
    const latestSeq = this.events[this.events.length - 1]?.seq ?? 0
    const oldestSeq = this.events[0]?.seq ?? 0
    // No journal survives a restart: tell the consumer to full-resync instead of
    // silently pretending no event was missed.
    const resync = this.events.length === 0 || (since > 0 && since < oldestSeq)
    return { events: resync ? [] : this.events.filter(event => event.seq > since).slice(0, limit), oldestSeq, latestSeq, resync }
  }
  private streamEvents(req: IncomingMessage, res: ServerResponse, url: URL): void {
    res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-store', connection: 'keep-alive' })
    const since = Math.max(Number.parseInt(url.searchParams.get('since') ?? '0', 10) || 0, 0)
    const replay = this.events.filter(event => event.seq > since)
    for (const event of replay) res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`)
    const hello = this.readEvents(url)
    res.write(`event: hello\ndata: ${JSON.stringify({ oldestSeq: hello.oldestSeq, latestSeq: hello.latestSeq, resync: hello.resync })}\n\n`)
    this.streams.add(res)
    if (this.heartbeat === undefined) {
      this.heartbeat = setInterval(() => { for (const stream of this.streams) stream.write(': ping\n\n') }, 20_000)
      this.heartbeat.unref?.()
    }
    const cleanup = () => {
      this.streams.delete(res)
      if (this.streams.size === 0 && this.heartbeat !== undefined) { clearInterval(this.heartbeat); this.heartbeat = undefined }
    }
    req.on('close', cleanup); res.on('close', cleanup); res.on('error', cleanup)
  }
}

/** Parse a public claim request body into the typed shape (validation stays in the service). */
export function publicClaimOf(body: Record<string, unknown> | null): PublicClaimRequest {
  if (body === null) throw new Error('JSON body required')
  return { taskId: String(body.taskId ?? ''), actor: String(body.actor ?? ''),
    ...(typeof body.workspaceId === 'string' ? { workspaceId: body.workspaceId } : {}),
    ...(typeof body.sessionId === 'string' ? { sessionId: body.sessionId } : {}),
    ...(typeof body.idempotencyKey === 'string' ? { idempotencyKey: body.idempotencyKey } : {}) }
}

/** Parse a public completion request body (used by contract tests). */
export function publicCompleteOf(body: Record<string, unknown> | null): PublicCompleteRequest {
  if (body === null) throw new Error('JSON body required')
  const outcome = body.outcome === 'succeeded' || body.outcome === 'failed' || body.outcome === 'cancelled' ? body.outcome : 'failed'
  return { actor: String(body.actor ?? ''), outcome,
    ...(body.report === undefined ? {} : { report: body.report as PublicCompleteRequest['report'] }) }
}

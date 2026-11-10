/**
 * Task Board public execution contract v1 (Agent Board consumer API).
 *
 * Task Board stays the OWNER of the task ledger and the execution envelope.
 * An external agent engine (Agent Board or any authorized orchestrator) is a
 * consumer: it may discover work, atomically reserve an execution envelope,
 * bind its own DSH sessions, attempt failover and publish evidence — it never
 * writes the ledger files and can never mark a task `done`.
 *
 * The API is served under {@link PUBLIC_API_PREFIX} and requires a bearer
 * token configured on the host (`DSH_TASKBOARD_PUBLIC_TOKEN`). Without a token
 * the surface is disabled (HTTP 503), never silently open.
 */
import type { ExecutionAttempt, ExecutionReport, TaskStatus, Urgency } from './protocol.ts'
import type { ExternalReference } from './external.ts'

/** Public API version (independent from the adapter contract version). */
export const PUBLIC_API_VERSION = 1

/** Route prefix of the public contract. */
export const PUBLIC_API_PREFIX = '/dsh-taskboard/public/v1'

/** Environment variable carrying the bearer token. */
export const PUBLIC_API_TOKEN_ENV = 'DSH_TASKBOARD_PUBLIC_TOKEN'

/** Normalized event vocabulary of the contract. */
export const PUBLIC_EVENT_TYPES = [
  'task.created',
  'task.updated',
  'task.ready',
  'task.blocked',
  'task.claimed',
  'execution.started',
  'execution.attempt_changed',
  'execution.interrupted',
  'execution.completed',
  'task.in_review',
  'task.done',
  'task.rejected',
] as const

/** One normalized event type. */
export type PublicEventType = typeof PUBLIC_EVENT_TYPES[number]

/** Stable normalized event. */
export type PublicEvent = {
  /** Stable event identity (`evt_<seq>_<ordinal>`). */
  id: string
  /** Monotonic sequence (`revision * 1000 + ordinal`); use it as `since`. */
  seq: number
  type: PublicEventType
  /** Epoch ms of the observation. */
  at: number
  provenance: 'taskboard'
  taskId?: string
  taskVersion?: number
  status?: TaskStatus
  executionId?: string
  workspaceId?: string
  data?: Record<string, unknown>
}

/** A project (= DSH workspace) visible to the consumer. */
export type PublicProject = { id: string; title: string; path: string }

/** Compact task projection. */
export type PublicTaskSummary = {
  id: string
  title: string
  status: TaskStatus
  urgency: Urgency
  workspaceId: string
  version: number
  blocked: boolean
  claimedBy?: string
  executionMode: string
  dependsOn?: string[]
  parentId?: string
  checklist: { total: number; checked: number }
  latestExecution?: { id: string; outcome: string; sessionId?: string }
  externalRefs?: ExternalReference[]
}

/** Execution envelope projection. */
export type PublicExecutionView = {
  executionId: string
  taskId: string
  workspaceId: string
  attempt: number
  outcome: 'running' | 'succeeded' | 'failed' | 'cancelled'
  trigger: 'manual' | 'scheduled' | 'comment'
  managedBy: 'board' | 'external'
  fencingToken: number
  sessionId?: string
  sessions: string[]
  attempts: ExecutionAttempt[]
  startedAt?: number
  endedAt?: number
  isolation?: 'worktree' | 'none'
  branch?: string
  worktreePath?: string
  error?: string
  report?: ExecutionReport
  taskVersion: number
}

/** Full task projection for one card. */
export type PublicTaskView = PublicTaskSummary & {
  description: string
  prompt: string
  permission?: string
  isolation?: string
  waitingForHuman?: boolean
  waitingReason?: string
  createdAt: number
  updatedAt: number
  executions: PublicExecutionView[]
  dependencies: {
    total: number
    completed: number
    pendingIds: string[]
    missingIds: string[]
    ready: boolean
    details: Array<{ id: string; title?: string; status?: string; state: 'done' | 'pending' | 'missing'; trashed?: boolean }>
  }
  allowedActions: string[]
}

/** `GET /meta` response. */
export type PublicApiMeta = {
  apiVersion: number
  name: 'dsh-taskboard'
  eventTypes: PublicEventType[]
  auth: 'bearer'
  writePolicy: 'explicit'
  donePolicy: 'user-only'
  features: {
    claim: true
    attempts: true
    handoff: true
    reports: true
    events: 'replay+resync'
    worktree: true
    externalSync: true
  }
  taskStatuses: TaskStatus[]
}

/** Claim request: atomically reserve an execution envelope. */
export type PublicClaimRequest = {
  taskId: string
  /** Stable consumer identity (e.g. `agent-board:worker-3`). */
  actor: string
  /** Optional project boundary; a mismatch is refused. */
  workspaceId?: string
  /** Optional first DSH session to attach at claim time. */
  sessionId?: string
  /** Retried claims with the same key return the same envelope. */
  idempotencyKey?: string
}

/** Lifecycle request shared by session/attempt/handoff/complete. */
export type PublicLifecycleRequest = {
  actor: string
  sessionId?: string
  reason?: string
  /** Optional fencing token guard; a stale value is refused. */
  ifFencingToken?: number
}

/** Complete request. Success only ever reaches `in_review`. */
export type PublicCompleteRequest = PublicLifecycleRequest & {
  outcome: 'succeeded' | 'failed' | 'cancelled'
  report?: ExecutionReport
  comment?: string
}

/** Error payload of the public API. */
export type PublicErrorCode =
  | 'public_api_disabled'
  | 'unauthorized'
  | 'invalid_input'
  | 'not_found'
  | 'forbidden'
  | 'version_conflict'
  | 'dependency_blocked'
  | 'stale_execution'
  | 'already_claimed'
  | 'internal'

/** Envelope of every public API response. */
export type PublicApiResult<T> = { ok: true; value: T } | { ok: false; error: { code: PublicErrorCode; message: string } }

/**
 * Version of the external-adapter contract. Bump it whenever the provider
 * surface changes incompatibly; every descriptor declares the version it
 * implements and the registry refuses unknown versions.
 */
export const ADAPTER_CONTRACT_VERSION = 1

/**
 * Declarative adapter operations (contract v1). An adapter may only declare an
 * operation it actually implements; the registry verifies the declaration
 * against the created provider object, so a capability can never be simulated
 * by a descriptor alone.
 */
export type AdapterOperation =
  | 'validateConnection'
  | 'getCapabilities'
  | 'discoverProjects'
  | 'listWorkItems'
  | 'getWorkItem'
  | 'createWorkItem'
  | 'updateWorkItem'
  | 'transitionWorkItem'
  | 'listComments'
  | 'addComment'
  | 'subscribeEvents'
  | 'syncChanges'

/** Every legal operation, in stable order (for capability documents). */
export const ADAPTER_OPERATIONS: readonly AdapterOperation[] = [
  'validateConnection', 'getCapabilities', 'discoverProjects', 'listWorkItems', 'getWorkItem',
  'createWorkItem', 'updateWorkItem', 'transitionWorkItem', 'listComments', 'addComment',
  'subscribeEvents', 'syncChanges',
]

/** Broad adapter families (drives UI grouping, never sync behavior). */
export type AdapterKind = 'forge' | 'planning' | 'tracker'

/** Direction a connection may exchange data in. Outbound is always opt-in. */
export type SyncDirection = 'inbound' | 'outbound'

/** Field-level authority for bidirectional merges. */
export type FieldAuthority = 'local' | 'remote' | 'merge'

/** Local fields a connection may synchronize. */
export type ExternalField = 'title' | 'description' | 'urgency' | 'status' | 'assignees'

/** All synchronizable fields, in stable order. */
export const EXTERNAL_SYNC_FIELDS: readonly ExternalField[] = ['title', 'description', 'urgency', 'status', 'assignees']

/** v1 capabilities. Legacy flags stay for older clients; new fields are additive. */
export type ProviderCapabilities = {
  itemTypes: string[]
  projectDiscovery: boolean
  accountDiscovery: boolean
  pagination: 'page' | 'cursor'
  incremental: boolean
  /** Legacy write gate (kept for pre-1.0 clients). Prefer `directions`. */
  write?: boolean
  dedupe?: boolean
  /** Contract v1: exact implemented operations. */
  operations?: AdapterOperation[]
  /** Contract v1: exchange directions (defaults to inbound + outbound when `write`). */
  directions?: SyncDirection[]
  events?: 'poll' | 'webhook' | 'none'
  /** Signed inbound webhook is implemented (it only triggers a pull). */
  webhook?: boolean
  limits?: { pageSize?: number; maxPages?: number; requestTimeoutMs?: number; rateLimitPerMinute?: number }
  /** Default field ownership; omitted fields use three-way merge (title/description/urgency) or remote status. */
  fieldAuthority?: Partial<Record<ExternalField, FieldAuthority>>
}

/** Platform-neutral external work item contract. IDs are opaque strings. */
export type ProviderDescriptor = {
  id: string
  name: string
  scopeLabel: string
  defaultBaseUrl: string
  /** Adapter contract version this descriptor implements (defaults to legacy 1). */
  contractVersion?: number
  kind?: AdapterKind
  settingsFields?: Array<{ key: string; label: string; defaultValue: string }>
  authModes: Array<{ id: string; label: string; fields: Array<{ key: string; label: string; secret?: boolean }> }>
  /** `write` enables the opt-in outbound phase (create/update/close remote items). */
  capabilities: ProviderCapabilities
}

/**
 * Operations a descriptor declares. Legacy descriptors without `operations`
 * are translated conservatively from the flags they do carry — never more.
 */
export function adapterOperationsOf(descriptor: ProviderDescriptor): AdapterOperation[] {
  const declared = descriptor.capabilities.operations
  if (declared !== undefined) return [...new Set(declared)]
  const ops: AdapterOperation[] = ['validateConnection', 'getCapabilities']
  if (descriptor.capabilities.projectDiscovery) ops.push('discoverProjects')
  ops.push('listWorkItems')
  if (descriptor.capabilities.write) ops.push('createWorkItem', 'updateWorkItem')
  return ops
}

/** Directions a descriptor declares; outbound requires an explicit write capability. */
export function adapterDirectionsOf(descriptor: ProviderDescriptor): SyncDirection[] {
  const declared = descriptor.capabilities.directions
  if (declared !== undefined) return [...new Set(declared)]
  return descriptor.capabilities.write === true ? ['inbound', 'outbound'] : ['inbound']
}

/** Whether the adapter declares one exact operation. */
export function adapterSupports(descriptor: ProviderDescriptor, operation: AdapterOperation): boolean {
  return adapterOperationsOf(descriptor).includes(operation)
}

/** Field authority map with contract defaults applied. */
export function adapterFieldAuthorityOf(descriptor: ProviderDescriptor): Record<ExternalField, FieldAuthority> {
  const declared = descriptor.capabilities.fieldAuthority ?? {}
  return {
    title: declared.title ?? 'merge',
    description: declared.description ?? 'merge',
    urgency: declared.urgency ?? 'merge',
    status: declared.status ?? 'local',
    assignees: declared.assignees ?? 'local',
  }
}
export type ExternalConnection = {
  id: string; provider: string; baseUrl: string; account: string; authMode: string
  /** Human label for the connection manager (defaults to the provider name). */
  label?: string
  /** Disabled connections keep their configuration but are never synchronized. */
  enabled?: boolean
  itemTypes: string[]; mappings: Array<{ projectId: string; workspaceId: string }>
  settings: Record<string, string>
  since: string; intervalMinutes: number
  importStatus?: 'backlog' | 'todo'
  mappingMode?: 'project' | 'execution'
  includeUnmapped?: boolean
  /** Import only items assigned to the sync account (default: false, opt-in). */
  assigneeFilter?: boolean
  /** Reuse an existing card that already references the item instead of creating a duplicate. */
  matchExisting?: boolean
  /**
   * Explicit sync direction. `bidirectional` is the ONLY value that authorizes
   * outbound writes, and it is never inferred: a connection saved without it
   * stays read-only even when the adapter can write.
   */
  direction?: 'inbound' | 'bidirectional'
  /** Fields allowed to move in either direction (defaults to the adapter's supported set). */
  syncFields?: ExternalField[]
  /** Conflicts are surfaced for human resolution; `manual` is the only v1 policy. */
  conflictPolicy?: 'manual'
}
export type ExternalConfig = ExternalConnection & { credentials: Record<string, string> }
export type ExternalProject = { id: string; name: string }
export type ExternalAccount = { account: string; name?: string }
export type SyncResult = {
  created: number; updated: number; unchanged: number; conflicts: number; ignored: number; at: number
  /** Existing cards reused instead of creating duplicates (opt-in dedupe). */
  linked?: number
  /** Items skipped because several local cards referenced them ambiguously. */
  ambiguous?: number
  /** Outbound counters, present only after a push-capable sync. */
  pushed?: number
  pushFailed?: number
  /** Number of enabled connections covered by a multi-connection round. */
  connections?: number
  /** Connections that failed while others succeeded (multi-connection rounds only). */
  failedConnections?: number
}
export type ExternalSyncRecord = {
  links: Record<string, string>; ignored: string[]; lastResult?: SyncResult; lastError?: string; lastAttemptAt?: number
}
export function normalizeExternalSyncRecords(raw: unknown): Record<string, ExternalSyncRecord> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  return Object.fromEntries(Object.entries(raw).flatMap(([id, value]) => {
    if (!id || !value || typeof value !== 'object' || Array.isArray(value)) return []
    const e = value as Record<string, unknown>
    const links = e.links && typeof e.links === 'object' && !Array.isArray(e.links)
      ? Object.fromEntries(Object.entries(e.links).filter((entry): entry is [string, string] => typeof entry[1] === 'string')) : {}
    const ignored = Array.isArray(e.ignored) ? [...new Set(e.ignored.filter((v): v is string => typeof v === 'string'))] : []
    const r = e.lastResult as Record<string, unknown> | undefined
    const nonNegative = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0
    const lastResult = r && typeof r === 'object' && ['created', 'updated', 'unchanged', 'conflicts', 'ignored', 'at'].every(k => nonNegative(r[k]))
      && [r.linked, r.ambiguous, r.pushed, r.pushFailed, r.connections, r.failedConnections].every(k => k === undefined || nonNegative(k))
      ? { created: r.created as number, updated: r.updated as number, unchanged: r.unchanged as number, conflicts: r.conflicts as number,
        ignored: r.ignored as number, at: r.at as number,
        ...(nonNegative(r.linked) ? { linked: r.linked } : {}), ...(nonNegative(r.ambiguous) ? { ambiguous: r.ambiguous } : {}),
        ...(nonNegative(r.pushed) ? { pushed: r.pushed } : {}), ...(nonNegative(r.pushFailed) ? { pushFailed: r.pushFailed } : {}),
        ...(nonNegative(r.connections) ? { connections: r.connections } : {}),
        ...(nonNegative(r.failedConnections) ? { failedConnections: r.failedConnections } : {}) } : undefined
    return [[id, { links, ignored, ...(lastResult ? { lastResult } : {}),
      ...(typeof e.lastError === 'string' ? { lastError: e.lastError } : {}),
      ...(typeof e.lastAttemptAt === 'number' && Number.isFinite(e.lastAttemptAt) ? { lastAttemptAt: e.lastAttemptAt } : {}) }]]
  }))
}
/**
 * Read-only preview of one synchronization round: what WOULD be imported,
 * linked, conflicted or pushed. Never writes to the ledger or to the remote
 * side, so a human can inspect a connection before enabling write-back.
 */
export type SyncPreview = {
  connectionId: string
  provider: string
  at: number
  direction: 'inbound' | 'bidirectional'
  inbound: {
    create: number; update: number; unchanged: number; link: number; ignore: number; conflicts: number
    samples: Array<{ itemId: string; title: string; action: 'create' | 'update' | 'unchanged' | 'link' | 'ignore' | 'conflict'; taskId?: string; fields?: string[] }>
  }
  outbound: {
    push: number
    samples: Array<{ taskId: string; fields: ExternalPushField[] }>
  }
}

/** Per-connection run state exposed by the connection manager (contract v1). */
export type ExternalConnectionState = {
  running: boolean
  lastResult?: SyncResult
  lastError?: string
  ignoredCount: number
  lastAttemptAt?: number
  requiresMappingReview?: boolean
}

export type ExternalSyncStatus = {
  /** Legacy primary connection (identical to `connections[0]`); kept for older clients. */
  config?: ExternalConnection; credentialPresent: Record<string, boolean>; running: boolean
  credentialValues?: Record<string, string>
  providers: ProviderDescriptor[]; lastResult?: SyncResult; lastError?: string; ignoredCount: number
  lastAttemptAt?: number
  requiresMappingReview?: boolean
  /** Contract v1: every configured connection, primary first. */
  connections?: ExternalConnection[]
  /** Contract v1: per-connection run state keyed by connection id. */
  connectionStates?: Record<string, ExternalConnectionState>
  /** Contract v1 adapter contract version implemented by this host. */
  contractVersion?: number
}
export type ExternalFields = { title: string; description: string; urgency: 'urgent' | 'normal' | 'relaxed' }
/** Outbound patch for one linked remote item. `close` is a terminal local state. */
export type ExternalPushPatch = { title?: string; description?: string; close?: 'completed' | 'not_planned' }
export type ExternalPushField = 'title' | 'description' | 'state'
export type ExternalPushOutcome = { created: boolean; pushed: ExternalPushField[]; item: ExternalItem }
export type ExternalItem = ExternalFields & {
  projectId: string
  type: string
  id: string
  url: string
  status: string
  priority: string
  assignedTo: string
  assignees?: string[]
  closed: boolean
  /** Remote revision (updated_at / etag / version) used for optimistic conflict detection. */
  revision?: string
}
/**
 * What the local card looked like at the last completed push. Separate from
 * `item` (the last seen remote state) so inbound merges never mask a local
 * edit and adopted cards never push their pre-link content back.
 */
export type ExternalPushBase = { title: string; description: string; status: string }
export type ExternalSource = {
  providerName?: string
  connectionId: string
  provider: string
  item: ExternalItem
  syncedAt: number
  conflicts: Array<keyof ExternalFields>
  /** Absent on pre-dedupe sources; treated as "never pushed" defaults. */
  pushBase?: ExternalPushBase
}

/**
 * Canonical, provider-neutral identity of one remote work item. A single local
 * card may reference several external items (GitHub issue + Jira ticket …)
 * without duplicating the work; `primary` marks the one that drives sync.
 *
 * `revision` is the remote revision observed at `syncedAt` (updated_at, etag,
 * version …). An empty string means "the adapter exposes no revision" and
 * conflict detection falls back to the last seen field values.
 */
export type ExternalReference = {
  system: string
  instance: string
  kind: string
  project: string
  id: string
  url: string
  revision: string
  syncedAt: number
  state: 'linked' | 'conflict' | 'ignored' | 'unlinked'
  provenance: 'imported' | 'linked' | 'created' | 'webhook' | 'manual'
  primary?: boolean
}

/** Preferred v1 label: system/provider id (kept explicit for future aliases). */
export function externalReferenceSystem(provider: string): string {
  return provider.trim().toLowerCase()
}

/** Build the canonical reference of an already-linked source. */
export function externalReferenceOf(source: ExternalSource, state: ExternalReference['state'] = 'linked'): ExternalReference {
  return {
    system: externalReferenceSystem(source.provider),
    instance: source.connectionId,
    kind: source.item.type,
    project: source.item.projectId,
    id: source.item.id,
    url: source.item.url,
    revision: source.item.revision ?? '',
    syncedAt: source.syncedAt,
    state,
    provenance: 'imported',
    primary: true,
  }
}

/** Defensive reconstruction from imported/legacy ledgers; never trusts unknown fields. */
export function normalizeExternalReferences(raw: unknown): ExternalReference[] {
  if (!Array.isArray(raw)) return []
  const out: ExternalReference[] = []
  const seen = new Set<string>()
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue
    const e = entry as Record<string, unknown>
    if (typeof e.system !== 'string' || !e.system || typeof e.instance !== 'string' || !e.instance
      || typeof e.kind !== 'string' || !e.kind || typeof e.project !== 'string' || typeof e.id !== 'string' || !e.id
      || typeof e.url !== 'string') continue
    try { if (!['http:', 'https:'].includes(new URL(e.url).protocol)) continue } catch { continue }
    const state = ['linked', 'conflict', 'ignored', 'unlinked'].includes(String(e.state)) ? e.state as ExternalReference['state'] : 'linked'
    const provenance = ['imported', 'linked', 'created', 'webhook', 'manual'].includes(String(e.provenance)) ? e.provenance as ExternalReference['provenance'] : 'imported'
    const ref: ExternalReference = {
      system: e.system, instance: e.instance, kind: e.kind, project: e.project, id: e.id, url: e.url,
      revision: typeof e.revision === 'string' ? e.revision : '',
      syncedAt: typeof e.syncedAt === 'number' && Number.isFinite(e.syncedAt) ? e.syncedAt : 0,
      state, provenance, ...(e.primary === true ? { primary: true } : {}),
    }
    const key = [ref.system, ref.instance, ref.kind, ref.project, ref.id].join('\u0000')
    if (seen.has(key)) continue
    seen.add(key)
    out.push(ref)
  }
  return out.slice(0, 20)
}

/**
 * Insert or replace one canonical reference, keeping at most one `primary`.
 * Pure: returns a new array (never mutates the input).
 */
export function upsertExternalReference(current: readonly ExternalReference[] | undefined, ref: ExternalReference): ExternalReference[] {
  const key = (r: ExternalReference) => [r.system, r.instance, r.kind, r.project, r.id].join('\u0000')
  const next = (current ?? []).map(entry => entry.state === 'linked' && ref.primary === true && key(entry) !== key(ref) && entry.primary === true
    ? { ...entry, primary: undefined } as ExternalReference : entry)
  const at = next.findIndex(entry => key(entry) === key(ref))
  if (at >= 0) next[at] = { ...ref }
  else next.push({ ...ref, ...(ref.primary === true ? { primary: true } : {}) })
  return next.slice(0, 20)
}

const TASK_STATUSES = ['backlog', 'todo', 'in_progress', 'in_review', 'done', 'canceled', 'archived'] as const

export function externalKey(connectionId: string, item: Pick<ExternalItem, 'projectId' | 'type' | 'id'>): string {
  return JSON.stringify([connectionId, item.projectId, item.type, item.id])
}

function normalizePushBase(raw: unknown): ExternalPushBase | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const e = raw as Record<string, unknown>
  if (typeof e.title !== 'string' || typeof e.description !== 'string') return undefined
  if (typeof e.status !== 'string' || !TASK_STATUSES.includes(e.status as never)) return undefined
  return { title: e.title, description: e.description, status: e.status }
}

/** Explicit reconstruction also prevents credentials/unknown fields entering exports. */
export function normalizeExternalSource(raw: unknown): ExternalSource | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const e = raw as Record<string, unknown>
  if (typeof e.connectionId !== 'string' || !e.connectionId || typeof e.provider !== 'string'
    || typeof e.syncedAt !== 'number' || !Number.isFinite(e.syncedAt) || !e.item || typeof e.item !== 'object') return undefined
  const i = e.item as Record<string, unknown>
  for (const field of ['projectId', 'type', 'id', 'url', 'status', 'priority', 'assignedTo', 'title', 'description']) {
    if (typeof i[field] !== 'string') return undefined
  }
  try { if (!['http:', 'https:'].includes(new URL(i.url as string).protocol)) return undefined } catch { return undefined }
  if (!['urgent', 'normal', 'relaxed'].includes(String(i.urgency)) || typeof i.closed !== 'boolean') return undefined
  const item: ExternalItem = {
    projectId: i.projectId as string, type: i.type as string, id: i.id as string,
    url: i.url as string, status: i.status as string, priority: i.priority as string,
    assignedTo: i.assignedTo as string, title: i.title as string, description: i.description as string,
    urgency: i.urgency as ExternalItem['urgency'], closed: i.closed,
    ...(Array.isArray(i.assignees) ? { assignees: i.assignees.filter((v): v is string => typeof v === 'string') } : {}),
    ...(typeof i.revision === 'string' ? { revision: i.revision } : {}),
  }
  const pushBase = normalizePushBase(e.pushBase)
  return { connectionId: e.connectionId, provider: e.provider, ...(typeof e.providerName === 'string' ? { providerName: e.providerName } : {}), syncedAt: e.syncedAt, item,
    conflicts: Array.isArray(e.conflicts) ? e.conflicts.filter((v): v is keyof ExternalFields => ['title', 'description', 'urgency'].includes(v)) : [],
    ...(pushBase === undefined ? {} : { pushBase }) }
}

/**
 * Three-way merge; unresolved conflicts persist across unchanged syncs.
 *
 * Authority (contract v1) changes the outcome of a divergence:
 * - `merge` (default): remote wins only when the local value is untouched,
 *   otherwise the field is reported as a conflict for a human decision;
 * - `remote`: the remote value always wins (frozen executions are still never
 *   overwritten under them — a running agent's card stays stable);
 * - `local`: the local value always wins; the divergence is recorded as a
 *   conflict so the UI can show the remote value without overwriting the card.
 */
export function mergeExternalFields(local: ExternalFields, previous: ExternalSource, incoming: ExternalItem, frozen: boolean,
  authority: Partial<Record<keyof ExternalFields, FieldAuthority>> = {}): {
  fields: ExternalFields; conflicts: Array<keyof ExternalFields>
} {
  const fields = { title: local.title, description: local.description, urgency: local.urgency }
  const conflicts: Array<keyof ExternalFields> = []
  for (const key of ['title', 'description', 'urgency'] as const) {
    if (local[key] === incoming[key]) continue
    const remoteChanged = incoming[key] !== previous.item[key]
    if (!remoteChanged && !previous.conflicts.includes(key)) continue
    const mode = authority[key] ?? 'merge'
    if (mode === 'remote' && !frozen) {
      if (key === 'urgency') fields.urgency = incoming.urgency
      else fields[key] = incoming[key]
      continue
    }
    if (mode === 'local') { conflicts.push(key); continue }
    if (!frozen && local[key] === previous.item[key] && !previous.conflicts.includes(key)) {
      if (key === 'urgency') fields.urgency = incoming.urgency
      else fields[key] = incoming[key]
    } else conflicts.push(key)
  }
  return { fields, conflicts }
}

/** Comparison form for "does this card already represent that item?" checks. */
export function normalizeMatchTitle(title: string): string {
  return title.normalize('NFKC').toLowerCase()
    .replace(/\(#\d+\)/g, ' ')
    .replace(/#\d+/g, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim().replace(/\s+/g, ' ')
}

function matchTokens(text: string): Set<string> {
  return new Set(normalizeMatchTitle(text).split(' ').filter(word => word.length > 2))
}

/** 0..1 token containment of the shorter side (works across languages). */
export function externalTitleSimilarity(left: string, right: string): number {
  const a = matchTokens(left); const b = matchTokens(right)
  if (a.size === 0 || b.size === 0) return 0
  let shared = 0
  for (const token of a) if (b.has(token)) shared++
  return shared / Math.min(a.size, b.size)
}

/**
 * Score an unlinked local card as the card that already covers `item`
 * (opt-in dedupe). Returns undefined when the card carries no reference.
 * A `#N` in the card title is authoritative; otherwise the FIRST issue URL in
 * title+description is the canonical reference (later URLs are cross-links);
 * otherwise the normalized titles must match exactly.
 */
export function externalMatchScore(card: { title: string; description: string }, itemId: string, itemTitle: string): number | undefined {
  const similarity = externalTitleSimilarity(card.title, itemTitle) * 100
  const titleRefs = [...card.title.matchAll(/#(\d+)/g)].map(match => match[1]!)
  if (titleRefs.length > 0) return titleRefs.includes(itemId) ? 1000 + similarity : undefined
  const firstUrl = /\/issues\/(\d+)/.exec(`${card.title}\n${card.description}`)?.[1]
  if (firstUrl !== undefined) return firstUrl === itemId ? 300 + similarity : undefined
  return normalizeMatchTitle(card.title) === normalizeMatchTitle(itemTitle) ? 400 + similarity : undefined
}

/**
 * Pick the unique best scoring card. Several cards referencing the same item
 * stay unlinked and are reported instead of guessing.
 */
export function bestExternalMatch<T>(candidates: Array<{ card: T; score: number }>, minGap = 10):
  { card: T } | { ambiguous: true } | undefined {
  if (candidates.length === 0) return undefined
  const sorted = [...candidates].sort((left, right) => right.score - left.score)
  if (sorted.length === 1) return { card: sorted[0]!.card }
  const best = sorted[0]!
  const second = sorted[1]!
  return best.score - second.score >= minGap ? { card: best.card } : { ambiguous: true }
}

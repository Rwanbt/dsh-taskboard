/** Platform-neutral external work item contract. IDs are opaque strings. */
export type ProviderDescriptor = {
  id: string
  name: string
  scopeLabel: string
  defaultBaseUrl: string
  settingsFields?: Array<{ key: string; label: string; defaultValue: string }>
  authModes: Array<{ id: string; label: string; fields: Array<{ key: string; label: string; secret?: boolean }> }>
  /** `write` enables the opt-in outbound phase (create/update/close remote items). */
  capabilities: { itemTypes: string[]; projectDiscovery: boolean; accountDiscovery: boolean; pagination: 'page' | 'cursor'; incremental: boolean; write?: boolean; dedupe?: boolean }
}
export type ExternalConnection = {
  id: string; provider: string; baseUrl: string; account: string; authMode: string
  itemTypes: string[]; mappings: Array<{ projectId: string; workspaceId: string }>
  settings: Record<string, string>
  since: string; intervalMinutes: number
  importStatus?: 'backlog' | 'todo'
  mappingMode?: 'project' | 'execution'
  includeUnmapped?: boolean
  /** Import only items assigned to the sync account (default: true). */
  assigneeFilter?: boolean
  /** Reuse an existing card that already references the item instead of creating a duplicate. */
  matchExisting?: boolean
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
      && [r.linked, r.ambiguous, r.pushed, r.pushFailed].every(k => k === undefined || nonNegative(k))
      ? { created: r.created as number, updated: r.updated as number, unchanged: r.unchanged as number, conflicts: r.conflicts as number,
        ignored: r.ignored as number, at: r.at as number,
        ...(nonNegative(r.linked) ? { linked: r.linked } : {}), ...(nonNegative(r.ambiguous) ? { ambiguous: r.ambiguous } : {}),
        ...(nonNegative(r.pushed) ? { pushed: r.pushed } : {}), ...(nonNegative(r.pushFailed) ? { pushFailed: r.pushFailed } : {}) } : undefined
    return [[id, { links, ignored, ...(lastResult ? { lastResult } : {}),
      ...(typeof e.lastError === 'string' ? { lastError: e.lastError } : {}),
      ...(typeof e.lastAttemptAt === 'number' && Number.isFinite(e.lastAttemptAt) ? { lastAttemptAt: e.lastAttemptAt } : {}) }]]
  }))
}
export type ExternalSyncStatus = {
  config?: ExternalConnection; credentialPresent: Record<string, boolean>; running: boolean
  credentialValues?: Record<string, string>
  providers: ProviderDescriptor[]; lastResult?: SyncResult; lastError?: string; ignoredCount: number
  lastAttemptAt?: number
  requiresMappingReview?: boolean
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
  }
  const pushBase = normalizePushBase(e.pushBase)
  return { connectionId: e.connectionId, provider: e.provider, ...(typeof e.providerName === 'string' ? { providerName: e.providerName } : {}), syncedAt: e.syncedAt, item,
    conflicts: Array.isArray(e.conflicts) ? e.conflicts.filter((v): v is keyof ExternalFields => ['title', 'description', 'urgency'].includes(v)) : [],
    ...(pushBase === undefined ? {} : { pushBase }) }
}

/** Three-way merge; unresolved conflicts persist across unchanged syncs. */
export function mergeExternalFields(local: ExternalFields, previous: ExternalSource, incoming: ExternalItem, frozen: boolean): {
  fields: ExternalFields; conflicts: Array<keyof ExternalFields>
} {
  const fields = { title: local.title, description: local.description, urgency: local.urgency }
  const conflicts: Array<keyof ExternalFields> = []
  for (const key of ['title', 'description', 'urgency'] as const) {
    if (local[key] === incoming[key]) continue
    const remoteChanged = incoming[key] !== previous.item[key]
    if (!remoteChanged && !previous.conflicts.includes(key)) continue
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

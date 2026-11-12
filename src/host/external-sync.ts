import { createHash, createHmac, timingSafeEqual } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import {
  ADAPTER_CONTRACT_VERSION,
  adapterDirectionsOf,
  adapterFieldAuthorityOf,
  externalReferenceOf,
  upsertExternalReference,
  type ExternalConnectionState,
  type ExternalItem,
  type ExternalPushBase,
  type ExternalPushField,
  type ExternalPushOutcome,
  type ExternalPushPatch,
  type ExternalSource,
  type ExternalSyncRecord,
  type SyncPreview,
} from '../shared/external.ts'
import { bestExternalMatch, externalKey, externalMatchScore, mergeExternalFields, normalizeExternalSource, normalizeExternalSyncRecords } from '../shared/external.ts'
import { defaultIsolationOf, defaultPermissionOf, newTaskId, normalizeTitle, type TaskRecord, type TaskLedger } from '../shared/protocol.ts'
import type { TaskStore } from './store.ts'
import type { ExternalConfig, ExternalSyncStatus, SyncResult } from '../shared/external.ts'
import type { ExternalTaskProvider, ExternalProviderRegistry, ExternalWriteProvider } from './external-provider.ts'
import { createBuiltinProviders } from './external-providers.ts'
import { normalizeConnection } from './external-config.ts'
export type { ExternalConfig, SyncResult } from '../shared/external.ts'
export type { ExternalTaskProvider } from './external-provider.ts'

/** Host-only persisted state. Credentials never leave this file. */
type SyncState = { connections: ExternalConfig[] }

/** Maximum number of configured connections (bounded queue, no unbounded scan). */
const MAX_CONNECTIONS = 10
/** Bounded delivery-id memory for inbound webhook de-duplication. */
const MAX_WEBHOOK_DELIVERIES = 1_000
/** Providers with an implemented, signed inbound webhook (poll remains authoritative). */
const WEBHOOK_PROVIDERS = new Set(['github', 'gitlab', 'gitea'])

/** Constant-time comparison of two arbitrary strings. */
function secureTextEqual(left: string, right: string): boolean {
  const a = createHash('sha256').update(left).digest()
  const b = createHash('sha256').update(right).digest()
  return timingSafeEqual(a, b)
}

/** One normalized webhook decision, rendered by the route. */
export type WebhookOutcome = { status: number; body: Record<string, unknown> }

export function normalizeExternalConfig(raw: unknown, previous?: ExternalConfig): ExternalConfig {
  return normalizeConnection(raw, createBuiltinProviders(), previous)
}

/** Strip credentials before any status/UI/export path sees a connection. */
function publicConnection(config: ExternalConfig) {
  const { credentials: _credentials, ...rest } = config
  return rest
}

function sumResults(results: SyncResult[]): SyncResult {
  const base: SyncResult = { created: 0, updated: 0, unchanged: 0, conflicts: 0, ignored: 0, at: 0 }
  for (const result of results) {
    base.created += result.created; base.updated += result.updated; base.unchanged += result.unchanged
    base.conflicts += result.conflicts; base.ignored += result.ignored
    base.at = Math.max(base.at, result.at)
    if (result.linked !== undefined) base.linked = (base.linked ?? 0) + result.linked
    if (result.ambiguous !== undefined) base.ambiguous = (base.ambiguous ?? 0) + result.ambiguous
    if (result.pushed !== undefined) base.pushed = (base.pushed ?? 0) + result.pushed
    if (result.pushFailed !== undefined) base.pushFailed = (base.pushFailed ?? 0) + result.pushFailed
  }
  return base
}

/**
 * External synchronization service (contract v1).
 *
 * Owns every configured connection, the opt-in outbound phase and the
 * non-secret sync metadata committed atomically with imported tasks. A
 * connection only writes remotely when its stored `direction` is
 * `bidirectional` — adapter write capability alone never authorizes a push.
 */
export class ExternalSyncService {
  private state: SyncState = { connections: [] }
  private volatileErrors = new Map<string, string>()
  private ready: Promise<void>
  private lane: Promise<unknown> = Promise.resolve()
  private running = new Set<string>()
  private disposed = false
  private controllers = new Map<string, AbortController>()
  private timer?: ReturnType<typeof setInterval>
  private lastAttempts = new Map<string, number>()
  private readonly webhookDeliveries = new Set<string>()
  private readonly webhookOrder: string[] = []
  private readonly registry: ExternalProviderRegistry
  constructor(private readonly options: {
    file: string; store: TaskStore; workspaceExists: (id: string) => boolean
    provider?: (config: ExternalConfig) => ExternalTaskProvider; now?: () => number; registry?: ExternalProviderRegistry
  }) {
    this.registry = options.registry ?? createBuiltinProviders()
    this.ready = this.load()
    // Construction is eager, before callers await ready. Keep the rejection
    // for request guards without letting a damaged ledger terminate the host.
    void this.ready.catch(error => {
      console.warn('[dsh-taskboard] external sync initialization failed; ledger retained:', error)
    })
  }
  private now(): number { return this.options.now?.() ?? Date.now() }
  private async load(): Promise<void> {
    try {
      const raw = JSON.parse(await readFile(this.options.file, 'utf8')) as SyncState & Partial<ExternalSyncRecord> & {
        connections?: unknown; config?: unknown
      }
      const candidates = Array.isArray(raw.connections) ? raw.connections : raw.config !== undefined ? [raw.config] : []
      if (candidates.length > MAX_CONNECTIONS) throw new Error('too many configured connections')
      const connections: ExternalConfig[] = []
      for (const candidate of candidates) {
        if (!candidate || typeof candidate !== 'object') throw new Error('invalid connection entry')
        const value = candidate as Record<string, unknown>
        if (typeof value.id !== 'string' || !value.id) throw new Error('invalid connection identity')
        // A stored connection without an explicit direction predates the
        // write-back default: keep it read-only so an upgrade never silently
        // starts writing to the remote tracker.
        const normalized = normalizeConnection({ direction: 'inbound', ...value }, this.registry, undefined, false, true)
        connections.push({ ...normalized, id: value.id })
      }
      if (new Set(connections.map(connection => connection.id)).size !== connections.length) throw new Error('duplicate connection identity')
      this.state = { connections }
      await this.options.store.load()
      // Move the single-connection metadata of 0.10/0.11 into the ledger once.
      const legacy = raw.config !== undefined && raw.config !== null && typeof raw.config === 'object'
        ? (raw.config as Record<string, unknown>) : undefined
      const legacyId = typeof legacy?.id === 'string' ? legacy.id : connections[0]?.id
      if (legacyId && (Object.keys(raw.links ?? {}).length || raw.ignored?.length || raw.lastResult || raw.lastError)) {
        const migrated = normalizeExternalSyncRecords({ [legacyId]: raw })[legacyId]!
        await this.options.store.mutate('external-sync-updated', ledger => {
          if (ledger.externalSync?.[legacyId]) return undefined
          ledger.externalSync ??= {}; ledger.externalSync[legacyId] = migrated
          return []
        })
      }
      for (const connection of connections) {
        this.lastAttempts.set(connection.id, this.options.store.snapshot().externalSync?.[connection.id]?.lastAttemptAt ?? 0)
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        this.volatileErrors.set('', 'External sync configuration could not be loaded; reconfigure the connection.')
      }
    }
    await this.options.store.load()
  }
  private async persist(): Promise<void> {
    await mkdir(dirname(this.options.file), { recursive: true })
    const temp = `${this.options.file}.tmp`
    // `config` mirrors the primary connection for one release so pre-0.12
    // tooling and rollback keep working; `connections` is authoritative.
    const payload = { ...this.state, ...(this.primary() === undefined ? { config: undefined } : { config: this.primary() }) }
    await writeFile(temp, JSON.stringify(payload), { mode: 0o600 })
    await rename(temp, this.options.file)
  }
  private serial<T>(run: () => Promise<T>): Promise<T> {
    const next = this.lane.then(run, run)
    this.lane = next.catch(() => {})
    return next
  }
  private primary(): ExternalConfig | undefined { return this.state.connections[0] }
  private connection(id: string): ExternalConfig {
    const config = this.state.connections.find(candidate => candidate.id === id)
    if (config === undefined) throw new Error('unknown external connection')
    return config
  }
  private recordOf(connectionId: string): ExternalSyncRecord | undefined {
    return this.options.store.snapshot().externalSync?.[connectionId]
  }
  private stateOf(config: ExternalConfig): ExternalConnectionState {
    const record = this.recordOf(config.id)
    return { running: this.running.has(config.id),
      lastResult: record?.lastResult, lastError: this.volatileErrors.get(config.id) ?? record?.lastError,
      lastAttemptAt: record?.lastAttemptAt, ignoredCount: record?.ignored.length ?? 0,
      requiresMappingReview: config.provider === 'zentao' && !config.mappingMode }
  }
  async status(): Promise<ExternalSyncStatus> {
    await this.ready
    const connections = this.state.connections.map(publicConnection)
    const primary = connections[0]
    const credentialPresent = Object.fromEntries(Object.entries(this.primary()?.credentials ?? {}).map(([key, value]) => [key, Boolean(value)]))
    const mode = primary && this.registry.get(primary.provider).descriptor.authModes.find(m => m.id === primary.authMode)
    const credentialValues = Object.fromEntries((mode?.fields ?? []).filter(f => f.secret === false)
      .map(f => [f.key, this.primary()?.credentials[f.key] ?? '']))
    const connectionStates = Object.fromEntries(this.state.connections.map(config => [config.id, this.stateOf(config)]))
    const primaryState = this.primary() === undefined ? undefined : this.stateOf(this.primary()!)
    return { config: primary, connections, connectionStates, contractVersion: ADAPTER_CONTRACT_VERSION,
      credentialPresent, credentialValues, providers: this.registry.list(), running: this.running.size > 0,
      requiresMappingReview: primaryState?.requiresMappingReview,
      lastResult: primaryState?.lastResult, lastError: primaryState?.lastError ?? this.volatileErrors.get(''),
      lastAttemptAt: primaryState?.lastAttemptAt, ignoredCount: primaryState?.ignoredCount ?? 0 }
  }
  /**
   * Create or update a connection. With one existing connection and no
   * explicit id, the call updates it (0.10/0.11 client compatibility); pass
   * `createNew` to append a second connection instead.
   * @returns the stable connection id.
   */
  async configure(raw: unknown, connectionId?: string, createNew = false): Promise<string> {
    await this.ready
    if (this.running.size > 0) throw new Error('sync is running')
    return this.serial(async () => {
      if (this.running.size > 0) throw new Error('sync is running')
      const incoming = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {}
      let previous: ExternalConfig | undefined
      if (connectionId !== undefined) previous = this.connection(connectionId)
      else if (typeof incoming.id === 'string') previous = this.state.connections.find(candidate => candidate.id === incoming.id)
      else if (!createNew && this.state.connections.length === 1) previous = this.state.connections[0]
      const config = normalizeConnection(raw, this.registry, previous)
      if (config.mappings.some(m => m.workspaceId ? !this.options.workspaceExists(m.workspaceId) : !config.includeUnmapped)) throw new Error('unknown workspace')
      const id = previous?.id ?? (this.state.connections.some(candidate => candidate.id === config.id) || !config.id ? newTaskId() : config.id)
      const stored: ExternalConfig = { ...config, id }
      if (previous === undefined && this.state.connections.length >= MAX_CONNECTIONS) throw new Error('too many configured connections')
      const old = this.state
      this.state = { connections: previous === undefined
        ? [...old.connections, stored]
        : old.connections.map(candidate => candidate.id === previous!.id ? stored : candidate) }
      try { await this.persist() } catch (e) { this.state = old; throw e }
      this.volatileErrors.delete(id)
      this.volatileErrors.delete('')
      return id
    })
  }
  /** Remove one connection. Sync metadata stays in the ledger for audit. */
  async removeConnection(id: string): Promise<void> {
    await this.ready
    if (this.running.size > 0) throw new Error('sync is running')
    await this.serial(async () => {
      if (this.running.size > 0) throw new Error('sync is running')
      this.connection(id)
      const old = this.state
      this.state = { connections: old.connections.filter(candidate => candidate.id !== id) }
      try { await this.persist() } catch (e) { this.state = old; throw e }
      this.lastAttempts.delete(id); this.volatileErrors.delete(id)
    })
  }
  /** Enable/disable a connection without editing its credentials or mappings. */
  async setEnabled(id: string, enabled: boolean): Promise<void> {
    const config = this.connection(id)
    await this.configure({ ...publicConnection(config), enabled }, id)
  }
  async clearIgnored(connectionId?: string): Promise<void> {
    await this.ready
    if (this.running.size > 0) throw new Error('sync is running')
    await this.serial(async () => {
      if (this.running.size > 0) throw new Error('sync is running')
      const config = connectionId !== undefined ? this.connection(connectionId) : this.primary()
      if (!config) throw new Error('configure a connection first')
      await this.options.store.mutate('external-sync-updated', ledger => {
        const record = this.record(ledger, config.id)
        record.ignored = []; record.links = {}
        return []
      })
    })
  }
  async resolve(taskId: string, field: string, acceptExternal: boolean, ifVersion: number): Promise<void> {
    if (!['title', 'description', 'urgency'].includes(field)) throw new Error('invalid conflict field')
    await this.options.store.mutate('task-updated', ledger => {
      const task = ledger.tasks.find(t => t.id === taskId)
      if (!task?.external || task.version !== ifVersion) throw new Error('task changed; refresh and retry')
      if (task.status === 'in_progress' || task.executions.some(e => e.outcome === 'running')) throw new Error('wait until execution finishes')
      const key = field as 'title' | 'description' | 'urgency'
      if (!task.external.conflicts.includes(key)) throw new Error('field is not an unresolved conflict')
      if (acceptExternal) {
        if (key === 'urgency') task.urgency = task.external.item.urgency
        else task[key] = task.external.item[key]
      }
      task.external.conflicts = task.external.conflicts.filter(k => k !== key)
      if (task.externalRefs !== undefined) {
        task.externalRefs = task.externalRefs.map(ref => ref.project === task.external!.item.projectId && ref.id === task.external!.item.id
          && ref.system === task.external!.provider ? { ...ref, state: task.external!.conflicts.length === 0 ? 'linked' : 'conflict' } : ref)
      }
      task.version++; task.updatedAt = this.now(); task.updatedBy = { kind: 'user' }
      return [task]
    })
  }
  private record(ledger: TaskLedger, connectionId: string): ExternalSyncRecord {
    ledger.externalSync ??= {}
    return ledger.externalSync[connectionId] ??= { links: {}, ignored: [] }
  }
  start(): void {
    if (this.timer || this.disposed) return
    this.timer = setInterval(() => { void this.tick().catch(() => {}) }, 30_000)
    this.timer.unref?.()
  }
  private async tick(): Promise<void> {
    await this.ready
    for (const config of this.state.connections) {
      if (config.enabled === false) continue
      const interval = config.intervalMinutes
      if (!interval) continue
      if (config.provider === 'zentao' && !config.mappingMode) continue
      const lastAttempt = this.lastAttempts.get(config.id) ?? 0
      if (this.now() - lastAttempt < interval * 60_000) continue
      try { await this.sync(config.id) } catch { /* next tick retries; the record carries the error */ }
    }
  }
  dispose(): void {
    this.disposed = true
    if (this.timer) clearInterval(this.timer)
    for (const controller of this.controllers.values()) controller.abort()
    this.controllers.clear()
  }
  cancel(connectionId?: string): void {
    if (connectionId === undefined) { for (const controller of this.controllers.values()) controller.abort(); return }
    this.controllers.get(connectionId)?.abort()
  }
  /**
   * Verify and accept one inbound webhook. The payload is NEVER applied
   * directly: it only triggers a pull (the remote API stays authoritative),
   * which makes duplicated or out-of-order deliveries harmless. Deliberate
   * duplicates are dropped by delivery id so one event cannot cause a sync
   * storm.
   */
  async receiveWebhook(connectionId: string, headers: Record<string, string | string[] | undefined>, rawBody: string): Promise<WebhookOutcome> {
    await this.ready
    const header = (name: string): string | undefined => {
      const value = headers[name]
      return Array.isArray(value) ? value[0] : value
    }
    const config = this.state.connections.find(candidate => candidate.id === connectionId)
    if (config === undefined) return { status: 404, body: { ok: false, error: { code: 'not_found', message: 'unknown external connection' } } }
    if (!WEBHOOK_PROVIDERS.has(config.provider)) {
      return { status: 501, body: { ok: false, error: { code: 'not_supported', message: 'this provider does not implement signed webhooks' } } }
    }
    const secret = config.credentials.webhookSecret
    if (secret === undefined || secret.length === 0) {
      return { status: 503, body: { ok: false, error: { code: 'webhook_disabled', message: 'configure a webhook secret for this connection' } } }
    }
    const signature = config.provider === 'gitlab'
      ? (header('x-gitlab-token') ?? '')
      : config.provider === 'gitea'
        ? (header('x-gitea-signature') ?? '')
        : (header('x-hub-signature-256') ?? '')
    if (!signature) return { status: 401, body: { ok: false, error: { code: 'unauthorized', message: 'missing webhook signature' } } }
    const digest = createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex')
    const valid = config.provider === 'gitlab'
      ? secureTextEqual(signature, secret)
      : secureTextEqual(signature, config.provider === 'github' ? `sha256=${digest}` : digest)
    if (!valid) return { status: 401, body: { ok: false, error: { code: 'unauthorized', message: 'invalid webhook signature' } } }
    const delivery = header('x-github-delivery') ?? header('x-gitea-delivery') ?? header('x-gitlab-event-uuid') ?? digest
    if (this.webhookDeliveries.has(delivery)) {
      return { status: 202, body: { ok: true, value: { accepted: true, duplicate: true, sync: 'ignored' } } }
    }
    this.webhookDeliveries.add(delivery)
    this.webhookOrder.push(delivery)
    while (this.webhookOrder.length > MAX_WEBHOOK_DELIVERIES) {
      const dropped = this.webhookOrder.shift()
      if (dropped !== undefined) this.webhookDeliveries.delete(dropped)
    }
    const event = header('x-github-event') ?? header('x-gitea-event') ?? header('x-gitlab-event') ?? ''
    if (event === 'ping' || event === 'system_hooks') {
      return { status: 200, body: { ok: true, value: { accepted: true, duplicate: false, event, sync: 'not_needed' } } }
    }
    if (config.enabled === false) {
      return { status: 202, body: { ok: true, value: { accepted: true, duplicate: false, event, sync: 'disabled' } } }
    }
    // Fire-and-forget: the HTTP ack never waits for a remote round trip. The
    // pull is authoritative, so ordering does not matter; a failed pull is
    // recorded in the connection state and retried by the scheduler.
    void this.sync(config.id).catch(() => {})
    return { status: 202, body: { ok: true, value: { accepted: true, duplicate: false, event, sync: 'queued' } } }
  }
  /** Resolve the connection a live test/draft belongs to (secondary edits too). */
  private draftPrevious(raw: unknown): ExternalConfig | undefined {
    const connectionId = raw && typeof raw === 'object' ? (raw as Record<string, unknown>).connectionId : undefined
    return typeof connectionId === 'string' ? this.connection(connectionId) : this.primary()
  }
  async test(raw?: unknown): Promise<void> {
    await this.ready
    const config = raw !== undefined && raw !== null && Object.keys(raw as Record<string, unknown>).length > 0
      ? normalizeConnection(raw, this.registry, this.draftPrevious(raw), true)
      : this.primary()
    if (!config) throw new Error('configure a connection first')
    await this.provider(config).test(AbortSignal.timeout(30_000))
  }
  private provider(config: ExternalConfig): ExternalTaskProvider {
    return this.options.provider?.(config) ?? this.registry.create(config)
  }
  private resolveDraft(raw: unknown): ExternalConfig {
    if (raw !== undefined && raw !== null && typeof raw === 'object'
      && ('provider' in (raw as Record<string, unknown>) || 'baseUrl' in (raw as Record<string, unknown>))) {
      return normalizeConnection(raw, this.registry, this.draftPrevious(raw), true)
    }
    const connectionId = raw && typeof raw === 'object' && typeof (raw as Record<string, unknown>).connectionId === 'string'
      ? (raw as Record<string, string>).connectionId : undefined
    const config = connectionId !== undefined ? this.connection(connectionId) : this.primary()
    if (!config) throw new Error('configure a connection first')
    return config
  }
  async discoverProjects(raw?: unknown) {
    await this.ready
    const config = this.resolveDraft(raw)
    const descriptor = this.registry.get(config.provider).descriptor
    const provider = this.provider(config)
    if (!descriptor.capabilities.projectDiscovery || !provider.listProjects) throw new Error('project discovery is not supported')
    return provider.listProjects(AbortSignal.timeout(30_000))
  }
  async discoverAccount(raw?: unknown) {
    await this.ready
    const config = this.resolveDraft(raw)
    const definition = this.registry.get(config.provider)
    const provider = this.provider(config)
    if (!definition.descriptor.capabilities.accountDiscovery || !provider.getAccount) throw new Error('this provider requires an explicit assignee account')
    return provider.getAccount(AbortSignal.timeout(30_000))
  }
  /**
   * Synchronize one connection, or every enabled connection when no id is
   * given. Multi-connection rounds sum the counters; a single failure is
   * surfaced as an error after the other connections were still processed.
   */
  async sync(connectionId?: string): Promise<SyncResult> {
    await this.ready
    if (this.disposed) throw new Error('sync service stopped')
    if (this.running.size > 0) throw new Error('sync is already running')
    const targets = connectionId !== undefined
      ? [this.connection(connectionId)]
      : this.state.connections.filter(config => config.enabled !== false)
    if (targets.length === 0) throw new Error('configure a connection first')
    const results: SyncResult[] = []
    const failures: string[] = []
    for (const config of targets) {
      if (this.running.size > 0) throw new Error('sync is already running')
      try { results.push(await this.syncOne(config)) } catch (error) {
        failures.push(config.id)
        if (targets.length === 1) throw error
      }
    }
    if (results.length === 0) throw new Error('External sync failed. Check connection, credentials, permissions and server availability.')
    const combined = sumResults(results)
    combined.connections = targets.length
    if (failures.length > 0) combined.failedConnections = failures.length
    return combined
  }
  /**
   * Compute what one round WOULD do without touching the ledger or the remote
   * side. The preview is the required gate before enabling bidirectional sync:
   * it exposes planned imports, adoptions, conflicts and outbound pushes.
   */
  async preview(connectionId?: string): Promise<SyncPreview> {
    await this.ready
    if (this.running.size > 0) throw new Error('sync is already running')
    const config = connectionId !== undefined ? this.connection(connectionId)
      : this.state.connections.find(candidate => candidate.enabled !== false)
    if (!config) throw new Error('configure a connection first')
    if (config.provider === 'zentao' && !config.mappingMode) throw new Error('reassociate projects or executions before previewing')
    const descriptor = this.registry.get(config.provider).descriptor
    const provider = this.provider(config)
    const signal = AbortSignal.timeout(120_000)
    const at = this.now()
    const preview: SyncPreview = {
      connectionId: config.id, provider: config.provider, at, direction: config.direction === 'bidirectional' ? 'bidirectional' : 'inbound',
      inbound: { create: 0, update: 0, unchanged: 0, link: 0, ignore: 0, conflicts: 0, samples: [] },
      outbound: { push: 0, samples: [] },
    }
    let mappings = config.mappings
    if (config.provider === 'zentao' && config.includeUnmapped) {
      if (!provider.listProjects) throw new Error('scope discovery is required for unmapped synchronization')
      const scopes = await provider.listProjects(signal)
      const associated = new Map(config.mappings.filter(m => m.workspaceId).map(m => [m.projectId, m]))
      for (const scope of scopes) {
        if (!new RegExp(`^${config.mappingMode}:\\d+$`).test(scope.id)) throw new Error('provider returned an unexpected mapping scope')
        if (!associated.has(scope.id)) associated.set(scope.id, { projectId: scope.id, workspaceId: '' })
      }
      mappings = [...associated.values()]
    }
    const fetched: Array<{ item: ExternalItem; workspaceId: string }> = []
    for (const mapping of mappings) {
      if (mapping.workspaceId && !this.options.workspaceExists(mapping.workspaceId)) throw new Error('mapped workspace no longer exists')
      const existing = new Map(this.options.store.snapshot().tasks.filter(t => t.external?.connectionId === config.id && t.external.item.projectId === mapping.projectId)
        .map(t => [JSON.stringify([t.external!.item.type, t.external!.item.id]), { item: t.external!.item, metadataOnly: t.trashedAt !== undefined || ['done', 'canceled', 'archived'].includes(t.status) }]))
      for (const item of await provider.getItems(mapping.projectId, signal, { existing })) {
        if (item.projectId !== mapping.projectId || !config.itemTypes.includes(item.type)) throw new Error('provider returned an unexpected scope or work item type')
        const source = normalizeExternalSource({ connectionId: config.id, provider: config.provider, item, syncedAt: at, conflicts: [] })
        if (!source) throw new Error('provider returned an invalid work item')
        fetched.push({ item: source.item, workspaceId: mapping.workspaceId })
      }
    }
    const ledger = this.options.store.snapshot()
    const record = ledger.externalSync?.[config.id]
    const ignored = new Set(record?.ignored ?? [])
    const byKey = new Map(ledger.tasks.filter(task => task.external).map(task => [externalKey(task.external!.connectionId, task.external!.item), task]))
    const seen = new Set<string>()
    const sample = (entry: SyncPreview['inbound']['samples'][number]) => { if (preview.inbound.samples.length < 50) preview.inbound.samples.push(entry) }
    // Fields an inbound merge will leave in conflict: they are never pushed, so
    // the outbound preview must not count them either.
    const conflictedFields = new Map<string, Set<string>>()
    for (const { item: rawItem, workspaceId } of fetched) {
      const item = { ...rawItem, title: normalizeTitle(rawItem.title) }
      const key = externalKey(config.id, item)
      if (seen.has(key)) continue
      seen.add(key)
      const task = byKey.get(key)
      if (ignored.has(key) || task?.trashedAt !== undefined || task?.status === 'archived') {
        preview.inbound.ignore++; sample({ itemId: item.id, title: item.title, action: 'ignore', ...(task === undefined ? {} : { taskId: task.id }) }); continue
      }
      if (task === undefined) {
        const adopted = config.matchExisting ? this.adoptableTask(ledger, item, workspaceId) : undefined
        if (adopted !== undefined && 'ambiguous' in adopted) { preview.inbound.ignore++; sample({ itemId: item.id, title: item.title, action: 'ignore' }); continue }
        if (adopted !== undefined) { preview.inbound.link++; sample({ itemId: item.id, title: item.title, action: 'link', taskId: adopted.card.id }); continue }
        if (item.closed || (config.assigneeFilter === true && !(item.assignees ?? [item.assignedTo]).includes(config.account))) {
          preview.inbound.ignore++; sample({ itemId: item.id, title: item.title, action: 'ignore' }); continue
        }
        preview.inbound.create++; sample({ itemId: item.id, title: item.title, action: 'create' }); continue
      }
      if (task.status === 'done' || task.status === 'canceled') {
        const statusChanged = ['status', 'assignedTo', 'assignees', 'closed', 'revision']
          .some(field => JSON.stringify(task.external!.item[field as keyof ExternalItem]) !== JSON.stringify(item[field as keyof ExternalItem]))
        if (!statusChanged && task.external!.conflicts.length === 0) { preview.inbound.unchanged++; sample({ itemId: item.id, title: item.title, action: 'unchanged', taskId: task.id }); continue }
        preview.inbound.update++; sample({ itemId: item.id, title: item.title, action: 'update', taskId: task.id }); continue
      }
      const merged = mergeExternalFields(task, task.external!, item,
        ['in_progress', 'in_review'].includes(task.status) || task.executions.some(execution => execution.outcome === 'running'),
        adapterFieldAuthorityOf(descriptor))
      const sameItem = ([...new Set([...Object.keys(task.external!.item), ...Object.keys(item)])] as Array<keyof ExternalItem>)
        .every(field => JSON.stringify(task.external!.item[field]) === JSON.stringify(item[field]))
      if (merged.conflicts.length > 0) {
        conflictedFields.set(task.id, new Set(merged.conflicts))
        preview.inbound.conflicts++
        preview.inbound.update++
        sample({ itemId: item.id, title: item.title, action: 'conflict', taskId: task.id, fields: merged.conflicts })
      } else if (sameItem && task.external!.conflicts.length === 0) {
        preview.inbound.unchanged++; sample({ itemId: item.id, title: item.title, action: 'unchanged', taskId: task.id })
      } else {
        preview.inbound.update++; sample({ itemId: item.id, title: item.title, action: 'update', taskId: task.id })
      }
    }
    if (config.direction === 'bidirectional') {
      for (const task of ledger.tasks) {
        if (task.external?.connectionId !== config.id || task.trashedAt !== undefined || task.status === 'archived') continue
        const plan = this.planPush(task, config)
        if (plan === undefined) continue
        const blocked = conflictedFields.get(task.id)
        const fields = blocked === undefined ? plan.fields
          : plan.fields.filter(field => field === 'state' || !blocked.has(field))
        if (fields.length === 0) continue
        preview.outbound.push++
        if (preview.outbound.samples.length < 50) preview.outbound.samples.push({ taskId: task.id, fields })
      }
    }
    return preview
  }
  private async syncOne(config: ExternalConfig): Promise<SyncResult> {
    if (this.disposed) throw new Error('sync service stopped')
    if (config.provider === 'zentao' && !config.mappingMode) throw new Error('reassociate projects or executions before synchronizing')
    this.running.add(config.id)
    this.lastAttempts.set(config.id, this.now())
    const attemptsAt = this.now()
    const controller = new AbortController()
    this.controllers.set(config.id, controller)
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(300_000)])
    const result: SyncResult = { created: 0, updated: 0, unchanged: 0, conflicts: 0, ignored: 0, at: this.now(), linked: 0, ambiguous: 0 }
    let committed = false
    try {
      await this.options.store.load()
      const provider = this.provider(config)
      const descriptor = this.registry.get(config.provider).descriptor
      let mappings = config.mappings
      if (config.provider === 'zentao' && config.includeUnmapped) {
        if (!provider.listProjects) throw new Error('scope discovery is required for unmapped synchronization')
        const scopes = await provider.listProjects(signal)
        const associated = new Map(config.mappings.filter(m => m.workspaceId).map(m => [m.projectId, m]))
        for (const scope of scopes) {
          if (!new RegExp(`^${config.mappingMode}:\\d+$`).test(scope.id)) throw new Error('provider returned an unexpected mapping scope')
          if (!associated.has(scope.id)) associated.set(scope.id, { projectId: scope.id, workspaceId: '' })
        }
        mappings = [...associated.values()]
      }
      // Finish all pages before committing: a failed scan never infers deletion or advances state.
      const items: Array<{ item: ExternalItem; workspaceId: string }> = []
      for (const mapping of mappings) {
        if (mapping.workspaceId && !this.options.workspaceExists(mapping.workspaceId)) throw new Error('mapped workspace no longer exists')
        const existing = new Map(this.options.store.snapshot().tasks.filter(t => t.external?.connectionId === config.id && t.external.item.projectId === mapping.projectId)
          .map(t => [JSON.stringify([t.external!.item.type, t.external!.item.id]), { item: t.external!.item, metadataOnly: t.trashedAt !== undefined || ['done', 'canceled', 'archived'].includes(t.status) }]))
        for (const item of await provider.getItems(mapping.projectId, signal, { existing })) {
          if (item.projectId !== mapping.projectId || !config.itemTypes.includes(item.type)) throw new Error('provider returned an unexpected scope or work item type')
          const source = normalizeExternalSource({ connectionId: config.id, provider: config.provider, item, syncedAt: result.at, conflicts: [] })
          if (!source) throw new Error('provider returned an invalid work item')
          items.push({ item: source.item, workspaceId: mapping.workspaceId })
        }
      }
      signal.throwIfAborted()
      await this.serial(async () => {
        signal.throwIfAborted()
        await this.options.store.mutate('external-sync-updated', ledger => {
          signal.throwIfAborted()
          const record = this.record(ledger, config.id)
          const ignored = new Set(record.ignored)
          const links = { ...record.links }
          const changed: TaskRecord[] = []
          const byKey = new Map(ledger.tasks.filter(t => t.external).map(t => [externalKey(t.external!.connectionId, t.external!.item), t]))
          const seen = new Set<string>()
          for (const { item: rawItem, workspaceId } of items) {
            const item = { ...rawItem, title: normalizeTitle(rawItem.title) }
            const key = externalKey(config.id, item)
            if (seen.has(key)) continue
            seen.add(key)
            const task = byKey.get(key)
            if (task) links[key] = task.id
            if (!task && links[key]) ignored.add(key)
            if (task?.trashedAt !== undefined) { ignored.add(key); result.ignored++; continue }
            if (ignored.has(key)) { result.ignored++; continue }
            if (task?.status === 'archived') { result.unchanged++; continue }
            const source: ExternalSource = { connectionId: config.id, provider: config.provider, providerName: descriptor.name, item, syncedAt: result.at, conflicts: [] }
            if (!task) {
              // Opt-in dedupe: a card the user already created for this item is
              // adopted instead of duplicating it. Adoption happens before the
              // import filters on purpose — the card exists regardless of who
              // the remote item is assigned to.
              const adopted = config.matchExisting ? this.adoptableTask(ledger, item, workspaceId) : undefined
              if (adopted !== undefined && 'ambiguous' in adopted) { result.ambiguous = (result.ambiguous ?? 0) + 1; continue }
              if (adopted !== undefined) {
                const card = adopted.card
                card.external = { ...source, pushBase: this.localPushBase(card) }
                card.externalRefs = upsertExternalReference(card.externalRefs, externalReferenceOf(card.external))
                card.version++; card.updatedAt = result.at; card.updatedBy = { kind: 'user' }
                changed.push(card); byKey.set(key, card); links[key] = card.id
                result.linked = (result.linked ?? 0) + 1
                continue
              }
              if (item.closed || (config.assigneeFilter === true && !(item.assignees ?? [item.assignedTo]).includes(config.account))) continue
              const created: TaskRecord = { id: newTaskId(), title: item.title, description: item.description, urgency: item.urgency,
                workspaceId, prompt: '', status: config.importStatus ?? 'backlog', blocked: false, execution: { mode: 'claim' },
                isolation: defaultIsolationOf(ledger.settings), permission: defaultPermissionOf(ledger.settings),
                model: ledger.settings?.defaultModel, presetId: ledger.settings?.defaultPresetId,
                version: 1, createdAt: result.at, updatedAt: result.at, createdBy: { kind: 'user' }, updatedBy: { kind: 'user' },
                comments: [], executions: [], external: { ...source, pushBase: { title: item.title, description: item.description, status: config.importStatus ?? 'backlog' } },
                externalRefs: [externalReferenceOf({ ...source })] }
              ledger.tasks.push(created); changed.push(created); byKey.set(key, created); links[key] = created.id; result.created++
            } else {
              links[key] = task.id
              const workspaceChanged = config.provider === 'zentao' && task.workspaceId === '' && workspaceId !== ''
              if (workspaceChanged) task.workspaceId = workspaceId
              if (task.status === 'done' || task.status === 'canceled') {
                const old = task.external!.item
                const statusChanged = ['status', 'assignedTo', 'assignees', 'closed', 'revision'].some(field => JSON.stringify(old[field as keyof ExternalItem]) !== JSON.stringify(item[field as keyof ExternalItem]))
                if (!workspaceChanged && !statusChanged && !task.external!.conflicts.length) { result.unchanged++; continue }
                task.external = { ...task.external!, item: { ...old, status: item.status, assignedTo: item.assignedTo, closed: item.closed,
                  ...(item.assignees !== undefined ? { assignees: item.assignees } : {}), ...(item.revision !== undefined ? { revision: item.revision } : {}) },
                  conflicts: [], syncedAt: result.at,
                  pushBase: task.external!.pushBase ?? { title: old.title, description: old.description, status: task.status } }
                if (item.assignees === undefined) delete task.external.item.assignees
                task.externalRefs = upsertExternalReference(task.externalRefs, externalReferenceOf(task.external))
                task.version++; task.updatedAt = result.at
                changed.push(task); result.updated++
                continue
              }
              const merged = mergeExternalFields(task, task.external!, item,
                ['in_progress', 'in_review'].includes(task.status) || task.executions.some(e => e.outcome === 'running'),
                adapterFieldAuthorityOf(descriptor))
              source.conflicts = merged.conflicts
              const previous = task.external!.item
              const baseline = task.external!.pushBase ?? { title: previous.title, description: previous.description, status: task.status }
              // A field adopted FROM the remote advances the push baseline too:
              // otherwise the very next push phase would send the remote wording
              // straight back as if it were a local edit.
              source.pushBase = {
                ...baseline,
                ...(merged.fields.title !== previous.title && !merged.conflicts.includes('title') ? { title: merged.fields.title } : {}),
                ...(merged.fields.description !== previous.description && !merged.conflicts.includes('description') ? { description: merged.fields.description } : {}),
              }
              const sameItem = ([...new Set([...Object.keys(previous), ...Object.keys(item)])] as Array<keyof ExternalItem>).every(field => JSON.stringify(previous[field]) === JSON.stringify(item[field]))
              if (!workspaceChanged && sameItem && JSON.stringify(task.external!.conflicts) === JSON.stringify(source.conflicts)) { result.unchanged++; continue }
              Object.assign(task, merged.fields)
              task.external = source
              task.externalRefs = upsertExternalReference(task.externalRefs, externalReferenceOf(source, source.conflicts.length > 0 ? 'conflict' : 'linked'))
              task.version++; task.updatedAt = result.at
              changed.push(task); result.updated++
              if (source.conflicts.length) result.conflicts++
            }
          }
          record.ignored = [...ignored]; record.links = links; record.lastResult = result
          record.lastAttemptAt = attemptsAt; delete record.lastError
          return changed
        })
        committed = true
        this.volatileErrors.delete(config.id)
      })
      // Opt-in outbound phase: BOTH the stored direction and the adapter
      // capability must authorize it. It runs only after the inbound merge
      // committed, so `task.external.item` is the freshest remote base.
      if (config.direction === 'bidirectional' && adapterDirectionsOf(descriptor).includes('outbound')
        && descriptor.capabilities.write === true) {
        result.pushed = 0
        result.pushFailed = 0
        await this.pushLinked(config, signal, result)
        await this.recordResult(config, result)
      }
      return result
    } catch (error) {
      // Never expose server bodies or request URLs (which may contain credentials).
      const message = committed ? 'Tasks were updated, but sync completion reporting failed.' : 'External sync failed. Check connection, credentials, permissions and server availability.'
      this.volatileErrors.set(config.id, message)
      try {
        await this.serial(async () => this.options.store.mutate('external-sync-updated', ledger => {
          const record = this.record(ledger, config.id)
          record.lastAttemptAt = attemptsAt; record.lastError = message
          return []
        }))
      } catch { this.volatileErrors.set(config.id, `${message} Sync status could not be saved.`) }
      throw new Error(this.volatileErrors.get(config.id) ?? message, { cause: error })
    } finally {
      this.running.delete(config.id)
      this.controllers.delete(config.id)
    }
  }
  /** Fail closed: write-back requires both the descriptor flag and the methods. */
  private writeProvider(config: ExternalConfig): ExternalWriteProvider {
    const descriptor = this.registry.get(config.provider).descriptor
    if (adapterDirectionsOf(descriptor).includes('outbound') === false || descriptor.capabilities.write !== true) {
      throw new Error('this provider does not support write-back')
    }
    const provider = this.provider(config) as Partial<ExternalWriteProvider>
    if (typeof provider.createItem !== 'function' || typeof provider.updateItem !== 'function') throw new Error('provider write-back is unavailable')
    return provider as ExternalWriteProvider
  }
  private localPushBase(task: TaskRecord): ExternalPushBase {
    return { title: task.title, description: task.description, status: task.status }
  }
  /** Existing unlinked cards in the mapped project that already name this item. */
  private adoptableTask(ledger: TaskLedger, item: ExternalItem, workspaceId: string): { card: TaskRecord } | { ambiguous: true } | undefined {
    const candidates: Array<{ card: TaskRecord; score: number }> = []
    for (const card of ledger.tasks) {
      // A trashed, archived or already-linked card is never re-adopted.
      if (card.external !== undefined || card.trashedAt !== undefined || card.status === 'archived') continue
      if (card.workspaceId !== workspaceId) continue
      const score = externalMatchScore(card, item.id, item.title)
      if (score !== undefined) candidates.push({ card, score })
    }
    return bestExternalMatch(candidates)
  }
  /** Push baseline after this round: only pushed fields advance. */
  private nextPushBase(task: TaskRecord, fields: readonly ExternalPushField[]): ExternalPushBase {
    const source = task.external!
    const previous = source.pushBase ?? { title: source.item.title, description: source.item.description, status: task.status }
    return {
      title: fields.includes('title') ? task.title : previous.title,
      description: fields.includes('description') ? task.description : previous.description,
      status: fields.includes('state') ? task.status : previous.status,
    }
  }
  /**
   * Compare a card with what was last pushed (never with the last seen remote
   * state: an inbound merge must not mask a local edit, and an adopted card
   * must not push its pre-link wording back). Conflicts are never overwritten,
   * running executions are never raced, and reopening stays a remote action.
   */
  private planPush(task: TaskRecord, config: ExternalConfig): { patch: ExternalPushPatch; fields: ExternalPushField[] } | undefined {
    const source = task.external
    if (source === undefined) return undefined
    if (config.direction !== 'bidirectional') return undefined
    if (task.executions.some(execution => execution.outcome === 'running')) return undefined
    const conflicts = new Set(source.conflicts)
    const base = source.pushBase
    const patch: ExternalPushPatch = {}
    const fields: ExternalPushField[] = []
    if (task.title !== (base?.title ?? source.item.title) && !conflicts.has('title')) { patch.title = task.title; fields.push('title') }
    if (task.description !== (base?.description ?? source.item.description) && !conflicts.has('description')) { patch.description = task.description; fields.push('description') }
    // Legacy sources (no push baseline) keep the pre-dedupe close rule.
    const statusChanged = base === undefined || base.status !== task.status
    if ((task.status === 'done' || task.status === 'canceled') && statusChanged && !source.item.closed) {
      patch.close = task.status === 'canceled' ? 'not_planned' : 'completed'
      fields.push('state')
    }
    return fields.length === 0 ? undefined : { patch, fields }
  }
  private async pushLinked(config: ExternalConfig, signal: AbortSignal, result: SyncResult): Promise<void> {
    const write = this.writeProvider(config)
    const pending = this.options.store.snapshot().tasks.filter(task =>
      task.external?.connectionId === config.id && task.trashedAt === undefined && task.status !== 'archived')
    const completed: Array<{ id: string; version: number; source: ExternalSource }> = []
    for (const task of pending) {
      signal.throwIfAborted()
      const plan = this.planPush(task, config)
      if (plan === undefined) continue
      try {
        const item = await write.updateItem(task.external!.item.projectId, task.external!.item.type, task.external!.item.id, plan.patch, signal)
        const source = normalizeExternalSource({ connectionId: config.id, provider: config.provider,
          providerName: this.registry.get(config.provider).descriptor.name, item, syncedAt: this.now(), conflicts: task.external!.conflicts })
        if (source === undefined) throw new Error('provider returned an invalid work item')
        completed.push({ id: task.id, version: task.version, source: { ...source, pushBase: this.nextPushBase(task, plan.fields) } })
        result.pushed = (result.pushed ?? 0) + 1
      } catch {
        if (signal.aborted) throw new Error('request aborted')
        result.pushFailed = (result.pushFailed ?? 0) + 1
      }
    }
    if (completed.length === 0) return
    await this.serial(async () => {
      await this.options.store.mutate('task-updated', ledger => {
        const changed: TaskRecord[] = []
        for (const entry of completed) {
          const task = ledger.tasks.find(candidate => candidate.id === entry.id)
          // A card edited while its push was in flight keeps the newer local edits.
          if (task === undefined || task.trashedAt !== undefined || task.version !== entry.version) continue
          task.external = entry.source
          task.externalRefs = upsertExternalReference(task.externalRefs, externalReferenceOf(entry.source))
          task.version++; task.updatedAt = this.now(); task.updatedBy = { kind: 'user' }
          changed.push(task)
        }
        return changed
      })
    })
  }
  private async recordResult(config: ExternalConfig, result: SyncResult): Promise<void> {
    await this.serial(async () => this.options.store.mutate('external-sync-updated', ledger => {
      const record = this.record(ledger, config.id)
      record.lastResult = result; record.lastAttemptAt = this.lastAttempts.get(config.id); delete record.lastError
      return []
    }))
  }
  private mappingFor(config: ExternalConfig, workspaceId: string, scope?: string): { projectId: string; workspaceId: string } {
    const candidates = config.mappings.filter(mapping => mapping.workspaceId === workspaceId && (scope === undefined || mapping.projectId === scope))
    if (scope !== undefined && candidates.length === 0) throw new Error('the chosen scope is not mapped to this project')
    if (candidates.length === 0) throw new Error('this project has no mapped external scope; configure a mapping first')
    if (candidates.length > 1) throw new Error('multiple external scopes are mapped to this project; pass a scope')
    return candidates[0]!
  }
  /** Push one card (or create and link a remote item for an unlinked card). */
  async pushTask(taskId: string, scope?: string, connectionId?: string): Promise<ExternalPushOutcome> {
    await this.ready
    if (this.disposed) throw new Error('sync service stopped')
    if (this.running.size > 0) throw new Error('sync is already running')
    const snapshotTask = this.options.store.snapshot().tasks.find(candidate => candidate.id === taskId)
    const linkedConnection = snapshotTask?.external?.connectionId
    const config = linkedConnection !== undefined ? this.connection(linkedConnection)
      : connectionId !== undefined ? this.connection(connectionId) : this.primary()
    if (!config) throw new Error('configure a connection first')
    const descriptor = this.registry.get(config.provider).descriptor
    if (!adapterDirectionsOf(descriptor).includes('outbound') || descriptor.capabilities.write !== true) throw new Error('this provider does not support write-back')
    if (config.direction !== 'bidirectional') throw new Error('enable bidirectional sync for this connection before pushing')
    const write = this.writeProvider(config)
    if (snapshotTask === undefined || snapshotTask.trashedAt !== undefined) throw new Error('task not found')
    const signal = AbortSignal.timeout(120_000)
    this.running.add(config.id)
    try {
      const snapshot = this.options.store.snapshot()
      const task = snapshot.tasks.find(candidate => candidate.id === taskId)
      if (task === undefined || task.trashedAt !== undefined) throw new Error('task not found')
      if (task.external !== undefined) {
        if (task.external.connectionId !== config.id) throw new Error('task is linked to another external connection')
        const plan = this.planPush(task, config)
        if (plan === undefined) return { created: false, pushed: [], item: task.external.item }
        const item = await write.updateItem(task.external.item.projectId, task.external.item.type, task.external.item.id, plan.patch, signal)
        const source = normalizeExternalSource({ connectionId: config.id, provider: config.provider,
          providerName: this.registry.get(config.provider).descriptor.name, item, syncedAt: this.now(), conflicts: task.external.conflicts })
        if (source === undefined) throw new Error('provider returned an invalid work item')
        await this.serial(async () => this.options.store.mutate('task-updated', ledger => {
          const current = ledger.tasks.find(candidate => candidate.id === task.id)
          if (current === undefined || current.trashedAt !== undefined) throw new Error('task not found')
          current.external = { ...source, pushBase: this.nextPushBase(task, plan.fields) }
          current.externalRefs = upsertExternalReference(current.externalRefs, externalReferenceOf(current.external))
          current.version++; current.updatedAt = this.now(); current.updatedBy = { kind: 'user' }
          return [current]
        }))
        return { created: false, pushed: plan.fields, item }
      }
      const mapping = this.mappingFor(config, task.workspaceId, scope)
      let item = await write.createItem(mapping.projectId, { title: task.title, description: task.description, urgency: task.urgency }, signal)
      const close = task.status === 'done' || task.status === 'canceled'
      if (close) item = await write.updateItem(item.projectId, item.type, item.id, { close: task.status === 'canceled' ? 'not_planned' : 'completed' }, signal)
      const source = normalizeExternalSource({ connectionId: config.id, provider: config.provider,
        providerName: this.registry.get(config.provider).descriptor.name, item, syncedAt: this.now(), conflicts: [] })
      if (source === undefined) throw new Error('provider returned an invalid work item')
      await this.serial(async () => this.options.store.mutate('task-updated', ledger => {
        const current = ledger.tasks.find(candidate => candidate.id === task.id)
        if (current === undefined || current.trashedAt !== undefined) throw new Error('task not found')
        if (current.external !== undefined) throw new Error('task was linked by another sync; refresh and retry')
        const key = externalKey(config.id, source.item)
        const record = this.record(ledger, config.id)
        record.links[key] = current.id
        record.ignored = record.ignored.filter(entry => entry !== key)
        current.external = { ...source, pushBase: { title: item.title, description: item.description, status: task.status } }
        current.externalRefs = upsertExternalReference(current.externalRefs, { ...externalReferenceOf(current.external), provenance: 'created' })
        current.version++; current.updatedAt = this.now(); current.updatedBy = { kind: 'user' }
        return [current]
      }))
      return { created: true, pushed: ['title', 'description', ...(close ? ['state' as const] : [])], item }
    } finally { this.running.delete(config.id) }
  }
}

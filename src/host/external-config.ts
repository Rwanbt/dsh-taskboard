import {
  ADAPTER_CONTRACT_VERSION,
  EXTERNAL_SYNC_FIELDS,
  adapterDirectionsOf,
  adapterSupports,
  type ExternalConfig,
  type ExternalField,
} from '../shared/external.ts'
import { newTaskId } from '../shared/protocol.ts'
import type { ExternalProviderRegistry } from './external-provider.ts'

/** Fields an inbound v1 connection may synchronize. */
const SYNC_FIELD_SET = new Set<ExternalField>(EXTERNAL_SYNC_FIELDS)

/** Platform-neutral validation; each registered provider validates its own scope/options. */
export function normalizeConnection(raw: unknown, registry: ExternalProviderRegistry, previous?: ExternalConfig, allowEmptyMappings = false, allowLegacyMappings = false): ExternalConfig {
  if (!raw || typeof raw !== 'object') throw new Error('invalid external connection')
  const e = raw as Record<string, unknown>
  const provider = typeof e.provider === 'string' ? e.provider : previous?.provider ?? 'zentao'
  const definition = registry.get(provider)
  const descriptor = definition.descriptor
  const mappingMode = provider === 'zentao' ? e.mappingMode : undefined
  if (provider === 'zentao' && e.includeUnmapped !== undefined && typeof e.includeUnmapped !== 'boolean') throw new Error('invalid unmapped sync setting')
  const includeUnmapped = provider === 'zentao' && e.includeUnmapped === true
  const authMode = typeof e.authMode === 'string' ? e.authMode : descriptor.authModes[0]!.id
  const mode = descriptor.authModes.find(m => m.id === authMode)
  if (!mode) throw new Error('unsupported authentication mode')
  const baseUrl = new URL(String(e.baseUrl ?? descriptor.defaultBaseUrl))
  if (!['http:', 'https:'].includes(baseUrl.protocol) || baseUrl.username || baseUrl.password || baseUrl.search || baseUrl.hash) throw new Error('invalid server URL')
  const url = baseUrl.href.replace(/\/$/, '')
  const account = typeof e.account === 'string' ? e.account.trim() : ''
  if (!account) throw new Error('sync account is required')
  const sameSource = previous?.provider === provider && previous.baseUrl === url && previous.account === account
  const sameIdentity = sameSource && previous.authMode === authMode
  const incoming = e.credentials && typeof e.credentials === 'object' && !Array.isArray(e.credentials) ? e.credentials as Record<string, unknown> : {}
  const credentials: Record<string, string> = {}
  for (const field of mode.fields) {
    const value = incoming[field.key]
    if (value !== undefined && typeof value !== 'string') throw new Error('invalid credential value')
    const credential = typeof value === 'string' && value.length ? value : sameIdentity ? previous!.credentials[field.key] : ''
    if (!credential) throw new Error('enter credentials for this server/account/authentication mode')
    credentials[field.key] = credential
  }
  if (provider === 'zentao' && mappingMode !== 'project' && mappingMode !== 'execution'
    && !(allowLegacyMappings && mappingMode === undefined)) throw new Error('select a project or execution mapping mode')
  if (!Array.isArray(e.mappings)) throw new Error('at least one project mapping is required')
  const mappings = e.mappings.filter((r: unknown) => provider !== 'zentao' || includeUnmapped || !r || typeof r !== 'object' || (r as Record<string, unknown>).workspaceId !== '').map((r: unknown) => {
    if (!r || typeof r !== 'object') throw new Error('invalid mapping')
    const m = r as Record<string, unknown>
    if (typeof m.projectId !== 'string' || !m.projectId.trim() || typeof m.workspaceId !== 'string' || (!m.workspaceId && !includeUnmapped)) throw new Error('invalid mapping')
    return { projectId: m.projectId.trim(), workspaceId: m.workspaceId }
  })
  if (!allowEmptyMappings && provider !== 'zentao' && !mappings.length) throw new Error('at least one project mapping is required')
  if (new Set(mappings.map(m => m.projectId)).size !== mappings.length) throw new Error('duplicate project mapping')
  const intervalMinutes = Number(e.intervalMinutes ?? 0)
  const importStatus = e.importStatus ?? 'backlog'
  if (importStatus !== 'backlog' && importStatus !== 'todo') throw new Error('import status must be backlog or todo')
  if (!Number.isInteger(intervalMinutes) || (intervalMinutes !== 0 && (intervalMinutes < 5 || intervalMinutes > 1440))) throw new Error('sync interval must be 0 or 5–1440 minutes')
  const since = String(e.since ?? '')
  if (since && (!/^\d{4}-\d{2}-\d{2}$/.test(since) || !Number.isFinite(Date.parse(since)) || new Date(since).toISOString().slice(0, 10) !== since)) throw new Error('invalid start date')
  const itemTypes: string[] = e.itemTypes === undefined ? [descriptor.capabilities.itemTypes[0]!] : Array.isArray(e.itemTypes) ? e.itemTypes : []
  if (!itemTypes.length || itemTypes.some(type => !descriptor.capabilities.itemTypes.includes(type))) throw new Error('unsupported or empty work item types')
  const assigneeFilter = e.assigneeFilter === undefined ? true : e.assigneeFilter
  if (typeof assigneeFilter !== 'boolean') throw new Error('invalid assignee filter setting')
  if (e.matchExisting !== undefined && typeof e.matchExisting !== 'boolean') throw new Error('invalid dedupe setting')
  // Adopting existing cards is opt-in per provider: only providers that can
  // recognize their own references in card text may enable it.
  const matchExisting = descriptor.capabilities.dedupe === true && e.matchExisting !== false
  const rawSettings = e.settings && typeof e.settings === 'object' ? e.settings as Record<string, unknown> : {}
  const settings: Record<string, string> = {}
  for (const field of descriptor.settingsFields ?? []) {
    const value = rawSettings[field.key] ?? field.defaultValue
    if (typeof value !== 'string') throw new Error('invalid provider setting')
    settings[field.key] = value.trim()
  }
  // Contract v1: outbound writes require an explicit `bidirectional` direction.
  // Omitting it on a fresh or legacy connection keeps the connection read-only,
  // even for adapters that implement write operations.
  const sameProviderPrevious = previous?.provider === provider
  const directionRaw = e.direction ?? (sameProviderPrevious ? previous.direction : undefined) ?? 'inbound'
  if (directionRaw !== 'inbound' && directionRaw !== 'bidirectional') throw new Error('invalid sync direction')
  const direction = directionRaw
  if (direction === 'bidirectional') {
    if (!adapterDirectionsOf(descriptor).includes('outbound')
      || !adapterSupports(descriptor, 'createWorkItem') || !adapterSupports(descriptor, 'updateWorkItem')) {
      throw new Error('this provider does not support write-back')
    }
  }
  const previousFields = sameProviderPrevious ? previous.syncFields : undefined
  const rawFields = e.syncFields ?? previousFields
  const syncFields: ExternalField[] = rawFields === undefined
    ? ['title', 'description', 'urgency', 'status']
    : Array.isArray(rawFields) ? [...new Set(rawFields)] as ExternalField[] : []
  if (!syncFields.length || syncFields.some(field => !SYNC_FIELD_SET.has(field))) throw new Error('invalid synchronized field list')
  const conflictPolicy = e.conflictPolicy ?? (sameProviderPrevious ? previous.conflictPolicy : undefined) ?? 'manual'
  if (conflictPolicy !== 'manual') throw new Error('unsupported conflict policy')
  const enabledRaw = e.enabled ?? previous?.enabled ?? true
  if (typeof enabledRaw !== 'boolean') throw new Error('invalid enabled flag')
  const labelRaw = e.label ?? previous?.label
  if (labelRaw !== undefined && (typeof labelRaw !== 'string' || labelRaw.length > 120)) throw new Error('invalid connection label')
  const label = typeof labelRaw === 'string' ? labelRaw.trim() || undefined : undefined
  const config: ExternalConfig = { id: sameSource ? previous!.id : newTaskId(), provider, baseUrl: url, account, authMode,
    credentials, itemTypes: [...new Set(itemTypes)], settings, mappings, intervalMinutes, since, importStatus, assigneeFilter, matchExisting,
    direction, syncFields, conflictPolicy, enabled: enabledRaw, ...(label !== undefined ? { label } : {}),
    ...(mappingMode === 'project' || mappingMode === 'execution' ? { mappingMode, includeUnmapped } : {}) }
  // Contract version belongs to the adapter registry, not to imported data.
  if (definition.descriptor.contractVersion !== undefined && definition.descriptor.contractVersion !== ADAPTER_CONTRACT_VERSION) {
    throw new Error('unsupported external adapter contract version')
  }
  definition.validate?.(config)
  return config
}

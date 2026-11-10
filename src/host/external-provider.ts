import {
  ADAPTER_CONTRACT_VERSION,
  ADAPTER_OPERATIONS,
  adapterDirectionsOf,
  adapterOperationsOf,
  adapterSupports,
  type AdapterOperation,
  type ExternalAccount,
  type ExternalConfig,
  type ExternalFields,
  type ExternalItem,
  type ExternalProject,
  type ExternalPushPatch,
  type ProviderDescriptor,
} from '../shared/external.ts'

/** A remote comment, normalized for the public contract. */
export type ExternalComment = { id: string; body: string; author: string; createdAt?: number; url?: string }
/** One normalized remote change, used by adapters that can stream/poll incrementally. */
export type ExternalChange = { type: 'created' | 'updated' | 'deleted'; item: ExternalItem }
/** Providers own transport, platform authentication and normalization, never TaskStore writes. */
export type ExternalReadContext = { existing: ReadonlyMap<string, { item: ExternalItem; metadataOnly: boolean }> }
export interface ExternalTaskProvider {
  /** Contract op `validateConnection`. */
  test(signal: AbortSignal): Promise<void>
  /** Contract op `listWorkItems`. */
  getItems(projectId: string, signal: AbortSignal, context?: ExternalReadContext): Promise<ExternalItem[]>
  /** Contract op `getWorkItem`. */
  getItem?(projectId: string, type: string, id: string, signal: AbortSignal): Promise<ExternalItem | undefined>
  /** Contract op `discoverProjects`. */
  listProjects?(signal: AbortSignal): Promise<ExternalProject[]>
  /** Optional account discovery (GitHub-style /user). */
  getAccount?(signal: AbortSignal): Promise<ExternalAccount>
  /** Contract op `transitionWorkItem` (status change through a workflow). */
  transitionItem?(projectId: string, type: string, id: string, status: string, signal: AbortSignal): Promise<ExternalItem>
  /** Contract op `listComments`. */
  listComments?(projectId: string, type: string, id: string, signal: AbortSignal): Promise<ExternalComment[]>
  /** Contract op `addComment`. */
  addComment?(projectId: string, type: string, id: string, body: string, signal: AbortSignal): Promise<ExternalComment>
  /** Contract op `syncChanges`: incremental pull; absent means full listing only. */
  syncChanges?(projectId: string, signal: AbortSignal, cursor?: string): Promise<{ items: ExternalChange[]; cursor?: string }>
}
/** Opt-in write-back surface (`capabilities.write`). Read-only providers never implement it. */
export interface ExternalWriteProvider {
  /** Contract op `createWorkItem`. */
  createItem(projectId: string, fields: ExternalFields, signal: AbortSignal): Promise<ExternalItem>
  /** Contract op `updateWorkItem`. */
  updateItem(projectId: string, type: string, id: string, patch: ExternalPushPatch, signal: AbortSignal): Promise<ExternalItem>
}
export type ProviderDefinition = {
  descriptor: ProviderDescriptor
  create: (config: ExternalConfig) => ExternalTaskProvider
  validate?: (config: ExternalConfig) => void
}

/** Which provider method implements each declared operation (`getCapabilities` is registry-level). */
const OPERATION_METHODS: Partial<Record<AdapterOperation, keyof ExternalTaskProvider | keyof ExternalWriteProvider>> = {
  validateConnection: 'test',
  discoverProjects: 'listProjects',
  listWorkItems: 'getItems',
  getWorkItem: 'getItem',
  createWorkItem: 'createItem',
  updateWorkItem: 'updateItem',
  transitionWorkItem: 'transitionItem',
  listComments: 'listComments',
  addComment: 'addComment',
  syncChanges: 'syncChanges',
}

/**
 * Verify, at creation time, that every declared operation is actually
 * implemented and that no write surface is exposed without being declared.
 * A capability can therefore never be simulated by a descriptor alone.
 */
export function assertProviderContract(descriptor: ProviderDescriptor, provider: ExternalTaskProvider): void {
  const version = descriptor.contractVersion ?? ADAPTER_CONTRACT_VERSION
  if (version !== ADAPTER_CONTRACT_VERSION) throw new Error('unsupported external adapter contract version')
  const declared = adapterOperationsOf(descriptor)
  for (const operation of declared) {
    if (!ADAPTER_OPERATIONS.includes(operation)) throw new Error('adapter declares an unknown operation')
    const method = OPERATION_METHODS[operation]
    if (method !== undefined && typeof (provider as unknown as Record<string, unknown>)[method] !== 'function') {
      throw new Error(`adapter declares ${operation} but does not implement it`)
    }
  }
  const write = provider as Partial<ExternalWriteProvider>
  const implementsWrite = typeof write.createItem === 'function' || typeof write.updateItem === 'function'
  if (implementsWrite && (!adapterSupports(descriptor, 'createWorkItem') || !adapterSupports(descriptor, 'updateWorkItem'))) {
    throw new Error('adapter implements write-back without declaring it')
  }
  const outbound = adapterDirectionsOf(descriptor).includes('outbound')
  if (outbound && (!adapterSupports(descriptor, 'createWorkItem') || !adapterSupports(descriptor, 'updateWorkItem'))) {
    throw new Error('adapter declares outbound sync without write operations')
  }
  if (!adapterSupports(descriptor, 'listWorkItems')) throw new Error('adapter must declare listWorkItems')
}

/** Registration is explicit and rejects ambiguous IDs. No platform switches in the sync engine. */
export class ExternalProviderRegistry {
  private readonly definitions = new Map<string, ProviderDefinition>()
  register(definition: ProviderDefinition): this {
    const { descriptor } = definition
    if (!/^[a-z][a-z0-9-]*$/.test(descriptor.id) || this.definitions.has(descriptor.id)) throw new Error('invalid or duplicate provider ID')
    if (!descriptor.authModes.length || !descriptor.capabilities.itemTypes.length) throw new Error('provider must declare authentication and item types')
    const version = descriptor.contractVersion ?? ADAPTER_CONTRACT_VERSION
    if (version !== ADAPTER_CONTRACT_VERSION) throw new Error('unsupported external adapter contract version')
    const operations = adapterOperationsOf(descriptor)
    if (operations.some(operation => !ADAPTER_OPERATIONS.includes(operation))) throw new Error('provider declares an unknown operation')
    if (new Set(operations).size !== operations.length) throw new Error('provider declares duplicate operations')
    this.definitions.set(descriptor.id, { ...definition, descriptor: structuredClone(descriptor) })
    return this
  }
  get(id: string): ProviderDefinition {
    const definition = this.definitions.get(id)
    if (!definition) throw new Error('unsupported external provider')
    return definition
  }
  list(): ProviderDescriptor[] { return [...this.definitions.values()].map(d => structuredClone(d.descriptor)) }
  create(config: ExternalConfig): ExternalTaskProvider {
    const definition = this.get(config.provider)
    definition.validate?.(config)
    const provider = definition.create(config)
    assertProviderContract(definition.descriptor, provider)
    return provider
  }
}

/** Stable capability document for one provider (public API / UI compatibility view). */
export function adapterCapabilitiesOf(descriptor: ProviderDescriptor): {
  contractVersion: number; kind: string; operations: AdapterOperation[]; directions: string[]
  itemTypes: string[]; write: boolean; events: string; limits?: ProviderDescriptor['capabilities']['limits']
  fieldAuthority: ReturnType<typeof adapterFieldAuthorityView>
} {
  return {
    contractVersion: descriptor.contractVersion ?? ADAPTER_CONTRACT_VERSION,
    kind: descriptor.kind ?? 'tracker',
    operations: adapterOperationsOf(descriptor),
    directions: adapterDirectionsOf(descriptor),
    itemTypes: [...descriptor.capabilities.itemTypes],
    write: adapterDirectionsOf(descriptor).includes('outbound'),
    events: descriptor.capabilities.events ?? 'none',
    ...(descriptor.capabilities.limits === undefined ? {} : { limits: structuredClone(descriptor.capabilities.limits) }),
    fieldAuthority: adapterFieldAuthorityView(descriptor),
  }
}

function adapterFieldAuthorityView(descriptor: ProviderDescriptor): Record<string, string> {
  const declared = descriptor.capabilities.fieldAuthority ?? {}
  return {
    title: declared.title ?? 'merge',
    description: declared.description ?? 'merge',
    urgency: declared.urgency ?? 'merge',
    status: declared.status ?? 'local',
    assignees: declared.assignees ?? 'local',
  }
}

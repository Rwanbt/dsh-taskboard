import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  ADAPTER_CONTRACT_VERSION, adapterDirectionsOf, adapterFieldAuthorityOf, adapterOperationsOf, adapterSupports,
  externalReferenceOf, mergeExternalFields, normalizeExternalReferences, upsertExternalReference,
  type ExternalItem, type ExternalSource, type ProviderDescriptor,
} from '../src/shared/external.ts'
import { createBuiltinProviders } from '../src/host/external-providers.ts'
import { ExternalProviderRegistry, assertProviderContract } from '../src/host/external-provider.ts'
import { ExternalSyncService } from '../src/host/external-sync.ts'
import { TaskStore } from '../src/host/store.ts'

const directories: string[] = []
afterEach(async () => { await Promise.all(directories.splice(0).map(dir => rm(dir, { recursive: true, force: true }))) })

const descriptor: ProviderDescriptor = {
  id: 'sample', name: 'Sample', scopeLabel: 'Scope', defaultBaseUrl: 'https://sample.test',
  contractVersion: 1, kind: 'tracker',
  authModes: [{ id: 'token', label: 'Token', fields: [{ key: 'token', label: 'Token' }] }],
  capabilities: {
    itemTypes: ['ticket'], projectDiscovery: false, accountDiscovery: false, pagination: 'page', incremental: false,
    operations: ['validateConnection', 'getCapabilities', 'listWorkItems'], directions: ['inbound'],
  },
}

const item: ExternalItem = {
  projectId: 'p', type: 'ticket', id: '7', title: 'Remote', description: 'Remote body', urgency: 'normal',
  priority: '', url: 'https://sample.test/7', assignedTo: '', closed: false, status: 'open', revision: 'rev-2',
}

function source(overrides: Partial<ExternalItem> = {}): ExternalSource {
  return { connectionId: 'c', provider: 'sample', syncedAt: 1, item: { ...item, ...overrides }, conflicts: [] }
}

describe('adapter contract v1', () => {
  it('derives conservative legacy capabilities and exposes the v1 constants', () => {
    expect(ADAPTER_CONTRACT_VERSION).toBe(1)
    expect(adapterOperationsOf({ ...descriptor, capabilities: { ...descriptor.capabilities, operations: undefined } }))
      .toEqual(['validateConnection', 'getCapabilities', 'listWorkItems'])
    expect(adapterDirectionsOf({ ...descriptor, capabilities: { ...descriptor.capabilities, directions: undefined } })).toEqual(['inbound'])
    expect(adapterSupports(descriptor, 'listWorkItems')).toBe(true)
    expect(adapterSupports(descriptor, 'createWorkItem')).toBe(false)
    expect(adapterFieldAuthorityOf(descriptor)).toEqual({ title: 'merge', description: 'merge', urgency: 'merge', status: 'local', assignees: 'local' })
  })
  it('rejects an adapter that declares an operation it does not implement', () => {
    const missing: ProviderDescriptor = { ...descriptor, capabilities: { ...descriptor.capabilities, operations: ['validateConnection', 'getCapabilities', 'discoverProjects', 'listWorkItems'] } }
    const registry = new ExternalProviderRegistry().register({ descriptor: missing, create: () => ({ test: async () => {}, getItems: async () => [] }) })
    const config = { id: 'c', provider: 'sample', baseUrl: 'https://sample.test', account: 'a', authMode: 'token',
      credentials: { token: 't' }, itemTypes: ['ticket'], mappings: [{ projectId: 'p', workspaceId: 'ws' }], settings: {},
      since: '', intervalMinutes: 0 }
    expect(() => registry.create(config)).toThrow('does not implement')
  })
  it('rejects undeclared write-back, outbound without write and unknown versions', () => {
    const writeProvider = { test: async () => {}, getItems: async () => [], createItem: async () => item, updateItem: async () => item }
    expect(() => assertProviderContract(descriptor, writeProvider)).toThrow('without declaring it')
    expect(() => assertProviderContract({ ...descriptor, contractVersion: 2 }, { test: async () => {}, getItems: async () => [] }))
      .toThrow('contract version')
    const outbound: ProviderDescriptor = { ...descriptor, capabilities: { ...descriptor.capabilities, write: true, directions: ['inbound', 'outbound'] } }
    expect(() => assertProviderContract(outbound, { test: async () => {}, getItems: async () => [] })).toThrow('outbound sync without write operations')
    const registry = new ExternalProviderRegistry()
    expect(() => registry.register({ descriptor: { ...descriptor, contractVersion: 9 }, create: () => ({ test: async () => {}, getItems: async () => [] }) }))
      .toThrow('contract version')
    expect(() => registry.register({ descriptor: { ...descriptor, capabilities: { ...descriptor.capabilities, operations: ['bogus' as never] } }, create: () => ({ test: async () => {}, getItems: async () => [] }) }))
      .toThrow('unknown operation')
  })
  it('registers exactly the real built-in adapters and verifies each contract', () => {
    const registry = createBuiltinProviders()
    const ids = registry.list().map(provider => provider.id)
    expect(ids).toEqual(['zentao', 'tapd', 'github', 'gitlab', 'gitea', 'jira', 'linear'])
    for (const provider of registry.list()) {
      expect(provider.contractVersion).toBe(1)
      expect(provider.capabilities.operations).toBeDefined()
      expect(provider.capabilities.directions).toBeDefined()
    }
    expect(adapterDirectionsOf(registry.get('zentao').descriptor)).toEqual(['inbound'])
    expect(adapterDirectionsOf(registry.get('github').descriptor)).toEqual(['inbound', 'outbound'])
  })
})

describe('field authority and canonical identity', () => {
  it('applies remote authority, local authority and the default three-way merge', () => {
    const remote = source({ title: 'Remote title' })
    const incoming = { ...item, title: 'New remote' }
    const local = { title: 'Local title', description: 'Remote body', urgency: 'normal' as const }
    expect(mergeExternalFields(local, remote, incoming, false, { title: 'remote' }).fields.title).toBe('New remote')
    expect(mergeExternalFields(local, remote, incoming, false, { title: 'local' }).conflicts).toEqual(['title'])
    expect(mergeExternalFields(local, remote, incoming, false).conflicts).toEqual(['title'])
    // A frozen execution never accepts a remote overwrite even under `remote`.
    expect(mergeExternalFields(local, remote, incoming, true, { title: 'remote' }).fields.title).toBe('Local title')
  })
  it('builds, normalizes and de-duplicates canonical references safely', () => {
    const reference = externalReferenceOf(source())
    expect(reference).toMatchObject({ system: 'sample', instance: 'c', kind: 'ticket', project: 'p', id: '7', revision: 'rev-2', state: 'linked', primary: true })
    const hostile = normalizeExternalReferences([
      { ...reference, url: 'javascript:alert(1)' },
      { ...reference, system: 42 },
      reference,
      { ...reference, id: '8', url: 'https://sample.test/8' },
    ])
    expect(hostile).toHaveLength(2)
    expect(hostile.map(entry => entry.id).sort()).toEqual(['7', '8'])
    const next = upsertExternalReference([reference, { ...reference, id: '9', primary: true }], { ...reference, revision: 'rev-3', primary: true })
    expect(next.filter(entry => entry.primary === true)).toHaveLength(1)
    expect(next.find(entry => entry.id === '7')?.revision).toBe('rev-3')
  })
})

describe('connection normalization', () => {
  async function fixture() {
    const dir = await mkdtemp(join(tmpdir(), 'taskboard-contract-')); directories.push(dir)
    const store = new TaskStore({ file: join(dir, 'tasks.json') })
    const service = new ExternalSyncService({ file: join(dir, 'connections.json'), store, workspaceExists: () => true, now: () => 1 })
    return { dir, store, service }
  }
  const config = {
    provider: 'github', baseUrl: 'https://api.github.com', account: 'octocat', authMode: 'token',
    credentials: { token: 'private-token', webhookSecret: 'whsec' }, itemTypes: ['issue'],
    mappings: [{ projectId: 'octo/repo', workspaceId: 'ws' }], intervalMinutes: 0,
  }
  it('keeps new and legacy connections read-only unless bidirectional is explicit', async () => {
    const f = await fixture()
    const id = await f.service.configure(config)
    const status = await f.service.status()
    expect(status.connections?.[0]).toMatchObject({ direction: 'inbound', enabled: true, conflictPolicy: 'manual' })
    expect(status.config?.syncFields).toEqual(['title', 'description', 'urgency', 'status'])
    await expect(f.service.configure({ ...config, direction: 'bidirectional' }, id))
      .resolves.toBe(id)
    expect((await f.service.status()).connections?.[0]?.direction).toBe('bidirectional')
    // A read-only adapter can never be made bidirectional.
    await expect(f.service.configure({ provider: 'zentao', mappingMode: 'project', baseUrl: 'https://zentao.test',
      account: 'alice', authMode: 'password', credentials: { username: 'alice', password: 'x' },
      mappings: [{ projectId: 'project:1', workspaceId: 'ws' }], direction: 'bidirectional' }, undefined, true))
      .rejects.toThrow('write-back')
    f.service.dispose()
  })
  it('never exposes the webhook secret while reporting its presence', async () => {
    const f = await fixture()
    await f.service.configure(config)
    const status = await f.service.status()
    expect(status.credentialPresent).toMatchObject({ token: true, webhookSecret: true })
    expect(JSON.stringify(status)).not.toContain('whsec')
    expect(JSON.stringify(status)).not.toContain('private-token')
    f.service.dispose()
  })
  it('migrates a legacy single-connection file without losing metadata', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'taskboard-legacy-')); directories.push(dir)
    const store = new TaskStore({ file: join(dir, 'tasks.json') })
    const legacy = {
      config: { id: 'legacy-id', provider: 'github', baseUrl: 'https://api.github.com', account: 'octocat', authMode: 'token',
        credentials: { token: 'private-token' }, itemTypes: ['issue'], mappings: [{ projectId: 'octo/repo', workspaceId: 'ws' }],
        settings: {}, since: '', intervalMinutes: 0 },
      links: {}, ignored: [], lastError: 'legacy failure', lastAttemptAt: 5,
    }
    await writeFile(join(dir, 'connections.json'), JSON.stringify(legacy))
    const service = new ExternalSyncService({ file: join(dir, 'connections.json'), store, workspaceExists: () => true, now: () => 1 })
    const status = await service.status()
    expect(status.connections).toHaveLength(1)
    expect(status.connections?.[0]?.id).toBe('legacy-id')
    expect(status.connections?.[0]?.direction).toBe('inbound')
    expect(status.lastError).toBe('legacy failure')
    service.dispose()
  })
})

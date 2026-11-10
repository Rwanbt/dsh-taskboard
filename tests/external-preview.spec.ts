import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ExternalSyncService } from '../src/host/external-sync.ts'
import { createBuiltinProviders } from '../src/host/external-providers.ts'
import { TaskStore } from '../src/host/store.ts'
import type { ExternalItem } from '../src/shared/external.ts'

const directories: string[] = []
afterEach(async () => { await Promise.all(directories.splice(0).map(dir => rm(dir, { recursive: true, force: true }))) })

const issue = (id: string, title: string, overrides: Partial<ExternalItem> = {}): ExternalItem => ({
  projectId: 'octo/repo', type: 'issue', id, title, description: `Body ${id}`, urgency: 'normal', priority: '',
  url: `https://github.com/octo/repo/issues/${id}`, assignedTo: 'octocat', assignees: ['octocat'], closed: false, status: 'open', ...overrides,
})

async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), 'taskboard-preview-')); directories.push(dir)
  const store = new TaskStore({ file: join(dir, 'tasks.json') })
  let items = [issue('1', 'Existing'), issue('2', 'Brand new'), issue('3', 'Closed', { closed: true, status: 'closed' })]
  const service = new ExternalSyncService({
    file: join(dir, 'connection.json'), store, workspaceExists: () => true, now: () => 500,
    registry: createBuiltinProviders(), provider: () => ({ test: async () => {}, getItems: async () => structuredClone(items) }),
  })
  await service.configure({
    provider: 'github', baseUrl: 'https://api.github.com', account: 'octocat', authMode: 'token',
    credentials: { token: 'private-token' }, itemTypes: ['issue'], mappings: [{ projectId: 'octo/repo', workspaceId: 'ws' }],
    intervalMinutes: 0, assigneeFilter: false,
  })
  return { service, store, set: (value: ExternalItem[]) => { items = value } }
}

describe('sync preview', () => {
  it('reports inbound actions without mutating the ledger or the remote side', async () => {
    const f = await fixture()
    await f.service.sync()
    const before = f.store.snapshot()
    f.set([issue('1', 'Existing renamed'), issue('2', 'Brand new'), issue('4', 'Another new')])
    const preview = await f.service.preview()
    expect(preview.direction).toBe('inbound')
    expect(preview.inbound).toMatchObject({ update: 1, unchanged: 1, create: 1, ignore: 0, link: 0 })
    expect(preview.inbound.samples.map(sample => sample.action)).toContain('create')
    expect(preview.outbound.push).toBe(0)
    expect(f.store.snapshot()).toEqual(before)
    // The real round still applies the previewed changes.
    const result = await f.service.sync()
    expect(result).toMatchObject({ created: 1, updated: 1 })
    f.service.dispose()
  })
  it('reports conflicts and outbound pushes before enabling write-back', async () => {
    const f = await fixture()
    await f.service.sync()
    await f.store.mutate('task-updated', ledger => {
      const task = ledger.tasks.find(candidate => candidate.external?.item.id === '1')!
      task.title = 'Local title'
      return [task]
    })
    f.set([issue('1', 'Remote title'), issue('2', 'Another title')])
    const inbound = await f.service.preview()
    expect(inbound.inbound.conflicts).toBe(1)
    expect(inbound.outbound.push).toBe(0)
    await f.service.configure({
      provider: 'github', baseUrl: 'https://api.github.com', account: 'octocat', authMode: 'token',
      credentials: { token: 'private-token' }, itemTypes: ['issue'], mappings: [{ projectId: 'octo/repo', workspaceId: 'ws' }],
      intervalMinutes: 0, assigneeFilter: false, direction: 'bidirectional',
    })
    const bidirectional = await f.service.preview()
    expect(bidirectional.direction).toBe('bidirectional')
    // The local edit is not yet recorded as an unresolved conflict (preview is
    // read-only), so the planned push is visible with exactly that field.
    expect(bidirectional.outbound).toMatchObject({ push: 1, samples: [{ fields: ['title'] }] })
    f.service.dispose()
  })
  it('never writes when previewing an adapter that cannot discover or read', async () => {
    const f = await fixture()
    f.service.dispose()
    const failing = new ExternalSyncService({
      file: join(tmpdir(), `preview-fail-${Date.now()}.json`), store: f.store, workspaceExists: () => true,
      registry: createBuiltinProviders(), provider: () => ({ test: async () => {}, getItems: async () => { throw new Error('offline') } }),
    })
    await failing.configure({
      provider: 'github', baseUrl: 'https://api.github.com', account: 'octocat', authMode: 'token',
      credentials: { token: 'private-token' }, itemTypes: ['issue'], mappings: [{ projectId: 'octo/repo', workspaceId: 'ws' }],
    })
    await expect(failing.preview()).rejects.toThrow('offline')
    expect(f.store.snapshot().tasks).toEqual([])
    failing.dispose()
  })
})

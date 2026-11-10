import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ExternalSyncService } from '../src/host/external-sync.ts'
import { TaskStore } from '../src/host/store.ts'
import type { ExternalItem } from '../src/shared/external.ts'

const directories: string[] = []
afterEach(async () => { await Promise.all(directories.splice(0).map(dir => rm(dir, { recursive: true, force: true }))) })

const issue = (projectId: string, id: string, title: string): ExternalItem => ({
  projectId, type: 'issue', id, title, description: '', urgency: 'normal', priority: '',
  url: `https://github.com/${projectId}/issues/${id}`, assignedTo: 'octocat', assignees: ['octocat'], closed: false, status: 'open',
})

async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), 'taskboard-multi-')); directories.push(dir)
  const store = new TaskStore({ file: join(dir, 'tasks.json') })
  const service = new ExternalSyncService({
    file: join(dir, 'connections.json'), store, workspaceExists: id => id === 'ws', now: () => 100,
    provider: config => ({
      test: async () => {},
      getItems: async (projectId: string) => [issue(projectId, config.id.slice(-4), `Item ${projectId}`)],
    }),
  })
  return { dir, store, service }
}

const base = {
  provider: 'github', baseUrl: 'https://api.github.com', account: 'octocat', authMode: 'token',
  credentials: { token: 'private-token' }, itemTypes: ['issue'], intervalMinutes: 0, assigneeFilter: false,
}

describe('multiple external connections', () => {
  it('creates, lists, edits and removes independent connections', async () => {
    const f = await fixture()
    const first = await f.service.configure({ ...base, mappings: [{ projectId: 'octo/one', workspaceId: 'ws' }] })
    const second = await f.service.configure({ ...base, mappings: [{ projectId: 'octo/two', workspaceId: 'ws' }] }, undefined, true)
    expect(first).not.toBe(second)
    let status = await f.service.status()
    expect(status.connections?.map(connection => connection.mappings[0]!.projectId)).toEqual(['octo/one', 'octo/two'])
    expect(status.connectionStates?.[first]).toMatchObject({ running: false, ignoredCount: 0 })
    expect(status.config?.id).toBe(first)
    // Editing keeps the stable id and does not touch the other connection.
    await f.service.configure({ ...base, mappings: [{ projectId: 'octo/one-renamed', workspaceId: 'ws' }] }, first)
    status = await f.service.status()
    expect(status.connections?.map(connection => connection.id)).toEqual([first, second])
    expect(status.connections?.[0]?.mappings[0]?.projectId).toBe('octo/one-renamed')
    await f.service.setEnabled(second, false)
    expect((await f.service.status()).connections?.[1]?.enabled).toBe(false)
    await f.service.removeConnection(second)
    expect((await f.service.status()).connections).toHaveLength(1)
    expect(JSON.stringify(await f.service.status())).not.toContain('private-token')
    const persisted = JSON.parse(await readFile(join(f.dir, 'connections.json'), 'utf8'))
    expect(persisted.connections).toHaveLength(1)
    expect(persisted.config.id).toBe(first)
    f.service.dispose()
  })
  it('syncs enabled connections sequentially, aggregates counters and reports partial failures', async () => {
    const f = await fixture()
    f.service.dispose()
    let failSecond = false
    const service = new ExternalSyncService({
      file: join(f.dir, 'connections.json'), store: f.store, workspaceExists: () => true, now: () => 100,
      provider: config => ({
        test: async () => {},
        getItems: async (projectId: string) => {
          if (projectId === 'octo/b' && failSecond) throw new Error('offline')
          return [issue(projectId, projectId === 'octo/b' ? '2' : '1', `Item ${projectId}`)]
        },
      }),
    })
    const a = await service.configure({ ...base, mappings: [{ projectId: 'octo/a', workspaceId: 'ws' }] })
    await service.configure({ ...base, mappings: [{ projectId: 'octo/b', workspaceId: 'ws' }] }, undefined, true)
    const result = await service.sync()
    expect(result).toMatchObject({ created: 2, connections: 2 })
    failSecond = true
    const partial = await service.sync()
    expect(partial.failedConnections).toBe(1)
    const states = (await service.status()).connectionStates!
    expect(Object.keys(states)).toHaveLength(2)
    expect(Object.values(states).some(state => state.lastError !== undefined)).toBe(true)
    // A targeted sync of the healthy connection still works.
    failSecond = false
    expect((await service.sync(a)).created).toBe(0)
    service.dispose()
  })
  it('bounds the number of connections and persists credentials with owner-only permissions', async () => {
    const f = await fixture()
    for (let index = 0; index < 10; index++) {
      await f.service.configure({ ...base, mappings: [{ projectId: `octo/r${index}`, workspaceId: 'ws' }] }, undefined, true)
    }
    await expect(f.service.configure({ ...base, mappings: [{ projectId: 'octo/overflow', workspaceId: 'ws' }] }, undefined, true))
      .rejects.toThrow('too many configured connections')
    const stats = await import('node:fs/promises').then(fs => fs.stat(join(f.dir, 'connections.json')))
    if (process.platform !== 'win32') expect(stats.mode & 0o077).toBe(0)
    f.service.dispose()
  })
})

import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { ExternalSyncService } from '../src/host/external-sync.ts'
import { createBuiltinProviders } from '../src/host/external-providers.ts'
import { TaskStore } from '../src/host/store.ts'
import { registerTaskboardTools, type ExternalSyncFace } from '../src/host/tools.ts'
import type { ExternalFields, ExternalItem, ExternalPushPatch } from '../src/shared/external.ts'
import { normalizeExternalSyncRecords } from '../src/shared/external.ts'
import type { TaskRecord } from '../src/shared/protocol.ts'

const directories: string[] = []
afterEach(async () => { await Promise.all(directories.splice(0).map(dir => rm(dir, { recursive: true, force: true }))) })

const remoteIssue = (overrides: Partial<ExternalItem> = {}): ExternalItem => ({
  projectId: 'octo/repo', type: 'issue', id: '1', title: 'Remote title', description: 'Remote body', urgency: 'normal',
  priority: 'bug', url: 'https://github.com/octo/repo/issues/1', assignedTo: 'octocat', assignees: ['octocat'],
  closed: false, status: 'open', ...overrides,
})
const localTask = (overrides: Partial<TaskRecord> = {}): TaskRecord => ({
  id: 'local-1', title: 'Local card', description: 'Local description', prompt: '', workspaceId: 'ws',
  urgency: 'normal', status: 'todo', blocked: false, execution: { mode: 'claim' }, version: 1,
  createdAt: 1, updatedAt: 1, createdBy: { kind: 'user' }, updatedBy: { kind: 'user' }, comments: [], executions: [], ...overrides,
})

async function fixture(configure: Record<string, unknown> = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'taskboard-push-')); directories.push(dir)
  const store = new TaskStore({ file: join(dir, 'tasks.json') })
  let items = [remoteIssue()]
  let failPush = false
  const updates: Array<{ projectId: string; id: string; patch: ExternalPushPatch }> = []
  const creates: Array<{ projectId: string; fields: ExternalFields }> = []
  const provider = {
    test: async () => {},
    getItems: async () => structuredClone(items),
    updateItem: async (projectId: string, _type: string, id: string, patch: ExternalPushPatch) => {
      if (failPush) throw new Error('private upstream detail')
      updates.push({ projectId, id, patch })
      const current = items.find(item => item.id === id)!
      const next: ExternalItem = {
        ...current,
        ...(patch.title === undefined ? {} : { title: patch.title }),
        ...(patch.description === undefined ? {} : { description: patch.description }),
        ...(patch.close === undefined ? {} : { closed: true, status: 'closed' }),
      }
      items = items.map(item => item.id === id ? next : item)
      return structuredClone(next)
    },
    createItem: async (projectId: string, fields: ExternalFields) => {
      creates.push({ projectId, fields })
      const next = remoteIssue({ id: '77', projectId, title: fields.title, description: fields.description })
      items = [next, ...items]
      return structuredClone(next)
    },
  }
  const service = new ExternalSyncService({
    file: join(dir, 'connection.json'), store, workspaceExists: id => id === 'ws',
    provider: () => provider, registry: createBuiltinProviders(), now: () => 500,
  })
  await service.configure({
    provider: 'github', baseUrl: 'https://api.github.com', account: 'octocat', authMode: 'token',
    credentials: { token: 'private-token' }, itemTypes: ['issue'],
    mappings: [{ projectId: 'octo/repo', workspaceId: 'ws' }], intervalMinutes: 0, ...configure,
  })
  return {
    service, store, updates, creates,
    setItems: (value: ExternalItem[]) => { items = value },
    failPush: () => { failPush = true },
  }
}

describe('external write-back', () => {
  it('pushes only local edits and terminal state after the inbound merge', async () => {
    const f = await fixture()
    expect((await f.service.sync()).created).toBe(1)
    await f.store.mutate('task-updated', ledger => {
      const task = ledger.tasks[0]!
      task.title = 'Local title'; task.description = 'Local body'; task.status = 'done'
      return [task]
    })
    const result = await f.service.sync()
    expect(result).toMatchObject({ pushed: 1, pushFailed: 0 })
    expect(f.updates).toEqual([{ projectId: 'octo/repo', id: '1', patch: { title: 'Local title', description: 'Local body', close: 'completed' } }])
    expect(f.store.snapshot().tasks[0]!.external!.item).toMatchObject({ title: 'Local title', closed: true, status: 'closed' })
    // Counters are persisted on the sync record for the settings panel.
    const record = Object.values(f.store.snapshot().externalSync ?? {})[0]!
    expect(record.lastResult).toMatchObject({ pushed: 1, pushFailed: 0 })
    // A second round is a no-op: the tracked base now matches the remote item.
    expect((await f.service.sync()).pushed).toBe(0)
    expect(f.updates).toHaveLength(1)
    f.service.dispose()
  })
  it('never overwrites an unresolved conflict', async () => {
    const f = await fixture()
    await f.service.sync()
    await f.store.mutate('task-updated', ledger => { ledger.tasks[0]!.title = 'Local title'; return [ledger.tasks[0]!] })
    f.setItems([remoteIssue({ title: 'Remote title 2' })])
    const result = await f.service.sync()
    expect(result.conflicts).toBe(1)
    expect(f.updates).toHaveLength(0)
    expect(f.store.snapshot().tasks[0]!.title).toBe('Local title')
    expect(f.store.snapshot().tasks[0]!.external!.conflicts).toEqual(['title'])
    f.service.dispose()
  })
  it('counts a failed push without leaking upstream details or failing the sync', async () => {
    const f = await fixture()
    await f.service.sync()
    await f.store.mutate('task-updated', ledger => { ledger.tasks[0]!.title = 'Local title'; return [ledger.tasks[0]!] })
    f.failPush()
    const result = await f.service.sync()
    expect(result).toMatchObject({ pushed: 0, pushFailed: 1 })
    expect(JSON.stringify(await f.service.status())).not.toContain('private upstream detail')
    expect(f.store.snapshot().tasks[0]!.external!.item.title).toBe('Remote title')
    f.service.dispose()
  })
  it('closes canceled cards as not planned and never reopens remote closures', async () => {
    const f = await fixture()
    await f.service.sync()
    await f.store.mutate('task-updated', ledger => { ledger.tasks[0]!.status = 'canceled'; return [ledger.tasks[0]!] })
    await f.service.sync()
    expect(f.updates[0]!.patch).toEqual({ close: 'not_planned' })
    const g = await fixture()
    await g.service.sync()
    g.setItems([remoteIssue({ closed: true, status: 'closed' })])
    expect((await g.service.sync()).pushed).toBe(0)
    expect(g.updates).toHaveLength(0)
    expect(g.store.snapshot().tasks[0]!.status).toBe('backlog')
    f.service.dispose(); g.service.dispose()
  })
  it('pushes one card explicitly and creates a linked issue for an unlinked card', async () => {
    const f = await fixture()
    const task = localTask()
    await f.store.mutate('task-updated', ledger => { ledger.tasks.push(task); return [task] })
    const outcome = await f.service.pushTask(task.id)
    expect(outcome).toMatchObject({ created: true, pushed: ['title', 'description'] })
    expect(f.creates).toEqual([{ projectId: 'octo/repo', fields: { title: 'Local card', description: 'Local description', urgency: 'normal' } }])
    const linked = f.store.snapshot().tasks[0]!
    expect(linked.external).toMatchObject({ provider: 'github', item: { id: '77', type: 'issue', projectId: 'octo/repo' } })
    // Idempotent: the card is linked now and has nothing to push.
    expect(await f.service.pushTask(task.id)).toMatchObject({ created: false, pushed: [] })
    expect(f.creates).toHaveLength(1)
    f.service.dispose()
  })
  it('refuses ambiguous scopes and resolves them with an explicit scope', async () => {
    const f = await fixture({ mappings: [{ projectId: 'octo/repo', workspaceId: 'ws' }, { projectId: 'octo/infra', workspaceId: 'ws' }] })
    const task = localTask()
    await f.store.mutate('task-updated', ledger => { ledger.tasks.push(task); return [task] })
    await expect(f.service.pushTask(task.id)).rejects.toThrow('multiple external scopes')
    await f.service.pushTask(task.id, 'octo/infra')
    expect(f.creates).toEqual([{ projectId: 'octo/infra', fields: expect.objectContaining({ title: 'Local card' }) }])
    f.service.dispose()
  })
  it('refuses write-back on read-only providers', async () => {
    const f = await fixture()
    await f.service.configure({
      provider: 'zentao', mappingMode: 'project', baseUrl: 'https://zentao.test', account: 'alice', authMode: 'password',
      credentials: { username: 'alice', password: 'private-token' }, itemTypes: ['bug'], mappings: [{ projectId: 'project:1', workspaceId: 'ws' }],
    })
    await expect(f.service.pushTask('missing')).rejects.toThrow('does not support write-back')
    f.service.dispose()
  })
})

describe('push result persistence', () => {
  it('round-trips push counters through record normalization and drops invalid values', () => {
    const base = { created: 1, updated: 0, unchanged: 0, conflicts: 0, ignored: 0, at: 1 }
    const records = normalizeExternalSyncRecords({
      c: { links: {}, ignored: [], lastResult: { ...base, pushed: 2, pushFailed: 3 } },
      invalid: { links: {}, ignored: [], lastResult: { ...base, pushed: -1 } },
    })
    expect(records.c!.lastResult).toMatchObject({ pushed: 2, pushFailed: 3 })
    expect(records.invalid!.lastResult).toBeUndefined()
    // Counter-less records (pre-0.11.0) stay valid.
    expect(normalizeExternalSyncRecords({ c: { links: {}, ignored: [], lastResult: base } }).c!.lastResult).toEqual(base)
  })
})

describe('taskboard_external_sync tool', () => {  async function toolFixture(face: ExternalSyncFace | undefined) {
    const dir = await mkdtemp(join(tmpdir(), 'taskboard-tool-')); directories.push(dir)
    const store = new TaskStore({ file: join(dir, 'tasks.json') })
    const registered: Array<{ name: string; execute(args: unknown, exec: unknown): Promise<unknown>; output: { render(args: unknown, value: unknown): Array<{ type: string; text: string }> } }> = []
    const disposers = registerTaskboardTools(
      { tools: { register: tool => { registered.push(tool as never); return () => {} } } },
      {
        store, now: () => 1, externalSync: () => face,
        workspaces: { resolveByPath: async () => ({ id: 'ws' }), get: id => id === 'ws' ? { id: 'ws', path: '/ws', title: 'WS' } : undefined, list: () => [{ id: 'ws', path: '/ws', title: 'WS' }] },
      },
    )
    const tool = registered.find(entry => entry.name === 'taskboard_external_sync')!
    return { tool, disposers }
  }
  const item: ExternalItem = { projectId: 'octo/repo', type: 'issue', id: '1', title: 'T', description: 'D', urgency: 'normal', priority: '', url: 'https://github.com/octo/repo/issues/1', assignedTo: 'octocat', assignees: ['octocat'], closed: false, status: 'open' }
  it('runs a full sync and renders both pull and push counters', async () => {
    const { tool, disposers } = await toolFixture({
      sync: async () => ({ created: 2, updated: 1, unchanged: 3, conflicts: 0, ignored: 1, at: 5, pushed: 4, pushFailed: 1 }),
      pushTask: async () => ({ created: false, pushed: [], item }),
    })
    const value = await tool.execute({}, {})
    const text = tool.output.render({}, value)[0]!.text
    expect(text).toContain('拉取新建 2')
    expect(text).toContain('推送 4')
    expect(text).toContain('推送失败 1')
    disposers.forEach(dispose => dispose())
  })
  it('pushes a single card and renders the remote link', async () => {
    const { tool, disposers } = await toolFixture({
      sync: async () => ({ created: 0, updated: 0, unchanged: 0, conflicts: 0, ignored: 0, at: 0 }),
      pushTask: async (taskId, scope) => {
        expect(taskId).toBe('local-1'); expect(scope).toBe('octo/repo')
        return { created: true, pushed: ['title', 'description'], item }
      },
    })
    const value = await tool.execute({ taskId: 'local-1', scope: 'octo/repo' }, {})
    expect(tool.output.render({}, value)[0]!.text).toContain('https://github.com/octo/repo/issues/1')
    disposers.forEach(dispose => dispose())
  })
  it('reports a stable error when the host service is unavailable', async () => {
    const { tool, disposers } = await toolFixture(undefined)
    await expect(tool.execute({}, {})).rejects.toThrow('invalid_input: external sync is not available')
    disposers.forEach(dispose => dispose())
  })
})

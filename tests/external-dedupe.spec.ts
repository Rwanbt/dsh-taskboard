import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { ExternalSyncService } from '../src/host/external-sync.ts'
import { createBuiltinProviders } from '../src/host/external-providers.ts'
import { TaskStore } from '../src/host/store.ts'
import {
  bestExternalMatch, externalMatchScore, externalTitleSimilarity, normalizeMatchTitle,
  type ExternalItem, type ExternalPushPatch,
} from '../src/shared/external.ts'
import type { TaskRecord } from '../src/shared/protocol.ts'

const directories: string[] = []
afterEach(async () => { await Promise.all(directories.splice(0).map(dir => rm(dir, { recursive: true, force: true }))) })

const remote = (id: string, title: string): ExternalItem => ({
  projectId: 'octo/repo', type: 'issue', id, title, description: `Body ${id}`, urgency: 'normal', priority: '',
  url: `https://github.com/octo/repo/issues/${id}`, assignedTo: '', assignees: [], closed: false, status: 'open',
})
const card = (overrides: Partial<TaskRecord> & { id: string; title: string }): TaskRecord => ({
  description: 'Copied summary', prompt: '', workspaceId: 'ws', urgency: 'normal', status: 'todo', blocked: false,
  execution: { mode: 'claim' }, version: 1, createdAt: 1, updatedAt: 1, createdBy: { kind: 'user' },
  updatedBy: { kind: 'user' }, comments: [], executions: [], ...overrides,
})

async function fixture(options: { tasks?: TaskRecord[]; connect?: Record<string, unknown> } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'taskboard-dedupe-')); directories.push(dir)
  const store = new TaskStore({ file: join(dir, 'tasks.json') })
  let items = [remote('11', 'Remote eleven'), remote('12', 'Remote twelve'), remote('13', 'Remote thirteen')]
  const updates: Array<{ id: string; patch: ExternalPushPatch }> = []
  const provider = {
    test: async () => {},
    getItems: async () => structuredClone(items),
    updateItem: async (_projectId: string, _type: string, id: string, patch: ExternalPushPatch) => {
      updates.push({ id, patch })
      const current = items.find(item => item.id === id)!
      return structuredClone({
        ...current,
        ...(patch.title === undefined ? {} : { title: patch.title }),
        ...(patch.description === undefined ? {} : { description: patch.description }),
        ...(patch.close === undefined ? {} : { closed: true, status: 'closed' }),
      })
    },
    createItem: async (projectId: string, fields: { title: string; description: string }) => {
      const created = remote(String(100 + items.length), fields.title)
      created.projectId = projectId
      items = [created, ...items]
      return structuredClone(created)
    },
  }
  const service = new ExternalSyncService({
    file: join(dir, 'connection.json'), store, workspaceExists: id => id === 'ws',
    provider: () => provider, registry: createBuiltinProviders(), now: () => 500,
  })
  await service.configure({
    provider: 'github', baseUrl: 'https://api.github.com', account: 'octocat', authMode: 'token',
    credentials: { token: 'private-token' }, itemTypes: ['issue'],
    mappings: [{ projectId: 'octo/repo', workspaceId: 'ws' }], intervalMinutes: 0, direction: 'bidirectional',
    ...(options.connect ?? {}),
  })
  if (options.tasks !== undefined) {
    await store.mutate('task-updated', ledger => { ledger.tasks.push(...structuredClone(options.tasks!)); return [...ledger.tasks] })
  }
  return { service, store, updates, setItems: (value: ExternalItem[]) => { items = value } }
}

describe('reference matching', () => {
  it('recognizes a #number in the title as the authoritative reference', () => {
    expect(externalMatchScore({ title: 'Qualifier #1130 — carillon corrigé', description: '' }, '1130', 'Error chime')).toBeGreaterThanOrEqual(1000)
    expect(externalMatchScore({ title: 'Ratification de la charte (#24)', description: '' }, '24', 'Valider la charte')).toBeGreaterThanOrEqual(1000)
    expect(externalMatchScore({ title: 'Qualifier #1130 — autre', description: '' }, '24', 'Valider la charte')).toBeUndefined()
  })
  it('uses only the FIRST issue URL in title/description (later ones are cross-links)', () => {
    const description = 'Source: https://github.com/octo/repo/issues/12 ; lié https://github.com/octo/repo/issues/13'
    expect(externalMatchScore({ title: 'Analyse', description }, '12', 'Analyse détaillée')).toBeGreaterThan(300)
    expect(externalMatchScore({ title: 'Analyse', description }, '13', 'Analyse détaillée')).toBeUndefined()
  })
  it('falls back to identical normalized titles only without references', () => {
    expect(externalMatchScore({ title: 'Fix:  Broken   login !', description: '' }, '9', 'fix broken login')).toBe(500)
    expect(normalizeMatchTitle('Éviter les doublons (#42)')).toBe('éviter les doublons')
    expect(externalTitleSimilarity('Faire statuer sur les droits d\'extraction', 'Statuer sur licence et droits d\'extraction')).toBeGreaterThan(0.3)
  })
  it('keeps only a unique best candidate and reports ambiguity', () => {
    expect(bestExternalMatch([{ card: 'a', score: 1010 }, { card: 'b', score: 300 }])).toEqual({ card: 'a' })
    expect(bestExternalMatch([{ card: 'a', score: 300 }, { card: 'b', score: 300 }])).toEqual({ ambiguous: true })
    expect(bestExternalMatch([])).toBeUndefined()
  })
})

describe('dedupe on sync', () => {
  it('adopts cards whose title names the issue instead of creating duplicates', async () => {
    const f = await fixture({ tasks: [
      card({ id: 't-11', title: 'Qualifier #11 — résumé maison' }),
      card({ id: 't-12', title: 'Analyse détaillée', description: 'Source canonique https://github.com/octo/repo/issues/12' }),
    ], connect: { assigneeFilter: false } })
    const result = await f.service.sync()
    expect(result).toMatchObject({ created: 1, linked: 2, ambiguous: 0, pushed: 0, pushFailed: 0 })
    const tasks = f.store.snapshot().tasks
    expect(tasks).toHaveLength(3)
    const adopted = tasks.find(task => task.id === 't-11')!
    expect(adopted).toMatchObject({ title: 'Qualifier #11 — résumé maison', external: { item: { id: '11', type: 'issue' } } })
    // Adopted content is the push baseline: nothing is rewritten remotely.
    expect(f.updates).toEqual([])
    // A second round neither duplicates nor pushes the adopted wording back.
    const second = await f.service.sync()
    expect(second).toMatchObject({ created: 0, linked: 0, pushed: 0 })
    expect(f.store.snapshot().tasks).toHaveLength(3)
    expect(f.updates).toEqual([])
    f.service.dispose()
  })
  it('adopts a terminal card without closing an already-open issue', async () => {
    const f = await fixture({ tasks: [card({ id: 't-13', title: 'Fait #13', status: 'done' })] })
    const result = await f.service.sync()
    expect(result).toMatchObject({ linked: 1, created: 0, pushed: 0 })
    expect(f.updates).toEqual([])
    expect(f.store.snapshot().tasks[0]!.status).toBe('done')
    f.service.dispose()
  })
  it('pushes a genuine edit made after adoption (and only that field)', async () => {
    const f = await fixture({ tasks: [card({ id: 't-11', title: 'Qualifier #11 — résumé maison' })] })
    await f.service.sync()
    await f.store.mutate('task-updated', ledger => { ledger.tasks[0]!.title = 'Nouveau titre'; return [ledger.tasks[0]!] })
    const result = await f.service.sync()
    expect(result).toMatchObject({ pushed: 1, pushFailed: 0 })
    expect(f.updates).toEqual([{ id: '11', patch: { title: 'Nouveau titre' } }])
    f.service.dispose()
  })
  it('skips items referenced by several cards instead of guessing', async () => {
    const f = await fixture({ tasks: [
      card({ id: 't-11a', title: 'Suivi #11 — première copie' }),
      card({ id: 't-11b', title: 'Suivi #11 — seconde copie' }),
    ], connect: { assigneeFilter: false } })
    const result = await f.service.sync()
    expect(result).toMatchObject({ linked: 0, ambiguous: 1, created: 2 })
    // The ambiguous cards stay untouched; the other issues are imported normally.
    expect(f.store.snapshot().tasks.filter(task => task.id.startsWith('t-11')).every(task => task.external === undefined)).toBe(true)
    expect(f.store.snapshot().tasks).toHaveLength(4)
    f.service.dispose()
  })
  it('respects the assignee filter for creation but still adopts existing cards', async () => {
    const f = await fixture({ tasks: [card({ id: 't-11', title: 'Qualifier #11 — résumé maison' })] })
    const result = await f.service.sync()
    expect(result).toMatchObject({ linked: 1, created: 0 })
    // Unassigned issues are not imported while the filter is on…
    const g = await fixture()
    expect((await g.service.sync()).created).toBe(0)
    // …and become importable once it is disabled.
    await g.service.configure({ ...(await g.service.status()).config, credentials: {}, assigneeFilter: false })
    expect((await g.service.sync()).created).toBe(3)
    g.service.dispose()
    f.service.dispose()
  })
})

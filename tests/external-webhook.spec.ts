import { afterEach, describe, expect, it } from 'vitest'
import { createHmac } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ExternalSyncService } from '../src/host/external-sync.ts'
import { TaskStore } from '../src/host/store.ts'
import type { ExternalItem } from '../src/shared/external.ts'
import { waitFor } from './wait-for.ts'

const directories: string[] = []
afterEach(async () => {
  await Promise.all(directories.splice(0).map(dir => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })))
})

const issue = (overrides: Partial<ExternalItem> = {}): ExternalItem => ({
  projectId: 'octo/repo', type: 'issue', id: '1', title: 'Remote title', description: 'Remote body', urgency: 'normal', priority: '',
  url: 'https://github.com/octo/repo/issues/1', assignedTo: 'octocat', assignees: ['octocat'], closed: false, status: 'open', ...overrides,
})

const SECRET = 'webhook-secret-value'

async function fixture(provider: 'github' | 'gitlab' | 'gitea' = 'github') {
  const dir = await mkdtemp(join(tmpdir(), 'taskboard-webhook-')); directories.push(dir)
  const store = new TaskStore({ file: join(dir, 'tasks.json') })
  let reads = 0
  let items = [issue()]
  const service = new ExternalSyncService({
    file: join(dir, 'connections.json'), store, workspaceExists: () => true, now: () => 100,
    provider: () => ({ test: async () => {}, getItems: async () => { reads++; return structuredClone(items) } }),
  })
  const scope = provider === 'gitlab' ? 'group/repo' : 'octo/repo'
  const id = await service.configure({
    provider, baseUrl: provider === 'gitlab' ? 'https://gitlab.com/api/v4' : provider === 'gitea' ? 'https://gitea.com/api/v1' : 'https://api.github.com',
    account: 'octocat', authMode: 'token', credentials: { token: 'private-token', webhookSecret: SECRET },
    itemTypes: ['issue'], mappings: [{ projectId: scope, workspaceId: 'ws' }], intervalMinutes: 0,
    // Webhooks only trigger a pull; the fixture stubs reads only.
    direction: 'inbound',
  })
  return { dir, store, service, id, reads: () => reads, setItems: (value: ExternalItem[]) => { items = value } }
}

function githubHeaders(body: string, delivery = 'd-1'): Record<string, string> {
  return {
    'x-github-event': 'issues',
    'x-github-delivery': delivery,
    'x-hub-signature-256': `sha256=${createHmac('sha256', SECRET).update(body, 'utf8').digest('hex')}`,
  }
}

describe('signed external webhooks', () => {
  it('rejects missing or invalid signatures without touching the ledger', async () => {
    const f = await fixture()
    const body = JSON.stringify({ action: 'opened' })
    expect((await f.service.receiveWebhook(f.id, { 'x-github-event': 'issues' }, body)).status).toBe(401)
    expect((await f.service.receiveWebhook(f.id, { 'x-hub-signature-256': 'sha256=deadbeef' }, body)).status).toBe(401)
    expect(f.reads()).toBe(0)
    expect(f.store.snapshot().tasks).toEqual([])
    f.service.dispose()
  })
  it('accepts a valid GitHub delivery, queues a pull and drops duplicates', async () => {
    const f = await fixture()
    const body = JSON.stringify({ action: 'opened', issue: { number: 1 } })
    const first = await f.service.receiveWebhook(f.id, githubHeaders(body, 'delivery-a'), body)
    expect(first).toMatchObject({ status: 202, body: { ok: true, value: { accepted: true, duplicate: false, sync: 'queued' } } })
    await waitFor(() => f.reads() > 0)
    const tasksAfterFirst = f.store.snapshot().tasks
    expect(tasksAfterFirst).toHaveLength(1)
    // Duplicate delivery: acknowledged, no second pull, no state change.
    const duplicate = await f.service.receiveWebhook(f.id, githubHeaders(body, 'delivery-a'), body)
    expect(duplicate).toMatchObject({ status: 202, body: { ok: true, value: { duplicate: true, sync: 'ignored' } } })
    expect(f.store.snapshot().tasks).toEqual(tasksAfterFirst)
    f.service.dispose()
  })
  it('accepts GitLab token auth and Gitea HMAC signatures', async () => {
    const gitlab = await fixture('gitlab')
    expect((await gitlab.service.receiveWebhook(gitlab.id, { 'x-gitlab-token': 'wrong' }, '{}')).status).toBe(401)
    expect(await gitlab.service.receiveWebhook(gitlab.id, { 'x-gitlab-token': SECRET, 'x-gitlab-event': 'issue' }, '{}'))
      .toMatchObject({ status: 202 })
    await waitFor(() => gitlab.reads() > 0)
    gitlab.service.dispose()

    const gitea = await fixture('gitea')
    const body = '{"action":"opened"}'
    const signature = createHmac('sha256', SECRET).update(body, 'utf8').digest('hex')
    expect((await gitea.service.receiveWebhook(gitea.id, { 'x-gitea-signature': 'bad' }, body)).status).toBe(401)
    expect(await gitea.service.receiveWebhook(gitea.id, { 'x-gitea-signature': signature, 'x-gitea-event': 'issues' }, body))
      .toMatchObject({ status: 202 })
    await waitFor(() => gitea.reads() > 0)
    gitea.service.dispose()
  })
  it('ignores ping events and refuses providers without signed webhooks', async () => {
    const f = await fixture()
    expect(await f.service.receiveWebhook(f.id, { ...githubHeaders('{}', 'ping-1'), 'x-github-event': 'ping' }, '{}'))
      .toMatchObject({ status: 200, body: { ok: true, value: { sync: 'not_needed' } } })
    expect(f.reads()).toBe(0)
    const zentao = new ExternalSyncService({
      file: join(f.dir, 'zentao.json'), store: f.store, workspaceExists: () => true, now: () => 100,
      provider: () => ({ test: async () => {}, getItems: async () => [] }),
    })
    const zentaoId = await zentao.configure({
      provider: 'zentao', mappingMode: 'project', baseUrl: 'https://zentao.test', account: 'alice', authMode: 'password',
      credentials: { username: 'alice', password: 'private' }, mappings: [{ projectId: 'project:1', workspaceId: 'ws' }],
    })
    expect((await zentao.receiveWebhook(zentaoId, {}, '{}')).status).toBe(501)
    zentao.dispose(); f.service.dispose()
  })
  it('treats the payload as untrusted: state always comes from the authoritative pull', async () => {
    const f = await fixture()
    const body = JSON.stringify({ action: 'edited', issue: { title: 'Malicious <script>alert(1)</script>', state: 'closed' } })
    expect((await f.service.receiveWebhook(f.id, githubHeaders(body), body)).status).toBe(202)
    await waitFor(() => f.reads() > 0)
    const task = f.store.snapshot().tasks[0]!
    expect(task.title).toBe('Remote title')
    expect(task.external!.item.title).toBe('Remote title')
    expect(task.status).toBe('backlog')
    // A later authoritative pull still updates the card normally.
    f.setItems([issue({ title: 'Authoritative update' })])
    await f.service.sync()
    expect(f.store.snapshot().tasks[0]!.title).toBe('Authoritative update')
    f.service.dispose()
  })
  it('requires a configured secret and an enabled connection', async () => {
    const f = await fixture()
    await f.service.configure({
      provider: 'github', baseUrl: 'https://api.github.com', account: 'octocat', authMode: 'token',
      credentials: { token: 'private-token', webhookSecret: '' }, itemTypes: ['issue'], mappings: [{ projectId: 'octo/repo', workspaceId: 'ws' }],
    }, f.id)
    const noSecret = await f.service.receiveWebhook(f.id, githubHeaders('{}'), '{}')
    expect(noSecret).toMatchObject({ status: 503, body: { ok: false, error: { code: 'webhook_disabled' } } })
    expect((await f.service.receiveWebhook('missing-connection', {}, '{}')).status).toBe(404)
    f.service.dispose()
  })
})

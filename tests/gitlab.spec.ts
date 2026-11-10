import { describe, expect, it, vi } from 'vitest'
import { GitlabProvider } from '../src/host/gitlab.ts'
import { assertProviderContract } from '../src/host/external-provider.ts'
import { createBuiltinProviders } from '../src/host/external-providers.ts'
import { adapterDirectionsOf, adapterOperationsOf, type ExternalConfig } from '../src/shared/external.ts'

const config = (overrides: Partial<ExternalConfig> = {}): ExternalConfig => ({
  id: 'conn', provider: 'gitlab', baseUrl: 'https://gitlab.com/api/v4', account: 'alice', authMode: 'token',
  credentials: { token: 'private-token' }, itemTypes: ['issue'],
  settings: { urgentLabels: 'urgent,p0', relaxedLabels: 'low,minor' },
  mappings: [{ projectId: 'group/project', workspaceId: 'ws' }], intervalMinutes: 0, since: '', importStatus: 'backlog',
  ...overrides,
})

const signal = () => AbortSignal.timeout(1_000)

type Call = { url: string; method: string; headers: Record<string, string>; body?: unknown }
/** Fake transport: no network, every request is recorded and answered locally. */
function mock(resolve: (call: Call) => Response | undefined) {
  const calls: Call[] = []
  const handler = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const headers = Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>).map(([key, value]) => [key.toLowerCase(), value]))
    const call: Call = { url: String(input), method: init?.method ?? 'GET', headers, ...(init?.body === undefined ? {} : { body: JSON.parse(String(init.body)) }) }
    calls.push(call)
    const response = resolve(call)
    if (response === undefined) throw new Error(`unexpected request ${call.method} ${call.url}`)
    return response
  })
  return { calls, handler, request: handler as unknown as typeof fetch }
}
const json = (value: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json', ...headers } })
const issue = (overrides: Record<string, unknown> = {}) => ({
  iid: 12, title: 'Fix the thing', description: 'Details', state: 'opened',
  web_url: 'https://gitlab.com/group/project/-/issues/12',
  labels: ['bug', 'urgent'],
  assignees: [{ username: 'alice' }, { username: 'bob' }],
  created_at: '2026-01-02T03:04:05Z', updated_at: '2026-01-03T04:05:06Z', ...overrides,
})
async function failure(run: () => Promise<unknown>): Promise<Error> {
  try { await run() } catch (error) { return error as Error }
  throw new Error('expected a rejection')
}

describe('GitLab provider registration', () => {
  it('declares a write-capable forge adapter with its exact contract operations', () => {
    const descriptor = createBuiltinProviders().list().find(provider => provider.id === 'gitlab')!
    expect(descriptor).toMatchObject({
      name: 'GitLab', scopeLabel: 'ext.repoScope', defaultBaseUrl: 'https://gitlab.com/api/v4', contractVersion: 1, kind: 'forge',
      authModes: [{ id: 'token', label: 'ext.gitlabToken', fields: [{ key: 'token', label: 'ext.gitlabToken' }] }],
      capabilities: {
        itemTypes: ['issue'], projectDiscovery: true, accountDiscovery: true, pagination: 'page', incremental: false,
        write: true, dedupe: true, events: 'poll', limits: { pageSize: 100, maxPages: 1000, requestTimeoutMs: 30_000 },
      },
    })
    expect(adapterOperationsOf(descriptor)).toEqual(['validateConnection', 'getCapabilities', 'discoverProjects', 'listWorkItems',
      'getWorkItem', 'createWorkItem', 'updateWorkItem'])
    expect(adapterDirectionsOf(descriptor)).toEqual(['inbound', 'outbound'])
  })
  it('creates a provider that satisfies assertProviderContract', () => {
    const registry = createBuiltinProviders()
    const provider = registry.create(config())
    expect(provider).toBeInstanceOf(GitlabProvider)
    expect(() => assertProviderContract(registry.get('gitlab').descriptor, provider)).not.toThrow()
  })
  it('rejects scopes that are not group/project before any request', () => {
    expect(() => createBuiltinProviders().create(config({ mappings: [{ projectId: 'not-a-scope', workspaceId: 'ws' }] })))
      .toThrow('group/project')
    expect(() => createBuiltinProviders().create(config({ mappings: [{ projectId: 'group/project/', workspaceId: 'ws' }] })))
      .toThrow('group/project')
  })
  it('requires a token authentication mode', () => {
    expect(() => new GitlabProvider(config({ authMode: 'basic' }))).toThrow('requires a token')
    expect(() => new GitlabProvider(config({ credentials: {} }))).toThrow('requires a token')
  })
})

describe('GitLab provider reads', () => {
  it('paginates issues, skips merge requests and normalizes every field', async () => {
    const issues = Array.from({ length: 99 }, (_, index) => issue({
      iid: index + 1, title: `Issue ${index + 1}`, web_url: `https://gitlab.com/group/project/-/issues/${index + 1}`,
    }))
    // A merge request shares the issue shape and must never be imported.
    const pageOne = [...issues, issue({ iid: 100, title: 'Merge it', merge_request: { iid: 100 } })]
    const { calls, handler, request } = mock(call => /[?&]page=1(?:&|$)/.test(call.url)
      ? json(pageOne)
      : json([issue({ iid: 101, title: 'Last', web_url: 'https://gitlab.com/group/project/-/issues/101' })]))
    const items = await new GitlabProvider(config(), request).getItems('group/project', signal())
    expect(handler).toHaveBeenCalledTimes(2)
    expect(items.map(item => item.id)).toEqual([...Array.from({ length: 99 }, (_, index) => String(index + 1)), '101'])
    expect(items[0]).toEqual({
      projectId: 'group/project', type: 'issue', id: '1', title: 'Issue 1', description: 'Details',
      priority: 'bug,urgent', status: 'opened', assignedTo: 'alice', assignees: ['alice', 'bob'],
      closed: false, urgency: 'urgent', url: 'https://gitlab.com/group/project/-/issues/1', revision: '2026-01-03T04:05:06Z',
    })
    expect(calls[0]!.url).toBe('https://gitlab.com/api/v4/projects/group%2Fproject/issues?state=all&per_page=100&page=1&order_by=created_at&sort=asc')
    expect(calls[0]!.headers['private-token']).toBe('private-token')
    expect(calls[0]!.headers.authorization).toBeUndefined()
    expect(calls[1]!.url).toContain('page=2')
  })
  it('normalizes closed, unassigned and label-free issues', async () => {
    const { request } = mock(() => json([issue({ iid: 3, state: 'closed', labels: ['low'], assignees: [], updated_at: undefined })]))
    const [item] = await new GitlabProvider(config(), request).getItems('group/project', signal())
    expect(item).toMatchObject({ id: '3', status: 'closed', closed: true, assignedTo: '', assignees: [], urgency: 'relaxed', priority: 'low' })
    expect(item!.revision).toBeUndefined()
  })
  it('skips issues created before the configured start date unless already linked', async () => {
    const old = issue({ iid: 1, title: 'Old', web_url: 'https://gitlab.com/group/project/-/issues/1', created_at: '2025-12-01T00:00:00Z' })
    const fresh = issue({ iid: 2, title: 'Fresh', web_url: 'https://gitlab.com/group/project/-/issues/2', created_at: '2026-02-01T00:00:00Z' })
    const { request } = mock(() => json([old, fresh]))
    const provider = new GitlabProvider(config({ since: '2026-01-01' }), request)
    expect((await provider.getItems('group/project', signal())).map(item => item.id)).toEqual(['2'])
    // An already linked item keeps receiving updates even when it predates `since`.
    const existing = new Map([['["issue","1"]', { item: { projectId: 'group/project', type: 'issue', id: '1', title: 'Old', description: '',
      urgency: 'normal' as const, priority: '', status: 'opened', assignedTo: '', assignees: [], closed: false,
      url: 'https://gitlab.com/group/project/-/issues/1' }, metadataOnly: false }]])
    expect((await provider.getItems('group/project', signal(), { existing })).map(item => item.id)).toEqual(['1', '2'])
  })
  it('reads one issue by iid, encodes a subgroup scope and refuses merge requests', async () => {
    const { calls, request } = mock(call => call.url.endsWith('/issues/8')
      ? json(issue({ iid: 8, merge_request: { iid: 8 } }))
      : json(issue({ iid: 7 })))
    const provider = new GitlabProvider(config({ mappings: [{ projectId: 'groupe/sous-groupe/projet', workspaceId: 'ws' }] }), request)
    expect(await provider.getItem('groupe/sous-groupe/projet', 'issue', '7', signal())).toMatchObject({ id: '7', type: 'issue' })
    expect(calls[0]!.url).toBe('https://gitlab.com/api/v4/projects/groupe%2Fsous-groupe%2Fprojet/issues/7')
    await expect(provider.getItem('groupe/sous-groupe/projet', 'issue', '8', signal())).rejects.toThrow('merge requests are not work items')
    await expect(provider.getItem('groupe/sous-groupe/projet', 'merge_request', '7', signal())).rejects.toThrow('unsupported GitLab work item')
    await expect(provider.getItem('groupe/sous-groupe/projet', 'issue', 'seven', signal())).rejects.toThrow('invalid GitLab issue iid')
  })
  it('verifies the account and every mapped project during a connection test', async () => {
    const ok = mock(call => call.url.endsWith('/user') ? json({ username: 'alice' }) : json({ path_with_namespace: 'group/project' }))
    await expect(new GitlabProvider(config(), ok.request).test(signal())).resolves.toBeUndefined()
    expect(ok.calls[1]!.url).toBe('https://gitlab.com/api/v4/projects/group%2Fproject')
    const mismatch = mock(call => call.url.endsWith('/user') ? json({ username: 'alice' }) : json({ path_with_namespace: 'someone/else' }))
    await expect(new GitlabProvider(config(), mismatch.request).test(signal())).rejects.toThrow('does not match the mapping')
    const anonymous = mock(() => json({ name: 'no username' }))
    await expect(new GitlabProvider(config(), anonymous.request).test(signal())).rejects.toThrow('does not identify an account')
  })
  it('discovers projects with the documented membership listing', async () => {
    const { calls, request } = mock(() => json([{ path_with_namespace: 'group/project' }, { path_with_namespace: 'group/other' }]))
    expect(await new GitlabProvider(config(), request).listProjects(signal())).toEqual([
      { id: 'group/project', name: 'group/project' }, { id: 'group/other', name: 'group/other' },
    ])
    expect(calls[0]!.url).toBe('https://gitlab.com/api/v4/projects?membership=true&per_page=100&page=1&archived=false&order_by=id&sort=asc')
  })
})

describe('GitLab provider writes', () => {
  it('creates an issue from card fields', async () => {
    const { calls, request } = mock(() => json(issue({ iid: 21, title: 'New issue', description: 'Body' }), 201))
    const created = await new GitlabProvider(config(), request)
      .createItem('group/project', { title: 'New issue', description: 'Body', urgency: 'normal' }, signal())
    expect(calls[0]).toMatchObject({
      url: 'https://gitlab.com/api/v4/projects/group%2Fproject/issues', method: 'POST',
      body: { title: 'New issue', description: 'Body' },
    })
    expect(created).toMatchObject({ id: '21', type: 'issue', title: 'New issue', description: 'Body' })
  })
  it('updates and closes through state_event, never reopening an issue', async () => {
    const { calls, request } = mock(() => json(issue({ state: 'closed' })))
    const provider = new GitlabProvider(config(), request)
    const updated = await provider.updateItem('group/project', 'issue', '12', { title: 'Renamed', description: 'New body', close: 'completed' }, signal())
    expect(calls[0]).toMatchObject({
      url: 'https://gitlab.com/api/v4/projects/group%2Fproject/issues/12', method: 'PUT',
      body: { title: 'Renamed', description: 'New body', state_event: 'close' },
    })
    expect(updated).toMatchObject({ id: '12', closed: true, status: 'closed' })
    await expect(provider.updateItem('group/project', 'issue', '12', {}, signal())).rejects.toThrow('empty GitLab update')
    await expect(provider.updateItem('group/project', 'merge_request', '12', { title: 'x' }, signal()))
      .rejects.toThrow('unsupported GitLab work item')
  })
})

describe('GitLab provider failures', () => {
  it('maps transport failures without leaking response bodies or the token', async () => {
    const expected: Array<[number, string]> = [
      [401, 'GitLab rejected the token (HTTP 401)'],
      [403, 'GitLab denied access; check the token scope (HTTP 403)'],
      [404, 'GitLab project or issue not found or not accessible (HTTP 404)'],
    ]
    for (const [status, message] of expected) {
      const { request } = mock(() => json({ message: 'leaked-server-body private-token' }, status))
      const error = await failure(() => new GitlabProvider(config(), request).getItems('group/project', signal()))
      expect(error.message).toBe(message)
      expect(error.message).not.toContain('private-token')
      expect(error.message).not.toContain('leaked-server-body')
    }
  })
  it('rejects malformed payloads instead of importing partial items', async () => {
    const notAList = mock(() => json({ message: 'oops' }))
    await expect(new GitlabProvider(config(), notAList.request).getItems('group/project', signal()))
      .rejects.toThrow('invalid GitLab issue list')
    const noIid = mock(() => json([issue({ iid: '12' })]))
    await expect(new GitlabProvider(config(), noIid.request).getItems('group/project', signal()))
      .rejects.toThrow('invalid GitLab issue iid')
    const badState = mock(() => json([issue({ state: 'merged' })]))
    await expect(new GitlabProvider(config(), badState.request).getItems('group/project', signal()))
      .rejects.toThrow('invalid GitLab issue state')
    const badUrl = mock(() => json([issue({ web_url: 'ftp://gitlab.com/x' })]))
    await expect(new GitlabProvider(config(), badUrl.request).getItems('group/project', signal()))
      .rejects.toThrow('invalid GitLab issue URL')
    const badProject = mock(() => json([{ path_with_namespace: 'not-a-project' }]))
    await expect(new GitlabProvider(config(), badProject.request).listProjects(signal()))
      .rejects.toThrow('invalid GitLab project identity')
  })
})

import { describe, expect, it, vi } from 'vitest'
import { GiteaProvider } from '../src/host/gitea.ts'
import { assertProviderContract } from '../src/host/external-provider.ts'
import { createBuiltinProviders } from '../src/host/external-providers.ts'
import { adapterDirectionsOf, adapterOperationsOf, type ExternalConfig } from '../src/shared/external.ts'

const config = (overrides: Partial<ExternalConfig> = {}): ExternalConfig => ({
  id: 'conn', provider: 'gitea', baseUrl: 'https://gitea.com/api/v1', account: 'alice', authMode: 'token',
  credentials: { token: 'private-token' }, itemTypes: ['issue'],
  settings: { urgentLabels: 'urgent,p0', relaxedLabels: 'low,minor' },
  mappings: [{ projectId: 'owner/repo', workspaceId: 'ws' }], intervalMinutes: 0, since: '', importStatus: 'backlog',
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
  number: 12, title: 'Fix the thing', body: 'Details', state: 'open',
  html_url: 'https://gitea.com/owner/repo/issues/12',
  labels: [{ name: 'bug' }, { name: 'urgent' }],
  assignees: [{ login: 'alice' }, { login: 'bob' }],
  created_at: '2026-01-02T03:04:05Z', updated_at: '2026-01-03T04:05:06Z', ...overrides,
})
async function failure(run: () => Promise<unknown>): Promise<Error> {
  try { await run() } catch (error) { return error as Error }
  throw new Error('expected a rejection')
}

describe('Gitea/Forgejo provider registration', () => {
  it('declares a write-capable forge adapter with its exact contract operations', () => {
    const descriptor = createBuiltinProviders().list().find(provider => provider.id === 'gitea')!
    expect(descriptor).toMatchObject({
      name: 'Gitea / Forgejo', scopeLabel: 'ext.repoScope', defaultBaseUrl: 'https://gitea.com/api/v1', contractVersion: 1, kind: 'forge',
      authModes: [{ id: 'token', label: 'ext.giteaToken', fields: [{ key: 'token', label: 'ext.giteaToken' }] }],
      capabilities: {
        itemTypes: ['issue'], projectDiscovery: true, accountDiscovery: true, pagination: 'page', incremental: false,
        write: true, dedupe: true, events: 'poll', limits: { pageSize: 50, maxPages: 1000, requestTimeoutMs: 30_000 },
      },
    })
    expect(adapterOperationsOf(descriptor)).toEqual(['validateConnection', 'getCapabilities', 'discoverProjects', 'listWorkItems',
      'getWorkItem', 'createWorkItem', 'updateWorkItem'])
    expect(adapterDirectionsOf(descriptor)).toEqual(['inbound', 'outbound'])
  })
  it('creates a provider that satisfies assertProviderContract', () => {
    const registry = createBuiltinProviders()
    const provider = registry.create(config())
    expect(provider).toBeInstanceOf(GiteaProvider)
    expect(() => assertProviderContract(registry.get('gitea').descriptor, provider)).not.toThrow()
  })
  it('rejects scopes that are not owner/repo before any request', () => {
    expect(() => createBuiltinProviders().create(config({ mappings: [{ projectId: 'not-a-repo', workspaceId: 'ws' }] })))
      .toThrow('owner/repo')
    expect(() => createBuiltinProviders().create(config({ mappings: [{ projectId: 'owner/repo/extra', workspaceId: 'ws' }] })))
      .toThrow('owner/repo')
  })
  it('requires a token authentication mode', () => {
    expect(() => new GiteaProvider(config({ authMode: 'basic' }))).toThrow('requires a token')
    expect(() => new GiteaProvider(config({ credentials: {} }))).toThrow('requires a token')
  })
})

describe('Gitea/Forgejo provider reads', () => {
  it('paginates issues, skips pull requests and normalizes every field', async () => {
    const issues = Array.from({ length: 49 }, (_, index) => issue({
      number: index + 1, title: `Issue ${index + 1}`, html_url: `https://gitea.com/owner/repo/issues/${index + 1}`,
    }))
    // A pull request shares the issue shape and must never be imported.
    const pageOne = [...issues, issue({ number: 100, title: 'Open PR', pull_request: { merged: false } })]
    const { calls, handler, request } = mock(call => call.url.endsWith('page=1')
      ? json(pageOne)
      : json([issue({ number: 101, title: 'Last', html_url: 'https://gitea.com/owner/repo/issues/101' })]))
    const items = await new GiteaProvider(config(), request).getItems('owner/repo', signal())
    expect(handler).toHaveBeenCalledTimes(2)
    expect(items.map(item => item.id)).toEqual([...Array.from({ length: 49 }, (_, index) => String(index + 1)), '101'])
    expect(items[0]).toEqual({
      projectId: 'owner/repo', type: 'issue', id: '1', title: 'Issue 1', description: 'Details',
      priority: 'bug,urgent', status: 'open', assignedTo: 'alice', assignees: ['alice', 'bob'],
      closed: false, urgency: 'urgent', url: 'https://gitea.com/owner/repo/issues/1', revision: '2026-01-03T04:05:06Z',
    })
    expect(calls[0]!.url).toBe('https://gitea.com/api/v1/repos/owner/repo/issues?state=all&type=issues&limit=50&page=1')
    expect(calls[0]!.headers.authorization).toBe('token private-token')
    expect(calls[1]!.url).toContain('page=2')
  })
  it('normalizes closed, unassigned and body-less issues', async () => {
    const { request } = mock(() => json([issue({ number: 3, state: 'closed', body: null, labels: ['low'], assignees: [], updated_at: undefined })]))
    const [item] = await new GiteaProvider(config(), request).getItems('owner/repo', signal())
    expect(item).toMatchObject({ id: '3', status: 'closed', closed: true, assignedTo: '', assignees: [], description: '', urgency: 'relaxed', priority: 'low' })
    expect(item!.revision).toBeUndefined()
  })
  it('skips issues created before the configured start date unless already linked', async () => {
    const old = issue({ number: 1, title: 'Old', html_url: 'https://gitea.com/owner/repo/issues/1', created_at: '2025-12-01T00:00:00Z' })
    const fresh = issue({ number: 2, title: 'Fresh', html_url: 'https://gitea.com/owner/repo/issues/2', created_at: '2026-02-01T00:00:00Z' })
    const { request } = mock(() => json([old, fresh]))
    const provider = new GiteaProvider(config({ since: '2026-01-01' }), request)
    expect((await provider.getItems('owner/repo', signal())).map(item => item.id)).toEqual(['2'])
    // An already linked item keeps receiving updates even when it predates `since`.
    const existing = new Map([['["issue","1"]', { item: { projectId: 'owner/repo', type: 'issue', id: '1', title: 'Old', description: '',
      urgency: 'normal' as const, priority: '', status: 'open', assignedTo: '', assignees: [], closed: false,
      url: 'https://gitea.com/owner/repo/issues/1' }, metadataOnly: false }]])
    expect((await provider.getItems('owner/repo', signal(), { existing })).map(item => item.id)).toEqual(['1', '2'])
  })
  it('reads one issue by index and refuses pull requests', async () => {
    const { calls, request } = mock(call => call.url.endsWith('/issues/8')
      ? json(issue({ number: 8, pull_request: { merged: false } }))
      : json(issue({ number: 7 })))
    const provider = new GiteaProvider(config(), request)
    expect(await provider.getItem('owner/repo', 'issue', '7', signal())).toMatchObject({ id: '7', type: 'issue' })
    expect(calls[0]!.url).toBe('https://gitea.com/api/v1/repos/owner/repo/issues/7')
    await expect(provider.getItem('owner/repo', 'issue', '8', signal())).rejects.toThrow('pull requests are not work items')
    await expect(provider.getItem('owner/repo', 'pull_request', '7', signal())).rejects.toThrow('unsupported Gitea work item')
    await expect(provider.getItem('owner/repo', 'issue', 'seven', signal())).rejects.toThrow('invalid Gitea issue number')
  })
  it('verifies the account and every mapped repository during a connection test', async () => {
    const ok = mock(call => call.url.endsWith('/user') ? json({ login: 'alice' }) : json({ full_name: 'owner/repo' }))
    await expect(new GiteaProvider(config(), ok.request).test(signal())).resolves.toBeUndefined()
    expect(ok.calls[1]!.url).toBe('https://gitea.com/api/v1/repos/owner/repo')
    const mismatch = mock(call => call.url.endsWith('/user') ? json({ login: 'alice' }) : json({ full_name: 'someone/else' }))
    await expect(new GiteaProvider(config(), mismatch.request).test(signal())).rejects.toThrow('does not match the mapping')
    const anonymous = mock(() => json({ full_name: 'no login' }))
    await expect(new GiteaProvider(config(), anonymous.request).test(signal())).rejects.toThrow('does not identify an account')
  })
  it('deduplicates discovery results across the user repository listing', async () => {
    const { calls, request } = mock(() => json([
      { full_name: 'owner/repo' }, { full_name: 'owner/repo' }, { full_name: 'owner/other' },
    ]))
    expect(await new GiteaProvider(config(), request).listProjects(signal())).toEqual([
      { id: 'owner/repo', name: 'owner/repo' }, { id: 'owner/other', name: 'owner/other' },
    ])
    expect(calls[0]!.url).toBe('https://gitea.com/api/v1/user/repos?limit=50&page=1')
  })
  it('falls back to the search endpoint when the user listing is unavailable', async () => {
    const { calls, request } = mock(call => call.url.includes('/user/repos')
      ? json({ message: 'Not Found' }, 404)
      : json({ ok: true, data: [{ full_name: 'owner/repo' }, { full_name: 'owner/repo' }] }))
    expect(await new GiteaProvider(config(), request).listProjects(signal())).toEqual([{ id: 'owner/repo', name: 'owner/repo' }])
    expect(calls[0]!.url).toBe('https://gitea.com/api/v1/user/repos?limit=50&page=1')
    expect(calls[1]!.url).toBe('https://gitea.com/api/v1/repos/search?limit=50&page=1')
  })
})

describe('Gitea/Forgejo provider writes', () => {
  it('creates an issue from card fields', async () => {
    const { calls, request } = mock(() => json(issue({ number: 21, title: 'New issue', body: 'Body' }), 201))
    const created = await new GiteaProvider(config(), request)
      .createItem('owner/repo', { title: 'New issue', description: 'Body', urgency: 'normal' }, signal())
    expect(calls[0]).toMatchObject({
      url: 'https://gitea.com/api/v1/repos/owner/repo/issues', method: 'POST',
      body: { title: 'New issue', body: 'Body' },
    })
    expect(created).toMatchObject({ id: '21', type: 'issue', title: 'New issue', description: 'Body' })
  })
  it('updates and closes through the state field', async () => {
    const { calls, request } = mock(() => json(issue({ state: 'closed' })))
    const provider = new GiteaProvider(config(), request)
    const updated = await provider.updateItem('owner/repo', 'issue', '12', { title: 'Renamed', description: 'New body', close: 'completed' }, signal())
    expect(calls[0]).toMatchObject({
      url: 'https://gitea.com/api/v1/repos/owner/repo/issues/12', method: 'PATCH',
      body: { title: 'Renamed', body: 'New body', state: 'closed' },
    })
    expect(updated).toMatchObject({ id: '12', closed: true, status: 'closed' })
    await expect(provider.updateItem('owner/repo', 'issue', '12', {}, signal())).rejects.toThrow('empty Gitea update')
    await expect(provider.updateItem('owner/repo', 'pull_request', '12', { title: 'x' }, signal()))
      .rejects.toThrow('unsupported Gitea work item')
  })
})

describe('Gitea/Forgejo provider failures', () => {
  it('maps transport failures without leaking response bodies or the token', async () => {
    const expected: Array<[number, string]> = [
      [401, 'Gitea rejected the token (HTTP 401)'],
      [403, 'Gitea denied access; check the token scope (HTTP 403)'],
      [404, 'Gitea repository or issue not found or not accessible (HTTP 404)'],
    ]
    for (const [status, message] of expected) {
      const { request } = mock(() => json({ message: 'leaked-server-body private-token' }, status))
      const error = await failure(() => new GiteaProvider(config(), request).getItems('owner/repo', signal()))
      expect(error.message).toBe(message)
      expect(error.message).not.toContain('private-token')
      expect(error.message).not.toContain('leaked-server-body')
    }
  })
  it('rejects malformed payloads instead of importing partial items', async () => {
    const notAList = mock(() => json({ message: 'oops' }))
    await expect(new GiteaProvider(config(), notAList.request).getItems('owner/repo', signal()))
      .rejects.toThrow('invalid Gitea issue list')
    const noNumber = mock(() => json([issue({ number: '12' })]))
    await expect(new GiteaProvider(config(), noNumber.request).getItems('owner/repo', signal()))
      .rejects.toThrow('invalid Gitea issue number')
    const badState = mock(() => json([issue({ state: 'merged' })]))
    await expect(new GiteaProvider(config(), badState.request).getItems('owner/repo', signal()))
      .rejects.toThrow('invalid Gitea issue state')
    const badUrl = mock(() => json([issue({ html_url: 'ftp://gitea.com/x' })]))
    await expect(new GiteaProvider(config(), badUrl.request).getItems('owner/repo', signal()))
      .rejects.toThrow('invalid Gitea issue URL')
    const badProject = mock(() => json([{ full_name: 'not-a-repository' }]))
    await expect(new GiteaProvider(config(), badProject.request).listProjects(signal()))
      .rejects.toThrow('invalid Gitea repository identity')
  })
})

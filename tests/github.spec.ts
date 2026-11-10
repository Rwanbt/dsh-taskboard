import { describe, expect, it } from 'vitest'
import { GithubProvider } from '../src/host/github.ts'
import { createBuiltinProviders } from '../src/host/external-providers.ts'
import { externalGet } from '../src/host/external-http.ts'
import type { ExternalConfig, ExternalItem } from '../src/shared/external.ts'

const config = (overrides: Partial<ExternalConfig> = {}): ExternalConfig => ({
  id: 'conn', provider: 'github', baseUrl: 'https://api.github.com', account: 'octocat', authMode: 'token',
  credentials: { token: 'private-token' }, itemTypes: ['issue'],
  settings: { urgentLabels: 'urgent,priority: urgent,p0,p1', relaxedLabels: 'low,minor' },
  mappings: [{ projectId: 'octo/repo', workspaceId: 'ws' }], intervalMinutes: 0, since: '', importStatus: 'backlog',
  ...overrides,
})

type Call = { url: string; method: string; headers: Record<string, string>; body?: unknown }
function mock(resolve: (call: Call) => Response | undefined): { calls: Call[]; request: typeof fetch } {
  const calls: Call[] = []
  const request = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const headers = Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>).map(([key, value]) => [key.toLowerCase(), value]))
    const call: Call = { url: String(input), method: init?.method ?? 'GET', headers, ...(init?.body === undefined ? {} : { body: JSON.parse(String(init.body)) }) }
    calls.push(call)
    const response = resolve(call)
    if (response === undefined) throw new Error(`unexpected request ${call.method} ${call.url}`)
    return response
  }) as typeof fetch
  return { calls, request }
}
const json = (value: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json', ...headers } })
const issue = (overrides: Record<string, unknown> = {}) => ({
  number: 12, title: 'Fix the thing', body: 'Details', state: 'open',
  html_url: 'https://github.com/octo/repo/issues/12', labels: [{ name: 'bug' }, { name: 'urgent' }],
  assignees: [{ login: 'octocat' }], assignee: { login: 'octocat' }, created_at: '2026-01-02T03:04:05Z', ...overrides,
})

describe('GitHub provider registration', () => {
  it('exposes a write-capable issue provider next to the read-only trackers', () => {
    const providers = createBuiltinProviders().list()
    const github = providers.find(provider => provider.id === 'github')!
    expect(github).toMatchObject({
      name: 'GitHub', scopeLabel: 'ext.repoScope', defaultBaseUrl: 'https://api.github.com',
      capabilities: { itemTypes: ['issue'], projectDiscovery: true, accountDiscovery: true, write: true },
    })
    expect(providers.filter(provider => provider.capabilities.write === true).map(provider => provider.id)).toEqual(['github'])
  })
  it('rejects non repository scopes before any request', () => {
    expect(() => createBuiltinProviders().create(config({ mappings: [{ projectId: 'not-a-repo', workspaceId: 'ws' }] })))
      .toThrow('owner/repo')
  })
})

describe('GitHub provider reads', () => {
  it('normalizes issues, skips pull requests and maps label priorities', async () => {
    const { calls, request } = mock(() => json([
      issue(),
      issue({ number: 13, pull_request: { url: 'https://api.github.com/pulls/13' } }),
      { number: 14, title: 'Chore', body: null, state: 'closed', html_url: 'https://github.com/octo/repo/issues/14', labels: [{ name: 'low' }], assignees: [], created_at: '2026-01-03T00:00:00Z' },
    ]))
    const items = await new GithubProvider(config(), request).getItems('octo/repo', AbortSignal.timeout(1000))
    expect(items.map(item => item.id)).toEqual(['12', '14'])
    expect(items[0]).toMatchObject({
      projectId: 'octo/repo', type: 'issue', title: 'Fix the thing', description: 'Details', status: 'open',
      priority: 'bug,urgent', urgency: 'urgent', assignedTo: 'octocat', assignees: ['octocat'], closed: false,
    })
    expect(items[1]).toMatchObject({ urgency: 'relaxed', closed: true, description: '', assignees: [] })
    expect(calls[0]!.url).toBe('https://api.github.com/repos/octo/repo/issues?state=all&per_page=100&page=1&sort=created&direction=asc')
    expect(calls[0]!.headers.authorization).toBe('Bearer private-token')
    expect(calls[0]!.headers['x-github-api-version']).toBe('2022-11-28')
  })
  it('skips issues created before the configured start date unless already linked', async () => {
    const old = issue({ number: 1, created_at: '2025-12-01T00:00:00Z' })
    const fresh = issue({ number: 2, created_at: '2026-02-01T00:00:00Z' })
    const { request } = mock(() => json([old, fresh]))
    const provider = new GithubProvider(config({ since: '2026-01-01' }), request)
    expect((await provider.getItems('octo/repo', AbortSignal.timeout(1000))).map(item => item.id)).toEqual(['2'])
    // An already linked item keeps receiving updates even when it predates `since`.
    const linkedItem: ExternalItem = {
      projectId: 'octo/repo', type: 'issue', id: '1', title: 'Old', description: '', urgency: 'normal', priority: '',
      status: 'open', assignedTo: 'octocat', assignees: ['octocat'], closed: false, url: 'https://github.com/octo/repo/issues/1',
    }
    const existing = new Map([['["issue","1"]', { item: linkedItem, metadataOnly: false }]])
    const linked = await provider.getItems('octo/repo', AbortSignal.timeout(1000), { existing })
    expect(linked.map(item => item.id)).toEqual(['1', '2'])
  })
  it('discovers repositories and the token account', async () => {
    const { calls, request } = mock(call => call.url.endsWith('/user')
      ? json({ login: 'octocat', name: 'The Octocat' })
      : json([{ full_name: 'octo/repo' }, { full_name: 'octo/infra' }]))
    const provider = new GithubProvider(config(), request)
    expect(await provider.getAccount(AbortSignal.timeout(1000))).toEqual({ account: 'octocat', name: 'octocat' })
    expect(await provider.listProjects(AbortSignal.timeout(1000))).toEqual([
      { id: 'octo/repo', name: 'octo/repo' }, { id: 'octo/infra', name: 'octo/infra' },
    ])
    expect(calls[1]!.url).toContain('/user/repos?per_page=100&page=1')
  })
  it('verifies repository access during a connection test', async () => {
    const mismatch = mock(call => call.url.endsWith('/user') ? json({ login: 'octocat' }) : json({ full_name: 'someone/else' }))
    await expect(new GithubProvider(config(), mismatch.request).test(AbortSignal.timeout(1000))).rejects.toThrow('does not match')
    const ok = mock(call => call.url.endsWith('/user') ? json({ login: 'octocat' }) : json({ full_name: 'octo/repo' }))
    await expect(new GithubProvider(config(), ok.request).test(AbortSignal.timeout(1000))).resolves.toBeUndefined()
  })
})

describe('GitHub provider writes', () => {
  it('creates an issue from card fields', async () => {
    const { calls, request } = mock(() => json(issue({ number: 21, title: 'New issue', body: 'Body' }), 201))
    const created = await new GithubProvider(config(), request).createItem('octo/repo', { title: 'New issue', description: 'Body', urgency: 'normal' }, AbortSignal.timeout(1000))
    expect(calls[0]).toMatchObject({ url: 'https://api.github.com/repos/octo/repo/issues', method: 'POST', body: { title: 'New issue', body: 'Body' } })
    expect(created).toMatchObject({ id: '21', type: 'issue', title: 'New issue' })
  })
  it('closes an issue with the matching state reason', async () => {
    const { calls, request } = mock(() => json(issue({ state: 'closed' })))
    const provider = new GithubProvider(config(), request)
    await provider.updateItem('octo/repo', 'issue', '12', { title: 'Renamed', description: 'New body', close: 'not_planned' }, AbortSignal.timeout(1000))
    expect(calls[0]).toMatchObject({
      url: 'https://api.github.com/repos/octo/repo/issues/12', method: 'PATCH',
      body: { title: 'Renamed', body: 'New body', state: 'closed', state_reason: 'not_planned' },
    })
    await expect(provider.updateItem('octo/repo', 'issue', '12', {}, AbortSignal.timeout(1000))).rejects.toThrow('empty GitHub update')
  })
  it('maps transport failures without leaking bodies', async () => {
    const unauthorized = mock(() => json({ message: 'Bad credentials private-token' }, 401))
    await expect(new GithubProvider(config(), unauthorized.request).getItems('octo/repo', AbortSignal.timeout(1000)))
      .rejects.toThrow('GitHub rejected the token (HTTP 401)')
    const missing = mock(() => json({ message: 'Not Found' }, 404))
    await expect(new GithubProvider(config(), missing.request).getItems('octo/repo', AbortSignal.timeout(1000)))
      .rejects.toThrow('not found or not accessible')
    let attempts = 0
    const throttled = mock(call => {
      if (call.url.includes('/issues?') && attempts++ === 0) return json({ message: 'rate limited' }, 429, { 'retry-after': '0' })
      return json([issue()])
    })
    // The first response is retried by the shared transport; the retry succeeds.
    const items = await new GithubProvider(config(), throttled.request).getItems('octo/repo', AbortSignal.timeout(2000))
    expect(items).toHaveLength(1)
  })
  it('rejects malformed payloads instead of importing partial items', async () => {
    const { request } = mock(() => json([issue({ number: '12' })]))
    await expect(new GithubProvider(config(), request).getItems('octo/repo', AbortSignal.timeout(1000)))
      .rejects.toThrow('invalid GitHub issue number')
    const emptyTitle = mock(() => json([issue({ title: '  ' })]))
    await expect(new GithubProvider(config(), emptyTitle.request).getItems('octo/repo', AbortSignal.timeout(1000)))
      .rejects.toThrow('invalid GitHub issue title')
  })
})

describe('external transport', () => {
  it('keeps the read-only helper compatible', async () => {
    const { request } = mock(() => json({ ok: true }))
    await expect(externalGet(request, 'https://api.github.com/user', {}, AbortSignal.timeout(1000))).resolves.toEqual({ ok: true })
  })
})

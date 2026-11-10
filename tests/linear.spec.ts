import { describe, expect, it } from 'vitest'
import { LinearProvider, linearProviderDefinition } from '../src/host/linear.ts'
import { ExternalProviderRegistry } from '../src/host/external-provider.ts'
import type { ExternalConfig } from '../src/shared/external.ts'

const registry = (): ExternalProviderRegistry => new ExternalProviderRegistry().register(linearProviderDefinition())

const config = (overrides: Partial<ExternalConfig> = {}): ExternalConfig => ({
  id: 'conn', provider: 'linear', baseUrl: 'https://api.linear.app/graphql', account: 'me@example.com', authMode: 'token',
  credentials: { apiKey: 'lin_api_secret' }, itemTypes: ['issue'], settings: {},
  mappings: [{ projectId: 'ENG', workspaceId: 'ws' }], intervalMinutes: 0, since: '', importStatus: 'backlog',
  ...overrides,
})

type Call = {
  url: string
  method: string
  headers: Record<string, string>
  body: { query: string; variables: Record<string, unknown> }
}
function mock(resolve: (call: Call) => Response | undefined): { calls: Call[]; request: typeof fetch } {
  const calls: Call[] = []
  const request = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const headers = Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>).map(([key, value]) => [key.toLowerCase(), value]))
    const call: Call = {
      url: String(input), method: init?.method ?? 'GET', headers,
      body: JSON.parse(String(init?.body ?? '{}')) as Call['body'],
    }
    calls.push(call)
    const response = resolve(call)
    if (response === undefined) throw new Error(`unexpected request ${call.method} ${call.url}`)
    return response
  }) as typeof fetch
  return { calls, request }
}
const json = (value: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json', ...headers } })
const data = (payload: unknown) => json({ data: payload })

const issue = (overrides: Record<string, unknown> = {}) => ({
  id: 'uuid-1', identifier: 'ENG-12', title: 'Fix the thing', description: 'Details',
  state: { name: 'In Progress', type: 'started' }, priority: 2,
  assignee: { displayName: 'Alice' },
  labels: { nodes: [{ name: 'bug' }, { name: 'backend' }] },
  url: 'https://linear.app/acme/issue/ENG-12/fix-the-thing',
  updatedAt: '2026-02-01T10:00:00.000Z',
  ...overrides,
})

describe('Linear provider registration', () => {
  it('exposes the contract v1 planning descriptor', () => {
    const { descriptor } = linearProviderDefinition()
    expect(descriptor).toMatchObject({
      id: 'linear', name: 'Linear', scopeLabel: 'ext.linearTeamKey',
      defaultBaseUrl: 'https://api.linear.app/graphql', contractVersion: 1, kind: 'planning',
      authModes: [{ id: 'token', label: 'ext.linearToken', fields: [{ key: 'apiKey', label: 'ext.linearApiKey' }] }],
    })
    expect(descriptor.capabilities).toMatchObject({
      itemTypes: ['issue'], projectDiscovery: true, accountDiscovery: false, pagination: 'cursor', incremental: false,
      write: true, dedupe: false, directions: ['inbound', 'outbound'], events: 'poll',
      limits: { pageSize: 50, maxPages: 1000, requestTimeoutMs: 30_000 },
    })
    expect(descriptor.capabilities.operations).toEqual([
      'validateConnection', 'getCapabilities', 'discoverProjects', 'listWorkItems', 'getWorkItem',
      'createWorkItem', 'updateWorkItem',
    ])
  })

  it('creates a contract-conforming provider through the registry', () => {
    expect(registry().create(config())).toBeInstanceOf(LinearProvider)
  })

  it('rejects unsupported auth modes, invalid mappings and missing credentials', () => {
    expect(() => registry().create(config({ authMode: 'basic' }))).toThrow('unsupported Linear authentication mode')
    expect(() => registry().create(config({ mappings: [{ projectId: 'eng', workspaceId: 'ws' }] }))).toThrow('uppercase')
    expect(() => registry().create(config({ credentials: {} }))).toThrow('Linear requires an API key')
    expect(() => new LinearProvider(config({ baseUrl: '' }))).toThrow('Linear requires a base URL')
  })
})

describe('Linear provider reads', () => {
  it('sends the raw API key (no Bearer) and normalizes cursor pages', async () => {
    const { calls, request } = mock(call => call.body.variables.cursor === undefined
      ? data({
        issues: {
          pageInfo: { hasNextPage: true, endCursor: 'cursor-2' },
          nodes: [
            issue(),
            issue({
              id: 'uuid-2', identifier: 'ENG-13', state: { name: 'Done', type: 'completed' }, priority: 4,
              assignee: null, labels: { nodes: [{ name: 'ops' }] },
            }),
          ],
        },
      })
      : data({
        issues: {
          pageInfo: { hasNextPage: false, endCursor: null },
          nodes: [issue({ id: 'uuid-3', identifier: 'ENG-3', priority: 0, description: null, labels: { nodes: [] } })],
        },
      }))
    const items = await new LinearProvider(config(), request).getItems('ENG', AbortSignal.timeout(1000))
    expect(items.map(item => item.id)).toEqual(['ENG-12', 'ENG-13', 'ENG-3'])
    expect(items[0]).toMatchObject({
      projectId: 'ENG', type: 'issue', id: 'ENG-12', title: 'Fix the thing', description: 'Details',
      status: 'In Progress', priority: 'bug,backend,2', urgency: 'normal', assignedTo: 'Alice', assignees: ['Alice'],
      closed: false, url: 'https://linear.app/acme/issue/ENG-12/fix-the-thing', revision: '2026-02-01T10:00:00.000Z',
    })
    expect(items[1]).toMatchObject({
      id: 'ENG-13', status: 'Done', closed: true, urgency: 'relaxed', priority: 'ops,4', assignedTo: '', assignees: [],
    })
    expect(items[2]).toMatchObject({ id: 'ENG-3', description: '', priority: '', urgency: 'normal' })

    expect(calls[0]).toMatchObject({ url: 'https://api.linear.app/graphql', method: 'POST' })
    expect(calls[0]!.headers.authorization).toBe('lin_api_secret')
    expect(calls[0]!.body.query).toContain('issues(')
    expect(calls[0]!.body.variables).toMatchObject({ teamKey: 'ENG' })
    expect(calls[1]!.body.variables).toMatchObject({ teamKey: 'ENG', cursor: 'cursor-2' })
  })

  it('treats priority 1 as urgent and a canceled state as closed', async () => {
    const { request } = mock(() => data({
      issues: {
        pageInfo: { hasNextPage: false, endCursor: null },
        nodes: [issue({ priority: 1, state: { name: 'Canceled', type: 'canceled' } })],
      },
    }))
    const [item] = await new LinearProvider(config(), request).getItems('ENG', AbortSignal.timeout(1000))
    expect(item).toMatchObject({ urgency: 'urgent', closed: true, status: 'Canceled' })
  })

  it('discovers teams and verifies the API key with a viewer query', async () => {
    const { calls, request } = mock(call => call.body.query.includes('viewer')
      ? data({ viewer: { id: 'user-1', name: 'Me' } })
      : data({ teams: { nodes: [{ id: 'team-1', key: 'ENG', name: 'Engineering' }, { id: 'team-2', key: 'OPS', name: 'Ops' }] } }))
    const provider = new LinearProvider(config(), request)
    await expect(provider.test(AbortSignal.timeout(1000))).resolves.toBeUndefined()
    expect(await provider.listProjects(AbortSignal.timeout(1000))).toEqual([
      { id: 'ENG', name: 'Engineering' }, { id: 'OPS', name: 'Ops' },
    ])
    expect(calls[1]!.body.query).toContain('teams(first: 100)')

    const anonymous = mock(() => data({ viewer: null }))
    await expect(new LinearProvider(config(), anonymous.request).test(AbortSignal.timeout(1000))).rejects.toThrow('invalid Linear viewer response')
  })

  it('reads one issue and enforces the mapped team scope', async () => {
    const { calls, request } = mock(() => data({ issue: issue() }))
    const item = await new LinearProvider(config(), request).getItem('ENG', 'issue', 'ENG-12', AbortSignal.timeout(1000))
    expect(item).toMatchObject({ id: 'ENG-12', projectId: 'ENG', type: 'issue' })
    expect(calls[0]!.body.query).toContain('issue(id:')
    expect(calls[0]!.body.variables).toEqual({ id: 'ENG-12' })

    const missing = new LinearProvider(config(), mock(() => data({ issue: null })).request)
    await expect(missing.getItem('ENG', 'issue', 'ENG-12', AbortSignal.timeout(1000))).resolves.toBeUndefined()
    await expect(missing.getItem('ENG', 'issue', 'OPS-12', AbortSignal.timeout(1000))).rejects.toThrow('does not belong to the mapped team')
    await expect(missing.getItem('ENG', 'project', 'ENG-12', AbortSignal.timeout(1000))).rejects.toThrow('unsupported Linear work item')
  })
})

describe('Linear provider writes', () => {
  it('resolves the team id once, creates the issue and caches the team lookup', async () => {
    const { calls, request } = mock(call => call.body.query.includes('teams(first: 100)')
      ? data({ teams: { nodes: [{ id: 'team-1', key: 'ENG', name: 'Engineering' }] } })
      : data({ issueCreate: { success: true, issue: issue({ id: 'uuid-13', identifier: 'ENG-13', title: 'New issue' }) } }))
    const provider = new LinearProvider(config(), request)
    const created = await provider.createItem('ENG', { title: 'New issue', description: 'Body', urgency: 'normal' }, AbortSignal.timeout(1000))
    expect(calls[0]!.body.query).toContain('teams(first: 100)')
    expect(calls[1]).toMatchObject({ url: 'https://api.linear.app/graphql', method: 'POST' })
    expect(calls[1]!.body.query).toContain('issueCreate')
    expect(calls[1]!.body.variables).toMatchObject({ teamId: 'team-1', title: 'New issue', description: 'Body' })
    expect(created).toMatchObject({ id: 'ENG-13', title: 'New issue', projectId: 'ENG' })

    await provider.createItem('ENG', { title: 'Another issue', description: '', urgency: 'normal' }, AbortSignal.timeout(1000))
    expect(calls.filter(call => call.body.query.includes('teams(first: 100)'))).toHaveLength(1)
  })

  it('updates fields, resolves the completed state and returns the re-read issue', async () => {
    const { calls, request } = mock(call => {
      if (call.body.query.includes('states {') && call.body.query.includes('teams(')) {
        return data({
          teams: {
            nodes: [{
              id: 'team-1', key: 'ENG',
              states: {
                nodes: [
                  { id: 'state-todo', name: 'Todo', type: 'unstarted' },
                  { id: 'state-done', name: 'Done', type: 'completed' },
                ],
              },
            }],
          },
        })
      }
      if (call.body.query.includes('issueUpdate')) {
        return data({ issueUpdate: { success: true, issue: issue({ state: { name: 'Done', type: 'completed' } }) } })
      }
      return data({ issue: issue({ state: { name: 'Done', type: 'completed' } }) })
    })
    const updated = await new LinearProvider(config(), request).updateItem(
      'ENG', 'issue', 'ENG-12', { title: 'Renamed', description: 'New body', close: 'completed' }, AbortSignal.timeout(1000),
    )
    expect(calls[0]!.body.query).toContain('states {')
    expect(calls[0]!.body.variables).toEqual({ teamKey: 'ENG' })
    expect(calls[1]!.body.query).toContain('issueUpdate')
    expect(calls[1]!.body.variables).toMatchObject({
      id: 'ENG-12', input: { title: 'Renamed', description: 'New body', stateId: 'state-done' },
    })
    expect(calls[2]!.body.query).toContain('issue(id:')
    expect(updated).toMatchObject({ id: 'ENG-12', status: 'Done', closed: true })
  })

  it('maps not_planned to the canceled workflow state', async () => {
    const { calls, request } = mock(call => {
      if (call.body.query.includes('states {')) {
        return data({
          teams: {
            nodes: [{
              id: 'team-1', key: 'ENG',
              states: { nodes: [{ id: 'state-canceled', name: 'Canceled', type: 'canceled' }] },
            }],
          },
        })
      }
      if (call.body.query.includes('issueUpdate')) return data({ issueUpdate: { success: true, issue: issue() } })
      return data({ issue: issue({ state: { name: 'Canceled', type: 'canceled' } }) })
    })
    const updated = await new LinearProvider(config(), request).updateItem(
      'ENG', 'issue', 'ENG-12', { close: 'not_planned' }, AbortSignal.timeout(1000),
    )
    expect(calls[1]!.body.variables).toMatchObject({ input: { stateId: 'state-canceled' } })
    expect(updated).toMatchObject({ closed: true, status: 'Canceled' })
  })

  it('fails safely when the requested state category does not exist or the patch is empty', async () => {
    const noStates = new LinearProvider(config(), mock(() => data({
      teams: { nodes: [{ id: 'team-1', key: 'ENG', states: { nodes: [{ id: 'state-todo', name: 'Todo', type: 'unstarted' }] } }] },
    })).request)
    await expect(noStates.updateItem('ENG', 'issue', 'ENG-12', { close: 'completed' }, AbortSignal.timeout(1000)))
      .rejects.toThrow('no completed workflow state')
    await expect(noStates.updateItem('ENG', 'issue', 'ENG-12', { close: 'not_planned' }, AbortSignal.timeout(1000)))
      .rejects.toThrow('no canceled workflow state')
    await expect(new LinearProvider(config(), mock(() => data({})).request)
      .updateItem('ENG', 'issue', 'ENG-12', {}, AbortSignal.timeout(1000))).rejects.toThrow('empty Linear update')
  })

  it('keeps GraphQL error payloads generic and never leaks the API key', async () => {
    const { request } = mock(() => json({ errors: [{ message: 'Invalid API key lin_api_secret', extensions: { code: 'AUTHENTICATION_ERROR' } }] }))
    const error = await new LinearProvider(config(), request).getItems('ENG', AbortSignal.timeout(1000))
      .then(() => new Error('resolved'), (reason: unknown) => reason as Error)
    expect(error.message).toBe('Linear GraphQL request failed')
    expect(error.message).not.toContain('lin_api_secret')
  })

  it('maps HTTP failures to dedicated safe messages', async () => {
    const messageOf = async (status: number): Promise<string> => {
      const { request } = mock(() => json(
        { errors: [{ message: 'credential lin_api_secret rejected' }] },
        status,
        status === 429 ? { 'retry-after': '0' } : {},
      ))
      return new LinearProvider(config(), request).getItems('ENG', AbortSignal.timeout(5000))
        .then(() => '', (error: unknown) => (error as Error).message)
    }
    expect(await messageOf(401)).toBe('Linear rejected the API key (HTTP 401)')
    expect(await messageOf(403)).toBe('Linear denied access (HTTP 403)')
    expect(await messageOf(404)).toBe('Linear resource not found (HTTP 404)')
    expect(await messageOf(429)).toBe('Linear rate limit exceeded; retry later (HTTP 429)')
    expect(await messageOf(401)).not.toContain('lin_api_secret')
  })

  it('rejects malformed payloads and non-advancing cursors', async () => {
    const call = (payload: unknown) => new LinearProvider(config(), mock(() => payload as Response).request)
    await expect(call(json({ errors: [] })).getItems('ENG', AbortSignal.timeout(1000))).rejects.toThrow('invalid Linear response')
    await expect(call(json([])).getItems('ENG', AbortSignal.timeout(1000))).rejects.toThrow('invalid Linear response')
    await expect(call(data({})).getItems('ENG', AbortSignal.timeout(1000))).rejects.toThrow('invalid Linear issue list response')
    await expect(call(data({ issues: { pageInfo: { hasNextPage: 'yes' }, nodes: [] } }))
      .getItems('ENG', AbortSignal.timeout(1000))).rejects.toThrow('invalid Linear issue page')
    await expect(call(data({ issues: { pageInfo: { hasNextPage: true, endCursor: '' }, nodes: [] } }))
      .getItems('ENG', AbortSignal.timeout(1000))).rejects.toThrow('invalid Linear issue page')
    await expect(call(data({ teams: { nodes: 'nope' } })).listProjects(AbortSignal.timeout(1000)))
      .rejects.toThrow('invalid Linear team list')
    await expect(call(data({ teams: { nodes: [{ id: 'team-1', key: 'eng', name: 'Eng' }] } }))
      .listProjects(AbortSignal.timeout(1000))).rejects.toThrow('invalid Linear team key')
    await expect(call(data({ issue: issue({ title: '  ' }) }))
      .getItem('ENG', 'issue', 'ENG-12', AbortSignal.timeout(1000))).rejects.toThrow('invalid Linear issue title')
    await expect(call(data({ issue: issue({ url: 'javascript:alert(1)' }) }))
      .getItem('ENG', 'issue', 'ENG-12', AbortSignal.timeout(1000))).rejects.toThrow('invalid Linear issue URL')
  })
})

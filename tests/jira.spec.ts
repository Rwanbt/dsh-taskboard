import { describe, expect, it } from 'vitest'
import { JiraProvider, adfDoc, adfToText, jiraProviderDefinition } from '../src/host/jira.ts'
import { ExternalProviderRegistry } from '../src/host/external-provider.ts'
import type { ExternalConfig } from '../src/shared/external.ts'

const registry = (): ExternalProviderRegistry => new ExternalProviderRegistry().register(jiraProviderDefinition())

const config = (overrides: Partial<ExternalConfig> = {}): ExternalConfig => ({
  id: 'conn', provider: 'jira', baseUrl: 'https://acme.atlassian.net/rest/api/3', account: 'alice@example.com', authMode: 'basic',
  credentials: { email: 'alice@example.com', apiToken: 'jira-secret-token' }, itemTypes: ['issue'], settings: {},
  mappings: [{ projectId: 'PROJ', workspaceId: 'ws' }], intervalMinutes: 0, since: '', importStatus: 'backlog',
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
const noContent = () => new Response(null, { status: 204 })

const ADF_DESCRIPTION = {
  type: 'doc', version: 1, content: [
    { type: 'paragraph', content: [{ type: 'text', text: 'First paragraph.' }] },
    {
      type: 'bulletList', content: [
        { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'One' }] }] },
        { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Two' }] }] },
      ],
    },
    { type: 'codeBlock', content: [{ type: 'text', text: 'const answer = 42' }] },
  ],
}

const fields = (overrides: Record<string, unknown> = {}) => ({
  summary: 'Fix the thing',
  description: ADF_DESCRIPTION,
  status: { name: 'In Progress', statusCategory: { key: 'indeterminate' } },
  priority: { name: 'High' },
  assignee: { displayName: 'Alice' },
  labels: ['backend'],
  updated: '2026-02-01T10:00:00.000+0000',
  ...overrides,
})
const issue = (overrides: Record<string, unknown> = {}) => ({ id: '10001', key: 'PROJ-12', fields: fields(), ...overrides })

describe('Jira provider registration', () => {
  it('exposes the contract v1 planning descriptor', () => {
    const { descriptor } = jiraProviderDefinition()
    expect(descriptor).toMatchObject({
      id: 'jira', name: 'Jira', scopeLabel: 'ext.jiraProjectKey',
      defaultBaseUrl: 'https://your-domain.atlassian.net/rest/api/3', contractVersion: 1, kind: 'planning',
      authModes: [{
        id: 'basic', label: 'ext.jiraBasic',
        fields: [
          { key: 'email', label: 'ext.jiraEmail', secret: false },
          { key: 'apiToken', label: 'ext.jiraApiToken' },
        ],
      }],
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
    expect(registry().create(config())).toBeInstanceOf(JiraProvider)
  })

  it('rejects unsupported auth modes, invalid mappings and missing credentials', () => {
    expect(() => registry().create(config({ authMode: 'token' }))).toThrow('unsupported Jira authentication mode')
    expect(() => registry().create(config({ mappings: [{ projectId: 'proj', workspaceId: 'ws' }] }))).toThrow('uppercase')
    expect(() => registry().create(config({ credentials: {} }))).toThrow('Jira requires an email and an API token')
    expect(() => new JiraProvider(config({ baseUrl: '' }))).toThrow('Jira requires a base URL')
    expect(() => new JiraProvider(config({ baseUrl: 'ftp://acme.atlassian.net/rest/api/3' }))).toThrow('invalid Jira base URL')
  })
})

describe('Jira provider reads', () => {
  it('normalizes issues with a Basic header, JQL cursor query and browse URL', async () => {
    const { calls, request } = mock(() => json({
      issues: [
        issue(),
        issue({
          id: '10002', key: 'PROJ-13',
          fields: fields({
            summary: 'Low chore', description: null, priority: { name: 'Low' },
            status: { name: 'Done', statusCategory: { key: 'done' } }, assignee: null,
          }),
        }),
      ],
      isLast: true,
    }))
    const items = await new JiraProvider(config(), request).getItems('PROJ', AbortSignal.timeout(1000))
    expect(items).toHaveLength(2)
    expect(items[0]).toMatchObject({
      projectId: 'PROJ', type: 'issue', id: 'PROJ-12', title: 'Fix the thing', status: 'In Progress',
      priority: 'High', urgency: 'urgent', assignedTo: 'Alice', assignees: ['Alice'], closed: false,
      revision: '2026-02-01T10:00:00.000+0000', url: 'https://acme.atlassian.net/browse/PROJ-12',
    })
    expect(items[0]!.description).toContain('First paragraph.')
    expect(items[0]!.description).toContain('- One')
    expect(items[0]!.description).toContain('const answer = 42')
    expect(items[1]).toMatchObject({ id: 'PROJ-13', description: '', urgency: 'relaxed', closed: true, assignedTo: '', assignees: [] })

    expect(calls[0]!.method).toBe('GET')
    expect(calls[0]!.url.startsWith('https://acme.atlassian.net/rest/api/3/search/jql?')).toBe(true)
    const params = new URL(calls[0]!.url).searchParams
    expect(params.get('jql')).toBe('project=PROJ ORDER BY created ASC')
    expect(params.get('fields')).toBe('summary,description,status,priority,assignee,labels,updated')
    expect(params.get('maxResults')).toBe('50')
    expect(calls[0]!.headers.authorization).toBe(`Basic ${Buffer.from('alice@example.com:jira-secret-token', 'utf8').toString('base64')}`)
  })

  it('paginates with nextPageToken', async () => {
    const { calls, request } = mock(call => new URL(call.url).searchParams.get('nextPageToken') === null
      ? json({ issues: [issue({ key: 'PROJ-1' })], nextPageToken: 'token-2' })
      : json({ issues: [issue({ key: 'PROJ-2' })], isLast: true }))
    const items = await new JiraProvider(config(), request).getItems('PROJ', AbortSignal.timeout(1000))
    expect(items.map(item => item.id)).toEqual(['PROJ-1', 'PROJ-2'])
    expect(new URL(calls[1]!.url).searchParams.get('nextPageToken')).toBe('token-2')
  })

  it('discovers projects with bounded startAt pagination', async () => {
    const { calls, request } = mock(call => new URL(call.url).searchParams.get('startAt') === '0'
      ? json({ values: [{ id: '10000', key: 'PROJ', name: 'Project' }, { id: '10001', key: 'OPS', name: 'Ops' }], isLast: false })
      : json({ values: [{ id: '10002', key: 'QA', name: 'QA' }], isLast: true }))
    const projects = await new JiraProvider(config(), request).listProjects(AbortSignal.timeout(1000))
    expect(projects).toEqual([{ id: 'PROJ', name: 'Project' }, { id: 'OPS', name: 'Ops' }, { id: 'QA', name: 'QA' }])
    expect(calls[0]!.url).toBe('https://acme.atlassian.net/rest/api/3/project/search?maxResults=50&startAt=0')
    expect(calls[1]!.url).toContain('startAt=50')
  })

  it('verifies credentials and mapped projects during a connection test', async () => {
    const ok = mock(call => call.url.endsWith('/myself') ? json({ accountId: 'user-1' }) : json({ key: 'PROJ' }))
    await expect(new JiraProvider(config(), ok.request).test(AbortSignal.timeout(1000))).resolves.toBeUndefined()
    expect(ok.calls[1]!.url).toBe('https://acme.atlassian.net/rest/api/3/project/PROJ')

    const mismatch = mock(call => call.url.endsWith('/myself') ? json({ accountId: 'user-1' }) : json({ key: 'OTHER' }))
    await expect(new JiraProvider(config(), mismatch.request).test(AbortSignal.timeout(1000))).rejects.toThrow('does not match')
    const anonymous = mock(() => json([]))
    await expect(new JiraProvider(config(), anonymous.request).test(AbortSignal.timeout(1000))).rejects.toThrow('invalid Jira account response')
    const noAccount = mock(() => json({}))
    await expect(new JiraProvider(config(), noAccount.request).test(AbortSignal.timeout(1000))).rejects.toThrow('do not identify an account')
  })

  it('reads one item and enforces the mapped project scope', async () => {
    const { calls, request } = mock(() => json(issue()))
    const item = await new JiraProvider(config(), request).getItem('PROJ', 'issue', 'PROJ-12', AbortSignal.timeout(1000))
    expect(item).toMatchObject({ id: 'PROJ-12', type: 'issue', projectId: 'PROJ' })
    expect(calls[0]!.url).toBe('https://acme.atlassian.net/rest/api/3/issue/PROJ-12?fields=summary,description,status,priority,assignee,labels,updated')

    const provider = new JiraProvider(config(), mock(() => json(issue({ key: 'OTHER-12' }))).request)
    await expect(provider.getItem('PROJ', 'issue', 'OTHER-12', AbortSignal.timeout(1000))).rejects.toThrow('does not belong to the mapped project')
    await expect(provider.getItem('PROJ', 'bug', 'PROJ-12', AbortSignal.timeout(1000))).rejects.toThrow('unsupported Jira work item')
  })
})

describe('Jira ADF conversion', () => {
  it('renders paragraphs, headings, lists, code and mentions as plain text', () => {
    const text = adfToText({
      type: 'doc', version: 1, content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'First paragraph.' }] },
        { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Details' }] },
        {
          type: 'bulletList', content: [
            { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'One' }] }] },
            { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Two' }] }] },
          ],
        },
        {
          type: 'orderedList', content: [
            { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Step' }] }] },
          ],
        },
        { type: 'codeBlock', attrs: { language: 'ts' }, content: [{ type: 'text', text: 'const answer = 42' }] },
        {
          type: 'paragraph', content: [
            { type: 'mention', attrs: { id: 'u1', text: '@Alice' } },
            { type: 'text', text: ' please review' },
          ],
        },
      ],
    })
    expect(text).toContain('First paragraph.')
    expect(text).toContain('Details')
    expect(text).toContain('- One')
    expect(text).toContain('- Two')
    expect(text).toContain('1. Step')
    expect(text).toContain('const answer = 42')
    expect(text).toContain('@Alice')
    // Structural markup never leaks into the card description.
    expect(text).not.toMatch(/<\/?(p|li|ul|ol|pre|code|h[1-6])\b/)
  })

  it('ignores unknown node types and never walks their children', () => {
    const text = adfToText({
      type: 'doc', content: [
        { type: 'script', content: [{ type: 'text', text: 'ignored' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'kept' }] },
      ],
    })
    expect(text).toBe('kept')
  })

  it('bounds depth and total length', () => {
    let node: Record<string, unknown> = { type: 'paragraph', content: [{ type: 'text', text: 'deep' }] }
    for (let depth = 0; depth < 100; depth++) node = { type: 'paragraph', content: [node] }
    expect(adfToText({ type: 'doc', content: [node] })).toBe('')
    expect(adfToText({ type: 'doc', content: [{ type: 'text', text: 'x'.repeat(150_000) }] })).toHaveLength(100_000)
    expect(adfToText(null)).toBe('')
  })

  it('builds a minimal outbound ADF document (one paragraph per line)', () => {
    expect(adfDoc('Line one\nLine two')).toEqual({
      type: 'doc', version: 1, content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'Line one' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'Line two' }] },
      ],
    })
    expect(adfDoc('')).toEqual({ type: 'doc', version: 1, content: [{ type: 'paragraph', content: [] }] })
  })
})

describe('Jira provider writes', () => {
  it('creates an issue then re-reads the normalized item', async () => {
    const { calls, request } = mock(call => call.method === 'POST'
      ? json({ id: '10002', key: 'PROJ-13', self: 'https://acme.atlassian.net/rest/api/3/issue/10002' }, 201)
      : json(issue({ id: '10002', key: 'PROJ-13', fields: fields({ summary: 'New issue', description: null }) })))
    const created = await new JiraProvider(config(), request).createItem(
      'PROJ', { title: 'New issue', description: 'Line one\nLine two', urgency: 'normal' }, AbortSignal.timeout(1000),
    )
    expect(calls[0]).toMatchObject({ url: 'https://acme.atlassian.net/rest/api/3/issue', method: 'POST' })
    const body = calls[0]!.body as { fields: Record<string, unknown> }
    expect(body.fields).toMatchObject({ project: { key: 'PROJ' }, summary: 'New issue', issuetype: { name: 'Task' } })
    expect(body.fields.description).toMatchObject({
      type: 'doc', version: 1,
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'Line one' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'Line two' }] },
      ],
    })
    expect(calls[1]!.method).toBe('GET')
    expect(calls[1]!.url).toContain('/issue/PROJ-13?fields=')
    expect(created).toMatchObject({ id: 'PROJ-13', title: 'New issue', description: '' })
  })

  it('updates fields, picks the done transition and returns the re-read issue', async () => {
    const { calls, request } = mock(call => {
      if (call.url.endsWith('/transitions') && call.method === 'GET') {
        return json({
          transitions: [
            { id: '11', name: 'Start', to: { statusCategory: { key: 'indeterminate' } } },
            { id: '31', name: 'Done', to: { statusCategory: { key: 'done' } } },
          ],
        })
      }
      if (call.method === 'PUT' || call.method === 'POST') return noContent()
      return json(issue({ fields: fields({ status: { name: 'Done', statusCategory: { key: 'done' } } }) }))
    })
    const updated = await new JiraProvider(config(), request).updateItem(
      'PROJ', 'issue', 'PROJ-12', { title: 'Renamed', description: 'New body', close: 'completed' }, AbortSignal.timeout(1000),
    )
    expect(calls[0]).toMatchObject({
      url: 'https://acme.atlassian.net/rest/api/3/issue/PROJ-12', method: 'PUT',
      body: { fields: { summary: 'Renamed', description: { type: 'doc', version: 1 } } },
    })
    expect(calls[1]).toMatchObject({ method: 'GET', url: 'https://acme.atlassian.net/rest/api/3/issue/PROJ-12/transitions' })
    expect(calls[2]).toMatchObject({ method: 'POST', url: 'https://acme.atlassian.net/rest/api/3/issue/PROJ-12/transitions', body: { transition: { id: '31' } } })
    expect(calls[3]).toMatchObject({ method: 'GET' })
    expect(updated).toMatchObject({ id: 'PROJ-12', status: 'Done', closed: true })
  })

  it('fails safely when no transition reaches the done category', async () => {
    const { request } = mock(call => call.method === 'PUT' ? noContent() : json({ transitions: [{ id: '11', to: { statusCategory: { key: 'new' } } }] }))
    await expect(new JiraProvider(config(), request).updateItem(
      'PROJ', 'issue', 'PROJ-12', { close: 'completed' }, AbortSignal.timeout(1000),
    )).rejects.toThrow('no done transition')
    await expect(new JiraProvider(config(), mock(() => json({})).request).updateItem(
      'PROJ', 'issue', 'PROJ-12', {}, AbortSignal.timeout(1000),
    )).rejects.toThrow('empty Jira update')
  })

  it('maps transport failures without leaking the body or the token', async () => {
    const messageOf = async (status: number): Promise<string> => {
      const { request } = mock(() => json(
        { errorMessages: ['credential jira-secret-token rejected'], errors: { token: 'jira-secret-token' } },
        status,
        status === 429 ? { 'retry-after': '0' } : {},
      ))
      return new JiraProvider(config(), request).getItems('PROJ', AbortSignal.timeout(5000))
        .then(() => '', (error: unknown) => (error as Error).message)
    }
    expect(await messageOf(401)).toBe('Jira rejected the credentials (HTTP 401)')
    expect(await messageOf(403)).toBe('Jira denied access; check permissions and rate limits (HTTP 403)')
    expect(await messageOf(404)).toBe('Jira project or issue not found or not accessible (HTTP 404)')
    expect(await messageOf(429)).toBe('Jira rate limit exceeded; retry later (HTTP 429)')
    expect(await messageOf(401)).not.toContain('jira-secret-token')
  })

  it('rejects malformed payloads instead of importing partial items', async () => {
    const list = (value: unknown) => new JiraProvider(config(), mock(() => json(value)).request)
    await expect(list({}).getItems('PROJ', AbortSignal.timeout(1000))).rejects.toThrow('invalid Jira issue list response')
    await expect(list({ issues: 'nope' }).getItems('PROJ', AbortSignal.timeout(1000))).rejects.toThrow('invalid Jira issue list')
    await expect(list({ issues: [issue({ fields: null })] }).getItems('PROJ', AbortSignal.timeout(1000))).rejects.toThrow('invalid Jira issue fields')
    await expect(list({ issues: [issue({ fields: fields({ summary: '  ' }) })] }).getItems('PROJ', AbortSignal.timeout(1000))).rejects.toThrow('invalid Jira issue summary')
    await expect(list({ issues: [issue({ fields: fields({ status: null }) })] }).getItems('PROJ', AbortSignal.timeout(1000))).rejects.toThrow('invalid Jira issue status')
    await expect(list({ values: [{ key: 'lower', name: 'Nope' }] }).listProjects(AbortSignal.timeout(1000))).rejects.toThrow('invalid Jira project key')
  })
})

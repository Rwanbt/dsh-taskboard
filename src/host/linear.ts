import type { ExternalConfig, ExternalFields, ExternalItem, ExternalProject, ExternalPushPatch, ProviderDescriptor } from '../shared/external.ts'
import type { ExternalTaskProvider, ExternalWriteProvider, ProviderDefinition } from './external-provider.ts'
import { externalSend } from './external-http.ts'

const TEAM_KEY_PATTERN = /^[A-Z][A-Z0-9_]*$/
const IDENTIFIER_PATTERN = /^[A-Z][A-Z0-9_]*-\d+$/
const PAGE_SIZE = 50
const MAX_PAGES = 1_000
const MAX_TEAMS = 100

const ISSUE_FIELDS = 'id identifier title description state { name type } priority assignee { displayName } labels { nodes { name } } url updatedAt'

const VIEWER_QUERY = 'query Viewer { viewer { id name } }'
const TEAMS_QUERY = `query Teams { teams(first: ${MAX_TEAMS}) { nodes { id key name } } }`
const ISSUES_QUERY = `query Issues($teamKey: String!, $cursor: String) { issues(filter: { team: { key: { eq: $teamKey } } }, first: ${PAGE_SIZE}, after: $cursor, orderBy: createdAt) { pageInfo { hasNextPage endCursor } nodes { ${ISSUE_FIELDS} } } }`
const ISSUE_QUERY = `query Issue($id: String!) { issue(id: $id) { ${ISSUE_FIELDS} } }`
const TEAM_STATES_QUERY = `query TeamStates($teamKey: String!) { teams(filter: { key: { eq: $teamKey } }, first: 1) { nodes { id key states { nodes { id name type } } } } }`
const CREATE_MUTATION = `mutation IssueCreate($teamId: String!, $title: String!, $description: String) { issueCreate(input: { teamId: $teamId, title: $title, description: $description }) { success issue { ${ISSUE_FIELDS} } } }`
const UPDATE_MUTATION = `mutation IssueUpdate($id: String!, $input: IssueUpdateInput!) { issueUpdate(id: $id, input: $input) { success issue { ${ISSUE_FIELDS} } } }`

/** One validated team node, cached per provider instance (team keys rarely change). */
type LinearTeam = { id: string; key: string; name: string }

/**
 * Linear work item provider (GraphQL API). One connection maps Linear team
 * keys to local projects; `capabilities.write` enables the opt-in outbound
 * phase. Descriptions are plain Markdown (Linear renders it itself).
 */
export class LinearProvider implements ExternalTaskProvider, ExternalWriteProvider {
  private readonly baseUrl: string
  private readonly apiKey: string
  private teams?: LinearTeam[]

  constructor(private readonly config: ExternalConfig, private readonly request: typeof fetch = fetch) {
    if (config.authMode !== 'token' || !config.credentials.apiKey) throw new Error('Linear requires an API key')
    this.baseUrl = String(config.baseUrl ?? '').trim()
    if (!this.baseUrl) throw new Error('Linear requires a base URL')
    this.apiKey = config.credentials.apiKey
  }

  private teamKey(value: string): string {
    if (!TEAM_KEY_PATTERN.test(value)) throw new Error('invalid Linear team key')
    return value
  }

  private identifier(value: unknown, projectId?: string): string {
    if (typeof value !== 'string' || !IDENTIFIER_PATTERN.test(value)) throw new Error('invalid Linear issue identifier')
    if (projectId !== undefined && !value.startsWith(`${projectId}-`)) throw new Error('Linear issue does not belong to the mapped team')
    return value
  }

  /**
   * Map transport failures to actionable messages. GraphQL error payloads are
   * never relayed: their `message` can quote the API key or internal details.
   */
  private async graphql(query: string, variables: Record<string, unknown>, signal: AbortSignal): Promise<Record<string, unknown>> {
    let body: unknown
    try {
      const response = await externalSend(this.request, this.baseUrl, {
        method: 'POST', headers: { Authorization: this.apiKey }, body: { query, variables },
      }, signal)
      body = response.body
    } catch (error) {
      const status = error instanceof Error ? /HTTP (\d{3})/.exec(error.message)?.[1] : undefined
      if (status === '401') throw new Error('Linear rejected the API key (HTTP 401)')
      if (status === '403') throw new Error('Linear denied access (HTTP 403)')
      if (status === '404') throw new Error('Linear resource not found (HTTP 404)')
      if (status === '429') throw new Error('Linear rate limit exceeded; retry later (HTTP 429)')
      throw error
    }
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('invalid Linear response')
    const payload = body as Record<string, unknown>
    if (Array.isArray(payload.errors) && payload.errors.length > 0) throw new Error('Linear GraphQL request failed')
    const data = payload.data
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('invalid Linear response')
    return data as Record<string, unknown>
  }

  private objectOf(raw: unknown, message: string): Record<string, unknown> {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error(message)
    return raw as Record<string, unknown>
  }

  private nodesOf(raw: unknown, message: string): unknown[] {
    const container = this.objectOf(raw, message)
    if (!Array.isArray(container.nodes)) throw new Error(message)
    return container.nodes
  }

  private async teamNodes(signal: AbortSignal): Promise<LinearTeam[]> {
    if (this.teams) return this.teams
    const data = await this.graphql(TEAMS_QUERY, {}, signal)
    const teams: LinearTeam[] = []
    const seen = new Set<string>()
    for (const raw of this.nodesOf(data.teams, 'invalid Linear team list')) {
      const team = this.objectOf(raw, 'invalid Linear team')
      if (typeof team.id !== 'string' || !team.id) throw new Error('invalid Linear team identity')
      const key = this.teamKey(typeof team.key === 'string' ? team.key : '')
      if (typeof team.name !== 'string') throw new Error('invalid Linear team name')
      if (seen.has(key)) continue
      seen.add(key)
      teams.push({ id: team.id, key, name: team.name })
    }
    this.teams = teams
    return teams
  }

  private urgency(priority: number): ExternalItem['urgency'] {
    if (priority === 1) return 'urgent'
    if (priority === 4) return 'relaxed'
    return 'normal'
  }

  /** Label names + numeric priority, comma-joined (same shape as the GitHub adapter). */
  private priorityOf(raw: unknown, value: number): string {
    const labels = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>).nodes : undefined
    const names: string[] = []
    if (Array.isArray(labels)) {
      for (const entry of labels) {
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue
        const name = (entry as Record<string, unknown>).name
        if (typeof name === 'string' && name.trim()) names.push(name.trim())
      }
    }
    if (value > 0) names.push(String(value))
    return names.join(',')
  }

  private normalize(projectId: string, raw: unknown): ExternalItem {
    const issue = this.objectOf(raw, 'invalid Linear issue')
    const identifier = this.identifier(issue.identifier, projectId)
    if (typeof issue.title !== 'string' || !issue.title.trim()) throw new Error('invalid Linear issue title')
    const url = issue.url
    if (typeof url !== 'string') throw new Error('invalid Linear issue URL')
    try {
      if (!['http:', 'https:'].includes(new URL(url).protocol)) throw new Error('invalid Linear issue URL')
    } catch { throw new Error('invalid Linear issue URL') }
    const state = this.objectOf(issue.state, 'invalid Linear issue state')
    if (typeof state.name !== 'string' || typeof state.type !== 'string') throw new Error('invalid Linear issue state')
    const priorityValue = typeof issue.priority === 'number' && Number.isFinite(issue.priority) ? issue.priority : 0
    const assignee = issue.assignee && typeof issue.assignee === 'object' && !Array.isArray(issue.assignee)
      ? (issue.assignee as Record<string, unknown>).displayName : undefined
    const assignedTo = typeof assignee === 'string' ? assignee : ''
    return {
      projectId, type: 'issue', id: identifier,
      title: issue.title.trim(),
      description: typeof issue.description === 'string' ? issue.description : '',
      priority: this.priorityOf(issue.labels, priorityValue),
      status: state.name,
      assignedTo,
      assignees: assignedTo ? [assignedTo] : [],
      closed: state.type === 'completed' || state.type === 'canceled',
      urgency: this.urgency(priorityValue),
      url,
      revision: typeof issue.updatedAt === 'string' ? issue.updatedAt : '',
    }
  }

  async test(signal: AbortSignal): Promise<void> {
    const data = await this.graphql(VIEWER_QUERY, {}, signal)
    const viewer = data.viewer
    if (!viewer || typeof viewer !== 'object' || Array.isArray(viewer)) throw new Error('invalid Linear viewer response')
    const id = (viewer as Record<string, unknown>).id
    if (typeof id !== 'string' || !id.trim()) throw new Error('Linear API key does not identify an account')
  }

  async listProjects(signal: AbortSignal): Promise<ExternalProject[]> {
    return (await this.teamNodes(signal)).map(team => ({ id: team.key, name: team.name }))
  }

  async getItem(projectId: string, type: string, id: string, signal: AbortSignal): Promise<ExternalItem | undefined> {
    if (type !== 'issue' || !this.config.itemTypes.includes(type)) throw new Error('unsupported Linear work item')
    const key = this.teamKey(projectId)
    const identifier = this.identifier(id, key)
    const data = await this.graphql(ISSUE_QUERY, { id: identifier }, signal)
    const issue = data.issue
    if (issue === undefined || issue === null) return undefined
    return this.normalize(projectId, issue)
  }

  async getItems(projectId: string, signal: AbortSignal): Promise<ExternalItem[]> {
    const teamKey = this.teamKey(projectId)
    const items: ExternalItem[] = []
    const seen = new Set<string>()
    let cursor: string | undefined
    for (let page = 1; ; page++) {
      if (page > MAX_PAGES) throw new Error('Linear issue pagination limit exceeded')
      const variables: Record<string, unknown> = { teamKey }
      if (cursor !== undefined) variables.cursor = cursor
      const data = await this.graphql(ISSUES_QUERY, variables, signal)
      const connection = this.objectOf(data.issues, 'invalid Linear issue list response')
      if (!Array.isArray(connection.nodes)) throw new Error('invalid Linear issue list response')
      const pageInfo = this.objectOf(connection.pageInfo, 'invalid Linear issue page')
      if (typeof pageInfo.hasNextPage !== 'boolean') throw new Error('invalid Linear issue page')
      for (const raw of connection.nodes) {
        const item = this.normalize(projectId, raw)
        if (seen.has(item.id)) continue
        seen.add(item.id)
        items.push(item)
      }
      if (!pageInfo.hasNextPage) return items
      if (typeof pageInfo.endCursor !== 'string' || !pageInfo.endCursor) throw new Error('invalid Linear issue page')
      cursor = pageInfo.endCursor
    }
  }

  async createItem(projectId: string, fields: ExternalFields, signal: AbortSignal): Promise<ExternalItem> {
    const teamKey = this.teamKey(projectId)
    const team = (await this.teamNodes(signal)).find(candidate => candidate.key === teamKey)
    if (!team) throw new Error('Linear team not found for the mapped key')
    const data = await this.graphql(CREATE_MUTATION, { teamId: team.id, title: fields.title, description: fields.description }, signal)
    const payload = this.objectOf(data.issueCreate, 'invalid Linear issue response')
    return this.normalize(projectId, payload.issue)
  }

  async updateItem(projectId: string, type: string, id: string, patch: ExternalPushPatch, signal: AbortSignal): Promise<ExternalItem> {
    if (type !== 'issue' || !this.config.itemTypes.includes(type)) throw new Error('unsupported Linear work item')
    const teamKey = this.teamKey(projectId)
    const identifier = this.identifier(id, teamKey)
    const input: Record<string, unknown> = {}
    if (patch.title !== undefined) input.title = patch.title
    if (patch.description !== undefined) input.description = patch.description
    if (patch.close !== undefined) input.stateId = await this.closingState(projectId, patch.close, signal)
    if (!Object.keys(input).length) throw new Error('empty Linear update')
    await this.graphql(UPDATE_MUTATION, { id: identifier, input }, signal)
    const item = await this.getItem(projectId, 'issue', identifier, signal)
    if (!item) throw new Error('Linear issue not found after update')
    return item
  }

  /** Resolve the workflow state a close maps to (`canceled` = not planned). */
  private async closingState(projectId: string, close: 'completed' | 'not_planned', signal: AbortSignal): Promise<string> {
    const wanted = close === 'not_planned' ? 'canceled' : 'completed'
    const data = await this.graphql(TEAM_STATES_QUERY, { teamKey: projectId }, signal)
    const nodes = this.nodesOf(data.teams, 'invalid Linear team response')
    const team = this.objectOf(nodes[0], 'invalid Linear team response')
    const states = this.nodesOf(team.states, 'invalid Linear workflow state response')
    for (const raw of states) {
      const state = this.objectOf(raw, 'invalid Linear workflow state')
      if (state.type === wanted && typeof state.id === 'string' && state.id) return state.id
    }
    throw new Error(wanted === 'canceled'
      ? 'Linear has no canceled workflow state for this team'
      : 'Linear has no completed workflow state for this team')
  }
}

/**
 * Linear descriptor factory, registered by the built-in provider list. Linear
 * personal API keys are sent verbatim (no `Bearer` prefix).
 */
export function linearProviderDefinition(): ProviderDefinition {
  const descriptor: ProviderDescriptor = {
    id: 'linear', name: 'Linear', scopeLabel: 'ext.linearTeamKey',
    defaultBaseUrl: 'https://api.linear.app/graphql',
    contractVersion: 1, kind: 'planning',
    authModes: [{
      id: 'token', label: 'ext.linearToken',
      fields: [{ key: 'apiKey', label: 'ext.linearApiKey' }],
    }],
    capabilities: {
      itemTypes: ['issue'], projectDiscovery: true, accountDiscovery: false, pagination: 'cursor', incremental: false,
      write: true, dedupe: false,
      operations: [
        'validateConnection', 'getCapabilities', 'discoverProjects', 'listWorkItems', 'getWorkItem',
        'createWorkItem', 'updateWorkItem',
      ],
      directions: ['inbound', 'outbound'], events: 'poll',
      limits: { pageSize: PAGE_SIZE, maxPages: MAX_PAGES, requestTimeoutMs: 30_000 },
    },
  }
  return {
    descriptor,
    validate: config => {
      if (config.authMode !== 'token') throw new Error('unsupported Linear authentication mode')
      if (config.mappings.some(mapping => !TEAM_KEY_PATTERN.test(mapping.projectId))) {
        throw new Error('Linear team keys must be uppercase letters, digits or underscores')
      }
    },
    create: config => new LinearProvider(config),
  }
}

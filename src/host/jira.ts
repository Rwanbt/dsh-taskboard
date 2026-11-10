import type { ExternalConfig, ExternalFields, ExternalItem, ExternalProject, ExternalPushPatch, ProviderDescriptor } from '../shared/external.ts'
import type { ExternalTaskProvider, ExternalWriteProvider, ProviderDefinition } from './external-provider.ts'
import { externalSend } from './external-http.ts'

const PROJECT_KEY_PATTERN = /^[A-Z][A-Z0-9_]*$/
const ISSUE_KEY_PATTERN = /^[A-Z][A-Z0-9_]*-\d+$/
const PAGE_SIZE = 50
const MAX_PAGES = 1_000
const PROJECT_MAX_PAGES = 100
const MAX_ADF_DEPTH = 32
const MAX_TEXT_LENGTH = 100_000
const ISSUE_FIELDS = 'summary,description,status,priority,assignee,labels,updated'

const HIGH_PRIORITIES = new Set(['highest', 'high', 'p0', 'p1', 'urgent', 'critical', 'blocker'])
const LOW_PRIORITIES = new Set(['lowest', 'low', 'p4', 'p5', 'minor', 'trivial'])

/**
 * Jira Cloud work item provider (REST API v3). One connection maps Jira
 * project keys to local projects; `capabilities.write` enables the opt-in
 * outbound phase. Jira Cloud only: descriptions are Atlassian Document Format
 * (ADF), and acknowledgement endpoints answer 204 No Content.
 */
export class JiraProvider implements ExternalTaskProvider, ExternalWriteProvider {
  private readonly baseUrl: string
  private readonly siteUrl: string
  private readonly authorization: string

  constructor(private readonly config: ExternalConfig, private readonly request: typeof fetch = fetch) {
    if (config.authMode !== 'basic' || !config.credentials.email || !config.credentials.apiToken) {
      throw new Error('Jira requires an email and an API token')
    }
    this.baseUrl = this.apiBase(config.baseUrl)
    this.siteUrl = this.siteBase(this.baseUrl)
    this.authorization = `Basic ${Buffer.from(`${config.credentials.email}:${config.credentials.apiToken}`, 'utf8').toString('base64')}`
  }

  private apiBase(raw: unknown): string {
    const base = String(raw ?? '').trim().replace(/\/+$/, '')
    if (!base) throw new Error('Jira requires a base URL')
    return base
  }

  /** Site URL (without `/rest/api/N`) used to build browsable issue links. */
  private siteBase(base: string): string {
    const site = base.replace(/\/rest\/api\/\d+$/i, '').replace(/\/+$/, '')
    if (!site) throw new Error('invalid Jira base URL')
    let parsed: URL
    try { parsed = new URL(site) } catch { throw new Error('invalid Jira base URL') }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new Error('invalid Jira base URL')
    return site
  }

  private projectKey(value: string): string {
    if (!PROJECT_KEY_PATTERN.test(value)) throw new Error('invalid Jira project key')
    return value
  }

  private issueKey(value: unknown, projectId?: string): string {
    if (typeof value !== 'string' || !ISSUE_KEY_PATTERN.test(value)) throw new Error('invalid Jira issue key')
    if (projectId !== undefined && !value.startsWith(`${projectId}-`)) throw new Error('Jira issue does not belong to the mapped project')
    return value
  }

  /**
   * Map transport failures to actionable messages; never echo a response body
   * (it may quote credentials) and never relay the token.
   */
  private async send(method: string, path: string, signal: AbortSignal, body?: unknown): Promise<unknown> {
    try {
      const response = await externalSend(this.request, `${this.baseUrl}${path}`, {
        method, headers: { Authorization: this.authorization }, ...(body === undefined ? {} : { body }),
      }, signal)
      return response.body
    } catch (error) {
      // Jira answers 204 No Content for successful writes; the shared transport
      // only understands JSON, so an empty successful body means "done".
      if (method !== 'GET' && error instanceof Error && error.message === 'External service returned invalid JSON') return undefined
      const status = error instanceof Error ? /HTTP (\d{3})/.exec(error.message)?.[1] : undefined
      if (status === '401') throw new Error('Jira rejected the credentials (HTTP 401)')
      if (status === '403') throw new Error('Jira denied access; check permissions and rate limits (HTTP 403)')
      if (status === '404') throw new Error('Jira project or issue not found or not accessible (HTTP 404)')
      if (status === '429') throw new Error('Jira rate limit exceeded; retry later (HTTP 429)')
      throw error
    }
  }

  private urgency(priority: string): ExternalItem['urgency'] {
    const normalized = priority.trim().toLowerCase()
    if (HIGH_PRIORITIES.has(normalized)) return 'urgent'
    if (LOW_PRIORITIES.has(normalized)) return 'relaxed'
    return 'normal'
  }

  private normalize(projectId: string, raw: unknown): ExternalItem {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('invalid Jira issue')
    const issue = raw as Record<string, unknown>
    const key = this.issueKey(issue.key, projectId)
    const fields = issue.fields
    if (!fields || typeof fields !== 'object' || Array.isArray(fields)) throw new Error('invalid Jira issue fields')
    const f = fields as Record<string, unknown>
    if (typeof f.summary !== 'string' || !f.summary.trim()) throw new Error('invalid Jira issue summary')
    const status = f.status && typeof f.status === 'object' && !Array.isArray(f.status) ? f.status as Record<string, unknown> : undefined
    if (!status || typeof status.name !== 'string') throw new Error('invalid Jira issue status')
    const category = status.statusCategory && typeof status.statusCategory === 'object'
      ? status.statusCategory as Record<string, unknown> : undefined
    const priority = f.priority && typeof f.priority === 'object' && !Array.isArray(f.priority)
      ? (f.priority as Record<string, unknown>).name : undefined
    const assignee = f.assignee && typeof f.assignee === 'object' && !Array.isArray(f.assignee)
      ? (f.assignee as Record<string, unknown>).displayName : undefined
    const assignedTo = typeof assignee === 'string' ? assignee : ''
    const url = `${this.siteUrl}/browse/${key}`
    try {
      if (!['http:', 'https:'].includes(new URL(url).protocol)) throw new Error('invalid Jira issue URL')
    } catch { throw new Error('invalid Jira issue URL') }
    return {
      projectId, type: 'issue', id: key,
      title: f.summary.trim(),
      description: adfToText(f.description),
      priority: typeof priority === 'string' ? priority : '',
      status: status.name,
      assignedTo,
      assignees: assignedTo ? [assignedTo] : [],
      closed: category?.key === 'done',
      urgency: this.urgency(typeof priority === 'string' ? priority : ''),
      url,
      revision: typeof f.updated === 'string' ? f.updated : '',
    }
  }

  private issueList(raw: unknown): { issues: unknown[] | undefined; nextPageToken: string | undefined; isLast: boolean } {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('invalid Jira issue list response')
    const body = raw as Record<string, unknown>
    if (body.issues !== undefined && !Array.isArray(body.issues)) throw new Error('invalid Jira issue list')
    const issues = Array.isArray(body.issues) ? body.issues : undefined
    const token = typeof body.nextPageToken === 'string' && body.nextPageToken ? body.nextPageToken : undefined
    // New cursor API fallback: a response carrying neither issues nor a cursor is unusable.
    if (issues === undefined && token === undefined) throw new Error('invalid Jira issue list response')
    return { issues, nextPageToken: token, isLast: body.isLast === true }
  }

  async test(signal: AbortSignal): Promise<void> {
    const me = await this.send('GET', '/myself', signal)
    if (!me || typeof me !== 'object' || Array.isArray(me)) throw new Error('invalid Jira account response')
    const accountId = (me as Record<string, unknown>).accountId
    if (typeof accountId !== 'string' || !accountId.trim()) throw new Error('Jira credentials do not identify an account')
    for (const mapping of this.config.mappings) {
      const key = this.projectKey(mapping.projectId)
      const project = await this.send('GET', `/project/${encodeURIComponent(key)}`, signal)
      if (!project || typeof project !== 'object' || Array.isArray(project)) throw new Error('invalid Jira project response')
      if ((project as Record<string, unknown>).key !== key) throw new Error('Jira project response does not match the mapping')
    }
  }

  async listProjects(signal: AbortSignal): Promise<ExternalProject[]> {
    const projects: ExternalProject[] = []
    const seen = new Set<string>()
    for (let page = 1; page <= PROJECT_MAX_PAGES; page++) {
      const startAt = (page - 1) * PAGE_SIZE
      const raw = await this.send('GET', `/project/search?maxResults=${PAGE_SIZE}&startAt=${startAt}`, signal)
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('invalid Jira project list')
      const values = (raw as Record<string, unknown>).values
      if (!Array.isArray(values)) throw new Error('invalid Jira project list')
      for (const entry of values) {
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new Error('invalid Jira project')
        const project = entry as Record<string, unknown>
        const key = this.projectKey(typeof project.key === 'string' ? project.key : '')
        if (typeof project.name !== 'string') throw new Error('invalid Jira project name')
        if (!seen.has(key)) { seen.add(key); projects.push({ id: key, name: project.name }) }
      }
      if (!values.length || (raw as Record<string, unknown>).isLast === true) return projects
      // Servers predating `isLast` signal the last page with a short page.
      if ((raw as Record<string, unknown>).isLast === undefined && values.length < PAGE_SIZE) return projects
      if (page === PROJECT_MAX_PAGES) throw new Error('Jira project pagination limit exceeded')
    }
    return projects
  }

  async getItem(projectId: string, type: string, id: string, signal: AbortSignal): Promise<ExternalItem | undefined> {
    if (type !== 'issue' || !this.config.itemTypes.includes(type)) throw new Error('unsupported Jira work item')
    const key = this.projectKey(projectId)
    const issueKey = this.issueKey(id, key)
    const raw = await this.send('GET', `/issue/${encodeURIComponent(issueKey)}?fields=${ISSUE_FIELDS}`, signal)
    return this.normalize(projectId, raw)
  }

  async getItems(projectId: string, signal: AbortSignal): Promise<ExternalItem[]> {
    const key = this.projectKey(projectId)
    const items: ExternalItem[] = []
    const seen = new Set<string>()
    let token: string | undefined
    for (let page = 1; ; page++) {
      if (page > MAX_PAGES) throw new Error('Jira issue pagination limit exceeded')
      const params = new URLSearchParams({ jql: `project=${key} ORDER BY created ASC`, fields: ISSUE_FIELDS, maxResults: String(PAGE_SIZE) })
      if (token !== undefined) params.set('nextPageToken', token)
      const { issues, nextPageToken, isLast } = this.issueList(await this.send('GET', `/search/jql?${params.toString()}`, signal))
      for (const raw of issues ?? []) {
        const item = this.normalize(projectId, raw)
        if (seen.has(item.id)) continue
        seen.add(item.id)
        items.push(item)
      }
      if (isLast || nextPageToken === undefined) return items
      token = nextPageToken
    }
  }

  async createItem(projectId: string, fields: ExternalFields, signal: AbortSignal): Promise<ExternalItem> {
    const key = this.projectKey(projectId)
    const raw = await this.send('POST', '/issue', signal, {
      fields: {
        project: { key },
        summary: fields.title,
        description: adfDoc(fields.description),
        issuetype: { name: 'Task' },
      },
    })
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('invalid Jira issue response')
    const created = this.issueKey((raw as Record<string, unknown>).key, key)
    return this.itemOrThrow(projectId, created, signal)
  }

  async updateItem(projectId: string, type: string, id: string, patch: ExternalPushPatch, signal: AbortSignal): Promise<ExternalItem> {
    if (type !== 'issue' || !this.config.itemTypes.includes(type)) throw new Error('unsupported Jira work item')
    const key = this.projectKey(projectId)
    const issueKey = this.issueKey(id, key)
    const fields: Record<string, unknown> = {}
    if (patch.title !== undefined) fields.summary = patch.title
    if (patch.description !== undefined) fields.description = adfDoc(patch.description)
    if (!Object.keys(fields).length && patch.close === undefined) throw new Error('empty Jira update')
    if (Object.keys(fields).length) await this.send('PUT', `/issue/${encodeURIComponent(issueKey)}`, signal, { fields })
    if (patch.close !== undefined) {
      const raw = await this.send('GET', `/issue/${encodeURIComponent(issueKey)}/transitions`, signal)
      const transitionId = this.doneTransition(raw)
      await this.send('POST', `/issue/${encodeURIComponent(issueKey)}/transitions`, signal, { transition: { id: transitionId } })
    }
    return this.itemOrThrow(projectId, issueKey, signal)
  }

  /** Pick the transition landing in the `done` status category. */
  private doneTransition(raw: unknown): string {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('invalid Jira transition response')
    const transitions = (raw as Record<string, unknown>).transitions
    if (!Array.isArray(transitions)) throw new Error('invalid Jira transition response')
    for (const entry of transitions) {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue
      const transition = entry as Record<string, unknown>
      const to = transition.to && typeof transition.to === 'object' && !Array.isArray(transition.to)
        ? transition.to as Record<string, unknown> : undefined
      const category = to?.statusCategory && typeof to.statusCategory === 'object' && !Array.isArray(to.statusCategory)
        ? to.statusCategory as Record<string, unknown> : undefined
      if (category?.key === 'done' && typeof transition.id === 'string' && transition.id) return transition.id
    }
    throw new Error('Jira has no done transition for this issue')
  }

  private async itemOrThrow(projectId: string, issueKey: string, signal: AbortSignal): Promise<ExternalItem> {
    const item = await this.getItem(projectId, 'issue', issueKey, signal)
    if (!item) throw new Error('Jira issue not found after update')
    return item
  }
}

/**
 * Jira Cloud descriptor factory, registered by the built-in provider list.
 * The token is a per-connection secret; only `email` is echoed in the UI.
 */
export function jiraProviderDefinition(): ProviderDefinition {
  const descriptor: ProviderDescriptor = {
    id: 'jira', name: 'Jira', scopeLabel: 'ext.jiraProjectKey',
    defaultBaseUrl: 'https://your-domain.atlassian.net/rest/api/3',
    contractVersion: 1, kind: 'planning',
    authModes: [{
      id: 'basic', label: 'ext.jiraBasic',
      fields: [
        { key: 'email', label: 'ext.jiraEmail', secret: false },
        { key: 'apiToken', label: 'ext.jiraApiToken' },
      ],
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
      if (config.authMode !== 'basic') throw new Error('unsupported Jira authentication mode')
      if (config.mappings.some(mapping => !PROJECT_KEY_PATTERN.test(mapping.projectId))) {
        throw new Error('Jira project keys must be uppercase letters, digits or underscores')
      }
    },
    create: config => new JiraProvider(config),
  }
}

/**
 * Convert Atlassian Document Format to plain text. Only the block/inline node
 * types Jira actually emits for a card description are understood; every other
 * node is ignored, depth is bounded and the result is capped. It never emits
 * HTML: block structure becomes newlines and lists become text bullets.
 */
export function adfToText(raw: unknown): string {
  const parts: string[] = []
  let length = 0
  const push = (text: string): void => {
    if (!text) return
    const room = MAX_TEXT_LENGTH - length
    if (room <= 0) return
    const chunk = text.length > room ? text.slice(0, room) : text
    parts.push(chunk)
    length += chunk.length
  }
  const endWithNewline = (): void => {
    const last = parts[parts.length - 1]
    if (last !== undefined && !last.endsWith('\n')) push('\n')
  }
  const walk = (node: unknown, depth: number, inList: boolean): void => {
    if (depth > MAX_ADF_DEPTH || length >= MAX_TEXT_LENGTH) return
    if (!node || typeof node !== 'object' || Array.isArray(node)) return
    const n = node as Record<string, unknown>
    const type = typeof n.type === 'string' ? n.type : ''
    const content = Array.isArray(n.content) ? n.content : []
    switch (type) {
      case 'text':
        if (typeof n.text === 'string') push(n.text)
        return
      case 'hardBreak':
        push('\n')
        return
      case 'mention': {
        const attrs = n.attrs && typeof n.attrs === 'object' && !Array.isArray(n.attrs) ? n.attrs as Record<string, unknown> : undefined
        const label = typeof attrs?.text === 'string' ? attrs.text : typeof n.text === 'string' ? n.text : ''
        if (label) push(label)
        return
      }
      case 'paragraph':
      case 'heading':
        for (const child of content) walk(child, depth + 1, inList)
        push(inList ? '\n' : '\n\n')
        return
      case 'doc':
        for (const child of content) walk(child, depth + 1, inList)
        return
      case 'blockquote':
        for (const child of content) walk(child, depth + 1, inList)
        push('\n\n')
        return
      case 'listItem':
        for (const child of content) walk(child, depth + 1, true)
        return
      case 'bulletList':
      case 'orderedList': {
        let index = 0
        for (const child of content) {
          index++
          push(type === 'orderedList' ? `${index}. ` : '- ')
          walk(child, depth + 1, true)
          endWithNewline()
        }
        push('\n')
        return
      }
      case 'codeBlock': {
        const code: string[] = []
        collectInlineText(n, 0, code)
        push(`\`\`\`\n${code.join('').replace(/\n+$/, '')}\n\`\`\``)
        push('\n\n')
        return
      }
      default:
        return
    }
  }
  walk(raw, 0, false)
  return parts.join('')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, MAX_TEXT_LENGTH)
}

/** Text-only descendant collector (used for code blocks, never emits markup). */
function collectInlineText(node: unknown, depth: number, out: string[]): void {
  if (depth > MAX_ADF_DEPTH || !node || typeof node !== 'object' || Array.isArray(node)) return
  const n = node as Record<string, unknown>
  if (n.type === 'text' && typeof n.text === 'string') { out.push(n.text); return }
  if (n.type === 'hardBreak') { out.push('\n'); return }
  if (n.type === 'mention') {
    const attrs = n.attrs && typeof n.attrs === 'object' && !Array.isArray(n.attrs) ? n.attrs as Record<string, unknown> : undefined
    if (typeof attrs?.text === 'string') out.push(attrs.text)
    return
  }
  const content = Array.isArray(n.content) ? n.content : []
  for (const child of content) collectInlineText(child, depth + 1, out)
}

/** Minimal ADF document for outbound descriptions (one paragraph per line). */
export function adfDoc(text: unknown): Record<string, unknown> {
  const paragraphs = String(text ?? '').split(/\r?\n/).map(line => ({
    type: 'paragraph',
    ...(line ? { content: [{ type: 'text', text: line }] } : { content: [] }),
  }))
  return { type: 'doc', version: 1, content: paragraphs }
}

import type { ExternalAccount, ExternalConfig, ExternalFields, ExternalItem, ExternalProject, ExternalPushPatch } from '../shared/external.ts'
import type { ExternalReadContext, ExternalTaskProvider, ExternalWriteProvider } from './external-provider.ts'
import { externalSend } from './external-http.ts'

/**
 * GitLab project path: `group[/subgroup…]/project`. The REST v4 API wants the
 * whole path as one URL-encoded project id, so subgroups are supported while a
 * bare name (no namespace) is rejected.
 */
export const GITLAB_PROJECT_PATTERN = /^[A-Za-z0-9_.-]+(\/[A-Za-z0-9_.-]+)+$/
const PAGE_SIZE = 100
const MAX_PAGE = 1_000
const MAX_PROJECT_PAGE = 100

/**
 * GitLab Issues provider (REST v4). One connection maps project paths
 * (`group/project`, subgroups allowed) to local projects; issues are read from
 * the project issue list and `capabilities.write` enables the opt-in outbound
 * phase. Merge requests share the endpoint shape but are never work items.
 */
export class GitlabProvider implements ExternalTaskProvider, ExternalWriteProvider {
  constructor(private readonly config: ExternalConfig, private readonly request: typeof fetch = fetch) {
    if (config.authMode !== 'token' || !config.credentials.token) throw new Error('GitLab requires a token')
  }
  private headers(): Record<string, string> {
    return {
      'PRIVATE-TOKEN': this.config.credentials.token!,
      'User-Agent': 'dsh-taskboard',
    }
  }
  /** Map transport failures to actionable messages; never echo response bodies. */
  private async send(method: string, path: string, signal: AbortSignal, body?: unknown): Promise<{ body: unknown; headers: Headers }> {
    const base = this.config.baseUrl.replace(/\/+$/, '')
    try {
      return await externalSend(this.request, `${base}${path}`, {
        method, headers: this.headers(), ...(body === undefined ? {} : { body }),
      }, signal)
    } catch (error) {
      const status = error instanceof Error ? /HTTP (\d{3})/.exec(error.message)?.[1] : undefined
      if (status === '401') throw new Error('GitLab rejected the token (HTTP 401)')
      if (status === '403') throw new Error('GitLab denied access; check the token scope (HTTP 403)')
      if (status === '404') throw new Error('GitLab project or issue not found or not accessible (HTTP 404)')
      if (status === '429') throw new Error('GitLab rate limit exceeded (HTTP 429)')
      throw error
    }
  }
  /** Validate the mapping and return the encoded `:id` used in every project path. */
  private projectPath(projectId: string): string {
    if (!GITLAB_PROJECT_PATTERN.test(projectId)) throw new Error('invalid GitLab project scope')
    return encodeURIComponent(projectId)
  }
  private issueIid(value: unknown): string {
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) throw new Error('invalid GitLab issue iid')
    return String(value)
  }
  private numericIid(id: string): string {
    if (!/^[1-9]\d*$/.test(id)) throw new Error('invalid GitLab issue iid')
    const value = Number(id)
    if (!Number.isSafeInteger(value)) throw new Error('invalid GitLab issue iid')
    return String(value)
  }
  /** Merge requests leak into issue-shaped payloads; they are never tasks. */
  private isMergeRequest(issue: Record<string, unknown>): boolean {
    return (issue.merge_request !== undefined && issue.merge_request !== null) || issue.type === 'merge_request'
  }
  private labelsOf(raw: unknown): string[] {
    if (!Array.isArray(raw)) return []
    const labels: string[] = []
    for (const entry of raw) {
      if (typeof entry === 'string') { if (entry.trim()) labels.push(entry.trim()); continue }
      if (!entry || typeof entry !== 'object') continue
      const name = (entry as Record<string, unknown>).name
      if (typeof name === 'string' && name.trim()) labels.push(name.trim())
    }
    return labels
  }
  private threshold(key: string, fallback: string): Set<string> {
    const raw = this.config.settings[key] ?? fallback
    return new Set(raw.split(',').map(part => part.trim().toLowerCase()).filter(Boolean))
  }
  private urgency(labels: string[]): ExternalItem['urgency'] {
    const normalized = labels.map(label => label.toLowerCase())
    if (normalized.some(label => this.threshold('urgentLabels', 'urgent,priority: urgent,priority/urgent,p0,p1,紧急').has(label))) return 'urgent'
    if (normalized.some(label => this.threshold('relaxedLabels', 'low,minor,priority: low,低').has(label))) return 'relaxed'
    return 'normal'
  }
  private normalize(projectId: string, issue: Record<string, unknown>): ExternalItem {
    const id = this.issueIid(issue.iid)
    if (typeof issue.title !== 'string' || !issue.title.trim()) throw new Error('invalid GitLab issue title')
    if (issue.state !== 'opened' && issue.state !== 'closed') throw new Error('invalid GitLab issue state')
    const url = issue.web_url
    if (typeof url !== 'string') throw new Error('invalid GitLab issue URL')
    try {
      if (!['http:', 'https:'].includes(new URL(url).protocol)) throw new Error('invalid GitLab issue URL')
    } catch { throw new Error('invalid GitLab issue URL') }
    const labels = this.labelsOf(issue.labels)
    const assignees = Array.isArray(issue.assignees)
      ? issue.assignees.flatMap(entry => {
        const username = entry && typeof entry === 'object' ? (entry as Record<string, unknown>).username : undefined
        return typeof username === 'string' && username ? [username] : []
      })
      : []
    return {
      projectId, type: 'issue', id, title: issue.title.trim(),
      description: typeof issue.description === 'string' ? issue.description : '',
      priority: labels.join(','), status: issue.state, assignedTo: assignees[0] ?? '',
      assignees, closed: issue.state === 'closed', urgency: this.urgency(labels), url,
      ...(typeof issue.updated_at === 'string' && issue.updated_at ? { revision: issue.updated_at } : {}),
    }
  }
  private readCreatedAt(issue: Record<string, unknown>): string {
    return typeof issue.created_at === 'string' ? issue.created_at.slice(0, 10) : ''
  }
  async test(signal: AbortSignal): Promise<void> {
    const account = await this.getAccount(signal)
    if (!account.account) throw new Error('GitLab token does not identify an account')
    for (const mapping of this.config.mappings) {
      const { body } = await this.send('GET', `/projects/${this.projectPath(mapping.projectId)}`, signal)
      if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('invalid GitLab project response')
      const pathWithNamespace = (body as Record<string, unknown>).path_with_namespace
      if (typeof pathWithNamespace !== 'string' || !pathWithNamespace) throw new Error('invalid GitLab project response')
      if (pathWithNamespace !== mapping.projectId) throw new Error('GitLab project response does not match the mapping')
    }
  }
  async getAccount(signal: AbortSignal): Promise<ExternalAccount> {
    const { body } = await this.send('GET', '/user', signal)
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('invalid GitLab account response')
    const username = (body as Record<string, unknown>).username
    if (typeof username !== 'string' || !username.trim()) throw new Error('GitLab token does not identify an account')
    return { account: username.trim(), name: username.trim() }
  }
  async listProjects(signal: AbortSignal): Promise<ExternalProject[]> {
    const projects: ExternalProject[] = []
    const seen = new Set<string>()
    for (let page = 1; page <= MAX_PROJECT_PAGE; page++) {
      const { body } = await this.send('GET', `/projects?membership=true&per_page=${PAGE_SIZE}&page=${page}&archived=false&order_by=id&sort=asc`, signal)
      if (!Array.isArray(body)) throw new Error('invalid GitLab project list')
      if (!body.length) break
      for (const raw of body) {
        if (!raw || typeof raw !== 'object') throw new Error('invalid GitLab project')
        const path = (raw as Record<string, unknown>).path_with_namespace
        if (typeof path !== 'string' || !GITLAB_PROJECT_PATTERN.test(path)) throw new Error('invalid GitLab project identity')
        if (!seen.has(path)) { seen.add(path); projects.push({ id: path, name: path }) }
      }
      if (body.length < PAGE_SIZE) break
      if (page === MAX_PROJECT_PAGE) throw new Error('GitLab project pagination limit exceeded')
    }
    return projects
  }
  async getItem(projectId: string, type: string, id: string, signal: AbortSignal): Promise<ExternalItem | undefined> {
    if (type !== 'issue' || !this.config.itemTypes.includes(type)) throw new Error('unsupported GitLab work item')
    const { body } = await this.send('GET', `/projects/${this.projectPath(projectId)}/issues/${this.numericIid(id)}`, signal)
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('invalid GitLab issue response')
    const issue = body as Record<string, unknown>
    if (this.isMergeRequest(issue)) throw new Error('GitLab merge requests are not work items')
    return this.normalize(projectId, issue)
  }
  async getItems(projectId: string, signal: AbortSignal, context?: ExternalReadContext): Promise<ExternalItem[]> {
    const project = this.projectPath(projectId)
    const items: ExternalItem[] = []
    const seen = new Set<string>()
    for (let page = 1; page <= MAX_PAGE; page++) {
      const { body } = await this.send('GET', `/projects/${project}/issues?state=all&per_page=${PAGE_SIZE}&page=${page}&order_by=created_at&sort=asc`, signal)
      if (!Array.isArray(body)) throw new Error('invalid GitLab issue list')
      if (!body.length) break
      for (const raw of body) {
        if (!raw || typeof raw !== 'object') throw new Error('invalid GitLab issue')
        const issue = raw as Record<string, unknown>
        // Merge requests may share the issue shape; never import them.
        if (this.isMergeRequest(issue)) continue
        const item = this.normalize(projectId, issue)
        if (seen.has(item.id)) continue
        seen.add(item.id)
        const previous = context?.existing.get(JSON.stringify(['issue', item.id]))
        const created = this.readCreatedAt(issue)
        if (!previous && this.config.since && created && created < this.config.since) continue
        items.push(item)
      }
      if (body.length < PAGE_SIZE) break
      if (page === MAX_PAGE) throw new Error('GitLab issue pagination limit exceeded')
    }
    return items
  }
  async createItem(projectId: string, fields: ExternalFields, signal: AbortSignal): Promise<ExternalItem> {
    const { body } = await this.send('POST', `/projects/${this.projectPath(projectId)}/issues`, signal, { title: fields.title, description: fields.description })
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('invalid GitLab issue response')
    return this.normalize(projectId, body as Record<string, unknown>)
  }
  async updateItem(projectId: string, type: string, id: string, patch: ExternalPushPatch, signal: AbortSignal): Promise<ExternalItem> {
    if (type !== 'issue') throw new Error('unsupported GitLab work item')
    const payload: Record<string, unknown> = {}
    if (patch.title !== undefined) payload.title = patch.title
    if (patch.description !== undefined) payload.description = patch.description
    // Only closure is pushed: reopening a remote issue stays a human decision.
    if (patch.close !== undefined) payload.state_event = 'close'
    if (!Object.keys(payload).length) throw new Error('empty GitLab update')
    const { body } = await this.send('PUT', `/projects/${this.projectPath(projectId)}/issues/${this.numericIid(id)}`, signal, payload)
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('invalid GitLab issue response')
    return this.normalize(projectId, body as Record<string, unknown>)
  }
}

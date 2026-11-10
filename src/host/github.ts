import type { ExternalAccount, ExternalConfig, ExternalFields, ExternalItem, ExternalProject, ExternalPushPatch } from '../shared/external.ts'
import type { ExternalReadContext, ExternalTaskProvider, ExternalWriteProvider } from './external-provider.ts'
import { externalSend } from './external-http.ts'

const API_VERSION = '2022-11-28'
/** `owner/repo`; `.` and `..` path segments are refused (URL path traversal). */
const REPO_PATTERN = /^(?!\.{1,2}\/)(?!.*\/\.{1,2}$)[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/
const PAGE_SIZE = 100

/**
 * GitHub Issues provider (REST v3). One connection maps repositories
 * (`owner/repo`) to local projects; issues assigned to the configured login
 * are imported, and `capabilities.write` enables the opt-in outbound phase.
 */
export class GithubProvider implements ExternalTaskProvider, ExternalWriteProvider {
  constructor(private readonly config: ExternalConfig, private readonly request: typeof fetch = fetch) {
    if (config.authMode !== 'token' || !config.credentials.token) throw new Error('GitHub requires a token')
  }
  private headers(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.config.credentials.token}`,
      'X-GitHub-Api-Version': API_VERSION,
      'User-Agent': 'dsh-taskboard',
    }
  }
  /** Map transport failures to actionable messages; never echo response bodies. */
  private async send(method: string, path: string, signal: AbortSignal, body?: unknown): Promise<{ body: unknown; headers: Headers }> {
    try {
      return await externalSend(this.request, `${this.config.baseUrl}${path}`, {
        method, headers: this.headers(), ...(body === undefined ? {} : { body }),
      }, signal)
    } catch (error) {
      const status = error instanceof Error ? /HTTP (\d{3})/.exec(error.message)?.[1] : undefined
      if (status === '401') throw new Error('GitHub rejected the token (HTTP 401)')
      if (status === '403') throw new Error('GitHub denied access; check token scopes and rate limits (HTTP 403)')
      if (status === '404') throw new Error('GitHub repository or issue not found or not accessible (HTTP 404)')
      if (status === '422') throw new Error('GitHub rejected the change (HTTP 422)')
      throw error
    }
  }
  private scope(projectId: string): { owner: string; repo: string } {
    const match = REPO_PATTERN.exec(projectId)
    if (!match) throw new Error('invalid GitHub repository scope')
    const [owner, repo] = projectId.split('/') as [string, string]
    return { owner, repo }
  }
  private issueNumber(value: unknown): string {
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) throw new Error('invalid GitHub issue number')
    return String(value)
  }
  private numericId(id: string): string {
    if (!/^[1-9]\d*$/.test(id)) throw new Error('invalid GitHub issue number')
    const value = Number(id)
    if (!Number.isSafeInteger(value)) throw new Error('invalid GitHub issue number')
    return String(value)
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
    const id = this.issueNumber(issue.number)
    if (typeof issue.title !== 'string' || !issue.title.trim()) throw new Error('invalid GitHub issue title')
    if (issue.state !== 'open' && issue.state !== 'closed') throw new Error('invalid GitHub issue state')
    const url = issue.html_url
    if (typeof url !== 'string') throw new Error('invalid GitHub issue URL')
    try {
      if (!['http:', 'https:'].includes(new URL(url).protocol)) throw new Error('invalid GitHub issue URL')
    } catch { throw new Error('invalid GitHub issue URL') }
    const labels = this.labelsOf(issue.labels)
    const assignees = Array.isArray(issue.assignees)
      ? issue.assignees.flatMap(entry => {
        const login = entry && typeof entry === 'object' ? (entry as Record<string, unknown>).login : undefined
        return typeof login === 'string' && login ? [login] : []
      })
      : []
    const assignee = issue.assignee && typeof issue.assignee === 'object' && typeof (issue.assignee as Record<string, unknown>).login === 'string'
      ? String((issue.assignee as Record<string, unknown>).login)
      : assignees[0] ?? ''
    return {
      projectId, type: 'issue', id, title: issue.title.trim(),
      description: typeof issue.body === 'string' ? issue.body : '',
      priority: labels.join(','), status: issue.state, assignedTo: assignee,
      assignees, closed: issue.state === 'closed', urgency: this.urgency(labels), url,
    }
  }
  private readCreatedAt(issue: Record<string, unknown>): string {
    return typeof issue.created_at === 'string' ? issue.created_at.slice(0, 10) : ''
  }
  async test(signal: AbortSignal): Promise<void> {
    const account = await this.getAccount(signal)
    if (!account.account) throw new Error('GitHub token does not identify an account')
    for (const mapping of this.config.mappings) {
      const { owner, repo } = this.scope(mapping.projectId)
      const { body } = await this.send('GET', `/repos/${owner}/${repo}`, signal)
      if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('invalid GitHub repository response')
      if ((body as Record<string, unknown>).full_name !== mapping.projectId) throw new Error('GitHub repository response does not match the mapping')
    }
  }
  async getAccount(signal: AbortSignal): Promise<ExternalAccount> {
    const { body } = await this.send('GET', '/user', signal)
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('invalid GitHub account response')
    const login = (body as Record<string, unknown>).login
    if (typeof login !== 'string' || !login.trim()) throw new Error('GitHub token does not identify an account')
    return { account: login.trim(), name: login.trim() }
  }
  async listProjects(signal: AbortSignal): Promise<ExternalProject[]> {
    const projects: ExternalProject[] = []
    const seen = new Set<string>()
    for (let page = 1; page <= 100; page++) {
      const { body } = await this.send('GET', `/user/repos?per_page=${PAGE_SIZE}&page=${page}&sort=full_name&affiliation=owner,collaborator,organization_member`, signal)
      if (!Array.isArray(body)) throw new Error('invalid GitHub repository list')
      if (!body.length) break
      for (const raw of body) {
        if (!raw || typeof raw !== 'object') throw new Error('invalid GitHub repository')
        const fullName = (raw as Record<string, unknown>).full_name
        if (typeof fullName !== 'string' || !REPO_PATTERN.test(fullName)) throw new Error('invalid GitHub repository identity')
        if (!seen.has(fullName)) { seen.add(fullName); projects.push({ id: fullName, name: fullName }) }
      }
      if (body.length < PAGE_SIZE) break
      if (page === 100) throw new Error('GitHub repository pagination limit exceeded')
    }
    return projects
  }
  async getItem(projectId: string, type: string, id: string, signal: AbortSignal): Promise<ExternalItem | undefined> {
    if (type !== 'issue' || !this.config.itemTypes.includes(type)) throw new Error('unsupported GitHub work item')
    const { owner, repo } = this.scope(projectId)
    const { body } = await this.send('GET', `/repos/${owner}/${repo}/issues/${this.numericId(id)}`, signal)
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('invalid GitHub issue response')
    if ((body as Record<string, unknown>).pull_request !== undefined) throw new Error('GitHub pull requests are not work items')
    return this.normalize(projectId, body as Record<string, unknown>)
  }
  async getItems(projectId: string, signal: AbortSignal, context?: ExternalReadContext): Promise<ExternalItem[]> {
    const { owner, repo } = this.scope(projectId)
    const items: ExternalItem[] = []
    const seen = new Set<string>()
    for (let page = 1; page <= 1_000; page++) {
      const { body } = await this.send('GET', `/repos/${owner}/${repo}/issues?state=all&per_page=${PAGE_SIZE}&page=${page}&sort=created&direction=asc`, signal)
      if (!Array.isArray(body)) throw new Error('invalid GitHub issue list')
      if (!body.length) break
      for (const raw of body) {
        if (!raw || typeof raw !== 'object') throw new Error('invalid GitHub issue')
        const issue = raw as Record<string, unknown>
        // The issues endpoint also returns pull requests; never import them.
        if (issue.pull_request !== undefined) continue
        const item = this.normalize(projectId, issue)
        if (seen.has(item.id)) continue
        seen.add(item.id)
        const previous = context?.existing.get(JSON.stringify(['issue', item.id]))
        const created = this.readCreatedAt(issue)
        if (!previous && this.config.since && created && created < this.config.since) continue
        items.push(item)
      }
      if (body.length < PAGE_SIZE) break
      if (page === 1_000) throw new Error('GitHub issue pagination limit exceeded')
    }
    return items
  }
  async createItem(projectId: string, fields: ExternalFields, signal: AbortSignal): Promise<ExternalItem> {
    const { owner, repo } = this.scope(projectId)
    const { body } = await this.send('POST', `/repos/${owner}/${repo}/issues`, signal, { title: fields.title, body: fields.description })
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('invalid GitHub issue response')
    return this.normalize(projectId, body as Record<string, unknown>)
  }
  async updateItem(projectId: string, type: string, id: string, patch: ExternalPushPatch, signal: AbortSignal): Promise<ExternalItem> {
    if (type !== 'issue') throw new Error('unsupported GitHub work item')
    const { owner, repo } = this.scope(projectId)
    const payload: Record<string, unknown> = {}
    if (patch.title !== undefined) payload.title = patch.title
    if (patch.description !== undefined) payload.body = patch.description
    if (patch.close !== undefined) { payload.state = 'closed'; payload.state_reason = patch.close }
    if (!Object.keys(payload).length) throw new Error('empty GitHub update')
    const { body } = await this.send('PATCH', `/repos/${owner}/${repo}/issues/${this.numericId(id)}`, signal, payload)
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('invalid GitHub issue response')
    return this.normalize(projectId, body as Record<string, unknown>)
  }
}

import type { ExternalAccount, ExternalConfig, ExternalFields, ExternalItem, ExternalProject, ExternalPushPatch } from '../shared/external.ts'
import type { ExternalReadContext, ExternalTaskProvider, ExternalWriteProvider } from './external-provider.ts'
import { externalSend } from './external-http.ts'

/** Gitea/Forgejo repository scope: `owner/repo` (no subgroups). */
export const GITEA_REPO_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/
/** Gitea caps page sizes at 50, so every listing uses that hard limit. */
const PAGE_SIZE = 50
const MAX_PAGE = 1_000
const MAX_PROJECT_PAGE = 100

/**
 * Gitea / Forgejo Issues provider (API v1). One connection maps repositories
 * (`owner/repo`) to local projects; issues are read from the repository issue
 * list and `capabilities.write` enables the opt-in outbound phase. Forgejo
 * implements the same API, so a single adapter serves both forges.
 */
export class GiteaProvider implements ExternalTaskProvider, ExternalWriteProvider {
  constructor(private readonly config: ExternalConfig, private readonly request: typeof fetch = fetch) {
    if (config.authMode !== 'token' || !config.credentials.token) throw new Error('Gitea requires a token')
  }
  private headers(): Record<string, string> {
    return {
      Authorization: `token ${this.config.credentials.token!}`,
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
      if (status === '401') throw new Error('Gitea rejected the token (HTTP 401)')
      if (status === '403') throw new Error('Gitea denied access; check the token scope (HTTP 403)')
      if (status === '404') throw new Error('Gitea repository or issue not found or not accessible (HTTP 404)')
      if (status === '429') throw new Error('Gitea rate limit exceeded (HTTP 429)')
      throw error
    }
  }
  private scope(projectId: string): { owner: string; repo: string } {
    if (!GITEA_REPO_PATTERN.test(projectId)) throw new Error('invalid Gitea repository scope')
    const [owner, repo] = projectId.split('/') as [string, string]
    return { owner, repo }
  }
  private issueNumber(value: unknown): string {
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) throw new Error('invalid Gitea issue number')
    return String(value)
  }
  private numericId(id: string): string {
    if (!/^[1-9]\d*$/.test(id)) throw new Error('invalid Gitea issue number')
    const value = Number(id)
    if (!Number.isSafeInteger(value)) throw new Error('invalid Gitea issue number')
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
    if (typeof issue.title !== 'string' || !issue.title.trim()) throw new Error('invalid Gitea issue title')
    if (issue.state !== 'open' && issue.state !== 'closed') throw new Error('invalid Gitea issue state')
    const url = issue.html_url
    if (typeof url !== 'string') throw new Error('invalid Gitea issue URL')
    try {
      if (!['http:', 'https:'].includes(new URL(url).protocol)) throw new Error('invalid Gitea issue URL')
    } catch { throw new Error('invalid Gitea issue URL') }
    const labels = this.labelsOf(issue.labels)
    const assignees = Array.isArray(issue.assignees)
      ? issue.assignees.flatMap(entry => {
        const login = entry && typeof entry === 'object' ? (entry as Record<string, unknown>).login : undefined
        return typeof login === 'string' && login ? [login] : []
      })
      : []
    return {
      projectId, type: 'issue', id, title: issue.title.trim(),
      description: typeof issue.body === 'string' ? issue.body : '',
      priority: labels.join(','), status: issue.state, assignedTo: assignees[0] ?? '',
      assignees, closed: issue.state === 'closed', urgency: this.urgency(labels), url,
      ...(typeof issue.updated_at === 'string' && issue.updated_at ? { revision: issue.updated_at } : {}),
    }
  }
  private readCreatedAt(issue: Record<string, unknown>): string {
    return typeof issue.created_at === 'string' ? issue.created_at.slice(0, 10) : ''
  }
  private async projectPage(page: number, search: boolean, signal: AbortSignal): Promise<unknown> {
    const path = search ? `/repos/search?limit=${PAGE_SIZE}&page=${page}` : `/user/repos?limit=${PAGE_SIZE}&page=${page}`
    return (await this.send('GET', path, signal)).body
  }
  async test(signal: AbortSignal): Promise<void> {
    const account = await this.getAccount(signal)
    if (!account.account) throw new Error('Gitea token does not identify an account')
    for (const mapping of this.config.mappings) {
      const { owner, repo } = this.scope(mapping.projectId)
      const { body } = await this.send('GET', `/repos/${owner}/${repo}`, signal)
      if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('invalid Gitea repository response')
      const fullName = (body as Record<string, unknown>).full_name
      if (typeof fullName !== 'string' || !fullName) throw new Error('invalid Gitea repository response')
      if (fullName !== mapping.projectId) throw new Error('Gitea repository response does not match the mapping')
    }
  }
  async getAccount(signal: AbortSignal): Promise<ExternalAccount> {
    const { body } = await this.send('GET', '/user', signal)
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('invalid Gitea account response')
    const login = (body as Record<string, unknown>).login
    if (typeof login !== 'string' || !login.trim()) throw new Error('Gitea token does not identify an account')
    return { account: login.trim(), name: login.trim() }
  }
  async listProjects(signal: AbortSignal): Promise<ExternalProject[]> {
    const projects: ExternalProject[] = []
    const seen = new Set<string>()
    let search = false
    for (let page = 1; page <= MAX_PROJECT_PAGE; page++) {
      let body: unknown
      try {
        body = await this.projectPage(page, search, signal)
      } catch (error) {
        // Some deployments hide /user/repos; fall back to /repos/search once.
        if (search || page !== 1 || !(error instanceof Error && /\(HTTP 404\)$/.test(error.message))) throw error
        search = true
        body = await this.projectPage(page, search, signal)
      }
      const list = search ? this.searchResults(body) : this.userRepos(body)
      if (!list.length) break
      for (const raw of list) {
        if (!raw || typeof raw !== 'object') throw new Error('invalid Gitea repository')
        const fullName = (raw as Record<string, unknown>).full_name
        if (typeof fullName !== 'string' || !GITEA_REPO_PATTERN.test(fullName)) throw new Error('invalid Gitea repository identity')
        if (!seen.has(fullName)) { seen.add(fullName); projects.push({ id: fullName, name: fullName }) }
      }
      if (list.length < PAGE_SIZE) break
      if (page === MAX_PROJECT_PAGE) throw new Error('Gitea repository pagination limit exceeded')
    }
    return projects
  }
  /** `/user/repos` answers a bare array. */
  private userRepos(body: unknown): unknown[] {
    if (!Array.isArray(body)) throw new Error('invalid Gitea repository list')
    return body
  }
  /** `/repos/search` wraps its results in `{ ok, data }`. */
  private searchResults(body: unknown): unknown[] {
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('invalid Gitea repository list')
    const data = (body as Record<string, unknown>).data
    if (!Array.isArray(data)) throw new Error('invalid Gitea repository list')
    return data
  }
  async getItem(projectId: string, type: string, id: string, signal: AbortSignal): Promise<ExternalItem | undefined> {
    if (type !== 'issue' || !this.config.itemTypes.includes(type)) throw new Error('unsupported Gitea work item')
    const { owner, repo } = this.scope(projectId)
    const { body } = await this.send('GET', `/repos/${owner}/${repo}/issues/${this.numericId(id)}`, signal)
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('invalid Gitea issue response')
    const issue = body as Record<string, unknown>
    if (issue.pull_request !== undefined && issue.pull_request !== null) throw new Error('Gitea pull requests are not work items')
    return this.normalize(projectId, issue)
  }
  async getItems(projectId: string, signal: AbortSignal, context?: ExternalReadContext): Promise<ExternalItem[]> {
    const { owner, repo } = this.scope(projectId)
    const items: ExternalItem[] = []
    const seen = new Set<string>()
    for (let page = 1; page <= MAX_PAGE; page++) {
      const { body } = await this.send('GET', `/repos/${owner}/${repo}/issues?state=all&type=issues&limit=${PAGE_SIZE}&page=${page}`, signal)
      if (!Array.isArray(body)) throw new Error('invalid Gitea issue list')
      if (!body.length) break
      for (const raw of body) {
        if (!raw || typeof raw !== 'object') throw new Error('invalid Gitea issue')
        const issue = raw as Record<string, unknown>
        // The issue list also returns pull requests; never import them.
        if (issue.pull_request !== undefined && issue.pull_request !== null) continue
        const item = this.normalize(projectId, issue)
        if (seen.has(item.id)) continue
        seen.add(item.id)
        const previous = context?.existing.get(JSON.stringify(['issue', item.id]))
        const created = this.readCreatedAt(issue)
        if (!previous && this.config.since && created && created < this.config.since) continue
        items.push(item)
      }
      if (body.length < PAGE_SIZE) break
      if (page === MAX_PAGE) throw new Error('Gitea issue pagination limit exceeded')
    }
    return items
  }
  async createItem(projectId: string, fields: ExternalFields, signal: AbortSignal): Promise<ExternalItem> {
    const { owner, repo } = this.scope(projectId)
    const { body } = await this.send('POST', `/repos/${owner}/${repo}/issues`, signal, { title: fields.title, body: fields.description })
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('invalid Gitea issue response')
    return this.normalize(projectId, body as Record<string, unknown>)
  }
  async updateItem(projectId: string, type: string, id: string, patch: ExternalPushPatch, signal: AbortSignal): Promise<ExternalItem> {
    if (type !== 'issue') throw new Error('unsupported Gitea work item')
    const { owner, repo } = this.scope(projectId)
    const payload: Record<string, unknown> = {}
    if (patch.title !== undefined) payload.title = patch.title
    if (patch.description !== undefined) payload.body = patch.description
    // Only closure is pushed: reopening a remote issue stays a human decision.
    if (patch.close !== undefined) payload.state = 'closed'
    if (!Object.keys(payload).length) throw new Error('empty Gitea update')
    const { body } = await this.send('PATCH', `/repos/${owner}/${repo}/issues/${this.numericId(id)}`, signal, payload)
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('invalid Gitea issue response')
    return this.normalize(projectId, body as Record<string, unknown>)
  }
}

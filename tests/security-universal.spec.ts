// @vitest-environment jsdom
/**
 * Independent security audit — universal external synchronization
 * (`src/host/external-sync.ts`, `external-config.ts`, `external-provider.ts`,
 * `external-http.ts`, `gitlab.ts`, `gitea.ts`, `src/shared/external.ts`) and
 * the React provenance panel.
 *
 * Scope of THIS file: credential containment in `status()`/exports/ledger,
 * connection-file permissions, credential-reuse identity guard, opt-in
 * write-back, multi-connection bounds, hostile-ticket normalisation
 * (`javascript:` / HTML), prototype pollution, adapter transport (token in
 * headers only, no redirects, bounded pagination, error mapping), adapter
 * contract hardening, and React text escaping. The public execution API lives
 * in `tests/security-public-api.spec.ts`; findings are consolidated in
 * `docs/SECURITY-REVIEW.md`.
 *
 * Conventions: deterministic and offline (injected `fetch`, temp files, no
 * network); `DÉFAUT` tests are red on purpose and marked `it.fails` until the
 * production code is fixed (auditor write scope: this file never edits src/).
 *
 * @module dsh-taskboard/tests/security-universal
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GiteaProvider, GITEA_REPO_PATTERN } from '../src/host/gitea.ts'
import { GitlabProvider } from '../src/host/gitlab.ts'
import { ExternalSyncService, normalizeExternalConfig } from '../src/host/external-sync.ts'
import { assertProviderContract, ExternalProviderRegistry, type ExternalTaskProvider, type ExternalWriteProvider } from '../src/host/external-provider.ts'
import { createBuiltinProviders } from '../src/host/external-providers.ts'
import { trackerText } from '../src/host/external-http.ts'
import { TaskStore } from '../src/host/store.ts'
import {
  normalizeExternalReferences,
  normalizeExternalSource,
  normalizeExternalSyncRecords,
  type ExternalConfig,
  type ExternalItem,
  type ExternalPushPatch,
  type ExternalSource,
  type ProviderDescriptor,
} from '../src/shared/external.ts'
import type { TaskRecord } from '../src/shared/protocol.ts'
import { ExternalSourcePanel } from '../src/client/board/ExternalSourcePanel.tsx'

// jsdom ships its own AbortSignal without the static `any` helper, while the
// host code targets Node >= 22 where it exists (`AbortSignal.any` is used by
// the sync engine and the HTTP transport). Restore the Node semantics so the
// audited code runs UNMODIFIED — this is a test-environment shim, not a
// production change.
if (typeof (AbortSignal as unknown as { any?: unknown }).any !== 'function') {
  ;(AbortSignal as unknown as { any: (signals: AbortSignal[]) => AbortSignal }).any = (signals: AbortSignal[]) => {
    const controller = new AbortController()
    for (const candidate of signals) {
      if (candidate.aborted) { controller.abort(candidate.reason); break }
      candidate.addEventListener('abort', () => controller.abort(candidate.reason), { once: true })
    }
    return controller.signal
  }
}
/** Repo-absolute path helper: jsdom's URL is not a node:fs URL instance. */
const repoPath = (...parts: string[]): string => join(process.cwd(), ...parts)

// ---------------------------------------------------------------------------
// harness
// ---------------------------------------------------------------------------
const directories: string[] = []
const disposers: Array<() => void> = []
let root: Root | undefined

beforeEach(() => { vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true) })

afterEach(async () => {
  if (root !== undefined) { const mounted = root; root = undefined; await act(async () => { mounted.unmount() }) }
  document.body.innerHTML = ''
  for (const dispose of disposers.splice(0)) dispose()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  await Promise.all(directories.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
})

type ProviderStub = ExternalTaskProvider & Partial<ExternalWriteProvider>

async function syncFixture(provider?: (config: ExternalConfig) => ProviderStub) {
  const dir = await mkdtemp(join(tmpdir(), 'tb-sec-universal-'))
  directories.push(dir)
  const file = join(dir, 'external.json')
  const ledgerFile = join(dir, 'tasks.json')
  const store = new TaskStore({ file: ledgerFile })
  const service = new ExternalSyncService({
    file, store, workspaceExists: () => true, now: () => 1_000, registry: createBuiltinProviders(),
    provider: provider ?? (() => ({ test: async () => {}, getItems: async () => [] })),
  })
  disposers.push(() => service.dispose())
  return { dir, file, ledgerFile, store, service }
}

const ZENTAO = {
  provider: 'zentao', mappingMode: 'project', baseUrl: 'https://zentao.test', account: 'alice', authMode: 'password',
  credentials: { username: 'alice', password: 'ZENTAO-PASSWORD-MARKER' },
  mappings: [{ projectId: 'project:1', workspaceId: 'ws' }],
} as const

const GITEA = {
  provider: 'gitea', baseUrl: 'https://gitea.test/api/v1', account: 'alice', authMode: 'token',
  credentials: { token: 'GITEA-TOKEN-MARKER' }, itemTypes: ['issue'],
  mappings: [{ projectId: 'owner/repo', workspaceId: 'ws' }], intervalMinutes: 0,
} as const

const GITHUB = {
  provider: 'github', baseUrl: 'https://api.github.com', account: 'octocat', authMode: 'token',
  credentials: { token: 'GITHUB-TOKEN-MARKER' }, itemTypes: ['issue'],
  mappings: [{ projectId: 'octo/repo', workspaceId: 'ws' }], intervalMinutes: 0, assigneeFilter: false,
} as const

const TAPD = {
  provider: 'tapd', baseUrl: 'https://api.tapd.cn', account: 'alice', authMode: 'basic',
  credentials: { apiUser: 'alice', apiPassword: 'TAPD-PASSWORD-MARKER' },
  mappings: [{ projectId: '12345', workspaceId: 'ws' }],
} as const

const issue = (overrides: Partial<ExternalItem> = {}): ExternalItem => ({
  projectId: 'owner/repo', type: 'issue', id: '7', title: 'Fix the thing', description: 'Details',
  urgency: 'normal', priority: 'bug', status: 'open', assignedTo: 'alice', assignees: ['alice'],
  closed: false, url: 'https://gitea.test/owner/repo/issues/7', revision: '2026-01-03T04:05:06Z', ...overrides,
})

function sourceOf(item: Partial<ExternalItem> = {}): ExternalSource {
  return { connectionId: 'c1', provider: 'gitea', providerName: 'Gitea', syncedAt: 1, conflicts: [], item: issue(item) }
}

// ---------------------------------------------------------------------------
// 1. Credential containment in status()/exports
// ---------------------------------------------------------------------------
describe('secrets — statut, exports et ledger', () => {
  it('status() ne contient aucune valeur de credential (secrets et champs non déclarés)', async () => {
    const f = await syncFixture()
    await f.service.configure(ZENTAO)
    const status = await f.service.status()
    expect(status.config).toBeDefined()
    expect(status.config && 'credentials' in status.config).toBe(false)
    expect(status.credentialPresent).toEqual({ username: true, password: true })
    // Only fields EXPLICITLY declared `secret:false` may be echoed (username).
    expect(status.credentialValues).toEqual({ username: 'alice' })
    expect(JSON.stringify(status)).not.toContain('ZENTAO-PASSWORD-MARKER')
  })

  it('fail-closed : un champ sensible non marqué `secret` n’est jamais exposé', async () => {
    // TAPD's descriptor omits `secret:true` on apiPassword; `credentialValues`
    // filters on `secret === false` (strict), so the password stays hidden.
    const f = await syncFixture()
    await f.service.configure(TAPD)
    const status = await f.service.status()
    expect(status.credentialValues).toEqual({})
    expect(JSON.stringify(status)).not.toContain('TAPD-PASSWORD-MARKER')
    // A token provider is redacted the same way.
    const g = await syncFixture()
    await g.service.configure(GITEA)
    expect(JSON.stringify(await g.service.status())).not.toContain('GITEA-TOKEN-MARKER')
  })

  it('un échec de synchronisation ne recopie jamais le credential ni le corps distant', async () => {
    const f = await syncFixture(() => ({
      test: async () => {},
      getItems: async () => { throw new Error('GITEA-TOKEN-MARKER leaked by provider') },
    }))
    await f.service.configure(GITEA)
    const failure = await f.service.sync().then(() => undefined, (error: Error) => error)
    expect(failure).toBeInstanceOf(Error)
    expect(failure!.message).not.toContain('GITEA-TOKEN-MARKER')
    expect(failure!.message).toMatch(/External sync failed/)
    const status = await f.service.status()
    expect(status.lastError).not.toContain('GITEA-TOKEN-MARKER')
    expect(JSON.stringify(status)).not.toContain('GITEA-TOKEN-MARKER')
    expect(JSON.stringify(f.store.snapshot())).not.toContain('GITEA-TOKEN-MARKER')
  })

  it('le ledger (tâches, commentaires, rapports) ne contient aucun credential', async () => {
    const f = await syncFixture(() => ({ test: async () => {}, getItems: async () => [issue()] }))
    await f.service.configure(GITEA)
    const result = await f.service.sync()
    expect(result.created).toBe(1)
    expect(JSON.stringify(f.store.snapshot())).not.toContain('GITEA-TOKEN-MARKER')
    expect(JSON.stringify(f.store.snapshot().tasks[0]!.external)).not.toContain('GITEA-TOKEN-MARKER')
    // The host-owned connection file DOES hold the credential (by design) —
    // only that file may carry it.
    expect(await readFile(f.file, 'utf8')).toContain('GITEA-TOKEN-MARKER')
  })

  it('le fichier de connexions est créé en 0600 (POSIX) / la source demande 0600', async () => {
    const f = await syncFixture()
    await f.service.configure(GITEA)
    if (process.platform === 'win32') {
      // Windows ignores POSIX mode bits; the file is protected by ACLs instead.
      // Assert the source still requests 0600 so POSIX hosts enforce it.
      const source = readFileSync(repoPath('src/host/external-sync.ts'), 'utf8')
      expect(source).toContain('{ mode: 0o600 }')
      expect(source).toContain("const temp = `${this.options.file}.tmp`")
      // Temp file + rename: the credential file is never written in place.
      expect(source).toContain('await rename(temp, this.options.file)')
    } else {
      expect(statSync(f.file).mode & 0o777).toBe(0o600)
    }
    // No credential ever lands in the ledger file.
    expect(await readFile(f.ledgerFile, 'utf8').catch(() => '')).not.toContain('GITEA-TOKEN-MARKER')
  })
})

// ---------------------------------------------------------------------------
// 2. Connection normalisation + credential reuse
// ---------------------------------------------------------------------------
describe('normalisation des connexions', () => {
  it('valide l’URL de base (protocole, credentials embarqués, query, hash)', () => {
    const invalid = [
      'ftp://gitea.test/api/v1',
      'javascript:alert(1)',
      'https://user:pass@gitea.test/api/v1',
      'https://gitea.test/api/v1?x=1',
      'https://gitea.test/api/v1#frag',
    ]
    for (const baseUrl of invalid) {
      expect(() => normalizeExternalConfig({ ...GITEA, baseUrl }), baseUrl).toThrow()
    }
    expect(normalizeExternalConfig({ ...GITEA, baseUrl: 'https://gitea.test/api/v1/' }).baseUrl).toBe('https://gitea.test/api/v1')
  })

  it('exige de ressaisir les credentials quand l’identité change (pas d’exfiltration du token)', async () => {
    const f = await syncFixture()
    const id = await f.service.configure(GITEA)
    // New host, no credentials: the stored token must never be forwarded.
    await expect(f.service.configure({ ...GITEA, baseUrl: 'https://attacker.test/api/v1', credentials: {} }))
      .rejects.toThrow('enter credentials')
    // The refused write left the stored connection untouched.
    expect((await f.service.status()).config!.baseUrl).toBe('https://gitea.test/api/v1')
    expect(await readFile(f.file, 'utf8')).toContain('gitea.test')
    // Identical identity (provider/baseUrl/account/authMode) reuses the token.
    expect(await f.service.configure({ ...GITEA, credentials: {} })).toBe(id)
  })

  it('refuse la synchronisation bidirectionnelle pour un fournisseur en lecture seule', async () => {
    const f = await syncFixture()
    await expect(f.service.configure({ ...ZENTAO, direction: 'bidirectional' })).rejects.toThrow('does not support write-back')
  })
})

// ---------------------------------------------------------------------------
// 3. Write-back opt-in
// ---------------------------------------------------------------------------
describe('write-back opt-in', () => {
  function writeStub(items: ExternalItem[]) {
    const writes: string[] = []
    const provider: ProviderStub = {
      test: async () => {},
      getItems: async () => structuredClone(items),
      createItem: async (_projectId: string, fields) => {
        writes.push('create')
        return { ...structuredClone(items[0]!), ...fields, id: '99', url: 'https://api.github.com/repos/octo/repo/issues/99' }
      },
      updateItem: async (_projectId: string, _type: string, id: string, patch: ExternalPushPatch) => {
        writes.push(`update:${id}`)
        const base = structuredClone(items[0]!)
        return { ...base, ...(patch.title === undefined ? {} : { title: patch.title }), ...(patch.description === undefined ? {} : { description: patch.description }) }
      },
    }
    return { writes, provider }
  }

  it('la capacité d’écriture seule ne pousse jamais : direction « inbound » par défaut', async () => {
    const stub = writeStub([issue({ projectId: 'octo/repo', url: 'https://api.github.com/repos/octo/repo/issues/7' })])
    const f = await syncFixture(() => stub.provider)
    await f.service.configure(GITHUB)
    expect((await f.service.status()).config!.direction).toBe('inbound')
    expect(await f.service.sync()).toMatchObject({ created: 1 })
    expect(stub.writes).toEqual([])
    // Even an explicit push request is refused without the opt-in.
    const taskId = f.store.snapshot().tasks[0]!.id
    await expect(f.service.pushTask(taskId)).rejects.toThrow('enable bidirectional')
    expect(stub.writes).toEqual([])
    expect((await f.service.preview()).outbound.push).toBe(0)
  })

  it('« bidirectional » explicite autorise le push ; un cycle inbound ne pousse rien', async () => {
    const stub = writeStub([issue({ projectId: 'octo/repo', url: 'https://api.github.com/repos/octo/repo/issues/7' })])
    const f = await syncFixture(() => stub.provider)
    await f.service.configure(GITHUB)
    await f.service.sync()
    expect(stub.writes).toEqual([])
    // Same identity: credentials are reused; only the direction is added.
    await f.service.configure({ ...GITHUB, credentials: {}, direction: 'bidirectional' })
    expect((await f.service.status()).config!.direction).toBe('bidirectional')
    const before = f.store.snapshot().tasks[0]!
    await f.store.mutate('task-updated', ledger => {
      const task = ledger.tasks.find(candidate => candidate.id === before.id)!
      task.title = 'Local title'
      return [task]
    })
    const pushed = await f.service.sync()
    expect(pushed.pushed).toBe(1)
    expect(stub.writes).toEqual(['update:7'])
  })

  it('preview est strictement en lecture : aucun écrit local ni distant', async () => {
    const stub = writeStub([issue({ projectId: 'octo/repo', url: 'https://api.github.com/repos/octo/repo/issues/7' })])
    const f = await syncFixture(() => stub.provider)
    await f.service.configure({ ...GITHUB, direction: 'bidirectional' })
    const preview = await f.service.preview()
    expect(preview.direction).toBe('bidirectional')
    expect(preview.inbound.create).toBe(1)
    expect(stub.writes).toEqual([])
    expect(f.store.snapshot().tasks).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// 4. Multi-connection bounds / isolation
// ---------------------------------------------------------------------------
describe('multi-connexions', () => {
  it('borne le nombre de connexions, isole les états et refuse les identifiants inconnus', async () => {
    const f = await syncFixture()
    for (let index = 0; index < 10; index++) {
      await f.service.configure({ ...GITEA, account: `alice-${index}` }, undefined, true)
    }
    await expect(f.service.configure({ ...GITEA, account: 'overflow' }, undefined, true)).rejects.toThrow('too many configured connections')
    const status = await f.service.status()
    expect(status.connections).toHaveLength(10)
    expect(Object.keys(status.connectionStates ?? {})).toHaveLength(10)
    // No connection leaks a credential, including the non-primary ones.
    expect(JSON.stringify(status)).not.toContain('GITEA-TOKEN-MARKER')
    await expect(f.service.removeConnection('missing')).rejects.toThrow('unknown external connection')
    await expect(f.service.sync('missing')).rejects.toThrow('unknown external connection')
  })
})

// ---------------------------------------------------------------------------
// 5. Hostile ticket normalisation (injection)
// ---------------------------------------------------------------------------
describe('injection de tickets externes', () => {
  it('normalizeExternalSource n’accepte que http(s) comme URL de ticket', () => {
    const dangerous = [
      'javascript:alert(1)',
      'JAVASCRIPT:alert(1)',
      ' javascript:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      'file:///etc/passwd',
      'vbscript:msgbox(1)',
      '//gitea.test/protocol-relative',
    ]
    for (const url of dangerous) {
      expect(normalizeExternalSource(sourceOf({ url })), url).toBeUndefined()
    }
    // Valid http(s) URLs are accepted, protocol case-insensitively.
    expect(normalizeExternalSource(sourceOf({ url: 'HTTPS://gitea.test/owner/repo/issues/7' }))).toBeDefined()
  })

  it('un contenu hostile reste une donnée texte (jamais une URL ni un lanceur)', () => {
    const hostileTitle = '<img src=x onerror="globalThis.__pwned=1">Fix <script>alert(1)</script>'
    const normalized = normalizeExternalSource(sourceOf({ title: hostileTitle }))
    expect(normalized).toBeDefined()
    // Stored verbatim as DATA: no sanitisation-by-deletion, no URL promotion.
    expect(normalized!.item.title).toBe(hostileTitle)
    expect(normalized!.item.url).toMatch(/^https:\/\//)
    // Unknown / dangerous fields of the payload are dropped, never promoted.
    const polluted = normalizeExternalSource(JSON.parse(JSON.stringify({ ...sourceOf(), extra: { href: 'javascript:alert(1)' } })))
    expect(polluted).toBeDefined()
    expect(Object.keys(polluted!.item)).not.toContain('href')
    expect(Object.keys(polluted!.item)).not.toContain('extra')
  })

  it('normalizeExternalReferences filtre les protocoles, déduplique et plafonne à 20', () => {
    const refs = Array.from({ length: 25 }, (_, index) => ({
      system: 'gitea', instance: 'c1', kind: 'issue', project: 'o/r', id: String(index),
      url: index % 5 === 0 ? 'javascript:alert(1)' : `https://gitea.test/o/r/issues/${index}`,
      revision: '', syncedAt: 1, state: 'linked', provenance: 'imported',
    }))
    // Duplicates must collapse on the canonical identity.
    refs.push({ ...refs[1]! })
    const normalized = normalizeExternalReferences(refs)
    expect(normalized.length).toBeLessThanOrEqual(20)
    for (const ref of normalized) expect(new URL(ref.url).protocol).toMatch(/^https?:$/)
    const keys = normalized.map(ref => [ref.system, ref.instance, ref.kind, ref.project, ref.id].join('|'))
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('trackerText neutralise les balises script/style et le HTML résiduel', () => {
    expect(trackerText('<script>alert(1)</script>hello<br>world')).toBe('hello\nworld')
    expect(trackerText('<style>body{}</style>plain')).toBe('plain')
    expect(trackerText('<img src=x onerror=alert(1)>')).toBe('')
    expect(trackerText('a &amp; b &lt;tag&gt;')).toBe('a & b <tag>')
  })
})

// ---------------------------------------------------------------------------
// 6. Prototype pollution
// ---------------------------------------------------------------------------
describe('pollution de prototype', () => {
  function expectClean(marker: string): void {
    expect(({} as Record<string, unknown>)[marker], `Object.prototype.${marker}`).toBeUndefined()
    expect(Object.prototype.hasOwnProperty(marker), `own Object.prototype.${marker}`).toBe(false)
    expect(Object.getPrototypeOf({})).toBe(Object.prototype)
  }

  it('les payloads JSON distants à clé __proto__ ne polluent pas Object.prototype', () => {
    const hostileItem = JSON.parse('{"__proto__":{"pollutedItem":true},"constructor":{"prototype":{"pollutedItem":true}}}')
    const source = normalizeExternalSource(JSON.parse(JSON.stringify({ ...sourceOf(), item: { ...issue(), ...hostileItem } })))
    expect(source).toBeDefined()
    expectClean('pollutedItem')
    // Only the known item fields survive the explicit reconstruction.
    expect(Object.keys(source!.item).sort()).toEqual([
      'assignedTo', 'assignees', 'closed', 'description', 'id', 'priority', 'projectId', 'revision', 'status', 'title', 'type', 'urgency', 'url',
    ])
    expectClean('pollutedItem')
  })

  it('les enregistrements de synchronisation et les connexions ne polluent pas non plus', () => {
    const records = normalizeExternalSyncRecords(JSON.parse('{"__proto__":{"links":{"a":"b"}},"conn":{"links":{"k":"t"},"ignored":["x"]}}'))
    expect(Object.keys(records)).toContain('conn')
    expect(records.conn).toMatchObject({ links: { k: 't' }, ignored: ['x'] })
    expectClean('polluted')
    const config = normalizeExternalConfig({
      ...GITEA,
      credentials: JSON.parse('{"token":"x","__proto__":{"pollutedConfig":true}}'),
      settings: JSON.parse('{"__proto__":{"pollutedConfig":true}}'),
    })
    expect(config.credentials.token).toBe('x')
    expect(Object.keys(config.credentials)).toEqual(['token'])
    expect(Object.keys(config.settings)).not.toContain('__proto__')
    expectClean('pollutedConfig')
  })
})

// ---------------------------------------------------------------------------
// 7. Adapter transport (GitLab / Gitea)
// ---------------------------------------------------------------------------
type RecordedCall = { url: string; method: string; headers: Record<string, string>; redirect?: string; body?: unknown }

function mockFetch(resolve: (call: RecordedCall) => Response): { calls: RecordedCall[]; request: typeof fetch } {
  const calls: RecordedCall[] = []
  const request = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const headers = Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>).map(([key, value]) => [key.toLowerCase(), value]))
    const call: RecordedCall = {
      url: String(input), method: init?.method ?? 'GET', headers,
      ...(init?.redirect === undefined ? {} : { redirect: init.redirect }),
      ...(init?.body === undefined ? {} : { body: JSON.parse(String(init.body)) }),
    }
    calls.push(call)
    return resolve(call)
  }) as unknown as typeof fetch
  return { calls, request }
}
const jsonResponse = (value: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json', ...headers } })
const signal = () => AbortSignal.timeout(1_000)
const gitlabConfig = (overrides: Partial<ExternalConfig> = {}): ExternalConfig => ({
  id: 'conn-gitlab', provider: 'gitlab', baseUrl: 'https://gitlab.test/api/v4', account: 'alice', authMode: 'token',
  credentials: { token: 'GITLAB-TOKEN-MARKER' }, itemTypes: ['issue'], settings: {},
  mappings: [{ projectId: 'group/project', workspaceId: 'ws' }], intervalMinutes: 0, since: '', importStatus: 'backlog', ...overrides,
})
const giteaConfig = (overrides: Partial<ExternalConfig> = {}): ExternalConfig => ({
  id: 'conn-gitea', provider: 'gitea', baseUrl: 'https://gitea.test/api/v1', account: 'alice', authMode: 'token',
  credentials: { token: 'GITEA-TOKEN-MARKER' }, itemTypes: ['issue'], settings: {},
  mappings: [{ projectId: 'owner/repo', workspaceId: 'ws' }], intervalMinutes: 0, since: '', importStatus: 'backlog', ...overrides,
})
const gitlabIssue = (overrides: Record<string, unknown> = {}) => ({
  iid: 7, title: 'Fix', description: 'Body', state: 'opened',
  web_url: 'https://gitlab.test/group/project/-/issues/7', labels: ['urgent'],
  assignees: [{ username: 'alice' }], created_at: '2026-01-02T00:00:00Z', updated_at: '2026-01-03T00:00:00Z', ...overrides,
})
const giteaIssue = (overrides: Record<string, unknown> = {}) => ({
  number: 7, title: 'Fix', body: 'Body', state: 'open', html_url: 'https://gitea.test/owner/repo/issues/7',
  labels: [{ name: 'bug' }], assignees: [{ login: 'alice' }], created_at: '2026-01-02T00:00:00Z', updated_at: '2026-01-03T00:00:00Z', ...overrides,
})

describe('adaptateurs GitLab/Gitea — transport', () => {
  it('le token part dans un en-tête et jamais dans l’URL ; les redirections sont interdites', async () => {
    const gitlab = mockFetch(() => jsonResponse([gitlabIssue()]))
    await new GitlabProvider(gitlabConfig(), gitlab.request).getItems('group/project', signal())
    expect(gitlab.calls[0]!.headers['private-token']).toBe('GITLAB-TOKEN-MARKER')
    expect(gitlab.calls[0]!.url).not.toContain('GITLAB-TOKEN-MARKER')
    expect(new URL(gitlab.calls[0]!.url).search).not.toMatch(/token=/i)
    expect(gitlab.calls[0]!.redirect).toBe('error')

    const gitea = mockFetch(() => jsonResponse([giteaIssue()]))
    await new GiteaProvider(giteaConfig(), gitea.request).getItems('owner/repo', signal())
    expect(gitea.calls[0]!.headers.authorization).toBe('token GITEA-TOKEN-MARKER')
    expect(gitea.calls[0]!.url).not.toContain('GITEA-TOKEN-MARKER')
    expect(gitea.calls[0]!.redirect).toBe('error')
  })

  it('mappe 401/403/404/429 sans recopier le corps ni le token, et borne les tentatives', async () => {
    const expectations: Array<[number, string]> = [
      [401, 'GitLab rejected the token (HTTP 401)'],
      [403, 'GitLab denied access; check the token scope (HTTP 403)'],
      [404, 'GitLab project or issue not found or not accessible (HTTP 404)'],
      [429, 'GitLab rate limit exceeded (HTTP 429)'],
    ]
    for (const [status, expected] of expectations) {
      const responses = mockFetch(() => jsonResponse({ message: 'leaked-body GITLAB-TOKEN-MARKER' }, status, { 'retry-after': '0' }))
      const failure = await new GitlabProvider(gitlabConfig(), responses.request).getItems('group/project', signal())
        .then(() => undefined, (error: Error) => error)
      expect(failure!.message, `GitLab HTTP ${status}`).toBe(expected)
      expect(failure!.message).not.toContain('GITLAB-TOKEN-MARKER')
      expect(failure!.message).not.toContain('leaked-body')
      // 4xx are not retried; 429 is retried at most twice (3 attempts).
      expect(responses.calls.length, `attempts for HTTP ${status}`).toBe(status === 429 ? 3 : 1)
    }
    const giteaFailure = await new GiteaProvider(giteaConfig(), mockFetch(() => jsonResponse({ message: 'leaked GITEA-TOKEN-MARKER' }, 401)).request)
      .getItems('owner/repo', signal()).then(() => undefined, (error: Error) => error)
    expect(giteaFailure!.message).toBe('Gitea rejected the token (HTTP 401)')
  })

  it('valide scope et identifiants AVANT toute requête', async () => {
    const { calls, request } = mockFetch(() => jsonResponse([]))
    const gitea = new GiteaProvider(giteaConfig(), request)
    await expect(gitea.getItems('not-a-repo', signal())).rejects.toThrow('invalid Gitea repository scope')
    await expect(gitea.getItems('owner/repo/extra', signal())).rejects.toThrow('invalid Gitea repository scope')
    await expect(gitea.getItem('owner/repo', 'issue', '7/..', signal())).rejects.toThrow('invalid Gitea issue number')
    await expect(gitea.getItem('owner/repo', 'issue', '0', signal())).rejects.toThrow('invalid Gitea issue number')
    const gitlab = new GitlabProvider(gitlabConfig(), request)
    await expect(gitlab.getItems('nogroup', signal())).rejects.toThrow('invalid GitLab project scope')
    await expect(gitlab.getItem('group/project', 'issue', '7?x=1', signal())).rejects.toThrow('invalid GitLab issue iid')
    await expect(gitlab.getItem('group/project', 'merge_request', '7', signal())).rejects.toThrow('unsupported GitLab work item')
    expect(calls).toHaveLength(0)
  })

  it('GitLab encode le project id : aucune traversée de chemin possible', async () => {
    const { calls, request } = mockFetch(() => jsonResponse([]))
    await new GitlabProvider(gitlabConfig(), request).getItems('group/../nested', signal())
    const pathname = new URL(calls[0]!.url).pathname
    expect(pathname.startsWith('/api/v4/projects/')).toBe(true)
    expect(pathname.split('/')).not.toContain('..')
  })

  it('CORRIGÉ P2 — Gitea accepte « a/.. » et interpole le scope sans encodage (traversée)', async () => {
    // GITEA_REPO_PATTERN admits `.`/`..` as path segments and the adapter
    // interpolates owner/repo raw into the URL (gitea.ts:44-47, 172, 183):
    // `a/..` normalises to `/api/v1/repos/issues`, so the bearer token is sent
    // to an endpoint outside the mapped repository (a hand-edited/imported
    // `projectId` is enough). GitHub shares the same pattern; GitLab is safe
    // because it encodeURIComponent()s the whole project path.
    const { calls, request } = mockFetch(() => jsonResponse([]))
    expect(GITEA_REPO_PATTERN.test('a/..')).toBe(false)
    await expect(new GiteaProvider(giteaConfig(), request).getItems('a/..', signal())).rejects.toThrow('invalid Gitea repository scope')
    expect(calls).toHaveLength(0)
  })

  it('borne la pagination : un flux infini échoue au lieu de lire sans fin', async () => {
    // Gitea caps pages at 1000; a server that always returns a full page must
    // end in an explicit error, never an unbounded read.
    const page = Array.from({ length: 50 }, (_, index) => giteaIssue({ number: index + 1 }))
    const { calls, request } = mockFetch(() => jsonResponse(page))
    const failure = await new GiteaProvider(giteaConfig(), request).getItems('owner/repo', signal())
      .then(() => undefined, (error: Error) => error)
    expect(failure!.message).toContain('pagination limit exceeded')
    expect(calls.length).toBe(1_000)
  })
})

// ---------------------------------------------------------------------------
// 8. Adapter contract hardening
// ---------------------------------------------------------------------------
describe('contrat d’adaptateur', () => {
  it('une capacité déclarée ne peut pas être gonflée ni simulée par le descripteur', () => {
    const descriptor: ProviderDescriptor = {
      id: 'probe', name: 'Probe', scopeLabel: 'x', defaultBaseUrl: 'https://probe.test',
      authModes: [{ id: 'token', label: 't', fields: [{ key: 'token', label: 't' }] }],
      capabilities: {
        itemTypes: ['issue'], projectDiscovery: false, accountDiscovery: false, pagination: 'page', incremental: false,
        operations: ['validateConnection', 'getCapabilities', 'listWorkItems'],
      },
    }
    const provider: ExternalTaskProvider = { test: async () => {}, getItems: async () => [] }
    const descriptorWith = (patch: Partial<ProviderDescriptor['capabilities']>): ProviderDescriptor => ({
      ...descriptor, capabilities: { ...descriptor.capabilities, ...patch },
    })
    expect(() => assertProviderContract(descriptor, provider)).not.toThrow()
    // Declared but unimplemented.
    expect(() => assertProviderContract(descriptorWith({ operations: ['listWorkItems', 'createWorkItem'] }), provider))
      .toThrow('does not implement')
    // Implemented but undeclared.
    const writeProvider: ProviderStub = {
      ...provider,
      createItem: async () => issue(),
      updateItem: async () => issue(),
    }
    expect(() => assertProviderContract(descriptor, writeProvider)).toThrow('without declaring')
    // Outbound direction without write operations.
    expect(() => assertProviderContract(descriptorWith({ directions: ['inbound', 'outbound'] }), provider))
      .toThrow('outbound sync without write operations')
    // Unknown contract version.
    expect(() => assertProviderContract({ ...descriptor, contractVersion: 2 }, provider)).toThrow('unsupported external adapter contract version')
    // A provider must always be readable.
    expect(() => assertProviderContract(descriptorWith({ operations: ['getCapabilities'] }), provider))
      .toThrow('must declare listWorkItems')
    // Registry-level guards.
    const registry = new ExternalProviderRegistry()
    expect(() => registry.register({ descriptor: { ...descriptor, id: 'Bad ID' }, create: () => provider })).toThrow('invalid or duplicate provider ID')
    expect(() => registry.register({ descriptor: descriptorWith({ itemTypes: [] }), create: () => provider })).toThrow('must declare')
    expect(() => registry.register({ descriptor, create: () => provider })).not.toThrow()
    expect(() => registry.register({ descriptor, create: () => provider })).toThrow('invalid or duplicate provider ID')
    const unknownOperation = ['listWorkItems', 'unknownOperation'] as unknown as ProviderDescriptor['capabilities']['operations']
    expect(() => assertProviderContract(descriptorWith({ operations: unknownOperation }), provider)).toThrow('unknown operation')
  })
})

// ---------------------------------------------------------------------------
// 9. React rendering of hostile remote content
// ---------------------------------------------------------------------------
describe('rendu React de la provenance externe', () => {
  function hostileTask(url: string): TaskRecord {
    return {
      id: 't-hostile', title: 'Card', description: 'Desc', prompt: '', workspaceId: 'ws', urgency: 'normal',
      status: 'todo', blocked: false, execution: { mode: 'claim' }, version: 1, createdAt: 1, updatedAt: 1,
      createdBy: { kind: 'user' }, updatedBy: { kind: 'user' }, comments: [], executions: [],
      external: {
        connectionId: 'c1', provider: 'gitea', providerName: 'Gitea', syncedAt: 1_000, conflicts: ['title'],
        item: {
          projectId: 'owner/repo', type: 'issue', id: '7',
          title: '<img src=x onerror="globalThis.__pwned=1"><script>globalThis.__pwned=2</script>',
          description: 'Body with <b>markup</b>', urgency: 'normal', priority: '', status: 'open',
          assignedTo: 'alice', assignees: [], closed: false, url,
        },
      },
    }
  }

  async function mount(record: TaskRecord): Promise<HTMLElement> {
    const host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
    await act(async () => { root!.render(createElement(ExternalSourcePanel, { task: record })) })
    return host
  }

  it('échappe le contenu distant : aucun élément injecté, aucun script exécuté', async () => {
    const host = await mount(hostileTask('https://gitea.test/owner/repo/issues/7'))
    expect(host.querySelector('img')).toBeNull()
    expect(host.querySelector('script')).toBeNull()
    expect((globalThis as Record<string, unknown>).__pwned).toBeUndefined()
    // The hostile markup is rendered as text, not parsed as HTML.
    expect(host.textContent).toContain('<img src=x onerror=')
    expect(host.textContent).toContain('<script>globalThis.__pwned=2</script>')
    // The only anchor points at the validated ticket URL, hardened.
    const anchor = host.querySelector('a')!
    expect(anchor.getAttribute('href')).toBe('https://gitea.test/owner/repo/issues/7')
    expect(anchor.getAttribute('target')).toBe('_blank')
    expect(anchor.getAttribute('rel')).toBe('noopener noreferrer')
  })

  it('une URL de ticket non http(s) ne produit jamais de lien cliquable', async () => {
    const host = await mount(hostileTask('javascript:globalThis.__pwned=3'))
    // normalizeExternalSource rejects the source: the whole panel degrades to
    // nothing rather than rendering a `javascript:` href.
    expect(host.querySelector('a')).toBeNull()
    expect(host.innerHTML).toBe('')
    expect((globalThis as Record<string, unknown>).__pwned).toBeUndefined()
  })

  it('aucun panneau n’utilise d’injection HTML directe (analyse statique)', () => {
    const boardDir = repoPath('src/client/board')
    const files = readdirSync(boardDir).filter(name => name.endsWith('.tsx'))
    expect(files.length).toBeGreaterThan(0)
    for (const file of files) {
      const source = readFileSync(join(boardDir, file), 'utf8')
      expect(source, `${file} must not bypass React escaping`).not.toContain('dangerouslySetInnerHTML')
    }
    const panel = readFileSync(join(boardDir, 'ExternalSourcePanel.tsx'), 'utf8')
    // The anchor target comes from the validated normalizer, never raw state.
    expect(panel).toContain('normalizeExternalSource(task.external)')
    expect(panel).toMatch(/href=\{source\.item\.url\}/)
  })
})

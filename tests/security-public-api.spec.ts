/**
 * Independent security audit — Agent Board public execution API v1
 * (`src/host/public-api.ts`, `src/shared/public-api.ts`).
 *
 * Scope of THIS file: bearer authentication, secret containment, execution
 * lifecycle authorisation (claim / fencing / managedBy:'board' / `done`),
 * concurrency, input bounds, SSE and the availability of the public read
 * paths. The external-sync / adapter surface lives in
 * `tests/security-universal.spec.ts`; findings are consolidated in
 * `docs/SECURITY-REVIEW.md`.
 *
 * Conventions
 * -----------
 * - Every test is deterministic and offline: the service is driven through
 *   `handle()` with an in-memory Request/Response double; a real `TaskStore`
 *   over an `mkdtemp` ledger is the only I/O.
 * - Tests whose title starts with `DÉFAUT` are **red on purpose**: they
 *   assert the SECURITY PROPERTY that is missing, so `it.fails` keeps the
 *   suite green until the production code is fixed. Each one is documented in
 *   the review (file:line, impact, proposed fix) — this file never fixes the
 *   production code (auditor write scope).
 * - To inspect the CURRENT behaviour of a `DÉFAUT` test, replace `it.fails(`
 *   with `it(` temporarily: the failure message then shows the observed
 *   status/state.
 *
 * @module dsh-taskboard/tests/security-public-api
 */
import { readFileSync } from 'node:fs'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PublicApiService } from '../src/host/public-api.ts'
import { registerTaskboardRoutes } from '../src/host/routes.ts'
import { TaskStore } from '../src/host/store.ts'
import { PUBLIC_API_PREFIX, PUBLIC_API_TOKEN_ENV } from '../src/shared/public-api.ts'
import type { TaskRecord } from '../src/shared/protocol.ts'

// ---------------------------------------------------------------------------
// harness: mkdtemp ledgers, removable disposers, in-memory req/res doubles
// ---------------------------------------------------------------------------
const directories: string[] = []
const disposers: Array<() => void> = []
const envKeys: string[] = []

afterEach(async () => {
  for (const dispose of disposers.splice(0)) dispose()
  for (const key of envKeys.splice(0)) delete process.env[key]
  vi.restoreAllMocks()
  await Promise.all(directories.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
})

type Captured = { status: number; headers: Record<string, string>; raw: string; body: unknown; ended: boolean }
type Body = Record<string, unknown> | undefined

function parseJson(raw: string): unknown {
  try { return raw.length > 0 ? JSON.parse(raw) : undefined } catch { return undefined }
}

/** Minimal ServerResponse double: captures status/headers/frames, emits 'close'. */
function responseDouble(): { res: ServerResponse; captured: Captured; emit: (event: string) => void } {
  const captured: Captured = { status: 0, headers: {}, raw: '', body: undefined, ended: false }
  const listeners = new Map<string, Array<() => void>>()
  const res = {
    writeHead(status: number, headers?: Record<string, string>) { captured.status = status; captured.headers = { ...(headers ?? {}) } },
    write(chunk: unknown) { captured.raw += String(chunk); return true },
    end(chunk?: unknown) {
      captured.ended = true
      if (typeof chunk === 'string') captured.raw += chunk
      captured.body = parseJson(captured.raw)
    },
    on(event: string, listener: () => void) {
      const bucket = listeners.get(event) ?? []
      bucket.push(listener)
      listeners.set(event, bucket)
      return res
    },
  } as unknown as ServerResponse
  return { res, captured, emit: event => { for (const listener of listeners.get(event) ?? []) listener() } }
}

/** Minimal IncomingMessage double: records 'close' listeners, never reads a socket. */
function requestDouble(method: string, authorization?: string): { req: IncomingMessage; emit: (event: string) => void } {
  const listeners = new Map<string, Array<() => void>>()
  const req = {
    method,
    headers: authorization === undefined ? {} : { authorization },
    on(event: string, listener: () => void) {
      const bucket = listeners.get(event) ?? []
      bucket.push(listener)
      listeners.set(event, bucket)
      return req
    },
  } as unknown as IncomingMessage
  return { req, emit: event => { for (const listener of listeners.get(event) ?? []) listener() } }
}

/** Result view kept LIVE for streaming checks (frames arrive after the call). */
type CallResult = Captured & { emitRequest: (event: string) => void; emitResponse: (event: string) => void }

async function dispatch(service: PublicApiService, method: string, path: string, body: Body, authorization: string | undefined): Promise<CallResult> {
  const res = responseDouble()
  const req = requestDouble(method, authorization)
  const url = new URL(`http://127.0.0.1${PUBLIC_API_PREFIX}${path}`)
  await service.handle(req.req, res.res, url, body ?? null)
  // Return the SAME captured object: SSE frames are appended after `handle`.
  return Object.assign(res.captured, { emitRequest: req.emit, emitResponse: res.emit })
}

/** Authenticated call; `token === null` sends no Authorization header at all. */
async function call(service: PublicApiService, method: string, path: string, body?: Body, token: string | null = 'audit-token'): Promise<CallResult> {
  return dispatch(service, method, path, body, token === null ? undefined : `Bearer ${token}`)
}

/** Raw Authorization header (scheme/casing/whitespace cases). */
async function callRaw(service: PublicApiService, method: string, path: string, authorization: string | undefined, body?: Body): Promise<CallResult> {
  return dispatch(service, method, path, body, authorization)
}

function valueOf<T>(result: CallResult): T {
  return (result.body as { value: T }).value
}
function errorCodeOf(result: CallResult): string | undefined {
  return (result.body as { error?: { code?: string } } | undefined)?.error?.code
}

function task(overrides: Partial<TaskRecord> = {}): TaskRecord {
  return {
    id: 't-audit', title: 'Audit task', description: 'Description', prompt: 'prompt', workspaceId: 'ws', urgency: 'normal',
    status: 'todo', blocked: false, execution: { mode: 'claim' }, version: 1, createdAt: 1, updatedAt: 1,
    createdBy: { kind: 'user' }, updatedBy: { kind: 'user' }, comments: [], executions: [], ...overrides,
  }
}

type Workspaces = {
  list: () => Array<{ id: string; title: string; path: string }>
  get: (id: string) => { id: string; title: string; path: string } | undefined
}
type Fixture = { dir: string; store: TaskStore; service: PublicApiService; workspaces: Workspaces }

async function fixture(options: { token?: string | null; envToken?: boolean } = {}): Promise<Fixture> {
  const dir = await mkdtemp(join(tmpdir(), 'tb-sec-public-'))
  directories.push(dir)
  const store = new TaskStore({ file: join(dir, 'tasks.json') })
  // `token: null` models an unconfigured deployment (the surface must answer 503).
  const token = options.token === null ? undefined : options.token ?? 'audit-token'
  const workspaces: Workspaces = {
    list: () => [{ id: 'ws', title: 'Workspace', path: '/fixtures/ws' }, { id: 'other', title: 'Other', path: '/fixtures/other' }],
    get: (id: string) => (id === 'ws' || id === 'other') ? { id, title: id, path: `/fixtures/${id}` } : undefined,
  }
  const service = new PublicApiService({
    store,
    workspaces,
    now: () => 1_000,
    token: options.envToken === true ? () => process.env[PUBLIC_API_TOKEN_ENV] : () => token,
  })
  disposers.push(() => service.dispose())
  return { dir, store, service, workspaces }
}

async function seed(store: TaskStore, tasks: TaskRecord[]): Promise<void> {
  await store.mutate('task-created', ledger => { ledger.tasks.push(...structuredClone(tasks)); return [...ledger.tasks] })
}

/**
 * Capture the prefix route handler that `registerTaskboardRoutes` mounts, so
 * the audit exercises the REAL dispatch (public prefix first, then the GUI
 * routes) without opening a socket.
 */
function mountPublicRoute(service: PublicApiService, store: TaskStore): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
  let handler: ((req: IncomingMessage, res: ServerResponse) => Promise<void>) | undefined
  const ctx = {
    webServer: {
      register: (route: { kind: string; handler: (req: IncomingMessage, res: ServerResponse) => Promise<void> }) => {
        if (route.kind === 'prefix') handler = route.handler
        return () => {}
      },
    },
  }
  disposers.push(registerTaskboardRoutes(ctx as never, {
    store,
    workspaces: {
      get: (id: string) => (id === 'ws' ? { id, title: id, path: '/fixtures/ws' } : undefined),
      list: () => [{ id: 'ws', title: 'ws', path: '/fixtures/ws' }],
      resolveByPath: async () => undefined,
    },
    now: () => 1_000,
    publicApi: {
      handle: (req: IncomingMessage, res: ServerResponse, url: URL, body: Record<string, unknown> | null) => service.handle(req, res, url, body),
      preflight: (req: IncomingMessage, res: ServerResponse) => service.preflight(req, res),
    },
    ready: async () => {},
  } as never))
  if (handler === undefined) throw new Error('the public prefix route was not mounted')
  return handler
}

/** IncomingMessage double that streams real chunks through the async iterator. */
function streamingRequest(method: string, chunks: string[], headers: Record<string, string> = {}): { req: IncomingMessage; readChunks: () => number } {
  let read = 0
  const req = {
    method,
    headers,
    on() { return req },
    async *[Symbol.asyncIterator]() { for (const chunk of chunks) { read += 1; yield Buffer.from(chunk) } },
  } as unknown as IncomingMessage
  return { req, readChunks: () => read }
}

/** Claim one task and return its execution id, exactly as a contract client would. */
async function claimed(service: PublicApiService, options: { actor?: string; sessionId?: string; idempotencyKey?: string; taskId?: string } = {}): Promise<{ executionId: string; fencingToken: number; status: number; result: CallResult }> {
  const result = await call(service, 'POST', '/executions/claim', {
    taskId: options.taskId ?? 't-audit',
    actor: options.actor ?? 'actor:1',
    ...(options.sessionId === undefined ? {} : { sessionId: options.sessionId }),
    ...(options.idempotencyKey === undefined ? {} : { idempotencyKey: options.idempotencyKey }),
  })
  const value = valueOf<{ execution: { executionId: string; fencingToken: number } }>(result)
  return { executionId: value.execution.executionId, fencingToken: value.execution.fencingToken, status: result.status, result }
}

const SOURCE = readFileSync(new URL('../src/host/public-api.ts', import.meta.url), 'utf8')
const ROUTES_SOURCE = readFileSync(new URL('../src/host/routes.ts', import.meta.url), 'utf8')

// ---------------------------------------------------------------------------
// 1. Authentication
// ---------------------------------------------------------------------------
describe('contrat public — authentification', () => {
  it('désactive toute la surface (503) quand aucun token n’est configuré', async () => {
    for (const token of [null, '', '   ']) {
      const f = await fixture({ token })
      const probes: Array<[string, string, Body]> = [
        ['GET', '/meta', undefined],
        ['GET', '/projects', undefined],
        ['GET', '/tasks', undefined],
        ['GET', '/events', undefined],
        ['GET', '/events/stream', undefined],
        ['GET', '/tasks/t-audit', undefined],
        ['GET', '/executions/e-1', undefined],
        ['POST', '/executions/claim', { taskId: 't-audit', actor: 'a' }],
        ['POST', '/executions/e-1/complete', { actor: 'a', outcome: 'succeeded' }],
      ]
      for (const [method, path, body] of probes) {
        const result = await call(f.service, method, path, body, 'anything')
        expect(result.status, `${method} ${path} without configured token`).toBe(503)
        expect(errorCodeOf(result)).toBe('public_api_disabled')
      }
      // The SSE route must never answer with an event stream while disabled.
      const sse = await call(f.service, 'GET', '/events/stream', undefined, 'anything')
      expect(sse.headers['content-type']).toContain('application/json')
    }
  })

  it('refuse un en-tête absent, vide, faux ou d’un autre schéma (401)', async () => {
    const f = await fixture()
    const cases: Array<[string, number, string | undefined]> = [
      ['absent', 401, undefined],
      ['vide', 401, 'Bearer '],
      ['faux', 401, 'Bearer wrong-token'],
      ['préfixe du vrai token', 401, 'Bearer audit'],
      ['suffixe du vrai token', 401, 'Bearer audit-token-x'],
      ['schéma Basic', 401, 'Basic audit-token'],
      ['schéma absent', 401, 'audit-token'],
      ['Bearer en minuscules', 401, 'bearer audit-token'],
      ['valide', 200, 'Bearer audit-token'],
      ['valide avec espaces', 200, 'Bearer   audit-token   '],
    ]
    for (const [label, expected, authorization] of cases) {
      const result = await callRaw(f.service, 'GET', '/meta', authorization)
      expect(result.status, `authorization case: ${label}`).toBe(expected)
    }
  })

  it('ne divulgue jamais le token attendu dans les réponses ni dans les en-têtes', async () => {
    const f = await fixture()
    await seed(f.store, [task()])
    const probes: Array<[string, string, Body]> = [
      ['GET', '/meta', undefined],
      ['GET', '/projects', undefined],
      ['GET', '/tasks', undefined],
      ['GET', '/tasks/t-audit', undefined],
      ['GET', '/tasks/t-audit/dependencies', undefined],
      ['GET', '/events', undefined],
      ['POST', '/executions/claim', { taskId: 't-audit', actor: 'a' }],
      ['GET', '/tasks/unknown', undefined],
      ['POST', '/executions/nope/complete', { actor: 'a', outcome: 'succeeded' }],
    ]
    for (const [method, path, body] of probes) {
      const ok = await call(f.service, method, path, body)
      const denied = await call(f.service, method, path, body, 'wrong-token')
      for (const result of [ok, denied]) {
        expect(result.raw, `${method} ${path} body must not echo the expected token`).not.toContain('audit-token')
        expect(JSON.stringify(result.headers)).not.toContain('audit-token')
      }
    }
  })

  it('compare le token à temps constant (timingSafeEqual sur des digests, jamais ===)', () => {
    // A plain `===` leaks the matching prefix length; hashing both sides first
    // also hides the token length from the comparison itself.
    expect(SOURCE).toMatch(/import \{[^}]*timingSafeEqual[^}]*\} from 'node:crypto'/)
    expect(SOURCE).toMatch(/createHash\('sha256'\)\.update\(candidate\)\.digest\(\)/)
    expect(SOURCE).toMatch(/createHash\('sha256'\)\.update\(expected\)\.digest\(\)/)
    expect(SOURCE).toMatch(/timingSafeEqual\(a, b\)/)
    // No direct (non-hashed) token comparison may exist.
    expect(SOURCE).not.toMatch(/(?:candidate|token)\s*===\s*(?:expected|token)/)
    // The bearer token is never written into a response payload.
    expect(SOURCE).not.toMatch(/json\([^\n]*token/)
  })

  it('exige le schéma Bearer exact et un en-tête unique exploitable', async () => {
    const f = await fixture()
    // A duplicated header is joined by Node into one string: it must not match.
    const joined = await callRaw(f.service, 'GET', '/meta', 'Bearer audit-token, Bearer audit-token')
    expect(joined.status).toBe(401)
    // Trailing whitespace is trimmed on both sides before the comparison.
    const padded = await callRaw(f.service, 'GET', '/meta', 'Bearer audit-token\t')
    expect(padded.status).toBe(200)
  })
})

// ---------------------------------------------------------------------------
// 2. Secret containment
// ---------------------------------------------------------------------------
describe('contrat public — secrets et fuites', () => {
  it('ne projette aucune variable d’environnement de l’hôte (token réel, marqueur)', async () => {
    process.env[PUBLIC_API_TOKEN_ENV] = 'env-audit-token-9f3'
    process.env.DSH_TASKBOARD_AUDIT_MARKER = 'host-env-secret-marker'
    envKeys.push(PUBLIC_API_TOKEN_ENV, 'DSH_TASKBOARD_AUDIT_MARKER')
    const f = await fixture({ envToken: true })
    await seed(f.store, [task({ prompt: 'bonjour' })])
    const authorized = await call(f.service, 'GET', '/tasks', undefined, 'env-audit-token-9f3')
    expect(authorized.status).toBe(200)
    const claim = await call(f.service, 'POST', '/executions/claim', { taskId: 't-audit', actor: 'a' }, 'env-audit-token-9f3')
    const view = await call(f.service, 'GET', '/tasks/t-audit', undefined, 'env-audit-token-9f3')
    const events = await call(f.service, 'GET', '/events', undefined, 'env-audit-token-9f3')
    for (const result of [authorized, claim, view, events]) {
      expect(result.raw).not.toContain('env-audit-token-9f3')
      expect(result.raw).not.toContain('host-env-secret-marker')
    }
  })

  it('ne réfléchit jamais le token dans les erreurs (400/404/409)', async () => {
    const f = await fixture()
    await seed(f.store, [task()])
    const probes: Array<[string, string, Body]> = [
      ['GET', '/tasks/unknown', undefined],
      ['POST', '/executions/claim', { taskId: 't-audit', actor: '' }],
      ['POST', '/executions/unknown/complete', { actor: 'a', outcome: 'succeeded' }],
      ['GET', '/no-such-route', undefined],
    ]
    for (const [method, path, body] of probes) {
      const result = await call(f.service, method, path, body)
      expect(result.raw).not.toContain('audit-token')
      expect(result.status).toBeGreaterThanOrEqual(400)
    }
  })

  it('n’expose comme références externes que des URL http(s) après rechargement du ledger', async () => {
    // The ingestion boundary is the ledger loader (`store.load` →
    // normalizeExternalReferences): a hand-edited / imported ledger carrying a
    // `javascript:` reference must lose it before the public projection.
    const dir = await mkdtemp(join(tmpdir(), 'tb-sec-refs-'))
    directories.push(dir)
    const file = join(dir, 'tasks.json')
    const writer = new TaskStore({ file })
    await writer.mutate('task-created', ledger => { ledger.tasks.push(task({ id: 't-refs' })); return [...ledger.tasks] })
    const raw = JSON.parse(await readFile(file, 'utf8')) as { tasks: Array<Record<string, unknown>> }
    raw.tasks[0]!.externalRefs = [
      { system: 'gitea', instance: 'c1', kind: 'issue', project: 'o/r', id: '1', url: 'https://gitea.test/o/r/issues/1', revision: '', syncedAt: 1, state: 'linked', provenance: 'imported' },
      { system: 'evil', instance: 'c1', kind: 'issue', project: 'o/r', id: '2', url: 'javascript:alert(1)', revision: '', syncedAt: 1, state: 'linked', provenance: 'imported' },
    ]
    await writeFile(file, JSON.stringify(raw))
    const store = new TaskStore({ file })
    await store.load()
    const service = new PublicApiService({ store, workspaces: { list: () => [], get: () => undefined }, now: () => 1, token: () => 'audit-token' })
    disposers.push(() => service.dispose())
    const view = await call(service, 'GET', '/tasks/t-refs')
    const refs = valueOf<{ externalRefs?: Array<{ url: string }> }>(view).externalRefs ?? []
    expect(refs.length).toBeGreaterThan(0)
    for (const ref of refs) expect(new URL(ref.url).protocol).toMatch(/^https?:$/)
    expect(refs.map(ref => ref.url)).not.toContain('javascript:alert(1)')
  })
})

// ---------------------------------------------------------------------------
// 3. Lifecycle authorisation
// ---------------------------------------------------------------------------
describe('contrat public — autorisation du cycle de vie', () => {
  it('refuse toute action sur une exécution pilotée par l’hôte (managedBy absent = board)', async () => {
    const f = await fixture()
    await seed(f.store, [task({
      id: 't-host', status: 'in_progress', claimedBy: 'actor:1',
      executions: [{ id: 'e-host', trigger: 'manual', outcome: 'running', startedAt: 1 }],
    })])
    const routes: Array<[string, unknown]> = [
      ['session', { actor: 'actor:1', sessionId: 's-1' }],
      ['attempts', { actor: 'actor:1', sessionId: 's-2', reason: 'x' }],
      ['handoff', { actor: 'actor:1', fromSessionId: 's-1', toSessionId: 's-2' }],
      ['complete', { actor: 'actor:1', outcome: 'succeeded' }],
      ['interrupt', { actor: 'actor:1' }],
      ['report', { actor: 'actor:1', report: { summary: 'x' } }],
    ]
    for (const [action, body] of routes) {
      const result = await call(f.service, 'POST', `/executions/e-host/${action}`, body as Body)
      expect(result.status, `host execution must not be piloted (${action})`).toBe(403)
    }
    // Nothing was written: still running, no comment, no attempt.
    const view = valueOf<{ executions: Array<{ outcome: string; attempts?: unknown[] }> }>(
      await call(f.service, 'GET', '/tasks/t-host'),
    )
    expect(view.executions.at(-1)!.outcome).toBe('running')
    expect(view.executions.at(-1)!.attempts).toHaveLength(1)
    // Comments live on the ledger, not in the public projection.
    expect(f.store.snapshot().tasks.find(entry => entry.id === 't-host')!.comments).toHaveLength(0)
  })

  it('« done » est inatteignable : le succès s’arrête à in_review et « done » est un outcome invalide', async () => {
    const f = await fixture()
    await seed(f.store, [task()])
    const claim = await claimed(f.service)
    const completed = await call(f.service, 'POST', `/executions/${claim.executionId}/complete`, { actor: 'actor:1', outcome: 'succeeded' })
    expect(completed.status).toBe(200)
    const view = valueOf<{ status: string; claimedBy?: string }>(await call(f.service, 'GET', '/tasks/t-audit'))
    expect(view.status).toBe('in_review')
    expect(view.status).not.toBe('done')
    expect(view.claimedBy).toBeUndefined()
    // No request field can smuggle a terminal status: the outcome vocabulary is closed.
    const smuggled = await call(f.service, 'POST', `/executions/${claim.executionId}/complete`, { actor: 'actor:1', outcome: 'done' })
    expect(smuggled.status).toBe(400)
    expect(errorCodeOf(smuggled)).toBe('invalid_input')
    // A trashed task can never be claimed either (not_found, no write).
    await f.store.mutate('task-deleted', ledger => { ledger.tasks[0]!.trashedAt = 5; return [] })
    const afterTrash = await call(f.service, 'POST', '/executions/claim', { taskId: 't-audit', actor: 'actor:2' })
    expect(afterTrash.status).toBe(404)
  })

  it('refuse le règlement, l’interruption, le handoff et l’attempt par un acteur tiers (403)', async () => {
    const f = await fixture()
    await seed(f.store, [task()])
    const claim = await claimed(f.service, { actor: 'actor:1', sessionId: 's-1' })
    const foreign: Array<[string, unknown]> = [
      ['session', { actor: 'intruder', sessionId: 's-9' }],
      ['attempts', { actor: 'intruder', sessionId: 's-9', reason: 'takeover' }],
      ['handoff', { actor: 'intruder', fromSessionId: 's-1', toSessionId: 's-9' }],
      ['complete', { actor: 'intruder', outcome: 'succeeded' }],
      ['interrupt', { actor: 'intruder' }],
      ['report', { actor: 'intruder', report: { summary: 'forged' } }],
    ]
    for (const [action, body] of foreign) {
      const result = await call(f.service, 'POST', `/executions/${claim.executionId}/${action}`, body as Body)
      expect(result.status, `foreign actor must be refused on ${action}`).toBe(403)
    }
    const view = valueOf<{ status: string; claimedBy: string }>(await call(f.service, 'GET', '/tasks/t-audit'))
    expect(view).toMatchObject({ status: 'in_progress', claimedBy: 'actor:1' })
  })

  it('refuse un claim hors du périmètre projet fourni (boundary workspace, 403)', async () => {
    const f = await fixture()
    await seed(f.store, [task({ id: 't-other', workspaceId: 'other' })])
    const mismatch = await call(f.service, 'POST', '/executions/claim', { taskId: 't-other', actor: 'a', workspaceId: 'ws' })
    expect(mismatch.status).toBe(403)
    expect(errorCodeOf(mismatch)).toBe('forbidden')
    expect((await call(f.service, 'GET', '/tasks/t-other')).raw).toContain('"status":"todo"')
    // LIMITE ASSUMÉE (documented in docs/SECURITY-REVIEW.md): the boundary is
    // caller-volunteered. Without `workspaceId`, any bearer holder may claim a
    // card of another project — the token is board-wide.
    const noBoundary = await call(f.service, 'POST', '/executions/claim', { taskId: 't-other', actor: 'a' })
    expect(noBoundary.status).toBe(201)
  })

  it('refuse un token de fencing périmé quand il est fourni (409 stale_execution)', async () => {
    const f = await fixture()
    await seed(f.store, [task()])
    const claim = await claimed(f.service, { sessionId: 's-1' })
    expect(claim.fencingToken).toBe(1)
    const attempt = await call(f.service, 'POST', `/executions/${claim.executionId}/attempts`, { actor: 'actor:1', sessionId: 's-2', reason: 'failover', ifFencingToken: 1 })
    expect(attempt.status).toBe(200)
    expect(valueOf<{ fencingToken: number }>(attempt).fencingToken).toBe(2)
    const stale = await call(f.service, 'POST', `/executions/${claim.executionId}/complete`, { actor: 'actor:1', outcome: 'succeeded', ifFencingToken: 1 })
    expect(stale.status).toBe(409)
    expect(errorCodeOf(stale)).toBe('stale_execution')
    // A fresh token is accepted.
    const fresh = await call(f.service, 'POST', `/executions/${claim.executionId}/complete`, { actor: 'actor:1', outcome: 'succeeded', ifFencingToken: 2 })
    expect(fresh.status).toBe(200)
  })

  it('CORRIGÉ P1 — fencing obligatoire : après un handoff, la session perdante est refusée (409 stale_execution)', async () => {
    // Fix landed in the branch during this audit: `checkFence` is MANDATORY as
    // soon as the fence is > 1 (public-api.ts:403-408). The engine that handed
    // off but never observed token 2 can no longer settle the envelope, so one
    // execution cannot be driven (and settled) by two engines.
    // Regression: if the guard becomes optional again, this test turns red.
    const f = await fixture()
    await seed(f.store, [task()])
    const claim = await claimed(f.service, { sessionId: 's-1' })
    const handoff = await call(f.service, 'POST', `/executions/${claim.executionId}/handoff`, { actor: 'actor:1', fromSessionId: 's-1', toSessionId: 's-2', reason: 'failover' })
    expect(handoff.status).toBe(200)
    expect(valueOf<{ fencingToken: number }>(handoff).fencingToken).toBe(2)
    // The stale engine did not observe fencingToken 2: it omits the guard.
    const staleComplete = await call(f.service, 'POST', `/executions/${claim.executionId}/complete`, { actor: 'actor:1', outcome: 'succeeded', comment: 'stale engine won the race' })
    expect(staleComplete.status).toBe(409)
    expect(errorCodeOf(staleComplete)).toBe('stale_execution')
    // Its old token is refused too, while the current token is accepted.
    const staleWithOldFence = await call(f.service, 'POST', `/executions/${claim.executionId}/complete`, { actor: 'actor:1', outcome: 'succeeded', ifFencingToken: 1 })
    expect(staleWithOldFence.status).toBe(409)
    const fresh = await call(f.service, 'POST', `/executions/${claim.executionId}/complete`, { actor: 'actor:1', outcome: 'succeeded', ifFencingToken: 2 })
    expect(fresh.status).toBe(200)
  })

  it('CORRIGÉ P1 — après un handoff, une session périmée ne peut pas réécrire le rapport (409)', async () => {
    // Fix landed in the branch during this audit: `/report` applies the same
    // fence as the other lifecycle routes (public-api.ts:586), so a session
    // that lost the handoff can no longer overwrite the evidence of the live
    // attempt. The current session, holding the current fence, still can.
    const f = await fixture()
    await seed(f.store, [task()])
    const claim = await claimed(f.service, { sessionId: 's-1' })
    await call(f.service, 'POST', `/executions/${claim.executionId}/handoff`, { actor: 'actor:1', fromSessionId: 's-1', toSessionId: 's-2' })
    const stale = await call(f.service, 'POST', `/executions/${claim.executionId}/report`, { actor: 's-1', report: { summary: 'stale evidence' }, ifFencingToken: 1 })
    expect(stale.status).toBe(409)
    expect(errorCodeOf(stale)).toBe('stale_execution')
    const current = await call(f.service, 'POST', `/executions/${claim.executionId}/report`, { actor: 's-2', report: { summary: 'fresh evidence' }, ifFencingToken: 2 })
    expect(current.status).toBe(200)
    expect(valueOf<{ report: { summary: string } }>(current).report.summary).toBe('fresh evidence')
  })

  it('CORRIGÉ P2 — le rejeu idempotent est lié à l’acteur (409 already_claimed)', async () => {
    // Fix landed in the branch during this audit: `claim` records
    // `externalActor` and refuses the replay to another actor
    // (public-api.ts:352-361, 378). A token holder can no longer read the first
    // actor's envelope (sessions, worktreePath) through a shared key, while the
    // legitimate actor keeps idempotence.
    const f = await fixture()
    await seed(f.store, [task()])
    const first = await claimed(f.service, { actor: 'actor:1', sessionId: 's-1', idempotencyKey: 'shared-key' })
    const replay = await call(f.service, 'POST', '/executions/claim', { taskId: 't-audit', actor: 'actor:2', idempotencyKey: 'shared-key' })
    expect(replay.status).toBe(409)
    expect(errorCodeOf(replay)).toBe('already_claimed')
    const legit = await call(f.service, 'POST', '/executions/claim', { taskId: 't-audit', actor: 'actor:1', idempotencyKey: 'shared-key' })
    expect(legit.status).toBe(201)
    expect(valueOf<{ execution: { executionId: string } }>(legit).execution.executionId).toBe(first.executionId)
  })

  it('CORRIGÉ P2 — le rejeu d’une exécution réglée est réservé à l’acteur propriétaire (403)', async () => {
    // Fix landed in the branch during this audit: `complete` checks the
    // recorded owner BEFORE its idempotent early return (public-api.ts:534-538).
    // A foreign caller no longer reads the settled envelope; the owner's retry
    // stays idempotent.
    const f = await fixture()
    await seed(f.store, [task()])
    const claim = await claimed(f.service, { actor: 'actor:1', sessionId: 's-1' })
    expect((await call(f.service, 'POST', `/executions/${claim.executionId}/complete`, { actor: 'actor:1', outcome: 'succeeded' })).status).toBe(200)
    const foreignReplay = await call(f.service, 'POST', `/executions/${claim.executionId}/complete`, { actor: 'intruder', outcome: 'succeeded' })
    expect(foreignReplay.status).toBe(403)
    expect(errorCodeOf(foreignReplay)).toBe('forbidden')
    const ownerReplay = await call(f.service, 'POST', `/executions/${claim.executionId}/complete`, { actor: 'actor:1', outcome: 'succeeded' })
    expect(ownerReplay.status).toBe(200)
    expect(valueOf<{ outcome: string }>(ownerReplay).outcome).toBe('succeeded')
  })
})

// ---------------------------------------------------------------------------
// 4. Concurrency
// ---------------------------------------------------------------------------
describe('contrat public — concurrence', () => {
  it('deux claims simultanés : un seul gagnant, aucune exécution orpheline', async () => {
    const f = await fixture()
    await seed(f.store, [task()])
    const [left, right] = await Promise.all([
      call(f.service, 'POST', '/executions/claim', { taskId: 't-audit', actor: 'worker:a' }),
      call(f.service, 'POST', '/executions/claim', { taskId: 't-audit', actor: 'worker:b' }),
    ])
    expect([left.status, right.status].sort()).toEqual([201, 409])
    const ledger = f.store.snapshot()
    const executions = ledger.tasks[0]!.executions
    expect(executions).toHaveLength(1)
    expect(executions[0]!.outcome).toBe('running')
    // The winner's claim is the one recorded; the loser left no trace.
    const winner = left.status === 201 ? 'worker:a' : 'worker:b'
    expect(ledger.tasks[0]!.claimedBy).toBe(winner)
    expect(ledger.tasks[0]!.status).toBe('in_progress')
    expect(ledger.tasks[0]!.version).toBe(2) // exactly one accepted mutation
  })

  it('deux complétions simultanées identiques : une seule transition, réponse idempotente', async () => {
    const f = await fixture()
    await seed(f.store, [task()])
    const claim = await claimed(f.service, { actor: 'actor:1' })
    const [left, right] = await Promise.all([
      call(f.service, 'POST', `/executions/${claim.executionId}/complete`, { actor: 'actor:1', outcome: 'succeeded' }),
      call(f.service, 'POST', `/executions/${claim.executionId}/complete`, { actor: 'actor:1', outcome: 'succeeded' }),
    ])
    expect([left.status, right.status]).toEqual([200, 200])
    const ledger = f.store.snapshot()
    expect(ledger.tasks[0]!.executions).toHaveLength(1)
    expect(ledger.tasks[0]!.executions[0]!.outcome).toBe('succeeded')
    expect(ledger.tasks[0]!.status).toBe('in_review')
    expect(ledger.tasks[0]!.version).toBe(3) // claim + one settle
  })

  it('deux complétions simultanées opposées : une seule transition, aucune incohérence', async () => {
    const f = await fixture()
    await seed(f.store, [task()])
    const claim = await claimed(f.service, { actor: 'actor:1' })
    const [left, right] = await Promise.all([
      call(f.service, 'POST', `/executions/${claim.executionId}/complete`, { actor: 'actor:1', outcome: 'succeeded' }),
      call(f.service, 'POST', `/executions/${claim.executionId}/complete`, { actor: 'actor:1', outcome: 'failed', reason: 'boom' }),
    ])
    expect([left.status, right.status].sort()).toEqual([200, 409])
    const ledger = f.store.snapshot()
    const execution = ledger.tasks[0]!.executions[0]!
    expect(['succeeded', 'failed']).toContain(execution.outcome)
    // The card status follows the winning outcome exactly.
    expect(ledger.tasks[0]!.status).toBe(execution.outcome === 'succeeded' ? 'in_review' : 'todo')
    expect(ledger.tasks[0]!.version).toBe(3)
  })

  it('un claim perdu ne laisse pas la carte verrouillée par le perdant', async () => {
    const f = await fixture()
    await seed(f.store, [task()])
    await Promise.all([
      call(f.service, 'POST', '/executions/claim', { taskId: 't-audit', actor: 'worker:a' }),
      call(f.service, 'POST', '/executions/claim', { taskId: 't-audit', actor: 'worker:b' }),
    ])
    const view = valueOf<{ claimedBy: string }>(await call(f.service, 'GET', '/tasks/t-audit'))
    const loser = view.claimedBy === 'worker:a' ? 'worker:b' : 'worker:a'
    const retry = await call(f.service, 'POST', '/executions/claim', { taskId: 't-audit', actor: loser })
    expect(retry.status).toBe(409)
    expect(errorCodeOf(retry)).toBe('already_claimed')
  })
})

// ---------------------------------------------------------------------------
// 5. Input bounds / resources
// ---------------------------------------------------------------------------
describe('contrat public — entrées et ressources', () => {
  it('borne limit, cursor, status et la pagination de /tasks', async () => {
    const f = await fixture()
    const tasks = Array.from({ length: 130 }, (_, index) => task({ id: `t-${String(index).padStart(3, '0')}`, updatedAt: 1_000 + index }))
    await seed(f.store, tasks)
    const cap = await call(f.service, 'GET', '/tasks?limit=9999')
    expect(valueOf<{ tasks: unknown[]; next?: string }>(cap).tasks).toHaveLength(100)
    expect(valueOf<{ next?: string }>(cap).next).toBe('100')
    const zero = await call(f.service, 'GET', '/tasks?limit=0')
    expect(valueOf<{ tasks: unknown[] }>(zero).tasks).toHaveLength(1)
    const negative = await call(f.service, 'GET', '/tasks?limit=-5')
    expect(valueOf<{ tasks: unknown[] }>(negative).tasks).toHaveLength(1)
    const garbage = await call(f.service, 'GET', '/tasks?limit=abc')
    expect(valueOf<{ tasks: unknown[] }>(garbage).tasks).toHaveLength(50)
    const negativeCursor = await call(f.service, 'GET', '/tasks?cursor=-10')
    expect(valueOf<{ tasks: Array<{ id: string }> }>(negativeCursor).tasks[0]!.id).toBe('t-129')
    const beyond = await call(f.service, 'GET', '/tasks?cursor=100000')
    expect(valueOf<{ tasks: unknown[] }>(beyond).tasks).toHaveLength(0)
    const unknownStatus = await call(f.service, 'GET', '/tasks?status=nope')
    expect(valueOf<{ tasks: unknown[] }>(unknownStatus).tasks).toHaveLength(0)
  })

  it('borne limit/since des événements et signale un resync complet', async () => {
    const f = await fixture()
    await seed(f.store, [task()])
    const all = await call(f.service, 'GET', '/events?limit=9999')
    const value = valueOf<{ events: unknown[]; latestSeq: number; resync: boolean }>(all)
    expect(value.events.length).toBeLessThanOrEqual(500)
    expect(value.resync).toBe(false)
    const future = await call(f.service, 'GET', `/events?since=${value.latestSeq + 1_000}`)
    expect(valueOf<{ events: unknown[] }>(future).events).toHaveLength(0)
    const negative = await call(f.service, 'GET', '/events?since=-5')
    expect(valueOf<{ events: unknown[] }>(negative).events.length).toBeGreaterThan(0)
    // A fresh service has no journal: it asks for a full resync instead of
    // pretending nothing was missed.
    const restarted = new PublicApiService({ store: f.store, workspaces: f.workspaces, now: () => 2_000, token: () => 'audit-token' })
    disposers.push(() => restarted.dispose())
    const resync = await call(restarted, 'GET', '/events?since=1')
    expect(valueOf<{ resync: boolean; events: unknown[] }>(resync)).toMatchObject({ resync: true, events: [] })
  })

  it('refuse les champs trop longs ou mal typés sans écrire dans le ledger', async () => {
    const f = await fixture()
    await seed(f.store, [task()])
    const before = f.store.snapshot().tasks[0]!
    const probes: Array<[string, Body]> = [
      ['/executions/claim', { taskId: 't-audit', actor: 'x'.repeat(201) }],
      ['/executions/claim', { taskId: 42, actor: 'a' }],
      ['/executions/claim', { actor: 'a' }],
      ['/executions/claim', { taskId: 't-audit' }],
      ['/executions/claim', {}],
    ]
    for (const [path, body] of probes) {
      const result = await call(f.service, 'POST', path, body)
      expect(result.status).toBe(400)
      expect(errorCodeOf(result)).toBe('invalid_input')
    }
    expect(f.store.snapshot().tasks[0]).toEqual(before)
  })

  it('refuse un rapport d’exécution hors bornes (summary > 2000)', async () => {
    const f = await fixture()
    await seed(f.store, [task()])
    const claim = await claimed(f.service, { actor: 'actor:1' })
    const oversized = await call(f.service, 'POST', `/executions/${claim.executionId}/report`, {
      actor: 'actor:1', report: { summary: 'x'.repeat(2_001) },
    })
    expect(oversized.status).toBe(400)
    expect(errorCodeOf(oversized)).toBe('invalid_input')
    // Report lists are capped by REJECTION, not silent truncation: a legal
    // list is accepted, one entry over the cap is refused (400), so a client
    // never believes it stored more evidence than the ledger holds.
    const legal = await call(f.service, 'POST', `/executions/${claim.executionId}/report`, {
      actor: 'actor:1', report: { summary: 'ok', changedFiles: Array.from({ length: 50 }, (_, index) => `f${index}.ts`) },
    })
    expect(legal.status).toBe(200)
    expect(valueOf<{ report: { changedFiles: string[] } }>(legal).report.changedFiles).toHaveLength(50)
    const overCap = await call(f.service, 'POST', `/executions/${claim.executionId}/report`, {
      actor: 'actor:1', report: { summary: 'ok', changedFiles: Array.from({ length: 51 }, (_, index) => `f${index}.ts`) },
    })
    expect(overCap.status).toBe(400)
    expect(errorCodeOf(overCap)).toBe('invalid_input')
  })

  it('le transport borne le corps HTTP (MAX_BODY_BYTES) — preuve statique du garde-fou', () => {
    // The service receives an already-parsed body from routes.ts; the only
    // memory bound is the shared 5 MiB cap. This guards against a future
    // regression that removes it.
    expect(ROUTES_SOURCE).toMatch(/const MAX_BODY_BYTES = 5 \* 1024 \* 1024/)
    expect(ROUTES_SOURCE).toMatch(/if \(total > MAX_BODY_BYTES\) throw new Error\('body too large'\)/)
    expect(ROUTES_SOURCE).toMatch(/request body exceeds \$\{MAX_BODY_BYTES\} bytes/)
  })

  it('CORRIGÉ P2 — un POST public non authentifié fait lire et parser le corps avant le 401', async () => {
    // routes.ts dispatches the public prefix with `await readBody(req)` BEFORE
    // `publicApi.handle()` performs the bearer check (the auth lives inside the
    // service, public-api.ts:174-180). An unauthenticated caller can therefore
    // force a JSON parse of up to MAX_BODY_BYTES (5 MiB) per request; the
    // desired order is authenticate → buffer. The 5 MiB cap does bound the
    // exposure (an oversized body is rejected), so this is hardening, not an
    // unbounded sink.
    const f = await fixture()
    const handler = mountPublicRoute(f.service, f.store)
    const payload = JSON.stringify({ actor: 'a', taskId: 't-audit', pad: 'x'.repeat(4_000_000) })
    const chunks = payload.match(/[\s\S]{1,100000}/g) ?? []
    expect(chunks.length).toBeGreaterThan(30)
    const body = streamingRequest('POST', chunks, { 'content-type': 'application/json' })
    body.req.url = '/dsh-taskboard/public/v1/executions/claim'
    const res = responseDouble()
    await handler(body.req, res.res)
    expect(res.captured.status).toBe(401)
    // Secure order: the bearer check must run BEFORE buffering the payload.
    expect(body.readChunks(), 'request chunks buffered before the bearer check').toBe(0)
  })

  it('CORRIGÉ P2 — un encodage pourcenté malformé renvoie 500 au lieu de 400', async () => {
    // `decodeURIComponent` throws a URIError that bypasses the typed
    // PublicApiError mapping (public-api.ts:215-219) and falls into the generic
    // 500 branch: a client input error is reported as a server failure.
    const f = await fixture()
    await seed(f.store, [task()])
    for (const path of ['/tasks/%C0', '/tasks/%C0/dependencies', '/executions/%C0']) {
      const result = await call(f.service, 'GET', path)
      expect(result.status, `malformed escape ${path}`).toBe(400)
      expect(errorCodeOf(result)).toBe('invalid_input')
    }
  })

  it('renvoie 404 pour une route inconnue et pour une méthode non gérée', async () => {
    const f = await fixture()
    const probes: Array<[string, string, Body]> = [
      ['GET', '/nope', undefined],
      ['DELETE', '/meta', undefined],
      ['PUT', '/tasks/t-audit', undefined],
      ['POST', '/meta', {}],
    ]
    for (const [method, path, body] of probes) {
      const result = await call(f.service, method, path, body)
      expect(result.status, `${method} ${path}`).toBe(404)
      expect(errorCodeOf(result)).toBe('not_found')
    }
  })
})

// ---------------------------------------------------------------------------
// 6. SSE
// ---------------------------------------------------------------------------
describe('contrat public — flux SSE', () => {
  it('exige le bearer : jamais de flux pour un appelant non authentifié', async () => {
    const f = await fixture()
    const denied = await call(f.service, 'GET', '/events/stream', undefined, null)
    expect(denied.status).toBe(401)
    expect(denied.headers['content-type']).toContain('application/json')
    expect(denied.raw).not.toContain('event:')
    // A later mutation must not reach the rejected response.
    const length = denied.raw.length
    await seed(f.store, [task()])
    expect(denied.raw.length).toBe(length)
  })

  it('rejoue depuis since, émet un hello, puis pousse les nouveaux événements', async () => {
    const f = await fixture()
    await seed(f.store, [task()])
    const live = await call(f.service, 'GET', '/events/stream?since=0')
    expect(live.status).toBe(200)
    expect(live.headers['content-type']).toContain('text/event-stream')
    expect(live.headers['cache-control']).toBe('no-store')
    expect(live.raw).toContain('event: task.created')
    expect(live.raw).toContain('event: hello')
    const before = live.raw.length
    await call(f.service, 'POST', '/executions/claim', { taskId: 't-audit', actor: 'actor:1' })
    expect(live.raw.length).toBeGreaterThan(before)
    expect(live.raw).toContain('event: execution.started')
    // The consumer can resume from the announced sequence.
    const hello = /event: hello\ndata: (\{.*\})/.exec(live.raw)
    expect(hello).not.toBeNull()
    const payload = JSON.parse(hello![1]!) as { latestSeq: number; resync: boolean }
    expect(Number.isSafeInteger(payload.latestSeq)).toBe(true)
    expect(typeof payload.resync).toBe('boolean')
  })

  it('coupure propre : un flux fermé est retiré et ne reçoit plus rien', async () => {
    const f = await fixture()
    await seed(f.store, [task({ id: 't-first' })])
    const live = await call(f.service, 'GET', '/events/stream')
    expect(live.raw).toContain('event: task.created')
    live.emitRequest('close')
    const afterClose = live.raw.length
    await seed(f.store, [task({ id: 't-second' })])
    expect(live.raw.length).toBe(afterClose)
  })

  it('dispose() termine tous les flux ouverts', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'tb-sec-sse-'))
    directories.push(dir)
    const store = new TaskStore({ file: join(dir, 'tasks.json') })
    const service = new PublicApiService({ store, workspaces: { list: () => [], get: () => undefined }, now: () => 1, token: () => 'audit-token' })
    const live = await call(service, 'GET', '/events/stream')
    expect(live.ended).toBe(false)
    service.dispose()
    expect(live.ended).toBe(true)
  })

  it('les frames SSE ne contiennent ni token ni secret d’environnement', async () => {
    process.env.DSH_TASKBOARD_AUDIT_MARKER = 'sse-host-secret-marker'
    envKeys.push('DSH_TASKBOARD_AUDIT_MARKER')
    const f = await fixture()
    const live = await call(f.service, 'GET', '/events/stream')
    await seed(f.store, [task({ title: 'normal' })])
    await call(f.service, 'POST', '/executions/claim', { taskId: 't-audit', actor: 'actor:1' })
    expect(live.raw).toContain('event: execution.started')
    expect(live.raw).not.toContain('audit-token')
    expect(live.raw).not.toContain('sse-host-secret-marker')
  })
})

// ---------------------------------------------------------------------------
// 7. Readiness / availability of the public paths
// ---------------------------------------------------------------------------
describe('contrat public — cohérence de chargement', () => {
  it('CORRIGÉ P2 — un GET sur un store non chargé répond une board vide au lieu de lire le ledger', async () => {
    // routes.ts dispatches the public prefix BEFORE `options.ready()`
    // (routes.ts:466-470) and the service never calls `store.load()`;
    // `snapshot()` answers the in-memory (empty) ledger. A cold process
    // therefore serves `{tasks: []}` — an orchestrator may conclude the board
    // is empty — and a corrupted ledger is silently masked instead of failing
    // closed. Fix: await `store.load()` (or the ready barrier) before dispatch.
    const dir = await mkdtemp(join(tmpdir(), 'tb-sec-cold-'))
    directories.push(dir)
    const file = join(dir, 'tasks.json')
    const writer = new TaskStore({ file })
    await writer.mutate('task-created', ledger => { ledger.tasks.push(task({ id: 't-persisted' })); return [...ledger.tasks] })
    const cold = new TaskStore({ file }) // never loaded: simulates the first request after a restart
    const service = new PublicApiService({ store: cold, workspaces: { list: () => [], get: () => undefined }, now: () => 1, token: () => 'audit-token' })
    disposers.push(() => service.dispose())
    const list = await call(service, 'GET', '/tasks')
    expect(valueOf<{ tasks: Array<{ id: string }> }>(list).tasks.map(entry => entry.id)).toEqual(['t-persisted'])
  })
})

// ---------------------------------------------------------------------------
// 8. Hot-path complexity (availability)
// ---------------------------------------------------------------------------
describe('contrat public — complexité des chemins chauds', () => {
  it('CORRIGÉ P1 — record() clone le ledger complet une fois par dépendant d’une carte done', async () => {
    // `record()` runs on EVERY ledger mutation (it is subscribed even when the
    // public API is disabled by token) and, for a task moving to `done`, calls
    // `this.options.store.snapshot()` inside the dependent loop
    // (public-api.ts:597-605) — each call deep-clones AND deep-freezes the
    // whole ledger, synchronously inside the store write lane. With N
    // dependants one user action allocates N+1 full ledger copies: an
    // event-loop stall / memory amplifier. Fix: snapshot once before the loop
    // and reuse `buildDependencyIndex(tasks)` (as routes.ts already does).
    const f = await fixture()
    await seed(f.store, [task({ id: 't-done', status: 'in_progress' })])
    await f.store.mutate('task-created', ledger => {
      for (let index = 0; index < 40; index++) ledger.tasks.push(task({ id: `t-dep-${index}`, dependsOn: ['t-done'] }))
      return [...ledger.tasks]
    })
    const snapshot = vi.spyOn(f.store, 'snapshot')
    await f.store.mutate('task-moved', ledger => {
      const moved = ledger.tasks.find(entry => entry.id === 't-done')!
      moved.status = 'done'
      return [moved]
    })
    const clones = snapshot.mock.calls.length
    // One snapshot for the whole notification is the only acceptable cost.
    expect(clones, `record() deep-cloned the ledger ${clones} times for 40 dependants`).toBeLessThanOrEqual(2)
  })

  it('CORRIGÉ P2 — /tasks?eligible=true reconstruit l’index de dépendances pour chaque tâche (O(n²))', async () => {
    // listTasks calls `dependencyState(task, tasks)` without the prebuilt
    // index (public-api.ts:252) while the shared helper explicitly documents
    // the O(n²) trap (`buildDependencyIndex`). One index per request is the
    // fix; the id reads below count index rebuilds.
    let idReads = 0
    const tasks = Array.from({ length: 30 }, (_, index) => {
      const record: Record<string, unknown> = {
        title: `t${index}`, description: '', prompt: '', workspaceId: 'ws', urgency: 'normal', status: 'todo', blocked: false,
        execution: { mode: 'claim' }, version: 1, createdAt: 1, updatedAt: 1,
        createdBy: { kind: 'user' }, updatedBy: { kind: 'user' }, comments: [], executions: [],
      }
      Object.defineProperty(record, 'id', { enumerable: true, get() { idReads += 1; return `i-${index}` } })
      return record
    })
    const ledger = { tasks, externalSync: {}, revision: 1 } as never
    const store = {
      subscribe: () => () => {},
      snapshot: () => ledger,
      mutate: async () => ({ ledger, changed: [] }),
    } as never
    const service = new PublicApiService({ store, workspaces: { list: () => [], get: () => undefined }, now: () => 1, token: () => 'audit-token' })
    disposers.push(() => service.dispose())
    const result = await call(service, 'GET', '/tasks?eligible=true')
    expect(result.status).toBe(200)
    // A single index build costs one id read per task (plus the projection):
    // 30 tasks must stay well under 4n reads. Observed with the defect: ~930.
    expect(idReads, 'id reads for 30 eligible tasks (single index ≈ 60)').toBeLessThanOrEqual(120)
  })
})

import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { PublicApiService } from '../src/host/public-api.ts'
import { TaskStore } from '../src/host/store.ts'
import { PUBLIC_API_PREFIX } from '../src/shared/public-api.ts'
import type { TaskRecord } from '../src/shared/protocol.ts'

const directories: string[] = []
afterEach(async () => { await Promise.all(directories.splice(0).map(dir => rm(dir, { recursive: true, force: true }))) })

type Captured = { status: number; headers: Record<string, string>; body: unknown; raw: string }

function mockResponse(): { res: ServerResponse; captured: Captured } {
  const captured: Captured = { status: 200, headers: {}, body: undefined, raw: '' }
  const res = {
    writeHead(status: number, headers: Record<string, string>) { captured.status = status; captured.headers = headers },
    write(chunk: string) { captured.raw += chunk; return true },
    end(chunk?: string) {
      if (typeof chunk === 'string') captured.raw += chunk
      try { captured.body = captured.raw.length ? JSON.parse(captured.raw) : undefined } catch { captured.body = undefined }
    },
  } as unknown as ServerResponse
  return { res, captured }
}

async function call(service: PublicApiService, method: string, path: string, body?: unknown, token?: string): Promise<Captured> {
  const { res, captured } = mockResponse()
  const req = { method, headers: token === undefined ? {} : { authorization: `Bearer ${token}` } } as unknown as IncomingMessage
  const url = new URL(`http://127.0.0.1${PUBLIC_API_PREFIX}${path}`)
  await service.handle(req, res, url, body === undefined ? null : body as Record<string, unknown>)
  return captured
}

function task(overrides: Partial<TaskRecord> = {}): TaskRecord {
  return {
    id: 't-api-1', title: 'API task', description: 'Description', prompt: '', workspaceId: 'ws', urgency: 'normal',
    status: 'todo', blocked: false, execution: { mode: 'claim' }, version: 1, createdAt: 1, updatedAt: 1,
    createdBy: { kind: 'user' }, updatedBy: { kind: 'user' }, comments: [], executions: [], ...overrides,
  }
}

async function fixture(token: string | undefined = 'secret-token') {
  const dir = await mkdtemp(join(tmpdir(), 'taskboard-public-')); directories.push(dir)
  const store = new TaskStore({ file: join(dir, 'tasks.json') })
  const service = new PublicApiService({
    store,
    workspaces: {
      list: () => [{ id: 'ws', title: 'Workspace', path: '/tmp/ws' }, { id: 'other', title: 'Other', path: '/tmp/other' }],
      get: id => id === 'ws' ? { id: 'ws', title: 'Workspace', path: '/tmp/ws' } : undefined,
    },
    now: () => 1_000,
    token: () => token,
  })
  return { dir, store, service }
}

describe('public API security', () => {
  it('is disabled without a configured token', async () => {
    const f = await fixture('')
    const result = await call(f.service, 'GET', '/meta', undefined, 'anything')
    expect(result.status).toBe(503)
    expect(result.body).toMatchObject({ ok: false, error: { code: 'public_api_disabled' } })
    f.service.dispose()
  })
  it('requires a valid bearer token', async () => {
    const f = await fixture()
    expect((await call(f.service, 'GET', '/meta')).status).toBe(401)
    expect((await call(f.service, 'GET', '/meta', undefined, 'wrong')).status).toBe(401)
    expect((await call(f.service, 'GET', '/meta', undefined, 'secret-token')).status).toBe(200)
    f.service.dispose()
  })
  it('never exposes the token in meta', async () => {
    const f = await fixture()
    const result = await call(f.service, 'GET', '/meta', undefined, 'secret-token')
    expect(JSON.stringify(result.body)).not.toContain('secret-token')
    expect(result.body).toMatchObject({ ok: true, value: { donePolicy: 'user-only', writePolicy: 'explicit' } })
    f.service.dispose()
  })
})

describe('public API discovery', () => {
  it('lists projects and tasks with eligibility and pagination', async () => {
    const f = await fixture()
    await f.store.mutate('task-created', ledger => {
      ledger.tasks.push(task({ id: 't-ready', status: 'todo' }), task({ id: 't-blocked', status: 'todo', blocked: true }), task({ id: 't-busy', status: 'in_progress', claimedBy: 'other' }))
      return [...ledger.tasks]
    })
    const projects = await call(f.service, 'GET', '/projects', undefined, 'secret-token')
    expect(projects.body).toMatchObject({ ok: true, value: [{ id: 'ws' }, { id: 'other' }] })
    const all = await call(f.service, 'GET', '/tasks?workspaceId=ws&limit=2', undefined, 'secret-token')
    expect((all.body as { value: { tasks: unknown[]; next?: string } }).value.tasks).toHaveLength(2)
    expect((all.body as { value: { next?: string } }).value.next).toBe('2')
    const eligible = await call(f.service, 'GET', '/tasks?eligible=true', undefined, 'secret-token')
    expect((eligible.body as { value: { tasks: Array<{ id: string }> } }).value.tasks.map(item => item.id)).toEqual(['t-ready'])
    f.service.dispose()
  })
  it('exposes dependencies and refuses unknown tasks', async () => {
    const f = await fixture()
    await f.store.mutate('task-created', ledger => {
      ledger.tasks.push(task({ id: 't-dep', status: 'done' }), task({ id: 't-child', dependsOn: ['t-dep'] }))
      return [...ledger.tasks]
    })
    const view = await call(f.service, 'GET', '/tasks/t-child', undefined, 'secret-token')
    expect(view.body).toMatchObject({ ok: true, value: { id: 't-child', dependencies: { ready: true, total: 1, completed: 1 } } })
    const missing = await call(f.service, 'GET', '/tasks/nope', undefined, 'secret-token')
    expect(missing.status).toBe(404)
    f.service.dispose()
  })
})

describe('public API execution lifecycle', () => {
  async function claimed() {
    const f = await fixture()
    await f.store.mutate('task-created', ledger => { ledger.tasks.push(task()); return [...ledger.tasks] })
    const claim = await call(f.service, 'POST', '/executions/claim', { taskId: 't-api-1', actor: 'agent-board:1', idempotencyKey: 'k1' }, 'secret-token')
    const value = (claim.body as { value: { execution: { executionId: string; fencingToken: number }; task: { status: string; claimedBy: string } } }).value
    return { ...f, claim, value, executionId: value.execution.executionId }
  }
  it('claims atomically and replays the same idempotency key', async () => {
    const f = await claimed()
    expect(f.claim.status).toBe(201)
    expect(f.value.task).toMatchObject({ status: 'in_progress', claimedBy: 'agent-board:1' })
    const replay = await call(f.service, 'POST', '/executions/claim', { taskId: 't-api-1', actor: 'agent-board:1', idempotencyKey: 'k1' }, 'secret-token')
    expect((replay.body as { value: { execution: { executionId: string } } }).value.execution.executionId).toBe(f.executionId)
    const other = await call(f.service, 'POST', '/executions/claim', { taskId: 't-api-1', actor: 'agent-board:2' }, 'secret-token')
    expect(other.status).toBe(409)
    f.service.dispose()
  })
  it('refuses unmet dependencies, cross-project claims and blocked cards', async () => {
    const f = await fixture()
    await f.store.mutate('task-created', ledger => {
      ledger.tasks.push(task({ id: 't-wait', dependsOn: ['t-missing'] }), task({ id: 't-other', workspaceId: 'other' }), task({ id: 't-blocked', blocked: true }))
      return [...ledger.tasks]
    })
    const dependency = await call(f.service, 'POST', '/executions/claim', { taskId: 't-wait', actor: 'a' }, 'secret-token')
    expect(dependency.body).toMatchObject({ ok: false, error: { code: 'dependency_blocked' } })
    const cross = await call(f.service, 'POST', '/executions/claim', { taskId: 't-other', actor: 'a', workspaceId: 'ws' }, 'secret-token')
    expect(cross.status).toBe(403)
    const blocked = await call(f.service, 'POST', '/executions/claim', { taskId: 't-blocked', actor: 'a' }, 'secret-token')
    expect(blocked.status).toBe(409)
    f.service.dispose()
  })
  it('binds a session, records attempts, hands off with fencing and keeps the claim', async () => {
    const f = await claimed()
    const bound = await call(f.service, 'POST', `/executions/${f.executionId}/session`, { actor: 'agent-board:1', sessionId: 's-1' }, 'secret-token')
    expect(bound.body).toMatchObject({ ok: true, value: { sessionId: 's-1', attempt: 1, managedBy: 'external' } })
    const attempt = await call(f.service, 'POST', `/executions/${f.executionId}/attempts`, { actor: 'agent-board:1', sessionId: 's-2', reason: 'model failover' }, 'secret-token')
    expect(attempt.body).toMatchObject({ ok: true, value: { sessionId: 's-2', attempt: 2, sessions: ['s-1', 's-2'] } })
    const token = (attempt.body as { value: { fencingToken: number } }).value.fencingToken
    const handoff = await call(f.service, 'POST', `/executions/${f.executionId}/handoff`, { actor: 'agent-board:1', fromSessionId: 's-2', toSessionId: 's-3', reason: 'handoff', ifFencingToken: token }, 'secret-token')
    expect(handoff.body).toMatchObject({ ok: true, value: { sessionId: 's-3', attempt: 3 } })
    const stale = await call(f.service, 'POST', `/executions/${f.executionId}/handoff`, { actor: 'agent-board:1', fromSessionId: 's-1', toSessionId: 's-4', ifFencingToken: token }, 'secret-token')
    expect(stale.status).toBe(409)
    const view = await call(f.service, 'GET', '/tasks/t-api-1', undefined, 'secret-token')
    expect(view.body).toMatchObject({ ok: true, value: { status: 'in_progress', claimedBy: 'agent-board:1' } })
    f.service.dispose()
  })
  it('settles success into in_review and never into done', async () => {
    const f = await claimed()
    const result = await call(f.service, 'POST', `/executions/${f.executionId}/complete`, {
      actor: 'agent-board:1', outcome: 'succeeded', comment: 'done',
      report: { summary: 'implemented', changedFiles: ['a.ts'], checks: ['vitest'], artifacts: [], risk: '' },
    }, 'secret-token')
    expect(result.body).toMatchObject({ ok: true, value: { outcome: 'succeeded', report: { summary: 'implemented' } } })
    const view = await call(f.service, 'GET', '/tasks/t-api-1', undefined, 'secret-token')
    expect(view.body).toMatchObject({ ok: true, value: { status: 'in_review' } })
    expect((view.body as { value: { status: string; claimedBy?: string } }).value.status).not.toBe('done')
    expect((view.body as { value: { claimedBy?: string } }).value.claimedBy).toBeUndefined()
    // Completion is idempotent with the same outcome.
    const again = await call(f.service, 'POST', `/executions/${f.executionId}/complete`, { actor: 'agent-board:1', outcome: 'succeeded' }, 'secret-token')
    expect(again.body).toMatchObject({ ok: true, value: { outcome: 'succeeded' } })
    f.service.dispose()
  })
  it('returns failed work to todo and refuses non-owner settlement', async () => {
    const f = await claimed()
    const foreign = await call(f.service, 'POST', `/executions/${f.executionId}/complete`, { actor: 'someone-else', outcome: 'succeeded' }, 'secret-token')
    expect(foreign.status).toBe(403)
    const failed = await call(f.service, 'POST', `/executions/${f.executionId}/complete`, { actor: 'agent-board:1', outcome: 'failed', reason: 'boom' }, 'secret-token')
    expect(failed.body).toMatchObject({ ok: true, value: { outcome: 'failed' } })
    const view = await call(f.service, 'GET', '/tasks/t-api-1', undefined, 'secret-token')
    expect(view.body).toMatchObject({ ok: true, value: { status: 'todo' } })
    expect((view.body as { value: { claimedBy?: string } }).value.claimedBy).toBeUndefined()
    f.service.dispose()
  })
  it('refuses to manage a host-driven execution', async () => {
    const f = await fixture()
    await f.store.mutate('task-created', ledger => {
      ledger.tasks.push(task({ status: 'in_progress', claimedBy: 'agent-board:1', executions: [{ id: 'exec-board', trigger: 'manual', outcome: 'running', startedAt: 1 }] }))
      return [...ledger.tasks]
    })
    const result = await call(f.service, 'POST', '/executions/exec-board/complete', { actor: 'agent-board:1', outcome: 'succeeded' }, 'secret-token')
    expect(result.status).toBe(403)
    f.service.dispose()
  })
})

describe('public API events', () => {
  it('emits normalized events and requires a full resync after restart', async () => {
    const f = await fixture()
    await f.store.mutate('task-created', ledger => { ledger.tasks.push(task()); return [...ledger.tasks] })
    const created = await call(f.service, 'GET', '/events?since=0', undefined, 'secret-token')
    const types = (created.body as { value: { events: Array<{ type: string }> } }).value.events.map(event => event.type)
    expect(types).toContain('task.created')
    await call(f.service, 'POST', '/executions/claim', { taskId: 't-api-1', actor: 'agent-board:1' }, 'secret-token')
    const sinceRevision = (created.body as { value: { latestSeq: number } }).value.latestSeq
    const claimEvents = await call(f.service, 'GET', `/events?since=${sinceRevision}`, undefined, 'secret-token')
    expect((claimEvents.body as { value: { events: Array<{ type: string }> } }).value.events.map(event => event.type)).toContain('task.claimed')
    expect((claimEvents.body as { value: { events: Array<{ type: string }> } }).value.events.map(event => event.type)).toContain('execution.started')
    f.service.dispose()
    const restarted = new PublicApiService({
      store: f.store,
      workspaces: { list: () => [], get: () => undefined },
      now: () => 2_000,
      token: () => 'secret-token',
    })
    const resync = await call(restarted, 'GET', '/events?since=1', undefined, 'secret-token')
    expect(resync.body).toMatchObject({ ok: true, value: { resync: true, events: [] } })
    restarted.dispose()
  })
})

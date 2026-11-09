/**
 * Host-layer tests for 0.10.1 dependency-change approval: agent writes become
 * pending requests instead of weakening the graph, the user decides through
 * the new routes, cross-project writes are refused, and every path leaves the
 * audit system comments the agent reads back.
 *
 * Isolation: fresh real TaskStore + tool registry + node:http routes per test;
 * nothing is shared, so tests are order-independent.
 *
 * @module dsh-taskboard/tests/approval-host
 */
import { createServer, type Server } from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { registerTaskboardRoutes } from '../src/host/routes.ts'
import { registerTaskboardTools } from '../src/host/tools.ts'
import { TaskStore } from '../src/host/store.ts'
import type { WorkspaceFace } from '../src/host/tools.ts'

const NOW = 1_700_000_040_000
let dir: string
let storeSeq = 0
const cleanups: Array<() => Promise<void> | void> = []

const WS = [
  { id: 'ws-a', path: '/proj/a', title: 'A' },
  { id: 'ws-b', path: '/proj/b', title: 'B' },
]

const workspaces: WorkspaceFace = {
  resolveByPath: async path => (path === '/proj/a' ? { id: 'ws-a' } : path === '/proj/b' ? { id: 'ws-b' } : undefined),
  get: id => WS.find(ws => ws.id === id),
  list: () => WS.slice(),
  archiveSession: async () => {},
}

type RouteJson = { ok: boolean; value?: unknown; error?: { code: string; message: string } }
type ToolFace = {
  execute(args: unknown, exec?: unknown): Promise<unknown>
  output: { render(args: unknown, value: unknown): Array<{ type: string; text: string }> }
}

interface Host {
  store: InstanceType<typeof TaskStore>
  base: string
  tool(name: string): ToolFace
  post(path: string, body: unknown): Promise<{ status: number; body: RouteJson }>
  get(path: string): Promise<{ status: number; body: RouteJson }>
}

/** The owning session: a project ws-a agent. */
const owner = { agent: { id: 'session-a', session: { header: { cwd: '/proj/a' } } } }
/** An unrelated project's session (ws-b). */
const outsider = { agent: { id: 'session-b', session: { header: { cwd: '/proj/b' } } } }

type PendingApproval = { id: string; kind: string; remove?: string[]; affected?: string[] }

/** Build one isolated host (store + tools + HTTP routes). */
async function host(options: { linkedRoots?: () => string[] } = {}): Promise<Host> {
  storeSeq += 1
  const store = new TaskStore({ file: join(dir, `ledger-${storeSeq}.json`) })
  const registered = new Map<string, ToolFace>()
  const disposeTools = registerTaskboardTools(
    { tools: { register: tool => { registered.set((tool as unknown as { name: string }).name, tool as unknown as ToolFace); return () => {} } } },
    { store, workspaces, now: () => NOW, ...(options.linkedRoots !== undefined ? { linkedRoots: options.linkedRoots } : {}) },
  )
  const captured: Array<{ kind: string; path: string; handler: (req: never, res: never) => void }> = []
  const disposeRoutes = registerTaskboardRoutes(
    { webServer: { register: (route: { kind: string; path: string; handler: (req: never, res: never) => void }) => { captured.push(route); return () => {} } } } as never,
    { store, workspaces, now: () => NOW },
  )
  const server: Server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://x')
    const hit = captured.find(route => route.kind === 'exact' && url.pathname === route.path)
      ?? captured.find(route => route.kind === 'prefix' && url.pathname.startsWith(route.path))
    if (hit !== undefined) hit.handler(req as never, res as never)
    else { res.writeHead(404); res.end() }
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  cleanups.push(async () => {
    disposeRoutes()
    disposeTools.forEach(dispose => dispose())
    server.closeAllConnections()
    await new Promise<void>(resolve => server.close(() => resolve()))
  })
  const request = async (method: 'GET' | 'POST', path: string, body?: unknown): Promise<{ status: number; body: RouteJson }> => {
    const res = await fetch(`${base}${path}`, method === 'GET'
      ? undefined
      : { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body ?? {}) })
    return { status: res.status, body: await res.json() as RouteJson }
  }
  return {
    store,
    base,
    tool: name => {
      const tool = registered.get(name)
      if (tool === undefined) throw new Error(`tool not registered: ${name}`)
      return tool
    },
    post: (path, body) => request('POST', path, body),
    get: path => request('GET', path),
  }
}

/** Route create helper (user actor); returns the new id. */
async function create(h: Host, body: Record<string, unknown>): Promise<string> {
  const res = await h.post('/dsh-taskboard/tasks', { workspaceId: 'ws-a', urgency: 'normal', ...body })
  expect(res.status).toBe(201)
  return (res.body.value as { id: string }).id
}

/** Approve/reject one request through the user route. */
function decide(h: Host, taskId: string, changeId: string, decision: 'approve' | 'reject', body: unknown = {}): Promise<{ status: number; body: RouteJson }> {
  return h.post(`/dsh-taskboard/tasks/${taskId}/changes/${changeId}/${decision}`, body)
}

/** Request a prerequisite removal through the agent tool; returns pendingApproval. */
async function requestRemoval(h: Host, taskId: string, dependsOn: string[], reason: string | undefined, exec = owner): Promise<PendingApproval> {
  const version = h.store.get(taskId)!.version
  const result = await h.tool('taskboard_update').execute({ id: taskId, ifVersion: version, dependsOn, ...(reason !== undefined ? { reason } : {}) }, exec) as { pendingApproval?: PendingApproval }
  expect(result.pendingApproval).toBeDefined()
  return result.pendingApproval!
}

beforeAll(async () => { dir = await mkdtemp(join(tmpdir(), 'tb-approval-')) })
afterEach(async () => { while (cleanups.length > 0) await cleanups.pop()?.() })
afterAll(async () => { await rm(dir, { recursive: true, force: true }) })

// ---------------------------------------------------------------------------
// Agent update: additions immediate, removals deferred
// ---------------------------------------------------------------------------
describe('taskboard_update: removing prerequisites becomes a pending request', () => {
  it('rejects a removal without reason and leaves the graph untouched', async () => {
    const h = await host()
    const a = await create(h, { title: 'A' })
    const t = await create(h, { title: 'T', dependsOn: [a] })
    const before = h.store.get(t)!
    await expect(h.tool('taskboard_update').execute({ id: t, ifVersion: before.version, dependsOn: [] }, owner))
      .rejects.toThrow(/reason required to request prerequisite removal/)
    const after = h.store.get(t)!
    expect(after.dependsOn).toEqual([a])
    expect(after.pendingChanges).toBeUndefined()
    expect(after.version).toBe(before.version)
  })

  it('records the request, keeps the protection and applies additions immediately', async () => {
    const h = await host()
    const a = await create(h, { title: 'A' })
    const b = await create(h, { title: 'B' })
    const t = await create(h, { title: 'T', dependsOn: [a] })

    // Propose a full replacement that DROPS a and ADDS b.
    const pending = await requestRemoval(h, t, [b], 'a is unrelated, b is the real blocker')
    expect(pending).toMatchObject({ kind: 'remove-prerequisites', remove: [a] })
    expect(pending.id).toMatch(/^dcr-/)

    // b was applied immediately; a stays enforced until the user decides.
    const requested = h.store.get(t)!
    expect(requested.dependsOn).toEqual([a, b])
    expect(requested.pendingChanges).toHaveLength(1)
    expect(requested.pendingChanges![0]).toMatchObject({
      id: pending.id,
      kind: 'remove-prerequisites',
      taskId: t,
      remove: [a],
      reason: 'a is unrelated, b is the real blocker',
      requestedBy: { kind: 'agent', sessionId: 'session-a' },
    })
    const audit = requested.comments.at(-1)!
    expect(audit.systemKey).toBe('sys.dcr.requested')
    expect(audit.systemParams).toMatchObject({ kind: 'remove-prerequisites', ids: a, reason: 'a is unrelated, b is the real blocker' })
    // Still blocked: neither prerequisite is done.
    await expect(h.tool('taskboard_move').execute({ id: t, status: 'in_progress', ifVersion: requested.version }, owner))
      .rejects.toThrow(/unsatisfied dependencies/)
  })

  it('applies pure additions immediately with no reason and no request', async () => {
    const h = await host()
    const a = await create(h, { title: 'A' })
    const b = await create(h, { title: 'B' })
    const t = await create(h, { title: 'T', dependsOn: [a] })
    const result = await h.tool('taskboard_update').execute({ id: t, ifVersion: h.store.get(t)!.version, dependsOn: [a, b] }, owner) as { pendingApproval?: PendingApproval }
    expect(result.pendingApproval).toBeUndefined()
    const updated = h.store.get(t)!
    expect(updated.dependsOn).toEqual([a, b])
    expect(updated.pendingChanges).toBeUndefined()
  })

  it('a second removal replaces the pending request (same id) and appends another audit comment', async () => {
    const h = await host()
    const a = await create(h, { title: 'A' })
    const b = await create(h, { title: 'B' })
    const t = await create(h, { title: 'T', dependsOn: [a, b] })
    const first = await requestRemoval(h, t, [a], 'first reason')
    const second = await requestRemoval(h, t, [a], 'second reason')
    expect(second.id).toBe(first.id)
    const task = h.store.get(t)!
    expect(task.pendingChanges).toHaveLength(1)
    expect(task.pendingChanges![0]).toMatchObject({ id: first.id, reason: 'second reason', remove: [b] })
    expect(task.comments.filter(comment => comment.systemKey === 'sys.dcr.requested')).toHaveLength(2)
  })

  it('rejects an over-long reason', async () => {
    const h = await host()
    const a = await create(h, { title: 'A' })
    const t = await create(h, { title: 'T', dependsOn: [a] })
    await expect(h.tool('taskboard_update').execute({ id: t, ifVersion: 1, dependsOn: [], reason: 'x'.repeat(501) }, owner))
      .rejects.toThrow(/reason must be 1\.\.500 characters/)
    expect(h.store.get(t)!.dependsOn).toEqual([a])
  })
})

// ---------------------------------------------------------------------------
// Agent delete: prerequisite deletion becomes a pending request
// ---------------------------------------------------------------------------
describe('taskboard_delete: deleting a prerequisite becomes a pending request', () => {
  it('requires a reason, then requests instead of trashing while dependents exist', async () => {
    const h = await host()
    const a = await create(h, { title: 'Prereq A' })
    const t = await create(h, { title: 'Dependent T', dependsOn: [a] })

    await expect(h.tool('taskboard_delete').execute({ id: a, ifVersion: 1 }, owner))
      .rejects.toThrow(/reason required to request prerequisite deletion/)
    expect(h.store.get(a)!.trashedAt).toBeUndefined()

    const result = await h.tool('taskboard_delete').execute({ id: a, ifVersion: 1, reason: 'A is obsolete now' }, owner) as { pendingApproval?: PendingApproval; trashed?: boolean }
    expect(result.trashed).toBeUndefined()
    expect(result.pendingApproval).toMatchObject({ kind: 'trash-prerequisite', affected: [t] })
    const requested = h.store.get(a)!
    expect(requested.trashedAt).toBeUndefined()
    expect(requested.pendingChanges![0]).toMatchObject({
      kind: 'trash-prerequisite',
      affected: [t],
      reason: 'A is obsolete now',
    })
    expect(requested.comments.at(-1)!.systemKey).toBe('sys.dcr.requested')
    // Nothing was unblocked: the graph is untouched.
    expect(h.store.get(t)!.dependsOn).toEqual([a])
  })

  it('deletes immediately when no live dependent exists (no reason needed)', async () => {
    const h = await host()
    const a = await create(h, { title: 'Lonely' })
    const result = await h.tool('taskboard_delete').execute({ id: a, ifVersion: 1 }, owner) as { trashed?: boolean; pendingApproval?: PendingApproval }
    expect(result.trashed).toBe(true)
    expect(result.pendingApproval).toBeUndefined()
    expect(h.store.get(a)!.trashedAt).toBeDefined()
  })
})

// ---------------------------------------------------------------------------
// Project boundary for every agent write
// ---------------------------------------------------------------------------
describe('cross-project agent writes are refused (0.10.1)', () => {
  it('refuses update/delete/move from another project and keeps the task unchanged', async () => {
    const h = await host()
    const t = await create(h, { title: 'Owned by ws-a' })
    await expect(h.tool('taskboard_update').execute({ id: t, ifVersion: 1, title: 'hijack' }, outsider)).rejects.toThrow(/workspace_mismatch/)
    await expect(h.tool('taskboard_delete').execute({ id: t, ifVersion: 1 }, outsider)).rejects.toThrow(/workspace_mismatch/)
    await expect(h.tool('taskboard_move').execute({ id: t, status: 'in_progress', ifVersion: 1 }, outsider)).rejects.toThrow(/workspace_mismatch/)
    const task = h.store.get(t)!
    expect(task.title).toBe('Owned by ws-a')
    expect(task.status).toBe('todo')
    expect(task.trashedAt).toBeUndefined()
    // The owning project's session is unaffected.
    await expect(h.tool('taskboard_update').execute({ id: t, ifVersion: 1, title: 'renamed' }, owner)).resolves.toBeDefined()
    expect(h.store.get(t)!.title).toBe('renamed')
  })

  it('allows a linked-root project only when the board enables linked-root claims', async () => {
    const h = await host({ linkedRoots: () => ['/proj/b'] })
    const t = await create(h, { title: 'Lives in ws-b', workspaceId: 'ws-b' })
    await expect(h.tool('taskboard_update').execute({ id: t, ifVersion: 1, title: 'blocked' }, owner)).rejects.toThrow(/workspace_mismatch/)
    await h.store.mutate('settings-updated', ledger => { ledger.settings = { allowClaimFromLinkedRoots: true }; return [] })
    await expect(h.tool('taskboard_update').execute({ id: t, ifVersion: 1, title: 'allowed' }, owner)).resolves.toBeDefined()
    expect(h.store.get(t)!.title).toBe('allowed')
  })
})

// ---------------------------------------------------------------------------
// User decisions: approve / reject / stale
// ---------------------------------------------------------------------------
describe('user decision routes', () => {
  it('approve (remove-prerequisites) drops the ids, clears the request and audits', async () => {
    const h = await host()
    const a = await create(h, { title: 'A' })
    const b = await create(h, { title: 'B' })
    const t = await create(h, { title: 'T', dependsOn: [a, b] })
    const pending = await requestRemoval(h, t, [b], 'a is enough')
    const versionBefore = h.store.get(t)!.version

    const res = await decide(h, t, pending.id, 'approve')
    expect(res.status).toBe(200)
    const value = res.body.value as { dependsOn?: string[]; pendingChanges?: unknown; version: number }
    expect(value.dependsOn).toEqual([b])
    expect(value.pendingChanges).toBeUndefined()
    expect(value.version).toBe(versionBefore + 1)
    const task = h.store.get(t)!
    expect(task.pendingChanges).toBeUndefined()
    const audit = task.comments.at(-1)!
    expect(audit.systemKey).toBe('sys.dcr.approved')
    expect(audit.systemParams).toMatchObject({ kind: 'remove-prerequisites', ids: a, reason: 'a is enough' })
    // A second decision on the same request is a stale/unknown request.
    expect((await decide(h, t, pending.id, 'approve')).status).toBe(404)
  })

  it('approve ignores ids that already disappeared from dependsOn', async () => {
    const h = await host()
    const a = await create(h, { title: 'A' })
    const t = await create(h, { title: 'T', dependsOn: [a] })
    const pending = await requestRemoval(h, t, [], 'remove the only one')
    // The user route removes the prerequisite in the meantime (GUI surface).
    const version = h.store.get(t)!.version
    expect((await h.post(`/dsh-taskboard/tasks/${t}/update`, { ifVersion: version, dependsOn: [] })).status).toBe(200)
    const res = await decide(h, t, pending.id, 'approve')
    expect(res.status).toBe(200)
    expect((res.body.value as { dependsOn?: string[] }).dependsOn).toBeUndefined()
    expect(h.store.get(t)!.pendingChanges).toBeUndefined()
  })

  it('approve (trash-prerequisite) trashes the task and repairs dependents atomically', async () => {
    const h = await host()
    const a = await create(h, { title: 'Prereq A' })
    const t = await create(h, { title: 'Dependent T', dependsOn: [a] })
    const requested = await h.tool('taskboard_delete').execute({ id: a, ifVersion: 1, reason: 'obsolete' }, owner) as { pendingApproval: PendingApproval }
    const dependentVersion = h.store.get(t)!.version

    const res = await decide(h, a, requested.pendingApproval.id, 'approve')
    expect(res.status).toBe(200)
    expect((res.body.value as { trashed: boolean }).trashed).toBe(true)
    const trashed = h.store.get(a)!
    expect(trashed.trashedAt).toBeDefined()
    expect(trashed.pendingChanges).toBeUndefined()
    expect(trashed.comments.at(-1)!.systemKey).toBe('sys.dcr.approved')

    const repaired = h.store.get(t)!
    expect(repaired.dependsOn).toBeUndefined()
    expect(repaired.version).toBe(dependentVersion + 1)
    expect(repaired.comments.at(-1)!.systemKey).toBe('sys.prerequisiteRemoved')
    // The dependent card is live and unblocked.
    expect(repaired.trashedAt).toBeUndefined()
  })

  it('reject clears the request, keeps the graph and records the note', async () => {
    const h = await host()
    const a = await create(h, { title: 'A' })
    const t = await create(h, { title: 'T', dependsOn: [a] })
    const pending = await requestRemoval(h, t, [], 'why not')
    const res = await decide(h, t, pending.id, 'reject', { note: 'keep it for now' })
    expect(res.status).toBe(200)
    const task = h.store.get(t)!
    expect(task.dependsOn).toEqual([a])
    expect(task.pendingChanges).toBeUndefined()
    const audit = task.comments.at(-1)!
    expect(audit.systemKey).toBe('sys.dcr.rejected')
    expect(audit.systemParams).toMatchObject({ kind: 'remove-prerequisites', ids: a, reason: 'why not', note: 'keep it for now' })
  })

  it('stale approve (task trashed meanwhile) answers 409 stale_request, discards the request and audits', async () => {
    const h = await host()
    const a = await create(h, { title: 'A' })
    const t = await create(h, { title: 'T', dependsOn: [a] })
    const pending = await requestRemoval(h, t, [], 'remove it')
    expect((await h.post(`/dsh-taskboard/tasks/${t}/delete`, { ifVersion: h.store.get(t)!.version })).status).toBe(200)

    const res = await decide(h, t, pending.id, 'approve')
    expect(res.status).toBe(409)
    expect(res.body.error?.code).toBe('stale_request')
    const task = h.store.get(t)!
    expect(task.trashedAt).toBeDefined()
    expect(task.pendingChanges).toBeUndefined()
    expect(task.comments.at(-1)!.systemKey).toBe('sys.dcr.stale')
  })

  it('stale approve on a purged task answers 409 stale_request', async () => {
    const h = await host()
    const a = await create(h, { title: 'A' })
    const t = await create(h, { title: 'T', dependsOn: [a] })
    const pending = await requestRemoval(h, t, [], 'remove it')
    await h.post(`/dsh-taskboard/tasks/${t}/delete`, { ifVersion: h.store.get(t)!.version })
    expect((await h.post(`/dsh-taskboard/tasks/${t}/delete`, { purge: true })).status).toBe(200)
    expect(h.store.get(t)).toBeUndefined()
    const res = await decide(h, t, pending.id, 'approve')
    expect(res.status).toBe(409)
    expect(res.body.error?.code).toBe('stale_request')
  })

  it('refuses an approve-trash while the task gained a live child, keeping the request pending', async () => {
    const h = await host()
    const p = await create(h, { title: 'P' })
    const dependent = await create(h, { title: 'Depends on P', dependsOn: [p] })
    const requested = await h.tool('taskboard_delete').execute({ id: p, ifVersion: 1, reason: 'obsolete' }, owner) as { pendingApproval: PendingApproval }
    await create(h, { title: 'Late child', parentId: p })

    const res = await decide(h, p, requested.pendingApproval.id, 'approve')
    expect(res.status).toBe(400)
    expect(res.body.error?.message ?? '').toMatch(/has_children/)
    const task = h.store.get(p)!
    expect(task.trashedAt).toBeUndefined()
    expect(task.pendingChanges).toHaveLength(1)
    expect(h.store.get(dependent)!.dependsOn).toEqual([p])
  })

  it('unknown request ids answer 404', async () => {
    const h = await host()
    const t = await create(h, { title: 'T' })
    const res = await decide(h, t, 'dcr-missing', 'approve')
    expect(res.status).toBe(404)
    expect(res.body.error?.code).toBe('not_found')
  })
})

// ---------------------------------------------------------------------------
// User edits stay unguarded; exposure + persistence
// ---------------------------------------------------------------------------
describe('user surface and persistence', () => {
  it('the GUI update route may weaken dependencies immediately (no request)', async () => {
    const h = await host()
    const a = await create(h, { title: 'A' })
    const t = await create(h, { title: 'T', dependsOn: [a] })
    const res = await h.post(`/dsh-taskboard/tasks/${t}/update`, { ifVersion: 1, dependsOn: [] })
    expect(res.status).toBe(200)
    expect(h.store.get(t)!.dependsOn).toBeUndefined()
    expect(h.store.get(t)!.pendingChanges).toBeUndefined()
  })

  it('taskboard_get/list expose the pending request', async () => {
    const h = await host()
    const a = await create(h, { title: 'A' })
    const t = await create(h, { title: 'T', dependsOn: [a] })
    const pending = await requestRemoval(h, t, [], 'remove the prerequisite')

    const got = await h.tool('taskboard_get').execute({ id: t }, owner) as { task: { pendingChanges?: Array<{ id: string }> } }
    expect(got.task.pendingChanges?.[0]?.id).toBe(pending.id)
    const detail = h.tool('taskboard_get').output.render({}, got)[0]!.text
    expect(detail).toContain(pending.id)
    expect(detail).toContain('待用户审批的依赖变更')

    const listed = h.tool('taskboard_list').output.render({}, await h.tool('taskboard_list').execute({}, owner))[0]!.text
    expect(listed).toContain('·待审批1')
  })

  it('an exported ledger round-trips pending requests through import replace', async () => {
    const h = await host()
    const a = await create(h, { title: 'A' })
    const t = await create(h, { title: 'T', dependsOn: [a] })
    const pending = await requestRemoval(h, t, [], 'keep the audit')
    const exported = structuredClone(h.store.snapshot().tasks)

    const h2 = await host()
    const res = await h2.post('/dsh-taskboard/import', { mode: 'replace', ledger: { schemaVersion: 1, tasks: exported } })
    expect(res.status).toBe(200)
    const restored = h2.store.get(t)!
    expect(restored.pendingChanges).toHaveLength(1)
    expect(restored.pendingChanges![0]).toMatchObject({
      id: pending.id,
      kind: 'remove-prerequisites',
      taskId: t,
      remove: [a],
      reason: 'keep the audit',
      requestedBy: { kind: 'agent', sessionId: 'session-a' },
    })
    // The decision still works after the round-trip.
    expect((await decide(h2, t, pending.id, 'reject')).status).toBe(200)
    expect(h2.store.get(t)!.pendingChanges).toBeUndefined()
  })
})

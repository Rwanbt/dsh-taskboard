/**
 * HOST-LEVEL dependency/hierarchy tests (F1-F7, D1-D7): the five execution
 * start paths, the atomic delete/import repair invariant, write-entry-point
 * validation (route, tool, import merge/replace), agent observability and the
 * P1 hierarchy integration.
 *
 * Isolation model: every test builds a fresh real TaskStore over a unique
 * mkdtemp ledger, a fresh tool registry, a real ExecutionService (used only up
 * to its atomic gate) and a real node:http server wired to the real routes.
 * Nothing is shared between tests, so any test can run alone or sharded.
 *
 * @module dsh-taskboard/tests/host-dependencies
 */
import { createServer, type Server } from 'node:http'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { registerTaskboardRoutes } from '../src/host/routes.ts'
import { registerTaskboardTools } from '../src/host/tools.ts'
import { ExecutionService, type AgentsFace } from '../src/host/execution.ts'
import { TaskStore } from '../src/host/store.ts'
import { dependencyState } from '../src/shared/dependencies.ts'
import type { TaskRecord } from '../src/shared/protocol.ts'
import type { WorkspaceFace } from '../src/host/tools.ts'

const NOW = 1_700_000_040_000

let dir: string
let storeSeq = 0
/** Every live server/routes/tools pair is disposed in afterEach. */
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

/** The execution service's narrower workspace face. */
const executionWorkspaces = {
  get: (id: string) => WS.find(ws => ws.id === id),
  attach: async () => {},
}

/** A blocked run must reject INSIDE the gate, before any agent is created. */
const agents: AgentsFace = {
  create: async () => { throw new Error('gate bypass: an execution was started for a blocked task') },
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
  execution: ExecutionService
  post(path: string, body: unknown): Promise<{ status: number; body: RouteJson }>
  get(path: string): Promise<{ status: number; body: RouteJson }>
}

/** Tool-call agent context: a session inside project ws-a. */
const exec = { agent: { id: 'session-1', session: { header: { cwd: '/proj/a' } } } }

/** One complete task record (for direct ledger seeding of special states). */
function task(overrides: Partial<TaskRecord> & Pick<TaskRecord, 'id'>): TaskRecord {
  return {
    title: `task ${overrides.id}`,
    description: '',
    prompt: '',
    workspaceId: 'ws-a',
    urgency: 'normal',
    status: 'todo',
    blocked: false,
    execution: { mode: 'claim' },
    version: 1,
    createdAt: NOW,
    updatedAt: NOW,
    createdBy: { kind: 'user' },
    updatedBy: { kind: 'user' },
    comments: [],
    executions: [],
    ...overrides,
  }
}

/** Seed records directly (bypasses route validation on purpose). */
async function seed(store: InstanceType<typeof TaskStore>, tasks: TaskRecord[]): Promise<void> {
  await store.mutate('task-created', ledger => { ledger.tasks.push(...tasks); return [...tasks] })
}

/** Build one isolated host: store + tools + execution service + HTTP routes. */
async function host(): Promise<Host> {
  storeSeq += 1
  const store = new TaskStore({ file: join(dir, `ledger-${storeSeq}.json`) })
  const registered = new Map<string, ToolFace>()
  const disposeTools = registerTaskboardTools(
    { tools: { register: tool => { registered.set((tool as unknown as { name: string }).name, tool as unknown as ToolFace); return () => {} } } },
    { store, workspaces, now: () => NOW },
  )
  const execution = new ExecutionService({
    store,
    agents,
    workspaces: executionWorkspaces,
    events: { onSessionEvent: () => () => {} },
    now: () => NOW,
  })
  const captured: Array<{ kind: string; path: string; handler: (req: never, res: never) => void }> = []
  const disposeRoutes = registerTaskboardRoutes(
    { webServer: { register: (route: { kind: string; path: string; handler: (req: never, res: never) => void }) => { captured.push(route); return () => {} } } } as never,
    {
      store,
      workspaces,
      now: () => NOW,
      run: (taskId, runOptions) => execution.run(taskId, 'manual', runOptions),
      commentRun: taskId => execution.deliverComments(taskId),
    },
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
  return {
    store,
    base,
    execution,
    tool: name => {
      const tool = registered.get(name)
      if (tool === undefined) throw new Error(`tool not registered: ${name}`)
      return tool
    },
    post: async (path, body) => {
      const res = await fetch(`${base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
      return { status: res.status, body: await res.json() as RouteJson }
    },
    get: async path => {
      const res = await fetch(`${base}${path}`)
      return { status: res.status, body: await res.json() as RouteJson }
    },
  }
}

/** Route create helper: returns the new id (asserts success unless told otherwise). */
async function create(h: Host, body: Record<string, unknown>): Promise<string> {
  const res = await h.post('/dsh-taskboard/tasks', { workspaceId: 'ws-a', urgency: 'normal', ...body })
  expect(res.status).toBe(201)
  return (res.body.value as { id: string }).id
}

/** Route move using the current version. */
async function move(h: Host, id: string, status: string): Promise<{ status: number; body: RouteJson }> {
  return h.post(`/dsh-taskboard/tasks/${id}/move`, { ifVersion: h.store.get(id)!.version, status })
}

/** Walk a task to done through the legal human path. */
async function toDone(h: Host, id: string): Promise<void> {
  expect((await move(h, id, 'in_progress')).status).toBe(200)
  expect((await move(h, id, 'in_review')).status).toBe(200)
  expect((await move(h, id, 'done')).status).toBe(200)
}

/** Assert a route failure envelope. */
function expectFailure(res: { status: number; body: RouteJson }, pattern?: RegExp): void {
  expect(res.body.ok).toBe(false)
  expect(res.status).toBeGreaterThanOrEqual(400)
  expect(res.status).toBeLessThan(500)
  if (pattern !== undefined) expect(res.body.error?.message ?? '').toMatch(pattern)
}

beforeAll(async () => { dir = await mkdtemp(join(tmpdir(), 'tb-host-deps-')) })
afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()?.()
})
afterAll(async () => { await rm(dir, { recursive: true, force: true }) })

// ---------------------------------------------------------------------------
// F7/D4: every start path is gated on unmet prerequisites
// ---------------------------------------------------------------------------
describe('execution start paths reject unmet prerequisites (D1/D4)', () => {
  it('rejects agent claim, route move, route run, scheduled dispatch and comment wake', async () => {
    const h = await host()
    const a = await create(h, { title: 'Prereq A' })
    const b = await create(h, { title: 'Dependent B', dependsOn: [a] })
    const bVersion = h.store.get(b)!.version

    // 1. Agent claim through taskboard_move.
    await expect(h.tool('taskboard_move').execute({ id: b, status: 'in_progress', ifVersion: bVersion }, exec))
      .rejects.toThrow(/unsatisfied dependencies/)
    expect(h.store.get(b)!.status).toBe('todo')

    // 2. GUI move route to in_progress.
    const moved = await move(h, b, 'in_progress')
    expectFailure(moved, /unsatisfied dependencies/)
    expect(moved.body.error?.code).toBe('invalid_transition')

    // 3. GUI manual run route → the execution gate.
    const ran = await h.post(`/dsh-taskboard/tasks/${b}/run`, {})
    expectFailure(ran, /unsatisfied dependencies/)

    // 4. Scheduled dispatch → the same atomic execution gate.
    const scheduled = await create(h, { title: 'Scheduled B', dependsOn: [a] })
    const window = NOW + 1
    await h.store.mutate('task-updated', ledger => {
      const target = ledger.tasks.find(t => t.id === scheduled)!
      target.execution = { mode: 'scheduled', dispatchingRunAt: window, queuedAt: NOW }
      return [target]
    })
    const dispatched = await h.execution.run(scheduled, 'scheduled', { scheduledWindow: window })
    expect(dispatched.ok).toBe(false)
    expect(!dispatched.ok && dispatched.error).toMatch(/unsatisfied dependencies/)

    // 5. Comment wake (in_review dependent) → the same gate after the comment write.
    const woken = await create(h, { title: 'Comment B', dependsOn: [a] })
    await h.store.mutate('task-updated', ledger => {
      const target = ledger.tasks.find(t => t.id === woken)!
      target.status = 'in_review'
      return [target]
    })
    const wake = await h.post(`/dsh-taskboard/tasks/${woken}/comment-run`, { body: 'please fix' })
    expectFailure(wake, /unsatisfied dependencies/)

    // Control: the gate is not blanket — human acceptance unblocks the claim.
    await toDone(h, a)
    const claimed = await h.tool('taskboard_move').execute({ id: b, status: 'in_progress', ifVersion: bVersion }, exec) as { task: { status: string } }
    expect(claimed.task.status).toBe('in_progress')
  })

  it('in_review never satisfies a prerequisite; done does (D1)', async () => {
    const h = await host()
    const a = await create(h, { title: 'A' })
    const b = await create(h, { title: 'B', dependsOn: [a] })
    expect((await move(h, a, 'in_progress')).status).toBe(200)
    expect((await move(h, a, 'in_review')).status).toBe(200)
    await expect(h.tool('taskboard_move').execute({ id: b, status: 'in_progress', ifVersion: 1 }, exec))
      .rejects.toThrow(/unsatisfied dependencies/)
    expect((await move(h, a, 'done')).status).toBe(200)
    await expect(h.tool('taskboard_move').execute({ id: b, status: 'in_progress', ifVersion: 1 }, exec)).resolves.toBeDefined()
  })

  it('reopening a done prerequisite re-blocks new starts and leaves a running execution untouched', async () => {
    const h = await host()
    const a = await create(h, { title: 'A' })
    const b = await create(h, { title: 'B', dependsOn: [a] })
    const c = await create(h, { title: 'C', dependsOn: [a] })
    await toDone(h, a)
    // B starts and is running (a live execution record holding the card).
    await h.store.mutate('task-updated', ledger => {
      const target = ledger.tasks.find(t => t.id === b)!
      target.status = 'in_progress'
      target.claimedBy = 'session-live'
      target.executions.push({ id: 'e-live', trigger: 'manual', startedAt: NOW, outcome: 'running', sessionId: 'session-live' })
      return [target]
    })
    // Reopen the accepted prerequisite.
    expect((await move(h, a, 'todo')).status).toBe(200)
    expect(h.store.get(a)!.status).toBe('todo')

    // New runs are blocked again.
    expectFailure(await move(h, c, 'in_progress'), /unsatisfied dependencies/)
    await expect(h.tool('taskboard_move').execute({ id: c, status: 'in_progress', ifVersion: 1 }, exec))
      .rejects.toThrow(/unsatisfied dependencies/)
    // ... but the running execution was not killed or rewritten.
    const running = h.store.get(b)!
    expect(running.status).toBe('in_progress')
    expect(running.claimedBy).toBe('session-live')
    expect(running.executions[0]!.outcome).toBe('running')
  })
})

// ---------------------------------------------------------------------------
// F1/D2: delete repair (route trash, route purge, agent delete, import merge)
// ---------------------------------------------------------------------------
describe('deleting a prerequisite repairs dependents atomically (F1/D2)', () => {
  it('soft-delete strips the id, bumps dependents and appends the audit comment in ONE mutation', async () => {
    const h = await host()
    await seed(h.store, [
      task({ id: 'a', title: 'Prereq A' }),
      task({ id: 'b', title: 'B', status: 'in_progress', dependsOn: ['a'], version: 3,
        executions: [{ id: 'e-run', trigger: 'manual', startedAt: NOW, outcome: 'running', sessionId: 's-live' }] }),
      task({ id: 'c', title: 'C', dependsOn: ['a'], version: 2 }),
    ])
    const before = h.store.snapshot().revision
    const changes: Array<{ kind: string; tasks: readonly TaskRecord[] }> = []
    const unsubscribe = h.store.subscribe(change => changes.push({ kind: change.kind, tasks: change.tasks }))

    const res = await h.post('/dsh-taskboard/tasks/a/delete', { ifVersion: 1 })
    unsubscribe()
    expect(res.status).toBe(200)
    expect((res.body.value as { trashed: boolean }).trashed).toBe(true)

    // Atomicity: one committed mutation touching the trashed card AND both dependents.
    expect(changes).toHaveLength(1)
    expect(changes[0]!.kind).toBe('task-deleted')
    expect(changes[0]!.tasks.map(t => t.id).sort()).toEqual(['a', 'b', 'c'])
    expect(h.store.snapshot().revision).toBe(before + 1)

    const a = h.store.get('a')!
    expect(a.trashedAt).toBe(NOW)
    const b = h.store.get('b')!
    expect(b.dependsOn).toBeUndefined()
    expect(b.version).toBe(4)
    expect(b.status).toBe('in_progress')
    expect(b.executions[0]!.outcome).toBe('running')
    expect(b.updatedBy).toEqual({ kind: 'system' })
    const comment = b.comments.at(-1)!
    expect(comment.systemKey).toBe('sys.prerequisiteRemoved')
    expect(comment.systemParams).toEqual({ id: 'a', title: 'Prereq A' })
    expect(comment.body).toContain('Prereq A')
    const c = h.store.get('c')!
    expect(c.dependsOn).toBeUndefined()
    expect(c.version).toBe(3)
    expect(dependencyState(c, h.store.snapshot().tasks).ready).toBe(true)
  })

  it('agent taskboard_delete repairs dependents identically', async () => {
    const h = await host()
    const a = await h.tool('taskboard_create').execute({ title: 'Agent A', workspaceId: 'ws-a', urgency: 'normal' }, exec) as { task: { id: string } }
    const b = await h.tool('taskboard_create').execute({ title: 'Agent B', workspaceId: 'ws-a', urgency: 'normal', dependsOn: [a.task.id] }, exec) as { task: { id: string } }
    const changes: Array<{ tasks: readonly TaskRecord[] }> = []
    const unsubscribe = h.store.subscribe(change => changes.push({ tasks: change.tasks }))
    await h.tool('taskboard_delete').execute({ id: a.task.id, ifVersion: 1 }, exec)
    unsubscribe()
    const repaired = h.store.get(b.task.id)!
    expect(repaired.dependsOn).toBeUndefined()
    expect(repaired.version).toBe(2)
    expect(repaired.comments.at(-1)!.systemKey).toBe('sys.prerequisiteRemoved')
    // SSE/change-list coherence: the repaired dependent is in the committed
    // change set, so the GUI cannot keep a stale dependency badge.
    expect(changes).toHaveLength(1)
    expect(changes[0]!.tasks.map(task => task.id).sort()).toEqual([a.task.id, b.task.id].sort())
  })

  it('purge strips a dangling id a legacy ledger still carried', async () => {
    const h = await host()
    await seed(h.store, [
      task({ id: 'gone', title: 'Old prereq', trashedAt: NOW - 1_000 }),
      task({ id: 'dep', title: 'Dependent', dependsOn: ['gone'], version: 5 }),
    ])
    const res = await h.post('/dsh-taskboard/tasks/gone/delete', { purge: true })
    expect(res.status).toBe(200)
    expect(h.store.get('gone')).toBeUndefined()
    const dep = h.store.get('dep')!
    expect(dep.dependsOn).toBeUndefined()
    expect(dep.version).toBe(6)
    expect(dep.comments.at(-1)!.systemParams).toEqual({ id: 'gone', title: 'Old prereq' })
  })

  it('import merge that trashes an existing task repairs untouched dependents (QA finding)', async () => {
    const h = await host()
    const a = await create(h, { title: 'Live A' })
    const b = await create(h, { title: 'Live B', dependsOn: [a] })
    const trashed = { ...h.store.get(a)!, trashedAt: NOW }
    const before = h.store.snapshot().revision

    const res = await h.post('/dsh-taskboard/import', {
      mode: 'merge',
      ledger: { schemaVersion: 1, tasks: [trashed] },
    })
    expect(res.status).toBe(200)
    // One mutation: the merge + the dependent repair commit together.
    expect(h.store.snapshot().revision).toBe(before + 1)
    expect(h.store.get(a)!.trashedAt).toBe(NOW)
    const repaired = h.store.get(b)!
    expect(repaired.dependsOn).toBeUndefined()
    expect(repaired.version).toBe(2)
    expect(repaired.comments.at(-1)!.systemKey).toBe('sys.prerequisiteRemoved')
    expect(repaired.comments.at(-1)!.systemParams).toEqual({ id: a, title: 'Live A' })
    expect(dependencyState(repaired, h.store.snapshot().tasks).ready).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// D7: hierarchy deletion is refused, never cascaded
// ---------------------------------------------------------------------------
describe('hierarchy deletion and purge (D7)', () => {
  it('refuses soft delete and purge while live children exist, then detaches trashed children on purge', async () => {
    const h = await host()
    const parent = await create(h, { title: 'Parent' })
    const child = await create(h, { title: 'Child', parentId: parent })

    expectFailure(await h.post(`/dsh-taskboard/tasks/${parent}/delete`, { ifVersion: 1 }), /has_children/)
    await expect(h.tool('taskboard_delete').execute({ id: parent, ifVersion: 1 }, exec)).rejects.toThrow(/has_children/)

    // Trash the child first: the parent may then be trashed, and purging it
    // detaches the (inert, trashed) child link instead of leaving a dangling id.
    expect((await h.post(`/dsh-taskboard/tasks/${child}/delete`, { ifVersion: 1 })).status).toBe(200)
    expect((await h.post(`/dsh-taskboard/tasks/${parent}/delete`, { ifVersion: 1 })).status).toBe(200)
    expect((await h.post(`/dsh-taskboard/tasks/${parent}/delete`, { purge: true })).status).toBe(200)
    expect(h.store.get(parent)).toBeUndefined()
    const detached = h.store.get(child)!
    expect(detached.parentId).toBeUndefined()
    // v1 create → v2 trash → v3 parent purge detach (same-mutation version bump).
    expect(detached.version).toBe(3)
  })

  it('refuses a merge that trashes a parent with live children and one whose parentId is trashed', async () => {
    const h = await host()
    const parent = await create(h, { title: 'P' })
    await create(h, { title: 'C', parentId: parent })
    const trashedParent = { ...h.store.get(parent)!, trashedAt: NOW }
    expectFailure(await h.post('/dsh-taskboard/import', { mode: 'merge', ledger: { schemaVersion: 1, tasks: [trashedParent] } }), /has_children/)

    await seed(h.store, [task({ id: 'old', title: 'Old', trashedAt: NOW - 1 })])
    const orphan = { ...task({ id: 'orphan', title: 'Orphan' }), parentId: 'old' }
    expectFailure(await h.post('/dsh-taskboard/import', { mode: 'merge', ledger: { schemaVersion: 1, tasks: [orphan] } }), /missing/)
  })
})

// ---------------------------------------------------------------------------
// F7/D5: agents can never reach done
// ---------------------------------------------------------------------------
describe('agent authority (D5)', () => {
  it('an agent can never move a task to done, even when every prerequisite is satisfied', async () => {
    const h = await host()
    const a = await create(h, { title: 'A' })
    await toDone(h, a)
    const b = await create(h, { title: 'B', dependsOn: [a] })
    await expect(h.tool('taskboard_move').execute({ id: b, status: 'done', ifVersion: 1 }, exec))
      .rejects.toThrow(/forbidden/)
    expect(h.store.get(b)!.status).toBe('todo')
  })
})

// ---------------------------------------------------------------------------
// F7/F8: write-entry-point validation
// ---------------------------------------------------------------------------
describe('dependency validation at route and tool entry points', () => {
  it('route update rejects cycle, self, duplicate, cross-workspace, missing and over-limit links', async () => {
    const h = await host()
    const a = await create(h, { title: 'A' })
    const b = await create(h, { title: 'B', dependsOn: [a] })
    const x = await create(h, { title: 'X', workspaceId: 'ws-b' })
    const update = async (id: string, dependsOn: unknown) => h.post(`/dsh-taskboard/tasks/${id}/update`, { ifVersion: h.store.get(id)!.version, dependsOn })

    // B → A already exists; A → B would close the loop.
    expectFailure(await update(a, [b]), /cycle/)
    expectFailure(await update(a, [a]), /self/)
    expectFailure(await update(a, [b, b]), /duplicate/)
    expectFailure(await update(a, [x]), /cross_workspace/)
    expectFailure(await update(a, ['ghost']), /missing/)
    expectFailure(await update(a, Array.from({ length: 33 }, (_, index) => `p${index}`)), /too_many|at most/)
    // Nothing was written.
    expect(h.store.get(a)!.dependsOn).toBeUndefined()
  })

  it('tool update rejects the same malformed graphs', async () => {
    const h = await host()
    const a = await create(h, { title: 'A' })
    const b = await create(h, { title: 'B', dependsOn: [a] })
    const x = await create(h, { title: 'X', workspaceId: 'ws-b' })
    const update = async (id: string, dependsOn: string[]) => h.tool('taskboard_update')
      .execute({ id, ifVersion: h.store.get(id)!.version, dependsOn }, exec)

    await expect(update(a, [b])).rejects.toThrow(/cycle/)
    await expect(update(a, [a])).rejects.toThrow(/self/)
    await expect(update(a, [b, b])).rejects.toThrow(/duplicate/)
    await expect(update(a, [x])).rejects.toThrow(/cross_workspace/)
    await expect(update(a, ['ghost'])).rejects.toThrow(/missing/)
    expect(h.store.get(a)!.dependsOn).toBeUndefined()
  })

  it('import merge/replace reject cyclic, cross-workspace and missing graphs without touching the ledger', async () => {
    const h = await host()
    const y = await create(h, { title: 'Y', workspaceId: 'ws-b' })
    const before = h.store.snapshot().revision

    const cyclic = {
      schemaVersion: 1,
      tasks: [
        { id: 'c1', title: 'C1', workspaceId: 'ws-a', urgency: 'normal', comments: [], executions: [], dependsOn: ['c2'] },
        { id: 'c2', title: 'C2', workspaceId: 'ws-a', urgency: 'normal', comments: [], executions: [], dependsOn: ['c1'] },
      ],
    }
    expectFailure(await h.post('/dsh-taskboard/import', { mode: 'merge', ledger: cyclic }), /cycle/)
    expectFailure(await h.post('/dsh-taskboard/import', { mode: 'replace', ledger: cyclic }), /cycle/)

    const cross = { schemaVersion: 1, tasks: [{ id: 'x1', title: 'X1', workspaceId: 'ws-a', urgency: 'normal', comments: [], executions: [], dependsOn: [y] }] }
    expectFailure(await h.post('/dsh-taskboard/import', { mode: 'merge', ledger: cross }), /cross_workspace/)

    const missing = { schemaVersion: 1, tasks: [{ id: 'm1', title: 'M1', workspaceId: 'ws-a', urgency: 'normal', comments: [], executions: [], dependsOn: ['ghost'] }] }
    expectFailure(await h.post('/dsh-taskboard/import', { mode: 'merge', ledger: missing }), /missing/)

    // Every refusal left the live ledger untouched (atomicity).
    expect(h.store.snapshot().revision).toBe(before)
    expect(h.store.get('c1')).toBeUndefined()
    expect(h.store.get('x1')).toBeUndefined()
    expect(h.store.get('m1')).toBeUndefined()
  })

  it('import drops records with self/duplicate prerequisites instead of committing them', async () => {
    const h = await host()
    const res = await h.post('/dsh-taskboard/import', {
      mode: 'replace',
      ledger: {
        schemaVersion: 1,
        tasks: [
          { id: 'good', title: 'Good', workspaceId: 'ws-a', urgency: 'normal', comments: [], executions: [] },
          { id: 'self', title: 'Self', workspaceId: 'ws-a', urgency: 'normal', comments: [], executions: [], dependsOn: ['self'] },
          { id: 'dup', title: 'Dup', workspaceId: 'ws-a', urgency: 'normal', comments: [], executions: [], dependsOn: ['good', 'good'] },
        ],
      },
    })
    expect(res.status).toBe(200)
    expect(h.store.snapshot().tasks.map(t => t.id)).toEqual(['good'])
  })

  it('merge does not re-validate untouched legacy links (F5)', async () => {
    const h = await host()
    // A legacy ledger with an old cross-workspace edge between two tasks the
    // merge never touches: importing an unrelated task must still succeed.
    await seed(h.store, [
      task({ id: 'legacy-a', title: 'Legacy A', workspaceId: 'ws-a', dependsOn: ['legacy-b'] }),
      task({ id: 'legacy-b', title: 'Legacy B', workspaceId: 'ws-b' }),
    ])
    const res = await h.post('/dsh-taskboard/import', {
      mode: 'merge',
      ledger: { schemaVersion: 1, tasks: [{ id: 'fresh', title: 'Fresh', workspaceId: 'ws-a', urgency: 'normal', comments: [], executions: [] }] },
    })
    expect(res.status).toBe(200)
    expect((res.body.value as { created: number }).created).toBe(1)
    expect(h.store.get('fresh')).toBeDefined()
  })

  it('replace imports the whole graph once and preserves dependsOn/parentId', async () => {
    const h = await host()
    const parent = await create(h, { title: 'Parent' })
    const child = await create(h, { title: 'Child', parentId: parent, dependsOn: [parent] })
    const exported = structuredClone(h.store.snapshot().tasks)
    const res = await h.post('/dsh-taskboard/import', {
      mode: 'replace',
      ledger: { schemaVersion: 1, tasks: exported },
    })
    expect(res.status).toBe(200)
    const imported = h.store.get(child)!
    expect(imported.parentId).toBe(parent)
    expect(imported.dependsOn).toEqual([parent])
  })
})

// ---------------------------------------------------------------------------
// F6: agent observability
// ---------------------------------------------------------------------------
describe('agent observability (F6)', () => {
  it('taskboard_list marks ready vs waiting, with the pending count', async () => {
    const h = await host()
    const a = await create(h, { title: 'A' })
    const b = await create(h, { title: 'B', dependsOn: [a] })
    const text = (listed: unknown) => h.tool('taskboard_list').output.render({}, listed)[0]!.text
    const blockedList = text(await h.tool('taskboard_list').execute({}, exec))
    expect(blockedList).toContain('·等待前置1项')
    expect(blockedList).not.toContain('·可执行')

    await toDone(h, a)
    const readyList = text(await h.tool('taskboard_list').execute({}, exec))
    const bLine = readyList.split('\n').find(line => line.includes(b))!
    expect(bLine).toContain('·可执行')
  })

  it('taskboard_get lists per-prerequisite state and the tasks an acceptance unblocks', async () => {
    const h = await host()
    const a = await create(h, { title: 'Prereq A' })
    const b = await create(h, { title: 'Dependent B', dependsOn: [a] })
    const d = await create(h, { title: 'Downstream D', dependsOn: [b] })
    await h.store.mutate('task-updated', ledger => {
      const target = ledger.tasks.find(t => t.id === b)!
      target.dependsOn = [a, 'ghost']
      return [target]
    })

    const detail = await h.tool('taskboard_get').execute({ id: b }, exec) as {
      task: { prerequisites: Array<{ id: string; state: string; title?: string; status?: string }>; completionUnblocks: Array<{ id: string; title: string }> }
    }
    const byId = new Map(detail.task.prerequisites.map(item => [item.id, item]))
    expect(byId.get(a)!.state).toBe('pending')
    expect(byId.get(a)!.title).toBe('Prereq A')
    expect(byId.get('ghost')!.state).toBe('missing')
    expect(detail.task.completionUnblocks.map(item => item.id)).toEqual([d])

    const text = h.tool('taskboard_get').output.render({}, detail)[0]!.text
    expect(text).toContain('前置未满足')
    expect(text).toContain('Prereq A')
    expect(text).toContain('missing 缺失')
    expect(text).toContain('完成后可解锁 1 个下游任务')
    expect(text).toContain('Downstream D')

    await toDone(h, a)
    const doneDetail = await h.tool('taskboard_get').execute({ id: b }, exec) as { task: { prerequisites: Array<{ id: string; state: string }> } }
    expect(doneDetail.task.prerequisites.find(item => item.id === a)!.state).toBe('done')
  })
})

// ---------------------------------------------------------------------------
// P1: hierarchy host integration
// ---------------------------------------------------------------------------
describe('hierarchy integration (P1)', () => {
  it('create/update accept parentId; null detaches; invalid links are refused', async () => {
    const h = await host()
    const parent = await create(h, { title: 'Parent' })
    const child = await create(h, { title: 'Child', parentId: parent })
    expect(h.store.get(child)!.parentId).toBe(parent)

    // null detaches.
    expect((await h.post(`/dsh-taskboard/tasks/${child}/update`, { ifVersion: 1, parentId: null })).status).toBe(200)
    expect(h.store.get(child)!.parentId).toBeUndefined()
    // Re-attach with the fresh version.
    expect((await h.post(`/dsh-taskboard/tasks/${child}/update`, { ifVersion: 2, parentId: parent })).status).toBe(200)

    // Refusals: self, missing, cross-workspace, cycle.
    expectFailure(await h.post(`/dsh-taskboard/tasks/${child}/update`, { ifVersion: 3, parentId: child }), /self/)
    expectFailure(await h.post(`/dsh-taskboard/tasks/${child}/update`, { ifVersion: 3, parentId: 'ghost' }), /missing/)
    const other = await create(h, { title: 'Other workspace parent', workspaceId: 'ws-b' })
    expectFailure(await h.post(`/dsh-taskboard/tasks/${child}/update`, { ifVersion: 3, parentId: other }), /cross_workspace/)
    // parent → child already exists; making the parent a child of `child` closes the loop.
    expectFailure(await h.post(`/dsh-taskboard/tasks/${parent}/update`, { ifVersion: 1, parentId: child }), /cycle/)
    // Duplicate-on-create: a copied cross-workspace parentId is re-validated.
    expectFailure(await h.post('/dsh-taskboard/tasks', { title: 'Copy', workspaceId: 'ws-a', urgency: 'normal', parentId: other }), /cross_workspace/)
  })

  it('enforces the depth cap and refuses workspace rebinds that cross parent/child links', async () => {
    const h = await host()
    let current = await create(h, { title: 'depth-1' })
    for (let depth = 2; depth <= 8; depth++) current = await create(h, { title: `depth-${depth}`, parentId: current })
    // 9th level would exceed MAX_TASK_DEPTH.
    expectFailure(await h.post('/dsh-taskboard/tasks', { title: 'depth-9', workspaceId: 'ws-a', urgency: 'normal', parentId: current }), /depth/)

    const parent = await create(h, { title: 'Rebind parent' })
    await create(h, { title: 'Rebind child', parentId: parent })
    expectFailure(await h.post(`/dsh-taskboard/tasks/${parent}/update`, { ifVersion: 1, workspaceId: 'ws-b' }), /cross_workspace/)
    expect(h.store.get(parent)!.workspaceId).toBe('ws-a')
  })

  it('agent tools accept parentId on create, reparent on update and detach with null', async () => {
    const h = await host()
    const parent = await h.tool('taskboard_create').execute({ title: 'P', workspaceId: 'ws-a', urgency: 'normal' }, exec) as { task: { id: string } }
    const child = await h.tool('taskboard_create').execute({ title: 'C', workspaceId: 'ws-a', urgency: 'normal', parentId: parent.task.id }, exec) as { task: { id: string } }
    expect(h.store.get(child.task.id)!.parentId).toBe(parent.task.id)

    await h.tool('taskboard_update').execute({ id: child.task.id, ifVersion: 1, parentId: null }, exec)
    expect(h.store.get(child.task.id)!.parentId).toBeUndefined()
    await h.tool('taskboard_update').execute({ id: child.task.id, ifVersion: 2, parentId: parent.task.id }, exec)
    expect(h.store.get(child.task.id)!.parentId).toBe(parent.task.id)
    await expect(h.tool('taskboard_update').execute({ id: child.task.id, ifVersion: 3, parentId: child.task.id }, exec)).rejects.toThrow(/self/)
  })

  it('GET /state derives subtaskProgress only for parents, with one index per request', async () => {
    const h = await host()
    const parent = await create(h, { title: 'Parent' })
    const childDone = await create(h, { title: 'Child done', parentId: parent })
    const childOpen = await create(h, { title: 'Child open', parentId: parent })
    expect((await h.post(`/dsh-taskboard/tasks/${childOpen}/update`, { ifVersion: 1, blocked: true })).status).toBe(200)
    const lone = await create(h, { title: 'Lone' })
    await toDone(h, childDone)

    const state = await h.get('/dsh-taskboard/state')
    expect(state.status).toBe(200)
    const tasks = (state.body.value as { tasks: Array<TaskRecord & { subtaskProgress?: { total: number; done: number; open: number; blocked: number; missing: number } }> }).tasks
    const parentState = tasks.find(item => item.id === parent)!
    expect(parentState.subtaskProgress).toEqual({ total: 2, done: 1, open: 1, blocked: 1, missing: 0 })
    expect(tasks.find(item => item.id === lone)!.subtaskProgress).toBeUndefined()
    expect(tasks.find(item => item.id === childDone)!.subtaskProgress).toBeUndefined()

    // The agent detail projection shows the open count too (D6).
    const detailText = h.tool('taskboard_get').output.render({}, await h.tool('taskboard_get').execute({ id: parent }, exec))[0]!.text
    expect(detailText).toContain('子任务进度: 完成 1/2')
  })

  it('GET /task-index returns untrashed tasks of one workspace with their links', async () => {
    const h = await host()
    const a = await create(h, { title: 'A' })
    const b = await create(h, { title: 'B', dependsOn: [a] })
    const parent = await create(h, { title: 'P' })
    const child = await create(h, { title: 'C', parentId: parent })
    const other = await create(h, { title: 'Other ws', workspaceId: 'ws-b' })
    const trashed = await create(h, { title: 'Trashed' })
    expect((await h.post(`/dsh-taskboard/tasks/${trashed}/delete`, { ifVersion: 1 })).status).toBe(200)

    const res = await h.get('/dsh-taskboard/task-index?workspaceId=ws-a')
    expect(res.status).toBe(200)
    const tasks = (res.body.value as { tasks: Array<Record<string, unknown>> }).tasks
    const ids = tasks.map(item => item.id)
    expect(ids).toEqual([a, b, parent, child])
    expect(ids).not.toContain(other)
    expect(ids).not.toContain(trashed)
    const childEntry = tasks.find(item => item.id === child)!
    expect(childEntry.parentId).toBe(parent)
    expect(childEntry.workspaceId).toBe('ws-a')
    expect(tasks.find(item => item.id === b)!.dependsOn).toEqual([a])
    // Read-only projection: no derived progress, no comments/prompt payload.
    expect(childEntry.dependencyProgress).toBeUndefined()
    expect(childEntry.subtaskProgress).toBeUndefined()
    expect(childEntry.prompt).toBeUndefined()

    expectFailure(await h.get('/dsh-taskboard/task-index?workspaceId=ghost'), /workspace/)
    expectFailure(await h.get('/dsh-taskboard/task-index'), /workspace/)
  })
})

// ---------------------------------------------------------------------------
// F8 availability: load repairs invalid optional links, never refuses the board
// ---------------------------------------------------------------------------
describe('ledger load repairs invalid optional links (F8 availability)', () => {
  it('drops a hand-edited self-loop / duplicate link instead of refusing the board', async () => {
    storeSeq += 1
    const file = join(dir, `hand-edited-${storeSeq}.json`)
    await writeFile(file, JSON.stringify({
      schemaVersion: 1,
      revision: 1,
      tasks: [
        task({ id: 'self-loop', dependsOn: ['self-loop'] }),
        task({ id: 'dupes', dependsOn: ['ghost', 'ghost'] }),
        task({ id: 'self-parent', parentId: 'self-parent' }),
      ],
    }, null, 2))
    const store = new TaskStore({ file })
    await expect(store.load()).resolves.toBeUndefined()
    expect(store.loadError()).toBeUndefined()
    expect(store.get('self-loop')!.dependsOn).toBeUndefined()
    // Duplicate ids are dropped; a well-formed but dangling id stays (D2:
    // legacy dangling links keep blocking, they are not silently erased).
    expect(store.get('dupes')!.dependsOn).toEqual(['ghost'])
    expect(store.get('self-parent')!.parentId).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// Import round-trip of a NORMAL board whose trashed records carry stale links
// ---------------------------------------------------------------------------
describe('import round-trips trashed records with stale links (availability)', () => {
  it('replace and merge accept an exported board where a trashed dependent still references its trashed prerequisite', async () => {
    const h = await host()
    const a = await create(h, { title: 'Prereq A' })
    const b = await create(h, { title: 'Dependent B', dependsOn: [a] })
    // Trash the dependent first (its own link is intentionally left stale),
    // then the prerequisite (the repair invariant only touches untrashed
    // dependents), which is exactly what a normal board export contains.
    expect((await h.post(`/dsh-taskboard/tasks/${b}/delete`, { ifVersion: 1 })).status).toBe(200)
    expect((await h.post(`/dsh-taskboard/tasks/${a}/delete`, { ifVersion: 1 })).status).toBe(200)
    expect(h.store.get(b)!.trashedAt).toBeDefined()
    expect(h.store.get(b)!.dependsOn).toEqual([a])

    const exported = structuredClone(h.store.snapshot().tasks)
    const replaced = await h.post('/dsh-taskboard/import', { mode: 'replace', ledger: { schemaVersion: 1, tasks: exported } })
    expect(replaced.status).toBe(200)
    expect(h.store.get(b)!.dependsOn).toEqual([a])
    expect(h.store.get(b)!.trashedAt).toBeDefined()

    const merged = await h.post('/dsh-taskboard/import', { mode: 'merge', ledger: { schemaVersion: 1, tasks: exported } })
    expect(merged.status).toBe(200)
    expect(h.store.get(b)!.dependsOn).toEqual([a])
  })

  it('replace accepts a trashed subtask under a trashed parent, but a LIVE child under a trashed parent is still refused', async () => {
    const h = await host()
    const parent = await create(h, { title: 'Parent' })
    const child = await create(h, { title: 'Child', parentId: parent })
    expect((await h.post(`/dsh-taskboard/tasks/${child}/delete`, { ifVersion: 1 })).status).toBe(200)
    expect((await h.post(`/dsh-taskboard/tasks/${parent}/delete`, { ifVersion: 1 })).status).toBe(200)
    const exported = structuredClone(h.store.snapshot().tasks)
    expect((await h.post('/dsh-taskboard/import', { mode: 'replace', ledger: { schemaVersion: 1, tasks: exported } })).status).toBe(200)
    expect(h.store.get(child)!.parentId).toBe(parent)

    // Hand-built board: trashed parent + LIVE child → has_children (D7).
    const bad = {
      schemaVersion: 1,
      tasks: [
        task({ id: 'trashed-parent', title: 'TP', trashedAt: NOW }),
        task({ id: 'live-child', title: 'LC', parentId: 'trashed-parent' }),
      ],
    }
    expectFailure(await h.post('/dsh-taskboard/import', { mode: 'replace', ledger: bad }), /has_children/)
    expectFailure(await h.post('/dsh-taskboard/import', { mode: 'merge', ledger: bad }), /has_children/)
  })
})

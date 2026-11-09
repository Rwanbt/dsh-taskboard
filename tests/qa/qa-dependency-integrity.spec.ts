/**
 * QA (Agent D) — ledger integrity, import atomicity, restart round-trips,
 * concurrency and bounded-time checks for the dependency feature.
 *
 * These tests are intentionally adversarial: they assert the §7 acceptance
 * criteria of docs/fork-audit.md from the OUTSIDE (real routes over HTTP,
 * real store on disk), not the implementers' internal expectations.
 *
 * @module dsh-taskboard/tests/qa/dependency-integrity
 */
import { afterEach, describe, expect, it } from 'vitest'
import { validateDependencies, dependencyState } from '../../src/shared/dependencies.ts'
import type { TaskLedger, TaskRecord } from '../../src/shared/protocol.ts'
import { waitFor } from '../wait-for.ts'
import { createQaHost, QA_WS, QA_WS2, T0, taskRecord, type QaHost } from './harness.ts'

const hosts: QaHost[] = []
afterEach(async () => {
  while (hosts.length > 0) await hosts.pop()!.dispose()
})

async function host(): Promise<QaHost> {
  const h = await createQaHost()
  hosts.push(h)
  return h
}

/** POST /tasks helper returning the created id. */
async function createTask(h: QaHost, title: string, extra: Record<string, unknown> = {}): Promise<string> {
  const res = await h.post('/dsh-taskboard/tasks', { title, workspaceId: QA_WS.id, urgency: 'normal', ...extra })
  expect(res.status).toBe(201)
  return res.json.value.id as string
}

/** Move a task and assert the envelope status. */
async function move(h: QaHost, id: string, status: string): Promise<{ status: number; json: any }> {
  const task = h.store.get(id)!
  return h.post(`/dsh-taskboard/tasks/${id}/move`, { ifVersion: task.version, status })
}

/** A ledger document shaped for POST /import. */
function ledgerOf(tasks: unknown[]): TaskLedger {
  return { schemaVersion: 1, revision: 1, tasks } as unknown as TaskLedger
}

describe('QA — prerequisite gate on the user routes', () => {
  it('blocks move→in_progress until the prerequisite is user-approved done (D1)', async () => {
    const h = await host()
    const a = await createTask(h, 'A')
    const b = await createTask(h, 'B', { dependsOn: [a] })

    const blocked = await move(h, b, 'in_progress')
    expect(blocked.status).toBeGreaterThanOrEqual(400)
    expect(String(blocked.json?.error?.message ?? '')).toMatch(/dependen/i)
    expect(h.store.get(b)!.status).toBe('todo')

    // in_review must NOT satisfy the prerequisite.
    expect((await move(h, a, 'in_progress')).status).toBe(200)
    expect((await move(h, a, 'in_review')).status).toBe(200)
    expect((await move(h, b, 'in_progress')).status).toBeGreaterThanOrEqual(400)
    expect(h.store.get(b)!.status).toBe('todo')

    // done (human) satisfies it.
    const done = await move(h, a, 'done')
    expect(done.status).toBe(200)
    expect((await move(h, b, 'in_progress')).status).toBe(200)
    expect(h.store.get(b)!.status).toBe('in_progress')
  })

  it('exposes derived dependencyProgress in GET /state (never persisted)', async () => {
    const h = await host()
    const a = await createTask(h, 'A')
    const b = await createTask(h, 'B', { dependsOn: [a] })
    const state = await h.get('/dsh-taskboard/state')
    expect(state.status).toBe(200)
    const view = state.json.value.tasks.find((t: { id: string }) => t.id === b)
    expect(view.dependencyProgress).toMatchObject({ total: 1, completed: 0, ready: false, pendingIds: [a] })
    // Derived field must not be written to disk.
    const raw = h.store.get(b)!
    expect((raw as unknown as Record<string, unknown>).dependencyProgress).toBeUndefined()
  })

  it('reopening a done prerequisite re-blocks NEW runs but does not kill a running execution', async () => {
    const h = await host()
    const a = await createTask(h, 'A')
    const b = await createTask(h, 'B', { dependsOn: [a] })
    await move(h, a, 'in_progress')
    await move(h, a, 'in_review')
    await move(h, a, 'done')

    // Start B (manual run opens a real execution through the production service).
    const started = await h.post(`/dsh-taskboard/tasks/${b}/run`, {})
    expect(started.status).toBe(202)
    expect(h.store.get(b)!.executions.filter(e => e.outcome === 'running')).toHaveLength(1)

    // Reopen A while B is running.
    const reopened = await move(h, a, 'todo')
    expect(reopened.status).toBe(200)

    // The running execution is NOT killed by the reopen.
    expect(h.store.get(b)!.executions.filter(e => e.outcome === 'running')).toHaveLength(1)

    // A NEW run is refused.
    const rerun = await h.post(`/dsh-taskboard/tasks/${b}/run`, {})
    expect(rerun.status).toBeGreaterThanOrEqual(400)
    expect(String(rerun.json?.error?.message ?? '')).toMatch(/dependen/i)

    // §7.3 full criterion: the in-flight run settles normally (in_progress ->
    // in_review auto-handoff), the ledger stays coherent, and the dependent
    // still cannot start again afterwards.
    h.agents.idle()
    await waitFor(() => h.store.get(b)!.executions.some(e => e.outcome === 'succeeded'))
    const settled = h.store.get(b)!
    expect(settled.status).toBe('in_review')
    expect(settled.executions.filter(e => e.outcome === 'running')).toHaveLength(0)
    expect(settled.executions).toHaveLength(1)
    expect(h.store.get(a)!.status).toBe('todo')
    const afterSettle = await h.post(`/dsh-taskboard/tasks/${b}/run`, {})
    expect(afterSettle.status).toBeGreaterThanOrEqual(400)
    expect(String(afterSettle.json?.error?.message ?? '')).toMatch(/dependen/i)
    const moveAfterSettle = await move(h, b, 'in_progress')
    expect(moveAfterSettle.status).toBeGreaterThanOrEqual(400)
  })
})

describe('QA — deletion coherence (F1 / D2)', () => {
  it('soft-delete of a prerequisite repairs dependents atomically and appends the audit comment', async () => {
    const h = await host()
    const a = await createTask(h, 'A')
    const b = await createTask(h, 'B', { dependsOn: [a] })
    const before = h.store.get(b)!

    const trashed = await h.post(`/dsh-taskboard/tasks/${a}/delete`, { ifVersion: h.store.get(a)!.version })
    expect(trashed.status).toBe(200)

    const after = h.store.get(b)!
    // No dangling reference may survive a trash.
    expect(after.dependsOn ?? []).not.toContain(a)
    // The dependent is unblocked AND its version bumped (so a stale UI write fails).
    expect(after.version).toBeGreaterThan(before.version)
    // The audit trail is present on the dependent.
    const comment = after.comments.find(c => c.systemKey === 'sys.prerequisiteRemoved')
    expect(comment).toBeDefined()
    expect(comment!.systemParams?.id).toBe(a)
    // dependencyProgress recomputed: nothing pending.
    const state = await h.get('/dsh-taskboard/state')
    const view = state.json.value.tasks.find((t: { id: string }) => t.id === b)
    expect(view.dependencyProgress?.ready ?? true).toBe(true)
  })

  it('hard purge of a trashed prerequisite leaves no dangling reference', async () => {
    const h = await host()
    const a = await createTask(h, 'A')
    const b = await createTask(h, 'B', { dependsOn: [a] })
    await h.post(`/dsh-taskboard/tasks/${a}/delete`, { ifVersion: h.store.get(a)!.version })
    const purged = await h.post(`/dsh-taskboard/tasks/${a}/delete`, { purge: true })
    expect(purged.status).toBe(200)
    expect(h.store.get(a)).toBeUndefined()
    expect(h.store.get(b)!.dependsOn ?? []).not.toContain(a)
  })

  it('refuses to trash a task that still has live dependents? (decision D2: repair, not refuse)', async () => {
    // D2 explicitly chooses repair-at-source for prerequisites; this control
    // asserts the dependent is still usable afterwards (not silently blocked).
    const h = await host()
    const a = await createTask(h, 'A')
    const b = await createTask(h, 'B', { dependsOn: [a] })
    await h.post(`/dsh-taskboard/tasks/${a}/delete`, { ifVersion: h.store.get(a)!.version })
    const start = await move(h, b, 'in_progress')
    expect(start.status).toBe(200)
  })
})

describe('QA — import atomicity and cycles', () => {
  it('rejects a cyclic ledger on import replace and leaves the live ledger untouched', async () => {
    const h = await host()
    const keep = await createTask(h, 'keep me')
    const cyclic = ledgerOf([
      taskRecord({ id: 'cyc-a', dependsOn: ['cyc-b'] }),
      taskRecord({ id: 'cyc-b', dependsOn: ['cyc-a'] }),
    ])
    const res = await h.post('/dsh-taskboard/import', { mode: 'replace', ledger: cyclic })
    expect(res.status).toBeGreaterThanOrEqual(400)
    expect(String(res.json?.error?.message ?? '')).toMatch(/cycle/i)
    // Atomicity: nothing from the rejected import landed.
    expect(h.store.get(keep)).toBeDefined()
    expect(h.store.get('cyc-a')).toBeUndefined()
    expect(h.store.get('cyc-b')).toBeUndefined()
    expect(h.store.snapshot().tasks).toHaveLength(1)
  })

  it('rejects a cyclic ledger on import merge and leaves the live ledger untouched', async () => {
    const h = await host()
    const keep = await createTask(h, 'keep me')
    const res = await h.post('/dsh-taskboard/import', {
      mode: 'merge',
      ledger: ledgerOf([
        taskRecord({ id: 'cyc-a', dependsOn: ['cyc-b'] }),
        taskRecord({ id: 'cyc-b', dependsOn: ['cyc-a'] }),
      ]),
    })
    expect(res.status).toBeGreaterThanOrEqual(400)
    expect(h.store.get(keep)).toBeDefined()
    expect(h.store.get('cyc-a')).toBeUndefined()
  })

  it('rejects self / duplicate / cross-workspace / missing prerequisites at the import boundary', async () => {
    const h = await host()
    const cases: Array<[string, TaskRecord]> = [
      ['self', taskRecord({ id: 'bad-self', dependsOn: ['bad-self'] })],
      ['duplicate', taskRecord({ id: 'bad-dup', dependsOn: ['other', 'other'] })],
      ['missing', taskRecord({ id: 'bad-missing', dependsOn: ['does-not-exist'] })],
      ['cross-workspace', taskRecord({ id: 'bad-cross', dependsOn: ['other-ws'] })],
    ]
    const other = taskRecord({ id: 'other-ws', workspaceId: 'ws-other' })
    for (const [label, bad] of cases) {
      const res = await h.post('/dsh-taskboard/import', {
        mode: 'replace',
        ledger: ledgerOf([bad, ...(label === 'cross-workspace' ? [other] : [])]),
      })
      expect(res.status, `case ${label}`).toBeGreaterThanOrEqual(400)
      expect(h.store.get(bad.id), `case ${label}`).toBeUndefined()
    }
  })

  it('accepts a legal import and preserves dependsOn across export → import → restart', async () => {
    const h = await host()
    const a = await createTask(h, 'A')
    const b = await createTask(h, 'B', { dependsOn: [a] })

    // Export: GET /state is the export surface (ledger + derived fields).
    const state = await h.get('/dsh-taskboard/state')
    const exported = state.json.value
    const stripDerived = (tasks: Array<Record<string, unknown>>): Array<Record<string, unknown>> =>
      tasks.map(({ dependencyProgress: _p, subtaskProgress: _s, ...rest }) => rest)
    const document = ledgerOf(stripDerived(exported.tasks))

    // Import replace into a SECOND isolated host (the "other machine").
    const h2 = await host()
    const imported = await h2.post('/dsh-taskboard/import', { mode: 'replace', ledger: document })
    expect(imported.status).toBe(200)
    expect(h2.store.get(b)!.dependsOn).toEqual([a])

    // Restart: a brand-new store over the same file must reload the field.
    const restarted = new (await import('../../src/host/store.ts')).TaskStore({ file: h2.store.location() })
    await restarted.load()
    expect(restarted.get(b)!.dependsOn).toEqual([a])
    // And the gate is still enforced after the restart.
    expect((await move(h2, b, 'in_progress')).status).toBeGreaterThanOrEqual(400)
  })

  it('a legacy ledger without dependsOn/parentId loads and behaves unchanged (D10)', async () => {
    const h = await host()
    const legacy: TaskRecord = taskRecord({ id: 'legacy-1', status: 'done' })
    // Simulate a pre-feature file: no dependsOn, no parentId keys at all.
    const file = h.store.location()
    const { writeFile } = await import('node:fs/promises')
    await writeFile(file, JSON.stringify({ schemaVersion: 1, revision: 7, tasks: [legacy] }, null, 2))
    const restarted = new (await import('../../src/host/store.ts')).TaskStore({ file })
    await restarted.load()
    expect(restarted.get('legacy-1')!.status).toBe('done')
    expect(restarted.get('legacy-1')!.dependsOn).toBeUndefined()
    expect((restarted.get('legacy-1') as unknown as Record<string, unknown>).parentId).toBeUndefined()
  })

  it('a hand-edited ledger carrying a self-loop or duplicate dependsOn is either refused or repaired at load (F8)', async () => {
    const h = await host()
    const { writeFile } = await import('node:fs/promises')
    const { TaskStore } = await import('../../src/host/store.ts')
    const cases: Array<[string, TaskRecord]> = [
      ['self-loop', taskRecord({ id: 'self-loop', dependsOn: ['self-loop'] })],
      ['duplicate', taskRecord({ id: 'dup', dependsOn: ['x', 'x'] })],
    ]
    for (const [label, bad] of cases) {
      const file = `${h.store.location()}.${label}.json`
      await writeFile(file, JSON.stringify({ schemaVersion: 1, revision: 1, tasks: [bad] }, null, 2))
      const store = new TaskStore({ file })
      let refused = false
      try { await store.load() } catch { refused = true }
      if (refused) {
        // Refusing the whole ledger is acceptable: it must stay explicit.
        expect(store.loadError(), label).toBeDefined()
        continue
      }
      // Otherwise the corrupt link content must have been REPAIRED on load —
      // never silently ingested (a self-loop would block the task forever).
      const loaded = store.get(bad.id)!
      expect(loaded, label).toBeDefined()
      const ids = loaded.dependsOn ?? []
      expect(ids, `${label}: self reference survived load`).not.toContain(bad.id)
      expect(new Set(ids).size, `${label}: duplicate id survived load`).toBe(ids.length)
      expect(ids, `${label}: duplicate links survived load`).toEqual([...new Set(ids)])
    }
  })

  it('import MERGE cannot silently strand an existing dependent by overwriting its prerequisite as trashed', async () => {
    // Import replace rejects a dangling link (validateDependencies 'missing').
    // Merge only validates the INCOMING records, so an incoming copy of a live
    // prerequisite marked trashed can leave existing dependents pointing at a
    // trashed record — blocked as 'missing' with no D2 audit trace.
    const h = await host()
    const a = await createTask(h, 'A')
    const b = await createTask(h, 'B', { dependsOn: [a] })
    const trashedCopy: TaskRecord = { ...h.store.get(a)!, trashedAt: T0 + 1 }
    const res = await h.post('/dsh-taskboard/import', { mode: 'merge', ledger: ledgerOf([trashedCopy]) })
    const after = h.store.get(b)!
    const dangling = (after.dependsOn ?? []).includes(a)
    const state = await h.get('/dsh-taskboard/state')
    const view = state.json.value.tasks.find((t: { id: string }) => t.id === b)
    // Integrity contract: a live dependent must never be left pointing at a
    // trashed prerequisite without the D2 repair/audit.
    expect(res.status, 'merge accepted the trashed overwrite').toBe(200)
    expect(dangling, 'dangling dependsOn after merge-trash').toBe(false)
    // After a correct repair the dependent has no prerequisites left, so the
    // derived projection may be absent — either way it must report no missing.
    expect(view.dependencyProgress?.missingIds ?? [], 'dependencyProgress still reports missing').toEqual([])
    expect(after.comments.some(c => c.systemKey === 'sys.prerequisiteRemoved')).toBe(true)
  })

  it('import MERGE trashing a prerequisite in the SAME batch repairs BOTH existing and incoming dependents (final-ledger sweep)', async () => {
    // Ordering hazard: the repair must be decided on the FINAL merged ledger,
    // not on the incoming records only. Here the trashed prerequisite A, the
    // existing dependent B, and a brand-new dependent C all appear in one merge
    // batch. Accepting the batch must leave BOTH dependents repaired; refusing
    // the batch (400) is also coherent, but it must commit NOTHING.
    const h = await host()
    const a = await createTask(h, 'A')
    const b = await createTask(h, 'B', { dependsOn: [a] })
    const trashedCopy: TaskRecord = { ...h.store.get(a)!, trashedAt: T0 + 1 }
    const incomingDependent = taskRecord({ id: 'merge-c', title: 'C', dependsOn: [a] })
    const res = await h.post('/dsh-taskboard/import', { mode: 'merge', ledger: ledgerOf([trashedCopy, incomingDependent]) })
    if (res.status >= 400) {
      // Atomic refusal: nothing from the batch may have landed.
      expect(h.store.get(a)!.trashedAt).toBeUndefined()
      expect(h.store.get(b)!.dependsOn).toEqual([a])
      expect(h.store.get('merge-c')).toBeUndefined()
    } else {
      expect(res.status).toBe(200)
      for (const id of [b, 'merge-c']) {
        const task = h.store.get(id)!
        expect(task.dependsOn ?? [], `${id} still references the trashed prerequisite`).not.toContain(a)
        expect(task.comments.some(c => c.systemKey === 'sys.prerequisiteRemoved'), `${id} lacks the audit comment`).toBe(true)
      }
    }
    // Ledger-wide invariant in BOTH outcomes: no live task references a
    // trashed/absent id.
    for (const task of h.store.snapshot().tasks) {
      if (task.trashedAt !== undefined) continue
      for (const dep of task.dependsOn ?? []) {
        const target = h.store.get(dep)
        expect(target === undefined || target.trashedAt !== undefined, `${task.id} -> ${dep} is dangling`).toBe(false)
      }
    }
  })
})

describe('QA — concurrent stale writes (version guard)', () => {
  it('two overlapping updates with the same ifVersion: exactly one wins, nothing is lost', async () => {
    const h = await host()
    const id = await createTask(h, 'race')
    const [first, second] = await Promise.all([
      h.post(`/dsh-taskboard/tasks/${id}/update`, { ifVersion: 1, title: 'winner-1' }),
      h.post(`/dsh-taskboard/tasks/${id}/update`, { ifVersion: 1, title: 'winner-2' }),
    ])
    const statuses = [first.status, second.status].sort()
    expect(statuses[0]).toBe(200)
    expect(statuses[1]).toBeGreaterThanOrEqual(400)
    const final = h.store.get(id)!
    expect(final.version).toBe(2)
    expect(['winner-1', 'winner-2']).toContain(final.title)
  })

  it('a stale dependsOn write cannot clobber a concurrent comment bump', async () => {
    const h = await host()
    const a = await createTask(h, 'A')
    const b = await createTask(h, 'B', { dependsOn: [a] })
    // Comment bumps b to v2 while the dependency update still holds v1.
    await h.post(`/dsh-taskboard/tasks/${b}/comment`, { body: 'concurrent comment' })
    const stale = await h.post(`/dsh-taskboard/tasks/${b}/update`, { ifVersion: 1, dependsOn: [] })
    expect(stale.status).toBeGreaterThanOrEqual(400)
    expect(h.store.get(b)!.dependsOn).toEqual([a])
    expect(h.store.get(b)!.comments.some(c => c.body === 'concurrent comment')).toBe(true)
  })

  it('two overlapping run() calls open exactly ONE execution', async () => {
    const h = await host()
    const id = await createTask(h, 'double click')
    const [r1, r2] = await Promise.all([
      h.post(`/dsh-taskboard/tasks/${id}/run`, {}),
      h.post(`/dsh-taskboard/tasks/${id}/run`, {}),
    ])
    const statuses = [r1.status, r2.status].sort()
    expect(statuses).toEqual([202, 400])
    expect(h.store.get(id)!.executions.filter(e => e.outcome === 'running')).toHaveLength(1)
    h.agents.idle()
    await new Promise(resolve => setTimeout(resolve, 50))
  })

  it('concurrent trash of a prerequisite vs claim of its dependent: one coherent outcome, no dangling live link', async () => {
    const h = await host()
    const a = await createTask(h, 'A')
    const b = await createTask(h, 'B', { dependsOn: [a] })
    // A done so B is claimable; the race is trash(A) || claim(B).
    expect((await move(h, a, 'in_progress')).status).toBe(200)
    expect((await move(h, a, 'in_review')).status).toBe(200)
    expect((await move(h, a, 'done')).status).toBe(200)
    const aVersion = h.store.get(a)!.version
    const bVersion = h.store.get(b)!.version
    const [trash, claim] = await Promise.all([
      h.post(`/dsh-taskboard/tasks/${a}/delete`, { ifVersion: aVersion }),
      h.post(`/dsh-taskboard/tasks/${b}/move`, { ifVersion: bVersion, status: 'in_progress' }),
    ])
    // Trash of a done prerequisite is legal and must win or lose atomically;
    // the claim may succeed (before the repair) or be refused on a stale
    // version/dependency — both are coherent. Never both inconsistent.
    expect(trash.status).toBe(200)
    const bAfter = h.store.get(b)!
    const aAfter = h.store.get(a)!
    expect(aAfter.trashedAt).toBeDefined()
    // B may be in_progress (claimed before repair) or todo (claim refused).
    expect(['in_progress', 'todo']).toContain(bAfter.status)
    expect(claim.status === 200 || claim.status >= 400).toBe(true)
    // Ledger-wide invariant: no LIVE task may reference the trashed id.
    expect(bAfter.dependsOn ?? []).not.toContain(a)
    for (const task of h.store.snapshot().tasks) {
      if (task.trashedAt !== undefined) continue
      for (const dep of task.dependsOn ?? []) {
        const target = h.store.get(dep)
        expect(target === undefined || target.trashedAt !== undefined, `${task.id} -> ${dep} is dangling`).toBe(false)
      }
    }
  })
})

describe('QA — bounded time at scale', () => {
  it('1000-task board: GET /state stays bounded and derives progress for every task', async () => {
    const h = await host()
    const tasks: TaskRecord[] = []
    for (let i = 0; i < 1000; i++) {
      tasks.push(taskRecord({
        id: `scale-${String(i).padStart(4, '0')}`,
        status: i % 5 === 0 ? 'done' : 'todo',
        ...(i > 0 ? { dependsOn: [`scale-${String(i - 1).padStart(4, '0')}`] } : {}),
      }))
    }
    const started = performance.now()
    const imported = await h.post('/dsh-taskboard/import', { mode: 'replace', ledger: ledgerOf(tasks) })
    expect(imported.status).toBe(200)
    const importMs = performance.now() - started
    expect(importMs).toBeLessThan(10_000)

    const stateStarted = performance.now()
    const state = await h.get('/dsh-taskboard/state')
    const stateMs = performance.now() - stateStarted
    expect(state.status).toBe(200)
    expect(state.json.value.tasks).toHaveLength(1000)
    // Documented QA threshold: a 1000-task board must answer in well under 3s
    // on the CI-class box (measured ~O(n) with the per-request index).
    expect(stateMs, `GET /state took ${stateMs.toFixed(1)}ms for 1000 tasks`).toBeLessThan(3_000)
    const withDeps = state.json.value.tasks.filter((t: { dependsOn?: string[] }) => t.dependsOn?.length)
    expect(withDeps).toHaveLength(999)
    for (const view of withDeps) expect(view.dependencyProgress).toBeDefined()
  }, 30_000)

  it('500-task deep DAG: validation and readiness stay bounded (no O(n²) blow-up, no hang)', async () => {
    const tasks: TaskRecord[] = []
    for (let i = 0; i < 500; i++) {
      tasks.push(taskRecord({
        id: `deep-${String(i).padStart(4, '0')}`,
        ...(i > 0 ? { dependsOn: [`deep-${String(i - 1).padStart(4, '0')}`] } : {}),
      }))
    }
    const started = performance.now()
    // Readiness of the tail (blocked, walks its own 1 prereq only).
    const tail = dependencyState(tasks[499]!, tasks)
    expect(tail.ready).toBe(false)
    // Cycle detection from a NEW task depending on the tail must traverse the
    // whole 500-chain and must still be bounded.
    const cycleStart = performance.now()
    let cycleError: unknown
    try {
      validateDependencies({ id: 'new-head', workspaceId: QA_WS.id }, ['deep-0000'], tasks)
      // depending on the chain HEAD is legal (head depends on nothing)
    } catch (error) { cycleError = error }
    expect(cycleError).toBeUndefined()
    let cycle: unknown
    try {
      // Make the head depend on the tail ⇒ 500-node cycle.
      validateDependencies({ id: 'deep-0000', workspaceId: QA_WS.id }, ['deep-0499'], tasks)
    } catch (error) { cycle = error }
    expect(cycle).toBeDefined()
    expect(String((cycle as Error).message)).toMatch(/cycle/i)
    const totalMs = performance.now() - started
    expect(totalMs, `500-DAG validation took ${totalMs.toFixed(1)}ms`).toBeLessThan(1_000)
    expect(performance.now() - cycleStart).toBeLessThan(1_000)
  })
})

describe('QA — read-only projections and the new task-index endpoint', () => {
  it('GET /state?excludeDone=true hides done prerequisites but keeps accurate progress', async () => {
    const h = await host()
    const a = await createTask(h, 'A')
    const b = await createTask(h, 'B', { dependsOn: [a] })
    await move(h, a, 'in_progress')
    await move(h, a, 'in_review')
    expect((await move(h, a, 'done')).status).toBe(200)
    const collapsed = await h.get('/dsh-taskboard/state?excludeDone=true')
    expect(collapsed.status).toBe(200)
    const ids = collapsed.json.value.tasks.map((t: { id: string }) => t.id)
    expect(ids).not.toContain(a)
    const view = collapsed.json.value.tasks.find((t: { id: string }) => t.id === b)
    expect(view.dependencyProgress).toMatchObject({ total: 1, completed: 1, ready: true })
  })

  it('GET /task-index returns untrashed tasks of one workspace with the picker fields', async () => {
    const h = await host()
    const a = await createTask(h, 'A')
    const b = await createTask(h, 'B', { dependsOn: [a] })
    const c = await createTask(h, 'C', { parentId: a })
    const trashed = await createTask(h, 'gone')
    expect((await h.post(`/dsh-taskboard/tasks/${trashed}/delete`, { ifVersion: h.store.get(trashed)!.version })).status).toBe(200)
    const other = (await h.post('/dsh-taskboard/tasks', { title: 'other', workspaceId: QA_WS2.id, urgency: 'normal' })).json.value.id

    const res = await h.get(`/dsh-taskboard/task-index?workspaceId=${QA_WS.id}`)
    expect(res.status).toBe(200)
    const rows = res.json.value.tasks as Array<{ id: string; title: string; status: string; workspaceId: string; parentId?: string; dependsOn?: string[] }>
    const ids = rows.map(r => r.id)
    expect(ids).toEqual(expect.arrayContaining([a, b, c]))
    expect(ids).not.toContain(trashed)
    expect(ids).not.toContain(other)
    for (const row of rows) {
      expect(row.workspaceId).toBe(QA_WS.id)
      expect(typeof row.title).toBe('string')
      expect(typeof row.status).toBe('string')
    }
    expect(rows.find(r => r.id === b)?.dependsOn).toEqual([a])
    expect(rows.find(r => r.id === c)?.parentId).toBe(a)
    // Unknown workspace must not leak another workspace's rows.
    const unknown = await h.get('/dsh-taskboard/task-index?workspaceId=does-not-exist')
    if (unknown.status === 200) expect(unknown.json.value.tasks).toEqual([])
    else expect(unknown.status).toBeGreaterThanOrEqual(400)
  })
})

describe('QA — export/import must preserve durable queued scheduled work', () => {
  it('import REPLACE keeps a queued one-shot whose runAt was already consumed by the queue', async () => {
    // A one-shot that reached the durable queue has no runAt/cron left (the
    // queue consumed the trigger). Exporting then importing must not silently
    // drop that record: the durable queue entry is host state worth preserving.
    const h = await host()
    await h.store.mutate('task-created', ledger => {
      ledger.tasks.push(
        taskRecord({ id: 'valid-anchor', title: 'anchor' }),
        taskRecord({
          id: 'queued-one',
          status: 'todo',
          execution: { mode: 'scheduled', queuedRunAt: T0 - 60_000, queuedAt: T0 - 120_000 },
        }),
      )
      return []
    })
    const exported = (await h.get('/dsh-taskboard/state')).json.value
    const stripDerived = (tasks: Array<Record<string, unknown>>): Array<Record<string, unknown>> =>
      tasks.map(({ dependencyProgress: _p, subtaskProgress: _s, ...rest }) => rest)
    const doc = ledgerOf(stripDerived(exported.tasks))
    const h2 = await host()
    const res = await h2.post('/dsh-taskboard/import', { mode: 'replace', ledger: doc })
    expect(res.status).toBe(200)
    const restored = h2.store.get('queued-one')
    expect(restored, 'queued one-shot was silently dropped by import replace').toBeDefined()
    expect(restored!.execution.mode).toBe('scheduled')
    expect(restored!.execution.queuedRunAt).toBe(T0 - 60_000)
  })
})

describe('QA — export/import of a board that has trashed records', () => {
  it('import REPLACE accepts a ledger whose TRASHED dependent still references a trashed prerequisite', async () => {
    // Real-world backup path: B (trashed) kept its dependsOn when it was
    // deleted; A was trashed later, so the D2 repair only touched LIVE
    // dependents. Exporting that board and importing it must not be refused by
    // strict link validation on inert (trashed) records.
    const h = await host()
    const a = await createTask(h, 'A')
    const b = await createTask(h, 'B', { dependsOn: [a] })
    expect((await h.post(`/dsh-taskboard/tasks/${b}/delete`, { ifVersion: h.store.get(b)!.version })).status).toBe(200)
    expect((await h.post(`/dsh-taskboard/tasks/${a}/delete`, { ifVersion: h.store.get(a)!.version })).status).toBe(200)
    // The trashed dependent still carries the inert link.
    expect(h.store.get(b)!.dependsOn).toEqual([a])

    const exported = (await h.get('/dsh-taskboard/state')).json.value
    const stripDerived = (tasks: Array<Record<string, unknown>>): Array<Record<string, unknown>> =>
      tasks.map(({ dependencyProgress: _p, subtaskProgress: _s, ...rest }) => rest)
    const h2 = await host()
    const res = await h2.post('/dsh-taskboard/import', { mode: 'replace', ledger: ledgerOf(stripDerived(exported.tasks)) })
    expect(res.status, 'import of a backup containing trashed records was refused').toBe(200)
    expect(h2.store.get(a)?.trashedAt).toBeDefined()
    expect(h2.store.get(b)?.trashedAt).toBeDefined()
    // Live-board invariant still holds after the import.
    for (const task of h2.store.snapshot().tasks) {
      if (task.trashedAt !== undefined) continue
      for (const dep of task.dependsOn ?? []) {
        const target = h2.store.get(dep)
        expect(target === undefined || target.trashedAt !== undefined, `${task.id} -> ${dep} is dangling`).toBe(false)
      }
    }
  })
})

# Fork audit and P0/P1 execution contract

Audit date: 2026-11-09. Branch: `feat/dependencies-lite` (fork `Rwanbt/dsh-taskboard`,
PR #1). Base: `dev` == upstream `cloader/dsh-taskboard` v0.9.11 (`49e9a51`).

This document is the single source of truth for the current work package. It records
what is actually wrong, the decisions taken, and the exact contracts each agent
implements. It is not a press release.

## 1. Measured baseline (before any fix)

| Check | Command | Result |
| --- | --- | --- |
| install | `npm ci` | 222 packages, exit 0 |
| typecheck | `npm run typecheck` | **RED** — 3 errors in `tests/dependencies.spec.ts` (`noUncheckedIndexedAccess` spread) |
| build | `npm run build` | green (66 files) |
| tests | `npm test` (fresh clone, no `lib/`) | **RED** — 6 failures, all missing-`lib/` |
| tests | `npm test` (after `npm run build`) | green — 57 files / 718 tests |

Ordering requirement: `npm run build` must precede `npm test` because
`tests/host-reliability.spec.ts` and `tests/client-wrap.spec.ts` import `lib/`.
That is pre-existing upstream behaviour (`prepublishOnly` already runs build then test),
not caused by the dependency feature. The typecheck failure was fixed immediately
(typed fixture + non-null assertions) so the team starts from green.

## 2. What the feature branch actually implements

20 commits, +434 lines: a pure graph module (`src/shared/dependencies.ts`), an optional
`dependsOn: string[]` field, validation in create/update/import, gates in the atomic
execution boundary, a scheduler queue filter, agent tool exposure, a card badge and a
collapsed detail editor, 3 i18n dictionaries and 57 lines of unit tests.

The design intent is sound and the atomic-gate placement in `ExecutionService.run()`
is correct: the prerequisite check runs **inside** the same `store.mutate()` that opens
the running record, so manual, scheduled and comment-wake runs cannot race past it.

## 3. Confirmed defects and gaps

### P0 — correctness / integrity

**F1. Dangling prerequisite references (data integrity).**
`delete` (soft trash) in `routes.ts` and `taskboard_delete` in `tools.ts`, and `purge`,
never touch other tasks' `dependsOn`. After trashing prerequisite A, dependent B keeps
`dependsOn: ['A']` forever; `dependencyState` classifies A as missing ⇒ B is blocked
permanently, with no audit trail and no distinct UI state. Hard purge produces the same
orphan. Violates the required "coherence of links on deletion/archival".

**F2. Duplication drops prerequisites.**
`BoardController.duplicate()` (`src/client/controller.ts`) copies prompt/execution/model
/checklist but **not** `dependsOn` (nor, later, `parentId`). A duplicate of a blocked
task becomes an immediately runnable clone, silently discarding ordering constraints.

**F3. Scheduler can silently spend blocked work.**
`SchedulerService.tickOnce()` queues due tasks first, then filters the durable queue by
prerequisite readiness. That keeps a blocked one-shot alive — good — but:
- `queueMaxAgeMs` expiry (`expireQueued`) can still consume a queued one-shot while its
  prerequisites are blocked, converting it to `claim` with a "no rerun" comment;
- an offline missed window (`consumeRunAt` / `advanceAndMark`) is applied even when the
  task is dependency-blocked, so a one-shot can be spent for a reason that has nothing
  to do with dependencies.
Both are required to be impossible: a prerequisite-blocked scheduled task must be
deferred, not spent, and must not cause a burst of catch-up runs after unblocking.

**F4. Scheduler gate is O(n²) and duplicated.**
`dependencyState(task, queuedTasks)` builds a `Map` of the whole ledger per queued task.
With the required "hundreds/thousands of tasks" scale this is 10^6 map inserts per tick.
A single index must be built per tick and reused.

**F5. Import merge validation is quadratic and over-strict.**
The merge branch runs `validateWorkspaceLinks` for every imported task, each call
looping the whole ledger. It also re-validates *unchanged* existing links, so a legacy or
externally imported ledger containing an old cross-workspace link makes every subsequent
merge fail. Replace-branch validation is correct.

**F6. Agent observability is incomplete.**
`downstreamDependents()` is exported and never used. Agents cannot:
- see a readiness flag in `taskboard_list`;
- see per-prerequisite status (done / pending / missing) or the reason in `taskboard_get`;
- see which tasks an acceptance would unblock.
Requirement 3.3 explicitly asks for all four.

**F7. No host-level tests for the new gates.**
Only the pure graph has tests. There is no test proving that claim (`taskboard_move`),
manual `move`, the manual `run` route, scheduled dispatch, import merge/replace and
delete cleanup actually enforce/repair prerequisites. The PR itself lists this as
outstanding.

**F8. Shape-only validation of imported prerequisites.**
`isPlausibleTaskRecord` accepts duplicate and self-referencing IDs; `store.load()` would
then accept a self-loop, which blocks the task forever with no diagnostic.

### P1 — ergonomics and hierarchy

**F9. Prerequisite selection is raw-ID only.** The detail editor is a text input plus a
`<datalist>` filled from the currently loaded ledger, so completed (collapsed) and
otherwise filtered tasks are not selectable; there is no title/ID search, no keyboard
combobox semantics, and missing/trashed prerequisites are shown as an opaque wait.

**F10. Hierarchy is absent.** No `parentId`, no subtask progress, no parent navigation,
no rollup.

### P2 — CI evidence

**F11. No verification evidence on tasks.** Nothing records CI/PR state, and nothing
distinguishes "no CI" from "passed".

## 4. Decisions (binding)

**D1 — `done` is the only satisfying prerequisite state.** `in_review` never satisfies.
Already true in `dependencyState`; keep it and test it at the host level.

**D2 — Missing/trashed prerequisite blocks, but is repaired at the source.**
On soft-delete and on purge, the host atomically removes the trashed id from every
dependent's `dependsOn` and appends a system comment (`sys.prerequisiteRemoved`) on each
affected task, recording the removed id and title in `systemParams`. The trash/unpurge
mutation and the dependent cleanup are one `store.mutate()` transaction. `deleted` is not
a silent unblock: the comment is the trace, and the dependents' `version` bumps.
`dependencyState` keeps classifying an already-dangling id as `missing` (blocking) so
hand-edited or legacy ledgers stay safe.

**D3 — Blocked scheduled work is deferred, never spent.**
A scheduled task whose prerequisites are unmet is *not* subject to the offline missed
window and *not* subject to `queueMaxAgeMs` expiry. It keeps its durable queue entry
until it either becomes ready or the user changes/cancels the schedule. When it becomes
ready it dispatches **once**; the next cron window is computed from the dispatch time, so
no burst can accumulate. The durable queue survives restart unchanged. This policy is
documented in `docs/dependencies-lite.md`.

**D4 — Gate placement.** Every start path (agent claim via `taskboard_move`, GUI
`move` to `in_progress`, GUI manual `run`, scheduled dispatch, comment wake) must fail
on unmet prerequisites. The authoritative check stays inside the atomic execution
mutation; cheap pre-checks at the route/tool layer only improve the error message.
`reserveDispatch()` additionally re-checks readiness before taking a queue entry.

**D5 — Agents can never reach `done`.** Already enforced (`taskboard_move` throws
`forbidden`); add a regression test so a dependency feature can never weaken it.

**D6 — Hierarchy is a separate concept from dependencies.** Model `parentId?: string`.
Rules: parent must exist, be untrashed, share the workspace; no self-parent; no ancestor
cycle; depth ≤ `MAX_TASK_DEPTH` (8). `subtaskProgress` is derived (direct children only),
never stored, never an execution gate. A parent is **not** auto-completed: the human
remains the only actor that can move a card to `done`. A parent may still be moved to
`done` with open children (human authority), but the detail panel and the agent renderer
show the open count.

**D7 — Deletion with children is refused, not cascaded.** Soft-delete and purge fail
with `has_children` while non-trashed children exist; the user/agent must move or delete
them first. Workspace rebind is refused while the task has a parent or children in
another workspace. No silent re-parenting, no mass deletion.

**D8 — Duplication copies structure.** `duplicate()` carries `dependsOn` (same
workspace, still validated by the host) and `parentId`. Templates/import keep validating.

**D9 — Derived fields are read-only projections.** `dependencyProgress` and
`subtaskProgress` exist only in GET responses / summaries; they are never persisted and
never used as execution gates. The gate recomputes from the ledger.

**D10 — Storage stays the existing JSON ledger.** No SQLite, no schema migration beyond
optional fields. Old ledgers without `dependsOn`/`parentId` load unchanged; new fields
are omitted when empty so exported files stay diff-friendly.

**D11 — GitHub CI is read-only, optional and off by default.** Three states plus
`unknown`; absent configuration or an unreachable API is always `unknown`, never
`passed`. No token is ever written to the ledger, logs or comments.

## 5. Shared contracts (implemented by Agent A, consumed by B and C)

```ts
// src/shared/hierarchy.ts  (new)
export const MAX_TASK_DEPTH = 8
export interface HierarchyTask {
  id: string
  workspaceId: string
  status: string
  trashedAt?: number
  parentId?: string
}
export interface SubtaskProgress {
  total: number
  done: number
  open: number
  blocked: number
  missing: number
}
export type HierarchyErrorCode =
  | 'invalid_input' | 'self' | 'missing' | 'cross_workspace'
  | 'cycle' | 'depth' | 'has_children'
export class HierarchyError extends Error { readonly code: HierarchyErrorCode }
export function validateParent(
  task: Pick<HierarchyTask, 'id' | 'workspaceId'>,
  proposedParentId: unknown,
  tasks: readonly HierarchyTask[],
): string | undefined
export function validateHierarchyLinks(task: HierarchyTask, tasks: readonly HierarchyTask[]): void
export function subtaskProgress(parentId: string, tasks: readonly HierarchyTask[], index?: ReadonlyMap<string, HierarchyTask>): SubtaskProgress
export function ancestorsOf(id: string, tasks: readonly HierarchyTask[]): string[]
export function descendantsOf(id: string, tasks: readonly HierarchyTask[]): string[]
export function detachIsDeleted(id: string, tasks: HierarchyTask[]): string[]  // host-only helper
```

Protocol/API additions:
- `TaskRecord.parentId?: string`, `TaskRecord.dependencyProgress?: DependencyState`,
  `TaskRecord.subtaskProgress?: SubtaskProgress` (derived, GET-only).
- `TaskSummary.parentId?`, `TaskSummary.dependsOn?`.
- `CreateTaskBody.parentId?: string`, `UpdateTaskBody.parentId?: string | null`
  (`null` detaches), `CreateTaskBody.dependsOn?: string[]`.

Host endpoint for the picker (Agent B):
`GET /dsh-taskboard/task-index?workspaceId=<id>` →
`{ ok: true, value: { tasks: Array<{ id, title, status, workspaceId, parentId?, dependsOn? }> } }`
for every untrashed task of the workspace. Read-only, cheap, no derived progress.

## 6. Work packages and file ownership

| Agent | Owns (write) | Must not touch |
| --- | --- | --- |
| Lead | integration, `docs/`, final validation, git commits, P2 | — |
| A — domain | `src/shared/dependencies.ts`, `src/shared/hierarchy.ts`, `src/shared/protocol.ts`, `src/shared/api.ts`, `tests/dependencies.spec.ts`, `tests/hierarchy.spec.ts` | `src/host/`, `src/client/` |
| B — host | `src/host/routes.ts`, `src/host/tools.ts`, `src/host/execution.ts`, `src/host/scheduler.ts`, `src/host/store.ts`, `tests/host-*.spec.ts` (new only) | `src/shared/`, `src/client/`, existing tests |
| C — client | `src/client/**`, `tests/client-dependencies.spec.tsx` (new) | `src/shared/`, `src/host/` |
| D — QA | `tests/qa/**`, `scripts/qa/**` (new only) | all product source |

Nobody commits, checks out, stashes or installs packages: the Lead owns git and
`npm ci`/`npm run build`. Teammates run only targeted `npx vitest run <file>` and
`npx tsc --noEmit` when needed (16 GB machine, one heavy command at a time).

## 7. Acceptance criteria for P0

1. `npm run typecheck` green, `npm test` green after `npm run build`.
2. A dependent task cannot start through any of the five paths while a prerequisite is
   not `done`; all five are covered by an automated host test.
3. Reopening a done prerequisite re-blocks new executions; a running execution is not
   killed and the ledger stays coherent.
4. Trash/purge of a prerequisite leaves no blocking dangling link and appends the audit
   comment; a dependent already `in_progress` is unaffected.
5. Cyclic, duplicate, self, cross-workspace, trashed and over-limit prerequisites are
   rejected at every write entry point (route, tool, import replace, import merge).
6. Blocked scheduled work is deferred across restarts, is not spent, and does not burst.
7. Data written before this branch loads and behaves unchanged.
8. Agent tools expose readiness, per-prerequisite state and downstream unblocking.

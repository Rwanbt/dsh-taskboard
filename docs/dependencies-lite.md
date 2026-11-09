# Fork: lightweight dependencies + task hierarchy

This document describes the **fork-only** capabilities added on top of upstream
`cloader/dsh-taskboard` (v0.9.11). It is written to be accurate about what the code
does, including the failure policies. Nothing here is an upstream release.

- P0 — prerequisites between tasks, enforced at every execution path.
- P1 — parent/subtask hierarchy, derived progress, searchable prerequisite picker.
- P2 — optional read-only GitHub CI evidence (see `docs/github-ci.md`).

The five-column board, the `taskboard_*` tool contracts, human-only `done`, and the
existing JSON ledger are unchanged. No new navigation, no new columns, no database.

---

## 1. Prerequisites (`dependsOn`)

### Model

- `TaskRecord.dependsOn?: string[]` — up to **32** direct prerequisites, same workspace.
- Persisted in the existing ledger (`dsh-taskboard.json`). Omitted when empty.
- `dependencyProgress` is **derived** and only exists in GET responses/summaries
  (`{ total, completed, pendingIds, missingIds, ready }`). It is never stored and
  never used as an execution gate; gates recompute from the fresh ledger.

### Semantics (P0)

| Rule | Behaviour |
| --- | --- |
| Satisfying state | only `done` (human acceptance). `in_review` is **not** satisfying. |
| Missing / trashed prerequisite | blocks, and is reported as `missing` (never silently ignored). |
| Duplicates / self reference | rejected at every write entry point. |
| Invalid id shape | rejected (id charset, length). |
| Direct and transitive cycle | rejected; detection is bounded and safe on hand-edited cyclic ledgers. |
| Cross-workspace link | rejected in both directions (link and workspace rebind). |
| Manual `blocked` marker | independent. It is neither required nor sufficient for a gate. |
| DoD checklist | independent. Checked items never satisfy a prerequisite. |
| `in_review` prerequisite | blocks new executions of the dependent. |

### Execution gates (P0)

A task with unmet prerequisites cannot be started by **any** path:

1. agent claim (`taskboard_move` → `in_progress`);
2. GUI `move` → `in_progress`;
3. GUI/API manual `run`;
4. scheduled dispatch (cron or one-shot);
5. comment wake (`in_review` acceptance loop).

The authoritative check runs **inside** the same transactional mutation that opens the
running execution record (`ExecutionService.run`), so a concurrent edit cannot slip
between the check and the write. Routes and tools may run a cheap pre-check first, but
only the atomic check is trusted.

Reopening a prerequisite (`done` → anything else) immediately blocks **new** executions.
A run that is already in flight is never killed; the ledger keeps its record and the
dependent simply cannot start again until the prerequisite is accepted anew.

### Deleting / purging a prerequisite (P0)

A prerequisite is a reference, so deleting it must not leave a permanently blocked
dependent:

- soft-delete (`trash`) and hard `purge` **remove the id from every dependent's
  `dependsOn`** inside the same transaction, bump each dependent's `version`, and append
  a system comment `sys.prerequisiteRemoved` with `systemParams: { id, title }`;
- the dependent is thus unblocked, with an auditable trace of why;
- an already-running dependent execution is not affected;
- a task that still has **non-trashed children** cannot be deleted (see §2, D7); the
  user/agent must handle the children first. Errors use the stable code `has_children`.

Legacy or hand-edited ledgers that already contain a dangling id keep being classified
`missing` and therefore keep blocking. The repair above prevents new ones.

### Scheduled work deferral policy (P0)

Scheduled tasks interact with prerequisites via an explicit, documented policy:

- a scheduled task whose prerequisites are unmet is **deferred**, not spent;
- deferral applies to the durable dispatch queue **and** to the offline missed-window
  policy: a blocked task is not marked missed, not converted to `claim`, and not
  consumed by the queue shelf-life;
- the queue entry survives a host restart;
- once the prerequisites are accepted, the task dispatches **exactly once** (the next
  cron window is computed from the dispatch time), so no burst of catch-up runs can
  accumulate;
- unrelated existing rules are preserved: a window missed while the host was offline
  for a task that is **not** prerequisite-blocked is still consumed with the existing
  system comment; an expired queue window for a non-blocked task still expires.

### Agent surface (P0)

The `taskboard_*` tools keep their existing contracts and permissions, and add:

- `taskboard_create.dependsOn`, `taskboard_update.dependsOn` (replace-all; `[]` clears);
- `taskboard_list` shows a readiness marker (`可执行` / waiting on N prerequisites);
- `taskboard_get` shows each prerequisite with its id, title, status and state
  (`done` / `pending` / `missing`), the reason the task is blocked, and which tasks
  would be unblocked by accepting it (`downstreamDependents`);
- agents still **cannot** move a task to `done` (`forbidden`), so a dependency can never
  be satisfied by the agent that wants to run.

### API examples

Create:
```json
{"title":"Build feature B","workspaceId":"<workspace-id>","urgency":"normal","dependsOn":["<task-id-A>"]}
```

Update (optimistic concurrency is mandatory):
```json
{"ifVersion":3,"dependsOn":["<task-id-A>","<task-id-C>"]}
```

Remove every prerequisite: `{"ifVersion":4,"dependsOn":[]}`. In the GUI these calls are
`POST /dsh-taskboard/tasks` and `POST /dsh-taskboard/tasks/:id/update`.

---

## 2. Hierarchy (`parentId`)

Hierarchy groups work; it does **not** order it. Dependencies order; hierarchy groups.
The two are modelled and displayed separately.

- `TaskRecord.parentId?: string` — one parent, same workspace, at most
  `MAX_TASK_DEPTH = 8` levels (root = 1).
- `subtaskProgress` is **derived** from the direct children
  (`{ total, done, open, blocked, missing }`), GET-only, never stored, never a gate.
- A parent may have direct children that themselves have prerequisites; a child may
  also have its own children (nested groups), within the depth cap.
- Parallel work is the normal case: several independent children of the same parent can
  be claimed by different agents at the same time.
- The parent is **never auto-completed**. Only a human moves a card to `done`. A human
  may accept a parent with open children (authority stays human), and the detail panel
  plus the agent renderer show the open count so the decision is informed.
- Creating a task with `parentId`, or updating `parentId` (`null` detaches), validates
  existence, same workspace, self-parent, ancestor cycle and depth.
- Workspace rebind is refused while the task has a parent or a child in another
  workspace.
- Deleting/purging a task that still has non-trashed children is refused
  (`has_children`). A parent is never silently re-parented or cascaded-deleted.
- Import validates `parentId` (shape, self, cycle, depth) for replace and merge.
- Duplicating a card copies `parentId` and `dependsOn`.

---

## 3. UI (P1)

Kept deliberately minimal, visually close to upstream:

- **Card**: unchanged in structure. Only adds, in the existing meta row, a neutral
  `🔗 completed/total` chip when prerequisites exist and a neutral `▸ done/total` chip
  when subtasks exist. Tooltips carry names/status; colour is not used for "waiting".
- **Detail**: collapsible sections, no new tabs — `Dependencies`, `Subtasks`
  (with parent breadcrumb), and the existing execution/validation/history sections.
- **Prerequisite picker**: accessible combobox searching by title **and** id over every
  untrashed task of the workspace, including completed tasks hidden by a collapsed
  `Done` column (served by `GET /dsh-taskboard/task-index?workspaceId=`). Keyboard:
  focus → type → ↑/↓ → Enter, Escape closes; ARIA combobox/listbox semantics.
- **Missing prerequisite**: shown explicitly as deleted, removable in one click even
  when the target is hidden or trashed.
- **Done column collapsed**: prerequisite navigation still works and progression stays
  accurate, because progress is computed server-side against the full ledger.
- No permanent sidebar, no extra column, no imposed graph, no animation.

---

## 4. Data, compatibility and migration

- Storage is unchanged (`dsh-taskboard.json`, plus the existing templates/assets).
  No SQLite, no new service, no mandatory network.
- New fields are **optional**: a ledger written before this fork loads and behaves
  exactly as before; a ledger written by this fork is still readable by upstream
  (unknown optional fields are ignored by upstream's plausibility gate).
- Derived fields (`dependencyProgress`, `subtaskProgress`) are never persisted.
- Import validates prerequisites and hierarchy before replacing/merging the ledger, so
  a cyclic or dangling import cannot corrupt the live board. A failed import leaves the
  live ledger untouched.
- Back up the data directory before switching a profile between upstream and this fork.
  There is no destructive migration.

## 5. Validation

```sh
npm ci
npm run build      # must precede tests: two specs import lib/
npm run typecheck
npm test
```

Real-host validation uses an isolated DSH profile (separate `DSH_HOME`, separate port)
so the daily profile is never touched; see `docs/INSTALL-FORK.md`.

## 6. Deferred work

- Optional dependency graph view (secondary, not a permanent dashboard).
- Optional warning banner on an already-running dependent when a prerequisite is
  reopened (the record and the audit comment already exist).
- GitHub CI evidence — designed in `docs/github-ci.md`; off by default.

## 7. Licensing / upstream

Original project: `cloader/dsh-taskboard`, Apache-2.0. This fork keeps the licence and
the upstream-compatible shape so `upstream/dev` can still be merged. See
`docs/INSTALL-FORK.md` for the synchronisation procedure.

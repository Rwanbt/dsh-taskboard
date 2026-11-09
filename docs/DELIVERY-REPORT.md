# Delivery report — dependencies + hierarchy (fork P0/P1)

Date: 2026-11-09. Repository: `Rwanbt/dsh-taskboard` (fork of `cloader/dsh-taskboard`).
Branch: `feat/dependencies-lite`. Pull request: **#1** → `dev`.
Status: **ready for review, not merged.** Merge is a human decision.

This report is factual: every result below was executed. Anything not executed is
listed in §6 as not exercised, not glossed over.

---

## 1. Code state and commits

Validated tree: `HEAD b4096b3` (branch pushed to `origin/feat/dependencies-lite`).
The branch contains the 20 pre-existing feature commits plus 5 integration commits added
in this session:

| Commit | Content |
| --- | --- |
| `973de91` | `feat(shared)`: validated dependency graph + task hierarchy model (+ pre-existing queued-one-shot import fix) |
| `4d2ea7f` | `fix(host)`: gate every execution path, repair deleted prerequisites, scheduler deferral, import rework, agent observability, `/task-index` |
| `88bb995` | `feat(client)`: searchable prerequisite picker, missing-ref UX, hierarchy surface, i18n |
| `35a8563` | `test(qa)`: independent adversarial suites + real DSH host harness + QA report |
| `b4096b3` | `docs`: audit, semantics, install/upgrade, P2 design |

Diff against base `dev` (v0.9.11): 26 commits, 47 files, +9342 / −65.

Build artifact used for host validation: `lib/` rebuilt from this tree, 36 JS files,
aggregate SHA-256 `93685FEE9AAE3A808FA25D8DD0AA6EB953F988DADA7B26292CFAEECED737D50B`
(`lib/shared/protocol.js` mtime 2026-11-09T01:35:18+01:00).

## 2. Operational features

**P0 — prerequisites**
- `dependsOn` (≤32, same workspace), persisted; derived progress is GET-only and never a gate.
- Only human-accepted `done` satisfies; `in_review` never does.
- Rejects cyclic (direct/indirect), duplicate, self, cross-workspace, missing, trashed and over-limit links at route, agent tool, import replace and import merge.
- Five start paths all gated: agent claim, GUI move → in_progress, manual run, scheduled dispatch, comment wake. Authoritative check inside the atomic execution mutation.
- Reopening a prerequisite re-blocks new executions; running executions are not killed.
- Trash/purge repair dependents atomically (strip link, version bump, `sys.prerequisiteRemoved` audit comment); import-merge runs the same repair; deleting a task with live subtasks is refused.
- Scheduler: blocked scheduled work is deferred, never spent; survives restart; dispatches once after acceptance; no catch-up burst. Documented in `docs/dependencies-lite.md`.
- Agent tools: readiness marker, per-prerequisite state, completion-unblocks; agents still cannot reach `done`.

**P1 — hierarchy and UX**
- `parentId` (one parent, same workspace, depth ≤ 8), validated everywhere including import.
- `subtaskProgress` derived from direct children; parents never auto-complete.
- Neutral `🔗 x/y` and `▸ x/y` card chips with real names/states in tooltips.
- Collapsible Dependencies / Subtasks sections, parent breadcrumb, add-subtask prefill.
- Accessible title+id prerequisite combobox over all untrashed tasks (incl. collapsed Done).
- Deleted prerequisite shown explicitly with one-click removal.
- `duplicate()` copies `dependsOn` + `parentId`.
- Five columns, existing controls, no new nav/column/graph/animation; zh/en/ru key parity.

**P2 — GitHub CI:** designed, not implemented (`docs/github-ci.md`); off by default, absent CI must be `unknown`.

## 3. Test report (commands and results)

All commands run from the repository root, in this order.

| # | Command | Result |
| --- | --- | --- |
| 1 | `npm ci` | 222 packages, exit 0 |
| 2 | `npm run typecheck` | clean (exit 0) |
| 3 | `npm run build` | 68 files, exit 0 |
| 4 | `npm test` | **66 files / 884 tests passed, 0 failed** |
| 5 | `npx vitest run tests/qa/` | **61/61 passed** |
| 6 | `npx tsc --noEmit` | clean |

Baseline measured before any fix: typecheck RED (3 errors in `tests/dependencies.spec.ts`);
`npm test` RED on a clean clone until `npm run build` produced `lib/` (pre-existing
upstream ordering requirement, not caused by this feature). The typecheck failure was
fixed in the first commit of the session.

`tests/mirror-real-git.spec.ts` failed once in a parallel full run and passed 5/5 in
isolation; `git.ts`/`isolation.ts` were not touched. Classified as a pre-existing flake,
and it passed in the final full run.

## 4. Real DeepSeek Harness validation

Environment: isolated `DSH_HOME` (`C:\Users\barat\dsh-tb-lead`) and isolated profile
`tb` created from the shipped `web` template with
`dsh --from-default-profile web`; plugin link-installed with
`dsh plugin --profile tb add link:<repo>`; host booted with
`dsh --profile tb --no-open --port <port>`. The daily `~/.dsh/profiles/desktop` profile
was not modified. `lib/` from the validated tree was loaded.

Proven in the real host:
- plugin loads and the board panel renders the five columns (screenshots captured);
- real HTTP surface answers with cookie auth (`GET /?token=…`);
- creation with prerequisites; `dependencyProgress` on the wire;
- gate refusals with a reason for manual run and move-to-in-progress;
- `in_review` does not satisfy; `done` does; reopening re-blocks;
- trash and purge repair dependents (link removed, version bumped, audit comment, dependent startable);
- scheduled dependent keeps its schedule while blocked and does not run;
- hierarchy: `subtaskProgress` derived, parent not auto-completed, cycle/self-parent/depth-9/`has_children` refused, depth 8 accepted;
- `GET /task-index`: shape, untrashed filtering, done tasks included, 404 on unknown workspace;
- export → import replace of a board containing **trashed linked records** returns 200 and preserves hierarchy/prerequisites;
- import merge that trashes a prerequisite repairs the live dependent;
- restart persistence and deferred-blocked-one-shot (independent QA harness).

Lead scenario: **26/26 checks passed**. Independent QA harness on its own isolated home:
**39 PASS / 0 FAIL / 9 INFO**. Full test/validation matrix: `tests/qa/QA-REPORT.md`
and `scripts/qa/reports/`.

## 5. Defects found and fixed during integration

| ID | Defect | Fix |
| --- | --- | --- |
| F1 | Trash/purge left dangling blocking refs (user, agent, **import-merge**) | one repair invariant shared by all trash paths, audit comment |
| F3 | Blocked scheduled work spent by the offline missed-window policy | deferral policy: never spent, exempt from shelf life, no burst |
| F4 | O(n²) readiness maps in scheduler/import | one index per tick / per request |
| F5 | Quadratic, over-strict import merge validation | one projected index, written-set only |
| F6 | No agent visibility of readiness/why-blocked/unblocks | list marker, per-prerequisite state, downstream list |
| F8 | Invalid links made the whole ledger unloadable | structural load gate + `repairTaskLinks` with warn |
| — | Import refused backups containing trashed linked records | inert trashed records exempt from link-content validation |
| — | Import-merge stranded a dependent when trashing its prerequisite | post-merge repair sweep on the final ledger |
| — | Hierarchy invariants unenforced at the import boundary | full hierarchy validation for both import modes |
| — | **Pre-existing upstream data loss**: import silently dropped a scheduled one-shot already queued (`runAt` consumed) | import accepts valid queue markers, preserves `queuedAt`/`lastTriggeredAt`, no synthetic `runAt` |

## 6. Limitations and not exercised

- **Real agent execution and settlement** were not exercised end-to-end: the isolated host
  has no model credential. Gate refusal/allowance, repair, persistence and import are
  proven through the real HTTP surface; settlement and "a running execution is not killed"
  are proven in-process with the real `ExecutionService`.
- **Live** scheduled dispatch after unblock is proven with the real `SchedulerService`
  in-process, not against a wall-clock host.
- **GitHub Actions did not run on the PR**: the fork reports 0 registered workflows and
  0 runs even though `.github/workflows/node.js.yml` exists on `dev` (Actions permission
  reports enabled). The PR therefore has no CI check. The same commands were executed
  locally with the results in §3. This is a repository/CI-availability issue, not a
  passing CI claim.
- **P2 GitHub CI evidence** is designed only; no CI-fetching code shipped.
- `taskboard_update.parentId` is declared as a JSON parameter (the author-facing spec
  cannot express `string|null`); runtime validation is strict.
- Load-time link repair logs to the host console; it does not write a ledger audit comment.
- Multi-repo git worktree behaviour unchanged and covered by the existing suite, not
  re-derived here.

## 7. Documentation

- `docs/fork-audit.md` — measured baseline, defects F1–F11, decisions D1–D11, contracts, acceptance criteria.
- `docs/dependencies-lite.md` — prerequisite semantics, gates, deletion repair, scheduler deferral policy, hierarchy, UI, data compatibility.
- `docs/INSTALL-FORK.md` — build, isolated validation profile, normal install, upgrade, upstream sync, rollback, troubleshooting.
- `docs/github-ci.md` — P2 design and test requirements.
- `tests/qa/QA-REPORT.md` — independent QA report with the proven/real/inspection/not-exercised split.

## 8. Pull request

https://github.com/Rwanbt/dsh-taskboard/pull/1

- Base `dev`, head `feat/dependencies-lite`, `MERGEABLE`, merge state `CLEAN`.
- Marked **ready for review** (was draft); **not merged**.
- No CI check is attached (see §6). Merge remains a human decision.

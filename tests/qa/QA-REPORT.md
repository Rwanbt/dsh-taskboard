# Independent QA report — dsh-taskboard dependencies + hierarchy

Agent D (independent QA / red team). This report distinguishes **what was actually
executed** from what is inspection-only or not exercised. No check below is claimed
unless it ran; commands and counts are recorded verbatim.

## Build under test (frozen tree)

| Item | Value |
| --- | --- |
| Repo | `C:\Users\barat\Documents\deepseek-harness\default-workspace\dsh-taskboard` |
| Branch | `feat/dependencies-lite` |
| Git HEAD | `a11384e` + uncommitted A/B/C working tree (no commit SHA yet) |
| Build | `lib/` rebuilt 2026-11-09T01:35:18+01:00, 36 JS files |
| `lib/shared/protocol.js` mtime | `2026-11-09T01:35:18.9447511+01:00` (verified) |
| `lib/shared/protocol.js` SHA-256 | `9E7450BF69141ABD54160A177977613AB6469545AD28B4AB88307A4E3A312174` |
| `lib/host/store.js` SHA-256 | `34BAABDD928646D016994820972AE91E622EDA0659032F084905C339D6D6736B` |
| `lib/host/routes.js` SHA-256 | `52A54676F696AD980F8FF4F12C959520F13C711C4E651482F42F12EEBA3DBC94` |
| `lib/host/scheduler.js` SHA-256 | `948C2E21106FBA8573891E97A52516E87821A5ED48857700F7A1BF30A741E899` |
| `lib/index.js` SHA-256 | `22CB4B8F3F77649AE0381D9EC5219092D93E8E68FEEED19825601AF6EF8F474D` |
| Lead-reported aggregate | 36 JS files, aggregate SHA-256 `93685FEE9AAE3A808FA25D8DD0AA6EB953F988DADA7B26292CFAEECED737D50B` (my per-file digests above are independent corroboration; my aggregate algorithm differs, so the Lead's aggregate is cited, not recomputed) |

## Final executed evidence

| Run | Command | Result |
| --- | --- | --- |
| Full suite | `npx vitest run` | **66 files passed, 884 tests passed, 0 failed** (43.9s) |
| Independent QA suite | `npx vitest run tests/qa/` | **4 files passed, 61 tests passed, 0 failed** (3.9s) |
| Typecheck | `npx tsc --noEmit` | clean (exit 0, no output) |
| Real isolated DSH host | `pwsh -File scripts/qa/dsh-host-e2e.ps1` (DSH_HOME=`C:\Users\barat\dsh-tb-test`, port 64934) | **39 PASS / 0 FAIL / 9 INFO** — report `scripts/qa/reports/dsh-host-report-20261109-013804.md` |

The full-suite number is 884 = the Lead's 883 on the same build **plus one QA test
added afterwards** (tool-entry-point §7.5 negatives). The build identity is unchanged;
`tests/qa/` is 61 tests.

`tests/qa/` files (all new, Agent D only):
`harness.ts` (real routes + real ExecutionService + real SchedulerService + real
TaskStore over real HTTP), `qa-dependency-integrity.spec.ts` (24),
`qa-gates-and-scheduler.spec.ts` (12), `qa-hierarchy-adversarial.spec.ts` (19),
`qa-agent-observability.spec.ts` (6).

---

## (a) Proven by automated tests (vitest, in-process production composition)

`tests/qa/` wires the real `registerTaskboardRoutes`, real `ExecutionService`, real
`SchedulerService` and real `TaskStore` on a real `node:http` server; only the agent
runtime, event bus and workspace registry are faked (process-external faces).

| §7 criterion | Evidence (tests/qa/) | Result |
| --- | --- | --- |
| 1. typecheck green, full suite green after build | `npx tsc --noEmit` clean; full suite 884/884 | PASS |
| 2. dependent cannot start via any of the five paths | `qa-gates-and-scheduler` "all five start paths" (agent claim via `taskboard_move`; route move→in_progress; route run; scheduled dispatch; comment wake) — 5/5 | PASS |
| 3. reopening a done prerequisite re-blocks new runs; running execution not killed; ledger coherent | `qa-dependency-integrity` "reopening a done prerequisite…": run stays `running`, settles to `in_review`, one execution record, then run+move refused | PASS |
| 4. trash/purge leaves no blocking dangling link + audit comment; dependent in_progress unaffected | `qa-dependency-integrity` F1 soft-delete/purge tests; import-merge repair (pre-existing + same-batch); `qa-gates-and-scheduler` trash-during-claim — 6 tests | PASS |
| 5. cyclic/duplicate/self/cross-workspace/trashed/over-limit rejected at every write entry point | import replace + merge negatives (cycle/self/dup/missing/cross-ws), route update negatives, **tool create/update negatives** (`qa-agent-observability` "tool write entry points"), hierarchy-at-import negatives (dangling/cycle/depth-9/cross-ws/trashed parent) | PASS |
| 6. blocked scheduled work deferred across restarts, not spent, no burst | `qa-gates-and-scheduler`: blocked one-shot missed-window deferred + dispatches once after unblock + no second dispatch; blocked cron same; blocked queued work not expired by `queueMaxAge`; **TOCTOU** re-check in `expireQueued` and `reserveDispatch` | PASS |
| 7. data written before this branch loads and behaves unchanged | legacy ledger without `dependsOn`/`parentId` loads; export→import→restart preserves `dependsOn`; queued one-shot survives export/import; trashed-linked records round-trip | PASS |
| 8. agent tools expose readiness, per-prerequisite state, downstream unblocking | `qa-agent-observability`: list `等待前置1项`/`可执行`; get `pending 未完成`/`done 已完成`/`missing 缺失`; `完成后可解锁 N 个下游任务`; hierarchy parent/child projection; D5 regression (agent cannot reach done) | PASS |

Additional automated adversarial coverage: concurrent same-`ifVersion` writes (exactly
one winner), overlapping `run()` (exactly one execution), concurrent trash-vs-claim
(one coherent outcome, ledger-wide no-dangling invariant), 1000-task `GET /state`
(bounded: 167–349 ms, threshold 3 s documented in the test), 500-deep DAG validation
(~3 ms, threshold 1 s documented), hand-edited cyclic ledger import atomicity.

## (b) Proven through the real DSH HTTP surface (isolated real host)

Real `dsh` process, isolated `DSH_HOME=C:\Users\barat\dsh-tb-test` (never the real
`~/.dsh`), profile `tb` created from the shipped `web` template, plugin installed with
`dsh plugin --profile tb add link:<repo>`, booted on `127.0.0.1:64934`, real cookie
trust handshake (`GET /?token=…` then the same session for `/dsh-taskboard/*`).
39/39 checks passed, including:

- plugin loaded: `/workspaces` returns the registered project, `/state` answers;
- create A; create B with `dependsOn:[A]`; `dependencyProgress` on the wire; B blocked;
- `run B` and `move B→in_progress` refused **with the dependency reason**;
- A `in_review` does not satisfy; A `done` satisfies; reopen A re-blocks run+move;
- comment wake (path 5) refused with dependency reason;
- cycle/self/duplicate/missing rejected on route update; stale version rejected;
- F1 repair visible on the wire: soft-delete + purge of a prerequisite strips the
  dependent's link, appends `sys.prerequisiteRemoved`, and the dependent becomes
  startable; import-merge of a trashed prerequisite repairs its live dependent;
- hierarchy: child with `parentId`, derived `subtaskProgress` in `/state`,
  delete-with-children refused (`has_children`), self-parent refused, child start not
  gated by parent status;
- export→import(replace): keeps `dependsOn`; preserves **queued scheduled work**;
  round-trips a board with **trashed linked records**;
- import replace rejects a cyclic ledger atomically (revision unchanged);
- **restart**: task + `dependsOn` survive; revision durable; gate still enforced; the
  deferred blocked one-shot survives unspent (mode `scheduled`, no missed comment);
- plugin ledger lives under the isolated `DSH_HOME`.

## (c) Inspection-only conclusions (NOT runtime-proven)

- **XSS**: no `dangerouslySetInnerHTML` / `innerHTML` / `document.write` anywhere in
  `src/client` (grep). Titles, comments and markdown text are rendered as React text
  nodes; the markdown image renderer only accepts `data:image/…`, `http(s)://…` or
  `*.png|jpg|jpeg|gif|webp|svg` sources; external-source links are protocol-restricted
  to `http:`/`https:` in `normalizeExternalSource` (`src/shared/external.ts:85`). Agent
  tool renderers are plain text. No XSS sink found by inspection.
- **Secret leakage**: credentials live in the external-sync config file
  (`$DSH_HOME/dsh-taskboard-external.json`), never in the task ledger
  (`$DSH_HOME/dsh-taskboard.json`); ledger records carry only normalized external
  identity (`normalizeExternalSource` reconstructs explicitly, dropping unknown fields);
  external HTTP transport documents that bodies/URLs are never echoed into errors. No
  credential path into ledger/comments/logs found by inspection. Not exercised with a
  live third-party provider (no credentials available).
- **P2 GitHub CI (D11)**: deferred. `docs/github-ci.md` exists, but there is no CI code
  in `src/` (grep for github/checkRun/ciStatus is empty), so "absent config/API →
  `unknown`, never `passed`" is documentation, not an implemented, tested behaviour.

## (d) NOT exercised (explicit limitations)

- **Real agent execution/settlement**: the isolated DSH home has no model credential.
  The `run` route was exercised only for its refusal/allowed gate outcomes; no real
  session was created, no prompt was submitted, no execution settled. §7.3's "running
  execution is not killed" is proven in-process with the real `ExecutionService` and a
  fake agent runtime, not against a live model.
- **Real scheduled dispatch after unblock**: the real host proves boot-catchup
  deferral, unspent survival across restart, and import persistence of the queue
  entry; the actual single dispatch after unblocking and the no-burst behaviour are
  proven in-process (`qa-gates-and-scheduler`) with the real `SchedulerService` and
  real `ExecutionService`, not on the live host (would require a model credential).
- **Real GitHub CI**: P2 deferred (see (c)).
- **Client UI interactions** (combobox keyboard/a11y, missing-ref UX, badges): out of
  Agent D's scope; covered by Agent C's `tests/client-dependencies.spec.tsx` in the
  full suite. My XSS conclusion on client rendering is inspection-only.
- **Multi-repo/git worktree behaviour under the new gates**: covered by the existing
  suite (incl. `mirror-real-git.spec.ts`), not re-derived by QA.

## Findings raised by QA and their resolution (all verified fixed on this build)

| # | Finding | Repro | Status |
| --- | --- | --- | --- |
| 1 | F1: soft-delete/purge/agent-delete left dangling `dependsOn`, no audit, dependent blocked forever | `tests/qa/qa-dependency-integrity` F1 tests | FIXED — one shared `detachPrerequisitesOfTrashed` helper used by route delete, purge, agent delete, import-merge; tests + real host PASS |
| 2 | F3: blocked scheduled one-shot/cron was SPENT on the offline missed-window path | `qa-gates-and-scheduler` D3 tests | FIXED — blocked work deferred; `consumeRunAt`/`advanceAndMark`/`expireQueued`/`reserveDispatch` re-check readiness; tests + real host PASS |
| 3 | F8: `repairTaskLinks()` exported but never wired into `store.load()` (cross-agent seam) — hand-edited self-loop/duplicate loaded unrepaired | `qa-dependency-integrity` F8 test | FIXED — `store.load()` repairs link content with a diagnostic; test PASS |
| 4 | Import silently DROPPED a queued scheduled one-shot (runAt consumed by the queue, no cron ⇒ `normalizeExecution` threw ⇒ invalid ⇒ dropped with 200) — data loss; pre-existing upstream, made reachable by D3 deferral | `qa-dependency-integrity` "queued one-shot" test | FIXED — import keeps the durable queue entry; test + real host export/import PASS |
| 5 | Import refused a legitimately exported board containing TRASHED linked records (strict link validation on inert records) | `qa-dependency-integrity` trashed-record round-trip test | FIXED — inert records exempt from link-content validation, `assertNoChildren` kept; test + real host PASS |
| 6 | Import MERGE could silently strand a live dependent by overwriting its prerequisite as trashed | `qa-dependency-integrity` merge-trash test | FIXED — post-merge sweep on the final ledger; test PASS |
| 7 | Hierarchy invariants (dangling parent, parent cycle, depth>8, cross-workspace parent, parent→trashed) were not enforced at the import boundary | `qa-hierarchy-adversarial` import tests | FIXED — both import branches validate hierarchy; tests PASS |
| 8 | Merge of a batch trashing a prerequisite + rewriting/creating a dependent | `qa-dependency-integrity` same-batch test | ACCEPTED POLICY: atomic 400 refusal (nothing committed), never a dangling live link; documented behaviour: "import validates prerequisites and hierarchy before swapping; a cyclic, dangling or trashed reference makes the import fail atomically and the live ledger is untouched." |

No regression introduced by A/B/C was found in QA scope. The one full-suite failure
seen earlier (`mirror-real-git.spec.ts`) was a pre-existing flake under parallel load:
it passes 5/5 in isolation (`npx vitest run tests/mirror-real-git.spec.ts`) and passed
in the final full run; `git.ts`/`isolation.ts` were never touched by this feature.

## Residual risks / notes (not failures)

- Load-time link repair is silent in the ledger (console warning only); a repaired
  corrupt record leaves no audit comment. Acceptable for a corrupt-local-ledger
  recovery path, but operators only see it in host logs.
- Import replace drops individually-invalid records from the uploaded file (existing
  product behaviour) while succeeding; a queued-scheduled record was one such case and
  is now fixed, but the general "invalid entries dropped on replace" semantics remains.
- The real-host harness seeds one workspace record into the isolated DSH core storage
  (a fresh isolated home has none) — documented bootstrap, not a product stub.
- Real-host evidence reflects the **built `lib/`**; source-level `tests/qa/` reflects
  `src/`. Both were run against the same frozen tree/build identity above.

## Reproduce

```powershell
cd C:\Users\barat\Documents\deepseek-harness\default-workspace\dsh-taskboard
npx tsc --noEmit
npx vitest run                 # 66 files / 884 tests
npx vitest run tests/qa/       # 4 files / 61 tests
pwsh -NoProfile -File scripts/qa/dsh-host-e2e.ps1 `
  -Label "final build: working tree on top of a11384e, lib 2026-11-09T01:35:18"
# -> scripts/qa/reports/dsh-host-report-<stamp>.md (39 PASS / 0 FAIL)
```

Artifacts: `tests/qa/` (suite + harness), `scripts/qa/dsh-host-e2e.ps1` (real-host
harness), `scripts/qa/reports/` (pre-fix baseline + final real-host reports),
`docs/fork-audit.md` (§7 acceptance criteria).

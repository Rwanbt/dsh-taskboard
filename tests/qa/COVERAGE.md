# Coverage mission — dsh-taskboard (Agent D)

Build under test: `HEAD 13d1107` working tree; `npm run build` → 68 files, 1.30 MB.

Tooling added (no product source touched):
- devDependency `@vitest/coverage-v8@^3.2.7` (matches installed vitest 3.2.7)
- script `"test:coverage": "vitest run --coverage"`
- `vitest.config.ts`: `coverage: { provider: 'v8', include: ['src/**'], reporter: ['text-summary', 'json-summary'] }`
  (Vitest 3 names the option `reporter` singular; `reporters` is silently ignored and yields the default html/text/clover/json set.)

## Global

| Metric | Baseline (884 tests) | After (975 tests) |
| --- | --- | --- |
| Statements | 88.35 % | 88.55 % |
| Branches | 82.61 % | 82.92 % |
| Functions | 79.03 % | 79.33 % |
| Lines | 88.35 % | 88.55 % |

## Targeted files (lines / branches / functions)

| File | Before | After |
| --- | --- | --- |
| `src/client/board/Select.tsx` | 82.77 / 65 / 55.55 | **100 / 91.2 / 88.88** |
| `src/client/styles.ts` | 100 / 66.66 / 100 | **100 / 100 / 100** |
| `src/client/board/Icon.tsx` | 100 / 100 / 100 | 100 / 100 / 100 (already full; regression guard added) |
| `src/shared/dependencies.ts` | 100 / 96.9 / 100 | **100 / 97.97 / 100** |
| `src/shared/hierarchy.ts` | 98.98 / 99.07 / 100 | **100 / 100 / 100** |

Not targeted (unchanged): `host/routes.ts` 90.28/78.9/100, `host/scheduler.ts` 88.49/75.56/88, `host/store.ts` 96.91/93.66/100, `host/tools.ts` 93.12/81.38/80.

## New test files

- `tests/select.spec.tsx` — 27 tests: ARIA combobox/listbox contract, portalled popup,
  Arrow/Home/End/Enter/Space/Escape/Tab, disabled rows, typeahead window/reset,
  outside-pointerdown close, viewport clamping, resize/scroll re-positioning,
  scrollIntoView guard, and two `it.fails` documents for confirmed bugs.
- `tests/icon.spec.tsx` — 34 tests: every declared `IconName` (read from the
  component source) renders a decorative 16×16 stroked SVG with
  `aria-hidden`/`focusable="false"`, plus size override and unknown-name safety.
- `tests/styles-invariants.spec.ts` — 11 tests: DSH token bridge on `<body>`,
  flat-pass `.dsh-atb-card` final cascade (border-color transparent, no shorthand
  in the last rule), Select popup floating-surface recipe, `.dsh-atb-icon` hook,
  `injectStyles()` ownership/idempotency/re-attach/no-DOM behaviour.
- `tests/qa/qa-graph-edge-cases.spec.ts` — 20 tests: multi-hop cycle, dangling
  intermediate id, shared reachability, over-limit/duplicate/self/cross-workspace,
  index equivalence, downstream traversal, hierarchy cyclic subtree, depth-cap
  re-link, trashed-record shape-only validation, progress/ancestor/descendant
  edge cases.

## Review findings (read-only on src)

1. **MEDIUM — Escape in an open Select also closes the enclosing form modal.**
   `src/client/board/Select.tsx:146-148` handles Escape on `window` capture with
   `preventDefault()` but no `stopPropagation()`, so the event still reaches
   `TaskFormModal`'s `document` keydown listener
   (`src/client/board/TaskFormModal.tsx:289-296`), closing the whole create/edit
   form and losing unsaved input. `PrerequisitePicker.tsx:132-139` has the same
   pattern. Documented as `it.fails` in `tests/select.spec.tsx`; when fixed, flip
   it to a normal assertion.
2. **LOW (a11y) — Home/End can make a disabled row the active descendant.**
   `Select.tsx:175-176` sets the index unconditionally; a disabled edge row gets
   `aria-activedescendant` and Enter does nothing (WAI-ARIA expects disabled rows
   to be skipped, as `openList` already does). Documented as `it.fails`.
3. **LOW — typeahead buffer is not reset when the list closes**
   (`Select.tsx:72,183-190`): reopening within 700 ms continues the previous
   buffer (select "Delta", reopen, type "b" searches "db"). Reported only.
4. **MEDIUM (pre-existing, not fork code) — ledger lock aborts on transient EPERM.**
   `src/host/ledger-lock.ts:86-88` only tolerates `EEXIST` from `mkdirSync`; on
   Windows a concurrent lock-directory `rmdirSync` can surface `EPERM`/`ENOENT`
   and the whole ledger mutation fails instead of retrying. Reproduced by
   coverage-instrumented parallel runs: `tests/ledger-lock.spec.ts` intermittently
   fails at line 119 with `EPERM ... mkdir ... ledger.json.lock`; the same spec
   passes 8/8 isolated. Suggested fix: treat `EPERM`/`EACCES`/`ENOENT` like
   `EEXIST` and fall through to `recoverLock`/backoff.
5. **INFO — import-replace hierarchy validation is O(n²)** for large imported
   trees: `routes.ts` calls `validateParent` per imported task and each call
   rebuilds `childrenByParent(tasks)`. Fine at normal sizes; a 1000-task tree
   import would pay ~10^6 map inserts.
6. **INFO — popup placement can overflow a short viewport bottom** when
   `spaceBelow < estimated` but `rect.top <= spaceBelow` (`Select.tsx:84-89`);
   cosmetic, not asserted as a test.

## Notes

- `npx vitest run` (no coverage): 70 files / **975 tests / 0 failed**.
- Coverage runs used `--retry=2` only to absorb the pre-existing `ledger-lock`
  Windows race above; the plain full suite is green without retries.
- The two `it.fails` tests assert current buggy behaviour, so they count as
  passing. Fixing either bug will make its `it.fails` fail — flip it then.
- Suggested repo hygiene for the Lead: add `coverage/` to `.gitignore`
  (`coverage/coverage-summary.json` is currently untracked).

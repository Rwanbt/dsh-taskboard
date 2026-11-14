# Mobile focus mode — swipe carousel, synced tabs, compact toolbar

Branch `feat/mobile-focus-swipe-v2` (stacked on `feat/ui-deepseek-pastel`, so the
four colour modes ship with it). Reference: the V2 prototype
(`DSH_TaskBoard_Mobile_Swipe_Prototype_V2.html`) and its two captures.

This document explains what was built, why each decision was taken, and what the
real-host validation actually proved — including its limits.

---

## 1. Scope map: prototype → plugin

The prototype is a standalone HTML page that also draws the DSH shell (sidebar,
host bar). That shell is **out of the plugin's scope**: the plugin is a panel
inside the real harness. Everything the prototype does *inside* the panel was
ported; everything it does to the shell was not touched.

| Prototype behaviour | In the plugin |
| --- | --- |
| One column per page, native `scroll-snap` | `@media (max-width: 760px)`, rail `scroll-snap-type: x mandatory`, columns `flex: 0 0 100%`, `scroll-snap-stop: always` |
| Two columns per page in phone landscape | `@media (orientation: landscape) and (max-height: 680px) and (max-width: 1380px)`, columns `flex: 0 0 calc((100% - 9px) / 2)` |
| Status tabs follow the finger | rail `scroll` listener → nearest snap offset → `aria-selected` (railed through the same helper the tab click uses) |
| Tabs scroll the carousel | tab click / arrow keys → `scrollTo({ left: pageTarget })` with a 1 s explicit-selection lock so the smooth scroll cannot bounce the selection back |
| Page counter `← 2/5 →` | `.dsh-atb-swipecue` in the tab row |
| Compact toolbar (search, filters, actions icons) | `.dsh-atb-mobileactions` + two bottom sheets; desktop toolbar untouched (`display: contents` wrappers) |
| Floating create button | `.dsh-atb-fab`, bottom-right, inside the panel, safe-area aware |
| Bottom-sheet modals | every board modal is anchored to the bottom edge below 760 px |
| Bottom-sheet task detail | `.dsh-atb-detailpanel` becomes a fixed bottom drawer in portrait |
| Sidebar / host bar compaction | **not ported** (host shell; the plugin never styles host elements) |

Deliberate deviations, each with a reason:

1. **The column head stays visible in portrait.** The prototype hides it because
   its columns carry no controls. The real column head holds the execution-queue
   chip (`in_progress`) and the fold buttons: hiding it would remove business
   functionality. It is compacted to 34 px instead.
2. **Fold state is ignored in focus mode.** A 42 px sliver has no page rhythm and
   would strand the swipe, so columns are always expanded while a carousel is
   shown; the fold buttons stay a desktop affordance.
3. **The rail is scrolled to the selected page only on entering focus mode**, not
   on every render. The prototype re-snaps on each render, which can yank the
   carousel out from under a finger during a data refresh.
4. **Opening status is "To do".** The prototype starts on Backlog; on a phone the
   actionable column is the useful landing page.

---

## 2. Architecture

New modules (all display-only, no ledger access):

| File | Responsibility |
| --- | --- |
| `src/client/board/mobile.ts` | The two focus media queries, `useFocusMode()` (matchMedia + dimensions fallback), and the pure snap geometry: `columnOffsets`, `indexAtScroll`, `scrollTarget`, `pageLabel`, `stepTabIndex`, `statusAt`, `indexOfStatus`. Also owns `UNCLASSIFIED_FILTER` (shared with the filters sheet). |
| `src/client/board/MobileSheets.tsx` | `MobileSheet` (dialog shell + Escape + backdrop), `MobileFiltersSheet` (project / category / sort / urgency / waiting-for-me + reset), `MobileMenuSheet` (grouping, other tasks, settings, diagnostics, import, export ×2), `hasActiveFilters`, `resetFilters`. |
| `TaskBoard.tsx` | Focus state, rail/tab refs, two-way sync, explicit-selection lock, tab a11y, mobile action cluster, FAB, sheets, per-column `id`s and `tabpanel` roles. |
| `TaskCard.tsx` | `SWIPE_TAP_SLOP` / `SWIPE_TAP_WINDOW_MS`: a horizontal pan never opens a card, while a tap (and any later mouse click) keeps its exact previous behaviour. |
| `styles.ts` | Two focus media blocks + bottom-sheet, FAB, tab-rail and sheet styles. |

### Two-way sync, without a second navigation model

The rail is the single source of truth:

```
finger / trackpad / scrollTo  ──►  .dsh-atb-columns (scrollLeft)
                                      │  scroll listener (passive)
                                      ▼
                          indexAtScroll(offsets, scrollLeft)  ──►  activeStatus  ──►  tabs
tab click / ← →  ──►  selectStatus()  ──►  scrollTarget()  ──►  rail.scrollTo()
```

* `indexAtScroll` picks the nearest snapped column (ties go forward), and in the
  two-up landscape layout the end of the rail maps to the **last** status, since
  `Done` can never become the leftmost column when two are visible.
* A tab click (or an arrow key) sets an explicit-selection lock for one second:
  the intermediate scroll events of the smooth animation that it starts must not
  re-select the columns it flies over.
* Keyboard: `←`/`→`/`Home`/`End` move a roving `tabIndex` and move focus with it;
  `Tab` keeps native behaviour.

### Touch vs tap

`TaskCard` remembers where a touch started. A click that follows a touch *inside
the 800 ms gesture window* and travels more than 10 px is a swipe tail and is
discarded; anything else — a real tap, a mouse click later on, a click during
drag-and-drop — behaves exactly as before. The time window matters: without it a
swipe on a phone swallowed the next trackpad click on the same card (found on the
real host, covered by a regression test).

---

## 3. Business features — nothing removed

| Feature | Desktop | Focus mode |
| --- | --- | --- |
| Five statuses (backlog → done) | five columns | five pages, tab rail |
| Drag & drop between columns | HTML5 DnD | `draggable=false` (HTML5 DnD is inert on touch); the card's review/move actions and the detail pane remain |
| Search / project / category / sort filters | inline toolbar | filters sheet (same controller calls) |
| Urgency chips + "Waiting for me" | inline | filters sheet |
| Group by project + per-group collapse | head toggle | actions sheet + the same group headers |
| Detail pane, review actions, checklist, comments | inline panel | bottom drawer |
| Queue panel, diagnostics, settings, import/export, templates | toolbar | actions sheet / FAB (same controller calls) |
| Colour modes (4), density, intensities, classification banner | unchanged | unchanged (verified: 12 distinct category surfaces at 390 px) |
| DeepSeek theme tokens | unchanged | unchanged (`light-dark()`, no host-element styling) |

The `.dsh-atb-toolbar-filters` / `.dsh-atb-toolbar-actions` wrappers use
`display: contents` on desktop, so the toolbar's flex layout is byte-identical
above 760 px — no desktop regression by construction.

---

## 4. Validation

### 4.1 Automated tests

* `tests/mobile-focus.spec.ts` — 16 tests: the exported media queries match the
  stylesheet verbatim, focus-shape derivation (including the overlap and the
  matchMedia-less fallback), snap geometry (nearest page, ties, end-of-rail,
  clamping, NaN), page labels, roving tab indexes, and the CSS contract
  (mandatory snapping, `scroll-snap-stop`, one/two-up widths, safe areas,
  bottom sheets, no host-element styling).
* `tests/mobile-focus-ui.spec.tsx` — 18 tests on the real components: swipe →
  tab, tab → rail with lock, `role="tab"`/`aria-controls`/`tabpanel` wiring,
  arrow/Home/End, two-up end-of-rail, resize into focus mode, compact toolbar,
  filters sheet reset, actions sheet (grouping + all actions), FAB → new-task
  sheet, Escape/backdrop close, folded columns expanded, drag disabled on touch,
  desktop unchanged, touch-pan never opens a card, tap and stale-touch-window
  behaviour, colour modes in focus mode.
* Full suite: **1323 tests / 97 files, all green**; `npm run typecheck` and
  `npm run build` clean.

### 4.2 Real host

`scripts/qa/pastel-visual-host.ps1 -CaptureScript mobile-swipe-capture.mjs` boots
an **isolated** DSH home, links this working tree, seeds 340 categorised tasks
and drives the production bundle in Chromium. `scripts/qa/mobile-swipe-capture.mjs`
writes `metrics-mobile.json` + `visual-report-mobile.md` and 13 screenshots.

Result: **58/58 checks passed** (see `docs/design/mobile-swipe/visual-report.md`).
Highlights:

* desktop 1440×900: five columns (236 px each), drag enabled, no FAB, filter
  cluster `display: contents`, zero page overflow, 12 distinct category surfaces;
* portrait 390×844: `x mandatory` snapping, five 370 px pages, five tabs, opens
  on `todo` (2/5), toolbar compacted, FAB 54×54 at (320, 774), zero overflow,
  title contrast 10.5:1;
* tab click → rail exactly 1110 px (page 4) and the tab selected;
* carousel scroll → tab `in_progress` and counter 3/5; the CSS snap engine
  re-settles an off-page offset (888 → 740 px);
* the tallest column scrolls independently (0 → 1200 px) while the carousel and
  the other four columns stay put;
* touch events reach the page (1 start / 16 moves / 1 end), a horizontal pan on
  a card opens nothing, a click opens the detail as a 390 px bottom drawer that
  closes again;
* light theme comes from the host presenter (not the plugin): light surfaces,
  10.4:1 title contrast, carousel intact;
* landscape 844×390: two 380 px columns per page, end of rail selects `done`
  (5/5), tab click back to backlog at 0 px;
* back to 1440×900: five columns and desktop drag restored.

### 4.3 Honest limits

* Synthetic touch **scrolling** cannot be produced in this headless Chromium
  build (no GPU compositor): `Input.dispatchTouchEvent` delivers touch events but
  produces no scroll, `Input.synthesizeScrollGesture` is inert, and wheel events
  over the panel do not scroll it — all four mechanisms were probed before
  choosing the fallback. Scrolling is therefore driven through real scroll
  positions, which is exactly what a settled swipe leaves behind: the snap
  engine, the scroll → tab sync and the resting page are then the browser's own
  behaviour. Touch *events* are dispatched for real and prove gesture delivery
  and the swipe-vs-tap guard.
* The workspace was additionally hit by a first-run shell dialog that covered the
  panel; the capture dismisses it with real mouse clicks and records every step
  (`shellOverlays`) so the evidence never pretends the panel was uncovered.
* Firefox/Safari were not measured (Chromium only, as in the previous UI pass).
* Landscape was validated as a CSS viewport shape, with a desktop UA (the plugin
  answers to viewport media queries only).

---

## 5. Files touched

```
src/client/board/mobile.ts                  (new)
src/client/board/MobileSheets.tsx           (new)
src/client/board/TaskBoard.tsx              (focus mode, sync, toolbar, FAB, sheets)
src/client/board/TaskCard.tsx               (swipe-vs-tap guard)
src/client/board/Icon.tsx                   (filter, menu glyphs)
src/client/styles.ts                        (focus blocks, sheets, FAB, cue)
src/client/i18n/{zh,en,ru}.ts               (mobile keys, parity kept)
tests/mobile-focus.spec.ts                  (new)
tests/mobile-focus-ui.spec.tsx              (new)
scripts/qa/mobile-swipe-capture.mjs         (new)
scripts/qa/pastel-visual-host.ps1           (-CaptureScript)
docs/design/mobile-swipe/**                 (captures, metrics, report)
docs/design/MOBILE-FOCUS-SWIPE-IMPLEMENTATION.md (this file)
```

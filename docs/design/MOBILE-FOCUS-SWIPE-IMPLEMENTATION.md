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

### Column tabs: miniature column heads

The status rail above the carousel is not a row of filter chips. Each tab is a
compact copy of the desktop column head (`.dsh-atb-colhead`), so the two layouts
speak the same visual language:

| Element | Desktop column head | Mobile column tab |
| --- | --- | --- |
| Surface | `--atb-surface-sunken`, 1 px `--atb-border` | same (raised to `--atb-bg-1` when active) |
| Status marker | short 3 px rule on the top edge (`::before`, `--atb-status`) | same rule, inset 11 px (8 px when active) |
| Label | 12.5 px / 680 | 12 px / 640 (680 active) |
| Counter | pill, 10.5 px, `--atb-hover` | same |
| Height | 54 px (a full header) | 34 px portrait, 30 px landscape |

Both layouts read the **same** `--atb-status` token per status, so the rule
colours cannot drift: grey `backlog`, blue `todo`, amber `in_progress`, violet
`in_review`, green `done` (verified pixel by pixel against the desktop heads).

States: the inactive rule sits at `opacity: .45`; the active tab widens it
(11 → 8 px inset), turns it opaque, raises the surface, strengthens the text and
transitions all three over 160 ms — the subtle change animation. `:active` adds a
1 px press translate, and the row is a horizontal scroller (`overflow-x: auto`),
so five tabs never squeeze: measured 497 px of tabs in a 317 px rail, with the
selected tab auto-centred. The component is dedicated
(`src/client/board/MobileStatusTabs.tsx`) and owns only the visuals and the
`tablist`/`tab` semantics — the swipe sync stays in the board.

---

## 4. Validation

### 4.1 Automated tests

* `tests/mobile-focus.spec.ts` — 20 tests: the exported media queries match the
  stylesheet verbatim, focus-shape derivation (including the overlap and the
  matchMedia-less fallback), snap geometry (nearest page, ties, end-of-rail,
  clamping, NaN), page labels, roving tab indexes, and the CSS contract
  (mandatory snapping, `scroll-snap-stop`, one/two-up widths, safe areas,
  bottom sheets, no host-element styling) plus the column-tab contract (top
  status rule, shared palette with the desktop heads, no pill geometry, touch
  height, pressed state, scrollable rail).
* `tests/mobile-focus-ui.spec.tsx` — 19 tests on the real components: swipe →
  tab, tab → rail with lock, `role="tab"`/`aria-controls`/`tabpanel` wiring,
  arrow/Home/End, two-up end-of-rail, resize into focus mode, compact toolbar,
  the tabs rendered as column heads (label + counter, no dot chip, one active
  tab that follows the carousel), filters sheet reset, actions sheet (grouping +
  all actions), FAB → new-task sheet, Escape/backdrop close, folded columns
  expanded, drag disabled on touch, desktop unchanged, touch-pan never opens a
  card, tap and stale-touch-window behaviour, colour modes in focus mode.
* Full suite: **1338 tests / 98 files, all green**; `npm run typecheck` and
  `npm run build` clean.

### 4.2 Real host

`scripts/qa/pastel-visual-host.ps1 -CaptureScript mobile-swipe-capture.mjs` boots
an **isolated** DSH home, links this working tree, seeds 340 categorised tasks
and drives the production bundle in Chromium. `scripts/qa/mobile-swipe-capture.mjs`
writes `metrics-mobile.json` + `visual-report-mobile.md` and 14 screenshots.

Result: **68/68 checks passed** (see `docs/design/mobile-swipe/visual-report.md`).
Highlights:

* desktop 1440×900: five columns (236 px each), drag enabled, no FAB, filter
  cluster `display: contents`, zero page overflow, 12 distinct category surfaces;
* portrait 390×844: `x mandatory` snapping, five 370 px pages, five tabs, opens
  on `todo` (2/5), toolbar compacted, FAB 54×54 at (320, 774), zero overflow,
  title contrast 10.5:1;
* tab click → rail exactly 1110 px (page 4) and the tab selected;
* mobile column tabs measured as column heads: 34 px high, label + counter on
  every tab, **no dot chip**, a 3 px status rule on the top edge matching the
  desktop column-head colour of that status pixel for pixel
  (grey 172/179/184, blue 123/170/254, amber 245/159/10, violet 166/138/250,
  green 34/197/94), active rule opaque and wider (8 px vs 11 px inset) on a
  raised surface (35/35/36 vs 28/29/31) with a stronger text weight, and a rail
  that scrolls (497 px of tabs in 317 px) instead of squeezing;
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

### 4.3 Fixed on the way: the checklist printed one letter per line

Reported from a real phone: opening a task whose **acceptance checklist** carried
an evidence note printed the item label **one character per line** (48 lines of a
single glyph), making the block unreadable.

Mechanism, measured on the real host before touching anything: the row was
`.dsh-atb-cl-item { display: flex }` with the label at `flex: 1` (basis `0`) and
the evidence column at `flex-shrink: 0` holding a `white-space: nowrap` note
capped at `max-width: 280px`. In a 326 px row inside the mobile drawer the meta
claimed 280 px, the label had **0 px** left and `word-break: break-word` wrapped
it per character.

| Measurement (390×844 drawer) | Before | After |
| --- | --- | --- |
| label box | **0 × 832 px** | 139 × 48 px |
| characters per line | **1.3** | 20.3 |
| checklist block height | 949 px | 165 px |
| desktop 1440×900 label | (unchanged layout) | 710 × 16 px, 1 line |

Fix: the label keeps a real basis (`flex: 1 1 140px`), the evidence column
becomes shrinkable and capped (`flex: 0 1 auto; min-width: 0; max-width: 42%`),
and its note stays a 280 px truncated preview. Desktop is untouched: the meta
still resolves to exactly 280 px on a 1048 px row. Pinned by
`tests/checklist-layout.spec.ts` (the CSS determinants) and by
`scripts/qa/detail-audit.mjs` (the real geometry, portrait + desktop).

### 4.4 Fixed on the way: the checklist fell below the sheet

Follow-up report: "the acceptance checklist is no longer visible on my phone".
Measured with `detail-audit.mjs` on a task that has a checklist, the block was
*rendered* but the drawer only shows its first ~270–709 px, and the checklist sat
**after** the execution report — so on a small portrait phone or in landscape it
started below the visible sheet:

| Shape | Before the reorder | After |
| --- | --- | --- |
| 390×844 portrait | 137 px above the fold | 432 px above |
| 360×640 portrait | **58 px below the fold** | 237 px above |
| 412×915 portrait | 224 px above | 519 px above |
| 844×390 landscape | **124 px below the fold** | 86 px above |

Fix: in the review/done section (and in the fallback branch) the **acceptance
checklist now comes before the execution report** — it is the gate the reader
opens the task for, and the report can be long. Nothing is hidden or collapsed:
the sheet still scrolls, the block is simply on screen in every phone shape.

### 4.5 Fixed on the way: the comment composer on a phone

Report: the writing area at the bottom of the drawer was "a tiny text field on
the left, unusable on a smartphone".

Mechanism: `.dsh-atb-composer` is a single row — `textarea (flex: 1; basis 0)`,
image button, *Publier*, and in review *Envoyer et laisser l'agent traiter*.
On a 360–390 px sheet the two labelled buttons took the row, so the textarea
collapsed to a sliver at the left; and its 12.5 px font makes iOS zoom the whole
page as soon as it gets focus, which alone makes it unusable.

| Measurement | Before | After |
| --- | --- | --- |
| textarea at 390×844 | sliver (basis 0, row shared with 3 buttons) | **356 × 108 px**, full width |
| textarea at 360×640 | sliver | **326 × 108 px** |
| font size | 12.5 px (iOS auto-zoom on focus) | **16 px** |
| buttons | squeezed beside the field | own row below, `Publier` 66 px, deliver 236 px (wraps to a full line at 360 px) |
| landscape 844×390 | row layout | row kept, field 385 × 64 px, font 16 px |

The desktop composer is untouched (still one flex row). Pinned by
`tests/mobile-composer.spec.ts` and measured by `scripts/qa/detail-audit.mjs`
(`composer` block of `docs/design/checklist-layout/metrics.json`).

### 4.6 Honest limits

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
src/client/board/MobileStatusTabs.tsx        (new — column tabs as column heads)
src/client/board/compact.ts                  (new — measured desktop toolbar density)
src/client/board/TaskBoard.tsx              (focus mode, sync, toolbar, FAB, sheets)
src/client/board/TaskCard.tsx               (swipe-vs-tap guard)
src/client/board/Icon.tsx                   (filter, menu, cog glyphs)
src/client/styles.ts                        (focus blocks, column tabs, sheets, FAB, cue)
src/client/i18n/{zh,en,ru}.ts               (mobile keys, parity kept)
tests/mobile-focus.spec.ts                  (new)
tests/mobile-focus-ui.spec.tsx              (new)
tests/toolbar-compact.spec.tsx               (new)
tests/checklist-layout.spec.ts               (new — checklist label squeeze regression)
scripts/qa/mobile-swipe-capture.mjs         (new)
scripts/qa/desktop-header-capture.mjs        (new)
scripts/qa/pastel-visual-host.ps1           (-CaptureScript)
docs/design/mobile-swipe/**                 (captures, metrics, report)
docs/design/desktop-header/**                (captures, metrics, report)
docs/design/MOBILE-FOCUS-SWIPE-IMPLEMENTATION.md (this file)
docs/design/DESKTOP-HEADER-COMPACTION.md     (header two-row contract)
```

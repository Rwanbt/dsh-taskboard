# Desktop header: two rows, always

Status: implemented on `feat/mobile-focus-swipe-v2` (stacked on `feat/ui-deepseek-pastel`), 2026-11-14.
Scope: the board header only — no business rule, no theme, no card, no mobile change.

## What was wrong

The header was a title row plus a **wrapping** filter row that also carried the
five view actions. Measured on the real host (1440×900 → board 1160 px), the
toolbar alone needed two lines, so the whole header cost **three**:

| Row | Content |
|---|---|
| 1 | title · counter · *By project* · *New task* |
| 2 | search · 3 selects · 3 urgency chips · *Waiting for me* |
| 3 | *Other tasks* · *Settings* · *Diagnostics* · *Import* · *Export* · version |

Even a 1920-wide window (board 1640 px) kept the actions on a separate line,
because the `flex: 1` spacer could not push them onto the row that was already
full.

## The two structural changes

1. **The action cluster moved next to the title.** A view command belongs to
   the view name, not to the filter row. `.dsh-atb-toolbar-actions` is still
   `display: contents`, so on desktop its children remain plain flex items —
   now the title row's. On a phone the same cluster is `display: none`, exactly
   as before (the actions sheet mirrors it).
2. **The header measures itself and publishes a density.** `board/compact.ts`
   observes the toolbar width (content box, padding excluded) and writes
   `data-atb-bar="wide|compact|tight"` on the board root. The stylesheet drops
   *words*, never controls.

The guide is the measured panel width, not the viewport: the DSH sidebar can be
expanded, collapsed or resized, so a viewport breakpoint would be wrong exactly
where it matters.

| Density | From (toolbar) | What changes |
|---|---|---|
| `wide` | 1100 px | nothing — every label visible |
| `compact` | 960 px | the five action buttons become 34 px icons (tooltip + `aria-label`); the version pill stays |
| `tight` | below 960 px | urgency chips keep only their colour dot, the grouping label and the version pill are hidden, the selects clamp to 128 px |

Every icon-only control keeps its accessible name (`aria-label`) and its
tooltip (`title`); no control is removed at any width.

## The settings icon

The previous glyph was a ring with eight detached rays — it read as a
brightness/sun toggle. It is now a real cog (closed outline + round hub, drawn
on a 24-unit grid and scaled into the 16-unit box with the stroke compensated to
the charte's 1.5 px). A unit test pins the silhouette and forbids the old rays.

## Measured result (real isolated DSH host, `scripts/qa/desktop-header-capture.mjs`)

31/31 checks pass at six widths. Rows are computed from the vertical centre of
every real flex item, so a chip sitting 6 px lower is not mistaken for a new
line.

| Viewport | Board | Title row | Filter row | Total | Density |
|---|---|---|---|---|---|
| 1920×900 | 1640 px | 1 | 1 | **2** | wide |
| 1680×900 | 1400 px | 1 | 1 | **2** | wide |
| 1512×900 | 1232 px | 1 | 1 | **2** | wide |
| 1440×900 | 1160 px | 1 | 1 | **2** | wide |
| 1280×860 | 1000 px | 1 | 1 | **2** | compact |
| 1120×860 | 840 px | 1 | 1 | **2** | tight |

Also verified at every width: the toolbar neither overflows nor scrolls
(`scrollWidth == clientWidth`), the page gains no horizontal overflow, the
action cluster really lives in `.dsh-atb-head`, and the labels are *rendered*
`display: none` exactly in the densities that claim to drop them
(`action=none chip=block` in compact, `none/none` in tight).

Beyond 1100 px no label is lost at all — this is what a 1440-class laptop sees.

## Honest limits

- Below a ~900 px toolbar (a window narrower than ~1200 px with the sidebar
  expanded, i.e. five ~140 px columns) the filter row still wraps onto a second
  line: the header then costs three rows. Those widths are already past the
  point where five side-by-side columns are usable, and focus mode takes over at
  760 px. No control is ever clipped to fake a single line.
- The thresholds are calibrated on the shipped labels (EN/FR/RU are within a few
  pixels of each other; ZH is shorter). A much longer translation would push the
  boundary up, never break it: the row wraps instead of overflowing.
- Firefox/Safari were not measured here; the implementation uses flex, attribute
  selectors and `ResizeObserver` only.

## Evidence

- [visual-report.md](desktop-header/visual-report.md) — the 31 checks, verbatim.
- [metrics.json](desktop-header/metrics.json) — per-item geometry (x, width, row) for all six widths.
- Captures: [1920](desktop-header/captures/desktop-1920.png) · [1440](desktop-header/captures/desktop-1440.png) · [1280](desktop-header/captures/desktop-1280.png).
- Unit tests: `tests/toolbar-compact.spec.tsx` (9) + `tests/icon.spec.tsx` (settings cog regression).

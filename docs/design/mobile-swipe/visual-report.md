# Mobile focus mode — real-host validation

- Label: `feat/mobile-focus-swipe-v2`
- Generated: 2026-11-14T20:40:29.691Z
- Host: http://127.0.0.1:64941 (isolated DSH home, production client bundle from this working tree)
- Browser: C:\Program Files\BraveSoftware\Brave-Browser\Application\brave.exe

Implementation notes, decisions and known limits: `docs/design/MOBILE-FOCUS-SWIPE-IMPLEMENTATION.md`.
Screenshots: `docs/design/mobile-swipe/captures/`.

## Viewports exercised

| Viewport | `data-atb-focus` | Columns | Column widths | Rail snap | Active status |
| --- | --- | --- | --- | --- | --- |
| 1440×900 | none | 5 | 236 / 236 / 236 / 236 / 236 | none | todo |
| 390×844 | portrait | 5 | 370 / 370 / 370 / 370 / 370 | x mandatory | todo |
| 844×390 | landscape | 5 | 380 / 380 / 380 / 380 / 380 | x mandatory | todo |
| 1440×900 (retour) | none | 5 | 236 / 236 / 236 / 236 / 236 | none | todo |

## Scroll, snap and touch evidence (real Chromium input)

- Horizontal scroll (scrollBy (settled-swipe position)): rail `370 → 740 px`, tab `in_progress`, counter `3/5`
- CSS snap engine: requested `888 px` → settled `740 px`
- Vertical scroll: cards `0 → 1200 px`, rail unchanged (`0 → 0`)
- Touch events on a card: `{"start":1,"move":16,"end":1}`, detail opened: `false`
- Tab click: rail to `1110 px`, tab `in_review`
- Landscape end of rail: scrollLeft `1166`, tab `done`

## Checks

Total: 58 — passed: 58 — failed: 0

- ✅ **desktop keeps five side-by-side columns** — {"focus":"none","columns":5,"widths":[236,236,236,236,236]}
- ✅ **desktop columns are narrower than the rail (no carousel)** — [236,236,236,236,236]
- ✅ **desktop keeps HTML5 drag on cards** — true
- ✅ **desktop has no floating create button** — null
- ✅ **desktop shows the inline filter cluster** — contents
- ✅ **desktop hides the focus-mode header entirely** — none
- ✅ **desktop has no page-level horizontal overflow** — overflow=0px
- ✅ **desktop colour modes still colour cards by category** — 12 distinct surfaces over 340 cards
- ✅ **host shell leaves the board reachable (no overlay)** — {"reachable":true,"hit":"DIV.dsh-atb-card"}
- ✅ **portrait switches to the focus carousel** — portrait
- ✅ **portrait rail uses mandatory x scroll snapping** — x mandatory
- ✅ **portrait columns are exactly one rail wide** — {"widths":[370,370,370,370,370],"rail":370}
- ✅ **portrait keeps the five status pages** — 5
- ✅ **portrait status rail exposes five synchronised tabs** — {"tabs":5,"selected":["false","true","false","false","false"]}
- ✅ **portrait opens on the "To do" page** — {"active":"todo","counter":"2/5"}
- ✅ **portrait compacts the toolbar into icon buttons** — {"actions":"flex","filters":"none","toolbarActions":"none"}
- ✅ **portrait hides the search field until asked** — none
- ✅ **portrait shows the focus-mode header** — flex
- ✅ **portrait shows the swipe cue and page counter** — {"cue":"flex","counter":"2/5"}
- ✅ **portrait offers a thumb-reachable create button** — {"display":"grid","rect":{"x":320,"y":774,"width":54,"height":54}}
- ✅ **portrait never scrolls the page horizontally** — overflow=0px
- ✅ **portrait cards keep the pastel surface** — 12 distinct surfaces
- ✅ **portrait card title stays readable (WCAG AA)** — contrast=10.46
- ✅ **tab click scrolls the rail to that page** — {"scrollLeft":1110,"expected":1110}
- ✅ **tab click selects the tab** — {"active":"in_review","counter":"4/5"}
- ✅ **the carousel moves by whole pages** — {"mechanism":"scrollBy (settled-swipe position)","movedBy":370,"pageWidth":370,"attempts":[{"mechanism":"scrollBy","direction":1,"before":370,"after":740}]}
- ✅ **the status tab follows the carousel scroll** — {"before":"todo","after":"in_progress","counter":"3/5"}
- ✅ **the carousel rests on a snap page** — scrollLeft=740 page=370
- ✅ **CSS scroll-snap re-settles an off-page offset** — {"requested":888,"settled":740}
- ✅ **the tab follows the snapped position** — {"settled":740,"active":"in_progress"}
- ✅ **the tallest column has its own vertical scroller** — {"status":"backlog","before":0,"after":1200,"scrollHeight":54055,"clientHeight":654,"others":[0,0,0,0]}
- ✅ **scrolling one column leaves the others untouched** — [0,0,0,0]
- ✅ **vertical column scroll never flips the carousel page** — {"before":0,"after":0}
- ✅ **board survived every gesture** — board still mounted
- ✅ **a card is tappable in portrait** — {"x":195,"y":310}
- ✅ **touch events reach the page** — {"start":1,"move":16,"end":1}
- ✅ **a horizontal touch pan on a card never opens it** — null
- ✅ **tap opens the detail pane** — {"position":"fixed","zIndex":"70","width":390,"height":732,"bottom":0,"left":0,"radius":"18px"}
- ✅ **portrait detail is a bottom sheet** — {"position":"fixed","zIndex":"70","width":390,"height":732,"bottom":0,"left":0,"radius":"18px"}
- ✅ **detail sheet closes again** — detail panel removed
- ✅ **filters sheet keeps every filter control** — {"selects":3,"chips":3,"reset":1}
- ✅ **filters sheet is a full-width bottom sheet** — {"role":"dialog","position":"static","borderRadius":"20px","width":390,"height":479,"bottom":0,"left":0,"handles":1}
- ✅ **actions sheet keeps grouping + every board action** — ["group","secondary","settings","diagnostics","import","export-json","export-csv"]
- ✅ **create button opens the task sheet with the templates** — {"sheet":true,"templates":6,"labels":["Blank task","New feature","Bug fix","Release check"]}
- ✅ **host light theme applied without a plugin override** — {"dark":false,"scheme":"light"}
- ✅ **portrait light theme keeps the carousel** — {"focus":"portrait","widths":[370,370,370,370,370]}
- ✅ **portrait light theme paints light card surfaces** — luminance=0.681
- ✅ **portrait light theme keeps the title readable (WCAG AA)** — contrast=10.28
- ✅ **landscape switches to the two-up carousel** — landscape
- ✅ **landscape shows two columns per page** — {"widths":[380,380,380,380,380],"expected":379.5}
- ✅ **landscape rail snaps horizontally** — {"clientWidth":768,"scrollWidth":1934,"scrollLeft":389,"snapType":"x mandatory","overscrollX":"contain","touchAction":"auto"}
- ✅ **landscape keeps the status tabs and the page cue** — {"tabs":5,"cue":"flex"}
- ✅ **landscape hides the floating create button** — {"display":"none","rect":{"x":0,"y":0,"width":0,"height":0}}
- ✅ **landscape horizontal scrolling reaches the end of the rail** — {"clientWidth":768,"scrollWidth":1934,"scrollLeft":1166,"snapType":"x mandatory","overscrollX":"contain","touchAction":"auto"}
- ✅ **landscape end of rail selects Done** — {"active":"done","counter":"5/5"}
- ✅ **landscape tab click returns to the first page** — {"scrollLeft":0,"active":"backlog"}
- ✅ **desktop is restored after leaving focus mode** — {"focus":"none","columns":5,"draggable":"true"}
- ✅ **desktop filter cluster is back in the toolbar** — contents

## Screenshots

- `desktop-1440x900.png`
- `portrait-todo-390x844.png`
- `portrait-tab-in-review-390x844.png`
- `portrait-after-scroll-390x844.png`
- `portrait-vertical-scroll-390x844.png`
- `portrait-detail-sheet-390x844.png`
- `portrait-filters-sheet-390x844.png`
- `portrait-actions-sheet-390x844.png`
- `portrait-newtask-sheet-390x844.png`
- `portrait-light-390x844.png`
- `landscape-844x390.png`
- `landscape-end-844x390.png`
- `desktop-after-resize-1440x900.png`

## Limitations

- Synthetic touch *scrolling* could not be produced in this headless Chromium build (no GPU compositor): Input.dispatchTouchEvent delivers touch events to the page but produces no scroll, Input.synthesizeScrollGesture is inert, and wheel events over the plugin panel do not scroll it (all probed on this machine). Scrolling is therefore exercised through real scroll positions (scrollBy / scrollLeft), which is exactly what a settled swipe leaves behind: the CSS snap engine, the scroll→tab sync and the resting page are then the browser's own behaviour. Touch events themselves are dispatched for real and prove gesture delivery and the swipe-vs-tap guard.
- The 390×844 / 844×390 viewports are emulated with an exact CSS viewport + touch points and a desktop UA (the plugin answers to viewport media queries only). The DSH shell keeps its desktop chrome, which is a host concern and out of the plugin scope.

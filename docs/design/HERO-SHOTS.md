# Hero screenshots — fictional data only

Status: hero produced 2026-11-15 on `feat/mobile-focus-swipe-v2`; the README
images were re-captured from `dev` on 2026-11-15 with `-Capture readme`. Assets:
`docs/design/hero/` and `img/`.

## Why

The board screenshots used everywhere else come from a seeded QA host that reuses
real workspace names (`default-workspace`, this repo). A hero image must not leak
any real project, path, task or person, so the hero pipeline builds its own
world:

| Field | Value |
| --- | --- |
| Projects | **Atelier Lumen**, **Nova Labs**, **Studio Kestrel** (paths `C:\demo\…`, invented) |
| Tasks | 30 invented tasks spread over the five columns (6 categories, checklists, two "waiting for human" cards) |
| People | none — no comment author, no session, no real name |
| Host chrome | cropped out: the capture clips the plugin panel only |
| Theme | **dark by default** (`-Theme light` for the light pass) |

The isolated shell also greets a fresh browser with its own **sign-in wall**
("Connectez-vous / Ajouter une clé API"). It is a *host* element — the plugin
never styles anything outside its own panel — so the capture either clicks its
close button or hides that layer for the shot. Every action is recorded in
`metrics.json` (`overlays`), and the script then proves the board is what is on
screen by hit-testing the centre of the panel (`shots[*].reachable`).

## How

```powershell
pwsh -File scripts/qa/hero-shots.ps1 -Theme dark    # boots an isolated home on port 64943
python -B scripts/qa/hero-compose.py docs/design/hero/hero-desktop-1440x900.png docs/design/hero/hero-mobile-390x844.png docs/design/hero/hero.png
```

`hero-shots.ps1` clones the isolated QA home (so the plugin is already linked),
replaces its workspace registry with the three invented projects, wipes the board
ledger, boots the host, and runs `hero-capture.mjs`, which:

1. seeds the demo ledger through the **real** import route (`/import/preview` then
   `/import`, `mode=replace`) — 30 cards created, 0 rejected;
2. forces the pastel category colour mode and grouping (localStorage, then reload);
3. emulates the requested colour scheme (the host follows it) and clears any host
   overlay that reappears — the sign-in wall mounts late, so it is checked before
   **every** shot, not once at startup;
4. captures the panel alone at 1440×900, 390×844 and 844×390 (`deviceScaleFactor: 2`).

`hero-compose.py` (Pillow) reads the desktop capture, picks the backdrop from its
measured luminance (dark panels → dark stage, light panels → light stage) and lays
the desktop panel and the phone on it with a caption.

## Result

| File | Content |
| --- | --- |
| `hero.png` | 2560×1440 composition: desktop panel + phone, dark stage, caption |
| `hero-desktop-1440x900.png` | desktop panel only (1160×900, dark pastel, grouped by the three invented projects) |
| `hero-mobile-390x844.png` | phone portrait panel (390×796, carousel + column tabs) |
| `hero-landscape-844x390.png` | phone landscape panel (788×390, two columns per page) |
| `metrics.json` | clip rectangles, card count, group labels, requested/applied theme (`dark: true`), overlay actions, per-shot `reachable` hit-test |

Measured on the current dark run: desktop panel mean luminance **0.181**, canvas
**0.137**, caption present (std 0.161 in its band); the sign-in wall was found once
and hidden (`overlays[0].hidden = ["_root_…"]`), and the board is the element under
the cursor in the centre of all three captures.

## README images

The READMEs embed four PNGs from `img/`. Three of them are captured from the
**current** build by the same harness — the fourth (`hero.png`) is the composed
image described above:

| File | Content | Source |
| --- | --- | --- |
| `img/hero.png` | 2560×1440 composition, dark stage, caption | `hero-compose.py` |
| `img/board.png` | 1760×1200 desktop panel, five columns, category colours, grouped by the demo projects | `readme-capture.mjs` |
| `img/modal.png` | 1062×725 new-task dialog, filled with demo values | `readme-capture.mjs` |
| `img/phone.png` | 780×1592 phone portrait panel (mini column heads + carousel) | `readme-capture.mjs` |

Until 2026-11-15 `img/board.png` and `img/modal.png` dated from **before** the
DeepSeek Pastel UI existed, and the READMEs loaded them through
`raw.githubusercontent.com/cloader/dsh-taskboard/…` (the upstream repository), so
the page advertised a plugin nobody could see anymore. They are now captured from
this branch and referenced with repository-relative paths.

```powershell
pwsh -File scripts/qa/hero-shots.ps1 -Capture readme -Theme dark   # isolated home, port 64943
```

`hero-shots.ps1` now links the cloned profile to **the checkout it runs from**
(a junction, not a package-manager install), so a run started from a git worktree
really serves that worktree's `lib/` — the shot cannot silently come from another
tree. `readme-capture.mjs` then:

1. seeds the same fictional ledger as the hero (`scripts/qa/demo-board.mjs`, shared
   by both capture scripts) through `/import`, `mode=replace` — 30 cards created,
   0 rejected;
2. captures the panel at a 2040 px window: the host keeps a 280 px sidebar, so the
   panel is exactly 1760 px — the halved master is 2× the README's `width="880"`;
3. clicks **New task → Blank task** exactly like a user, types demo values, blurs
   the caret and clips the dialog alone (1062×725);
4. repeats the portrait pass at 390×844 (panel 390×796).

**The dialog trap.** The first version of the script captured the dialog at the
first frame of its opening animation: `Page.captureScreenshot` re-renders the page
for the shot, which restarts `dsh-atb-pop` (`translateY(8px) scale(.98)`), so the
clip framed a dialog drawn at 98 % of its measured box — the dimmed board showed
around it and read as *two images superimposed in transparency*. Every shot now
goes through `shootElement()`, which injects `animation/transition-duration: 0s`,
runs `document.getAnimations().forEach(a => a.finish())`, waits two frames,
re-measures the rectangle **after** the capture and rethrows if it moved or if the
element still carries a transform. The capture is therefore exactly the last frame
a user sees.

The masters are written at `deviceScaleFactor: 2` in
`scripts/qa/reports/readme-<stamp>/` together with `readme-shots.json`. The
desktop and dialog masters are then halved with `System.Drawing`
(`HighQualityBicubic`) and copied over `img/`; the phone master is used as is
(2× of its 390 px layout). `readme-shots.json` records, per shot, the clip
rectangle, the hit-test proving the panel (or dialog) is what is under the
cursor, the residual transform/opacity at capture time, the 30 cards spread over
the five columns, the toolbar density (`wide`), the dialog's
`mode`/title/submit state, and the phone's `data-atb-focus`, column count and
active tab — no shot is accepted on faith.

Measured on the current dark run: `img/board.png` mean luminance **0.178**
(0.67 % near-white pixels), `img/modal.png` **0.187** (dialog surface
`35,35,36`, the four rounded corners showing the dimmed backdrop at `12,12,12`),
`img/phone.png` **0.195**; `reachable: true` on all three, dialog `mode=create`
with the demo title typed and `transform: none`, phone `focus=portrait`, 5
columns, 5 tabs, active tab `To do · 6`, and the theme applied (`dark: true`) —
the host follows `prefers-color-scheme`, the plugin never forces a theme.

## Limits

- The theme is the host's own (`prefers-color-scheme`, emulated by the capture);
  the plugin never forces a theme, so the panels show exactly what a dark-theme
  user sees.
- The sign-in wall is a shell element that a normal, signed-in user never sees;
  hiding it for a screenshot is a capture-time action, recorded in `metrics.json`,
  and it never touches plugin code or CSS.
- The backdrop, the device frame and the caption are cosmetic and only exist in
  `hero.png`; the three panel captures are untouched.
- The captures reflect the working tree at the time of the run (this branch plus
  any concurrent work in the same checkout), not a tagged release.

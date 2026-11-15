# Hero screenshots — fictional data only

Status: produced 2026-11-15 on `feat/mobile-focus-swipe-v2`. Assets: `docs/design/hero/`.

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

Measured on the current dark run: desktop panel mean luminance **0.182**, canvas
**0.137**, caption present (std 0.251 in its band); the sign-in wall was found once
and hidden (`overlays[0].hidden = ["_root_…"]`), and the board is the element under
the cursor in the centre of all three captures.

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

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

## How

```powershell
pwsh -File scripts/qa/hero-shots.ps1            # boots an isolated home on port 64943
python -B scripts/qa/hero-compose.py docs/design/hero/hero-desktop-1440x900.png docs/design/hero/hero-mobile-390x844.png docs/design/hero/hero.png
```

`hero-shots.ps1` clones the isolated QA home (so the plugin is already linked),
replaces its workspace registry with the three invented projects, wipes the board
ledger, boots the host, and runs `hero-capture.mjs`, which:

1. seeds the demo ledger through the **real** import route (`/import/preview` then
   `/import`, `mode=replace`) — 30 cards created, 0 rejected;
2. forces the pastel category colour mode and grouping (localStorage, then reload);
3. emulates the **light** colour scheme the host follows, and captures the panel
   alone at 1440×900, 390×844 and 844×390 (`deviceScaleFactor: 2`).

`hero-compose.py` (Pillow) then lays the desktop panel and the phone (in a slim
device frame) on a soft pastel backdrop with a caption.

## Result

| File | Content |
| --- | --- |
| `hero.png` | 2560×1440 composition: desktop panel + phone, pastel backdrop, caption |
| `hero-desktop-1440x900.png` | desktop panel only (1160×900, card faces grouped by the three invented projects) |
| `hero-mobile-390x844.png` | phone portrait panel (390×796, carousel + column tabs) |
| `hero-landscape-844x390.png` | phone landscape panel (788×390, two columns per page) |
| `metrics.json` | clip rectangles, card count, group labels, theme (`dark: false`) |

## Limits

- The light theme is the host's own (`prefers-color-scheme: light`); the plugin
  never forces a theme, so the panels show exactly what a light-theme user sees.
- The backdrop, the device frame and the caption are cosmetic and only exist in
  `hero.png`; the three panel captures are untouched.
- The captures reflect the working tree at the time of the run (this branch plus
  any concurrent work in the same checkout), not a tagged release.

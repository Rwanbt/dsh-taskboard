/**
 * Board styles, injected as one global stylesheet with dsh-atb- prefixed
 * classes. Colors ride the shell's --dsw-* design tokens where available so
 * the board follows the active theme/skin; urgency accents are the fixed
 * red/purple/blue of the protocol.
 *
 * @module dsh-taskboard/client/styles
 */

/** The stylesheet text. */
export const STYLES = `

/* =====================================================================
   DSH design-token bridge — the single source of truth for colour,
   radius, elevation and focus. DSH publishes its palette on <body>, so
   these aliases resolve inside the board AND inside anything portalled
   to document.body (Select popovers). Do not hardcode surfaces below.
   ===================================================================== */
body {
  --atb-text: var(--dsw-alias-label-primary, #0f1115);
  --atb-text-2: var(--dsw-alias-label-secondary, #61666b);
  --atb-text-3: var(--dsw-alias-label-tertiary, #81858c);
  --atb-border: var(--dsw-alias-border-l1, #0000000a);
  --atb-border-2: var(--dsw-alias-border-l2, #0000001a);
  --atb-bg: var(--dsw-alias-bg-base, #fff);
  --atb-bg-1: var(--dsw-alias-bg-layer-1, #fff);
  --atb-bg-2: var(--dsw-alias-bg-layer-2, #fff);
  --atb-bg-inset: var(--dsw-alias-bg-module-platform, #f5f6f7);
  --atb-overlay: var(--dsw-alias-bg-layer-1, #fff);
  --atb-menu: var(--dsw-menu-surface-fill, var(--dsw-alias-bg-layer-1, #fff));
  --atb-menu-blur: var(--dsw-menu-backdrop-filter, saturate(150%) blur(20px));
  --atb-hover: var(--dsw-alias-interactive-bg-hover, #2631480f);
  --atb-hover-solid: var(--dsw-alias-interactive-bg-hover-solid, #f1f3f5);
  --atb-active: var(--dsw-alias-interactive-bg-active, #2631481a);
  --atb-brand: var(--dsw-alias-brand-primary, #0f1115);
  --atb-accent: var(--dsw-alias-state-business-primary, #4176e6);
  --atb-error: var(--dsw-alias-state-error-primary, #ec1313);
  --atb-success: var(--dsw-alias-state-success-primary, #22c55e);
  --atb-warn: var(--dsw-alias-state-warn-primary, #f59e0b);
  --atb-radius-xs: var(--dsw-radius-xs, 4px);
  --atb-radius-sm: var(--dsw-radius-sm, 8px);
  --atb-radius-md: var(--dsw-radius-md, 12px);
  --atb-radius-lg: var(--dsw-radius-lg, 16px);
  --atb-radius-xl: var(--dsw-radius-xl, 20px);
  --atb-corner: var(--dsw-corner-shape, round);
  --atb-elevation-panel: var(--dsw-elevation-panel, 0 0 0 .5px #00000029, 0 3px 8px #00000008, 0 0 16px #00000005);
  --atb-elevation-prominent: var(--dsw-elevation-prominent, 0 0 0 .5px #00000029, 0 3px 8px #0000000a, 0 0 20px #0000000d);
  --atb-focus: 0 0 0 2px color-mix(in srgb, var(--atb-accent) 40%, transparent);
  --atb-input: var(--dsw-specific-input-major, var(--dsw-alias-bg-layer-1, #fff));
  /* Neutral column tint (the pre-fork look): a flat grey overlay, identical in
     light and dark because it is a mid-grey mix, not a theme accent. */
  --atb-surface-sunken: color-mix(in srgb, #808080 7%, var(--atb-bg));
}
.dsh-atb-external-mapping { display: flex; gap: 8px; margin: 12px 0; align-items: flex-end; }
.dsh-atb-external-options { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin: 9px 0; font-size: 12px; }
.dsh-atb-external .dsh-atb-external-options > label { flex: 0 0 auto; margin: 0; white-space: nowrap; }
.dsh-atb-external-scope-info { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 5px; overflow-wrap: anywhere; font-size: 12px; }
.dsh-atb-external .dsh-atb-external-mapping > label { flex: 1; margin: 0; }
.dsh-atb-external .dsh-atb-external-remove { flex: 0 0 36px; width: 36px; height: 36px; box-sizing: border-box; padding: 0; display: inline-flex; align-items: center; justify-content: center; align-self: flex-end; color: var(--atb-text-2, #71717a); }
.dsh-atb-external .dsh-atb-external-remove:hover:not(:disabled) { color: #dc2626; border-color: #fca5a5; background: rgba(239,68,68,.08); }
.dsh-atb-external .dsh-atb-external-remove:focus-visible { outline: 2px solid var(--atb-accent); outline-offset: 2px; }
.dsh-atb-external-mapping input, .dsh-atb-external-mapping select { height: 36px; }
@media (max-width: 600px) {
  .dsh-atb-external-mapping { flex-wrap: wrap; }
  .dsh-atb-external .dsh-atb-external-mapping > .dsh-atb-external-scope { flex: 0 0 100%; }
}
.dsh-atb-external label { display: flex; flex-direction: column; gap: 5px; margin: 9px 0; min-width: 0; font-size: 12px; }
.dsh-atb-external input, .dsh-atb-external select { box-sizing: border-box; width: 100%; padding: 8px 10px; border: 1px solid var(--atb-border-2, #d4d4d8); border-radius: 6px; background: var(--atb-bg, transparent); color: inherit; font: inherit; }
.dsh-atb-external button { padding: 7px 10px; border: 1px solid var(--atb-border-2, #d4d4d8); border-radius: 6px; background: transparent; color: inherit; font: inherit; cursor: pointer; }
.dsh-atb-external button:disabled { opacity: .5; cursor: default; }
.dsh-atb-external fieldset > div > label { flex: 1; }
/* Contract v1 connection manager: compact rows that wrap on narrow screens. */
.dsh-atb-external-connections { display: flex; flex-direction: column; gap: 6px; margin: 9px 0 14px; }
.dsh-atb-external-conn-head { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; justify-content: space-between; }
.dsh-atb-external-conn-empty { margin: 0; font-size: 12px; color: var(--atb-text-2, #71717a); }
.dsh-atb-external-connection { display: flex; flex-wrap: wrap; gap: 6px 10px; align-items: center; padding: 7px 9px; border-radius: 6px; background: var(--atb-hover); }
.dsh-atb-external-connection[data-enabled="false"] { opacity: .7; }
.dsh-atb-external-conn-info { flex: 1 1 220px; min-width: 0; display: flex; flex-wrap: wrap; gap: 4px 8px; align-items: baseline; font-size: 12px; }
.dsh-atb-external-conn-name { overflow-wrap: anywhere; }
.dsh-atb-external-conn-provider, .dsh-atb-external-conn-state { font-size: 12px; color: var(--atb-text-2, #71717a); overflow-wrap: anywhere; }
.dsh-atb-external-conn-badge { padding: 1px 6px; border-radius: var(--atb-radius-xs, 4px); background: var(--atb-active); font-size: 11px; white-space: nowrap; }
.dsh-atb-external-conn-badge[data-state="disabled"], .dsh-atb-external-conn-badge[data-state="read-only"] { color: var(--atb-warn); }
.dsh-atb-external-conn-badge[data-state="enabled"], .dsh-atb-external-conn-badge[data-state="read-write"] { color: var(--atb-success); }
.dsh-atb-external-conn-actions { display: flex; flex-wrap: wrap; gap: 6px; }
.dsh-atb-external-conn-error { flex: 1 1 100%; margin: 0; font-size: 12px; color: var(--atb-error); }
.dsh-atb-external-conn-editing { margin: 0; font-size: 12px; color: var(--atb-text-2, #71717a); }
.dsh-atb-external-capabilities { display: flex; flex-wrap: wrap; gap: 4px 12px; margin: 9px 0; font-size: 12px; color: var(--atb-text-2, #71717a); }
.dsh-atb-external-capabilities code { font-size: 11px; padding: 1px 5px; border-radius: var(--atb-radius-xs, 4px); background: var(--atb-hover); }
.dsh-atb-panel-root { display: flex; flex-direction: column; height: 100%; overflow: hidden; }
.dsh-atb-pglyph { display: inline-flex; align-items: center; }
.dsh-atb-picon { position: relative; display: inline-flex; }
button[class*="panelRow"]:has(.dsh-atb-pglyph) { position: relative; }
.dsh-atb-pstats {
  position: absolute; right: 9px; top: 50%; transform: translateY(calc(-50% - 1px));
  display: inline-flex; align-items: center; gap: 3px;
  font-size: 11px; line-height: 1; color: var(--atb-text-2, gray);
  font-variant-numeric: tabular-nums; white-space: nowrap; cursor: default;
}
.dsh-atb-psep { opacity: .5; }
.dsh-atb-pstats [data-stat="todo"] { color: var(--atb-accent); }
.dsh-atb-pstats [data-stat="in_progress"] { color: var(--atb-warn); }
.dsh-atb-pstats [data-stat="in_review"] { color: var(--dsw-alias-state-done-primary, #7c3aed); }
.dsh-atb-pbadge {
  position: absolute; top: -5px; right: -8px;
  min-width: 13px; height: 13px; padding: 0 3px;
  border-radius: 7px; background: var(--atb-accent); color: #fff;
  font-size: 9px; line-height: 13px; text-align: center;
  font-variant-numeric: tabular-nums; cursor: default;
}
.dsh-atb-stats-tooltip {
  position: fixed; z-index: 1100; width: max-content;
  max-width: min(50vw, calc(100vw - 24px)); padding: 3px 7px;
  border-radius: var(--dsw-radius-sm); background: var(--dsw-alias-tooltip-bg);
  color: var(--dsw-static-neutral-bluish-00); font-size: 13px; line-height: 20px;
  white-space: pre-line; pointer-events: none; transform: translateY(-50%);
}

/* =====================================================================
   DeepSeek Pastel — the board's own appearance tokens.

   The eight pastel tones are declared with light-dark(): DSH publishes
   color-scheme on &lt;html&gt; from the active theme, so the surfaces follow
   the host light/dark palette without reading host internals and without
   ever touching &lt;html&gt;/&lt;body&gt;. Everything is scoped to .dsh-atb-board, so
   no host style or sibling plugin is affected.

   --atb-vibrancy is the user's colour-intensity percentage (25–100 %):
   the card background is the tone mixed over the host surface, so the
   lowest values keep a hint of hue while staying neutral. Densities only
   swap spacing tokens: the layout code below never changes per density.
   ===================================================================== */
.dsh-atb-board {
  --atb-card-radius: 15px;
  --atb-card-pad: 16px;
  --atb-card-gap: 12px;
  --atb-vibrancy: 100%;
  --atb-card-base: var(--atb-bg-1);
  --atb-card-text: light-dark(#22263a, #f4f2fc);
  --atb-card-text-2: light-dark(#4a4f63, #d1cfe1);
  --atb-card-border: light-dark(#252d4610, #ffffff14);
  --atb-card-shadow: 0 0 0 .5px light-dark(#252d460d, #ffffff0a), 0 4px 16px light-dark(#35406412, #00000040);
  --atb-card-hover-shadow: 0 0 0 .5px light-dark(#252d461a, #ffffff14), 0 10px 24px light-dark(#242c4822, #00000066);
  /* Full pastel surfaces (dark theme values from the reference mockup). */
  --atb-tone-violet: light-dark(#e9e3fb, #34304d);
  --atb-tone-sky: light-dark(#dfeef9, #283d50);
  --atb-tone-mint: light-dark(#dff2e8, #2d4642);
  --atb-tone-peach: light-dark(#f9e7d9, #4a3a33);
  --atb-tone-pink: light-dark(#f7e3ed, #4b3443);
  --atb-tone-ink: light-dark(#e0e8f4, #323c4f);
  --atb-tone-yellow: light-dark(#f7edcf, #49412e);
  --atb-tone-lavender: light-dark(#e6e0f8, #3b3454);
  /* Readable accents for the project label, the tone dot and the progress fill. */
  --atb-tone-accent-violet: light-dark(#674a9e, #c3aafc);
  --atb-tone-accent-sky: light-dark(#316a96, #a2d5fa);
  --atb-tone-accent-mint: light-dark(#357566, #a0dfc8);
  --atb-tone-accent-peach: light-dark(#96684d, #f2c09f);
  --atb-tone-accent-pink: light-dark(#96557c, #f2b3d5);
  --atb-tone-accent-ink: light-dark(#47679f, #aec5fa);
  --atb-tone-accent-yellow: light-dark(#78661f, #efdb91);
  --atb-tone-accent-lavender: light-dark(#674f9f, #c7bcfc);
}
.dsh-atb-board[data-atb-density="compact"] { --atb-card-radius: 11px; --atb-card-pad: 11px; --atb-card-gap: 8px; }
.dsh-atb-board[data-atb-density="comfortable"] { --atb-card-radius: 15px; --atb-card-pad: 16px; --atb-card-gap: 12px; }
.dsh-atb-board[data-atb-density="spacious"] { --atb-card-radius: 18px; --atb-card-pad: 20px; --atb-card-gap: 16px; }

.dsh-atb-searchfield {
  display: inline-flex; align-items: center; gap: 7px;
  min-width: 170px; max-width: 260px; flex: 1 1 190px; height: 34px;
  padding: 0 10px; border-radius: var(--atb-radius-sm);
  background: var(--atb-hover); color: var(--atb-text-3);
}
.dsh-atb-searchfield:focus-within { box-shadow: 0 0 0 1px var(--atb-accent), var(--atb-focus); }
.dsh-atb-search { flex: 1; min-width: 0; width: 100%; height: 100%; border: 0; outline: none; background: transparent; color: var(--atb-text); font: inherit; font-size: 12px; }
.dsh-atb-search::placeholder { color: var(--atb-text-3); }
.dsh-atb-badge[data-kind="stale"] { background: rgba(217,130,43,.15); color: var(--atb-warn); }

.dsh-atb-board { position: relative; display: flex; flex-direction: column; height: 100%; min-height: 0; padding: 16px 20px 20px; gap: 12px; box-sizing: border-box; }
.dsh-atb-panel-root[data-dsh-atb-windows] > .dsh-atb-board {
  padding-top: max(12px, calc(env(titlebar-area-y, 0px) + env(titlebar-area-height, 36px) + 8px - var(--dsh-atb-viewport-top, 0px)));
}
.dsh-atb-head { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; min-width: 0; }
.dsh-atb-toolbar { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; min-width: 0; }
body[data-dsh-sidebar-collapsed] .dsh-atb-panel-root .dsh-atb-toolbar { padding-right: 62px; }
.dsh-atb-toolbar-divider { width: 1px; height: 22px; flex: none; margin: 0 3px; background: var(--atb-border-2); }
.dsh-atb-title { font-size: 19px; font-weight: 720; letter-spacing: -.45px; margin: 0; line-height: 1.2; }
.dsh-atb-count {
  font-size: 11px; color: var(--atb-text-2); background: var(--atb-hover);
  border-radius: 7px; padding: 4px 9px; font-variant-numeric: tabular-nums; white-space: nowrap;
}
.dsh-atb-grouptoggle[aria-pressed="true"] { background: color-mix(in srgb, var(--atb-accent) 14%, transparent); color: var(--atb-text); }
/* ---------------------------------------------------------------------
   Focus-mode scaffolding (mobile carousel): inert above 760px where the
   five columns are laid out side by side. The two media queries at the
   bottom of this sheet activate it; they are the exact queries exported by
   board/mobile.ts (a test asserts both strings stay in this sheet).
   --------------------------------------------------------------------- */
.dsh-atb-mobileactions { display: none; align-items: center; gap: 2px; flex: none; }
.dsh-atb-iconbtn {
  position: relative; width: 34px; height: 34px; flex: none;
  display: inline-flex; align-items: center; justify-content: center;
  border: 1px solid transparent; border-radius: 10px;
  background: transparent; color: var(--atb-text-2); cursor: pointer; font: inherit;
}
.dsh-atb-iconbtn:hover { background: var(--atb-hover); color: var(--atb-text); }
.dsh-atb-iconbtn:focus-visible { outline: 2px solid var(--atb-accent); outline-offset: 2px; }
.dsh-atb-iconbtn[data-on="true"] { color: var(--atb-text); background: var(--atb-hover); }
.dsh-atb-iconbtn[data-on="true"]::after {
  content: ""; position: absolute; top: 5px; right: 5px;
  width: 6px; height: 6px; border-radius: 50%; background: var(--atb-accent);
}
/* The two clusters are transparent wrappers on desktop: their children stay
   direct flex items of the toolbar (no layout change at all). */
.dsh-atb-toolbar-filters, .dsh-atb-toolbar-actions { display: contents; }
/* ---------------------------------------------------------------------
   Desktop toolbar densities. The board measures its own toolbar and
   publishes data-atb-bar (board/compact.ts); the header must stay on two
   rows, so the row sheds its labels before it is allowed to wrap onto a
   third line. Every control keeps its icon, its accessible name and its
   tooltip: only the visible text is dropped.
   --------------------------------------------------------------------- */
.dsh-atb-chip-count { font-variant-numeric: tabular-nums; }
.dsh-atb-head { gap: 8px; }
/* Title row: the action cluster drops its words first (icon + tooltip + name). */
.dsh-atb-board[data-atb-bar="compact"] .dsh-atb-toolbar-actions .dsh-atb-btn-label,
.dsh-atb-board[data-atb-bar="tight"] .dsh-atb-toolbar-actions .dsh-atb-btn-label { display: none; }
.dsh-atb-board[data-atb-bar="compact"] .dsh-atb-toolbar-actions .dsh-atb-btn,
.dsh-atb-board[data-atb-bar="tight"] .dsh-atb-toolbar-actions .dsh-atb-btn {
  width: 34px; height: 30px; padding: 0; gap: 0; justify-content: center;
}
.dsh-atb-board[data-atb-bar="compact"] .dsh-atb-toolbar-actions .dsh-atb-newmenu-caret,
.dsh-atb-board[data-atb-bar="tight"] .dsh-atb-toolbar-actions .dsh-atb-newmenu-caret { display: none; }
/* Filter row: the urgency chips keep their words as long as any laptop fits. */
.dsh-atb-board[data-atb-bar="compact"] .dsh-atb-toolbar .dsh-atb-searchfield { flex: 0 1 180px; min-width: 130px; max-width: 200px; }
.dsh-atb-board[data-atb-bar="compact"] .dsh-atb-toolbar .dsh-atb-sel { max-width: 168px; }
/* Tight: colour dots + icon-only counters, and the title row loses the version
   pill and the grouping label. Everything keeps its tooltip and accessible name. */
.dsh-atb-board[data-atb-bar="tight"] .dsh-atb-toolbar { gap: 4px; }
.dsh-atb-board[data-atb-bar="tight"] .dsh-atb-toolbar .dsh-atb-searchfield { flex: 0 1 150px; min-width: 104px; max-width: 170px; }
.dsh-atb-board[data-atb-bar="tight"] .dsh-atb-toolbar .dsh-atb-sel { max-width: 128px; }
.dsh-atb-board[data-atb-bar="tight"] .dsh-atb-toolbar .dsh-atb-chip-label,
.dsh-atb-board[data-atb-bar="tight"] .dsh-atb-toolbar .dsh-atb-toolbar-divider { display: none; }
.dsh-atb-board[data-atb-bar="tight"] .dsh-atb-toolbar .dsh-atb-chip { padding: 3px 7px; }
.dsh-atb-board[data-atb-bar="tight"] .dsh-atb-grouptoggle { width: 34px; padding: 0; gap: 0; justify-content: center; }
.dsh-atb-board[data-atb-bar="tight"] .dsh-atb-grouptoggle-label,
.dsh-atb-board[data-atb-bar="tight"] .dsh-atb-toolbar-actions .dsh-atb-ver { display: none; }
/* The focus-mode header (status tab rail + swipe cue) is a zero-cost box on
   desktop: hidden entirely, so the board body keeps its exact previous layout. */
.dsh-atb-mobilehead { display: none; align-items: center; gap: 8px; min-width: 0; }
/* Narrow-viewport column navigation: hidden until the five columns stop fitting.
   The rail is a horizontal scroller, so a long label set scrolls instead of
   being squeezed. */
.dsh-atb-mobilebar {
  display: none; gap: 6px; flex: 1; min-width: 0;
  overflow-x: auto; scrollbar-width: none; padding: 2px 2px 1px;
}
.dsh-atb-mobilebar::-webkit-scrollbar { display: none; }
/* Mobile column tabs are miniature column heads, not filter chips: the same
   sober surface as a desktop column, one short status rule on the top edge
   (see .dsh-atb-colhead::before), a plain label and an integrated counter.
   Height stays low (34 px) while the padding keeps a comfortable touch target. */
.dsh-atb-mobilebar-btn {
  position: relative; flex: none;
  display: inline-flex; align-items: center; gap: 7px;
  height: 34px; padding: 0 11px; border-radius: 11px; cursor: pointer;
  border: 1px solid var(--atb-border); background: var(--atb-surface-sunken);
  color: var(--atb-text-2); font: inherit;
  font-size: 12px; font-weight: 640; letter-spacing: -.1px; white-space: nowrap;
  scroll-snap-align: start;
  transition: background .16s ease, color .16s ease, border-color .16s ease,
    box-shadow .16s ease, transform .12s ease;
}
/* The status rule: a short coloured bar inset on the top edge. Inactive tabs
   keep it visible but muted; the active one widens it and turns it opaque. */
.dsh-atb-mobilebar-btn::before {
  content: ""; position: absolute; top: 0; left: 11px; right: 11px; height: 3px;
  border-radius: 0 0 5px 5px; background: var(--atb-status, var(--atb-text-3));
  opacity: .45;
  transition: opacity .16s ease, left .16s ease, right .16s ease, height .16s ease;
}
.dsh-atb-mobilebar-btn:hover { color: var(--atb-text); }
.dsh-atb-mobilebar-btn:active { transform: translateY(1px); background: var(--atb-hover); }
.dsh-atb-mobilebar-btn:focus-visible { outline: 2px solid var(--atb-accent); outline-offset: 2px; }
.dsh-atb-mobilebar-btn[data-active="true"] {
  color: var(--atb-text); background: var(--atb-bg-1); font-weight: 680;
  border-color: color-mix(in srgb, var(--atb-status, var(--atb-accent)) 40%, var(--atb-border));
  box-shadow: 0 1px 2px light-dark(#0f172a0f, #00000040), 0 5px 14px -8px light-dark(#0f172a26, #00000066);
}
.dsh-atb-mobilebar-btn[data-active="true"]::before { opacity: 1; left: 8px; right: 8px; }
/* Same status palette as the desktop columns (single source of truth). */
.dsh-atb-mobilebar-btn[data-status="backlog"] { --atb-status: var(--atb-text-3); }
.dsh-atb-mobilebar-btn[data-status="todo"] { --atb-status: var(--atb-accent); }
.dsh-atb-mobilebar-btn[data-status="in_progress"] { --atb-status: var(--atb-warn); }
.dsh-atb-mobilebar-btn[data-status="in_review"] { --atb-status: var(--dsw-alias-state-done-primary, #7c3aed); }
.dsh-atb-mobilebar-btn[data-status="done"] { --atb-status: var(--atb-success); }
.dsh-atb-mobilebar-label { white-space: nowrap; }
.dsh-atb-mobilebar-count {
  font-size: 10.5px; font-weight: 500; padding: 1px 6px; border-radius: 6px;
  background: var(--atb-hover); color: var(--atb-text-3);
  font-variant-numeric: tabular-nums;
  transition: background .16s ease, color .16s ease;
}
.dsh-atb-mobilebar-btn[data-active="true"] .dsh-atb-mobilebar-count { background: var(--atb-active, var(--atb-hover)); color: var(--atb-text-2); }
.dsh-atb-swipecue {
  display: none; align-items: center; gap: 6px; flex: none;
  font-size: 10.5px; color: var(--atb-text-3); white-space: nowrap;
}
.dsh-atb-swipecue-arrow { opacity: .6; }
.dsh-atb-swipecue-page { color: var(--atb-text-2); font-variant-numeric: tabular-nums; }
/* One primary creation action on a phone, thumb-reachable, inside the panel. */
.dsh-atb-fab {
  position: absolute; z-index: 20; right: 16px;
  bottom: calc(16px + env(safe-area-inset-bottom));
  width: 54px; height: 54px; display: none; place-items: center;
  border: none; border-radius: 18px; cursor: pointer;
  background: var(--dsw-alias-button-primary-fill, var(--dsw-alias-brand-primary, #1f2328));
  color: var(--dsw-alias-label-primary-foreground, #fff);
  box-shadow: var(--atb-elevation-prominent), 0 10px 22px -10px rgba(8, 12, 20, .5);
}
.dsh-atb-fab:hover { filter: brightness(1.08); }
.dsh-atb-fab:focus-visible { outline: 2px solid var(--atb-accent); outline-offset: 3px; }
.dsh-atb-board-body { display: flex; flex-direction: column; gap: 10px; flex: 1; min-height: 0; }
.dsh-atb-ver {
  font-size: 11px; color: var(--atb-text-2, gray);
  font-variant-numeric: tabular-nums; white-space: nowrap; cursor: pointer;
  text-decoration: none;
  padding: 1px 9px; border-radius: 999px;
  background: var(--atb-bg-inset, rgba(128,128,128,.1));
  border: 1px solid var(--atb-border-2, rgba(128,128,128,.22));
  transition: border-color .12s ease, color .12s ease;
}
.dsh-atb-ver:hover { border-color: var(--atb-border-2, rgba(128,128,128,.6)); color: inherit; }
.dsh-atb-spacer { flex: 1; }
/* Form controls: DSH input surface and geometry (tokens only). */
.dsh-atb-select, .dsh-atb-input {
  font: inherit; font-size: 12.5px; line-height: 1.35; height: 30px;
  padding: 0 8px; border-radius: var(--atb-radius-sm);
  border: 1px solid var(--atb-border-2);
  background: var(--atb-input); color: var(--atb-text);
  color-scheme: light dark;
}
.dsh-atb-select:focus-visible, .dsh-atb-input:focus-visible {
  outline: none; border-color: var(--atb-accent); box-shadow: var(--atb-focus);
}
/* Native <select> is legacy only; the board uses the themed Select. */
.dsh-atb-select option { background: var(--atb-bg-1); color: var(--atb-text); }

.dsh-atb-chip {
  display: inline-flex; align-items: center; gap: 5px;
  font-size: 12px; padding: 3px 9px; border-radius: 999px; cursor: pointer;
  border: 1px solid var(--atb-border-2, rgba(128,128,128,.35));
  background: transparent; color: var(--atb-text-2, inherit);
}
.dsh-atb-chip[data-on="true"] { color: #fff; border-color: transparent; }
.dsh-atb-chip[data-urgency="urgent"][data-on="true"] { background: var(--atb-error); }
.dsh-atb-chip[data-urgency="normal"][data-on="true"] { background: var(--dsw-alias-state-done-primary, #7c3aed); }
.dsh-atb-chip[data-urgency="relaxed"][data-on="true"] { background: var(--atb-accent); }
.dsh-atb-dot { width: 8px; height: 8px; border-radius: 50%; display: inline-block; }
.dsh-atb-dot[data-urgency="urgent"] { background: var(--atb-error); }
.dsh-atb-dot[data-urgency="normal"] { background: var(--dsw-alias-state-done-primary, #7c3aed); }
.dsh-atb-dot[data-urgency="relaxed"] { background: var(--atb-accent); }
.dsh-atb-dot[data-status="backlog"] { background: var(--atb-text-3); }
.dsh-atb-dot[data-status="todo"] { background: var(--atb-accent); }
.dsh-atb-dot[data-status="in_progress"] { background: var(--atb-warn); }
.dsh-atb-dot[data-status="in_review"] { background: var(--dsw-alias-state-done-primary, #7c3aed); }
.dsh-atb-dot[data-status="done"] { background: var(--atb-success); }
.dsh-atb-dot[data-status="canceled"], .dsh-atb-dot[data-status="archived"] { background: var(--atb-text-3); }
.dsh-atb-dot[data-status="trashed"] { background: var(--atb-error); }

.dsh-atb-btn {
  font: inherit; font-size: 12.5px; padding: 5px 11px; border-radius: 7px; cursor: pointer;
  border: 1px solid var(--atb-border-2, rgba(128,128,128,.35));
  background: var(--atb-bg-1, rgba(128,128,128,.08)); color: inherit;
}
.dsh-atb-btn:hover { background: var(--atb-hover, rgba(128,128,128,.18)); }
.dsh-atb-btn:disabled { opacity: .45; cursor: default; }
.dsh-atb-btn[data-primary="true"] { background: var(--dsw-alias-button-primary-fill, var(--dsw-alias-brand-primary, #1f2328)); border-color: transparent; color: var(--dsw-alias-label-primary-foreground, #fff); }
.dsh-atb-btn[data-danger="true"] { color: var(--dsw-alias-state-error-primary, var(--atb-error)); border-color: color-mix(in srgb, var(--dsw-alias-state-error-primary, var(--atb-error)) 45%, transparent); }

.dsh-atb-columns { display: flex; gap: 12px; flex: 1; min-height: 0; overflow-x: auto; overflow-y: hidden; padding-bottom: 2px; scrollbar-width: thin; }

.dsh-atb-detailpanel {
  display: flex; flex-direction: column;
  flex: none; max-height: 58%; min-height: 200px; overflow: hidden;
  border: 1px solid var(--atb-border); border-radius: var(--atb-radius-lg);
  background: var(--atb-bg-1);
  padding: 14px 18px; box-shadow: var(--atb-elevation-prominent);
}
.dsh-atb-detailpanel .dsh-atb-detail { flex: 1; min-height: 0; }
.dsh-atb-column { display: flex; flex-direction: column; flex: 1 1 0; min-width: 234px; min-height: 0; border-radius: 15px; background: var(--atb-surface-sunken); border: 1px solid var(--atb-border); overflow: hidden; transition: flex-basis .15s ease, min-width .15s ease, max-width .15s ease; }
.dsh-atb-column[data-status="backlog"] { --atb-status: var(--atb-text-3); }
.dsh-atb-column[data-status="todo"] { --atb-status: var(--atb-accent); }
.dsh-atb-column[data-status="in_progress"] { --atb-status: var(--atb-warn); }
.dsh-atb-column[data-status="in_review"] { --atb-status: var(--dsw-alias-state-done-primary, #7c3aed); }
.dsh-atb-column[data-status="done"] { --atb-status: var(--atb-success); }
.dsh-atb-column[data-collapsed="true"] {
  flex: 0 0 42px;
  min-width: 42px;
  max-width: 42px;
  padding: 8px 4px;
  cursor: pointer;
  align-items: center;
  user-select: none;
}
.dsh-atb-column[data-collapsed="true"]:hover {
  background: var(--atb-hover, rgba(128,128,128,.12));
}
.dsh-atb-colhead {
  position: relative; display: flex; align-items: center; gap: 7px;
  flex: none; min-height: 54px; padding: 14px 14px 10px;
  font-size: 12.5px; font-weight: 680; letter-spacing: -.1px;
}
/* Status accent rule: a short bar at the very top of the column head, the
   one place status colour is used as decoration (never on a card). */
.dsh-atb-colhead::before {
  content: ""; position: absolute; top: 0; left: 14px; width: 16px; height: 3px;
  border-radius: 0 0 5px 5px; background: var(--atb-status, var(--atb-text-3)); opacity: .9;
}
.dsh-atb-colcount {
  font-size: 10.5px; font-weight: 500; color: var(--atb-text-2);
  background: var(--atb-hover); border-radius: 6px; padding: 3px 7px;
  font-variant-numeric: tabular-nums;
}
.dsh-atb-colfoldbtn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: none;
  cursor: pointer;
  color: var(--atb-text-2, gray);
  padding: 2px;
  border-radius: 6px;
  margin-left: auto;
  line-height: 1;
}
.dsh-atb-colfoldbtn:hover {
  color: var(--atb-text, currentColor);
  background: var(--atb-hover, rgba(128,128,128,.15));
}
.dsh-atb-col-collapsed-bar {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  width: 100%;
  height: 100%;
  padding-top: 4px;
}
.dsh-atb-col-collapsed-title {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
}
.dsh-atb-col-collapsed-text {
  writing-mode: vertical-rl;
  letter-spacing: 2px;
  font-size: 12px;
  font-weight: 600;
  color: var(--atb-text-2, inherit);
}
.dsh-atb-colhead .dsh-atb-btn { margin-left: auto; padding: 1px 8px; font-size: 11px; }
.dsh-atb-colhead .dsh-atb-btn + .dsh-atb-btn { margin-left: 0; }
.dsh-atb-colhead .dsh-atb-selectall { flex: none; margin: 0 2px 0 6px; cursor: pointer; }
.dsh-atb-selrow { display: flex; align-items: flex-start; gap: 4px; }
.dsh-atb-selrow .dsh-atb-card, .dsh-atb-selrow > div { flex: 1; min-width: 0; }
.dsh-atb-selbox { flex: none; margin: 4px 0 0 0; cursor: pointer; }
.dsh-atb-cards { display: flex; flex-direction: column; gap: var(--atb-card-gap); overflow-y: auto; min-height: 0; flex: 1; padding: 1px 11px 12px; scrollbar-width: thin; }
.dsh-atb-ws-group { display: flex; flex-direction: column; gap: var(--atb-card-gap); }
.dsh-atb-ws-group + .dsh-atb-ws-group { margin-top: 4px; }
.dsh-atb-ws-group-head {
  border: none; width: 100%; box-sizing: border-box; font-family: inherit; text-align: left; cursor: pointer;
  display: flex; align-items: center; gap: 5px; padding: 7px 4px; border-radius: 6px;
  font-size: 11px; font-weight: 650; color: var(--atb-text-2, inherit);
  /* Sticky project header: the column head above never scrolls (it
     lives outside the scroller), but the project row used to ride up with its
     cards — on a long column the project name left the screen first. Pin it to
     the top of the card scroller so the group you are reading stays labelled.
     The fill must be OPAQUE and match the column surface exactly, so cards
     passing underneath never bleed through the label. */
  position: sticky; top: 0; z-index: 2;
  background: var(--atb-surface-sunken);
  user-select: none;
}
.dsh-atb-ws-group-icon { display: inline-flex; align-items: center; justify-content: center; opacity: .8; line-height: 1; }
.dsh-atb-ws-group-head:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary, var(--atb-accent)); outline-offset: -2px; }
.dsh-atb-ws-group-chevron { flex-shrink: 0; }
.dsh-atb-ws-group-head[aria-expanded="true"] .dsh-atb-ws-group-chevron { transform: rotate(90deg); }
.dsh-atb-ws-group-cards[hidden] { display: none; }
.dsh-atb-ws-group-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dsh-atb-ws-group-count {
  font-size: 10px; font-weight: 500; padding: 0.5px 5px; border-radius: 10px;
  background: var(--atb-bg-inset, rgba(128,128,128,.14)); color: var(--atb-text-2, gray);
}
.dsh-atb-ws-group-cards { display: flex; flex-direction: column; gap: 8px; }

/* ---------------------------------------------------------------------
   Cards — a fully tinted pastel surface (no priority stripe on the left).
   Tone and priority are independent: --atb-card-tone comes from the stable
   id hash (or the user's manual pick), while urgency keeps its own label
   and dot in the footer. The base border shorthand stays 1px solid and
   transparent so no outline is ever painted; depth comes from the shadow.
   --------------------------------------------------------------------- */
.dsh-atb-card {
  position: relative; box-sizing: border-box; width: 100%;
  border-radius: var(--atb-card-radius);
  padding: var(--atb-card-pad);
  cursor: pointer; text-align: left;
  border: 1px solid transparent;
  background: color-mix(in oklab, var(--atb-card-bg, var(--atb-tone-violet)) var(--atb-vibrancy), var(--atb-card-base));
  color: var(--atb-card-text);
  font-size: 13px;
  box-shadow: var(--atb-card-shadow);
  transition: transform .18s ease, box-shadow .18s ease, filter .18s ease;
  overflow: hidden;
}
.dsh-atb-card:hover { transform: translateY(-2px); box-shadow: var(--atb-card-hover-shadow); }
.dsh-atb-card:active { transform: scale(.995); }
.dsh-atb-card:focus-visible { outline: 2px solid var(--atb-accent); outline-offset: 3px; }
.dsh-atb-card[draggable="true"] { cursor: grab; }
.dsh-atb-card[data-dragging] { opacity: .38; cursor: grabbing; }
.dsh-atb-column[data-dragover] { outline: 2px dashed var(--atb-accent); outline-offset: -3px; }
.dsh-atb-card[data-tone="violet"] { --atb-card-bg: var(--atb-tone-violet); --atb-tone-accent: var(--atb-tone-accent-violet); }
.dsh-atb-card[data-tone="sky"] { --atb-card-bg: var(--atb-tone-sky); --atb-tone-accent: var(--atb-tone-accent-sky); }
.dsh-atb-card[data-tone="mint"] { --atb-card-bg: var(--atb-tone-mint); --atb-tone-accent: var(--atb-tone-accent-mint); }
.dsh-atb-card[data-tone="peach"] { --atb-card-bg: var(--atb-tone-peach); --atb-tone-accent: var(--atb-tone-accent-peach); }
.dsh-atb-card[data-tone="pink"] { --atb-card-bg: var(--atb-tone-pink); --atb-tone-accent: var(--atb-tone-accent-pink); }
.dsh-atb-card[data-tone="ink"] { --atb-card-bg: var(--atb-tone-ink); --atb-tone-accent: var(--atb-tone-accent-ink); }
.dsh-atb-card[data-tone="yellow"] { --atb-card-bg: var(--atb-tone-yellow); --atb-tone-accent: var(--atb-tone-accent-yellow); }
.dsh-atb-card[data-tone="lavender"] { --atb-card-bg: var(--atb-tone-lavender); --atb-tone-accent: var(--atb-tone-accent-lavender); }

.dsh-atb-card-top { display: flex; align-items: center; justify-content: space-between; gap: 8px; min-width: 0; margin-bottom: 10px; }
.dsh-atb-card-project {
  display: inline-flex; align-items: center; gap: 5px; min-width: 0;
  font-size: 10px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase;
  color: var(--atb-tone-accent, var(--atb-card-text-2));
}
.dsh-atb-card-project-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dsh-atb-card-tone-dot { width: 5px; height: 5px; border-radius: 50%; flex: none; background: var(--atb-tone-accent, var(--atb-card-text-2)); }
.dsh-atb-card-id { flex: none; font-size: 10px; font-variant-numeric: tabular-nums; color: var(--atb-card-text-2); opacity: .8; }
.dsh-atb-card-title { font-size: 13px; font-weight: 710; line-height: 1.47; letter-spacing: -.09px; overflow-wrap: anywhere; }
.dsh-atb-board[data-atb-density="spacious"] .dsh-atb-card-title { font-size: 13.5px; }
.dsh-atb-card-desc {
  margin: 7px 0 0; font-size: 11.25px; line-height: 1.55; color: var(--atb-card-text-2);
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
}
.dsh-atb-board[data-atb-density="compact"] .dsh-atb-card-desc { -webkit-line-clamp: 1; }
.dsh-atb-card-external { display: block; margin-top: 7px; font-size: 10.5px; color: var(--atb-card-text-2); opacity: .9; overflow-wrap: anywhere; }
.dsh-atb-card-flags { display: flex; align-items: center; flex-wrap: wrap; gap: 5px; margin-top: 11px; font-size: 10px; color: var(--atb-card-text-2); }
.dsh-atb-card-flags:empty { display: none; }
.dsh-atb-card-divider { height: 1px; background: var(--atb-card-border); margin: 13px 0 10px; }
.dsh-atb-card-flags:empty + .dsh-atb-card-divider { display: none; }
.dsh-atb-card-bottom { display: flex; align-items: center; gap: 8px; min-width: 0; }
.dsh-atb-card-category { display: inline-flex; align-items: center; gap: 5px; min-width: 0; font-size: 10px; color: var(--atb-card-text-2); }
.dsh-atb-card-category-dot { width: 6px; height: 6px; border-radius: 2px; flex: none; background: var(--atb-tone-accent, var(--atb-card-text-2)); }
.dsh-atb-card-category-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 116px; }
.dsh-atb-card-priority {
  display: inline-flex; align-items: center; gap: 5px; font-size: 10.5px; color: var(--atb-card-text-2); white-space: nowrap;
  padding: 2px 6px; border-radius: 6px; background: light-dark(#ffffff6b, #ffffff12);
}
.dsh-atb-card-priority .dsh-atb-dot { width: 7px; height: 7px; }
.dsh-atb-card-priority[data-urgent="true"] { color: light-dark(#9f1620, #ffb3b8); font-weight: 650; }
.dsh-atb-card-time { margin-left: auto; font-size: 10.5px; color: var(--atb-card-text-2); opacity: .8; white-space: nowrap; }

/* Badges sit on a pastel surface: translucent white chips keep every tone
   readable, and semantic kinds keep a distinct, AA-contrast colour. */
.dsh-atb-card .dsh-atb-badge {
  background: light-dark(#ffffff94, #ffffff12); color: var(--atb-card-text-2);
  border: 0; border-radius: 6px; padding: 3px 6px; font-size: 10px;
  display: inline-flex; align-items: center; gap: 4px; max-width: 100%;
}
.dsh-atb-card .dsh-atb-badge .dsh-atb-icon { width: 12px; height: 12px; }
.dsh-atb-card .dsh-atb-badge[data-kind="blocked"],
.dsh-atb-card .dsh-atb-badge[data-kind="trashed"] {
  background: color-mix(in srgb, var(--atb-error) 17%, transparent);
  color: light-dark(#9f1620, #ffb3b8);
}
.dsh-atb-card .dsh-atb-badge[data-kind="approval"],
.dsh-atb-card .dsh-atb-badge[data-kind="needs-human"],
.dsh-atb-card .dsh-atb-badge[data-kind="stale"],
.dsh-atb-card .dsh-atb-badge[data-kind="urgent"] {
  background: color-mix(in srgb, var(--atb-warn) 20%, transparent);
  color: light-dark(#8a5a0c, #ffd79a);
}
.dsh-atb-card .dsh-atb-badge[data-kind="done"] {
  background: color-mix(in srgb, var(--atb-success) 18%, transparent);
  color: light-dark(#1c6b3a, #9fe8b4);
}
.dsh-atb-card .dsh-atb-badge[data-kind="running"] {
  background: color-mix(in srgb, var(--atb-warn) 22%, transparent);
  color: light-dark(#8a5a0c, #ffd79a);
}
.dsh-atb-card .dsh-atb-badge[data-kind="session"] {
  background: light-dark(#ffffff8a, #ffffff1a); color: var(--atb-tone-accent, var(--atb-card-text-2));
  cursor: pointer; max-width: 160px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.dsh-atb-card .dsh-atb-badge[data-kind="session"]:hover { filter: brightness(1.15); }
.dsh-atb-card .dsh-atb-badge[data-kind="dependency"],
.dsh-atb-card .dsh-atb-badge[data-kind="subtasks"],
.dsh-atb-card .dsh-atb-badge[data-kind="scheduled"],
.dsh-atb-card .dsh-atb-badge[data-kind="comments"],
.dsh-atb-card .dsh-atb-badge[data-kind="checklist"] {
  background: light-dark(#ffffff94, #ffffff12);
  /* The legacy single-kind rule below sets the host secondary label colour;
     re-assert the card token here (higher specificity) so the chip keeps the
     same AA contrast as every other card badge. */
  color: var(--atb-card-text-2);
}
.dsh-atb-card .dsh-atb-badge[data-kind="dependency"][data-ready="true"],
.dsh-atb-card .dsh-atb-badge[data-kind="subtasks"][data-ready="true"] {
  color: light-dark(#1c6b3a, #9fe8b4);
}

/* Deliverable block (in review / done): a soft inset well on the tone. */
.dsh-atb-card-deliverable {
  margin-top: 11px; padding: 9px 10px; border-radius: 9px;
  background: light-dark(#ffffff70, #0000001f);
  font-size: 10.5px; line-height: 1.6; color: var(--atb-card-text-2);
  display: flex; flex-direction: column; gap: 3px;
}
.dsh-atb-card-deliv-row { display: flex; align-items: baseline; gap: 5px; overflow: hidden; }
.dsh-atb-card-deliv-tag { display: inline-flex; align-items: center; gap: 4px; flex-shrink: 0; color: var(--atb-card-text); opacity: .88; }
.dsh-atb-card-deliv-val { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
.dsh-atb-deliv-warn { color: light-dark(#9f1620, #ffb3b8); font-weight: 600; }
.dsh-atb-deliv-muted { display: inline-flex; align-items: center; gap: 4px; color: var(--atb-card-text-2); opacity: .9; }
.dsh-atb-card-deliv-summary {
  margin-top: 3px; font-size: 10.5px; line-height: 1.5; color: var(--atb-card-text-2);
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
}
.dsh-atb-card-progress { height: 4px; margin-top: 7px; border-radius: 5px; overflow: hidden; background: light-dark(#ffffff95, #ffffff22); }
.dsh-atb-card-progress > span { display: block; height: 100%; border-radius: 5px; background: var(--atb-tone-accent, var(--atb-card-text-2)); }

/* Quick review actions: tinted, always readable on the pastel tone. */
.dsh-atb-quick { display: flex; gap: 7px; margin-top: 10px; }
.dsh-atb-quickbtn {
  flex: 1; display: inline-flex; align-items: center; justify-content: center; gap: 4px;
  font: inherit; font-size: 10.5px; font-weight: 680; padding: 7px 6px; border-radius: 8px; cursor: pointer;
  border: 0; color: var(--atb-card-text); background: light-dark(#ffffff78, #ffffff1b);
}
.dsh-atb-quickbtn:hover { filter: brightness(1.12); }
.dsh-atb-quickbtn[data-act="done"] { background: light-dark(#b4e3c4, #7fc7a234); color: light-dark(#1b5836, #c3f9d7); }
.dsh-atb-quickbtn[data-act="reject"] { background: light-dark(#ffe0be, #f0b0702b); color: light-dark(#74461f, #ffd29f); }
.dsh-atb-quick-reject { display: flex; gap: 6px; margin-top: 7px; align-items: stretch; }
.dsh-atb-quick-note { flex: 1; min-width: 0; font-size: 11px; padding: 4px 8px; }

.dsh-atb-error { font-size: 12px; color: var(--atb-error); padding: 4px 8px; border-radius: 6px; background: rgba(229,72,77,.1); }
.dsh-atb-empty { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px; text-align: center; padding: 34px 12px; font-size: 11.5px; line-height: 1.55; color: var(--atb-text-3); }
.dsh-atb-empty .dsh-atb-icon { opacity: .55; }
.dsh-atb-empty-title { font-weight: 550; color: var(--atb-text-2); }
.dsh-atb-done-foldbar {
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 6px; padding: 8px 10px; margin-top: 4px; border-radius: 8px;
  background: var(--atb-bg-1, rgba(128,128,128,.08));
  border: 1px dashed var(--atb-border-2, rgba(128,128,128,.3)); text-align: center;
}
.dsh-atb-done-foldtip { font-size: 11px; color: var(--atb-text-2, gray); }
.dsh-atb-done-foldbtn { font-size: 11.5px; padding: 2px 10px; }

.dsh-atb-detail {
  display: flex; flex-direction: column; gap: 12px; overflow-y: auto; min-height: 0; flex: 1;
  padding: 2px; position: relative;
}
.dsh-atb-detail::before {
  content: ""; position: sticky; top: 0; height: 3px; border-radius: 3px; flex: none;
}
.dsh-atb-detail[data-urgency="urgent"]::before { background: linear-gradient(90deg, var(--atb-error), rgba(229,72,77,.15)); }
.dsh-atb-detail[data-urgency="normal"]::before { background: linear-gradient(90deg, var(--dsw-alias-state-done-primary, #7c3aed), rgba(142,78,198,.15)); }
.dsh-atb-detail[data-urgency="relaxed"]::before { background: linear-gradient(90deg, var(--atb-accent), rgba(62,99,221,.15)); }

/* Narrow panels (mobile viewport, split view): topbtns is flex:none and can be
   ~640px wide with long labels, which squeezes the title to one glyph per line
   (issue #91). Reserve a 240px flex basis for the title so the button group
   wraps before leaving the title an unreadable sliver. min-width:0 still lets
   the title fit panels narrower than that basis. A viewport media query would
   miss narrow panels inside a wide window. */
.dsh-atb-detail-head { display: flex; align-items: flex-start; gap: 10px; flex-wrap: wrap; }
.dsh-atb-detail-titlewrap { flex: 1 1 240px; min-width: 0; display: flex; flex-direction: column; gap: 6px; }
.dsh-atb-detail-titlebar { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.dsh-atb-detail-titlebar h3 { margin: 0; font-size: 15.5px; line-height: 1.35; word-break: break-word; }
.dsh-atb-detail-close {
  flex: none; width: 26px; height: 26px; border-radius: 7px; border: none; cursor: pointer;
  background: transparent; color: var(--atb-text-2, gray); font-size: 13px; line-height: 1;
}
.dsh-atb-detail-close:hover { background: var(--atb-hover, rgba(128,128,128,.18)); color: inherit; }
.dsh-atb-detail-topbtns { display: flex; align-items: center; gap: 6px; flex: none; max-width: 100%; flex-wrap: wrap; }
.dsh-atb-detail-edit {
  font: inherit; font-size: 12px; padding: 4px 10px; border-radius: 7px; cursor: pointer;
  border: 1px solid var(--atb-border-2, rgba(128,128,128,.32));
  background: var(--atb-bg-1, rgba(128,128,128,.07)); color: var(--atb-text-2, inherit);
}
.dsh-atb-detail-edit:hover { border-color: var(--dsw-alias-brand-primary, #1f2328); color: var(--dsw-alias-label-primary, inherit); }
.dsh-atb-detail-session {
  font: inherit; font-size: 12px; padding: 4px 10px; border-radius: 7px; cursor: pointer;
  border: 1px solid var(--atb-border-2, rgba(128,128,128,.32));
  background: var(--atb-bg-1, rgba(128,128,128,.1));
  color: var(--dsw-alias-label-primary, inherit);
  display: inline-flex; align-items: center; gap: 4px;
}
.dsh-atb-detail-session:hover {
  border-color: var(--dsw-alias-brand-primary, #1f2328);
  background: var(--atb-hover, rgba(128,128,128,.22));
}

.dsh-atb-statuspill {
  flex: none; font-size: 11px; font-weight: 600; padding: 2px 9px; border-radius: 999px; letter-spacing: .02em;
}
.dsh-atb-statuspill[data-status="backlog"] { background: rgba(128,128,128,.18); color: var(--atb-text-2, #888); }
.dsh-atb-statuspill[data-status="todo"] { background: rgba(62,99,221,.15); color: var(--atb-accent); }
.dsh-atb-statuspill[data-status="in_progress"] { background: rgba(230,152,66,.16); color: var(--atb-warn); }
.dsh-atb-statuspill[data-status="in_review"] { background: rgba(142,78,198,.16); color: var(--dsw-alias-state-done-primary, #7c3aed); }
.dsh-atb-statuspill[data-status="done"] { background: rgba(46,160,67,.16); color: var(--atb-success); }
.dsh-atb-statuspill[data-status="canceled"], .dsh-atb-statuspill[data-status="archived"] { background: rgba(128,128,128,.14); color: var(--atb-text-2, #888); }

.dsh-atb-detail-chips { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.dsh-atb-chip2 {
  display: inline-flex; align-items: center; gap: 4px; font-size: 11px; line-height: 1;
  padding: 3px 8px; border-radius: 6px;
  background: var(--atb-bg-inset, rgba(128,128,128,.09)); color: var(--atb-text-2, #999);
}
button.dsh-atb-chip2.dsh-atb-chip-btn {
  font: inherit; border: 1px solid var(--atb-border-2, rgba(128,128,128,.25)); cursor: pointer;
}
button.dsh-atb-chip2.dsh-atb-chip-btn:hover {
  border-color: var(--dsw-alias-brand-primary, #1f2328);
  color: var(--dsw-alias-label-primary, inherit);
  background: var(--atb-hover, rgba(128,128,128,.2));
}
.dsh-atb-chip2-icon { font-size: 10.5px; opacity: .85; }
.dsh-atb-chip2[data-tone="urgent"] { background: rgba(229,72,77,.15); color: var(--atb-error); }
.dsh-atb-chip2[data-tone="normal"] { background: rgba(142,78,198,.14); color: #a06ce0; }
.dsh-atb-chip2[data-tone="relaxed"] { background: rgba(62,99,221,.13); color: #6d92e8; }
.dsh-atb-detail-sub { font-size: 11.5px; color: var(--atb-text-2, gray); }

.dsh-atb-detail-id {
  margin-left: 8px; padding: 1px 6px; border: 1px solid rgba(128,128,128,.25); border-radius: 5px;
  background: transparent; color: inherit; font-family: var(--dsw-font-mono, ui-monospace, SFMono-Regular, Menlo, monospace);
  font-size: 11px; line-height: 1.5; cursor: copy;
}
.dsh-atb-detail-id:hover { border-color: rgba(128,128,128,.55); color: var(--atb-text, inherit); }
.dsh-atb-detail-id[data-state="copied"] { border-color: rgba(63,166,106,.55); color: #3fa66a; }
.dsh-atb-detail-id[data-state="failed"] { border-color: rgba(220,80,80,.55); color: #d05050; }

.dsh-atb-fieldcard {
  border: 1px solid var(--atb-border-2, rgba(128,128,128,.22)); border-radius: 10px;
  padding: 9px 11px; display: flex; flex-direction: column; gap: 5px;
  background: var(--atb-bg-1, rgba(128,128,128,.06));
}
.dsh-atb-fieldcard-label {
  font-size: 10.5px; font-weight: 600; letter-spacing: .05em; text-transform: uppercase;
  color: var(--atb-text-2, gray);
}
.dsh-atb-fieldcard[data-kind="prompt"] .dsh-atb-fieldcard-label { color: #8e63c8; }
.dsh-atb-promptbox {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 12px; line-height: 1.55; white-space: pre-wrap; word-break: break-word;
  background: var(--atb-bg-inset, rgba(128,128,128,.08)); border-radius: 7px; padding: 8px 10px;
  border: 1px dashed var(--atb-border-2, rgba(128,128,128,.25));
}
.dsh-atb-desc { white-space: pre-wrap; word-break: break-word; font-size: 13px; line-height: 1.55; }

.dsh-atb-detail-actions { display: flex; flex-direction: column; gap: 8px; }
.dsh-atb-detail-run {
  font: inherit; font-size: 12px; font-weight: 600; padding: 4px 11px; border-radius: 7px; cursor: pointer;
  border: 1px solid transparent; background: var(--dsw-alias-button-primary-fill, var(--dsw-alias-brand-primary, #1f2328)); color: var(--dsw-alias-label-primary-foreground, #fff);
  transition: filter .12s ease;
}
.dsh-atb-detail-run:hover { filter: brightness(1.1); }
.dsh-atb-detail-run[data-danger="true"] { background: rgba(229,72,77,.92); }
.dsh-atb-movebtns { display: flex; gap: 6px; flex-wrap: wrap; }
.dsh-atb-movebtn {
  font: inherit; font-size: 12px; padding: 4px 11px; border-radius: 999px; cursor: pointer;
  border: 1px solid var(--atb-border-2, rgba(128,128,128,.32));
  background: var(--atb-bg-1, rgba(128,128,128,.07)); color: var(--atb-text-2, inherit);
  transition: border-color .12s ease, color .12s ease;
}
.dsh-atb-movebtn:hover { border-color: var(--atb-border-2, rgba(128,128,128,.6)); color: inherit; }
.dsh-atb-movebtn[data-to="done"] { border-color: rgba(46,160,67,.55); color: var(--atb-success); }
.dsh-atb-movebtn[data-to="done"]:hover { background: rgba(46,160,67,.12); }
.dsh-atb-movebtn[data-to="canceled"], .dsh-atb-movebtn[data-to="archived"] { opacity: .75; }
.dsh-atb-movebtn[data-to="blocked"] { border-color: rgba(229,72,77,.45); }
.dsh-atb-movebtn[data-to="blocked"]:hover { background: rgba(229,72,77,.1); }
.dsh-atb-confirm { display: inline-flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.dsh-atb-confirm-label { font-size: 11.5px; color: var(--atb-text-2, gray); }

.dsh-atb-section { font-size: 13px; display: flex; flex-direction: column; gap: 7px; }
.dsh-atb-section h4 {
  margin: 0; font-size: 11px; color: var(--atb-text-2, gray);
  text-transform: uppercase; letter-spacing: .05em; display: flex; align-items: center; gap: 6px;
}
.dsh-atb-count2 {
  font-size: 10px; font-weight: 600; padding: 0 6px; border-radius: 999px; line-height: 16px;
  background: var(--atb-bg-inset, rgba(128,128,128,.14)); color: var(--atb-text-2, gray);
}
.dsh-atb-empty2 { font-size: 12px; color: var(--atb-text-2, gray); padding: 8px 0; }

.dsh-atb-commentlist { display: flex; flex-direction: column; gap: 8px; }
.dsh-atb-bubble { display: flex; gap: 8px; }
.dsh-atb-bubble-avatar {
  flex: none; width: 26px; height: 26px; border-radius: 8px; display: flex; align-items: center; justify-content: center;
  font-size: 13px; background: var(--atb-bg-inset, rgba(128,128,128,.12));
}
.dsh-atb-bubble[data-from="agent"] .dsh-atb-bubble-avatar { background: rgba(142,78,198,.15); }
.dsh-atb-bubble[data-from="system"] .dsh-atb-bubble-avatar { background: rgba(100,116,139,.16); }
.dsh-atb-bubble-main {
  flex: 1; min-width: 0; border-radius: 10px; padding: 6px 10px;
  background: var(--atb-bg-1, rgba(128,128,128,.08));
  border: 1px solid var(--atb-border-2, rgba(128,128,128,.18));
}
.dsh-atb-bubble[data-from="agent"] .dsh-atb-bubble-main { border-color: rgba(142,78,198,.3); background: rgba(142,78,198,.07); }
.dsh-atb-bubble-meta { display: flex; align-items: baseline; gap: 8px; margin-bottom: 3px; }
.dsh-atb-bubble-meta b { font-size: 11.5px; font-weight: 600; color: var(--atb-text, inherit); }
.dsh-atb-bubble[data-from="agent"] .dsh-atb-bubble-meta b { color: #a06ce0; }
.dsh-atb-comment-agent {
  border: none; background: none; padding: 0; font: inherit; cursor: pointer; text-align: left;
  font-size: 11.5px; font-weight: 600; color: #a06ce0;
}
.dsh-atb-comment-agent:hover { text-decoration: underline; }
.dsh-atb-bubble-meta span { font-size: 10.5px; color: var(--atb-text-2, gray); }
.dsh-atb-bubble-body { font-size: 12.5px; line-height: 1.55; white-space: pre-wrap; word-break: break-word; }

.dsh-atb-markdown-body { white-space: pre-wrap; word-break: break-word; }
.dsh-atb-detail-img-wrap {
  display: inline-flex; flex-direction: column; gap: 4px; max-width: min(100%, 520px); margin: 6px 8px 6px 0;
  vertical-align: top;
}
.dsh-atb-detail-img {
  display: block; max-width: 100%; max-height: 320px; object-fit: contain; border-radius: 8px; cursor: zoom-in;
  border: 1px solid var(--atb-border-2, rgba(128,128,128,.22)); background: var(--atb-bg-inset, rgba(128,128,128,.08));
}
.dsh-atb-detail-img-caption { font-size: 10.5px; color: var(--atb-text-2, gray); overflow-wrap: anywhere; }
.dsh-atb-lightbox-backdrop {
  position: fixed; inset: 0; z-index: 120; display: grid; place-items: center; padding: 28px;
  background: rgba(0,0,0,.76); backdrop-filter: blur(3px);
}
.dsh-atb-lightbox-content { position: relative; max-width: 96vw; max-height: 92vh; }
.dsh-atb-lightbox-img { display: block; max-width: 96vw; max-height: 92vh; object-fit: contain; border-radius: 10px; }
.dsh-atb-lightbox-close {
  position: absolute; top: -14px; right: -14px; width: 30px; height: 30px; border-radius: 999px; cursor: pointer;
  border: 1px solid rgba(255,255,255,.38); background: rgba(20,20,20,.9); color: #fff;
}

.dsh-atb-composer { display: flex; gap: 7px; align-items: flex-end; margin-top: 2px; }
.dsh-atb-composer-input {
  flex: 1; font: inherit; font-size: 12.5px; line-height: 1.5; padding: 7px 10px; border-radius: 9px;
  border: 1px solid var(--atb-border-2, rgba(128,128,128,.32));
  background: var(--atb-bg, transparent); color: inherit; resize: vertical; min-height: 38px;
}
.dsh-atb-composer-input:focus { outline: none; border-color: var(--dsw-alias-brand-primary, #1f2328); }
.dsh-atb-composer-send {
  flex: none; font: inherit; font-size: 12.5px; padding: 7px 14px; border-radius: 9px; cursor: pointer;
  border: 1px solid transparent; background: var(--dsw-alias-button-primary-fill, var(--dsw-alias-brand-primary, #1f2328)); color: var(--dsw-alias-label-primary-foreground, #fff);
}
.dsh-atb-composer-send:disabled { opacity: .4; cursor: default; }
/* Issue #51: the comment-wake deliver button (secondary accent) and the bubble delivery markers. */
.dsh-atb-composer-deliver {
  background: var(--atb-bg-1, rgba(128,128,128,.08));
  color: var(--dsw-alias-brand-primary, #1f2328);
  border-color: var(--dsw-alias-brand-primary, #1f2328);
  white-space: nowrap;
}
.dsh-atb-composer-deliver:hover:not(:disabled) { opacity: .85; }
.dsh-atb-comment-pending {
  font-size: 11px; padding: 0 6px; border-radius: 999px; opacity: .75;
  border: 1px dashed var(--atb-border-2, rgba(128,128,128,.4)); color: inherit;
}
.dsh-atb-comment-delivered {
  font: inherit; font-size: 11px; padding: 0 6px; border-radius: 999px; cursor: pointer;
  border: 1px solid var(--dsw-alias-brand-primary, #1f2328);
  background: var(--dsw-alias-brand-primary, #1f2328); color: var(--dsw-alias-label-primary-foreground, #fff);
}
span.dsh-atb-comment-delivered { cursor: default; }
.dsh-atb-image-actions { display: flex; align-items: center; gap: 8px; padding: 5px 1px 0; }
.dsh-atb-image-add {
  flex: none; font: inherit; font-size: 11.5px; line-height: 1.4; padding: 4px 8px; border-radius: 7px; cursor: pointer;
  border: 1px solid var(--atb-border-2, rgba(128,128,128,.3)); background: var(--atb-bg-1, rgba(128,128,128,.08)); color: inherit;
}
.dsh-atb-image-add:hover:not(:disabled) { background: var(--atb-hover, rgba(128,128,128,.14)); }
.dsh-atb-image-add:disabled { opacity: .45; cursor: default; }
.dsh-atb-image-hint { font-size: 10.5px; color: var(--atb-text-2, gray); }

.dsh-atb-section-toggle {
  border: none; background: none; padding: 0; font: inherit; cursor: pointer; text-align: left;
  display: inline-flex; align-items: baseline; gap: 6px; color: inherit;
}
.dsh-atb-section-toggle:hover { opacity: .8; }
.dsh-atb-toggle-caret { display: inline-block; width: 1em; font-size: 10px; }
.dsh-atb-execlist { display: flex; flex-direction: column; gap: 5px; }
.dsh-atb-exec-row {
  display: flex; align-items: center; gap: 8px; flex-wrap: wrap; font-size: 12px;
  padding: 5px 9px; border-radius: 8px;
  background: var(--atb-bg-1, rgba(128,128,128,.07));
  border: 1px solid var(--atb-border-2, rgba(128,128,128,.16));
}
.dsh-atb-exec-dot { flex: none; width: 7px; height: 7px; border-radius: 50%; background: rgba(128,128,128,.5); }
.dsh-atb-exec-dot[data-outcome="succeeded"] { background: var(--atb-success); box-shadow: 0 0 0 3px rgba(46,160,67,.15); }
.dsh-atb-exec-dot[data-outcome="failed"] { background: var(--atb-error); box-shadow: 0 0 0 3px rgba(229,72,77,.15); }
.dsh-atb-exec-dot[data-outcome="running"] { background: var(--atb-warn); box-shadow: 0 0 0 3px rgba(217,130,43,.18); animation: dsh-atb-pulse 1.6s ease-in-out infinite; }
@keyframes dsh-atb-pulse { 0%,100% { opacity: 1; } 50% { opacity: .35; } }
.dsh-atb-exec-trigger { font-size: 11px; color: var(--atb-text-2, gray); }
.dsh-atb-exec-outcome { font-size: 11px; font-weight: 600; padding: 1px 7px; border-radius: 5px; }
.dsh-atb-exec-outcome[data-outcome="succeeded"] { background: rgba(46,160,67,.15); color: var(--atb-success); }
.dsh-atb-exec-outcome[data-outcome="failed"] { background: rgba(229,72,77,.14); color: var(--atb-error); }
.dsh-atb-exec-outcome[data-outcome="running"] { background: rgba(217,130,43,.15); color: var(--atb-warn); }
.dsh-atb-exec-outcome[data-outcome="cancelled"] { background: rgba(128,128,128,.15); color: var(--atb-text-2, gray); }
.dsh-atb-exec-time { font-size: 11px; color: var(--atb-text-2, gray); }
.dsh-atb-exec-session {
  font: inherit; font-size: 11px; color: var(--atb-text-2, gray);
  background: none; border: none; padding: 0; cursor: pointer;
}
.dsh-atb-exec-session:hover { color: var(--dsw-alias-brand-primary, inherit); text-decoration: underline dotted; }
.dsh-atb-exec-error { flex-basis: 100%; font-size: 11px; color: var(--atb-error); word-break: break-all; }

.dsh-atb-dangerzone {
  display: flex; align-items: center; gap: 8px; margin-top: auto; padding-top: 8px;
  border-top: 1px dashed var(--atb-border-2, rgba(128,128,128,.25));
}

.dsh-atb-modal-backdrop {
  position: fixed; inset: 0; z-index: 80;
  background: var(--dsw-alias-bg-mask-1, rgba(15,17,21,.24));
  display: flex; align-items: center; justify-content: center;
  animation: dsh-atb-fade .14s ease;
}
@keyframes dsh-atb-fade { from { opacity: 0; } }
.dsh-atb-modal {
  width: min(560px, calc(100vw - 48px)); max-height: calc(100vh - 80px);
  display: flex; flex-direction: column; overflow: hidden;
  border-radius: var(--atb-radius-xl); corner-shape: var(--atb-corner);
  background: var(--atb-bg-1); color: var(--atb-text);
  border: 1px solid var(--atb-border-2);
  box-shadow: var(--atb-elevation-prominent);
  animation: dsh-atb-pop .16s ease;
}
.dsh-atb-taskform-modal {
  width: 1060px;
  min-width: 1060px;
  max-height: calc(100vh - 50px);
}
@keyframes dsh-atb-pop { from { opacity: 0; transform: translateY(8px) scale(.98); } }
.dsh-atb-modal-head {
  display: flex; align-items: center; gap: 10px;
  padding: 13px 16px 11px; border-bottom: 1px solid var(--dsw-alias-border-l2, rgba(128,128,128,.18));
}
.dsh-atb-modal-headicon {
  flex: none; width: 30px; height: 30px; border-radius: 9px;
  display: flex; align-items: center; justify-content: center;
  font-size: 14px; background: var(--dsw-alias-brand-primary, #1f2328); color: var(--dsw-alias-label-primary-foreground, #fff);
}
.dsh-atb-modal-headtext { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 1px; }
.dsh-atb-modal-headtext h3 { margin: 0; font-size: 15px; line-height: 1.3; }
.dsh-atb-modal-headtext p { margin: 0; font-size: 11.5px; color: var(--dsw-alias-label-secondary, gray); }
.dsh-atb-modal-close {
  flex: none; width: 26px; height: 26px; border-radius: 7px; border: none; cursor: pointer;
  background: transparent; color: var(--atb-text-3, gray); font-size: 13px; line-height: 1;
}
.dsh-atb-modal-close:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(128,128,128,.18)); color: var(--dsw-alias-label-primary, inherit); }

.dsh-atb-modal-body {
  padding: 13px 16px; overflow-y: auto;
  display: grid; grid-template-columns: 1fr 1fr; gap: 11px 10px;
}
.dsh-atb-taskform-body {
  padding: 14px 18px;
  display: grid;
  grid-template-columns: 1.05fr 1.15fr;
  gap: 18px;
}
.dsh-atb-form-col {
  display: flex;
  flex-direction: column;
  gap: 11px;
  min-width: 0;
}
.dsh-atb-form-left {
  border-right: 1px solid var(--dsw-alias-border-l2, rgba(128,128,128,.14));
  padding-right: 18px;
}
.dsh-atb-form-right {
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.dsh-atb-form-right .dsh-atb-field {
  flex: 1;
  display: flex;
  flex-direction: column;
}
.dsh-atb-form-right .dsh-atb-prompt-wrap {
  flex: 1;
  display: flex;
  flex-direction: column;
}
.dsh-atb-form-right .dsh-atb-prompt-inner {
  flex: 1;
  display: flex;
  flex-direction: column;
}
.dsh-atb-form-right .dsh-atb-prompt-input {
  flex: 1;
  min-height: 130px;
  resize: vertical;
}
.dsh-atb-form-subgrid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}

@media (max-width: 768px) {
  .dsh-atb-taskform-modal { width: calc(100vw - 20px); min-width: 0; }
  .dsh-atb-taskform-body { grid-template-columns: 1fr; gap: 14px; padding: 12px 14px; }
  .dsh-atb-form-left { border-right: none; padding-right: 0; }
  .dsh-atb-form-right .dsh-atb-prompt-input { min-height: 90px; }
}
@media (min-width: 769px) and (max-width: 1099px) {
  .dsh-atb-taskform-modal { width: calc(100vw - 40px); min-width: 0; }
}
.dsh-atb-field { display: flex; flex-direction: column; gap: 5px; min-width: 0; }
.dsh-atb-field[data-span="full"] { grid-column: 1 / -1; }
.dsh-atb-field-label {
  display: flex; align-items: center; gap: 3px;
  font-size: 11px; font-weight: 600; letter-spacing: .03em;
  color: var(--dsw-alias-label-secondary, gray);
}
.dsh-atb-req { color: var(--dsw-alias-state-error-primary, var(--atb-error)); font-style: normal; }
.dsh-atb-modal-body input:not([type="checkbox"]), .dsh-atb-modal-body textarea, .dsh-atb-modal-body select {
  font: inherit; font-size: 13px; padding: 7px 10px; border-radius: 8px;
  width: 100%; box-sizing: border-box;
  border: 1px solid var(--atb-border-2);
  background: var(--atb-input); color: var(--atb-text);
  transition: border-color .12s ease, box-shadow .12s ease;
}
.dsh-atb-modal-body textarea { min-height: 64px; resize: vertical; }
.dsh-atb-modal-body input:not([type="checkbox"]):focus, .dsh-atb-modal-body textarea:focus, .dsh-atb-modal-body select:focus {
  outline: none; border-color: var(--atb-accent);
  box-shadow: var(--atb-focus);
}
.dsh-atb-modal-body .dsh-atb-input-bad { border-color: var(--dsw-alias-state-error-primary, var(--atb-error)); }
.dsh-atb-modal-body .dsh-atb-input-bad:focus { box-shadow: 0 0 0 3px color-mix(in srgb, var(--dsw-alias-state-error-primary, var(--atb-error)) 20%, transparent); }


.dsh-atb-mode-picker { display: grid; grid-template-columns: 1fr 1fr; gap: 7px; }
.dsh-atb-mode-picker[data-exec="true"] { grid-template-columns: repeat(3, 1fr); }
.dsh-atb-mode-picker[data-exec="true"] .dsh-atb-mode-opt { padding: 7px 8px; }
.dsh-atb-mode-picker[data-exec="true"] .dsh-atb-mode-name { font-size: 12px; }
.dsh-atb-mode-picker[data-exec="true"] .dsh-atb-mode-hint { font-size: 10px; }
.dsh-atb-mode-opt {
  display: flex; flex-direction: column; align-items: flex-start; gap: 3px;
  padding: 8px 10px; border-radius: 9px; cursor: pointer;
  border: 1px solid var(--dsw-alias-border-l2, rgba(128,128,128,.35));
  background: transparent; color: inherit;
  transition: border-color .12s ease, background .12s ease;
}
.dsh-atb-mode-name { font-size: 12.5px; font-weight: 600; }
.dsh-atb-mode-hint { font-size: 10.5px; color: var(--atb-text-3, gray); }
.dsh-atb-mode-opt:hover { border-color: var(--atb-text-3, rgba(128,128,128,.6)); }
.dsh-atb-mode-opt[data-on="true"] { border-color: var(--dsw-alias-brand-primary, #1f2328); background: color-mix(in srgb, var(--dsw-alias-brand-primary, #1f2328) 8%, transparent); }

.dsh-atb-cron-presets { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.dsh-atb-cron-preset {
  font: inherit; font-size: 11px; padding: 2px 9px; border-radius: 999px; cursor: pointer;
  border: 1px solid var(--dsw-alias-border-l2, rgba(128,128,128,.35));
  background: transparent; color: var(--dsw-alias-label-secondary, inherit);
}
.dsh-atb-cron-preset:hover { border-color: var(--atb-text-3, rgba(128,128,128,.6)); color: inherit; }
.dsh-atb-cron-preset[data-on="true"] { border-color: transparent; background: var(--dsw-alias-brand-primary, #1f2328); color: var(--dsw-alias-label-primary-foreground, #fff); }
.dsh-atb-cron-next { margin-left: auto; font-size: 11px; color: var(--atb-text-3, gray); }

.dsh-atb-modal-foot {
  display: flex; align-items: center; gap: 10px;
  padding: 11px 16px; border-top: 1px solid var(--dsw-alias-border-l2, rgba(128,128,128,.18));
  background: var(--dsw-alias-bg-layer-1, rgba(128,128,128,.04));
}
.dsh-atb-modal-hint { flex: 1; min-width: 0; font-size: 11.5px; color: var(--atb-text-3, gray); }
.dsh-atb-modal-hint[data-tone="bad"] { color: var(--dsw-alias-state-error-primary, var(--atb-error)); }
.dsh-atb-modal-footbtns { display: flex; gap: 8px; }

.dsh-atb-secondary { flex: 1; min-height: 0; overflow-y: auto; display: flex; flex-direction: column; gap: 8px; }
.dsh-atb-link { color: var(--dsw-alias-state-business-primary, var(--atb-accent)); cursor: pointer; text-decoration: none; }
.dsh-atb-link:hover { text-decoration: underline; }

.dsh-atb-alert-backdrop {
  position: fixed; inset: 0; z-index: 90;
  background: var(--dsw-alias-bg-mask-1, rgba(15,17,21,.24));
  display: flex; align-items: center; justify-content: center;
  animation: dsh-atb-fade .12s ease;
}
.dsh-atb-alert {
  min-width: 280px; max-width: 380px; padding: 20px 24px;
  border-radius: var(--atb-radius-lg); corner-shape: var(--atb-corner);
  background: var(--atb-bg-1); color: var(--atb-text);
  border: 1px solid var(--atb-border-2);
  box-shadow: var(--atb-elevation-prominent);
  display: flex; flex-direction: column; align-items: center; gap: 14px;
  animation: dsh-atb-pop .14s ease;
}
.dsh-atb-alert-icon { font-size: 28px; line-height: 1; }
.dsh-atb-alert-msg {
  font-size: 13.5px; line-height: 1.55; text-align: center;
  word-break: break-word; white-space: pre-wrap;
  color: var(--dsw-alias-label-primary, inherit);
}
.dsh-atb-alert .dsh-atb-btn { padding: 6px 28px; font-size: 13px; }

.dsh-atb-isolation-note { display: block; margin-top: 6px; font-size: 11px; color: var(--atb-text-3, gray); }
.dsh-atb-mode-picker[data-disabled="true"] .dsh-atb-mode-opt { cursor: not-allowed; opacity: .55; }
.dsh-atb-iso-none { font-size: 12.5px; color: var(--dsw-alias-label-secondary, inherit); }
.dsh-atb-iso-repo[data-multi="true"] { padding: 6px 0 2px; border-top: 1px dashed var(--dsw-alias-border-secondary, #ddd2); }
.dsh-atb-iso-repo[data-multi="true"]:first-of-type { border-top: none; padding-top: 0; }
.dsh-atb-iso-repohead { display: flex; flex-wrap: wrap; gap: 6px 12px; margin-bottom: 6px; align-items: baseline; }
.dsh-atb-iso-repohead code {
font-family: ui-monospace, Consolas, monospace; font-size: 11.5px; font-weight: 600;
color: var(--dsw-alias-state-business-primary, var(--atb-accent));
}
.dsh-atb-iso-facts { display: flex; flex-wrap: wrap; gap: 6px 12px; margin-bottom: 8px; }
.dsh-atb-iso-fact { font-size: 11.5px; color: var(--dsw-alias-label-secondary, inherit); }
.dsh-atb-iso-fact b { font-weight: 600; color: var(--dsw-alias-state-business-primary, var(--atb-accent)); }
.dsh-atb-iso-commits { display: flex; flex-direction: column; gap: 3px; margin-bottom: 8px; }
.dsh-atb-iso-commit { display: flex; gap: 8px; font-size: 11.5px; align-items: baseline; }
.dsh-atb-iso-commit code {
  font-family: ui-monospace, Consolas, monospace; font-size: 10.5px;
  color: var(--dsh-alias-state-business-primary, var(--atb-accent)); flex-shrink: 0;
}
.dsh-atb-iso-commit span { word-break: break-all; color: var(--dsw-alias-label-secondary, inherit); }
.dsh-atb-iso-more { font-size: 11px; color: var(--atb-text-3, gray); }
.dsh-atb-iso-nocommit { font-size: 11.5px; color: var(--atb-text-3, gray); margin-bottom: 8px; }
.dsh-atb-iso-dirty {
  font-size: 11.5px; color: var(--dsw-alias-state-error-primary, var(--atb-error));
  background: rgba(229,72,77,.09); border: 1px solid rgba(229,72,77,.35);
  border-radius: 8px; padding: 6px 10px; margin-bottom: 8px;
}
.dsh-atb-iso-actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.dsh-atb-iso-hint { font-size: 11px; color: var(--atb-text-3, gray); }

.dsh-atb-diag { max-width: 520px; width: min(520px, 92vw); }
.dsh-atb-diag-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin-bottom: 14px; }
.dsh-atb-diag-item {
  display: flex; flex-direction: column; align-items: center; gap: 2px;
  padding: 10px 6px; border-radius: 10px;
  border: 1px solid var(--dsw-alias-border-l2, rgba(128,128,128,.25));
  background: var(--dsw-alias-bg-layer-1, rgba(128,128,128,.04));
}
.dsh-atb-diag-item b { font-size: 18px; font-weight: 700; }
.dsh-atb-diag-item span { font-size: 10.5px; color: var(--atb-text-3, gray); }
.dsh-atb-diag-item[data-bad="true"] b { color: var(--dsw-alias-state-error-primary, var(--atb-error)); }
.dsh-atb-diag-sec h4 { margin: 0 0 8px; font-size: 12.5px; }
.dsh-atb-diag-orphans { display: flex; flex-direction: column; gap: 6px; }
.dsh-atb-diag-orphan {
  display: flex; align-items: center; gap: 10px; justify-content: space-between;
  padding: 7px 10px; border-radius: 8px;
  border: 1px solid var(--dsw-alias-border-l2, rgba(128,128,128,.25));
}
.dsh-atb-diag-orphan-path { font-size: 11.5px; font-family: ui-monospace, Consolas, monospace; word-break: break-all; }

.dsh-atb-cke { display: flex; flex-direction: column; gap: 6px; }
.dsh-atb-cke-row { display: flex; align-items: center; gap: 8px; }
.dsh-atb-cke-box { flex-shrink: 0; width: 15px; height: 15px; cursor: pointer; }
.dsh-atb-cke-text {
  flex: 1; min-width: 0; font-size: 12.5px; padding: 6px 9px;
  border-radius: 8px; border: 1px solid var(--dsw-alias-border-l2, rgba(128,128,128,.3));
  background: var(--dsw-alias-bg-layer-1, transparent); color: inherit;
}
.dsh-atb-cke-del {
  flex-shrink: 0; border: none; background: none; cursor: pointer; padding: 4px;
  color: var(--atb-text-3, gray); font-size: 12px; border-radius: 6px;
}
.dsh-atb-cke-del:hover { color: var(--dsw-alias-state-error-primary, var(--atb-error)); background: rgba(229,72,77,.08); }
.dsh-atb-cke-add {
  align-self: flex-start; border: 1px dashed var(--dsw-alias-border-l2, rgba(128,128,128,.4));
  background: none; color: var(--dsw-alias-label-secondary, inherit); cursor: pointer;
  font-size: 11.5px; padding: 5px 12px; border-radius: 8px;
}
.dsh-atb-cke-add:hover { color: var(--dsw-alias-state-business-primary, var(--atb-accent)); border-color: var(--dsw-alias-state-business-primary, var(--atb-accent)); }
.dsh-atb-cke-hint { font-size: 10.5px; color: var(--atb-text-3, gray); }

.dsh-atb-cl-progress { margin-left: 8px; font-size: 11px; font-weight: 400; color: var(--atb-text-3, gray); }
.dsh-atb-cl-progress[data-tone="bad"] { color: var(--dsw-alias-state-error-primary, var(--atb-error)); font-weight: 600; }
.dsh-atb-cl-items { display: flex; flex-direction: column; gap: 5px; }
.dsh-atb-cl-item {
  display: flex; align-items: baseline; gap: 9px; padding: 6px 9px; border-radius: 8px;
  border: 1px solid var(--dsw-alias-border-l2, rgba(128,128,128,.22));
  background: var(--dsw-alias-bg-layer-1, rgba(128,128,128,.03)); cursor: pointer;
}
.dsh-atb-cl-item:hover { border-color: var(--dsw-alias-border-l2, rgba(128,128,128,.4)); }
.dsh-atb-cl-item input { flex-shrink: 0; transform: translateY(1px); cursor: pointer; }
.dsh-atb-cl-item[data-checked="true"] .dsh-atb-cl-text { text-decoration: line-through; color: var(--atb-text-3, gray); }
.dsh-atb-cl-item[data-alert="true"] {
  border-color: rgba(229,72,77,.45); background: rgba(229,72,77,.06);
}
.dsh-atb-cl-text { flex: 1; min-width: 0; font-size: 12.5px; word-break: break-word; }
.dsh-atb-cl-meta { flex-shrink: 0; font-size: 10.5px; color: var(--atb-text-3, gray); display: flex; flex-direction: column; gap: 2px; align-items: flex-end; }
.dsh-atb-cl-note { max-width: 280px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; color: var(--dsw-alias-label-secondary, inherit); }

.dsh-atb-rpt-summary { font-size: 12.5px; line-height: 1.6; white-space: pre-wrap; word-break: break-word; margin-bottom: 8px; }
.dsh-atb-rpt-sec { margin-bottom: 8px; }
.dsh-atb-rpt-label { font-size: 11px; color: var(--atb-text-3, gray); margin-bottom: 4px; }
.dsh-atb-rpt-list { margin: 0; padding-left: 18px; font-size: 12px; line-height: 1.55; word-break: break-all; }
.dsh-atb-rpt-risk {
  font-size: 12px; line-height: 1.55; white-space: pre-wrap; word-break: break-word;
  color: var(--dsw-alias-state-warn-primary, #f5a524);
  background: rgba(245,165,36,.08); border: 1px solid rgba(245,165,36,.3);
  border-radius: 8px; padding: 6px 10px;
}

.dsh-atb-iso-commit { display: flex; flex-direction: column; gap: 3px; }
.dsh-atb-iso-commit-btn {
  display: flex; gap: 8px; font-size: 11.5px; align-items: baseline; text-align: left;
  border: none; background: none; padding: 2px 4px; margin: 0 -4px; border-radius: 6px; cursor: pointer;
  color: inherit; width: fit-content; max-width: 100%;
}
.dsh-atb-iso-commit-btn:hover { background: var(--dsw-alias-bg-layer-2, rgba(128,128,128,.08)); }
.dsh-atb-iso-commit-btn code {
  font-family: ui-monospace, Consolas, monospace; font-size: 10.5px;
  color: var(--dsw-alias-state-business-primary, var(--atb-accent)); flex-shrink: 0;
}
.dsh-atb-iso-commit-btn span { word-break: break-all; color: var(--dsw-alias-label-secondary, inherit); }
.dsh-atb-iso-commit[data-open="true"] > .dsh-atb-iso-commit-btn code { font-weight: 700; }
.dsh-atb-iso-dirty { display: flex; flex-direction: column; gap: 6px;
  font-size: 11.5px; color: var(--dsw-alias-state-error-primary, var(--atb-error));
  background: rgba(229,72,77,.09); border: 1px solid rgba(229,72,77,.35);
  border-radius: 8px; padding: 6px 10px; margin-bottom: 8px;
}
.dsh-atb-iso-dirty-toggle { border: none; background: none; cursor: pointer; padding: 0; text-align: left; color: inherit; font-size: inherit; }
.dsh-atb-iso-dirty-files { display: flex; flex-direction: column; gap: 2px; }
.dsh-atb-iso-dirty-file {
  border: none; background: none; cursor: pointer; text-align: left; padding: 1px 2px;
  font-size: 11px; color: var(--dsw-alias-label-secondary, inherit); border-radius: 4px; word-break: break-all;
}
.dsh-atb-iso-dirty-file:hover { background: rgba(128,128,128,.1); color: var(--dsw-alias-state-business-primary, var(--atb-accent)); }
.dsh-atb-iso-dirty-file code { font-family: ui-monospace, Consolas, monospace; font-size: 10px; margin-right: 6px; }
.dsh-atb-diffview { margin-top: 6px; border-radius: 8px; overflow: hidden;
  border: 1px solid var(--dsw-alias-border-l2, rgba(128,128,128,.25)); }
.dsh-atb-diffview-head { display: flex; align-items: center; gap: 10px; padding: 5px 10px;
  background: var(--dsw-alias-bg-layer-2, rgba(128,128,128,.08)); }
.dsh-atb-diffview-title { font-family: ui-monospace, Consolas, monospace; font-size: 10.5px;
  color: var(--dsw-alias-state-business-primary, var(--atb-accent)); word-break: break-all; }
.dsh-atb-diffview-hint { font-size: 10.5px; color: var(--atb-text-3, gray); }
.dsh-atb-diffview-error { padding: 8px 10px; font-size: 11.5px; color: var(--dsw-alias-state-error-primary, var(--atb-error)); }
.dsh-atb-diffview-pre {
  margin: 0; padding: 8px 10px; max-height: 340px; overflow: auto;
  font-family: ui-monospace, Consolas, monospace; font-size: 10.5px; line-height: 1.5;
  white-space: pre; color: var(--dsw-alias-label-secondary, inherit);
}

.dsh-atb-newmenu { position: relative; display: inline-flex; }
.dsh-atb-newmenu-backdrop { position: fixed; inset: 0; z-index: 40; }
.dsh-atb-newmenu-list {
  position: absolute; top: calc(100% + 4px); left: 0; z-index: 41; min-width: 180px;
  display: flex; flex-direction: column; padding: 4px;
  border-radius: var(--atb-radius-lg); corner-shape: var(--atb-corner);
  background: var(--atb-menu); -webkit-backdrop-filter: var(--atb-menu-blur); backdrop-filter: var(--atb-menu-blur);
  color: var(--atb-text); border: 1px solid var(--atb-border);
  box-shadow: var(--atb-elevation-panel), 0 10px 26px -14px rgba(8, 12, 20, .32);
}
.dsh-atb-newmenu-opt {
  border: none; background: none; text-align: left; cursor: pointer; padding: 7px 10px;
  font-size: 12.5px; color: inherit; border-radius: 7px; white-space: nowrap;
}
.dsh-atb-newmenu-opt:hover { background: var(--atb-hover); }
.dsh-atb-newmenu-sep { height: 1px; margin: 4px 6px; background: var(--dsw-alias-border-l2, rgba(128,128,128,.25)); }
.dsh-atb-newmenu-catgroup { display: flex; flex-direction: column; }
.dsh-atb-newmenu-cat {
  padding: 6px 10px 3px; font-size: 11px; font-weight: 600;
  color: var(--atb-text-3, gray); white-space: nowrap;
}

.dsh-atb-tplm { max-width: 640px; width: min(640px, 92vw); }
.dsh-atb-tplm .dsh-atb-modal-body,
.dsh-atb-set .dsh-atb-modal-body,
.dsh-atb-diag .dsh-atb-modal-body,
.dsh-atb-imp .dsh-atb-modal-body {
  display: flex; flex-direction: column; gap: 10px;
}
.dsh-atb-tplm-list { display: flex; flex-direction: column; gap: 8px; width: 100%; }
.dsh-atb-tplm-catgroup { display: flex; flex-direction: column; gap: 8px; }
.dsh-atb-tplm-cathead { font-size: 11px; font-weight: 600; color: var(--atb-text-3, gray); padding-left: 2px; }
.dsh-atb-tplm-row {
  display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 8px 12px; border-radius: 8px;
  border: 1px solid var(--dsw-alias-border-l2, rgba(128,128,128,.25));
  background: var(--dsw-alias-bg-layer-1, rgba(128,128,128,.02));
}
.dsh-atb-tplm-name {
  flex: 0 0 150px; width: 150px; max-width: 150px; font-size: 12.5px; padding: 5px 8px; border-radius: 7px;
  border: 1px solid var(--dsw-alias-border-l2, rgba(128,128,128,.3));
  background: var(--dsw-alias-bg-layer-1, transparent); color: inherit;
  box-sizing: border-box;
}
.dsh-atb-tplm-catwrap { position: relative; flex: 0 0 110px; width: 110px; max-width: 110px; }
.dsh-atb-tplm-category {
  width: 100%; max-width: 100%; font-size: 11.5px; padding: 5px 8px; border-radius: 7px;
  border: 1px solid var(--dsw-alias-border-l2, rgba(128,128,128,.3));
  background: var(--dsw-alias-bg-layer-1, transparent); color: inherit;
  box-sizing: border-box;
}
/* Suggestion dropdown for the category input: always full list, never filtered. */
.dsh-atb-tplm-catpop {
  position: absolute; top: calc(100% + 3px); left: 0; z-index: 6; min-width: 140px; max-height: 180px; overflow-y: auto;
  display: flex; flex-direction: column; padding: 4px;
  border-radius: var(--atb-radius-md); corner-shape: var(--atb-corner);
  background: var(--atb-menu); -webkit-backdrop-filter: var(--atb-menu-blur); backdrop-filter: var(--atb-menu-blur);
  color: var(--atb-text); border: 1px solid var(--atb-border);
  box-shadow: var(--atb-elevation-panel);
}
.dsh-atb-tplm-catopt {
  border: none; background: none; text-align: left; cursor: pointer; padding: 5px 8px;
  font-size: 11.5px; color: inherit; border-radius: 6px; white-space: nowrap;
}
.dsh-atb-tplm-catopt:hover { background: var(--atb-hover); }
/* Flipped variant: open upward when the input sits near the modal bottom. */
.dsh-atb-tplm-catpop-up { top: auto; bottom: calc(100% + 3px); }
.dsh-atb-tplm-catstatic {
  flex: 0 0 110px; max-width: 110px; font-size: 11px; color: var(--atb-text-3, gray);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.dsh-atb-tplm-meta {
  flex: 1; min-width: 0; font-size: 11px; color: var(--atb-text-3, gray);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.dsh-atb-tplm-btns { display: flex; align-items: center; gap: 6px; flex-shrink: 0; }

.dsh-atb-imp { max-width: 600px; width: min(600px, 92vw); }
.dsh-atb-imp-picker { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; }
.dsh-atb-imp-picker input[type="file"] { font-size: 12px; }
.dsh-atb-imp-filename { font-size: 11.5px; color: var(--dsw-alias-state-business-primary, var(--atb-accent)); word-break: break-all; }
.dsh-atb-imp-note { font-size: 11px; color: var(--atb-text-3, gray); margin-bottom: 10px; }
.dsh-atb-imp-error { font-size: 12px; color: var(--dsw-alias-state-error-primary, var(--atb-error)); margin-bottom: 8px; }
.dsh-atb-imp-stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin-bottom: 12px; }
.dsh-atb-imp-stat {
  display: flex; flex-direction: column; align-items: center; gap: 2px; padding: 9px 6px; border-radius: 9px;
  border: 1px solid var(--dsw-alias-border-l2, rgba(128,128,128,.25));
}
.dsh-atb-imp-stat b { font-size: 17px; font-weight: 700; }
.dsh-atb-imp-stat span { font-size: 10.5px; color: var(--atb-text-3, gray); }
.dsh-atb-imp-stat[data-tone="ok"] b { color: var(--dsw-alias-state-success-primary, #30a46c); }
.dsh-atb-imp-stat[data-tone="warn"] b { color: var(--dsw-alias-state-warn-primary, #f5a524); }
.dsh-atb-imp-stat[data-tone="bad"] b { color: var(--dsw-alias-state-error-primary, var(--atb-error)); }
.dsh-atb-imp-sec h4 { margin: 0 0 6px; font-size: 12px; }
.dsh-atb-imp-sec { margin-bottom: 10px; }
.dsh-atb-imp-list { display: flex; flex-direction: column; gap: 4px; max-height: 160px; overflow-y: auto; }
.dsh-atb-imp-row {
  display: flex; align-items: center; gap: 10px; justify-content: space-between;
  padding: 5px 9px; border-radius: 7px; border: 1px solid var(--dsw-alias-border-l2, rgba(128,128,128,.2));
}
.dsh-atb-imp-row[data-tone="bad"] { border-color: rgba(229,72,77,.35); }
.dsh-atb-imp-row-title { font-size: 12px; flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dsh-atb-imp-row-status { font-size: 10.5px; color: var(--atb-text-3, gray); flex-shrink: 0; }
.dsh-atb-imp-result { font-size: 12px; color: var(--dsw-alias-state-success-primary, #30a46c); margin-top: 10px; }
.dsh-atb-badge[data-kind="checklist"] { color: var(--dsw-alias-label-secondary, inherit); }
/* Prerequisite badge: neutral information, not an error. The red/pink chip is
   reserved for the genuinely blocked marker; the ready state is quieter still
   (a muted neutral chip, no green). Single line, never wraps at 360px. */
.dsh-atb-badge[data-kind="dependency"] {
  background: var(--atb-bg-inset, rgba(128,128,128,.14));
  color: var(--atb-text-2, gray);
  white-space: nowrap;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
}
.dsh-atb-badge[data-kind="dependency"][data-ready="true"] { opacity: .78; }
.dsh-atb-set { max-width: 860px; width: min(860px, 96vw); height: min(780px, 90vh); max-height: 90vh; }
.dsh-atb-settings-layout { display: flex; flex: 1; min-height: 0; overflow: hidden; }
.dsh-atb-settings-nav { flex: 0 0 138px; padding: 16px 10px; border-right: 1px solid var(--atb-border-2, rgba(128,128,128,.2)); display: flex; flex-direction: column; gap: 6px; }
.dsh-atb-settings-nav button { border: 0; border-radius: 7px; padding: 11px 12px; color: inherit; background: transparent; font: inherit; text-align: left; cursor: pointer; }
.dsh-atb-settings-nav button[aria-selected="true"] { background: var(--atb-active); color: var(--atb-text); font-weight: 600; box-shadow: inset 2px 0 0 var(--atb-accent); }
.dsh-atb-settings-nav button:focus-visible { outline: none; box-shadow: var(--atb-focus); }
.dsh-atb-settings-content { flex: 1; min-width: 0; min-height: 0; display: flex; flex-direction: column; overflow: hidden; }
.dsh-atb-settings-content > [hidden] { display: none !important; }
.dsh-atb-settings-content > .dsh-atb-modal-body { flex: 1; min-height: 0; max-height: none; }
.dsh-atb-set .dsh-atb-field-inline {
  display: grid;
  grid-template-columns: min(128px, 35%) minmax(0, 1fr);
  align-items: center;
  gap: 12px;
}
.dsh-atb-settings-content > .dsh-atb-modal-body > .dsh-atb-diag-sec {
  padding-bottom: 18px;
  border-bottom: 1px solid var(--dsw-alias-border-l2, var(--atb-border-2, rgba(128,128,128,.22)));
}
@media (max-width: 600px) { .dsh-atb-settings-nav { flex-basis: 94px; padding: 12px 6px; } .dsh-atb-settings-nav button { padding: 10px 6px; font-size: 12px; } .dsh-atb-settings-content .dsh-atb-modal-foot { flex-wrap: wrap; gap: 8px; } }
.dsh-atb-set .dsh-atb-mode-picker { margin-top: 8px; }
.dsh-atb-set .dsh-atb-isolation-note { margin-top: 10px; }
.dsh-atb-set .dsh-atb-perm-picker { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 7px; margin-top: 4px; }
.dsh-atb-set .dsh-atb-perm-opt {
  display: flex; flex-direction: column; align-items: flex-start; gap: 3px;
  padding: 8px 10px; border-radius: 9px; cursor: pointer; text-align: left;
  border: 1px solid var(--dsw-alias-border-l2, rgba(128,128,128,.35));
  background: transparent; color: inherit;
  transition: border-color .12s ease, background .12s ease;
}
.dsh-atb-set .dsh-atb-perm-name { display: flex; align-items: center; gap: 5px; font-size: 12px; font-weight: 600; }
.dsh-atb-set .dsh-atb-perm-hint { font-size: 10.5px; color: var(--atb-text-3, gray); line-height: 1.35; }
.dsh-atb-set .dsh-atb-perm-opt:hover { border-color: var(--atb-text-3, rgba(128,128,128,.6)); }
.dsh-atb-set .dsh-atb-perm-opt[data-on="true"] {
  border-color: var(--dsw-alias-brand-primary, #1f2328);
  background: color-mix(in srgb, var(--dsw-alias-brand-primary, #1f2328) 9%, transparent);
}
.dsh-atb-settings-numbers { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; margin-top: 10px; }
.dsh-atb-settings-numbers label { display: grid; gap: 5px; font-size: 12px; color: var(--dsw-alias-label-secondary, #888); }
.dsh-atb-settings-numbers input { width: 100%; }
.dsh-atb-storage-path { width: 100%; margin-top: 10px; font-family: ui-monospace, SFMono-Regular, Consolas, monospace; }
.dsh-atb-storage-meta { display: grid; gap: 4px; margin-top: 8px; color: var(--dsh-atb-muted); font-size: 12px; overflow-wrap: anywhere; }
.dsh-atb-storage-error { color: var(--dsh-atb-danger); }
.dsh-atb-storage-actions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 8px; margin-top: 10px; }
.dsh-atb-storage-notice { display: grid; gap: 4px; margin-top: 8px; font-size: 12px; }
.dsh-atb-storage-notice-ok { color: var(--dsw-alias-state-success-primary, #2e7d32); padding: 4px 8px; border-radius: 6px; background: rgba(46,125,50,.1); }
.dsh-atb-storage-notice-warn { color: var(--dsw-alias-state-warning-primary, #b8860b); padding: 4px 8px; border-radius: 6px; background: rgba(184,134,11,.1); word-break: break-word; }


.dsh-atb-prompt-wrap {
  display: flex; flex-direction: column; gap: 6px; position: relative; width: 100%;
  border-radius: 9px; transition: border-color .12s ease;
}
.dsh-atb-prompt-wrap[data-drag-over="true"] {
  outline: 2px dashed var(--dsw-alias-brand-primary, #1f2328);
  background: color-mix(in srgb, var(--dsw-alias-brand-primary, #1f2328) 6%, transparent);
}
.dsh-atb-prompt-inner { position: relative; width: 100%; }
.dsh-atb-prompt-input {
  width: 100%; box-sizing: border-box; font: inherit; font-size: 13px; line-height: 1.5;
  padding: 7px 10px; border-radius: 8px; resize: vertical; min-height: 68px;
  border: 1px solid var(--dsw-alias-border-l2, rgba(128,128,128,.35));
  background: var(--dsw-specific-input-major, transparent); color: var(--dsw-alias-label-primary, inherit);
}
.dsh-atb-prompt-input:focus {
  outline: none; border-color: var(--dsw-alias-brand-primary, #1f2328);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--dsw-alias-brand-primary, #1f2328) 18%, transparent);
}

.dsh-atb-slash-popup {
  display: flex; flex-direction: column; overflow: hidden;
  border-radius: var(--atb-radius-md); corner-shape: var(--atb-corner);
  background: var(--atb-menu); -webkit-backdrop-filter: var(--atb-menu-blur); backdrop-filter: var(--atb-menu-blur);
  color: var(--atb-text); border: 1px solid var(--atb-border);
  box-shadow: var(--atb-elevation-panel);
}
.dsh-atb-slash-head {
  display: flex; align-items: center; justify-content: space-between;
  padding: 6px 10px; border-bottom: 1px solid var(--dsw-alias-border-l2, rgba(128,128,128,.15));
  background: var(--dsw-alias-bg-elevated, rgba(128,128,128,.06));
}
.dsh-atb-slash-title { font-size: 11px; font-weight: 600; color: var(--dsw-alias-label-secondary, gray); }
.dsh-atb-slash-hint { font-size: 10px; color: var(--atb-text-3, gray); }
.dsh-atb-slash-list { overflow-y: auto; max-height: 200px; display: flex; flex-direction: column; padding: 4px; }
.dsh-atb-slash-item {
  display: flex; align-items: center; gap: 8px; padding: 6px 8px; border-radius: 6px;
  cursor: pointer; font-size: 12px; transition: background .1s ease;
}
.dsh-atb-slash-item[data-active="true"], .dsh-atb-slash-item:hover {
  background: var(--atb-hover);
}
.dsh-atb-slash-badge {
  font-size: 10px; font-weight: 600; padding: 1px 5px; border-radius: 4px; flex-shrink: 0;
}
.dsh-atb-slash-badge[data-kind="command"] { background: rgba(217,130,43,.15); color: var(--atb-warn); }
.dsh-atb-slash-badge[data-kind="skill"] { background: rgba(142,78,198,.15); color: #a06ce0; }
.dsh-atb-slash-name { font-weight: 600; font-family: monospace; font-size: 12.5px; }
.dsh-atb-slash-param { font-size: 11px; color: var(--atb-text-3, gray); font-family: monospace; }
.dsh-atb-slash-desc { font-size: 11px; color: var(--dsw-alias-label-secondary, gray); margin-left: auto; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 45%; }

.dsh-atb-prompt-foot { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.dsh-atb-prompt-tip { font-size: 11px; color: var(--atb-text-3, gray); }
.dsh-atb-prompt-tip code { font-size: 10.5px; padding: 1px 4px; border-radius: 4px; background: rgba(128,128,128,.14); }

.dsh-atb-queuechip {
    margin-left: auto; padding: 1px 7px; border: none; border-radius: 9px;
    font-size: 11px; line-height: 16px; cursor: pointer; pointer-events: auto;
    background: var(--atb-bg-inset, rgba(127,127,127,.15)); color: var(--atb-text-2, gray);
    font-variant-numeric: tabular-nums;
  }
.dsh-atb-queuechip[data-bad="true"] { background: rgba(217,130,43,.18); color: var(--atb-warn); }
.dsh-atb-queuechip:hover { filter: brightness(1.1); }

  .dsh-atb-queuepanel { width: 480px; max-width: 92vw; }
  .dsh-atb-queuepanel-actions { display: flex; align-items: center; gap: 10px; margin-top: 14px; flex-wrap: wrap; }
  .dsh-atb-queuepanel-actions .dsh-atb-btn[data-armed="true"] {
    background: rgba(200,49,49,.85); color: #fff; border-color: transparent;
  }

/* Human waiting and delivery review. */
.dsh-atb-human-actions { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 8px; }
.dsh-atb-fieldcard[data-kind="human-wait"] label { display: grid; gap: 5px; }
.dsh-atb-fieldcard[data-kind="human-wait"] input { width: 100%; box-sizing: border-box; }
.dsh-atb-fieldcard[data-kind="report-history"] summary { cursor: pointer; }
.dsh-atb-badge[data-kind="needs-human"] {
  white-space: normal;
  overflow-wrap: anywhere;
  background: color-mix(in srgb, var(--atb-warn) 22%, transparent);
  color: light-dark(#8a5a0c, #ffd79a);
  font-weight: 600;
}
/* Human wait is a state, not a tone: a warm inset ring on top of whatever
   pastel tone the card carries (the surface itself is never recoloured). */
.dsh-atb-card[data-needs-human="true"] {
  box-shadow: inset 0 0 0 1.5px color-mix(in srgb, var(--atb-warn) 62%, transparent), var(--atb-card-shadow);
}
.dsh-atb-card[data-needs-human="true"]:hover {
  box-shadow: inset 0 0 0 1.5px color-mix(in srgb, var(--atb-warn) 72%, transparent), var(--atb-card-hover-shadow);
}
/* The card deliverable block is declared with the card appearance tokens
   above (tone-aware). The detail pane keeps its own boxes below. */
.dsh-atb-reviewdesk {
  border: 1.5px solid var(--dsw-alias-brand-primary, var(--atb-accent)) !important;
  background: linear-gradient(to bottom, rgba(99, 102, 241, 0.04), var(--atb-bg-1, rgba(128,128,128,.1))) !important;
}
.dsh-atb-deliv-summary-box {
  background: var(--atb-bg, rgba(128,128,128,.08));
  padding: 8px 10px;
  border-radius: 6px;
  margin-bottom: 8px;
}
.dsh-atb-rpt-filelist, .dsh-atb-rpt-checklist {
  list-style: none;
  padding: 0;
  margin: 4px 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.dsh-atb-rpt-fileitem {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 3px 8px;
  border-radius: 4px;
  background: rgba(128, 128, 128, 0.08);
  font-size: 12px;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
}
.dsh-atb-file-path {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  user-select: text;
  min-width: 0;
}
.dsh-atb-file-copybtn {
  font-size: 10.5px;
  padding: 1px 6px;
  border-radius: 4px;
  border: 1px solid var(--atb-border-2, #d4d4d8);
  background: transparent;
  cursor: pointer;
  color: inherit;
  flex-shrink: 0;
  margin-left: 8px;
}
.dsh-atb-file-copybtn:hover {
  background: var(--atb-hover, rgba(128,128,128,.15));
}
.dsh-atb-rpt-checkitem {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  font-size: 12.5px;
  line-height: 1.4;
}
.dsh-atb-check-icon {
  color: var(--atb-success);
  font-weight: bold;
}
.dsh-atb-deliv-missing-box {
  padding: 12px;
  border-radius: 6px;
  background: rgba(245, 158, 11, 0.08);
  border: 1px dashed rgba(245, 158, 11, 0.35);
  color: var(--atb-text-2, #71717a);
  font-size: 12.5px;
}
.dsh-atb-movebtn[data-to="needs-human-active"] {
  border-color: #d97706;
  background: rgba(245, 158, 11, 0.15);
  color: #d97706;
  font-weight: 600;
}

/* ---- Prerequisite picker (F9) ------------------------------------------- */
/* The combobox lives inside the collapsed dependency <details>: a full-width
   text input with an absolutely positioned listbox. No animation, no colour
   overload — the status/workspace meta stays quiet grey, and only the
   missing-prerequisite row (D2) earns a dashed warning edge. */
.dsh-atb-prereq-picker { position: relative; display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.dsh-atb-prereq-input { width: 100%; min-width: 0; box-sizing: border-box; }
.dsh-atb-prereq-input:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary, var(--atb-accent)); outline-offset: 1px; }
.dsh-atb-prereq-list {
  position: absolute; top: calc(100% + 3px); left: 0; right: 0; z-index: 8;
  max-height: 220px; overflow-y: auto; margin: 0; padding: 4px; list-style: none;
  display: flex; flex-direction: column;
  border-radius: var(--atb-radius-md); corner-shape: var(--atb-corner);
  background: var(--atb-menu); -webkit-backdrop-filter: var(--atb-menu-blur); backdrop-filter: var(--atb-menu-blur);
  color: var(--atb-text); border: 1px solid var(--atb-border);
  box-shadow: var(--atb-elevation-panel);
}
.dsh-atb-prereq-list[hidden] { display: none; }
.dsh-atb-prereq-opt {
  display: flex; flex-direction: column; gap: 1px; padding: 5px 8px; border-radius: 6px;
  cursor: pointer; font-size: 12px; min-width: 0;
}
.dsh-atb-prereq-opt[data-active="true"] { background: var(--atb-hover); }
.dsh-atb-prereq-opt-title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dsh-atb-prereq-opt-meta { font-size: 10.5px; color: var(--atb-text-2, gray); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dsh-atb-prereq-opt-id { font-family: var(--dsw-font-mono, ui-monospace, SFMono-Regular, Menlo, monospace); font-size: 10.5px; }
.dsh-atb-prereq-empty { font-size: 11.5px; color: var(--atb-text-2, gray); padding: 4px 2px; overflow-wrap: anywhere; }
.dsh-atb-prereq-row { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; min-width: 0; }
.dsh-atb-prereq-row > .dsh-atb-btn { min-width: 0; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dsh-atb-prereq-id {
  font-family: var(--dsw-font-mono, ui-monospace, SFMono-Regular, Menlo, monospace);
  font-size: 11px; overflow-wrap: anywhere;
}
.dsh-atb-prereq-state { font-size: 10.5px; color: var(--atb-text-2, gray); flex-shrink: 0; }
.dsh-atb-prereq-state[data-state="missing"] { color: var(--dsw-alias-state-error-primary, var(--atb-error)); }
.dsh-atb-prereq-state[data-state="done"] { color: var(--dsw-alias-state-success-primary, var(--atb-success)); }
.dsh-atb-prereq-missing-hint { font-size: 11px; line-height: 1.4; color: var(--atb-text-2, gray); overflow-wrap: anywhere; }
.dsh-atb-prereq-audit { font-size: 10.5px; color: var(--atb-text-3, gray); cursor: help; flex-shrink: 0; }
.dsh-atb-bubble[data-missing="true"] .dsh-atb-bubble-main {
  border-style: dashed;
  border-color: color-mix(in srgb, var(--dsw-alias-state-error-primary, var(--atb-error)) 40%, transparent);
}
.dsh-atb-bubble[data-missing="true"] .dsh-atb-bubble-avatar { color: var(--dsw-alias-state-error-primary, var(--atb-error)); }

/* ---- Hierarchy surface (D6) --------------------------------------------- */
/* The subtask badge is a neutral outline chip (distinct from 🔗 by glyph and
   tooltip, never by a second loud colour) and stays single-line at 360px. */
.dsh-atb-badge[data-kind="subtasks"] {
  background: transparent;
  color: var(--atb-text-2, gray);
  border: 1px solid var(--atb-border-2, rgba(128,128,128,.3));
  white-space: nowrap;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
}
.dsh-atb-badge[data-kind="subtasks"][data-ready="true"] { opacity: .75; }
/* Parent breadcrumb above the detail body: quiet, wraps instead of scrolling. */
.dsh-atb-crumbs { display: flex; align-items: center; gap: 4px; flex-wrap: wrap; font-size: 11.5px; min-width: 0; }
.dsh-atb-crumb { display: inline-flex; align-items: center; gap: 4px; min-width: 0; }
.dsh-atb-crumb-link {
  border: none; background: none; padding: 0; font: inherit; cursor: pointer; color: inherit;
  max-width: 220px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  text-decoration: underline; text-decoration-style: dotted; text-underline-offset: 2px;
}
.dsh-atb-crumb-link:hover { text-decoration-style: solid; }
.dsh-atb-crumb-link:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary, var(--atb-accent)); outline-offset: 1px; border-radius: 3px; }
.dsh-atb-crumb-sep { color: var(--atb-text-2, gray); }
.dsh-atb-crumb-current { color: var(--atb-text-2, gray); overflow-wrap: anywhere; min-width: 0; }
.dsh-atb-subtask-warn { font-size: 11px; color: var(--atb-text-2, gray); padding: 2px 0; overflow-wrap: anywhere; }

/* ---------------------------------------------------------------- Select */
.dsh-atb-sel {
  display: inline-flex; align-items: center; gap: 6px; min-width: 0; max-width: 100%;
  height: 30px; padding: 0 6px 0 9px; box-sizing: border-box;
  font: inherit; font-size: 12.5px; line-height: 1;
  border-radius: var(--atb-radius-sm);
  border: 1px solid var(--atb-border-2);
  background: var(--atb-input); color: var(--atb-text);
  cursor: pointer; text-align: left;
}
.dsh-atb-sel:hover:not(:disabled) { background: var(--atb-hover-solid); }
.dsh-atb-sel:focus-visible { outline: none; border-color: var(--atb-accent); box-shadow: var(--atb-focus); }
.dsh-atb-sel:disabled { opacity: .5; cursor: default; }
.dsh-atb-sel-full { width: 100%; }
.dsh-atb-sel-value { display: inline-flex; align-items: center; gap: 5px; flex: 1; min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.dsh-atb-sel-placeholder { color: var(--atb-text-3); }
.dsh-atb-sel-icon { flex: none; }
.dsh-atb-sel-caret {
  flex: none; width: 6px; height: 6px; margin-right: 2px;
  border-right: 1.5px solid currentColor; border-bottom: 1.5px solid currentColor;
  opacity: .55; transform: translateY(-2px) rotate(45deg);
}
.dsh-atb-sel[aria-expanded="true"] .dsh-atb-sel-caret { transform: translateY(1px) rotate(225deg); }
.dsh-atb-sel-pop {
  position: fixed; z-index: 2147483000; max-height: 280px; overflow-y: auto;
  padding: 4px; display: flex; flex-direction: column; gap: 1px;
  border-radius: var(--atb-radius-lg); corner-shape: var(--atb-corner);
  background: var(--atb-menu); -webkit-backdrop-filter: var(--atb-menu-blur); backdrop-filter: var(--atb-menu-blur);
  color: var(--atb-text); border: 1px solid var(--atb-border);
  box-shadow: var(--atb-elevation-panel), 0 12px 28px -12px rgba(8, 12, 20, .35), 0 2px 6px -2px rgba(8, 12, 20, .12);
  overscroll-behavior: contain;
}
.dsh-atb-sel-opt {
  display: flex; align-items: center; gap: 7px; height: 28px; padding: 0 8px;
  border-radius: 6px; font-size: 12.5px; white-space: nowrap; cursor: pointer;
}
.dsh-atb-sel-opt[data-active="true"] { background: var(--atb-hover); }
.dsh-atb-sel-opt[data-selected="true"] { font-weight: 600; }
.dsh-atb-sel-opt[data-disabled="true"] { opacity: .45; cursor: default; }
.dsh-atb-sel-opt .dsh-atb-sel-label { overflow: hidden; text-overflow: ellipsis; }
.dsh-atb-sel-check { flex: none; width: 13px; opacity: 0; color: var(--atb-accent); }
.dsh-atb-sel-opt[data-selected="true"] .dsh-atb-sel-check { opacity: 1; }

/* =====================================================================
   Flat pass — borderless, DSH-style. Surfaces are separated by tone and
   elevation, never by outlines. Controls are filled (hover tint) and only
   reveal an edge on focus. Floating menus keep their hairline (that IS the
   DSH menu recipe). Declared last on purpose: same-specificity overrides.
   ===================================================================== */
.dsh-atb-icon { display: inline-block; flex: none; vertical-align: -0.15em; }
.dsh-atb-btn, .dsh-atb-chip, .dsh-atb-movebtn, .dsh-atb-detail-edit, .dsh-atb-detail-run, .dsh-atb-badge { display: inline-flex; align-items: center; gap: 5px; }
.dsh-atb-btn .dsh-atb-icon, .dsh-atb-chip .dsh-atb-icon { opacity: .8; }
.dsh-atb-fieldcard .dsh-atb-input, .dsh-atb-fieldcard .dsh-atb-btn, .dsh-atb-fieldcard .dsh-atb-movebtn { background: var(--atb-bg); }
.dsh-atb-detail summary { list-style: none; cursor: pointer; }
.dsh-atb-detail summary::-webkit-details-marker { display: none; }
.dsh-atb-toggle-caret { transition: transform .14s ease; }
.dsh-atb-toggle-caret[data-open="true"] { transform: rotate(90deg); }

/* Cards: a tone surface on the neutral column, depth from the shadow only
   (the surface itself is declared with the appearance tokens above). */
.dsh-atb-card {
  border-color: transparent;
  box-shadow: var(--atb-card-shadow);
  transition: transform .18s ease, box-shadow .18s ease, filter .18s ease;
}
.dsh-atb-card:hover { border-color: transparent; box-shadow: var(--atb-card-hover-shadow); }
.dsh-atb-column { border-radius: var(--atb-radius-lg); }

/* Buttons, chips, pills: filled, no outline. */
.dsh-atb-btn, .dsh-atb-chip, .dsh-atb-detail-edit, .dsh-atb-detail-session, .dsh-atb-movebtn,
.dsh-atb-image-add, .dsh-atb-card-session, .dsh-atb-file-copybtn,
.dsh-atb-ver, .dsh-atb-detail-id, button.dsh-atb-chip2.dsh-atb-chip-btn,
.dsh-atb-external button, .dsh-atb-cron-preset, .dsh-atb-mode-opt, .dsh-atb-perm-opt {
  border-color: transparent; background: var(--atb-hover);
}
.dsh-atb-btn:hover, .dsh-atb-chip:hover, .dsh-atb-detail-edit:hover, .dsh-atb-detail-session:hover,
.dsh-atb-movebtn:hover, .dsh-atb-image-add:hover:not(:disabled),
.dsh-atb-card-session:hover, .dsh-atb-file-copybtn:hover, .dsh-atb-ver:hover, .dsh-atb-detail-id:hover,
button.dsh-atb-chip2.dsh-atb-chip-btn:hover, .dsh-atb-cron-preset:hover, .dsh-atb-mode-opt:hover {
  border-color: transparent; background: var(--atb-active); color: var(--atb-text);
}
.dsh-atb-btn { border-radius: var(--atb-radius-sm); }
.dsh-atb-btn[data-primary="true"], .dsh-atb-btn[data-primary="true"]:hover { background: var(--dsw-alias-button-primary-fill, var(--atb-brand)); color: var(--dsw-alias-label-primary-foreground, #fff); }
.dsh-atb-btn[data-danger="true"] { border-color: transparent; background: color-mix(in srgb, var(--atb-error) 9%, transparent); }
.dsh-atb-chip[data-on="true"] { background: var(--atb-text); color: var(--atb-bg); }
.dsh-atb-chip[data-on="true"] .dsh-atb-dot { box-shadow: 0 0 0 1.5px var(--atb-bg); }
.dsh-atb-mode-opt[data-on="true"], .dsh-atb-perm-opt[data-on="true"], .dsh-atb-set .dsh-atb-perm-opt[data-on="true"] {
  border-color: transparent; background: var(--atb-active); box-shadow: inset 0 0 0 1.5px var(--atb-text);
}
.dsh-atb-cron-preset[data-on="true"] { background: var(--atb-brand); color: var(--dsw-alias-label-primary-foreground, #fff); }
/* Semantic actions keep their meaning through a tint, not an outline. */
.dsh-atb-movebtn[data-to="done"] { border-color: transparent; background: color-mix(in srgb, var(--atb-success) 12%, transparent); color: var(--atb-success); }
.dsh-atb-movebtn[data-to="blocked"] { border-color: transparent; background: color-mix(in srgb, var(--atb-error) 9%, transparent); color: var(--atb-error); }
.dsh-atb-movebtn[data-to="needs-human-active"] { border-color: transparent; }
.dsh-atb-detail-id[data-state="copied"], .dsh-atb-detail-id[data-state="failed"] { border-color: transparent; }

/* Badges: tone only. */
.dsh-atb-badge, .dsh-atb-badge[data-kind="session"], .dsh-atb-badge[data-kind="subtasks"] { border-color: transparent; }
.dsh-atb-badge { background: var(--atb-hover); color: var(--atb-text-2); border-radius: var(--atb-radius-xs); }
.dsh-atb-badge[data-kind="subtasks"] { background: var(--atb-hover); }

/* Fields: filled wells, edge appears only on focus. */
.dsh-atb-input, .dsh-atb-select, .dsh-atb-sel, .dsh-atb-composer-input, .dsh-atb-external input, .dsh-atb-external select,
.dsh-atb-modal-body input, .dsh-atb-modal-body textarea {
  border-color: transparent; background: var(--atb-hover);
}
.dsh-atb-sel:hover:not(:disabled) { background: var(--atb-active); }
.dsh-atb-input:focus-visible, .dsh-atb-select:focus-visible, .dsh-atb-sel:focus-visible, .dsh-atb-composer-input:focus,
.dsh-atb-modal-body input:focus, .dsh-atb-modal-body textarea:focus {
  border-color: transparent; background: var(--atb-input); box-shadow: 0 0 0 1px var(--atb-border-2), var(--atb-focus);
}
.dsh-atb-modal-body .dsh-atb-input-bad { box-shadow: inset 0 0 0 1px var(--atb-error); }

/* Content blocks inside the detail: tone, no frame. */
.dsh-atb-fieldcard, .dsh-atb-bubble-main, .dsh-atb-exec-row, .dsh-atb-cl-item, .dsh-atb-imp-row,
.dsh-atb-detail-img, .dsh-atb-promptbox {
  border-color: transparent; border-style: solid;
}
.dsh-atb-fieldcard { background: var(--atb-surface-sunken); border-radius: var(--atb-radius-md); padding: 12px 14px; }
.dsh-atb-bubble-main, .dsh-atb-exec-row { background: var(--atb-surface-sunken); }
.dsh-atb-bubble[data-from="agent"] .dsh-atb-bubble-main { border-color: transparent; background: color-mix(in srgb, var(--dsw-alias-state-done-primary, #7c3aed) 6%, var(--atb-bg)); }
.dsh-atb-bubble[data-missing="true"] .dsh-atb-bubble-main { border-color: transparent; box-shadow: inset 2px 0 0 var(--atb-error); }
.dsh-atb-promptbox { background: var(--atb-bg); }
.dsh-atb-cl-item { background: var(--atb-surface-sunken); }
.dsh-atb-cl-item[data-alert="true"] { border-color: transparent; box-shadow: inset 2px 0 0 var(--atb-error); }
.dsh-atb-modal-foot { border-top-color: transparent; padding-top: 8px; }

/* Panels & modals: elevation + spacing replace rules. */
.dsh-atb-detailpanel { border-color: transparent; border-radius: var(--atb-radius-lg); box-shadow: var(--atb-elevation-prominent); padding: 14px 18px; }
.dsh-atb-modal { border-color: transparent; }
.dsh-atb-modal-head { border-bottom-color: transparent; padding: 18px 20px 8px; }
.dsh-atb-modal-headicon { background: var(--atb-hover); color: var(--atb-text); border-radius: var(--atb-radius-sm); }
.dsh-atb-form-left { border-right-color: transparent; }
.dsh-atb-settings-nav { border-right-color: transparent; background: var(--atb-surface-sunken); }
.dsh-atb-ws-group + .dsh-atb-ws-group { border-top: none; }
.dsh-atb-dangerzone { border-top: none; }
.dsh-atb-done-foldbar { border: none; background: transparent; }
.dsh-atb-iso-repo[data-multi="true"] { border-top: none; }

/* Sticky project header follows the restored neutral column tone. */
.dsh-atb-ws-group-head { background: var(--atb-surface-sunken); border-radius: var(--atb-radius-sm); }
.dsh-atb-ws-group-count { background: var(--atb-hover); }

/* Approval requests (0.10.1): warm tint so a pending decision stands out. */
.dsh-atb-approval { display: flex; flex-direction: column; gap: 8px; }
.dsh-atb-approval .dsh-atb-fieldcard { background: color-mix(in srgb, var(--atb-warn) 9%, var(--atb-bg)); }
.dsh-atb-badge[data-kind="approval"] { background: color-mix(in srgb, var(--atb-warn) 16%, transparent); color: var(--atb-warn); }
.dsh-atb-detail-run:disabled { opacity: .45; cursor: not-allowed; filter: none; }

/* Drop target: a tint plus an inset accent ring (no dashed frame). */
.dsh-atb-column[data-dragover] { outline: none; background: color-mix(in srgb, var(--atb-accent) 8%, var(--atb-surface-sunken)); box-shadow: inset 0 0 0 2px color-mix(in srgb, var(--atb-accent) 60%, transparent); }

/* =====================================================================
   DeepSeek Pastel — detail pickers, preference controls, responsive
   rules and motion policy. Everything here is new surface owned by this
   design pass; no host style is touched.
   ===================================================================== */
.dsh-atb-tone-pick { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; margin-top: 2px; }
.dsh-atb-tone-pick-label { font-size: 10.5px; font-weight: 650; letter-spacing: .04em; text-transform: uppercase; color: var(--atb-text-3); }
.dsh-atb-tone-swatch {
  width: 22px; height: 22px; padding: 0; border-radius: 50%; cursor: pointer;
  display: inline-flex; align-items: center; justify-content: center;
  background: transparent; border: 1px solid var(--atb-border-2);
  transition: border-color .14s ease, box-shadow .14s ease;
}
.dsh-atb-tone-swatch:hover { border-color: var(--atb-text-3); }
.dsh-atb-tone-swatch:focus-visible { outline: 2px solid var(--atb-accent); outline-offset: 2px; }
.dsh-atb-tone-swatch[data-on="true"] { border-color: var(--atb-accent); box-shadow: 0 0 0 2px color-mix(in srgb, var(--atb-accent) 34%, transparent); }
.dsh-atb-tone-swatch-dot { width: 15px; height: 15px; border-radius: 50%; background: var(--atb-tone-violet); }
.dsh-atb-tone-swatch[data-tone="violet"] .dsh-atb-tone-swatch-dot { background: var(--atb-tone-violet); }
.dsh-atb-tone-swatch[data-tone="sky"] .dsh-atb-tone-swatch-dot { background: var(--atb-tone-sky); }
.dsh-atb-tone-swatch[data-tone="mint"] .dsh-atb-tone-swatch-dot { background: var(--atb-tone-mint); }
.dsh-atb-tone-swatch[data-tone="peach"] .dsh-atb-tone-swatch-dot { background: var(--atb-tone-peach); }
.dsh-atb-tone-swatch[data-tone="pink"] .dsh-atb-tone-swatch-dot { background: var(--atb-tone-pink); }
.dsh-atb-tone-swatch[data-tone="ink"] .dsh-atb-tone-swatch-dot { background: var(--atb-tone-ink); }
.dsh-atb-tone-swatch[data-tone="yellow"] .dsh-atb-tone-swatch-dot { background: var(--atb-tone-yellow); }
.dsh-atb-tone-swatch[data-tone="lavender"] .dsh-atb-tone-swatch-dot { background: var(--atb-tone-lavender); }
.dsh-atb-tone-auto-glyph {
  width: 15px; height: 15px; border-radius: 50%;
  background: conic-gradient(from 210deg, var(--atb-tone-violet), var(--atb-tone-mint), var(--atb-tone-peach), var(--atb-tone-sky), var(--atb-tone-violet));
}

/* Settings → Appearance: the same visual language as the board. */
.dsh-atb-setting { padding: 14px 0; border-bottom: 1px solid var(--atb-border); }
.dsh-atb-setting:last-child { border-bottom: 0; padding-bottom: 4px; }
.dsh-atb-setting-title { margin: 0 0 6px; font-size: 13.5px; font-weight: 700; letter-spacing: -.2px; }
.dsh-atb-setting-label { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 10px; font-size: 12px; font-weight: 650; color: var(--atb-text); }
.dsh-atb-setting-value { font-size: 11px; font-weight: 500; color: var(--atb-text-2); font-variant-numeric: tabular-nums; }
.dsh-atb-setting-hint { margin: 8px 0 0; font-size: 11px; line-height: 1.5; color: var(--atb-text-3); }
.dsh-atb-setting-actions { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-top: 10px; flex-wrap: wrap; }
.dsh-atb-switchrow { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin: 0; cursor: pointer; }
.dsh-atb-switchrow .dsh-atb-setting-label { margin-bottom: 0; }
.dsh-atb-switch {
  position: relative; display: inline-flex; flex: none; width: 36px; height: 20px;
  border-radius: 999px; background: var(--atb-hover); border: 1px solid var(--atb-border-2);
  transition: background .16s ease, border-color .16s ease;
}
.dsh-atb-switch input { position: absolute; inset: 0; width: 100%; height: 100%; margin: 0; opacity: 0; cursor: pointer; }
.dsh-atb-switch-track {
  position: absolute; top: 2px; left: 2px; width: 14px; height: 14px; border-radius: 50%;
  background: var(--atb-text-2); transition: left .16s ease, background .16s ease; pointer-events: none;
}
.dsh-atb-switch:has(input:checked) { background: var(--atb-accent); border-color: transparent; }
.dsh-atb-switch input:checked + .dsh-atb-switch-track { left: 18px; background: #fff; }
.dsh-atb-switch input:focus-visible + .dsh-atb-switch-track { box-shadow: var(--atb-focus); }
.dsh-atb-range { width: 100%; accent-color: var(--atb-accent); }

/* Visible keyboard focus for every interactive surface this plugin renders. */
.dsh-atb-board button:focus-visible,
.dsh-atb-board [role="button"]:focus-visible,
.dsh-atb-modal button:focus-visible,
.dsh-atb-modal input:focus-visible,
.dsh-atb-modal textarea:focus-visible,
.dsh-atb-modal select:focus-visible {
  outline: 2px solid var(--atb-accent); outline-offset: 2px;
}

/* =====================================================================
   Colour modes, category manager and live preview (Settings → Appearance).
   The appearance panel carries the .dsh-atb-preview class so it resolves the same
   tone tokens as the board without inheriting any board layout.
   ===================================================================== */
.dsh-atb-colormodes { display: grid; grid-template-columns: 1fr 1fr; gap: 7px; }
.dsh-atb-colormode {
  display: flex; align-items: center; gap: 9px; text-align: left; padding: 9px 10px;
  border-radius: 9px; cursor: pointer; font: inherit; color: var(--atb-text);
  border: 1px solid var(--atb-border-2); background: var(--atb-hover);
}
.dsh-atb-colormode[data-on="true"] {
  border-color: transparent; background: color-mix(in srgb, var(--atb-accent) 14%, transparent);
  box-shadow: inset 0 0 0 1.5px var(--atb-accent);
}
.dsh-atb-colormode-swatch { width: 26px; height: 26px; border-radius: 8px; flex: none; }
.dsh-atb-colormode-swatch[data-mode="card"] { background: conic-gradient(from 210deg, #a9c8f2, #c5b2ef, #f1abb4, #9ed9c6, #a9c8f2); }
.dsh-atb-colormode-swatch[data-mode="project"] { background: linear-gradient(135deg, #c5b2ef 0 50%, #9ed9c6 50% 100%); }
.dsh-atb-colormode-swatch[data-mode="category"] { background: linear-gradient(135deg, #a9c8f2 0 33%, #f1abb4 33% 66%, #eadd95 66% 100%); }
.dsh-atb-colormode-swatch[data-mode="priority"] { background: linear-gradient(90deg, #f1abb4 0 33%, #c5b2ef 33% 66%, #a9c8f2 66% 100%); }
.dsh-atb-colormode-text { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.dsh-atb-colormode-name { font-size: 12px; font-weight: 650; }
.dsh-atb-colormode-hint { font-size: 10px; color: var(--atb-text-3); line-height: 1.35; }

.dsh-atb-tone-palette { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 2px; }
.dsh-atb-tone-chip { width: 22px; height: 22px; border-radius: 50%; border: 1px solid var(--atb-border-2); }
.dsh-atb-tone-chip[data-tone="violet"] { background: var(--atb-tone-violet); }
.dsh-atb-tone-chip[data-tone="sky"] { background: var(--atb-tone-sky); }
.dsh-atb-tone-chip[data-tone="mint"] { background: var(--atb-tone-mint); }
.dsh-atb-tone-chip[data-tone="peach"] { background: var(--atb-tone-peach); }
.dsh-atb-tone-chip[data-tone="pink"] { background: var(--atb-tone-pink); }
.dsh-atb-tone-chip[data-tone="ink"] { background: var(--atb-tone-ink); }
.dsh-atb-tone-chip[data-tone="yellow"] { background: var(--atb-tone-yellow); }
.dsh-atb-tone-chip[data-tone="lavender"] { background: var(--atb-tone-lavender); }

.dsh-atb-cat-manager { display: flex; flex-direction: column; gap: 8px; }
.dsh-atb-cat-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
.dsh-atb-cat-row {
  display: grid; grid-template-columns: 28px minmax(0, 1fr) auto auto; align-items: center; gap: 8px;
  padding: 6px; border-radius: 8px; background: var(--atb-surface-sunken);
}
.dsh-atb-cat-color {
  width: 28px; height: 28px; padding: 0; cursor: pointer; box-sizing: border-box;
  border: 1px solid var(--atb-border-2); border-radius: 7px; background: transparent;
}
.dsh-atb-cat-name { height: 30px; min-width: 0; }
.dsh-atb-cat-id { font-size: 10px; color: var(--atb-text-3); font-variant-numeric: tabular-nums; }
.dsh-atb-cat-actions { display: flex; gap: 2px; }
.dsh-atb-iconbtn {
  display: inline-flex; align-items: center; justify-content: center; width: 24px; height: 24px;
  border: none; border-radius: 6px; background: transparent; color: var(--atb-text-2); cursor: pointer;
}
.dsh-atb-iconbtn:hover:not(:disabled) { background: var(--atb-hover); color: var(--atb-text); }
.dsh-atb-iconbtn:disabled { opacity: .35; cursor: default; }
.dsh-atb-iconbtn[data-danger="true"]:hover:not(:disabled) { color: var(--atb-error); }
.dsh-atb-cat-actions .dsh-atb-iconbtn:first-child .dsh-atb-icon { transform: rotate(180deg); }
.dsh-atb-cat-error { grid-column: 1 / -1; color: var(--atb-error); font-size: 11px; margin: 2px 0 0; }
.dsh-atb-cat-add { display: flex; gap: 6px; }
.dsh-atb-cat-add .dsh-atb-input { flex: 1; min-width: 0; height: 30px; }
.dsh-atb-labels-editor {
  width: 100%; box-sizing: border-box; margin-top: 6px; padding: 8px 10px; resize: vertical;
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace; font-size: 11px; line-height: 1.5;
}

.dsh-atb-prioritycolors, .dsh-atb-projectcolors { list-style: none; margin: 8px 0 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
.dsh-atb-prioritycolor-row, .dsh-atb-projectcolor-row {
  display: flex; align-items: center; gap: 8px; padding: 5px 6px; border-radius: 8px; background: var(--atb-surface-sunken);
}
.dsh-atb-prioritycolor-name { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; min-width: 86px; }
.dsh-atb-prioritycolor-swatch, .dsh-atb-projectcolor-swatch { width: 20px; height: 20px; border-radius: 6px; border: 1px solid var(--atb-border-2); flex: none; }
.dsh-atb-projectcolor-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; }
.dsh-atb-projectcolor-swatch[data-tone="violet"] { background: var(--atb-tone-violet); }
.dsh-atb-projectcolor-swatch[data-tone="sky"] { background: var(--atb-tone-sky); }
.dsh-atb-projectcolor-swatch[data-tone="mint"] { background: var(--atb-tone-mint); }
.dsh-atb-projectcolor-swatch[data-tone="peach"] { background: var(--atb-tone-peach); }
.dsh-atb-projectcolor-swatch[data-tone="pink"] { background: var(--atb-tone-pink); }
.dsh-atb-projectcolor-swatch[data-tone="ink"] { background: var(--atb-tone-ink); }
.dsh-atb-projectcolor-swatch[data-tone="yellow"] { background: var(--atb-tone-yellow); }
.dsh-atb-projectcolor-swatch[data-tone="lavender"] { background: var(--atb-tone-lavender); }

.dsh-atb-preview { margin-top: 18px; padding-top: 16px; border-top: 1px solid var(--atb-border); }
.dsh-atb-preview-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-bottom: 10px; }
.dsh-atb-preview-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; }
.dsh-atb-preview-card { cursor: default; }
.dsh-atb-preview-card .dsh-atb-card-title { font-size: 11.5px; line-height: 1.4; }
.dsh-atb-preview-card .dsh-atb-card-top { margin-bottom: 7px; }
.dsh-atb-preview-card .dsh-atb-card-divider { margin: 9px 0 7px; }
.dsh-atb-preview-card .dsh-atb-card-category-name { max-width: 60%; }

/* Colouring-by-category is meaningful only once tasks are classified: on an
   all-unclassified board the surfaces are neutral by design, so explain it and
   offer the explicit one-time migration instead of guessing. */
.dsh-atb-classifyhint {
  display: flex; align-items: center; gap: 11px; flex-wrap: wrap;
  padding: 11px 14px; border-radius: 12px;
  background: color-mix(in srgb, var(--atb-accent) 8%, var(--atb-hover));
  color: var(--atb-text-2); border: 1px solid var(--atb-border);
}
.dsh-atb-classifyhint > .dsh-atb-icon { color: var(--atb-accent); flex: none; }
.dsh-atb-classifyhint-text { display: flex; flex-direction: column; gap: 2px; min-width: 0; flex: 1 1 260px; }
.dsh-atb-classifyhint-title { font-size: 12px; font-weight: 680; color: var(--atb-text); }
.dsh-atb-classifyhint-body { font-size: 11px; line-height: 1.45; }
.dsh-atb-classifyhint-actions { display: inline-flex; gap: 7px; flex-wrap: wrap; }

/* ---------------------------------------------------------------------
   Focus-mode bottom sheets: the mobile toolbar's filters, board actions and
   the new-task menu. Same dialog semantics and backdrop as the board modals,
   anchored to the bottom edge by the .dsh-atb-sheet-layer wrapper.
   --------------------------------------------------------------------- */
.dsh-atb-sheet-layer { align-items: flex-end; justify-content: center; padding: 0; }
.dsh-atb-sheet {
  width: 100%; max-width: 100%; max-height: 88dvh;
  border-radius: 20px 20px 0 0; corner-shape: round;
  animation: dsh-atb-sheet-in .2s ease;
}
@keyframes dsh-atb-sheet-in { from { opacity: 0; transform: translateY(18px); } }
.dsh-atb-sheet-handle {
  display: block; width: 42px; height: 5px; flex: none; margin: 8px auto 2px;
  border-radius: 3px; background: var(--atb-border-2);
}
.dsh-atb-sheet .dsh-atb-modal-head { padding: 10px 16px 10px; }
.dsh-atb-sheet-body {
  display: flex; flex-direction: column; gap: 14px;
  padding: 14px 16px 18px; overflow-y: auto; overscroll-behavior: contain;
}
.dsh-atb-sheet-field { display: flex; flex-direction: column; gap: 6px; margin: 0; }
.dsh-atb-sheet-label {
  font-size: 10.5px; font-weight: 750; letter-spacing: .07em;
  text-transform: uppercase; color: var(--atb-text-3);
}
.dsh-atb-sheet-chips { display: flex; gap: 7px; flex-wrap: wrap; }
.dsh-atb-sheet-chips .dsh-atb-chip { padding: 7px 12px; font-size: 12px; }
.dsh-atb-sheet-human { align-self: flex-start; padding: 8px 12px; }
.dsh-atb-sheet-foot {
  display: flex; gap: 8px; flex: none;
  border-top: 1px solid var(--atb-border);
  padding: 11px 16px calc(11px + env(safe-area-inset-bottom));
}
.dsh-atb-sheet-foot > .dsh-atb-btn { flex: 1; padding: 11px 12px; font-size: 13px; }
.dsh-atb-sheet-menu { display: flex; flex-direction: column; gap: 3px; }
.dsh-atb-sheet-item {
  display: flex; align-items: center; gap: 11px; width: 100%;
  padding: 10px; border-radius: 11px; cursor: pointer;
  border: 1px solid transparent; background: transparent; color: inherit;
  font: inherit; text-align: left;
}
.dsh-atb-sheet-item:hover { background: var(--atb-hover); }
.dsh-atb-sheet-item:focus-visible { outline: 2px solid var(--atb-accent); outline-offset: 1px; }
.dsh-atb-sheet-item-icon {
  flex: none; display: inline-flex; align-items: center; justify-content: center;
  width: 30px; height: 30px; border-radius: 9px;
  background: var(--atb-hover); color: var(--atb-text-2);
}
.dsh-atb-sheet-item-text { display: flex; flex-direction: column; gap: 1px; min-width: 0; flex: 1; }
.dsh-atb-sheet-item-label { font-size: 13px; font-weight: 600; }
.dsh-atb-sheet-item-hint {
  font-size: 11px; color: var(--atb-text-3);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.dsh-atb-sheet .dsh-atb-newmenu-list {
  position: static; min-width: 0; padding: 0; border: none; box-shadow: none;
  background: transparent; -webkit-backdrop-filter: none; backdrop-filter: none;
}
.dsh-atb-sheet .dsh-atb-newmenu-opt {
  padding: 10px 9px; font-size: 13px; border-radius: 9px; white-space: normal; text-align: left;
}
.dsh-atb-sheet .dsh-atb-newmenu-cat { padding: 10px 9px 3px; }

/* Responsive: five readable columns first, then a snap-scrolled column
   carousel with an explicit column navigation bar. */
@media (max-width: 1180px) {
  .dsh-atb-board { padding: 14px 14px 16px; }
  .dsh-atb-column { min-width: 226px; }
  .dsh-atb-columns { gap: 10px; }
}
@media (max-width: 900px) {
  .dsh-atb-head { gap: 8px; }
  .dsh-atb-title { font-size: 17px; }
  .dsh-atb-grouptoggle-label { display: none; }
  .dsh-atb-grouptoggle { padding: 5px 8px; }
  .dsh-atb-searchfield { max-width: none; flex: 1 1 220px; }
  .dsh-atb-detailpanel { max-height: 62%; }
}
/* ---------------------------------------------------------------------
   Focus mode 1/2 — portrait / narrow panel (matches FOCUS_PORTRAIT_QUERY in
   board/mobile.ts): one full column per snapped page, compact toolbar,
   bottom sheets, thumb-reachable create button.
   --------------------------------------------------------------------- */
@media (max-width: 760px) {
  .dsh-atb-board { padding: 10px 10px 0; gap: 8px; }
  .dsh-atb-head { gap: 6px; flex-wrap: nowrap; align-items: center; }
  .dsh-atb-title { font-size: 16px; letter-spacing: -.3px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .dsh-atb-count { font-size: 10.5px; padding: 3px 7px; }
  .dsh-atb-mobileactions { display: flex; }
  /* Grouping moves into the actions sheet on a phone (same controller call). */
  .dsh-atb-grouptoggle { display: none; }
  .dsh-atb-newmenu-label, .dsh-atb-newmenu-caret { display: none; }
  .dsh-atb-newmenu > .dsh-atb-btn { padding: 7px 9px; }

  .dsh-atb-toolbar { gap: 6px; flex-wrap: nowrap; }
  .dsh-atb-toolbar-filters, .dsh-atb-toolbar-actions { display: none; }
  .dsh-atb-toolbar > .dsh-atb-spacer { display: none; }
  .dsh-atb-searchfield { display: none; }
  .dsh-atb-board[data-atb-search="true"] .dsh-atb-searchfield { display: inline-flex; flex: 1 1 100%; min-width: 0; max-width: none; }

  .dsh-atb-mobilehead { display: flex; gap: 6px; }
  .dsh-atb-mobilebar {
    display: flex; gap: 7px; scroll-snap-type: x proximity;
    overscroll-behavior-x: contain; padding-bottom: 3px;
  }
  .dsh-atb-mobilebar-count { font-size: 10.5px; padding: 2px 6px; }
  .dsh-atb-swipecue { display: inline-flex; }
  .dsh-atb-swipecue-label { display: none; }

  /* The carousel itself: the rail is the scroller, each column is one page.
     scroll-snap-stop: always keeps a fast flick to a single column, and the
     per-column card list keeps its own vertical scroll position. */
  .dsh-atb-columns {
    gap: 0; scroll-snap-type: x mandatory;
    overscroll-behavior-x: contain; -webkit-overflow-scrolling: touch;
    padding-bottom: 0;
  }
  .dsh-atb-column {
    flex: 0 0 100%; min-width: 0; max-width: 100%; box-sizing: border-box;
    border: none; border-radius: 0; background: transparent;
    scroll-snap-align: start; scroll-snap-stop: always;
    transition: none;
  }
  .dsh-atb-colhead { min-height: 34px; padding: 4px 2px 2px; font-size: 12px; }
  .dsh-atb-colhead::before { display: none; }
  .dsh-atb-cards {
    padding: 2px 2px calc(84px + env(safe-area-inset-bottom));
    overscroll-behavior-y: contain;
  }
  /* The project header must not inherit the transparent page background. */
  .dsh-atb-ws-group-head { background: var(--atb-bg); }
  .dsh-atb-fab { display: grid; }
  .dsh-atb-detailpanel {
    position: fixed; left: 0; right: 0; bottom: 0; z-index: 70;
    max-height: 84dvh; padding: 10px 14px calc(12px + env(safe-area-inset-bottom));
    border-radius: 18px 18px 0 0; border-bottom: none;
    box-shadow: 0 -12px 40px rgba(8, 12, 20, .35);
  }
  .dsh-atb-classifyhint { padding: 9px 11px; gap: 8px; }
  .dsh-atb-classifyhint-text { flex-basis: 100%; }

  /* Every board modal becomes a bottom sheet, like the reference. */
  .dsh-atb-modal-backdrop { align-items: flex-end; padding: 0; }
  .dsh-atb-modal {
    width: 100%; max-width: 100%; max-height: 88dvh;
    border-radius: 20px 20px 0 0; corner-shape: round;
    animation: dsh-atb-sheet-in .2s ease;
  }
  .dsh-atb-taskform-modal { width: 100%; min-width: 0; max-height: 90dvh; }
  .dsh-atb-taskform-body { grid-template-columns: 1fr; gap: 12px; padding: 12px 14px; }
  .dsh-atb-form-left { border-right: none; padding-right: 0; }
  .dsh-atb-modal-foot { padding-bottom: calc(13px + env(safe-area-inset-bottom)); }

  .dsh-atb-toolbar-divider { display: none; }
  .dsh-atb-colormodes { grid-template-columns: 1fr; }
  .dsh-atb-preview-grid { grid-template-columns: 1fr 1fr; }
  .dsh-atb-cat-row { grid-template-columns: 28px minmax(0, 1fr) auto; }
  .dsh-atb-cat-id { display: none; }
}

/* ---------------------------------------------------------------------
   Focus mode 2/2 — phone landscape (matches FOCUS_LANDSCAPE_QUERY): two
   columns per snapped page. Declared after the portrait block so it wins the
   overlap (a short, narrow window).
   --------------------------------------------------------------------- */
@media (orientation: landscape) and (max-height: 680px) and (max-width: 1380px) {
  .dsh-atb-board { padding: 6px 10px 0; gap: 6px; }
  .dsh-atb-head { gap: 6px; flex-wrap: nowrap; align-items: center; }
  .dsh-atb-title { font-size: 14px; letter-spacing: -.2px; }
  .dsh-atb-count { font-size: 10px; padding: 2px 6px; }
  .dsh-atb-mobileactions { display: flex; }
  .dsh-atb-grouptoggle { display: none; }
  .dsh-atb-iconbtn { width: 32px; height: 32px; border-radius: 9px; }
  .dsh-atb-newmenu-label, .dsh-atb-newmenu-caret { display: none; }
  .dsh-atb-newmenu > .dsh-atb-btn { padding: 5px 8px; }

  .dsh-atb-toolbar { gap: 6px; flex-wrap: nowrap; }
  .dsh-atb-toolbar-filters, .dsh-atb-toolbar-actions { display: none; }
  .dsh-atb-toolbar > .dsh-atb-spacer { display: none; }
  .dsh-atb-searchfield { display: none; }
  .dsh-atb-board[data-atb-search="true"] .dsh-atb-searchfield { display: inline-flex; flex: 1 1 220px; min-width: 0; max-width: none; height: 30px; }

  .dsh-atb-mobilehead { display: flex; gap: 7px; }
  .dsh-atb-mobilebar { display: flex; gap: 5px; scroll-snap-type: x proximity; overscroll-behavior-x: contain; }
  .dsh-atb-mobilebar-btn { height: 30px; padding: 0 9px; gap: 5px; font-size: 11px; border-radius: 9px; }
  .dsh-atb-mobilebar-btn::before { left: 9px; right: 9px; height: 2.5px; }
  .dsh-atb-mobilebar-btn[data-active="true"]::before { left: 6px; right: 6px; }
  .dsh-atb-mobilebar-count { font-size: 10px; padding: 1px 5px; }
  .dsh-atb-swipecue { display: inline-flex; }

  .dsh-atb-columns {
    display: flex; gap: 9px; padding-bottom: 6px;
    scroll-snap-type: x mandatory; overscroll-behavior-x: contain;
    -webkit-overflow-scrolling: touch;
  }
  .dsh-atb-column {
    flex: 0 0 calc((100% - 9px) / 2); min-width: 0; max-width: none; box-sizing: border-box;
    scroll-snap-align: start; scroll-snap-stop: always;
    border-radius: 12px; transition: none;
  }
  .dsh-atb-column[data-collapsed="true"] { flex: 0 0 42px; min-width: 42px; max-width: 42px; }
  .dsh-atb-colhead { min-height: 30px; padding: 4px 8px; font-size: 11px; }
  .dsh-atb-colhead::before { left: 8px; width: 12px; height: 2px; }
  .dsh-atb-cards { padding: 2px 7px calc(10px + env(safe-area-inset-bottom)); overscroll-behavior-y: contain; }
  .dsh-atb-fab { display: none; }

  /* Landscape keeps the centred dialog: a full-width sheet would cover the
     two columns the user is comparing. */
  .dsh-atb-modal-backdrop { align-items: center; justify-content: center; padding: 10px; }
  .dsh-atb-modal { width: min(580px, 100%); max-height: 94dvh; border-radius: 15px; }
  .dsh-atb-taskform-modal { width: min(760px, 100%); min-width: 0; max-height: 94dvh; }
  .dsh-atb-taskform-body { grid-template-columns: 1fr 1fr; gap: 12px; }
  .dsh-atb-form-left { border-right: 1px solid var(--dsw-alias-border-l2, rgba(128,128,128,.14)); padding-right: 12px; }
  .dsh-atb-sheet-layer { align-items: center; padding: 10px; }
  .dsh-atb-sheet { width: min(580px, 100%); border-radius: 15px; }
  .dsh-atb-sheet-handle { display: none; }
  .dsh-atb-detailpanel { max-height: 70%; }
}

@media (prefers-reduced-motion: reduce) {
  .dsh-atb-card,
  .dsh-atb-card:hover,
  .dsh-atb-card:active { transform: none; transition: none; }
  .dsh-atb-column,
  .dsh-atb-tone-swatch,
  .dsh-atb-switch,
  .dsh-atb-switch-track,
  .dsh-atb-toggle-caret,
  .dsh-atb-ws-group-chevron { transition: none; }
  .dsh-atb-columns { scroll-behavior: auto; }
}

`

/** Style element id (stable since 0.1.x: hook for tests and debugging). */
const STYLE_ID = 'dsh-taskboard-styles'

/**
 * Ownership tag for the shell's client-module bookkeeping. The web shell
 * claims every UNTAGGED `<style>` for whichever plugin module materializes
 * next (claimStyles in dsh-client-modules), and the client HMR driver
 * deletes `<style>` tags by this attribute on every rebuilt entry
 * (removeOwnedStyles in dsh-client-hmr).
 */
const PLUGIN_ID = 'dsh-taskboard'

/** Per-stylesheet identity, mirroring the shell's own data-plugin-css. */
const CSS_TAG = 'dsh-taskboard/styles'

/**
 * Ensure the stylesheet lives in <head>: create when absent, re-attach when
 * removed, always carry the ownership tags.
 *
 * 0.4.4 fix (field report: CSS randomly dropped, board renders as unstyled
 * HTML until refresh): injection runs from cordis apply(), which resolves
 * AFTER this module's materialization, so the old untagged <style> could be
 * claimed by ANY sibling plugin module that materialized later (observed
 * with lazily-materializing profile bundles). That sibling's next HMR
 * rebuild then deleted OUR stylesheet, and the old module-level `injected`
 * flag blocked re-injection until a full page refresh. Pre-tagging pins
 * ownership to this plugin: sibling claims skip tagged styles, and only
 * THIS plugin's rebuild removes it — the fresh apply re-injects. Idempotency
 * is DOM-based for the same reason: a module flag cannot see removals,
 * getElementById can. A found element is re-tagged too, so a leftover
 * pre-0.4.4 element adopted across a hot swap heals its ownership.
 */
export function injectStyles(): void {
  if (typeof document === 'undefined') return
  let style = document.getElementById(STYLE_ID)
  if (style === null) {
    style = document.createElement('style')
    style.id = STYLE_ID
    style.textContent = STYLES
    document.head.append(style)
  }
  style.dataset.plugin = PLUGIN_ID
  style.dataset.pluginCss = CSS_TAG
}







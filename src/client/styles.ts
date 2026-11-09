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
.dsh-atb-panel-root { display: flex; flex-direction: column; height: 100%; overflow: hidden; }
.dsh-atb-pglyph { display: inline-flex; align-items: center; }
.dsh-atb-picon { position: relative; display: inline-flex; }
button[class*="panelRow"]:has(.dsh-atb-pglyph) { position: relative; }
.dsh-atb-pstats {
  position: absolute; right: 9px; top: 50%; transform: translateY(-50%);
  display: inline-flex; align-items: center; gap: 3px;
  font-size: 11px; line-height: 1; color: var(--atb-text-2, gray);
  font-variant-numeric: tabular-nums; white-space: nowrap; cursor: help;
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
  font-variant-numeric: tabular-nums; pointer-events: none;
}

.dsh-atb-search { width: 130px; }
.dsh-atb-badge[data-kind="stale"] { background: rgba(217,130,43,.15); color: var(--atb-warn); }

.dsh-atb-board { display: flex; flex-direction: column; height: 100%; min-height: 0; padding: 12px 16px; gap: 10px; box-sizing: border-box; }
.dsh-atb-panel-root[data-dsh-atb-windows] > .dsh-atb-board {
  padding-top: max(12px, calc(env(titlebar-area-y, 0px) + env(titlebar-area-height, 36px) + 8px - var(--dsh-atb-viewport-top, 0px)));
}
.dsh-atb-toolbar { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
body[data-dsh-sidebar-collapsed] .dsh-atb-panel-root .dsh-atb-toolbar { padding-right: 62px; }
.dsh-atb-title { font-size: 15px; font-weight: 600; margin: 0; }
.dsh-atb-count { font-size: 12px; color: var(--atb-text-2, gray); }
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

.dsh-atb-columns { display: flex; gap: 10px; flex: 1; min-height: 0; overflow-x: auto; }

.dsh-atb-detailpanel {
  display: flex; flex-direction: column;
  flex: none; max-height: 55%; min-height: 180px; overflow: hidden;
  border: 1px solid var(--atb-border-2, rgba(128,128,128,.25)); border-radius: 12px;
  background: var(--atb-bg-1, var(--atb-bg-1, rgba(128,128,128,.05)));
  padding: 10px 12px; box-shadow: 0 -4px 18px rgba(0,0,0,.12);
}
.dsh-atb-detailpanel .dsh-atb-detail { flex: 1; min-height: 0; }
.dsh-atb-column { display: flex; flex-direction: column; flex: 1 1 0; min-width: 200px; min-height: 0; border-radius: 10px; background: var(--atb-surface-sunken); padding: 8px; gap: 8px; transition: flex-basis .15s ease, min-width .15s ease, max-width .15s ease; }
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
.dsh-atb-colhead { display: flex; align-items: center; gap: 6px; font-size: 12.5px; font-weight: 600; padding: 2px 4px; }
.dsh-atb-colcount { font-size: 11px; font-weight: 400; color: var(--atb-text-2, gray); }
.dsh-atb-colfoldbtn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: none;
  cursor: pointer;
  color: var(--atb-text-2, gray);
  padding: 2px;
  border-radius: 4px;
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
.dsh-atb-cards { display: flex; flex-direction: column; gap: 8px; overflow-y: auto; min-height: 0; flex: 1; padding: 2px; }
.dsh-atb-ws-group { display: flex; flex-direction: column; gap: 6px; }
.dsh-atb-ws-group + .dsh-atb-ws-group { margin-top: 6px; padding-top: 6px; border-top: 1px dashed var(--atb-border-2, rgba(128,128,128,.2)); }
.dsh-atb-ws-group-head {
  border: none; width: 100%; box-sizing: border-box; font-family: inherit; text-align: left; cursor: pointer;
  display: flex; align-items: center; gap: 5px; padding: 3px 6px; border-radius: 6px;
  font-size: 11.5px; font-weight: 600; color: var(--atb-text-2, inherit);
  /* Sticky project header: the column head above never scrolls (it
     lives outside the scroller), but the project row used to ride up with its
     cards — on a long column the project name left the screen first. Pin it to
     the top of the card scroller so the group you are reading stays labelled.
     The fill must be OPAQUE: three stacked layers reproduce exactly what sits
     behind the row (board base + column inset + hover tint), so cards passing
     underneath never bleed through the label. */
  position: sticky; top: 0; z-index: 2;
  background:
    linear-gradient(var(--atb-hover, rgba(128,128,128,.08)), var(--atb-hover, rgba(128,128,128,.08))),
    linear-gradient(var(--atb-bg-inset, rgba(128,128,128,.07)), var(--atb-bg-inset, rgba(128,128,128,.07))),
    var(--dsw-alias-bg-base, #fff);
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

.dsh-atb-card {
  position: relative; border-radius: 9px; padding: 8px 10px 8px 13px; cursor: pointer;
  background: var(--atb-bg-1, rgba(128,128,128,.1));
  border: 1px solid var(--atb-border-2, rgba(128,128,128,.25));
  font-size: 13px; text-align: left; color: inherit; width: 100%; box-sizing: border-box;
}
.dsh-atb-card:hover { border-color: var(--atb-border-2, rgba(128,128,128,.55)); }
.dsh-atb-card[draggable="true"] { cursor: grab; }
.dsh-atb-card[data-dragging] { opacity: .45; }
.dsh-atb-column[data-dragover] { outline: 2px dashed var(--atb-border-2, rgba(128,128,128,.55)); outline-offset: -2px; background: var(--atb-hover, rgba(128,128,128,.12)); }
.dsh-atb-card::before {
  content: ""; position: absolute; left: 4px; top: 6px; bottom: 6px; width: 3.5px; border-radius: 3px;
}
.dsh-atb-card[data-urgency="urgent"]::before { background: var(--atb-error); }
.dsh-atb-card[data-urgency="normal"]::before { background: var(--dsw-alias-state-done-primary, #7c3aed); }
.dsh-atb-card[data-urgency="relaxed"]::before { background: var(--atb-accent); }
.dsh-atb-card-title { font-weight: 550; line-height: 1.35; word-break: break-word; }
.dsh-atb-card-meta { display: flex; align-items: center; gap: 6px; margin-top: 5px; font-size: 11px; color: var(--atb-text-2, gray); flex-wrap: wrap; }
.dsh-atb-badge { font-size: 10.5px; padding: 1px 6px; border-radius: 5px; background: rgba(128,128,128,.18); }
.dsh-atb-badge[data-kind="blocked"] { background: rgba(229,72,77,.18); color: var(--atb-error); }
.dsh-atb-badge[data-kind="scheduled"] { background: rgba(62,99,221,.16); color: var(--atb-accent); }
.dsh-atb-badge[data-kind="trashed"] { background: rgba(229,72,77,.14); color: var(--atb-error); text-decoration: line-through; }
.dsh-atb-badge[data-kind="done"] { background: rgba(46,160,67,.16); color: var(--atb-success); }
.dsh-atb-badge[data-kind="running"] { background: rgba(229,152,42,.16); color: #e69842; }
.dsh-atb-badge[data-kind="session"] {
  background: rgba(142, 78, 198, 0.12);
  color: var(--dsw-alias-state-business-primary, #7c3aed);
  border: 1px solid rgba(142, 78, 198, 0.25);
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 3px;
  max-width: 160px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  transition: all .15s ease;
}
.dsh-atb-badge[data-kind="session"]:hover {
  background: rgba(142, 78, 198, 0.22);
  border-color: rgba(142, 78, 198, 0.45);
}
.dsh-atb-card-session {
  font: inherit; font-size: 10.5px; line-height: 1; padding: 2px 6px; border-radius: 5px;
  border: 1px solid var(--atb-border-2, rgba(128,128,128,.3));
  background: var(--atb-bg-1, rgba(128,128,128,.14));
  color: var(--atb-text-2, inherit);
  cursor: pointer; display: inline-flex; align-items: center; gap: 3px;
  transition: all .15s ease;
}
.dsh-atb-card-session:hover {
  border-color: var(--dsw-alias-brand-primary, #1f2328);
  background: var(--atb-hover, rgba(128,128,128,.24));
  color: var(--dsw-alias-label-primary, inherit);
}

.dsh-atb-quick { display: flex; gap: 6px; margin-top: 7px; }
.dsh-atb-quickbtn {
  flex: 1; font-size: 11.5px; padding: 3px 8px; border-radius: 6px; cursor: pointer;
  border: 1px solid var(--atb-border-2, rgba(128,128,128,.3));
  background: var(--atb-bg-1, rgba(128,128,128,.12)); color: inherit;
}
.dsh-atb-quickbtn:hover { border-color: var(--atb-border-2, rgba(128,128,128,.6)); }
.dsh-atb-quickbtn[data-act="done"] { background: rgba(46,160,67,.14); color: var(--atb-success); border-color: rgba(46,160,67,.4); }
.dsh-atb-quickbtn[data-act="done"]:hover { background: rgba(46,160,67,.22); }
.dsh-atb-quickbtn[data-act="reject"] { background: rgba(229,152,42,.12); color: var(--atb-warn); border-color: rgba(229,152,42,.4); }
.dsh-atb-quickbtn[data-act="reject"]:hover { background: rgba(229,152,42,.2); }
.dsh-atb-quick-reject { display: flex; gap: 6px; margin-top: 7px; align-items: stretch; }
.dsh-atb-quick-note { flex: 1; min-width: 0; font-size: 11.5px; padding: 3px 8px; }

.dsh-atb-error { font-size: 12px; color: var(--atb-error); padding: 4px 8px; border-radius: 6px; background: rgba(229,72,77,.1); }
.dsh-atb-empty { font-size: 12px; color: var(--atb-text-2, gray); padding: 10px 4px; }
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
  background: rgba(245, 158, 11, 0.18) !important;
  color: #d97706 !important;
  border: 1px solid rgba(245, 158, 11, 0.45);
  font-weight: 600;
}
.dsh-atb-card[data-needs-human="true"] {
  border-color: rgba(245, 158, 11, 0.55);
  box-shadow: 0 0 0 1px rgba(245, 158, 11, 0.25);
  background: linear-gradient(to right, rgba(245, 158, 11, 0.06), var(--atb-bg-1, rgba(128,128,128,.1)));
}
.dsh-atb-card[data-needs-human="true"]::before {
  background: #f59e0b !important;
  width: 4.5px;
}
.dsh-atb-card-deliverable {
  margin-top: 6px;
  padding: 6px 8px;
  border-radius: 6px;
  background: rgba(128, 128, 128, 0.08);
  border: 1px dashed var(--atb-border-2, rgba(128, 128, 128, 0.25));
  font-size: 11.5px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.dsh-atb-card-deliv-row {
  display: flex;
  align-items: center;
  gap: 5px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dsh-atb-card-deliv-tag {
  font-weight: 600;
  color: var(--atb-text-2, #71717a);
  flex-shrink: 0;
}
.dsh-atb-card-deliv-val {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dsh-atb-deliv-warn {
  color: var(--atb-error);
  font-weight: 550;
}
.dsh-atb-deliv-muted {
  color: #78a9d6;
}
.dsh-atb-card-deliv-summary {
  font-size: 11px;
  color: var(--atb-text-2, #71717a);
  line-height: 1.35;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  margin-top: 2px;
}
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

/* Cards: white on the neutral column, separated by a soft shadow. */
.dsh-atb-card {
  border-color: transparent; border-radius: var(--atb-radius-md);
  box-shadow: 0 0 0 .5px #0000000f, 0 1px 2px #0000000a;
  transition: box-shadow .14s ease, transform .14s ease;
}
.dsh-atb-card:hover { border-color: transparent; box-shadow: 0 0 0 .5px #00000014, 0 4px 12px #0000000f; }
.dsh-atb-column { border-radius: var(--atb-radius-lg); }
.dsh-atb-colhead { padding: 4px 6px 2px; }

/* Buttons, chips, pills: filled, no outline. */
.dsh-atb-btn, .dsh-atb-chip, .dsh-atb-detail-edit, .dsh-atb-detail-session, .dsh-atb-movebtn,
.dsh-atb-quickbtn, .dsh-atb-image-add, .dsh-atb-card-session, .dsh-atb-file-copybtn,
.dsh-atb-ver, .dsh-atb-detail-id, button.dsh-atb-chip2.dsh-atb-chip-btn,
.dsh-atb-external button, .dsh-atb-cron-preset, .dsh-atb-mode-opt, .dsh-atb-perm-opt {
  border-color: transparent; background: var(--atb-hover);
}
.dsh-atb-btn:hover, .dsh-atb-chip:hover, .dsh-atb-detail-edit:hover, .dsh-atb-detail-session:hover,
.dsh-atb-movebtn:hover, .dsh-atb-quickbtn:hover, .dsh-atb-image-add:hover:not(:disabled),
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
.dsh-atb-movebtn[data-to="done"], .dsh-atb-quickbtn[data-act="done"] { border-color: transparent; background: color-mix(in srgb, var(--atb-success) 12%, transparent); color: var(--atb-success); }
.dsh-atb-movebtn[data-to="blocked"] { border-color: transparent; background: color-mix(in srgb, var(--atb-error) 9%, transparent); color: var(--atb-error); }
.dsh-atb-quickbtn[data-act="reject"] { border-color: transparent; background: color-mix(in srgb, var(--atb-warn) 12%, transparent); }
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
.dsh-atb-ws-group-head { background: linear-gradient(var(--atb-hover), var(--atb-hover)), var(--atb-surface-sunken); border-radius: var(--atb-radius-sm); }
.dsh-atb-ws-group-count { background: var(--atb-bg); }

/* Approval requests (0.10.1): warm tint so a pending decision stands out. */
.dsh-atb-approval { display: flex; flex-direction: column; gap: 8px; }
.dsh-atb-approval .dsh-atb-fieldcard { background: color-mix(in srgb, var(--atb-warn) 9%, var(--atb-bg)); }
.dsh-atb-badge[data-kind="approval"] { background: color-mix(in srgb, var(--atb-warn) 16%, transparent); color: var(--atb-warn); }
.dsh-atb-detail-run:disabled { opacity: .45; cursor: not-allowed; filter: none; }

/* Drop target: tint, no dashed frame. */
.dsh-atb-column[data-dragover] { outline: none; background: var(--atb-active); }

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

/**
 * One monochrome icon language for the board (DSH charte: thin line icons,
 * `currentColor`, no colour emoji). Every icon is a 16×16 stroked SVG drawn
 * inline so the plugin ships no icon font or external asset.
 *
 * `aria-hidden` + `focusable="false"` are fixed: icons are decorative and the
 * surrounding control carries the accessible name (icon-only buttons keep
 * their aria-label). `className="dsh-atb-icon"` is the styling hook owned by
 * styles.ts (inline-block, flex:none, vertical-align baseline nudge).
 *
 * @module dsh-taskboard/client/board/Icon
 */
import type { ReactNode } from 'react'

/** Every pictograph the board renders. */
export type IconName =
  | 'settings' | 'diagnostics' | 'import' | 'export'
  | 'chevronDown' | 'chevronRight' | 'plus' | 'close' | 'check' | 'warning'
  | 'link' | 'comment' | 'subtask' | 'clock' | 'user' | 'bot'
  | 'folder' | 'lock' | 'file' | 'image' | 'hand' | 'play' | 'checklist'
  | 'external' | 'stale' | 'shieldCheck' | 'branch' | 'edit' | 'trash' | 'stop'

/** Hand-drawn 16×16 line paths (stroke only). */
const PATHS: Record<IconName, ReactNode> = {
  settings: <><circle cx="8" cy="8" r="2.2" /><path d="M8 2.2v1.4M8 12.4v1.4M2.2 8h1.4M12.4 8h1.4M3.9 3.9l1 1M11.1 11.1l1 1M12.1 3.9l-1 1M4.9 11.1l-1 1" /></>,
  diagnostics: <><path d="M2 8h2l1.6-3.4 2.2 6.8L9.4 8H14" /></>,
  import: <><path d="M8 2.5v7" /><path d="m5 6.5 3 3 3-3" /><path d="M2.5 12.5h11" /></>,
  export: <><path d="M8 13.5v-7" /><path d="m5 9.5 3-3 3 3" /><path d="M2.5 3.5h11" /></>,
  chevronDown: <path d="m3.5 6 4.5 4.5L12.5 6" />,
  chevronRight: <path d="m6 3.5 4.5 4.5L6 12.5" />,
  plus: <path d="M8 3v10M3 8h10" />,
  close: <path d="m4 4 8 8M12 4l-8 8" />,
  check: <path d="m3 8.5 3.2 3.2L13 5" />,
  warning: <><path d="M8 2.8 14 13H2z" /><path d="M8 6.4v3.2" /><path d="M8 11.6h.01" /></>,
  link: <><path d="m6.5 9.5 3-3" /><path d="M7 4.5 8.6 2.9a2.7 2.7 0 0 1 3.8 3.8L10.8 8.3" /><path d="M9 11.5 7.4 13.1a2.7 2.7 0 0 1-3.8-3.8L5.2 7.7" /></>,
  comment: <path d="M3 3.5h10v7H8l-3.2 2.6v-2.6H3z" />,
  subtask: <><path d="M4 3v4.5A2.5 2.5 0 0 0 6.5 10H12" /><path d="m9.5 7.5 2.5 2.5-2.5 2.5" /></>,
  clock: <><circle cx="8" cy="8" r="5.5" /><path d="M8 4.8V8l2.4 1.5" /></>,
  user: <><circle cx="8" cy="5.5" r="2.5" /><path d="M3.5 13.2a4.8 4.8 0 0 1 9 0" /></>,
  bot: <><rect x="3" y="4.5" width="10" height="7.5" rx="2" /><path d="M8 2.5v2" /><path d="M6.2 8.2h.01M9.8 8.2h.01" /><path d="M6 10.2h4" /></>,
  folder: <path d="M2.5 4.5h4l1.2 1.5h5.8v6.5h-11z" />,
  lock: <><rect x="3.5" y="7" width="9" height="6" rx="1.5" /><path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" /></>,
  file: <><path d="M4 2.5h5l3 3v8H4z" /><path d="M9 2.5v3h3" /></>,
  image: <><rect x="2.5" y="3" width="11" height="10" rx="1.5" /><circle cx="6" cy="6.5" r="1" /><path d="m3 12 3.5-3.5 2.5 2.5 1.5-1.5 2.5 2.5" /></>,
  hand: <><path d="M5 8V4.2a.9.9 0 0 1 1.8 0V7" /><path d="M6.8 7V3.4a.9.9 0 0 1 1.8 0V7" /><path d="M8.6 7V4a.9.9 0 0 1 1.8 0v4" /><path d="M10.4 8V6a.9.9 0 0 1 1.8 0v3.2A3.8 3.8 0 0 1 8.4 13H7.6A4 4 0 0 1 3.8 9V7.6a.9.9 0 0 1 1.8 0V9" /></>,
  play: <path d="M5.5 3.5 12 8l-6.5 4.5z" />,
  checklist: <><rect x="2.5" y="3" width="11" height="10" rx="1.5" /><path d="m5 8 1.5 1.5L9 6.5" /><path d="M10.5 6.5H12M10.5 9.5H12" /></>,
  external: <><path d="M9 3h4v4" /><path d="M13 3 7.5 8.5" /><path d="M11 9.5V13H3V5h3.5" /></>,
  stale: <><circle cx="8" cy="8" r="5.5" /><path d="M8 5v3l2 1.2" /><path d="m3 13 10-10" /></>,
  shieldCheck: <><path d="M8 2.5 13 4.5v3.2c0 3-2.2 4.8-5 5.8-2.8-1-5-2.8-5-5.8V4.5z" /><path d="m5.8 8 1.5 1.5L10.4 6.3" /></>,
  branch: <><circle cx="5" cy="4" r="1.5" /><circle cx="11" cy="12" r="1.5" /><path d="M5 5.5V8a4 4 0 0 0 4 4h.5" /></>,
  edit: <path d="M10.8 2.8 13.2 5.2 5.4 13H3v-2.4z" />,
  trash: <><path d="M3 4.5h10" /><path d="M6 4.5V3h4v1.5" /><path d="m4.5 4.5.7 8.5h5.6l.7-8.5" /><path d="M6.8 7v4M9.2 7v4" /></>,
  stop: <rect x="4.5" y="4.5" width="7" height="7" rx="1" />,
}

/**
 * Render one decorative icon.
 * @param props - icon name and pixel size (default 14).
 */
export function Icon({ name, size = 14 }: { name: IconName; size?: number }) {
  return (
    <svg
      viewBox="0 0 16 16"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className="dsh-atb-icon"
    >
      {PATHS[name]}
    </svg>
  )
}

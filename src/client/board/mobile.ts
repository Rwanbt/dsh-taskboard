/**
 * Mobile focus mode: the shape of the viewport that turns the five-column
 * board into a horizontally snapped carousel — plus the pure geometry that
 * keeps the status tabs and the carousel telling the same story.
 *
 * Two viewport shapes are focused (mirroring the reference prototype):
 *  - portrait / narrow panel: exactly one column per page;
 *  - phone landscape: two columns per page.
 * The query strings are exported so behaviour and stylesheet cannot drift
 * apart silently: a unit test asserts both appear verbatim in `STYLES`.
 *
 * Everything here is pure or DOM-reading only — no board state, no theme, no
 * host access — so the geometry can be unit-tested without a browser.
 *
 * @module dsh-taskboard/client/board/mobile
 */
import { useSyncExternalStore } from 'react'
import { MAIN_STATUSES, type TaskStatus } from '../../shared/protocol.ts'

/** Portrait / narrow-panel shape: one full column per snapped page. */
export const FOCUS_PORTRAIT_QUERY = '(max-width: 760px)'

/**
 * Phone-landscape shape: two columns per snapped page. The height guard keeps
 * ordinary desktop windows (and stacked panels) out of the two-up layout.
 */
export const FOCUS_LANDSCAPE_QUERY = '(orientation: landscape) and (max-height: 680px) and (max-width: 1380px)'

/** Selector of the five workflow columns inside the carousel rail. */
export const RAIL_COLUMN_SELECTOR = '.dsh-atb-column[data-status]'

/**
 * Sentinel category filter for the "unclassified" bucket. It cannot collide
 * with a slug (slugs are lowercase words joined by hyphens).
 */
export const UNCLASSIFIED_FILTER = '\u0000unclassified'

/** The resolved focus shape. */
export interface FocusMode {
  /** One column per page (narrow panel, phone portrait). */
  portrait: boolean
  /** Phone landscape: two columns per page. */
  landscape: boolean
  /** Any focused shape: the carousel + tab rail replace the five-column grid. */
  focus: boolean
  /** Two columns per page rather than one. */
  twoUp: boolean
}

/** Desktop shape (five columns side by side). */
export const DESKTOP_MODE: FocusMode = Object.freeze({
  portrait: false,
  landscape: false,
  focus: false,
  twoUp: false,
})

/** Build a focus shape from the two media-query answers. */
export function focusModeFrom(portrait: boolean, landscape: boolean): FocusMode {
  return Object.freeze({
    portrait,
    landscape,
    focus: portrait || landscape,
    // Landscape wins the overlap (a very short, narrow window), matching the
    // stylesheet where the landscape block follows the portrait one.
    twoUp: landscape,
  })
}

/**
 * Fallback evaluation of the two media queries from window dimensions, used
 * when `matchMedia` is unavailable (jsdom, very old webviews).
 */
export function focusModeFromDimensions(width: number, height: number): FocusMode {
  const safeWidth = Number.isFinite(width) ? width : 0
  const safeHeight = Number.isFinite(height) ? height : 0
  const portrait = safeWidth > 0 && safeWidth <= 760
  const landscape = safeWidth > safeHeight && safeHeight > 0 && safeHeight <= 680 && safeWidth <= 1380
  return focusModeFrom(portrait, landscape)
}

/** Minimal window surface this module needs (letjs test doubles satisfy it). */
export interface FocusWindowLike {
  innerWidth: number
  innerHeight: number
  matchMedia?: (query: string) => MediaQueryList
}

function mediaMatches(win: FocusWindowLike, query: string): boolean | undefined {
  if (typeof win.matchMedia !== 'function') return undefined
  try {
    return win.matchMedia(query).matches === true
  } catch {
    return undefined
  }
}

/**
 * Read the current focus shape. `matchMedia` is authoritative in a browser;
 * dimensions are the fallback so the board still adapts where it is missing.
 */
export function readFocusMode(win?: FocusWindowLike): FocusMode {
  const target = win ?? (typeof window === 'undefined' ? undefined : (window as unknown as FocusWindowLike))
  if (target === undefined) return DESKTOP_MODE
  const portrait = mediaMatches(target, FOCUS_PORTRAIT_QUERY)
  const landscape = mediaMatches(target, FOCUS_LANDSCAPE_QUERY)
  if (portrait !== undefined && landscape !== undefined) return focusModeFrom(portrait, landscape)
  const bySize = focusModeFromDimensions(target.innerWidth, target.innerHeight)
  return focusModeFrom(portrait ?? bySize.portrait, landscape ?? bySize.landscape)
}

/* ---------------------------------------------------------------------------
 * Snapshot cache: `useSyncExternalStore` requires a referentially stable
 * snapshot, so the shape is memoised by its own boolean pair.
 * ------------------------------------------------------------------------- */
const SNAPSHOTS = new Map<string, FocusMode>()

function snapshotFor(win?: FocusWindowLike): FocusMode {
  const mode = readFocusMode(win)
  const key = `${mode.portrait ? 1 : 0}${mode.landscape ? 1 : 0}`
  const cached = SNAPSHOTS.get(key)
  if (cached !== undefined) return cached
  SNAPSHOTS.set(key, mode)
  return mode
}

/** Subscribe to focus-shape changes (media queries + resize fallback). */
export function subscribeFocusMode(onChange: () => void): () => void {
  if (typeof window === 'undefined') return () => {}
  const win = window as unknown as FocusWindowLike
  const cleanups: Array<() => void> = []

  if (typeof win.matchMedia === 'function') {
    for (const query of [FOCUS_PORTRAIT_QUERY, FOCUS_LANDSCAPE_QUERY]) {
      try {
        const list = win.matchMedia(query)
        if (typeof list.addEventListener === 'function') {
          const handler = (): void => onChange()
          list.addEventListener('change', handler)
          cleanups.push(() => list.removeEventListener('change', handler))
        } else if (typeof (list as MediaQueryList & { addListener?: (cb: () => void) => void }).addListener === 'function') {
          // Safari < 14 fallback.
          const legacy = list as MediaQueryList & { addListener: (cb: () => void) => void, removeListener: (cb: () => void) => void }
          const handler = (): void => onChange()
          legacy.addListener(handler)
          cleanups.push(() => legacy.removeListener(handler))
        }
      } catch {
        // Ignore: the resize listener below still reports changes.
      }
    }
  }

  const onResize = (): void => onChange()
  window.addEventListener('resize', onResize)
  cleanups.push(() => window.removeEventListener('resize', onResize))
  // Orientation changes also fire resize, but not in every webview.
  window.addEventListener('orientationchange', onResize)
  cleanups.push(() => window.removeEventListener('orientationchange', onResize))

  return () => {
    for (const cleanup of cleanups) cleanup()
  }
}

/** Reactive focus shape for React components. */
export function useFocusMode(): FocusMode {
  return useSyncExternalStore(
    subscribeFocusMode,
    () => snapshotFor(),
    () => DESKTOP_MODE,
  )
}

/* ---------------------------------------------------------------------------
 * Snap geometry
 * ------------------------------------------------------------------------- */

/**
 * Snap positions of the rail, normalised to the first column (the rail's own
 * `offsetLeft` origin is the panel, not the first column).
 */
export function columnOffsets(rail: Pick<HTMLElement, 'querySelectorAll'>): number[] {
  const columns = Array.from(rail.querySelectorAll<HTMLElement>(RAIL_COLUMN_SELECTOR))
  if (columns.length === 0) return []
  const base = columns[0]?.offsetLeft ?? 0
  return columns.map(column => column.offsetLeft - base)
}

/** One page step (first → second column offset); 0 when unmeasurable. */
export function stepOf(offsets: readonly number[]): number {
  const first = offsets[0]
  const second = offsets[1]
  if (first === undefined || second === undefined) return 0
  const step = second - first
  return Number.isFinite(step) && step > 0 ? step : 0
}

/**
 * Which column a scroll position is snapped to: the nearest snap offset, with
 * a tie going to the later column (the finger moved forward). In the two-up
 * landscape layout the last page shows the *last* status, so reaching the end
 * of the rail selects the final column instead of the leftmost visible one.
 */
export function indexAtScroll(
  offsets: readonly number[],
  scrollLeft: number,
  options: { maxScroll?: number, twoUp?: boolean } = {},
): number {
  const count = offsets.length
  if (count === 0) return 0
  if (count === 1) return 0
  const position = Number.isFinite(scrollLeft) ? scrollLeft : 0
  const maxScroll = options.maxScroll
  const atEnd = maxScroll !== undefined && Number.isFinite(maxScroll) && maxScroll > 0 && position >= maxScroll - 1
  if (atEnd && options.twoUp === true) return count - 1

  let best = 0
  let bestDistance = Number.POSITIVE_INFINITY
  for (let index = 0; index < count; index += 1) {
    const offset = offsets[index]
    if (offset === undefined) continue
    const distance = Math.abs(offset - position)
    if (distance <= bestDistance) {
      best = index
      bestDistance = distance
    }
  }
  return best
}

/** Scroll position that brings `index` to the start of the rail (clamped). */
export function scrollTarget(offsets: readonly number[], index: number, maxScroll: number): number {
  const count = offsets.length
  if (count === 0) return 0
  const clampedIndex = Math.max(0, Math.min(count - 1, Math.trunc(index)))
  const offset = offsets[clampedIndex] ?? 0
  const limit = Number.isFinite(maxScroll) && maxScroll > 0 ? maxScroll : Number.POSITIVE_INFINITY
  return Math.max(0, Math.min(offset, limit))
}

/** Status of a rail page index (never out of range). */
export function statusAt(index: number): TaskStatus {
  const clamped = Math.max(0, Math.min(MAIN_STATUSES.length - 1, Math.trunc(index)))
  return MAIN_STATUSES[clamped] ?? 'backlog'
}

/** Rail page index of a status (0 when unknown). */
export function indexOfStatus(status: TaskStatus): number {
  const index = MAIN_STATUSES.indexOf(status)
  return index < 0 ? 0 : index
}

/** 1-based "current / total" page label used by the swipe cue. */
export function pageLabel(index: number, total: number = MAIN_STATUSES.length): string {
  const safeTotal = Math.max(1, Math.trunc(total))
  const safeIndex = Math.max(0, Math.min(safeTotal - 1, Math.trunc(index)))
  return `${safeIndex + 1}/${safeTotal}`
}

/** Keycap steps for the roving tab order of the status rail. */
export function stepTabIndex(current: number, key: string, total: number = MAIN_STATUSES.length): number | undefined {
  const last = Math.max(0, Math.min(total, MAIN_STATUSES.length) - 1)
  if (key === 'ArrowRight') return Math.min(last, current + 1)
  if (key === 'ArrowLeft') return Math.max(0, current - 1)
  if (key === 'Home') return 0
  if (key === 'End') return last
  return undefined
}

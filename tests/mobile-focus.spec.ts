// @vitest-environment jsdom
/**
 * Mobile focus mode — geometry, viewport shapes and stylesheet contract.
 *
 * The swipe carousel is driven by two media queries plus a small amount of
 * pure geometry. Everything asserted here is deterministic and DOM-free (apart
 * from offset reading), so a regression in the snap maths fails immediately
 * instead of only showing up on a physical phone.
 *
 * @module dsh-taskboard/tests/mobile-focus
 */
import { afterEach, describe, expect, it } from 'vitest'
import { STYLES } from '../src/client/styles.ts'
import { MAIN_STATUSES } from '../src/shared/protocol.ts'
import {
  DESKTOP_MODE,
  FOCUS_LANDSCAPE_QUERY,
  FOCUS_PORTRAIT_QUERY,
  RAIL_COLUMN_SELECTOR,
  UNCLASSIFIED_FILTER,
  columnOffsets,
  focusModeFrom,
  focusModeFromDimensions,
  indexAtScroll,
  indexOfStatus,
  pageLabel,
  readFocusMode,
  scrollTarget,
  statusAt,
  stepOf,
  stepTabIndex,
  type FocusWindowLike,
} from '../src/client/board/mobile.ts'

afterEach(() => {
  document.body.replaceChildren()
})

/** Four-page rail used by most cases (width 390, five columns). */
const RAIL = [0, 390, 780, 1170, 1560] as const

describe('focus shapes — the two queries the stylesheet also uses', () => {
  it('exports the portrait and phone-landscape queries verbatim', () => {
    expect(FOCUS_PORTRAIT_QUERY).toBe('(max-width: 760px)')
    expect(FOCUS_LANDSCAPE_QUERY).toBe('(orientation: landscape) and (max-height: 680px) and (max-width: 1380px)')
  })

  it('keeps both focus queries in the stylesheet (behaviour and CSS cannot drift)', () => {
    expect(STYLES).toContain(`@media ${FOCUS_PORTRAIT_QUERY}`)
    expect(STYLES).toContain(`@media ${FOCUS_LANDSCAPE_QUERY}`)
  })

  it('derives the four shapes from the two media answers', () => {
    expect(focusModeFrom(false, false)).toEqual({ portrait: false, landscape: false, focus: false, twoUp: false })
    expect(focusModeFrom(true, false)).toEqual({ portrait: true, landscape: false, focus: true, twoUp: false })
    expect(focusModeFrom(false, true)).toEqual({ portrait: false, landscape: true, focus: true, twoUp: true })
    // Overlap (a very short, narrow window) keeps two-up: the landscape block
    // is declared after the portrait one in the stylesheet.
    expect(focusModeFrom(true, true)).toEqual({ portrait: true, landscape: true, focus: true, twoUp: true })
  })

  it('falls back to window dimensions when matchMedia is unavailable', () => {
    // Phone portrait.
    expect(focusModeFromDimensions(390, 844)).toEqual({ portrait: true, landscape: false, focus: true, twoUp: false })
    // Phone landscape: two columns per page.
    expect(focusModeFromDimensions(844, 390)).toEqual({ portrait: false, landscape: true, focus: true, twoUp: true })
    // Desktop window: five columns, no carousel.
    expect(focusModeFromDimensions(1440, 900)).toEqual(DESKTOP_MODE)
    // Narrow desktop panel in a tall window stays one-up (height guard).
    expect(focusModeFromDimensions(700, 1000)).toEqual({ portrait: true, landscape: false, focus: true, twoUp: false })
    // Garbage never throws.
    expect(focusModeFromDimensions(Number.NaN, Number.NaN)).toEqual(DESKTOP_MODE)
  })

  it('prefers matchMedia and only uses dimensions for the missing answer', () => {
    const media = (answers: Record<string, boolean>): FocusWindowLike => ({
      innerWidth: 1000,
      innerHeight: 800,
      matchMedia: (query: string) => ({ matches: answers[query] === true } as MediaQueryList),
    })
    expect(readFocusMode(media({ [FOCUS_PORTRAIT_QUERY]: true })).focus).toBe(true)
    expect(readFocusMode(media({}))).toEqual(DESKTOP_MODE)
    // A throwing matchMedia implementation must not break the board.
    const broken: FocusWindowLike = {
      innerWidth: 390,
      innerHeight: 844,
      matchMedia: () => { throw new Error('nope') },
    }
    expect(readFocusMode(broken)).toEqual({ portrait: true, landscape: false, focus: true, twoUp: false })
  })
})

describe('snap geometry — swipe and tabs share one source of truth', () => {
  it('normalises column offsets to the first column and measures the page step', () => {
    const rail = document.createElement('div')
    for (let index = 0; index < 5; index += 1) {
      const column = document.createElement('div')
      column.className = 'dsh-atb-column'
      column.dataset.status = MAIN_STATUSES[index]
      // The rail itself sits at x=40: offsets must be relative to column 0.
      Object.defineProperty(column, 'offsetLeft', { value: 40 + index * 390 })
      rail.append(column)
    }
    expect(columnOffsets(rail)).toEqual([0, 390, 780, 1170, 1560])
    expect(stepOf(columnOffsets(rail))).toBe(390)
    expect(RAIL_COLUMN_SELECTOR).toBe('.dsh-atb-column[data-status]')
    // An empty rail has no geometry at all.
    expect(columnOffsets(document.createElement('div'))).toEqual([])
    expect(stepOf([])).toBe(0)
    expect(stepOf([0])).toBe(0)
  })

  it('snaps to the nearest page, ties going to the later column', () => {
    expect(indexAtScroll(RAIL, 0)).toBe(0)
    expect(indexAtScroll(RAIL, 389)).toBe(1)
    expect(indexAtScroll(RAIL, 780)).toBe(2)
    expect(indexAtScroll(RAIL, 1500)).toBe(4)
    // Exactly between two pages: the finger moved forward.
    expect(indexAtScroll(RAIL, 195)).toBe(1)
    // Bounced/overscrolled positions clamp at the ends.
    expect(indexAtScroll(RAIL, -120)).toBe(0)
    expect(indexAtScroll(RAIL, 99_999)).toBe(4)
    // Degenerate inputs never throw or return an out-of-range index.
    expect(indexAtScroll([], 500)).toBe(0)
    expect(indexAtScroll([0], 500)).toBe(0)
    expect(indexAtScroll(RAIL, Number.NaN)).toBe(0)
  })

  it('selects the final status when the two-up rail reaches its end', () => {
    // Landscape: two columns visible, the rail cannot scroll Done to the left
    // edge, so the last page must still report the last status.
    expect(indexAtScroll(RAIL, 1170, { maxScroll: 1170, twoUp: true })).toBe(4)
    // Same position one-up reports the leftmost visible column.
    expect(indexAtScroll(RAIL, 1170, { maxScroll: 1170, twoUp: false })).toBe(3)
    // Mid-rail in two-up keeps the nearest page.
    expect(indexAtScroll(RAIL, 780, { maxScroll: 1170, twoUp: true })).toBe(2)
  })

  it('clamps the programmatic scroll target to the rail bounds', () => {
    expect(scrollTarget(RAIL, 0, 1560)).toBe(0)
    expect(scrollTarget(RAIL, 2, 1560)).toBe(780)
    expect(scrollTarget(RAIL, 4, 1560)).toBe(1560)
    // Tab clicked for Done when the rail can only reach page 3.
    expect(scrollTarget(RAIL, 4, 1170)).toBe(1170)
    // Out-of-range or unmeasurable inputs.
    expect(scrollTarget(RAIL, -3, 1560)).toBe(0)
    expect(scrollTarget(RAIL, 99, 1560)).toBe(1560)
    expect(scrollTarget([], 2, 100)).toBe(0)
    expect(scrollTarget(RAIL, 2, Number.NaN)).toBe(780)
  })

  it('maps pages to statuses, statuses to pages and pages to a 1-based label', () => {
    expect(MAIN_STATUSES).toEqual(['backlog', 'todo', 'in_progress', 'in_review', 'done'])
    expect(MAIN_STATUSES.map((_, index) => statusAt(index))).toEqual([...MAIN_STATUSES])
    expect(statusAt(-1)).toBe('backlog')
    expect(statusAt(99)).toBe('done')
    expect(indexOfStatus('backlog')).toBe(0)
    expect(indexOfStatus('done')).toBe(4)
    expect(pageLabel(0)).toBe('1/5')
    expect(pageLabel(4)).toBe('5/5')
    expect(pageLabel(9)).toBe('5/5')
    expect(pageLabel(-2)).toBe('1/5')
  })

  it('moves the roving tab stop with the arrow keys, Home and End', () => {
    expect(stepTabIndex(2, 'ArrowRight')).toBe(3)
    expect(stepTabIndex(4, 'ArrowRight')).toBe(4)
    expect(stepTabIndex(0, 'ArrowLeft')).toBe(0)
    expect(stepTabIndex(3, 'ArrowLeft')).toBe(2)
    expect(stepTabIndex(3, 'Home')).toBe(0)
    expect(stepTabIndex(1, 'End')).toBe(4)
    // Any other key leaves the selection alone (Tab keeps native behaviour).
    expect(stepTabIndex(2, 'Tab')).toBeUndefined()
    expect(stepTabIndex(2, 'Enter')).toBeUndefined()
  })

  it('keeps the unclassified category sentinel out of the slug namespace', () => {
    expect(UNCLASSIFIED_FILTER).toBe('\u0000unclassified')
  })
})

describe('focus-mode stylesheet contract', () => {
  it('lays one full page per column in portrait, with native scroll snapping', () => {
    expect(STYLES).toContain('scroll-snap-type: x mandatory')
    expect(STYLES).toContain('scroll-snap-align: start')
    expect(STYLES).toContain('scroll-snap-stop: always')
    expect(STYLES).toContain('flex: 0 0 100%')
    expect(STYLES).toContain('overscroll-behavior-x: contain')
    expect(STYLES).toContain('-webkit-overflow-scrolling: touch')
    // Each column keeps its own vertical scroll position.
    expect(STYLES).toContain('overscroll-behavior-y: contain')
  })

  it('lays two columns per page in phone landscape', () => {
    expect(STYLES).toContain('flex: 0 0 calc((100% - 9px) / 2)')
    expect(STYLES).toContain('@media (orientation: landscape) and (max-height: 680px) and (max-width: 1380px)')
  })

  it('keeps the mobile toolbar, sheets and safe areas in place', () => {
    expect(STYLES).toContain('.dsh-atb-mobileactions { display: none;')
    expect(STYLES).toContain('.dsh-atb-toolbar-filters, .dsh-atb-toolbar-actions { display: contents; }')
    expect(STYLES).toContain('.dsh-atb-fab {')
    expect(STYLES).toContain('.dsh-atb-sheet-layer')
    expect(STYLES).toContain('.dsh-atb-sheet-item')
    expect(STYLES).toContain('env(safe-area-inset-bottom)')
    // The full-bleed form modal is a phone sheet, never 1060px wide.
    expect(STYLES).toContain('.dsh-atb-taskform-modal { width: 100%; min-width: 0; max-height: 90dvh; }')
  })

  it('never overrides host theme state (no html/body colour rules)', () => {
    // The only host-state read is the sidebar-collapsed padding, scoped to the
    // plugin's own toolbar; the board never paints host elements.
    expect(STYLES).not.toContain('html[')
    expect(STYLES).not.toContain('body[data-ds-dark-theme]')
    expect(STYLES).not.toContain('body[data-ds-light-theme]')
    expect(STYLES).not.toContain(':root {')
  })
})

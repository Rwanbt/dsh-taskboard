/**
 * Desktop toolbar densities: the board header must never cost more than two
 * visual rows — the title bar, then one single toolbar line — including on a
 * laptop where the five-column board is only a thousand pixels wide.
 *
 * The guide is the **measured width of the toolbar itself**, not the viewport:
 * the DSH panel width depends on the host sidebar (expanded, collapsed, or
 * resized by the user), so a viewport media query would be wrong exactly where
 * it matters. The resolved density is published as `data-atb-bar` on the board
 * root and consumed only by the stylesheet; nothing else in the board reads it.
 *
 * Three densities, each strictly wider than the one below:
 *  - `wide`    — every control keeps its visible label;
 *  - `compact` — the five action buttons become icon-only (tooltip + accessible
 *                name) and the secondary labels of the filter row are dropped;
 *  - `tight`   — the urgency chips keep only their colour dot and the selects
 *                clamp, so the row still fits in very narrow desktop windows.
 *
 * @module dsh-taskboard/client/board/compact
 */
import { useEffect, useState, type RefObject } from 'react'

/** Resolved desktop toolbar density. */
export type ToolbarDensity = 'wide' | 'compact' | 'tight'

/**
 * Minimum toolbar width (px) at which every label is kept.
 *
 * The title row carries the five action buttons with their words
 * (title 160 + counter 140 + five labelled buttons 457 + grouping 110 + new
 * task 150 + seven 8 px gaps ≈ 1080) and no longer competes with the filter
 * row, so the whole header is one line as soon as the panel reaches this
 * width. Rounding up leaves a small safety margin so the rows never re-wrap
 * on a half-pixel boundary.
 */
export const TOOLBAR_WIDE_MIN = 1100

/**
 * Minimum toolbar width (px) at which only the action words are dropped.
 *
 * Title row with five 34 px icon buttons (170) and the version pill ≈ 790; the
 * filter row keeps the search field, three selects, the four labelled chips
 * and the divider ≈ 935. The 960 px minimum keeps a ~25 px margin, so the
 * chips keep their words on every 1440-class laptop.
 */
export const TOOLBAR_COMPACT_MIN = 960

/**
 * Resolve the density for a toolbar width. A hidden panel reports 0 and keeps
 * the previous answer (handled by the hook), so 0 maps to the densest layout.
 */
export function toolbarDensityFor(width: number): ToolbarDensity {
  const safe = Number.isFinite(width) ? width : 0
  if (safe >= TOOLBAR_WIDE_MIN) return 'wide'
  if (safe >= TOOLBAR_COMPACT_MIN) return 'compact'
  return 'tight'
}

/**
 * Track the toolbar density from the element's own width.
 *
 * `ResizeObserver` drives the updates in a browser; the `resize` listener is
 * the fallback for environments without it (jsdom in the unit tests, very old
 * webviews). A width of 0 means the panel is currently hidden, so the last
 * density is kept instead of flashing the densest layout.
 *
 * @param ref - the toolbar element.
 */
export function useToolbarDensity(ref: RefObject<HTMLElement | null>): ToolbarDensity {
  const [density, setDensity] = useState<ToolbarDensity>('wide')

  useEffect(() => {
    const element = ref.current
    if (element === null) return undefined

    const update = (): void => {
      // Content width: the stylesheet pads the whole toolbar on the left/right
      // for the host overlay button, and that padding is not room for items.
      const style = getComputedStyle(element)
      const padding = (parseFloat(style.paddingLeft) || 0) + (parseFloat(style.paddingRight) || 0)
      const width = element.clientWidth - padding
      if (!Number.isFinite(width) || width <= 0) return
      const next = toolbarDensityFor(width)
      setDensity(current => (current === next ? current : next))
    }

    update()

    if (typeof ResizeObserver === 'function') {
      const observer = new ResizeObserver(update)
      observer.observe(element)
      return () => observer.disconnect()
    }

    window.addEventListener('resize', update)
    return () => window.removeEventListener('resize', update)
  }, [ref])

  return density
}

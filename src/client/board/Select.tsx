/**
 * Themed select (combobox + listbox) used everywhere a native `<select>` used
 * to be.
 *
 * Why a custom control: a native `<select>` opens an OS-drawn popup with square
 * corners and system colours, which cannot be themed. DSH's own floating
 * surfaces use `--dsw-menu-surface-fill` (translucent) with
 * `--dsw-menu-backdrop-filter`, a 16px radius with `--dsw-corner-shape`
 * (superellipse), and `--dsw-elevation-panel`. This component reproduces that
 * recipe through the plugin token layer (see styles.ts), so menus match the
 * host in light and dark themes.
 *
 * Semantics (WAI-ARIA combobox + listbox): the trigger keeps DOM focus and
 * carries role=combobox, aria-expanded, aria-controls and
 * aria-activedescendant; the popup is role=listbox with role=option children.
 * ArrowUp/Down move, Home/End jump, Enter/Space commit, Escape closes, Tab
 * closes. Typing jumps to the first matching option. The popup is portalled to
 * `document.body` (which carries the DSH tokens) and positioned `fixed`, so it
 * is never clipped by a scrolling modal body.
 *
 * @module dsh-taskboard/client/board/Select
 */
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

/** One selectable entry. */
export interface SelectOption {
  value: string
  label: string
  /** Optional leading glyph (emoji/icon) rendered before the label. */
  icon?: string
  disabled?: boolean
}

/** Fixed metrics shared with the stylesheet. */
const OPTION_HEIGHT = 28
const LIST_PADDING = 4
const MAX_LIST_HEIGHT = 280
const MIN_POP_WIDTH = 200
const MAX_POP_WIDTH = 420

/**
 * The select control.
 * @param props - value, change handler, options and presentation hints.
 */
export function Select({
  value, onChange, options, ariaLabel, title, disabled = false, className, id, full = false, placeholder,
}: {
  value: string
  onChange: (value: string) => void
  options: readonly SelectOption[]
  ariaLabel?: string
  title?: string
  disabled?: boolean
  className?: string
  id?: string
  /** Stretch to the container width (default: fit the grid column). */
  full?: boolean
  /** Label shown when no option matches `value`. */
  placeholder?: string
}) {
  const listId = useId()
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const popRef = useRef<HTMLDivElement | null>(null)
  const [open, setOpen] = useState(false)
  const [placement, setPlacement] = useState<{ left: number; top: number; width: number } | undefined>(undefined)
  const [activeIndex, setActiveIndex] = useState(0)

  const selectedIndex = useMemo(() => options.findIndex(option => option.value === value), [options, value])
  const selected = selectedIndex >= 0 ? options[selectedIndex] : undefined
  const typeahead = useRef<{ buffer: string; at: number }>({ buffer: '', at: 0 })

  const close = useCallback((focus = false) => {
    setOpen(false)
    setPlacement(undefined)
    if (focus) triggerRef.current?.focus()
  }, [])

  /** Position the fixed popup under (or above) the trigger. */
  const place = useCallback(() => {
    const rect = triggerRef.current?.getBoundingClientRect()
    if (rect === undefined) return
    const estimated = Math.min(options.length * OPTION_HEIGHT + LIST_PADDING * 2, MAX_LIST_HEIGHT)
    const spaceBelow = window.innerHeight - rect.bottom
    const above = spaceBelow < estimated + 8 && rect.top > spaceBelow
    const top = above ? Math.max(8, rect.top - estimated - 6) : Math.min(window.innerHeight - 8, rect.bottom + 6)
    const width = Math.max(MIN_POP_WIDTH, Math.min(MAX_POP_WIDTH, Math.max(rect.width, MIN_POP_WIDTH)))
    setPlacement({ left: Math.max(8, Math.min(rect.left, window.innerWidth - width - 8)), top, width })
  }, [options.length])

  /** Open with the current selection highlighted. */
  const openList = useCallback(() => {
    if (disabled || options.length === 0) return
    const index = selectedIndex >= 0 ? selectedIndex : options.findIndex(option => !option.disabled)
    setActiveIndex(Math.max(0, index))
    place()
    setOpen(true)
  }, [disabled, options, place, selectedIndex])

  /** Move the active row, skipping disabled entries and wrapping. */
  const move = useCallback((delta: 1 | -1) => {
    setActiveIndex(previous => {
      const count = options.length
      if (count === 0) return 0
      let next = previous
      for (let step = 0; step < count; step++) {
        next = (next + delta + count) % count
        if (!options[next]?.disabled) return next
      }
      return previous
    })
  }, [options])

  /** Commit the active row (or the one at `index`). */
  const commit = useCallback((index: number) => {
    const option = options[index]
    if (option === undefined || option.disabled) return
    onChange(option.value)
    close(true)
  }, [close, onChange, options])

  // Keep the active row visible while navigating a long list. jsdom does not
  // implement scrollIntoView; real browsers do, so the guard only keeps
  // non-browser environments (tests) from throwing inside a layout effect.
  useLayoutEffect(() => {
    if (!open || placement === undefined) return
    const activeRow = popRef.current?.querySelector<HTMLElement>('[data-active="true"]')
    if (activeRow !== null && activeRow !== undefined && typeof activeRow.scrollIntoView === 'function') {
      activeRow.scrollIntoView({ block: 'nearest' })
    }
  }, [activeIndex, open, placement])

  // After opening, measure again with the real height (fonts can differ).
  useLayoutEffect(() => {
    if (open && placement === undefined) place()
  }, [open, place, placement])

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target as Node
      if (triggerRef.current?.contains(target) || popRef.current?.contains(target)) return
      close()
    }
    const onKey = (event: globalThis.KeyboardEvent): void => {
      if (event.key === 'Escape') { event.preventDefault(); close(true) }
    }
    const onReflow = (): void => place()
    window.addEventListener('pointerdown', onPointerDown, true)
    window.addEventListener('keydown', onKey, true)
    window.addEventListener('resize', onReflow)
    window.addEventListener('scroll', onReflow, true)
    return () => {
      window.removeEventListener('pointerdown', onPointerDown, true)
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('resize', onReflow)
      window.removeEventListener('scroll', onReflow, true)
    }
  }, [close, open, place])

  /** Keyboard handling while the trigger holds focus. */
  const onKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>): void => {
    if (disabled) return
    if (!open) {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp' || event.key === 'Enter' || event.key === ' ') {
        event.preventDefault()
        openList()
      }
      return
    }
    switch (event.key) {
      case 'ArrowDown': event.preventDefault(); move(1); break
      case 'ArrowUp': event.preventDefault(); move(-1); break
      case 'Home': event.preventDefault(); setActiveIndex(0); break
      case 'End': event.preventDefault(); setActiveIndex(options.length - 1); break
      case 'Enter':
      case ' ': event.preventDefault(); commit(activeIndex); break
      case 'Escape': event.preventDefault(); close(true); break
      case 'Tab': close(); break
      default: {
        if (event.key.length !== 1 || event.ctrlKey || event.metaKey || event.altKey) break
        const now = Date.now()
        const state = typeahead.current
        state.buffer = now - state.at > 700 ? event.key : state.buffer + event.key
        state.at = now
        const needle = state.buffer.toLowerCase()
        const hit = options.findIndex(option => !option.disabled && option.label.toLowerCase().startsWith(needle))
        if (hit >= 0) setActiveIndex(hit)
      }
    }
  }

  const activeId = open ? `${listId}-opt-${activeIndex}` : undefined

  return (
    <>
      <button
        ref={triggerRef}
        id={id}
        type="button"
        role="combobox"
        aria-label={ariaLabel}
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-haspopup="listbox"
        aria-activedescendant={activeId}
        aria-disabled={disabled || undefined}
        disabled={disabled}
        title={title ?? selected?.label}
        className={['dsh-atb-sel', full ? 'dsh-atb-sel-full' : '', className].filter(Boolean).join(' ')}
        onClick={() => { if (open) close(true); else openList() }}
        onKeyDown={onKeyDown}
      >
        <span className="dsh-atb-sel-value">
          {selected !== undefined
            ? <>{selected.icon !== undefined && <span className="dsh-atb-sel-icon">{selected.icon}</span>}{selected.label}</>
            : <span className="dsh-atb-sel-placeholder">{placeholder ?? ''}</span>}
        </span>
        <span className="dsh-atb-sel-caret" aria-hidden="true" />
      </button>
      {open && placement !== undefined && createPortal(
        <div
          ref={popRef}
          id={listId}
          role="listbox"
          aria-label={ariaLabel}
          className="dsh-atb-sel-pop"
          style={{ left: placement.left, top: placement.top, width: placement.width }}
        >
          {options.map((option, index) => (
            <div
              key={option.value}
              id={`${listId}-opt-${index}`}
              role="option"
              // aria-selected reflects the COMMITTED value, not the keyboard
              // highlight: a screen reader must never announce a merely
              // hovered row as selected (data-active carries navigation).
              aria-selected={option.value === value}
              data-active={index === activeIndex}
              data-selected={option.value === value}
              data-disabled={option.disabled === true}
              className="dsh-atb-sel-opt"
              onPointerDown={event => event.preventDefault()}
              onPointerEnter={() => { if (!option.disabled) setActiveIndex(index) }}
              onClick={() => commit(index)}
            >
              <span className="dsh-atb-sel-check" aria-hidden="true">✓</span>
              {option.icon !== undefined && <span className="dsh-atb-sel-icon">{option.icon}</span>}
              <span className="dsh-atb-sel-label">{option.label}</span>
            </div>
          ))}
        </div>,
        document.body,
      )}
    </>
  )
}

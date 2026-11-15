/**
 * Mobile column tabs — the status rail that sits above the carousel.
 *
 * These are **not** filter chips: they are miniature column headers, mirroring
 * the desktop `.dsh-atb-colhead` language — a sober surface, one short status
 * rule at the top edge, a plain label and an integrated counter. The components
 * are the visual half only: the rail is still driven by the board (the tab is
 * derived from the carousel scroll position, and a tab press drives the rail),
 * so nothing about the sync lives here.
 *
 * Accessibility is owned here and must not regress:
 *  - the rail is a `tablist`, each tab a `tab` with `aria-selected`;
 *  - `aria-controls` points at the column panel id;
 *  - the tab stop is roving (only the active tab is in the Tab order), with
 *    ArrowLeft/ArrowRight/Home/End moving the selection.
 *
 * @module dsh-taskboard/client/board/MobileStatusTabs
 */
import type { MutableRefObject } from 'react'
import { MAIN_STATUSES, type TaskStatus } from '../../shared/protocol.ts'
import { useT } from '../i18n/runtime.ts'
import { COLUMN_KEYS } from './labels.ts'
import { statusAt, stepTabIndex } from './mobile.ts'

/** Props of {@link MobileStatusTabs}. */
export interface MobileStatusTabsProps {
  /** Status whose page is currently snapped into view. */
  active: TaskStatus
  /** Live (visible) task count per status. */
  countOf: (status: TaskStatus) => number
  /** Tab press: drives the carousel (never the other way round). */
  onSelect: (status: TaskStatus) => void
  /** The scrollable rail, used to keep the selected tab in view. */
  tabbarRef: MutableRefObject<HTMLElement | null>
}

/**
 * The five mobile column tabs, in workflow order.
 * @param props - active status, counts, selection callback and rail ref.
 */
export function MobileStatusTabs({ active, countOf, onSelect, tabbarRef }: MobileStatusTabsProps) {
  const t = useT()
  return (
    <nav
      className="dsh-atb-mobilebar"
      role="tablist"
      aria-label={t('board.columns.nav')}
      ref={node => { tabbarRef.current = node }}
    >
      {MAIN_STATUSES.map((status, index) => {
        const selected = status === active
        return (
          <button
            key={status}
            id={`dsh-atb-tab-${status}`}
            type="button"
            role="tab"
            className="dsh-atb-mobilebar-btn"
            data-status={status}
            data-active={selected ? 'true' : undefined}
            aria-selected={selected}
            aria-controls={`dsh-atb-col-${status}`}
            tabIndex={selected ? 0 : -1}
            title={t(COLUMN_KEYS[status])}
            onClick={() => onSelect(status)}
            onKeyDown={event => {
              const next = stepTabIndex(index, event.key)
              if (next === undefined || next === index) return
              event.preventDefault()
              const nextStatus = statusAt(next)
              onSelect(nextStatus)
              tabbarRef.current
                ?.querySelector<HTMLElement>(`.dsh-atb-mobilebar-btn[data-status="${nextStatus}"]`)
                ?.focus()
            }}
          >
            <span className="dsh-atb-mobilebar-label">{t(COLUMN_KEYS[status])}</span>
            <span className="dsh-atb-mobilebar-count">{countOf(status)}</span>
          </button>
        )
      })}
    </nav>
  )
}

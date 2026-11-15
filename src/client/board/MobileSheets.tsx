/**
 * Mobile focus-mode surfaces: the bottom sheets that keep every business
 * control reachable once the toolbar is compacted (filters, board actions) and
 * the generic sheet shell they share.
 *
 * These are plain DOM/React: no gesture handling lives here, so the sheets are
 * testable in jsdom and never touch the swipe carousel's scroll state.
 *
 * @module dsh-taskboard/client/board/MobileSheets
 */
import { useEffect, type ReactNode } from 'react'
import type { BoardController, ControllerState } from '../controller.ts'
import type { Urgency } from '../../shared/protocol.ts'
import { categoriesOf } from '../../shared/protocol.ts'
import { useT } from '../i18n/runtime.ts'
import { URGENCY_KEYS } from './labels.ts'
import { Icon } from './Icon.tsx'
import { Select } from './Select.tsx'
import { UNCLASSIFIED_FILTER } from './mobile.ts'

/** Filter-value sentinel meaning "no filter" (the Select cannot carry undefined). */
export const ALL_FILTER = ''

/** True when at least one filter differs from the default board view. */
export function hasActiveFilters(state: ControllerState, onlyNeedsHuman: boolean): boolean {
  return state.filters.workspaceId !== undefined
    || state.filters.categoryId !== undefined
    || state.filters.urgencies.length > 0
    || state.sortBy !== 'default'
    || onlyNeedsHuman
}

/** Clear every filter and sort back to the default board view. */
export function resetFilters(controller: BoardController, state: ControllerState): void {
  if (state.search.length > 0) controller.setSearch('')
  if (state.filters.workspaceId !== undefined) controller.setWorkspaceFilter(undefined)
  if (state.filters.categoryId !== undefined) controller.setCategoryFilter(undefined)
  if (state.sortBy !== 'default') controller.setSortBy('default')
  for (const urgency of state.filters.urgencies) controller.toggleUrgency(urgency)
}

/**
 * Bottom-sheet shell: same dialog semantics and backdrop as the board's
 * modals, anchored to the bottom edge on focused viewports by CSS.
 */
export function MobileSheet({
  title,
  subtitle,
  onClose,
  children,
  footer,
}: {
  title: string
  subtitle?: string
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
}) {
  const t = useT()
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        onClose()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div
      className="dsh-atb-modal-backdrop dsh-atb-sheet-layer"
      onClick={event => { if (event.target === event.currentTarget) onClose() }}
    >
      <div className="dsh-atb-modal dsh-atb-sheet" role="dialog" aria-modal="true" aria-label={title}>
        <div className="dsh-atb-sheet-handle" aria-hidden="true" />
        <div className="dsh-atb-modal-head">
          <div className="dsh-atb-modal-headtext">
            <h3>{title}</h3>
            {subtitle !== undefined && <p>{subtitle}</p>}
          </div>
          <button type="button" className="dsh-atb-modal-close" aria-label={t('shared.close')} onClick={onClose}>
            <Icon name="close" />
          </button>
        </div>
        <div className="dsh-atb-modal-body dsh-atb-sheet-body">{children}</div>
        {footer !== undefined && <div className="dsh-atb-modal-foot dsh-atb-sheet-foot">{footer}</div>}
      </div>
    </div>
  )
}

/**
 * Filters and sort, in one sheet: every control the desktop toolbar exposes
 * stays reachable on a phone, with the same live-apply semantics.
 */
export function MobileFiltersSheet({
  controller,
  state,
  onlyNeedsHuman,
  onToggleNeedsHuman,
  onClose,
}: {
  controller: BoardController
  state: ControllerState
  onlyNeedsHuman: boolean
  onToggleNeedsHuman: (next: boolean) => void
  onClose: () => void
}) {
  const t = useT()
  const categories = categoriesOf(state.ledger.settings)
  const urgencyOn = (urgency: Urgency): boolean => state.filters.urgencies.includes(urgency)

  return (
    <MobileSheet
      title={t('board.mobile.filters.title')}
      subtitle={t('board.mobile.filters.subtitle')}
      onClose={onClose}
      footer={(
        <>
          <button type="button" className="dsh-atb-btn" data-sheet-action="reset" onClick={() => resetFilters(controller, state)}>
            {t('board.mobile.filters.reset')}
          </button>
          <button type="button" className="dsh-atb-btn" data-primary="true" onClick={onClose}>
            {t('board.mobile.filters.done')}
          </button>
        </>
      )}
    >
      <label className="dsh-atb-sheet-field">
        <span className="dsh-atb-sheet-label">{t('board.filter.allProjects')}</span>
        <Select
          ariaLabel={t('board.filter.allProjects')}
          value={state.filters.workspaceId ?? ALL_FILTER}
          onChange={value => controller.setWorkspaceFilter(value === ALL_FILTER ? undefined : value)}
          options={[
            { value: ALL_FILTER, label: t('board.filter.allProjects') },
            ...state.workspaces.map(workspace => ({ value: workspace.id, label: workspace.title || workspace.path })),
          ]}
        />
      </label>
      <label className="dsh-atb-sheet-field">
        <span className="dsh-atb-sheet-label">{t('board.filter.allCategories')}</span>
        <Select
          ariaLabel={t('board.filter.allCategories')}
          value={state.filters.categoryId ?? ALL_FILTER}
          onChange={value => controller.setCategoryFilter(value === ALL_FILTER ? undefined : value)}
          options={[
            { value: ALL_FILTER, label: t('board.filter.allCategories') },
            ...categories.map(category => ({ value: category.id, label: category.name })),
            { value: UNCLASSIFIED_FILTER, label: t('category.unclassified') },
          ]}
        />
      </label>
      <label className="dsh-atb-sheet-field">
        <span className="dsh-atb-sheet-label">{t('board.sort.title')}</span>
        <Select
          ariaLabel={t('board.sort.title')}
          value={state.sortBy}
          onChange={value => controller.setSortBy(value as ControllerState['sortBy'])}
          options={[
            { value: 'default', label: t('board.sort.default') },
            { value: 'updated', label: t('board.sort.updated') },
            { value: 'urgency', label: t('board.sort.urgency') },
            { value: 'created', label: t('board.sort.created') },
            { value: 'title', label: t('board.sort.byTitle') },
          ]}
        />
      </label>
      <div className="dsh-atb-sheet-field">
        <span className="dsh-atb-sheet-label">{t('board.mobile.filters.priority')}</span>
        <div className="dsh-atb-sheet-chips">
          {(['urgent', 'normal', 'relaxed'] as const).map(urgency => (
            <button
              key={urgency}
              type="button"
              className="dsh-atb-chip"
              data-urgency={urgency}
              data-on={urgencyOn(urgency)}
              aria-pressed={urgencyOn(urgency)}
              onClick={() => controller.toggleUrgency(urgency)}
            >
              <span className="dsh-atb-dot" data-urgency={urgency} />
              {t(URGENCY_KEYS[urgency])}
            </button>
          ))}
        </div>
      </div>
      <div className="dsh-atb-sheet-field">
        <button
          type="button"
          className="dsh-atb-chip dsh-atb-sheet-human"
          data-kind="needs-human-filter"
          data-on={onlyNeedsHuman}
          aria-pressed={onlyNeedsHuman}
          onClick={() => onToggleNeedsHuman(!onlyNeedsHuman)}
        >
          <Icon name="hand" /> {t('board.filter.needsHuman')}
        </button>
      </div>
    </MobileSheet>
  )
}

/** One row of the mobile actions sheet. */
export interface MobileMenuItem {
  id: string
  label: string
  hint?: string
  icon: Parameters<typeof Icon>[0]['name']
  onSelect: () => void
  danger?: boolean
}

/**
 * Board actions that the desktop toolbar shows inline (other tasks, settings,
 * diagnostics, import/export) stay reachable in one sheet on a phone.
 */
export function MobileMenuSheet({
  items,
  onClose,
}: {
  items: readonly MobileMenuItem[]
  onClose: () => void
}) {
  const t = useT()
  return (
    <MobileSheet title={t('board.mobile.menu.title')} onClose={onClose}>
      <div className="dsh-atb-sheet-menu">
        {items.map(item => (
          <button
            key={item.id}
            type="button"
            className="dsh-atb-sheet-item"
            data-item={item.id}
            data-danger={item.danger === true ? 'true' : undefined}
            onClick={() => { onClose(); item.onSelect() }}
          >
            <span className="dsh-atb-sheet-item-icon"><Icon name={item.icon} /></span>
            <span className="dsh-atb-sheet-item-text">
              <span className="dsh-atb-sheet-item-label">{item.label}</span>
              {item.hint !== undefined && <span className="dsh-atb-sheet-item-hint">{item.hint}</span>}
            </span>
            <Icon name="chevronRight" size={12} />
          </button>
        ))}
      </div>
    </MobileSheet>
  )
}

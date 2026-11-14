/**
 * The main board view: toolbar (project filter, urgency chips, secondary tab,
 * composer), five status columns, the detail pane, and the new-task modal.
 *
 * @module dsh-taskboard/client/board/TaskBoard
 */
import { useEffect, useRef, useState, useSyncExternalStore, type CSSProperties } from 'react'
import type { BoardController, ControllerState } from '../controller.ts'
import type { TaskRecord, TaskStatus, Urgency } from '../../shared/protocol.ts'
import { MAIN_STATUSES, canTransition, completedDisplayLimitOf } from '../../shared/protocol.ts'
import { PLUGIN_VERSION } from '../../shared/version.ts'
import { COLUMN_KEYS, URGENCY_KEYS } from './labels.ts'
import { useT } from '../i18n/runtime.ts'
import { localizeBuiltinName, localizeBuiltinTask } from '../i18n/templates.ts'
import { categoryLabel, groupTemplatesByCategory } from '../template-categories.ts'
import { fmtTime, isStaleClaim } from './format.ts'
import { humanWaiting } from '../../shared/human-wait.ts'
import { DRAG_TYPE, TaskCard } from './TaskCard.tsx'
import { TaskDetail } from './TaskDetail.tsx'
import { TaskFormModal } from './TaskFormModal.tsx'
import { Icon } from './Icon.tsx'
import { SettingsModal } from './SettingsModal.tsx'
import { ImportModal } from './ImportModal.tsx'
import { TemplateManager } from './TemplateManager.tsx'
import { useAlert } from './AlertModal.tsx'
import { Select } from './Select.tsx'
import { resolveWorkspaceName as resolveWorkspaceNameBase } from './project-label.ts'
import { useAppearance, setAppearance, vibrancyOf } from './appearance.ts'
import { runClassification } from './classify.ts'
import { categoriesOf, categoryLabelMapOf } from '../../shared/protocol.ts'
import { MobileFiltersSheet, MobileMenuSheet, MobileSheet, hasActiveFilters, type MobileMenuItem } from './MobileSheets.tsx'
import {
  UNCLASSIFIED_FILTER,
  columnOffsets,
  indexAtScroll,
  indexOfStatus,
  pageLabel,
  scrollTarget,
  statusAt,
  stepTabIndex,
  useFocusMode,
} from './mobile.ts'

/** Urgency sort rank (urgent first). */
const URGENCY_RANK: Record<Urgency, number> = { urgent: 0, normal: 1, relaxed: 2 }

/** Apply the active filters + search + sort to a task list. */
export function filterTasks(state: ControllerState, tasks: TaskRecord[]): TaskRecord[] {
  const q = state.search.trim().toLowerCase()
  const filtered = tasks.filter(t =>
    (state.filters.workspaceId === undefined || t.workspaceId === state.filters.workspaceId)
    && (state.filters.urgencies.length === 0 || state.filters.urgencies.includes(t.urgency))
    // Category filter: the unclassified bucket matches tasks without a category.
    && (state.filters.categoryId === undefined
      || (state.filters.categoryId === UNCLASSIFIED_FILTER
        ? t.category === undefined
        : t.category === state.filters.categoryId))
    && (q.length === 0 || t.title.toLowerCase().includes(q) || t.id.toLowerCase().includes(q)))
  if (state.sortBy === 'default') return filtered
  const sorted = [...filtered]
  if (state.sortBy === 'updated') sorted.sort((a, b) => b.updatedAt - a.updatedAt)
  else if (state.sortBy === 'created') sorted.sort((a, b) => b.createdAt - a.createdAt)
  else if (state.sortBy === 'urgency') sorted.sort((a, b) => URGENCY_RANK[a.urgency] - URGENCY_RANK[b.urgency] || b.updatedAt - a.updatedAt)
  else if (state.sortBy === 'title') sorted.sort((a, b) => a.title.localeCompare(b.title, undefined, { numeric: true }))
  return sorted
}

/** Sort completed tasks newest-first by update/settle time (fallback to created time, then id). */
export function sortDoneTasks(tasks: TaskRecord[]): TaskRecord[] {
  return [...tasks].sort((a, b) => b.updatedAt - a.updatedAt || b.createdAt - a.createdAt || b.id.localeCompare(a.id))
}

export interface WorkspaceTaskGroup {
  workspaceId: string | undefined
  workspaceName: string
  tasks: TaskRecord[]
}

/**
 * Resolve display name for a workspace. Implemented in `project-label.ts` so
 * the card header and the project grouping can never disagree; re-exported
 * here because the board has always published it.
 */
export const resolveWorkspaceName = resolveWorkspaceNameBase

export type GroupSortOrder = 'name' | 'latestTask' | 'updated' | 'created' | 'urgency'

/** Group a list of tasks by workspace and sort the groups according to the given order. */
export function groupAndSortTasksByWorkspace(
  tasks: TaskRecord[],
  workspaces: Array<{ id: string; title?: string; path?: string }>,
  unassignedLabel: string,
  sortOrder: GroupSortOrder = 'name',
): WorkspaceTaskGroup[] {
  const map = new Map<string, WorkspaceTaskGroup>()

  for (const task of tasks) {
    const key = task.workspaceId || ''
    let group = map.get(key)
    if (group === undefined) {
      const name = resolveWorkspaceName(task.workspaceId, workspaces, unassignedLabel)
      group = {
        workspaceId: task.workspaceId,
        workspaceName: name,
        tasks: [],
      }
      map.set(key, group)
    }
    group.tasks.push(task)
  }

  const list = Array.from(map.values())

  // Ensure tasks inside each group are properly sorted according to sortOrder
  if (sortOrder === 'latestTask' || sortOrder === 'updated') {
    for (const group of list) {
      group.tasks.sort((a, b) => b.updatedAt - a.updatedAt || b.createdAt - a.createdAt || b.id.localeCompare(a.id))
    }
  } else if (sortOrder === 'created') {
    for (const group of list) {
      group.tasks.sort((a, b) => b.createdAt - a.createdAt || b.updatedAt - a.updatedAt || b.id.localeCompare(a.id))
    }
  }

  list.sort((a, b) => {
    if (sortOrder === 'latestTask' || sortOrder === 'updated') {
      const aTime = a.tasks.length > 0 ? Math.max(...a.tasks.map(t => t.updatedAt)) : 0
      const bTime = b.tasks.length > 0 ? Math.max(...b.tasks.map(t => t.updatedAt)) : 0
      if (bTime !== aTime) return bTime - aTime
      if (!a.workspaceId && b.workspaceId) return 1
      if (a.workspaceId && !b.workspaceId) return -1
      return a.workspaceName.localeCompare(b.workspaceName, undefined, { numeric: true, sensitivity: 'base' })
    }

    if (sortOrder === 'created') {
      const aTime = a.tasks.length > 0 ? Math.max(...a.tasks.map(t => t.createdAt)) : 0
      const bTime = b.tasks.length > 0 ? Math.max(...b.tasks.map(t => t.createdAt)) : 0
      if (bTime !== aTime) return bTime - aTime
      if (!a.workspaceId && b.workspaceId) return 1
      if (a.workspaceId && !b.workspaceId) return -1
      return a.workspaceName.localeCompare(b.workspaceName, undefined, { numeric: true, sensitivity: 'base' })
    }

    if (sortOrder === 'urgency') {
      const aRank = a.tasks.length > 0 ? Math.min(...a.tasks.map(t => URGENCY_RANK[t.urgency])) : 999
      const bRank = b.tasks.length > 0 ? Math.min(...b.tasks.map(t => URGENCY_RANK[t.urgency])) : 999
      if (aRank !== bRank) return aRank - bRank
      const aTime = a.tasks.length > 0 ? Math.max(...a.tasks.map(t => t.updatedAt)) : 0
      const bTime = b.tasks.length > 0 ? Math.max(...b.tasks.map(t => t.updatedAt)) : 0
      if (bTime !== aTime) return bTime - aTime
      if (!a.workspaceId && b.workspaceId) return 1
      if (a.workspaceId && !b.workspaceId) return -1
      return a.workspaceName.localeCompare(b.workspaceName, undefined, { numeric: true, sensitivity: 'base' })
    }

    // Default 'name' sort: alphabetical by workspace name, unassigned pinned to the bottom
    if (!a.workspaceId && b.workspaceId) return 1
    if (a.workspaceId && !b.workspaceId) return -1
    return a.workspaceName.localeCompare(b.workspaceName, undefined, { numeric: true, sensitivity: 'base' })
  })

  return list
}

/**
 * The board view root.
 * @param controller - the controller.
 */
export function TaskBoard({ controller }: { controller: BoardController }) {
  const t = useT()
  const appearance = useAppearance()
  const categories = categoriesOf(controller.getSnapshot().ledger.settings)
  const state = useSyncExternalStore(
    cb => controller.subscribe(cb),
    () => controller.getSnapshot(),
  )
  // Minute ticker: re-renders stale-claim highlights even without ledger changes.
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000)
    return () => clearInterval(timer)
  }, [])
  const [onlyNeedsHuman, setOnlyNeedsHuman] = useState(false)
  const allLive = filterTasks(state, state.ledger.tasks.filter(t => t.trashedAt === undefined))
  const needsHumanCount = allLive.filter(task => humanWaiting(task).needs).length
  const live = onlyNeedsHuman ? allLive.filter(task => humanWaiting(task).needs) : allLive
  // "Colour by category" is only meaningful once tasks have categories. On a
  // board whose tasks are all unclassified the surfaces are neutral by design,
  // which reads as "everything is grey": offer the explicit migration instead
  // of silently reclassifying anything.
  const categorizedCount = allLive.filter(task => task.category !== undefined).length
  const [classifyProgress, setClassifyProgress] = useState<{ done: number; total: number } | undefined>()
  const classifyExisting = (): void => {
    if (classifyProgress !== undefined) return
    setClassifyProgress({ done: 0, total: 0 })
    void runClassification(controller, {
      categories: categoriesOf(controller.getSnapshot().ledger.settings),
      labelMap: categoryLabelMapOf(controller.getSnapshot().ledger.settings),
      onProgress: (done, total) => setClassifyProgress({ done, total }),
    }).then(result => {
      setClassifyProgress(undefined)
      if (result.classified === 0 && result.failed === 0) {
        showAlert(t('classification.none'))
        return
      }
      showAlert(t('classification.result', { classified: result.classified, failed: result.failed }))
    }).catch(error => {
      setClassifyProgress(undefined)
      showAlert(error instanceof Error ? error.message : String(error))
    })
  }
  const selected = state.selectedId === undefined ? undefined : state.ledger.tasks.find(t => t.id === state.selectedId)
  const detailPanelRef = useRef<HTMLDivElement>(null)

  // Click-outside-to-dismiss: clicking outside the detail panel deselects the task.
  useEffect(() => {
    if (selected === undefined) return

    const onPointerDown = (e: PointerEvent | MouseEvent): void => {
      const panel = detailPanelRef.current
      if (panel === null) return

      const target = e.target as HTMLElement | null
      if (target === null) return

      // Inside detail panel: never dismiss
      if (panel.contains(target)) return

      // Clicking another task card: let card's onClick handle selection switch directly
      if (target.closest('.dsh-atb-card')) return

      // Modals, dropdown menus, context menus: keep existing modal behaviors untouched
      if (target.closest('.dsh-atb-modal, .dsh-atb-modal-backdrop, .dsh-atb-newmenu-backdrop, .dsh-atb-newmenu, .dsh-atb-dropdown, .dsh-atb-btn-menu')) return

      controller.select(undefined)
    }

    document.addEventListener('pointerdown', onPointerDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
    }
  }, [selected, controller])
  const { alert: showAlert, el: alertEl } = useAlert()
  // + 新建任务 ▼ dropdown (0.4.0): blank / templates / manage / import.
  const [newMenuOpen, setNewMenuOpen] = useState(false)
  const closeMenu = (): void => setNewMenuOpen(false)
  // ⬇ 导出 ▼ dropdown (0.5.1): whole-ledger JSON backup or task-list CSV.
  const [exportOpen, setExportOpen] = useState(false)
  const closeExport = (): void => setExportOpen(false)
  // Fold/expand toggle for completed tasks (0.8.8)
  const [doneExpanded, setDoneExpanded] = useState(false)
  /* ---------------------------------------------------------------------
     Mobile focus mode: the five columns become one native, snap-scrolled
     carousel (one page in portrait, two in phone landscape) and the status
     tabs above it are two-way bound to the rail. The rail is the single
     source of truth for scroll position; the tab is derived from it, and an
     explicit tab click drives the rail with a short lock so the smooth
     scroll it starts cannot bounce the selection back.
     ------------------------------------------------------------------- */
  const focus = useFocusMode()
  const [activeStatus, setActiveStatus] = useState<TaskStatus>('todo')
  const railRef = useRef<HTMLDivElement | null>(null)
  const tabbarRef = useRef<HTMLElement | null>(null)
  /** The status a tab click is scrolling to; scroll events are ignored meanwhile. */
  const explicitStatusRef = useRef<TaskStatus | null>(null)
  const explicitTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const activeStatusRef = useRef<TaskStatus>(activeStatus)
  const [searchOpen, setSearchOpen] = useState(false)
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)

  useEffect(() => {
    activeStatusRef.current = activeStatus
  }, [activeStatus])

  /** Scroll the rail so the chosen status starts at the left edge. */
  const scrollRailTo = (status: TaskStatus, behavior: ScrollBehavior): void => {
    const rail = railRef.current
    if (rail === null) return
    const offsets = columnOffsets(rail)
    const maxScroll = Math.max(0, rail.scrollWidth - rail.clientWidth)
    const left = scrollTarget(offsets, indexOfStatus(status), maxScroll)
    if (typeof rail.scrollTo === 'function') rail.scrollTo({ left, behavior })
    else rail.scrollLeft = left
  }

  /** Keep the selected tab visible inside the (also scrollable) tab rail. */
  const centerTab = (status: TaskStatus): void => {
    const bar = tabbarRef.current
    if (bar === null) return
    const tab = bar.querySelector<HTMLElement>(`.dsh-atb-mobilebar-btn[data-status="${status}"]`)
    if (tab === null) return
    const left = Math.max(0, tab.offsetLeft - bar.offsetLeft + tab.offsetWidth / 2 - bar.clientWidth / 2)
    if (typeof bar.scrollTo === 'function') bar.scrollTo({ left, behavior: 'smooth' })
    else bar.scrollLeft = left
  }

  /** Explicit status selection: tab click or arrow key. */
  const selectStatus = (status: TaskStatus): void => {
    if (explicitTimerRef.current !== undefined) clearTimeout(explicitTimerRef.current)
    explicitStatusRef.current = status
    explicitTimerRef.current = setTimeout(() => { explicitStatusRef.current = null }, 1000)
    setActiveStatus(status)
    const reduce = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
    scrollRailTo(status, reduce ? 'auto' : 'smooth')
  }

  // Swipe → tab: derive the visible column from the rail's scroll position.
  // Re-attached when the rail remounts (secondary view), never per render.
  useEffect(() => {
    if (!focus.focus || state.secondaryOpen) return
    const rail = railRef.current
    if (rail === null) return
    const onScroll = (): void => {
      if (explicitStatusRef.current !== null) return
      const offsets = columnOffsets(rail)
      const maxScroll = Math.max(0, rail.scrollWidth - rail.clientWidth)
      const next = statusAt(indexAtScroll(offsets, rail.scrollLeft, { maxScroll, twoUp: focus.twoUp }))
      setActiveStatus(previous => (previous === next ? previous : next))
    }
    rail.addEventListener('scroll', onScroll, { passive: true })
    return () => rail.removeEventListener('scroll', onScroll)
  }, [focus.focus, focus.twoUp, state.secondaryOpen])

  // Entering focus mode (or rotating): put the rail where the tabs say it is,
  // without animation. `activeStatus` is read through a ref on purpose: a
  // swipe must not be re-snapped by this effect while it is in flight.
  useEffect(() => {
    if (!focus.focus) return
    scrollRailTo(activeStatusRef.current, 'auto')
  }, [focus.focus, focus.twoUp])

  // Keep the selected tab in view (a swipe moves the selection, not the bar).
  useEffect(() => {
    if (focus.focus) centerTab(activeStatus)
  }, [activeStatus, focus.focus])

  useEffect(() => () => {
    if (explicitTimerRef.current !== undefined) clearTimeout(explicitTimerRef.current)
  }, [])

  const searchVisible = !focus.focus || searchOpen || state.search.length > 0
  const filtersActive = hasActiveFilters(state, onlyNeedsHuman)
  const menuItems: MobileMenuItem[] = [
    {
      id: 'group',
      label: appearance.group ? t('board.mobile.menu.ungroup') : t('board.mobile.menu.group'),
      icon: 'folder',
      onSelect: () => setAppearance({ group: !appearance.group }),
    },
    {
      id: 'secondary',
      label: state.secondaryOpen ? t('board.action.backToBoard') : t('board.action.otherTasks'),
      icon: 'checklist',
      onSelect: () => controller.toggleSecondary(),
    },
    { id: 'settings', label: t('board.action.settings'), hint: t('board.action.settingsTitle'), icon: 'settings', onSelect: () => controller.openSettings() },
    { id: 'diagnostics', label: t('board.action.diag'), hint: t('board.action.diagTitle'), icon: 'diagnostics', onSelect: () => controller.openDiagnostics() },
    { id: 'import', label: t('board.action.import'), hint: t('board.action.importTitle'), icon: 'import', onSelect: () => controller.openImport() },
    { id: 'export-json', label: t('board.export.json'), hint: t('board.action.exportTitle'), icon: 'export', onSelect: () => { void controller.exportJson() } },
    { id: 'export-csv', label: t('board.export.csv'), hint: t('board.action.exportTitle'), icon: 'export', onSelect: () => { void controller.exportCsv() } },
  ]

  return (
    <div
      className="dsh-atb-board"
      data-atb-density={appearance.density}
      data-atb-descriptions={appearance.descriptions ? 'true' : 'false'}
      data-atb-group={appearance.group ? 'true' : 'false'}
      data-atb-color-mode={appearance.colorMode}
      data-atb-intensity={appearance.intensity}
      data-atb-focus={focus.focus ? (focus.twoUp ? 'landscape' : 'portrait') : 'none'}
      data-atb-search={searchVisible ? 'true' : 'false'}
      data-atb-active-status={activeStatus}
      data-atb-filters={filtersActive ? 'true' : 'false'}
      style={{ '--atb-vibrancy': vibrancyOf(appearance) } as CSSProperties}
    >
      <div className="dsh-atb-head">
        <h2 className="dsh-atb-title">{t('board.title')}</h2>
        <span className="dsh-atb-count">{t('board.count.tasks', { n: live.length, rev: state.ledger.revision })}</span>
        <div className="dsh-atb-spacer" />
        {/* Focus-mode actions: the desktop toolbar is compacted into these
            three buttons plus one bottom sheet each. Hidden above 760px. */}
        <div className="dsh-atb-mobileactions">
          <button
            type="button"
            className="dsh-atb-iconbtn"
            data-action="search"
            aria-label={t('board.mobile.search')}
            aria-expanded={searchVisible}
            data-on={searchVisible ? 'true' : undefined}
            onClick={() => {
              const next = !searchVisible
              setSearchOpen(next)
              if (!next && state.search.length > 0) controller.setSearch('')
            }}
          >
            <Icon name="search" />
          </button>
          <button
            type="button"
            className="dsh-atb-iconbtn"
            data-action="filters"
            aria-label={t('board.mobile.filters')}
            aria-haspopup="dialog"
            data-on={filtersActive ? 'true' : undefined}
            onClick={() => setFiltersOpen(true)}
          >
            <Icon name="filter" />
          </button>
          <button
            type="button"
            className="dsh-atb-iconbtn"
            data-action="menu"
            aria-label={t('board.mobile.more')}
            aria-haspopup="dialog"
            onClick={() => setMenuOpen(true)}
          >
            <Icon name="menu" />
          </button>
        </div>
        <button
          type="button"
          className="dsh-atb-btn dsh-atb-grouptoggle"
          aria-pressed={appearance.group}
          title={t('appearance.group.title')}
          onClick={() => setAppearance({ group: !appearance.group })}
        >
          <Icon name="folder" />
          <span className="dsh-atb-grouptoggle-label">{t('appearance.group')}</span>
        </button>
        <div className="dsh-atb-newmenu">
          <button
            type="button"
            className="dsh-atb-btn"
            data-primary="true"
            onClick={() => {
              const next = !newMenuOpen
              setNewMenuOpen(next)
              if (next) controller.prepareTemplateMenu()
            }}
          >
            <Icon name="plus" />
            <span className="dsh-atb-newmenu-label">{t('board.action.newTask')}</span>
            <span className="dsh-atb-newmenu-caret"><Icon name="chevronDown" /></span>
          </button>
          {newMenuOpen && !focus.focus && (
            <>
              <div className="dsh-atb-newmenu-backdrop" onClick={closeMenu} />
              <div className="dsh-atb-newmenu-list">
                <button type="button" className="dsh-atb-newmenu-opt" onClick={() => { closeMenu(); controller.setComposer(true) }}>{t('board.action.blankTask')}</button>
                {groupTemplatesByCategory(state.templates).map(group => (
                  <div key={group.category ?? '\u0000'} className="dsh-atb-newmenu-catgroup">
                    <div className="dsh-atb-newmenu-cat">{categoryLabel(group.category, t)} ({group.templates.length})</div>
                    {group.templates.map(tpl => {
                      const name = localizeBuiltinName(tpl)
                      const spec = localizeBuiltinTask(tpl)
                      return (
                        <button
                          key={tpl.id}
                          type="button"
                          className="dsh-atb-newmenu-opt"
                          title={spec.description !== undefined && spec.description.length > 0 ? spec.description.slice(0, 120) : name}
                          onClick={() => { closeMenu(); controller.newFromTemplate(spec) }}
                        >
                          {name}
                        </button>
                      )
                    })}
                  </div>
                ))}
                <div className="dsh-atb-newmenu-sep" />
                <button type="button" className="dsh-atb-newmenu-opt" onClick={() => { closeMenu(); controller.openTemplateManager() }}>{t('board.action.manageTemplates')}</button>
              </div>
            </>
          )}
        </div>
      </div>

      <div className="dsh-atb-toolbar">
        <label className="dsh-atb-searchfield">
          <Icon name="search" />
          <input
            className="dsh-atb-search"
            value={state.search}
            placeholder={t('board.search.placeholder')}
            aria-label={t('board.search.placeholder')}
            spellCheck={false}
            onChange={e => controller.setSearch(e.target.value)}
          />
        </label>
        {/* Desktop filter cluster: `display: contents` keeps these children
            direct toolbar flex items above 760px, and the mobile sheet below. */}
        <div className="dsh-atb-toolbar-filters">
        <Select
          ariaLabel={t('board.filter.allProjects')}
          value={state.filters.workspaceId ?? ''}
          onChange={v => controller.setWorkspaceFilter(v === '' ? undefined : v)}
          options={[
            { value: '', label: t('board.filter.allProjects') },
            ...state.workspaces.map(ws => ({ value: ws.id, label: ws.title || ws.path })),
          ]}
        />
        <Select
          ariaLabel={t('board.filter.allCategories')}
          title={t('board.filter.allCategories')}
          value={state.filters.categoryId ?? ''}
          onChange={v => controller.setCategoryFilter(v === '' ? undefined : v)}
          options={[
            { value: '', label: t('board.filter.allCategories') },
            ...categories.map(category => ({ value: category.id, label: category.name })),
            { value: UNCLASSIFIED_FILTER, label: t('category.unclassified') },
          ]}
        />
        <Select
          ariaLabel={t('board.sort.title')}
          title={t('board.sort.title')}
          value={state.sortBy}
          onChange={v => controller.setSortBy(v as typeof state.sortBy)}
          options={[
            { value: 'default', label: t('board.sort.default') },
            { value: 'updated', label: t('board.sort.updated') },
            { value: 'urgency', label: t('board.sort.urgency') },
            { value: 'created', label: t('board.sort.created') },
            { value: 'title', label: t('board.sort.byTitle') },
          ]}
        />
        <span className="dsh-atb-toolbar-divider" aria-hidden="true" />
        {(['urgent', 'normal', 'relaxed'] as const).map(u => (
          <button
            key={u}
            type="button"
            className="dsh-atb-chip"
            data-urgency={u}
            data-on={state.filters.urgencies.includes(u)}
            onClick={() => controller.toggleUrgency(u)}
          >
            <span className="dsh-atb-dot" data-urgency={u} />
            {t(URGENCY_KEYS[u])}
          </button>
        ))}
        <button
          type="button"
          className="dsh-atb-chip"
          data-kind="needs-human-filter"
          data-on={onlyNeedsHuman}
          aria-pressed={onlyNeedsHuman}
          style={onlyNeedsHuman ? { background: "#f59e0b", color: "#fff", borderColor: "#d97706", fontWeight: 600 } : undefined}
          title={t("board.filter.needsHumanTitle")}
          onClick={() => {
            if (!onlyNeedsHuman && state.secondaryOpen) controller.toggleSecondary()
            setOnlyNeedsHuman(!onlyNeedsHuman)
          }}
        >
          <Icon name="hand" /> {t("board.filter.needsHuman")} {needsHumanCount > 0 ? `(${needsHumanCount})` : ""}
        </button>
        </div>
        <div className="dsh-atb-spacer" />
        {/* Desktop action cluster, mirrored by the mobile actions sheet. */}
        <div className="dsh-atb-toolbar-actions">
        <button type="button" className="dsh-atb-btn" onClick={() => controller.toggleSecondary()}>
          {state.secondaryOpen ? t('board.action.backToBoard') : t('board.action.otherTasks')}
        </button>
        <button type="button" className="dsh-atb-btn" data-action="appearance" title={t('board.action.settingsTitle')} onClick={() => controller.openSettings()}><Icon name="settings" /> {t('board.action.settings')}</button>
        <button type="button" className="dsh-atb-btn" title={t('board.action.diagTitle')} onClick={() => controller.openDiagnostics()}><Icon name="diagnostics" /> {t('board.action.diag')}</button>
        <button type="button" className="dsh-atb-btn" title={t('board.action.importTitle')} onClick={() => controller.openImport()}><Icon name="import" /> {t('board.action.import')}</button>
        <div className="dsh-atb-newmenu">
          <button
            type="button"
            className="dsh-atb-btn"
            title={t('board.action.exportTitle')}
            onClick={() => setExportOpen(!exportOpen)}
          >
            <Icon name="export" /> {t('board.action.export')} <Icon name="chevronDown" />
          </button>
          {exportOpen && (
            <>
              <div className="dsh-atb-newmenu-backdrop" onClick={closeExport} />
              <div className="dsh-atb-newmenu-list">
                <button
                  type="button"
                  className="dsh-atb-newmenu-opt"
                  title={t('board.export.jsonTitle')}
                  onClick={() => { closeExport(); void controller.exportJson() }}
                >
                  {t('board.export.json')}
                </button>
                <button
                  type="button"
                  className="dsh-atb-newmenu-opt"
                  title={t('board.export.csvTitle')}
                  onClick={() => { closeExport(); void controller.exportCsv() }}
                >
                  {t('board.export.csv')}
                </button>
              </div>
            </>
          )}
        </div>
        <a
          className="dsh-atb-ver"
          href="https://github.com/cloader/dsh-taskboard"
          target="_blank"
          rel="noopener noreferrer"
        >
          V{PLUGIN_VERSION}
        </a>
        </div>
      </div>

      {state.error !== undefined && <div className="dsh-atb-error">{state.error}</div>}

      {!state.secondaryOpen && appearance.colorMode === 'category' && allLive.length > 0 && categorizedCount === 0 && (
        <div className="dsh-atb-classifyhint" role="status">
          <Icon name="checklist" size={16} />
          <div className="dsh-atb-classifyhint-text">
            <span className="dsh-atb-classifyhint-title">{t('board.category.hint.title')}</span>
            <span className="dsh-atb-classifyhint-body">{t('board.category.hint.body', { n: allLive.length })}</span>
          </div>
          <span className="dsh-atb-classifyhint-actions">
            <button
              type="button"
              className="dsh-atb-btn"
              data-primary="true"
              disabled={classifyProgress !== undefined}
              onClick={classifyExisting}
            >
              {classifyProgress === undefined
                ? t('board.category.hint.classify')
                : t('board.category.hint.classifying', { done: classifyProgress.done, total: classifyProgress.total })}
            </button>
            <button type="button" className="dsh-atb-btn" onClick={() => setAppearance({ colorMode: 'priority' })}>
              {t('board.category.hint.usePriority')}
            </button>
          </span>
        </div>
      )}

      {state.secondaryOpen
        ? <SecondaryTab controller={controller} tasks={filterTasks(state, state.ledger.tasks)} />
        : (
          <div className="dsh-atb-board-body">
            <div className="dsh-atb-mobilehead">
              <nav
                className="dsh-atb-mobilebar"
                role="tablist"
                aria-label={t('board.columns.nav')}
                ref={tabbarRef}
              >
                {MAIN_STATUSES.map((status, index) => {
                  const selected = status === activeStatus
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
                      onClick={() => selectStatus(status)}
                      onKeyDown={event => {
                        const next = stepTabIndex(index, event.key)
                        if (next === undefined || next === index) return
                        event.preventDefault()
                        const nextStatus = statusAt(next)
                        selectStatus(nextStatus)
                        tabbarRef.current
                          ?.querySelector<HTMLElement>(`.dsh-atb-mobilebar-btn[data-status="${nextStatus}"]`)
                          ?.focus()
                      }}
                    >
                      <span className="dsh-atb-dot" data-status={status} aria-hidden="true" />
                      <span className="dsh-atb-mobilebar-label">{t(COLUMN_KEYS[status])}</span>
                      <span className="dsh-atb-mobilebar-count">
                        {live.filter(task => task.status === status).length}
                      </span>
                    </button>
                  )
                })}
              </nav>
              <span className="dsh-atb-swipecue" aria-hidden="true">
                <span className="dsh-atb-swipecue-arrow">←</span>
                <span className="dsh-atb-swipecue-label">{t('board.swipe.cue')}</span>
                <span className="dsh-atb-swipecue-arrow">→</span>
                <strong className="dsh-atb-swipecue-page">{pageLabel(indexOfStatus(activeStatus))}</strong>
              </span>
            </div>
            <div className="dsh-atb-columns" ref={railRef}>
            {MAIN_STATUSES.map(status => {
              const rawColumnTasks = live.filter(t => t.status === status)
              const isBacklog = status === 'backlog'
              const isTodo = status === 'todo'
              const isDone = status === 'done'
              const columnTasks = isDone && state.sortBy !== 'title'
                ? sortDoneTasks(rawColumnTasks)
                : rawColumnTasks

              const onDragOver = (e: React.DragEvent<HTMLElement>) => {
                if (e.dataTransfer.types.includes(DRAG_TYPE)) {
                  e.preventDefault()
                  e.dataTransfer.dropEffect = 'move'
                  e.currentTarget.dataset.dragover = 'true'
                }
              }
              const onDragLeave = (e: React.DragEvent<HTMLElement>) => {
                delete e.currentTarget.dataset.dragover
              }
              const onDrop = (e: React.DragEvent<HTMLElement>) => {
                e.preventDefault()
                delete e.currentTarget.dataset.dragover
                const id = e.dataTransfer.getData(DRAG_TYPE)
                if (id.length === 0) return
                const task = state.ledger.tasks.find(t => t.id === id)
                if (task === undefined || task.status === status) return
                if (!canTransition(task.status, status)) {
                  showAlert(t('board.drag.forbidden', { from: t(COLUMN_KEYS[task.status]), to: t(COLUMN_KEYS[status]) }))
                  return
                }
                void controller.move(id, task.version, status)
              }

              // In focus mode every column is a full page of the carousel:
              // folding one to a 42px sliver would break the page rhythm and
              // strand the swipe, so the fold state is a desktop-only view.
              const isCollapsed = !focus.focus && ((isBacklog && state.backlogCollapsed)
                || (isTodo && state.todoCollapsed)
                || (isDone && state.doneCollapsed))
              if (isCollapsed) {
                const expandTitle = isBacklog ? t('board.column.expandBacklog')
                  : isTodo ? t('board.column.expandTodo')
                  : t('board.column.expandDone')
                const onExpand = () => {
                  if (isBacklog) controller.setBacklogCollapsed(false)
                  else if (isTodo) controller.setTodoCollapsed(false)
                  else controller.setDoneCollapsed(false)
                }
                const count = isDone ? (state.doneCount ?? columnTasks.length) : columnTasks.length

                return (
                  <div
                    className="dsh-atb-column"
                    key={status}
                    id={`dsh-atb-col-${status}`}
                    data-status={status}
                    data-collapsed="true"
                    onDragOver={onDragOver}
                    onDragLeave={onDragLeave}
                    onDrop={onDrop}
                  >
                    <div
                      className="dsh-atb-col-collapsed-bar"
                      title={expandTitle}
                      onClick={onExpand}
                    >
                      <button
                        type="button"
                        className="dsh-atb-colfoldbtn"
                        title={expandTitle} aria-label={expandTitle}
                        onClick={(e) => {
                          e.stopPropagation()
                          onExpand()
                        }}
                      >
                        <svg viewBox="0 0 16 16" width="12" height="12" fill="currentColor">
                          <path d="M6 3.5a.5.5 0 0 1 .854-.354l4 4a.5.5 0 0 1 0 .708l-4 4A.5.5 0 0 1 6 11.5v-8z" />
                        </svg>
                      </button>
                      <div className="dsh-atb-col-collapsed-title">
                        <span className="dsh-atb-dot" data-status={status} />
                        <span className="dsh-atb-col-collapsed-text">{t(COLUMN_KEYS[status])}</span>
                      </div>
                      <span className="dsh-atb-colcount">{count}</span>
                    </div>
                  </div>
                )
              }

              const doneLimit = completedDisplayLimitOf(state.ledger.settings)
              const isSearching = state.search.trim().length > 0
              const isFolded = isDone && !isSearching && !doneExpanded && columnTasks.length > doneLimit
              const visibleTasks = isFolded ? columnTasks.slice(0, doneLimit) : columnTasks
              const foldedCount = columnTasks.length - visibleTasks.length
              const groupSortOrder: GroupSortOrder = isDone
                ? (state.sortBy === 'title' ? 'name' : 'latestTask')
                : (state.sortBy === 'updated' ? 'updated'
                    : state.sortBy === 'created' ? 'created'
                    : state.sortBy === 'urgency' ? 'urgency'
                    : 'name')
              const workspaceGroups = groupAndSortTasksByWorkspace(
                visibleTasks,
                state.workspaces,
                t('board.workspace.unassigned'),
                groupSortOrder,
              )

              return (
                <div
                  className="dsh-atb-column"
                  key={status}
                  id={`dsh-atb-col-${status}`}
                  data-status={status}
                  role="tabpanel"
                  aria-labelledby={`dsh-atb-tab-${status}`}
                  onDragOver={onDragOver}
                  onDragLeave={onDragLeave}
                  onDrop={onDrop}
                >
                  <div className="dsh-atb-colhead">
                    <span className="dsh-atb-dot" data-status={status} />
                    {t(COLUMN_KEYS[status])}
                    <span className="dsh-atb-colcount">{columnTasks.length}</span>
                    {status === 'in_progress' && (
                      <button
                        type="button"
                        className="dsh-atb-queuechip"
                        title={t('queue.panel.title')}
                        data-bad={(state.queue?.depth ?? 0) > 0 ? 'true' : undefined}
                        onClick={() => controller.openQueuePanel()}
                      >{t('board.queue.chip', { n: state.queue?.depth ?? 0 })}</button>
                    )}
                    {isBacklog && !focus.focus && (
                      <button
                        type="button"
                        className="dsh-atb-colfoldbtn"
                        title={t('board.column.collapseBacklog')} aria-label={t('board.column.collapseBacklog')}
                        onClick={() => controller.setBacklogCollapsed(true)}
                      >
                        <svg viewBox="0 0 16 16" width="12" height="12" fill="currentColor">
                          <path d="M10 3.5a.5.5 0 0 0-.854-.354l-4 4a.5.5 0 0 0 0 .708l4 4a.5.5 0 0 0 .854-.354v-8z" />
                        </svg>
                      </button>
                    )}
                    {isTodo && !focus.focus && (
                      <button
                        type="button"
                        className="dsh-atb-colfoldbtn"
                        title={t('board.column.collapseTodo')} aria-label={t('board.column.collapseTodo')}
                        onClick={() => controller.setTodoCollapsed(true)}
                      >
                        <svg viewBox="0 0 16 16" width="12" height="12" fill="currentColor">
                          <path d="M10 3.5a.5.5 0 0 0-.854-.354l-4 4a.5.5 0 0 0 0 .708l4 4a.5.5 0 0 0 .854-.354v-8z" />
                        </svg>
                      </button>
                    )}
                    {isDone && !focus.focus && (
                      <button
                        type="button"
                        className="dsh-atb-colfoldbtn"
                        title={t('board.column.collapseDone')} aria-label={t('board.column.collapseDone')}
                        onClick={() => controller.setDoneCollapsed(true)}
                      >
                        <svg viewBox="0 0 16 16" width="12" height="12" fill="currentColor">
                          <path d="M10 3.5a.5.5 0 0 0-.854-.354l-4 4a.5.5 0 0 0 0 .708l4 4a.5.5 0 0 0 .854-.354v-8z" />
                        </svg>
                      </button>
                    )}
                  </div>
                  <div className="dsh-atb-cards">
                    {appearance.group
                      ? workspaceGroups.map(group => (
                        <div className="dsh-atb-ws-group" key={group.workspaceId ?? 'unassigned'}>
                          <button type="button" className="dsh-atb-ws-group-head"
                            aria-expanded={!controller.isWorkspaceGroupCollapsed(status, group.workspaceId)}
                            aria-label={t(controller.isWorkspaceGroupCollapsed(status, group.workspaceId) ? 'board.workspace.expand' : 'board.workspace.collapse', { name: group.workspaceName })}
                            title={group.workspaceName}
                            onClick={() => controller.toggleWorkspaceGroup(status, group.workspaceId)}>
                            <span className="dsh-atb-ws-group-chevron"><Icon name="chevronRight" size={12} /></span>
                            <span className="dsh-atb-ws-group-icon">
                              <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                <path d="M1.5 3.5a1 1 0 0 1 1-1h3.5a1 1 0 0 1 .8.4L8 4.5h5.5a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1v-8z" />
                              </svg>
                            </span>
                            <span className="dsh-atb-ws-group-name">{group.workspaceName}</span>
                            <span className="dsh-atb-ws-group-count">{group.tasks.length}</span>
                          </button>
                          <div className="dsh-atb-ws-group-cards" hidden={controller.isWorkspaceGroupCollapsed(status, group.workspaceId)}>
                            {group.tasks.map(task => (
                              <TaskCard
                                key={task.id}
                                task={task}
                                controller={controller}
                                draggable={!focus.focus}
                                now={now}
                                onAlert={showAlert}
                              />
                            ))}
                          </div>
                        </div>
                      ))
                      : (
                        <div className="dsh-atb-ws-group-cards">
                          {visibleTasks.map(task => (
                            <TaskCard
                              key={task.id}
                              task={task}
                              controller={controller}
                              draggable={!focus.focus}
                              now={now}
                              onAlert={showAlert}
                            />
                          ))}
                        </div>
                      )}
                    {columnTasks.length === 0 && (
                      <div className="dsh-atb-empty">
                        <Icon name="checklist" size={22} />
                        <span className="dsh-atb-empty-title">{t('board.empty')}</span>
                      </div>
                    )}
                    {isDone && !isSearching && columnTasks.length > doneLimit && (
                      <div className="dsh-atb-done-foldbar">
                        {!doneExpanded ? (
                          <>
                            <span className="dsh-atb-done-foldtip">{t('board.done.folded', { n: foldedCount })}</span>
                            <button
                              type="button"
                              className="dsh-atb-btn dsh-atb-done-foldbtn"
                              onClick={() => setDoneExpanded(true)}
                            >
                              {t('board.done.expandAll')}
                            </button>
                          </>
                        ) : (
                          <button
                            type="button"
                            className="dsh-atb-btn dsh-atb-done-foldbtn"
                            onClick={() => setDoneExpanded(false)}
                          >
                            {t('board.done.collapse')}
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
            </div>
          </div>
        )}

      {selected !== undefined && (
        <div ref={detailPanelRef} className="dsh-atb-detailpanel">
          {/* key: remount per task — without it, confirm states and comment
              drafts leak across task switches (review P0). */}
          <TaskDetail key={selected.id} task={selected} controller={controller} now={now} />
        </div>
      )}

      {state.composerOpen && (
        <TaskFormModal
          controller={controller}
          task={state.editingId === undefined ? undefined : state.ledger.tasks.find(t => t.id === state.editingId)}
        />
      )}

      {state.diagOpen && <DiagnosticsPanel controller={controller} />}

      {state.queueOpen && <QueuePanel controller={controller} onAlert={showAlert} />}

      {state.settingsOpen && <SettingsModal controller={controller} />}

      {state.importOpen && <ImportModal controller={controller} />}

      {state.tplManagerOpen && <TemplateManager controller={controller} />}

      {/* Focus mode: one primary creation affordance, and the compacted
          toolbar's controls in bottom sheets. */}
      {focus.focus && !state.secondaryOpen && !state.composerOpen && (
        <button
          type="button"
          className="dsh-atb-fab"
          aria-label={t('board.action.newTask')}
          title={t('board.action.newTask')}
          onClick={() => { setNewMenuOpen(true); controller.prepareTemplateMenu() }}
        >
          <Icon name="plus" size={22} />
        </button>
      )}

      {newMenuOpen && focus.focus && (
        <MobileSheet title={t('board.action.newTask')} onClose={closeMenu}>
          <div className="dsh-atb-newmenu-list dsh-atb-newmenu-list-sheet">
            <button type="button" className="dsh-atb-newmenu-opt" onClick={() => { closeMenu(); controller.setComposer(true) }}>{t('board.action.blankTask')}</button>
            {groupTemplatesByCategory(state.templates).map(group => (
              <div key={group.category ?? '\u0000'} className="dsh-atb-newmenu-catgroup">
                <div className="dsh-atb-newmenu-cat">{categoryLabel(group.category, t)} ({group.templates.length})</div>
                {group.templates.map(tpl => {
                  const name = localizeBuiltinName(tpl)
                  const spec = localizeBuiltinTask(tpl)
                  return (
                    <button
                      key={tpl.id}
                      type="button"
                      className="dsh-atb-newmenu-opt"
                      onClick={() => { closeMenu(); controller.newFromTemplate(spec) }}
                    >
                      {name}
                    </button>
                  )
                })}
              </div>
            ))}
            <div className="dsh-atb-newmenu-sep" />
            <button type="button" className="dsh-atb-newmenu-opt" onClick={() => { closeMenu(); controller.openTemplateManager() }}>{t('board.action.manageTemplates')}</button>
          </div>
        </MobileSheet>
      )}

      {filtersOpen && (
        <MobileFiltersSheet
          controller={controller}
          state={state}
          onlyNeedsHuman={onlyNeedsHuman}
          onToggleNeedsHuman={next => {
            if (next && state.secondaryOpen) controller.toggleSecondary()
            setOnlyNeedsHuman(next)
          }}
          onClose={() => setFiltersOpen(false)}
        />
      )}

      {menuOpen && <MobileMenuSheet items={menuItems} onClose={() => setMenuOpen(false)} />}

      {alertEl}
    </div>
  )
}

/** 📋 Execution-queue popup (in-progress column chip): depth, oldest wait, and a
 *  double-confirm "clear queue" that drops every durable queue entry. */
function QueuePanel({ controller, onAlert }: { controller: BoardController; onAlert: (msg: string) => void }) {
  const t = useT()
  const state = controller.getSnapshot()
  const queue = state.queue
  const [armed, setArmed] = useState(false)
  const [busy, setBusy] = useState(false)
  const depth = queue?.depth ?? 0
  const wait = queue?.oldestWaitMinutes
  const clear = async (): Promise<void> => {
    if (!armed) { setArmed(true); return }
    setBusy(true)
    const result = await controller.clearQueue()
    setBusy(false)
    setArmed(false)
    if (result !== undefined) {
      onAlert(t('queue.cleared', { n: result.cleared }))
      controller.closeQueuePanel()
    }
  }
  return (
    <div className="dsh-atb-modal-backdrop" onClick={e => { if (e.target === e.currentTarget) controller.closeQueuePanel() }}>
      <div className="dsh-atb-modal dsh-atb-queuepanel" role="dialog" aria-modal="true" aria-label={t('queue.panel.title')}>
        <div className="dsh-atb-modal-head">
          <span className="dsh-atb-modal-headicon"><Icon name="clock" /></span>
          <div className="dsh-atb-modal-headtext">
            <h3>{t('queue.panel.title')}</h3>
          </div>
          <button type="button" className="dsh-atb-modal-close" aria-label={t('shared.close')} onClick={() => controller.closeQueuePanel()}><Icon name="close" /></button>
        </div>
        <div className="dsh-atb-modal-body">
          <div className="dsh-atb-diag-grid">
            <div className="dsh-atb-diag-item" data-bad={depth > 0 ? 'true' : undefined}><b>{depth}</b><span>{t('queue.depth')}</span></div>
            <div className="dsh-atb-diag-item" data-bad={wait !== undefined && wait > 5 ? 'true' : undefined}><b>{wait ?? 0}m</b><span>{t('queue.wait')}</span></div>
          </div>
          <div className="dsh-atb-queuepanel-actions">
            <button
              type="button"
              className="dsh-atb-btn"
              disabled={depth === 0 || busy}
              data-armed={armed ? 'true' : undefined}
              onClick={() => { void clear() }}
            >{armed ? t('queue.confirm') : t('queue.clear')}</button>
          </div>
        </div>
      </div>
    </div>
  )
}

/** ⚙ Health-diagnostics panel (plan §3.6): ledger basics + orphan worktrees + one-click cleanup. */
function DiagnosticsPanel({ controller }: { controller: BoardController }) {
  const t = useT()
  const state = controller.getSnapshot()
  const diag = state.diagnostics
  const wsName = (id: string): string => {
    const ws = state.workspaces.find(w => w.id === id)
    return ws?.title ?? ws?.path ?? id.slice(0, 8)
  }
  return (
    <div className="dsh-atb-modal-backdrop" onClick={e => { if (e.target === e.currentTarget) controller.closeDiagnostics() }}>
      <div className="dsh-atb-modal dsh-atb-diag" role="dialog" aria-modal="true" aria-label={t('diag.title')}>
        <div className="dsh-atb-modal-head">
          <span className="dsh-atb-modal-headicon"><Icon name="diagnostics" /></span>
          <div className="dsh-atb-modal-headtext">
            <h3>{t('diag.title')}</h3>
            <p>{t('diag.subtitle')}</p>
          </div>
          <button type="button" className="dsh-atb-modal-close" aria-label={t('shared.close')} onClick={() => controller.closeDiagnostics()}><Icon name="close" /></button>
        </div>
        <div className="dsh-atb-modal-body">
          {diag === undefined
            ? <div className="dsh-atb-empty2">{t('shared.loading')}</div>
            : (
              <>
                <div className="dsh-atb-diag-grid">
                  <div className="dsh-atb-diag-item"><b>{diag.revision}</b><span>{t('diag.revision')}</span></div>
                  <div className="dsh-atb-diag-item"><b>{diag.tasks}</b><span>{t('diag.tasks')}</span></div>
                  <div className="dsh-atb-diag-item" data-bad={diag.staleRunning > 0 ? 'true' : undefined}><b>{diag.staleRunning}</b><span>{t('diag.running')}</span></div>
                  <div className="dsh-atb-diag-item" data-bad={diag.orphanWorktrees.length > 0 ? 'true' : undefined}><b>{diag.orphanWorktrees.length}</b><span>{t('diag.orphans')}</span></div>
                </div>
                <div className="dsh-atb-diag-sec">
                  <h4>{t('diag.orphans.heading')}</h4>
                  {diag.orphanWorktrees.length === 0
                    ? <div className="dsh-atb-empty2">{t('diag.orphans.none')}</div>
                    : (
                        <div className="dsh-atb-diag-orphans">
                          {diag.orphanWorktrees.map(o => (
                            <div key={o.path} className="dsh-atb-diag-orphan">
                              <span className="dsh-atb-diag-orphan-path" title={o.path}>{wsName(o.workspaceId)} · {o.taskId}</span>
                              <button type="button" className="dsh-atb-btn" data-danger="true" onClick={() => void controller.cleanupOrphan(o.workspaceId, o.taskId)}>{t('diag.orphans.cleanup')}</button>
                            </div>
                          ))}
                        </div>
                      )}
                  <div className="dsh-atb-empty2">{t('diag.orphans.hint')}</div>
                </div>
                <div className="dsh-atb-diag-sec">
                  <h4>{t('diag.gitignore.heading')}</h4>
                  {(diag.gitIgnoreSuggestions ?? []).length === 0
                    ? <div className="dsh-atb-empty2">{t('diag.gitignore.none')}</div>
                    : (
                        <div className="dsh-atb-diag-orphans">
                          {diag.gitIgnoreSuggestions.map(s => (
                            <div key={s.workspaceId} className="dsh-atb-diag-orphan">
                              <span className="dsh-atb-diag-orphan-path" title={s.workspacePath}>
                                {wsName(s.workspaceId)} · {t('diag.gitignore.suggestA')} <code>.dsh-worktrees/</code>{t('diag.gitignore.suggestB')}
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                </div>
              </>
            )}
        </div>
      </div>
    </div>
  )
}

/** Secondary tab: tasks grouped into canceled / archived / trashed columns. */
function SecondaryTab({ controller, tasks }: { controller: BoardController; tasks: TaskRecord[] }) {
  const t = useT()
  /** Which column is in card-selection mode ('none' = checkboxes hidden everywhere). */
  const [selecting, setSelecting] = useState<'none' | 'trashArchived' | 'purgeTrashed'>('none')
  const [batchBusy, setBatchBusy] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(() => new Set())
  // Trashed takes precedence (a trashed task still carries its old status,
  // but what matters to the user is the pending purge).
  const trashed = tasks.filter(t => t.trashedAt !== undefined)
  const archived = tasks.filter(t => t.trashedAt === undefined && t.status === 'archived')
  const canceled = tasks.filter(t => t.trashedAt === undefined && t.status === 'canceled')

  const toggleSelected = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  /** Select-all toggle for one column: if everything is selected, clear the column; otherwise add all. */
  const toggleAll = (rows: TaskRecord[]) => {
    setSelected(prev => {
      const allSelected = rows.length > 0 && rows.every(r => prev.has(r.id))
      const next = new Set(prev)
      for (const r of rows) {
        if (allSelected) next.delete(r.id)
        else next.add(r.id)
      }
      return next
    })
  }

  /** Run a batch action on the selected tasks of the column; failures are skipped one by one. */
  const runBatch = async (kind: 'trashArchived' | 'purgeTrashed') => {
    const source = kind === 'trashArchived' ? archived : trashed
    const targets = source.filter(task => selected.has(task.id))
    setBatchBusy(true)
    try {
      for (const task of targets) {
        try { await controller.remove(task.id, task.version, kind === 'purgeTrashed') } catch { /* skip stale/conflicting/purge-refused card */ }
        setSelected(prev => {
          const next = new Set(prev)
          next.delete(task.id)
          return next
        })
      }
    } finally {
      setBatchBusy(false)
      setSelecting('none')
      setSelected(new Set())
    }
  }

  /** Exit selection mode and drop the current selection. */
  const cancelSelecting = () => {
    setSelecting('none')
    setSelected(new Set())
  }

  const groups: { label: string; dot: string; rows: TaskRecord[]; action?: 'trashArchived' | 'purgeTrashed' }[] = [
    { label: t('status.column.canceled'), dot: 'canceled', rows: canceled },
    { label: t('status.column.archived'), dot: 'archived', rows: archived, action: 'trashArchived' },
    { label: t('board.group.trashed'), dot: 'trashed', rows: trashed, action: 'purgeTrashed' },
  ]
  if (trashed.length + archived.length + canceled.length === 0) {
    return (
      <div className="dsh-atb-secondary">
        <div className="dsh-atb-empty">{t('board.secondary.empty')}</div>
      </div>
    )
  }
  return (
    <div className="dsh-atb-columns">
      {groups.map(group => {
        const selectingThis = selecting === group.action
        const selectedCount = selectingThis ? group.rows.filter(r => selected.has(r.id)).length : 0
        const allSelected = group.rows.length > 0 && selectedCount === group.rows.length
        return (
        <div className="dsh-atb-column" key={group.label}>
          <div className="dsh-atb-colhead">
            <span className="dsh-atb-dot" data-status={group.dot} />
            {group.label}
            <span className="dsh-atb-colcount">{group.rows.length}</span>
            {group.action && group.rows.length > 0 && (
              selectingThis ? (
                <>
                  <button
                    type="button"
                    className="dsh-atb-btn"
                    disabled={batchBusy}
                    title={t('board.batch.confirmCancelTip')}
                    onClick={cancelSelecting}
                  >{t('board.batch.cancel')}</button>
                  <button
                    type="button"
                    className="dsh-atb-btn"
                    data-danger="true"
                    disabled={batchBusy || selectedCount === 0}
                    title={selectedCount === 0 ? t('board.batch.noneSelected') : t('board.batch.confirmTip')}
                    onClick={() => { void runBatch(group.action!) }}
                  >{t('board.batch.confirm')}({selectedCount})</button>
                  <input
                    type="checkbox"
                    className="dsh-atb-selectall"
                    checked={allSelected}
                    disabled={batchBusy}
                    title={t('board.batch.selectAll')}
                    onClick={e => e.stopPropagation()}
                    onChange={() => toggleAll(group.rows)}
                  />
                </>
              ) : (
                <button
                  type="button"
                  className="dsh-atb-btn"
                  disabled={batchBusy}
                  title={group.action === 'trashArchived' ? t('board.batch.trashArchivedTip') : t('board.batch.purgeTrashedTip')}
                  onClick={() => { setSelecting(group.action!); setSelected(new Set()) }}
                >{group.action === 'trashArchived' ? t('board.batch.trashArchived') : t('board.batch.purgeTrashed')}</button>
              )
            )}
          </div>
          <div className="dsh-atb-cards">
            {(() => {
              const secSortBy = controller.getSnapshot().sortBy
              const secGroupSortOrder: GroupSortOrder = secSortBy === 'updated' ? 'updated'
                : secSortBy === 'created' ? 'created'
                : secSortBy === 'urgency' ? 'urgency'
                : 'name'
              return groupAndSortTasksByWorkspace(
                group.rows,
                controller.getSnapshot().workspaces,
                t('board.workspace.unassigned'),
                secGroupSortOrder,
              )
            })().map(wsGroup => (
              <div className="dsh-atb-ws-group" key={wsGroup.workspaceId ?? 'unassigned'}>
                <button type="button" className="dsh-atb-ws-group-head"
                          aria-expanded={!controller.isWorkspaceGroupCollapsed(group.dot, wsGroup.workspaceId)}
                          aria-label={t(controller.isWorkspaceGroupCollapsed(group.dot, wsGroup.workspaceId) ? 'board.workspace.expand' : 'board.workspace.collapse', { name: wsGroup.workspaceName })}
                          title={wsGroup.workspaceName}
                          onClick={() => controller.toggleWorkspaceGroup(group.dot, wsGroup.workspaceId)}>
                          <span className="dsh-atb-ws-group-chevron"><Icon name="chevronRight" size={12} /></span>
                  <span className="dsh-atb-ws-group-icon">
                    <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M1.5 3.5a1 1 0 0 1 1-1h3.5a1 1 0 0 1 .8.4L8 4.5h5.5a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1v-8z" />
                    </svg>
                  </span>
                  <span className="dsh-atb-ws-group-name">{wsGroup.workspaceName}</span>
                  <span className="dsh-atb-ws-group-count">{wsGroup.tasks.length}</span>
                </button>
                <div className="dsh-atb-ws-group-cards" hidden={controller.isWorkspaceGroupCollapsed(group.dot, wsGroup.workspaceId)}>
                  {wsGroup.tasks.map(task => (
                    group.action && selectingThis ? (
                      <div className="dsh-atb-selrow" key={task.id}>
                        <input
                          type="checkbox"
                          className="dsh-atb-selbox"
                          checked={selected.has(task.id)}
                          disabled={batchBusy}
                          onClick={e => e.stopPropagation()}
                          onChange={() => toggleSelected(task.id)}
                        />
                        <TaskCard task={task} controller={controller} />
                      </div>
                    ) : (
                      <TaskCard key={task.id} task={task} controller={controller} />
                    )
                  ))}
                </div>
              </div>
            ))}
            {group.rows.length === 0 && <div className="dsh-atb-empty">{t('board.empty')}</div>}
          </div>
        </div>
        )
      })}
    </div>
  )
}


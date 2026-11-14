// @vitest-environment jsdom
/**
 * Mobile focus mode — board behaviour.
 *
 * Three promises are asserted here, on the real components:
 *  1. the status tabs and the carousel are two-way bound (swipe → tab,
 *     tab → rail, arrow keys, end-of-rail in the two-up layout);
 *  2. the compacted mobile toolbar keeps every business control reachable
 *     (filters, grouping, actions, creation) through bottom sheets;
 *  3. a touch pan never opens a task, while a tap keeps doing exactly what it
 *     did before, and desktop keeps its five-column, draggable board.
 *
 * @module dsh-taskboard/tests/mobile-focus-ui
 */
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BoardController } from '../src/client/controller.ts'
import { TaskBoard } from '../src/client/board/TaskBoard.tsx'
import { TaskCard, SWIPE_TAP_SLOP, SWIPE_TAP_WINDOW_MS } from '../src/client/board/TaskCard.tsx'
import { disposeI18n } from '../src/client/i18n/runtime.ts'
import { resetAppearance, setAppearance, defaultAppearance } from '../src/client/board/appearance.ts'
import { MAIN_STATUSES, type TaskRecord } from '../src/shared/protocol.ts'
import { waitFor } from './wait-for.ts'

const cleanups: Array<() => void> = []
const roots: Root[] = []

/** Restore the jsdom viewport between tests. */
const REAL_WIDTH = window.innerWidth
const REAL_HEIGHT = window.innerHeight

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  localStorage.clear()
  resetAppearance()
})

afterEach(() => {
  for (const root of roots.splice(0).reverse()) root.unmount()
  for (const cleanup of cleanups.splice(0).reverse()) cleanup()
  disposeI18n()
  localStorage.clear()
  resetAppearance()
  setViewport(REAL_WIDTH, REAL_HEIGHT)
  document.body.replaceChildren()
})

/**
 * Move the viewport. jsdom has no layout and no `matchMedia`, so the focus
 * hook falls back to these numbers exactly like it does in a real webview.
 */
function setViewport(width: number, height: number): void {
  Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: width })
  Object.defineProperty(window, 'innerHeight', { configurable: true, writable: true, value: height })
  window.dispatchEvent(new Event('resize'))
}

/** Minimal live task; only the fields the board actually reads. */
function makeTask(overrides: Partial<TaskRecord> & { id: string }): TaskRecord {
  return {
    title: overrides.id,
    description: '',
    prompt: '',
    workspaceId: 'ws-a',
    urgency: 'normal',
    status: 'todo',
    blocked: false,
    execution: { mode: 'claim' },
    version: 1,
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
    createdBy: { kind: 'user' },
    updatedBy: { kind: 'user' },
    comments: [],
    executions: [],
    ...overrides,
  } as TaskRecord
}

function makeController(tasks: TaskRecord[]): BoardController {
  const controller = new BoardController({
    state: async () => ({ schemaVersion: 1, revision: 1, tasks }),
    workspaces: async () => [{ id: 'ws-a', title: 'Ravum' }, { id: 'ws-b', title: 'Unifia' }],
    templates: async () => ({ templates: [] }),
    stream: () => () => {},
  } as never)
  cleanups.push(() => controller.dispose())
  return controller
}

function render(element: React.ReactElement): HTMLElement {
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  roots.push(root)
  root.render(element)
  return host
}

const board = (host: HTMLElement): HTMLElement => host.querySelector<HTMLElement>('.dsh-atb-board')!
const tabOf = (host: HTMLElement, status: string): HTMLButtonElement =>
  host.querySelector<HTMLButtonElement>(`.dsh-atb-mobilebar-btn[data-status="${status}"]`)!
const pageOf = (host: HTMLElement): string =>
  host.querySelector<HTMLElement>('.dsh-atb-swipecue-page')?.textContent ?? ''

/** A stubbed rail: real columns, injected geometry, a recording scrollTo. */
interface RailStub {
  rail: HTMLElement
  scrollTo: ReturnType<typeof vi.fn>
  /** Simulate the finger settling on page `index` (fires the scroll event). */
  settleOn: (index: number) => Promise<void>
}

function stubRail(host: HTMLElement, pageWidth: number, viewportWidth: number): RailStub {
  const rail = host.querySelector<HTMLElement>('.dsh-atb-columns')!
  const columns = [...rail.querySelectorAll<HTMLElement>('.dsh-atb-column[data-status]')]
  expect(columns).toHaveLength(MAIN_STATUSES.length)
  columns.forEach((column, index) => {
    Object.defineProperty(column, 'offsetLeft', { configurable: true, value: index * pageWidth })
    Object.defineProperty(column, 'offsetWidth', { configurable: true, value: pageWidth })
  })
  Object.defineProperty(rail, 'clientWidth', { configurable: true, value: viewportWidth })
  Object.defineProperty(rail, 'scrollWidth', { configurable: true, value: pageWidth * columns.length })
  Object.defineProperty(rail, 'scrollLeft', { configurable: true, writable: true, value: 0 })
  const scrollTo = vi.fn()
  Object.defineProperty(rail, 'scrollTo', { configurable: true, value: scrollTo })
  return {
    rail,
    scrollTo,
    settleOn: async (index: number) => {
      await act(async () => {
        rail.scrollLeft = index * pageWidth
        rail.dispatchEvent(new Event('scroll'))
      })
    },
  }
}

/** Render the board in a given viewport and wait for the columns + effects. */
async function renderBoard(tasks: TaskRecord[], width: number, height: number): Promise<{ host: HTMLElement, controller: BoardController }> {
  setViewport(width, height)
  const controller = makeController(tasks)
  const host = render(React.createElement(TaskBoard, { controller }))
  controller.start()
  await waitFor(() => host.querySelectorAll('.dsh-atb-column[data-status]').length === MAIN_STATUSES.length)
  // Flush the passive effects (scroll sync, initial snap) before any geometry
  // is stubbed or any gesture is simulated.
  await act(async () => {})
  return { host, controller }
}

const THREE_TASKS = [
  makeTask({ id: 't-backlog', title: 'Backlog one', status: 'backlog' }),
  makeTask({ id: 't-todo', title: 'To do one', status: 'todo' }),
  makeTask({ id: 't-review', title: 'Review one', status: 'in_review' }),
]

describe('status tabs ⇄ carousel', () => {
  it('swiping the rail selects the status tab and updates the page counter', async () => {
    const { host } = await renderBoard(THREE_TASKS, 390, 844)
    expect(board(host).dataset.atbFocus).toBe('portrait')
    expect(board(host).dataset.atbActiveStatus).toBe('todo')
    const rail = stubRail(host, 390, 390)

    await rail.settleOn(2)
    expect(board(host).dataset.atbActiveStatus).toBe('in_progress')
    expect(tabOf(host, 'in_progress').getAttribute('aria-selected')).toBe('true')
    expect(tabOf(host, 'in_progress').tabIndex).toBe(0)
    expect(tabOf(host, 'todo').getAttribute('aria-selected')).toBe('false')
    expect(tabOf(host, 'todo').tabIndex).toBe(-1)
    expect(pageOf(host)).toBe('3/5')

    await rail.settleOn(4)
    expect(board(host).dataset.atbActiveStatus).toBe('done')
    expect(pageOf(host)).toBe('5/5')
  })

  it('clicking a tab scrolls the rail to that page and keeps the selection', async () => {
    const { host } = await renderBoard(THREE_TASKS, 390, 844)
    const stub = stubRail(host, 390, 390)

    await act(async () => { tabOf(host, 'done').click() })
    expect(stub.scrollTo).toHaveBeenLastCalledWith({ left: 1560, behavior: 'smooth' })
    expect(board(host).dataset.atbActiveStatus).toBe('done')

    // The smooth scroll the click started emits intermediate scroll events;
    // they must not bounce the selection back to a column it passes over.
    await stub.settleOn(1)
    expect(board(host).dataset.atbActiveStatus).toBe('done')
  })

  it('renders each tab as a compact column head with an integrated counter', async () => {
    const { host } = await renderBoard([
      makeTask({ id: 'a', status: 'todo' }),
      makeTask({ id: 'b', status: 'todo' }),
      makeTask({ id: 'c', status: 'done' }),
    ], 390, 844)
    for (const status of MAIN_STATUSES) {
      const tab = tabOf(host, status)
      // A column head, never a filter chip.
      expect(tab.classList.contains('dsh-atb-mobilebar-btn'), status).toBe(true)
      expect(tab.classList.contains('dsh-atb-chip'), status).toBe(false)
      const label = tab.querySelector('.dsh-atb-mobilebar-label')
      const count = tab.querySelector('.dsh-atb-mobilebar-count')
      expect(label?.textContent?.length, status).toBeGreaterThan(0)
      expect(count, status).not.toBeNull()
      // The colour marker is the top rule drawn by the stylesheet, so no dot
      // chip competes with it inside the tab.
      expect(tab.querySelector('.dsh-atb-dot'), status).toBeNull()
    }
    expect(tabOf(host, 'todo').querySelector('.dsh-atb-mobilebar-count')?.textContent).toBe('2')
    expect(tabOf(host, 'done').querySelector('.dsh-atb-mobilebar-count')?.textContent).toBe('1')
    expect(tabOf(host, 'backlog').querySelector('.dsh-atb-mobilebar-count')?.textContent).toBe('0')
    // Exactly one tab wears the active surface, and it follows the carousel.
    expect(host.querySelectorAll('.dsh-atb-mobilebar-btn[data-active="true"]')).toHaveLength(1)
    expect(tabOf(host, 'todo').getAttribute('data-active')).toBe('true')
    const rail = stubRail(host, 390, 390)
    await rail.settleOn(4)
    expect(tabOf(host, 'done').getAttribute('data-active')).toBe('true')
    expect(tabOf(host, 'todo').getAttribute('data-active')).toBeNull()
    expect(host.querySelectorAll('.dsh-atb-mobilebar-btn[data-active="true"]')).toHaveLength(1)
  })

  it('keeps the tab orientation explicit for assistive technology', async () => {
    const { host } = await renderBoard(THREE_TASKS, 390, 844)
    const rail = host.querySelector<HTMLElement>('.dsh-atb-mobilebar')!
    expect(rail.getAttribute('role')).toBe('tablist')
    expect(host.querySelectorAll('.dsh-atb-mobilebar-btn[role="tab"]')).toHaveLength(MAIN_STATUSES.length)
    for (const status of MAIN_STATUSES) {
      const tab = tabOf(host, status)
      expect(tab.getAttribute('aria-controls')).toBe(`dsh-atb-col-${status}`)
      const column = host.querySelector<HTMLElement>(`#dsh-atb-col-${status}`)!
      expect(column).not.toBeNull()
      expect(column.getAttribute('role')).toBe('tabpanel')
      expect(column.getAttribute('aria-labelledby')).toBe(`dsh-atb-tab-${status}`)
    }
  })

  it('moves the roving tab stop with ArrowRight / ArrowLeft / Home / End', async () => {
    const { host } = await renderBoard(THREE_TASKS, 390, 844)
    const stub = stubRail(host, 390, 390)
    tabOf(host, 'todo').focus()

    await act(async () => {
      tabOf(host, 'todo').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
    })
    expect(board(host).dataset.atbActiveStatus).toBe('in_progress')
    expect(document.activeElement).toBe(tabOf(host, 'in_progress'))
    expect(stub.scrollTo).toHaveBeenLastCalledWith({ left: 780, behavior: 'smooth' })

    await act(async () => {
      tabOf(host, 'in_progress').dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }))
    })
    expect(board(host).dataset.atbActiveStatus).toBe('done')

    await act(async () => {
      tabOf(host, 'done').dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }))
    })
    expect(board(host).dataset.atbActiveStatus).toBe('backlog')

    // ArrowLeft at the first tab stays put (no wrap-around).
    await act(async () => {
      tabOf(host, 'backlog').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }))
    })
    expect(board(host).dataset.atbActiveStatus).toBe('backlog')
  })

  it('reports the last status when the two-up landscape rail reaches its end', async () => {
    const { host } = await renderBoard(THREE_TASKS, 844, 390)
    expect(board(host).dataset.atbFocus).toBe('landscape')
    const stub = stubRail(host, 417, 844)

    // Mid-rail: nearest page.
    await stub.settleOn(2)
    expect(board(host).dataset.atbActiveStatus).toBe('in_progress')

    // Tail of the rail: Done can never be the leftmost column two-up, so the
    // last page reports the last status instead of the leftmost visible one.
    await act(async () => {
      stub.rail.scrollLeft = 417 * 5 - 844
      stub.rail.dispatchEvent(new Event('scroll'))
    })
    expect(board(host).dataset.atbActiveStatus).toBe('done')
  })

  it('snaps the rail to the selected tab when the viewport becomes focused', async () => {
    const { host } = await renderBoard(THREE_TASKS, 1280, 800)
    expect(board(host).dataset.atbFocus).toBe('none')
    const stub = stubRail(host, 390, 390)

    await act(async () => { setViewport(390, 844) })
    expect(board(host).dataset.atbFocus).toBe('portrait')
    // Initial status is To do (index 1): one page in, without animation.
    expect(stub.scrollTo).toHaveBeenLastCalledWith({ left: 390, behavior: 'auto' })
  })
})

describe('compact mobile toolbar', () => {
  it('exposes search, filters and actions as icon buttons, plus one create button', async () => {
    const { host } = await renderBoard(THREE_TASKS, 390, 844)
    expect(host.querySelector('[data-action="search"]')).not.toBeNull()
    expect(host.querySelector('[data-action="filters"]')).not.toBeNull()
    expect(host.querySelector('[data-action="menu"]')).not.toBeNull()
    expect(host.querySelector('.dsh-atb-fab')).not.toBeNull()
    // The toolbar itself stays in the DOM (the sheet mirrors it); CSS hides it.
    expect(host.querySelector('.dsh-atb-toolbar-filters')).not.toBeNull()
    expect(host.querySelector('.dsh-atb-toolbar-actions')).not.toBeNull()
    expect(board(host).dataset.atbSearch).toBe('false')
    // Nothing is filtered by default.
    expect(board(host).dataset.atbFilters).toBe('false')
  })

  it('opens the filters sheet and resets every condition through it', async () => {
    const { host, controller } = await renderBoard(THREE_TASKS, 390, 844)
    await act(async () => {
      controller.setSortBy('urgency')
      controller.setSearch('review')
      controller.toggleUrgency('urgent')
    })
    expect(board(host).dataset.atbFilters).toBe('true')

    await act(async () => { host.querySelector<HTMLButtonElement>('[data-action="filters"]')!.click() })
    const sheet = host.querySelector<HTMLElement>('.dsh-atb-sheet')!
    expect(sheet).not.toBeNull()
    expect(sheet.getAttribute('role')).toBe('dialog')
    // Every desktop filter control is present in the sheet.
    expect(sheet.querySelectorAll('.dsh-atb-sel').length).toBe(3)
    expect(sheet.querySelectorAll('.dsh-atb-chip[data-urgency]').length).toBe(3)
    expect(sheet.querySelector('[data-kind="needs-human-filter"]')).not.toBeNull()

    await act(async () => { sheet.querySelector<HTMLButtonElement>('[data-sheet-action="reset"]')!.click() })
    expect(controller.getSnapshot().sortBy).toBe('default')
    expect(controller.getSnapshot().search).toBe('')
    expect(controller.getSnapshot().filters.urgencies).toEqual([])
    expect(board(host).dataset.atbFilters).toBe('false')
  })

  it('keeps grouping and every board action reachable from the actions sheet', async () => {
    const { host } = await renderBoard(THREE_TASKS, 390, 844)
    await act(async () => { host.querySelector<HTMLButtonElement>('[data-action="menu"]')!.click() })
    const items = [...host.querySelectorAll<HTMLButtonElement>('.dsh-atb-sheet-item')]
    expect(items.map(item => item.dataset.item)).toEqual(['group', 'secondary', 'settings', 'diagnostics', 'import', 'export-json', 'export-csv'])

    // Grouping is a real view toggle, not a lost control.
    expect(board(host).dataset.atbGroup).toBe('true')
    await act(async () => { items[0]!.click() })
    expect(board(host).dataset.atbGroup).toBe('false')
    expect(host.querySelector('.dsh-atb-sheet')).toBeNull()
  })

  it('creates a task from the floating action button', async () => {
    const { host, controller } = await renderBoard(THREE_TASKS, 390, 844)
    await act(async () => { host.querySelector<HTMLButtonElement>('.dsh-atb-fab')!.click() })
    const sheet = host.querySelector<HTMLElement>('.dsh-atb-sheet')!
    expect(sheet.querySelector('.dsh-atb-newmenu-list-sheet')).not.toBeNull()
    // The blank-task option is the first entry of the shared template menu.
    await act(async () => { sheet.querySelector<HTMLButtonElement>('.dsh-atb-newmenu-opt')!.click() })
    expect(controller.getSnapshot().composerOpen).toBe(true)
  })

  it('closes a sheet with Escape and with a backdrop click', async () => {
    const { host } = await renderBoard(THREE_TASKS, 390, 844)
    await act(async () => { host.querySelector<HTMLButtonElement>('[data-action="menu"]')!.click() })
    await act(async () => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })) })
    expect(host.querySelector('.dsh-atb-sheet')).toBeNull()

    await act(async () => { host.querySelector<HTMLButtonElement>('[data-action="menu"]')!.click() })
    const layer = host.querySelector<HTMLElement>('.dsh-atb-sheet-layer')!
    await act(async () => { layer.click() })
    expect(host.querySelector('.dsh-atb-sheet')).toBeNull()
  })
})

describe('preserved behaviour on a focused viewport', () => {
  it('expands folded columns so every page is a full column', async () => {
    const { host, controller } = await renderBoard(THREE_TASKS, 390, 844)
    await act(async () => { controller.setDoneCollapsed(true) })
    expect(host.querySelector('.dsh-atb-column[data-collapsed="true"]')).toBeNull()
    // The fold button is a desktop affordance: gone on a phone.
    expect(host.querySelector('.dsh-atb-colfoldbtn')).toBeNull()
    // Five full pages regardless.
    expect(host.querySelectorAll('.dsh-atb-column[data-status]')).toHaveLength(MAIN_STATUSES.length)
  })

  it('disables HTML5 drag on touch, keeps it on desktop', async () => {
    const phone = await renderBoard(THREE_TASKS, 390, 844)
    const phoneCard = phone.host.querySelector<HTMLElement>('.dsh-atb-card')!
    expect(phoneCard.getAttribute('draggable')).toBe('false')

    const desktop = await renderBoard(THREE_TASKS, 1280, 800)
    const desktopCard = desktop.host.querySelector<HTMLElement>('.dsh-atb-card')!
    expect(desktopCard.getAttribute('draggable')).toBe('true')
  })

  it('keeps the desktop board on five side-by-side columns with no create FAB', async () => {
    const { host } = await renderBoard(THREE_TASKS, 1280, 800)
    expect(board(host).dataset.atbFocus).toBe('none')
    expect(host.querySelector('.dsh-atb-fab')).toBeNull()
    expect(host.querySelectorAll('.dsh-atb-column[data-status]')).toHaveLength(5)
    // The tab rail is rendered (same DOM across breakpoints) but inert.
    expect(host.querySelectorAll('.dsh-atb-mobilebar-btn')).toHaveLength(5)
  })
})

describe('touch gestures never open a task by accident', () => {
  /** Dispatch a touchstart carrying one finger (jsdom has no Touch class). */
  function touchStart(element: HTMLElement, x: number, y: number): void {
    const event = new Event('touchstart', { bubbles: true })
    Object.defineProperty(event, 'touches', { value: [{ clientX: x, clientY: y }] })
    element.dispatchEvent(event)
  }

  /** A click as emitted by a webview at the end of a gesture. */
  function clickAt(element: HTMLElement, x: number, y: number): void {
    element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX: x, clientY: y }))
  }

  it('ignores the click tail of a horizontal swipe, keeps a real tap', async () => {
    const task = makeTask({ id: 't-swipe', title: 'Swipe me' })
    const controller = makeController([task])
    const host = render(React.createElement(TaskCard, { task, controller }))
    await waitFor(() => host.querySelector('.dsh-atb-card') !== null)
    const card = host.querySelector<HTMLElement>('.dsh-atb-card')!

    // Swipe: finger lands at x=200 and the click arrives at x=200+slop+.
    touchStart(card, 200, 300)
    clickAt(card, 200 + SWIPE_TAP_SLOP + 40, 302)
    expect(controller.getSnapshot().selectedId).toBeUndefined()

    // Tap: the click stays inside the slop, so the card opens as before.
    touchStart(card, 200, 300)
    clickAt(card, 203, 301)
    expect(controller.getSnapshot().selectedId).toBe('t-swipe')
  })

  it('does not treat a mouse click (no touch) as a swipe', async () => {
    const task = makeTask({ id: 't-mouse', title: 'Mouse' })
    const controller = makeController([task])
    const host = render(React.createElement(TaskCard, { task, controller }))
    await waitFor(() => host.querySelector('.dsh-atb-card') !== null)
    const card = host.querySelector<HTMLElement>('.dsh-atb-card')!
    clickAt(card, 700, 500)
    expect(controller.getSnapshot().selectedId).toBe('t-mouse')
  })

  it('never lets a stale touch origin swallow a later click', async () => {
    // Real-host field case: swipe on a card, then click another one with the
    // mouse/trackpad a moment later. The old origin must not block the click.
    const task = makeTask({ id: 't-stale', title: 'Stale' })
    const controller = makeController([task])
    const host = render(React.createElement(TaskCard, { task, controller }))
    await waitFor(() => host.querySelector('.dsh-atb-card') !== null)
    const card = host.querySelector<HTMLElement>('.dsh-atb-card')!

    const now = vi.spyOn(Date, 'now')
    now.mockReturnValue(1_000)
    touchStart(card, 100, 100)
    now.mockReturnValue(1_000 + SWIPE_TAP_WINDOW_MS + 200)
    clickAt(card, 260, 102)
    expect(controller.getSnapshot().selectedId).toBe('t-stale')
    now.mockRestore()
  })
})

describe('appearance preferences keep working in focus mode', () => {
  it('publishes the colour mode and keeps the four modes available', async () => {
    setAppearance({ colorMode: 'priority', intensity: 'subtle', density: 'compact' })
    const { host } = await renderBoard(THREE_TASKS, 390, 844)
    expect(board(host).dataset.atbColorMode).toBe('priority')
    expect(board(host).dataset.atbIntensity).toBe('subtle')
    expect(board(host).dataset.atbDensity).toBe('compact')
    const card = host.querySelector<HTMLElement>('.dsh-atb-card')!
    expect(card.dataset.colorMode).toBe('priority')
    expect(card.style.getPropertyValue('--atb-card-bg')).toContain('light-dark(')
    // Reset so a later test starts from the documented default.
    setAppearance(defaultAppearance())
  })
})

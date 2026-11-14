// @vitest-environment jsdom
/**
 * DeepSeek Pastel — appearance and card-surface contract.
 *
 * The visual language must stay a *display* concern: tones are stable per task,
 * independent from `urgency`, persisted only in the browser, and the board
 * renders the user's preferences (density, intensity, descriptions, grouping,
 * manual tones) without touching the ledger or the host document.
 *
 * @module dsh-taskboard/tests/appearance-ui
 */
import React from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BoardController } from '../src/client/controller.ts'
import { TaskBoard } from '../src/client/board/TaskBoard.tsx'
import { TaskCard } from '../src/client/board/TaskCard.tsx'
import { TaskDetail } from '../src/client/board/TaskDetail.tsx'
import { SettingsModal } from '../src/client/board/SettingsModal.tsx'
import { disposeI18n } from '../src/client/i18n/runtime.ts'
import { STYLES } from '../src/client/styles.ts'
import {
  APPEARANCE_KEY,
  CARD_TONES,
  DEFAULT_DENSITY,
  DEFAULT_VIBRANCY,
  MAX_VIBRANCY,
  MIN_VIBRANCY,
  clearTaskTones,
  defaultAppearance,
  hashTone,
  loadAppearance,
  reloadAppearance,
  resetAppearance,
  sanitizeAppearance,
  setAppearance,
  setTaskTone,
  toneForTask,
} from '../src/client/board/appearance.ts'
import type { TaskRecord } from '../src/shared/protocol.ts'
import { waitFor } from './wait-for.ts'

const cleanups: Array<() => void> = []
/** Live React roots, unmounted in afterEach. */
const roots: Root[] = []

afterEach(() => {
  for (const root of roots.splice(0).reverse()) root.unmount()
  for (const cleanup of cleanups.splice(0).reverse()) cleanup()
  disposeI18n()
  localStorage.clear()
  resetAppearance()
  document.body.replaceChildren()
})

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  localStorage.clear()
  resetAppearance()
})

/** Minimal live task; only the fields the card/board actually read. */
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

/** Controller over a faked transport (no HTTP, no SSE). */
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

/** Render one element into a detached host div. */
function render(element: React.ReactElement): HTMLElement {
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  roots.push(root)
  root.render(element)
  return host
}

describe('appearance preferences — stable, display-only, persistable', () => {
  it('defaults to the airy density at full intensity', () => {
    expect(DEFAULT_DENSITY).toBe('spacious')
    expect(DEFAULT_VIBRANCY).toBe(100)
    expect(defaultAppearance()).toEqual({
      density: 'spacious', vibrancy: 100, descriptions: true, group: true, tones: {},
    })
  })

  it('sanitizes unknown, partial and corrupted payloads back to safe values', () => {
    expect(sanitizeAppearance(null)).toEqual(defaultAppearance())
    expect(sanitizeAppearance({ density: 'gigantic', vibrancy: 999, descriptions: 'yes' })).toEqual({
      ...defaultAppearance(), vibrancy: MAX_VIBRANCY,
    })
    // Unknown tones are dropped, known ones kept.
    expect(sanitizeAppearance({ tones: { 't-1': 'peach', 't-2': 'neon' } }).tones).toEqual({ 't-1': 'peach' })
    // Clamping respects the exposed range and the 5 % step.
    expect(sanitizeAppearance({ vibrancy: 3 }).vibrancy).toBe(MIN_VIBRANCY)
    expect(sanitizeAppearance({ vibrancy: 63 }).vibrancy).toBe(65)
    // A corrupted localStorage payload never throws and never leaks.
    localStorage.setItem(APPEARANCE_KEY, '{not json')
    expect(loadAppearance()).toEqual(defaultAppearance())
  })

  it('persists preferences and manual tones across a reload', () => {
    setAppearance({ density: 'compact', vibrancy: 55, descriptions: false, group: false })
    setTaskTone('t-pinned', 'pink')
    const raw = JSON.parse(localStorage.getItem(APPEARANCE_KEY)!) as Record<string, unknown>
    expect(raw.density).toBe('compact')
    expect(raw.vibrancy).toBe(55)
    expect(raw.descriptions).toBe(false)
    expect(raw.group).toBe(false)
    expect(raw.tones).toEqual({ 't-pinned': 'pink' })
    // Simulate a full reload: module state is re-read from the same storage.
    const expected = { density: 'compact', vibrancy: 55, descriptions: false, group: false, tones: { 't-pinned': 'pink' } }
    expect(sanitizeAppearance(raw)).toEqual(expected)
    reloadAppearance()
    expect(loadAppearance()).toEqual(expected)
    clearTaskTones()
    expect(loadAppearance().tones).toEqual({})
  })

  it('derives a deterministic tone from the task id, never from render order or randomness', () => {
    expect(hashTone('t-abc')).toBe(hashTone('t-abc'))
    expect(CARD_TONES).toContain(hashTone('t-abc'))
    // Two different ids reach distinct tones (find a pair rather than trust luck).
    const other = CARD_TONES.find(tone => tone !== hashTone('t-abc'))!
    expect(other).not.toBe(hashTone('t-abc'))
    expect(toneForTask('t-abc', defaultAppearance())).toBe(hashTone('t-abc'))
    expect(toneForTask('t-abc', { ...defaultAppearance(), tones: { 't-abc': 'mint' } })).toBe('mint')
  })

  it('keeps every palette tone and its accent in the stylesheet, for both themes', () => {
    // Full tinted surfaces, no per-tone border/left band.
    for (const tone of CARD_TONES) {
      expect(STYLES).toContain(`--atb-tone-${tone}: light-dark(`)
      expect(STYLES).toContain(`--atb-tone-accent-${tone}: light-dark(`)
      expect(STYLES).toContain(`.dsh-atb-card[data-tone="${tone}"]`)
    }
    // The user intensity is a percentage mixed over the host surface.
    expect(STYLES).toContain('color-mix(in oklab, var(--atb-card-tone')
    expect(STYLES).toContain('var(--atb-vibrancy)')
    // The historic priority stripe is gone (cards are full surfaces).
    expect(STYLES).not.toContain('.dsh-atb-card::before')
    // Densities only swap spacing tokens.
    for (const density of ['compact', 'comfortable', 'spacious']) {
      expect(STYLES).toContain(`.dsh-atb-board[data-atb-density="${density}"]`)
    }
    // Motion policy and responsive navigation exist.
    expect(STYLES).toContain('@media (prefers-reduced-motion: reduce)')
    expect(STYLES).toContain('.dsh-atb-mobilebar')
    expect(STYLES).toContain('@media (max-width: 760px)')
  })
})

describe('card surface', () => {
  it('shows project + id, the dominant title, description, flags, divider and footer', async () => {
    const task = makeTask({
      id: 'TB-034',
      title: 'Rendre les cartes lisibles',
      description: 'Appliquer des surfaces pastel et préserver les tokens DSH.',
      urgency: 'urgent',
    })
    const controller = makeController([task])
    await controller.refresh()
    const host = render(React.createElement(TaskCard, { task, controller }))
    await waitFor(() => host.querySelector('.dsh-atb-card') !== null)

    const card = host.querySelector<HTMLElement>('.dsh-atb-card')!
    expect(card.dataset.tone).toBe(hashTone('TB-034'))
    // Priority stays explicit and independent from the tone.
    expect(card.dataset.urgency).toBe('urgent')
    expect(host.querySelector('.dsh-atb-card-project')?.textContent).toBe('Ravum')
    expect(host.querySelector('.dsh-atb-card-id')?.textContent).toBe('TB-034')
    expect(host.querySelector('.dsh-atb-card-title')?.textContent).toBe(task.title)
    expect(host.querySelector('.dsh-atb-card-desc')?.textContent).toBe(task.description)
    expect(host.querySelector('.dsh-atb-card-priority')?.textContent?.toLowerCase()).toContain('urgent')
    expect(host.querySelector('.dsh-atb-card-divider')).not.toBeNull()
    expect(host.querySelector('.dsh-atb-card-time')).not.toBeNull()
  })

  it('keeps every business badge and the review actions', async () => {
    const task = makeTask({
      id: 'TB-054',
      title: 'Auditer les blocages',
      status: 'in_review',
      urgency: 'urgent',
      blocked: true,
      checklist: [
        { id: 'c1', text: 'Docs', checked: true },
        { id: 'c2', text: 'Tests', checked: false },
      ],
      dependsOn: ['TB-001'],
    })
    const controller = makeController([task, makeTask({ id: 'TB-001', title: 'Prereq', status: 'done' })])
    const host = render(React.createElement(TaskCard, { task, controller }))
    await waitFor(() => host.querySelector('.dsh-atb-card') !== null)

    expect(host.querySelector('.dsh-atb-badge[data-kind="blocked"]')).not.toBeNull()
    expect(host.querySelector('.dsh-atb-badge[data-kind="dependency"]')).not.toBeNull()
    // An unchecked acceptance item is an alert on an in_review card.
    expect(host.querySelector('.dsh-atb-badge[data-kind="blocked"][title]')).not.toBeNull()
    expect(host.querySelector('.dsh-atb-card-progress')).not.toBeNull()
    expect(host.querySelector('.dsh-atb-quickbtn[data-act="done"]')).not.toBeNull()
    expect(host.querySelector('.dsh-atb-quickbtn[data-act="reject"]')).not.toBeNull()
  })

  it('honours a manual tone and hides the description when the preference says so', async () => {
    setAppearance({ descriptions: false })
    setTaskTone('TB-034', 'peach')
    const task = makeTask({ id: 'TB-034', title: 'Carte', description: 'Contexte utile.' })
    const controller = makeController([task])
    const host = render(React.createElement(TaskCard, { task, controller }))
    await waitFor(() => host.querySelector('.dsh-atb-card') !== null)
    expect(host.querySelector<HTMLElement>('.dsh-atb-card')!.dataset.tone).toBe('peach')
    expect(host.querySelector('.dsh-atb-card-desc')).toBeNull()
  })

  it('opens the detail on Enter and selects on click (keyboard parity)', async () => {
    const task = makeTask({ id: 't-kb', title: 'Keyboard' })
    const controller = makeController([task])
    const host = render(React.createElement(TaskCard, { task, controller }))
    await waitFor(() => host.querySelector('.dsh-atb-card') !== null)
    const card = host.querySelector<HTMLElement>('.dsh-atb-card')!
    card.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
    await waitFor(() => controller.getSnapshot().selectedId === 't-kb')
    expect(controller.getSnapshot().selectedId).toBe('t-kb')
  })
})

describe('board rendering', () => {
  it('publishes the appearance preferences on the board root', async () => {
    setAppearance({ density: 'comfortable', vibrancy: 45, descriptions: true, group: false })
    const controller = makeController([makeTask({ id: 't-1', title: 'One', status: 'todo' })])
    const host = render(React.createElement(TaskBoard, { controller }))
    controller.start()
    await waitFor(() => host.querySelector('.dsh-atb-board') !== null)
    const board = host.querySelector<HTMLElement>('.dsh-atb-board')!
    expect(board.dataset.atbDensity).toBe('comfortable')
    expect(board.dataset.atbDescriptions).toBe('true')
    expect(board.dataset.atbGroup).toBe('false')
    expect(board.style.getPropertyValue('--atb-vibrancy')).toBe('45%')
  })

  it('renders five columns with the project groups, and a flat list when grouping is off', async () => {
    const controller = makeController([
      makeTask({ id: 't-1', title: 'One', workspaceId: 'ws-a' }),
      makeTask({ id: 't-2', title: 'Two', workspaceId: 'ws-b' }),
    ])
    const host = render(React.createElement(TaskBoard, { controller }))
    controller.start()
    await waitFor(() => host.querySelectorAll('.dsh-atb-column').length === 5)
    expect(host.querySelectorAll('.dsh-atb-column[data-status]').length).toBe(5)
    await waitFor(() => host.querySelectorAll('.dsh-atb-ws-group-head').length === 2)

    setAppearance({ group: false })
    await waitFor(() => host.querySelectorAll('.dsh-atb-ws-group-head').length === 0)
    // Cards stay, only the grouping disappears.
    expect(host.querySelectorAll('.dsh-atb-card').length).toBeGreaterThanOrEqual(2)
  })

  it('exposes a five-button column navigation for narrow viewports', async () => {
    const controller = makeController([makeTask({ id: 't-1', title: 'One' })])
    const host = render(React.createElement(TaskBoard, { controller }))
    controller.start()
    await waitFor(() => host.querySelector('.dsh-atb-mobilebar') !== null)
    const buttons = [...host.querySelectorAll('.dsh-atb-mobilebar-btn')]
    expect(buttons).toHaveLength(5)
    expect(buttons.map(button => button.getAttribute('data-status'))).toEqual(['backlog', 'todo', 'in_progress', 'in_review', 'done'])
  })

  it('does not mutate the host document (theme, attributes or body style)', async () => {
    const htmlAttributes = document.documentElement.getAttributeNames().sort()
    const bodyAttributes = document.body.getAttributeNames().sort()
    const bodyStyle = document.body.getAttribute('style')
    const controller = makeController([makeTask({ id: 't-1', title: 'One' })])
    const host = render(React.createElement(TaskBoard, { controller }))
    controller.start()
    await waitFor(() => host.querySelector('.dsh-atb-board') !== null)
    expect(document.documentElement.getAttributeNames().sort()).toEqual(htmlAttributes)
    expect(document.body.getAttributeNames().sort()).toEqual(bodyAttributes)
    expect(document.body.getAttribute('style')).toBe(bodyStyle)
    // No color-scheme override either: the host owns the theme.
    expect(document.documentElement.style.colorScheme).toBe('')
  })

  it('pins a tone from the detail pane and renders it on the card', async () => {
    const controller = makeController([makeTask({ id: 't-tone', title: 'Tone' })])
    const host = render(React.createElement(TaskBoard, { controller }))
    controller.start()
    await waitFor(() => host.querySelector('.dsh-atb-card') !== null)
    host.querySelector<HTMLElement>('.dsh-atb-card')!.click()
    await waitFor(() => host.querySelector('.dsh-atb-tone-pick') !== null)

    const peach = host.querySelector<HTMLButtonElement>('.dsh-atb-tone-swatch[data-tone="peach"]')!
    peach.click()
    await waitFor(() => host.querySelector<HTMLElement>('.dsh-atb-card')!.dataset.tone === 'peach')
    expect(host.querySelector<HTMLElement>('.dsh-atb-card')!.dataset.tone).toBe('peach')
    expect(JSON.parse(localStorage.getItem(APPEARANCE_KEY)!).tones).toEqual({ 't-tone': 'peach' })

    host.querySelector<HTMLButtonElement>('.dsh-atb-tone-swatch[data-tone="auto"]')!.click()
    await waitFor(() => host.querySelector<HTMLElement>('.dsh-atb-card')!.dataset.tone === hashTone('t-tone'))
    expect(host.querySelector<HTMLElement>('.dsh-atb-card')!.dataset.tone).toBe(hashTone('t-tone'))
  })
})

describe('appearance settings', () => {
  it('applies density, intensity and switches immediately, without a ledger write', async () => {
    const updated: unknown[] = []
    const controller = {
      getSnapshot: () => ({ ledger: { tasks: [], settings: {} } }),
      fetchModelCatalog: async () => [],
      fetchPresetCatalog: async () => ({ presets: [] }),
      closeSettings: () => {},
      updateSettings: async (body: unknown) => { updated.push(body); return true },
    } as unknown as BoardController
    const host = render(React.createElement(SettingsModal, { controller }))
    await waitFor(() => host.querySelector('[role=tabpanel]') !== null)

    const tabs = [...host.querySelectorAll<HTMLButtonElement>('[role=tab]')]
    const appearanceTab = tabs.find(tab => tab.id === 'dsh-atb-settings-tab-appearance')!
    appearanceTab.click()
    await waitFor(() => host.querySelector('#dsh-atb-settings-panel-appearance')?.hasAttribute('hidden') === false)

    const panel = host.querySelector<HTMLElement>('#dsh-atb-settings-panel-appearance')!
    const densities = [...panel.querySelectorAll<HTMLButtonElement>('.dsh-atb-mode-opt')]
    expect(densities).toHaveLength(3)
    expect(densities.filter(button => button.dataset.on === 'true')).toHaveLength(1)
    // Default is the airy one, selected out of the box.
    expect(densities[2]!.dataset.on).toBe('true')
    densities[0]!.click()
    await waitFor(() => loadAppearance().density === 'compact')

    const range = panel.querySelector<HTMLInputElement>('input[type=range]')!
    expect(range.min).toBe(String(MIN_VIBRANCY))
    expect(range.max).toBe(String(MAX_VIBRANCY))
    // React tracks input.value on the instance: go through the prototype
    // setter so the change is observed (native-event parity, not a shortcut).
    const nativeValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
    nativeValue.call(range, '40')
    range.dispatchEvent(new Event('input', { bubbles: true }))
    await waitFor(() => loadAppearance().vibrancy === 40)

    const switches = [...panel.querySelectorAll<HTMLInputElement>('.dsh-atb-switch input[type=checkbox]')]
    expect(switches).toHaveLength(2)
    switches[0]!.click()
    await waitFor(() => loadAppearance().descriptions === false)
    switches[1]!.click()
    await waitFor(() => loadAppearance().group === false)

    // Display preferences never go through the ledger settings route.
    expect(updated).toEqual([])
  })

  it('restores automatic colours from the appearance panel', async () => {
    setTaskTone('t-1', 'mint')
    setTaskTone('t-2', 'sky')
    const controller = {
      getSnapshot: () => ({ ledger: { tasks: [], settings: {} } }),
      fetchModelCatalog: async () => [],
      fetchPresetCatalog: async () => ({ presets: [] }),
      closeSettings: () => {},
      updateSettings: async () => true,
    } as unknown as BoardController
    const host = render(React.createElement(SettingsModal, { controller }))
    await waitFor(() => host.querySelector('[role=tabpanel]') !== null)
    host.querySelector<HTMLButtonElement>('#dsh-atb-settings-tab-appearance')!.click()
    await waitFor(() => host.querySelector('#dsh-atb-settings-panel-appearance')?.hasAttribute('hidden') === false)
    const panel = host.querySelector<HTMLElement>('#dsh-atb-settings-panel-appearance')!
    const reset = [...panel.querySelectorAll<HTMLButtonElement>('button')]
      .find(button => button.textContent?.includes('Restore automatic colours'))!
    reset.click()
    await waitFor(() => Object.keys(loadAppearance().tones).length === 0)
    expect(loadAppearance().tones).toEqual({})
  })
})

describe('detail pane', () => {
  it('offers the eight tones plus automatic and marks the current one', async () => {
    const task = makeTask({ id: 't-detail', title: 'Detail' })
    const controller = makeController([task])
    const host = render(React.createElement(TaskDetail, { task, controller }))
    await waitFor(() => host.querySelector('.dsh-atb-tone-pick') !== null)
    const swatches = [...host.querySelectorAll<HTMLButtonElement>('.dsh-atb-tone-swatch')]
    expect(swatches).toHaveLength(CARD_TONES.length + 1)
    const auto = host.querySelector<HTMLButtonElement>('.dsh-atb-tone-swatch[data-tone="auto"]')!
    expect(auto.getAttribute('aria-pressed')).toBe('true')
  })
})


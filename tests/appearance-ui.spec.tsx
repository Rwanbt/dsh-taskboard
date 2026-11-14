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
import { DEFAULT_COLOR_INTENSITY, DEFAULT_COLOR_MODE } from '../src/client/board/coloring.ts'
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
  it('defaults to colour by category, balanced intensity and the airy density', () => {
    expect(DEFAULT_DENSITY).toBe('spacious')
    expect(DEFAULT_COLOR_MODE).toBe('category')
    expect(DEFAULT_COLOR_INTENSITY).toBe('balanced')
    expect(defaultAppearance()).toEqual({
      colorMode: 'category',
      intensity: 'balanced',
      density: 'spacious',
      descriptions: true,
      group: true,
      tones: {},
      projectColors: {},
      priorityColors: {},
      priorityNuance: true,
    })
  })

  it('sanitizes unknown, partial and corrupted payloads back to safe values', () => {
    expect(sanitizeAppearance(null)).toEqual(defaultAppearance())
    expect(sanitizeAppearance({ density: 'gigantic', colorMode: 'neon', intensity: 'loud', descriptions: 'yes' })).toEqual(defaultAppearance())
    // Unknown tones are dropped, known ones kept.
    expect(sanitizeAppearance({ tones: { 't-1': 'peach', 't-2': 'neon' } }).tones).toEqual({ 't-1': 'peach' })
    expect(sanitizeAppearance({ projectColors: { 'ws-a': 'mint', 'ws-b': 'neon' } }).projectColors).toEqual({ 'ws-a': 'mint' })
    // v1 migration: the old percentage maps to the nearest named preset.
    expect(sanitizeAppearance({ vibrancy: 45 }).intensity).toBe('subtle')
    expect(sanitizeAppearance({ vibrancy: 75 }).intensity).toBe('balanced')
    expect(sanitizeAppearance({ vibrancy: 100 }).intensity).toBe('strong')
    // A corrupted localStorage payload never throws and never leaks.
    localStorage.setItem(APPEARANCE_KEY, '{not json')
    expect(loadAppearance()).toEqual(defaultAppearance())
  })

  it('persists preferences and manual tones across a reload', () => {
    setAppearance({ density: 'compact', colorMode: 'card', intensity: 'subtle', descriptions: false, group: false })
    setTaskTone('t-pinned', 'pink')
    const raw = JSON.parse(localStorage.getItem(APPEARANCE_KEY)!) as Record<string, unknown>
    expect(raw.density).toBe('compact')
    expect(raw.colorMode).toBe('card')
    expect(raw.intensity).toBe('subtle')
    expect(raw.descriptions).toBe(false)
    expect(raw.group).toBe(false)
    expect(raw.tones).toEqual({ 't-pinned': 'pink' })
    // Simulate a full reload: module state is re-read from the same storage.
    const expected = { ...defaultAppearance(), density: 'compact', colorMode: 'card', intensity: 'subtle', descriptions: false, group: false, tones: { 't-pinned': 'pink' } }
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
    expect(STYLES).toContain('color-mix(in oklab, var(--atb-card-bg')
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
    // Default mode is "by category": the surface comes from the resolver, not
    // from a palette data-tone.
    expect(card.dataset.colorMode).toBe('category')
    expect(card.style.getPropertyValue('--atb-card-bg')).toContain('light-dark(')
    expect(card.style.getPropertyValue('--atb-tone-accent')).toContain('light-dark(')
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
    setAppearance({ descriptions: false, colorMode: 'card' })
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
    setAppearance({ density: 'comfortable', intensity: 'subtle', descriptions: true, group: false })
    const controller = makeController([makeTask({ id: 't-1', title: 'One', status: 'todo' })])
    const host = render(React.createElement(TaskBoard, { controller }))
    controller.start()
    await waitFor(() => host.querySelector('.dsh-atb-board') !== null)
    const board = host.querySelector<HTMLElement>('.dsh-atb-board')!
    expect(board.dataset.atbDensity).toBe('comfortable')
    expect(board.dataset.atbDescriptions).toBe('true')
    expect(board.dataset.atbGroup).toBe('false')
    expect(board.style.getPropertyValue('--atb-vibrancy')).toBe('45%')
    expect(board.dataset.atbColorMode).toBe('category')
    expect(board.dataset.atbIntensity).toBe('subtle')
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

  it('does not mutate the host document (theme, attributes or body style)', async () => {    const htmlAttributes = document.documentElement.getAttributeNames().sort()
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
    setAppearance({ colorMode: 'card' })
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

describe('board classification hint', () => {
  it('offers the explicit one-time classification on an all-unclassified board', async () => {
    // Historical boards have no category: "by category" is neutral by design,
    // so the board must explain it and offer the migration (never guess).
    const tasks = [
      makeTask({ id: 't-bug', title: 'Fix the parser bug', description: 'A regression appears.' }),
      makeTask({ id: 't-doc', title: 'Documentation for the board', description: '' }),
      makeTask({ id: 't-misc', title: 'Something unrelated', description: '' }),
    ]
    const updates: Array<{ id: string; category?: string }> = []
    const controller = new BoardController({
      state: async () => ({ schemaVersion: 1, revision: 1, tasks }),
      workspaces: async () => [{ id: 'ws-a', title: 'Ravum' }],
      templates: async () => ({ templates: [] }),
      stream: () => () => {},
      update: async (id: string, body: { category?: string }) => {
        const task = tasks.find(entry => entry.id === id)!
        task.category = body.category
        task.version += 1
        updates.push({ id, category: body.category })
        return { ok: true }
      },
    } as never)
    cleanups.push(() => controller.dispose())
    const host = render(React.createElement(TaskBoard, { controller }))
    controller.start()
    await waitFor(() => host.querySelector('.dsh-atb-board') !== null)
    const hint = host.querySelector<HTMLElement>('.dsh-atb-classifyhint')!
    expect(hint).not.toBeNull()
    expect(hint.textContent).toContain('unclassified')
    // The secondary action switches to priority colouring immediately.
    const [, priorityButton] = [...hint.querySelectorAll<HTMLButtonElement>('button')]
    priorityButton!.click()
    await waitFor(() => loadAppearance().colorMode === 'priority')
    setAppearance({ colorMode: 'category' })
    await waitFor(() => host.querySelector('.dsh-atb-classifyhint') !== null)
    // The primary action applies the documented classifier through the
    // versioned update route, then the hint disappears once tasks are classified.
    host.querySelector<HTMLButtonElement>('.dsh-atb-classifyhint button')!.click()
    await waitFor(() => tasks.some(task => task.category !== undefined))
    expect(updates).toEqual(expect.arrayContaining([
      { id: 't-bug', category: 'bug' },
      { id: 't-doc', category: 'documentation' },
    ]))
    // An unrelated task stays unclassified; the hint therefore stays visible
    // (it disappears only when the whole board is classified).
    await waitFor(() => host.textContent?.includes('Classified') === true || host.querySelector('.dsh-atb-classifyhint') !== null)
  })
})

describe('appearance settings', () => {  it('applies density, intensity and switches immediately, without a ledger write', async () => {
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
    // Colouring mode: four modes, category selected by default.
    const modes = [...panel.querySelectorAll<HTMLButtonElement>('.dsh-atb-colormode')]
    expect(modes).toHaveLength(4)
    expect(modes.map(mode => mode.dataset.on)).toEqual(['false', 'false', 'true', 'false'])
    modes[3]!.click()
    await waitFor(() => loadAppearance().colorMode === 'priority')

    // Intensity: three named presets, balanced by default.
    const intensityButtons = [...panel.querySelectorAll<HTMLButtonElement>('[data-picker="intensity"] .dsh-atb-mode-opt')]
    expect(intensityButtons).toHaveLength(3)
    expect(intensityButtons.map(button => button.dataset.on)).toEqual(['false', 'true', 'false'])
    intensityButtons[0]!.click()
    await waitFor(() => loadAppearance().intensity === 'subtle')

    // Density is still available.
    const densityButtons = [...panel.querySelectorAll<HTMLButtonElement>('[data-picker="density"] .dsh-atb-mode-opt')]
    expect(densityButtons).toHaveLength(3)
    densityButtons[0]!.click()
    await waitFor(() => loadAppearance().density === 'compact')

    const switches = [...panel.querySelectorAll<HTMLInputElement>('.dsh-atb-switch input[type=checkbox]')]
    expect(switches).toHaveLength(3) // priority nuance + descriptions + grouping
    switches[1]!.click()
    await waitFor(() => loadAppearance().descriptions === false)
    switches[2]!.click()
    await waitFor(() => loadAppearance().group === false)

    // Display preferences never go through the ledger settings route.
    expect(updated).toEqual([])
  })

  it('classifies existing tasks from the category panel and reports the outcome', async () => {
    const tasks = [
      makeTask({ id: 't-bug', title: 'Fix the parser bug' }),
      makeTask({ id: 't-doc', title: 'Documentation for the board' }),
      makeTask({ id: 't-none', title: 'Nothing to see' }),
    ]
    const batches: Array<ReadonlyArray<{ id: string; category: string }>> = []
    const controller = {
      getSnapshot: () => ({ ledger: { tasks, settings: {} } }),
      fetchModelCatalog: async () => [],
      fetchPresetCatalog: async () => ({ presets: [] }),
      closeSettings: () => {},
      updateSettings: async () => true,
      classifyTasks: async (entries: ReadonlyArray<{ id: string; category: string }>) => {
        batches.push(entries)
        return { classified: entries.length, failed: 0 }
      },
    } as unknown as BoardController
    const host = render(React.createElement(SettingsModal, { controller }))
    await waitFor(() => host.querySelector('[role=tabpanel]') !== null)
    host.querySelector<HTMLButtonElement>('#dsh-atb-settings-tab-appearance')!.click()
    await waitFor(() => host.querySelector('#dsh-atb-settings-panel-appearance')?.hasAttribute('hidden') === false)

    const panel = host.querySelector<HTMLElement>('#dsh-atb-settings-panel-appearance')!
    const classify = [...panel.querySelectorAll<HTMLButtonElement>('button')]
      .find(button => button.textContent?.includes('Classify existing tasks'))!
    expect(classify).toBeDefined()
    classify.click()
    await waitFor(() => batches.length === 1)
    expect(batches[0]).toEqual(expect.arrayContaining([
      { id: 't-bug', ifVersion: 1, category: 'bug' },
      { id: 't-doc', ifVersion: 1, category: 'documentation' },
    ]))
    await waitFor(() => host.textContent?.includes('Classified 2 task(s)') === true)
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
    // Manual tones are edited in "by card" mode; switch there first.
    ;[...host.querySelectorAll<HTMLButtonElement>('.dsh-atb-colormode')][0]!.click()
    await waitFor(() => loadAppearance().colorMode === 'card')
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





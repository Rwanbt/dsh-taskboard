// @vitest-environment jsdom
/**
 * Desktop header compaction.
 *
 * Two layers are asserted:
 *  1. the pure density mapping (thresholds, ordering, degenerate inputs);
 *  2. the real board component: the action cluster lives on the title row, every
 *     compacted control keeps an accessible name and a tooltip, and the density
 *     attribute follows the *measured* toolbar width (the host sidebar state is
 *     what actually narrows the panel, so the viewport is not the guide).
 *
 * The rendered label widths are proven against a real DSH host by
 * `scripts/qa/desktop-header-capture.mjs` (jsdom has no layout).
 *
 * @module dsh-taskboard/tests/toolbar-compact
 */
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BoardController } from '../src/client/controller.ts'
import { TaskBoard } from '../src/client/board/TaskBoard.tsx'
import {
  TOOLBAR_COMPACT_MIN,
  TOOLBAR_WIDE_MIN,
  toolbarDensityFor,
} from '../src/client/board/compact.ts'
import { disposeI18n } from '../src/client/i18n/runtime.ts'
import { resetAppearance } from '../src/client/board/appearance.ts'
import { MAIN_STATUSES, type TaskRecord } from '../src/shared/protocol.ts'
import { STYLES } from '../src/client/styles.ts'
import { waitFor } from './wait-for.ts'

const roots: Root[] = []
const cleanups: Array<() => void> = []

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  localStorage.clear()
  resetAppearance()
})

afterEach(() => {
  for (const root of roots.splice(0).reverse()) act(() => root.unmount())
  for (const cleanup of cleanups.splice(0).reverse()) cleanup()
  disposeI18n()
  localStorage.clear()
  resetAppearance()
  document.body.replaceChildren()
})

function makeTask(id: string, status: TaskRecord['status'] = 'todo'): TaskRecord {
  return {
    id,
    title: id,
    description: '',
    prompt: '',
    workspaceId: 'ws-a',
    urgency: 'normal',
    status,
    blocked: false,
    execution: { mode: 'claim' },
    version: 1,
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
    createdBy: { kind: 'user' },
    updatedBy: { kind: 'user' },
    comments: [],
    executions: [],
  } as TaskRecord
}

function makeController(tasks: TaskRecord[]): BoardController {
  const controller = new BoardController({
    state: async () => ({ schemaVersion: 1, revision: 1, tasks }),
    workspaces: async () => [{ id: 'ws-a', title: 'Ravum' }],
    templates: async () => ({ templates: [] }),
    stream: () => () => {},
  } as never)
  cleanups.push(() => controller.dispose())
  return controller
}

/** Render the desktop board (five columns) and flush its effects. */
async function renderDesktop(): Promise<HTMLElement> {
  Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: 1440 })
  Object.defineProperty(window, 'innerHeight', { configurable: true, writable: true, value: 900 })
  const controller = makeController([makeTask('t-todo')])
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  roots.push(root)
  root.render(React.createElement(TaskBoard, { controller }))
  controller.start()
  await waitFor(() => host.querySelectorAll('.dsh-atb-column[data-status]').length === MAIN_STATUSES.length)
  await act(async () => {})
  return host
}

/** Publish a toolbar width and let the resize fallback recompute the density. */
async function setToolbarWidth(host: HTMLElement, width: number): Promise<void> {
  const toolbar = host.querySelector<HTMLElement>('.dsh-atb-toolbar')!
  Object.defineProperty(toolbar, 'clientWidth', { configurable: true, value: width })
  await act(async () => { window.dispatchEvent(new Event('resize')) })
}

const board = (host: HTMLElement): HTMLElement => host.querySelector<HTMLElement>('.dsh-atb-board')!
const densityOf = (host: HTMLElement): string | undefined => board(host).dataset.atbBar

describe('toolbar density mapping', () => {
  it('orders the thresholds and maps every band', () => {
    expect(TOOLBAR_WIDE_MIN).toBeGreaterThan(TOOLBAR_COMPACT_MIN)
    expect(toolbarDensityFor(TOOLBAR_WIDE_MIN)).toBe('wide')
    expect(toolbarDensityFor(TOOLBAR_WIDE_MIN - 1)).toBe('compact')
    expect(toolbarDensityFor(TOOLBAR_COMPACT_MIN)).toBe('compact')
    expect(toolbarDensityFor(TOOLBAR_COMPACT_MIN - 1)).toBe('tight')
    expect(toolbarDensityFor(1920)).toBe('wide')
    expect(toolbarDensityFor(840)).toBe('tight')
  })

  it('treats degenerate widths as the densest layout instead of crashing', () => {
    expect(toolbarDensityFor(0)).toBe('tight')
    expect(toolbarDensityFor(-10)).toBe('tight')
    expect(toolbarDensityFor(Number.NaN)).toBe('tight')
    // A non-finite measurement is garbage, never a license for the roomiest layout.
    expect(toolbarDensityFor(Number.POSITIVE_INFINITY)).toBe('tight')
  })
})

describe('desktop header layout', () => {
  it('keeps the action cluster on the title row, not on the filter row', async () => {
    const host = await renderDesktop()
    const head = host.querySelector('.dsh-atb-head')!
    const toolbar = host.querySelector('.dsh-atb-toolbar')!
    expect(head.querySelector('.dsh-atb-toolbar-actions')).not.toBeNull()
    expect(toolbar.querySelector('.dsh-atb-toolbar-actions')).toBeNull()
    // The filters stay on the toolbar row.
    expect(toolbar.querySelector('.dsh-atb-toolbar-filters')).not.toBeNull()
    expect(head.querySelector('.dsh-atb-toolbar-filters')).toBeNull()
  })

  it('publishes the density of the measured toolbar width', async () => {
    const host = await renderDesktop()
    expect(densityOf(host)).toBe('wide')
    await setToolbarWidth(host, 1000)
    expect(densityOf(host)).toBe('compact')
    await setToolbarWidth(host, 700)
    expect(densityOf(host)).toBe('tight')
    await setToolbarWidth(host, 1600)
    expect(densityOf(host)).toBe('wide')
  })

  it('keeps the last density while the panel is hidden (width 0)', async () => {
    const host = await renderDesktop()
    await setToolbarWidth(host, 1000)
    expect(densityOf(host)).toBe('compact')
    await setToolbarWidth(host, 0)
    expect(densityOf(host)).toBe('compact')
  })

  it('gives every compactable control an accessible name and a tooltip', async () => {
    const host = await renderDesktop()
    for (const action of ['secondary', 'appearance', 'diagnostics', 'import', 'export']) {
      const button = host.querySelector<HTMLButtonElement>(`[data-action="${action}"]`)!
      expect(button, action).not.toBeNull()
      expect(button.getAttribute('aria-label'), action).toBeTruthy()
      expect(button.getAttribute('title'), action).toBeTruthy()
    }
    for (const urgency of ['urgent', 'normal', 'relaxed']) {
      const chip = host.querySelector<HTMLButtonElement>(`.dsh-atb-chip[data-urgency="${urgency}"]`)!
      expect(chip.getAttribute('aria-label'), urgency).toBeTruthy()
      expect(chip.getAttribute('title'), urgency).toBeTruthy()
      expect(chip.querySelector('.dsh-atb-chip-label')?.textContent, urgency).toBeTruthy()
    }
    const needsHuman = host.querySelector<HTMLButtonElement>('[data-kind="needs-human-filter"]')!
    expect(needsHuman.getAttribute('aria-label')).toBeTruthy()
  })

  it('draws the settings action as a cog with a centre hub', async () => {
    const host = await renderDesktop()
    await act(async () => {})
    const settings = host.querySelector('[data-action="appearance"]')!
    const svg = settings.querySelector('svg')!
    expect(svg.querySelector('circle[r="3"]')).not.toBeNull()
    expect(svg.querySelector('g[transform="scale(.66667)"]')).not.toBeNull()
  })
})

describe('stylesheet contract', () => {
  it('styles every density through the measured attribute', () => {
    for (const bar of ['compact', 'tight']) {
      expect(STYLES).toContain(`.dsh-atb-board[data-atb-bar="${bar}"] .dsh-atb-toolbar-actions .dsh-atb-btn-label`)
    }
    expect(STYLES).toContain('.dsh-atb-board[data-atb-bar="tight"] .dsh-atb-toolbar .dsh-atb-chip-label')
    expect(STYLES).toContain('.dsh-atb-board[data-atb-bar="tight"] .dsh-atb-grouptoggle-label')
    // Compact buttons are square, so the row cannot grow sideways either.
    expect(STYLES).toContain('width: 34px; height: 30px; padding: 0; gap: 0; justify-content: center;')
  })

  it('never targets host elements from the density rules', () => {
    const densityRules = STYLES
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.includes('data-atb-bar') && line.includes('{') && !line.startsWith('/*'))
    expect(densityRules.length).toBeGreaterThan(0)
    for (const line of densityRules) {
      expect(line.startsWith('.dsh-atb-board[data-atb-bar=')).toBe(true)
    }
  })
})

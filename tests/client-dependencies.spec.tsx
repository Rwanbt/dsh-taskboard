// @vitest-environment jsdom
/**
 * Client dependency/hierarchy UI suite (task C):
 * - the card badge renders only when prerequisites exist;
 * - a deleted prerequisite keeps a distinct, removable row (D2);
 * - the prerequisite picker is an accessible combobox over the host task
 *   index (title + id search, keyboard commit, ARIA state) and lives inside
 *   the existing collapsed dependency section;
 * - BoardController.duplicate() copies structure (D8);
 * - zh/en/ru dictionaries stay key-identical.
 *
 * The harness mirrors tests/human-review-ui.spec.tsx: a REAL BoardController
 * over a faked transport (plain-object controller fakes do not receive React
 * change events).
 */
import React from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BoardController } from '../src/client/controller.ts'
import { TaskCard } from '../src/client/board/TaskCard.tsx'
import { TaskDetail } from '../src/client/board/TaskDetail.tsx'
import { TaskFormModal } from '../src/client/board/TaskFormModal.tsx'
import { STYLES } from '../src/client/styles.ts'
import type { TaskIndexEntry } from '../src/client/api.ts'
import type { TaskRecord } from '../src/shared/protocol.ts'
import type { CreateTaskBody, UpdateTaskBody } from '../src/shared/api.ts'
import { en } from '../src/client/i18n/en.ts'
import { ru } from '../src/client/i18n/ru.ts'
import { zh } from '../src/client/i18n/zh.ts'
import { disposeI18n } from '../src/client/i18n/runtime.ts'
import { waitFor } from './wait-for.ts'

const cleanups: Array<() => void> = []
beforeEach(() => { localStorage.clear(); document.documentElement.lang = 'zh-CN'; disposeI18n() })
afterEach(() => { cleanups.splice(0).reverse().forEach(fn => fn()); vi.restoreAllMocks(); localStorage.clear() })

/** Minimal valid task record. */
function task(extra: Partial<TaskRecord> = {}): TaskRecord {
  return {
    id: 't-main', title: '主任务', description: '', prompt: '', workspaceId: 'ws-a',
    urgency: 'normal', status: 'todo', blocked: false, execution: { mode: 'claim' },
    version: 1, createdAt: 1, updatedAt: 1,
    createdBy: { kind: 'user' }, updatedBy: { kind: 'user' }, comments: [], executions: [],
    ...extra,
  }
}

/** One untrashed workspace task as the host task-index route returns it. */
function indexEntry(record: TaskRecord): TaskIndexEntry {
  return {
    id: record.id,
    title: record.title,
    status: record.status,
    workspaceId: record.workspaceId,
    ...(record.dependsOn !== undefined ? { dependsOn: record.dependsOn } : {}),
  }
}

interface Harness {
  controller: BoardController
  host: HTMLElement
  root: Root
  updates: UpdateTaskBody[]
  creates: CreateTaskBody[]
}

/** Mount TaskCard or TaskDetail over a real controller + faked transport. */
async function setup(tasks: TaskRecord[], options: {
  index?: TaskIndexEntry[]
  view?: 'card' | 'detail'
  focusTask?: TaskRecord
} = {}): Promise<Harness> {
  const updates: UpdateTaskBody[] = []
  const creates: CreateTaskBody[] = []
  const client = {
    state: async () => ({ schemaVersion: 1, revision: 1, tasks }),
    workspaces: async () => [{ id: 'ws-a', path: '/p/a', title: '工作区 A', sessionCount: 0 }],
    stream: () => () => {},
    update: async (_id: string, body: UpdateTaskBody) => { updates.push(body); return { id: tasks[0]?.id ?? 't-main' } },
    create: async (body: CreateTaskBody) => { creates.push(body); return { id: 't-new' } },
    ...(options.index !== undefined ? { taskIndex: async () => ({ tasks: options.index ?? [] }) } : {}),
  }
  const controller = new BoardController(client as never)
  controller.start()
  cleanups.push(() => controller.dispose())
  await waitFor(() => controller.getSnapshot().workspaces.length === 1)
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  cleanups.push(() => { root.unmount(); host.remove() })
  const focusTask = options.focusTask ?? tasks[0]!
  root.render(options.view === 'card'
    ? <TaskCard task={focusTask} controller={controller} />
    : <TaskDetail task={focusTask} controller={controller} />)
  await waitFor(() => host.querySelector(options.view === 'card' ? '.dsh-atb-card' : '.dsh-atb-detail') !== null)
  return { controller, host, root, updates, creates }
}

/** Find the dependency badge (the neutral 🔗 chip is now an SVG icon). */
function dependencyBadge(host: HTMLElement): Element | undefined {
  return host.querySelector('.dsh-atb-badge[data-kind="dependency"]') ?? undefined
}

/** React-controlled input setter (jsdom does not run React's value tracking). */
function typeInto(input: HTMLInputElement, value: string): void {
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
  setValue.call(input, value)
  input.dispatchEvent(new Event('input', { bubbles: true }))
}

/** Dispatch a keydown the way React's synthetic handler expects it. */
function press(input: HTMLInputElement, key: string): void {
  input.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }))
}

/**
 * Mount the create form after `controller.newSubtask(parentId)` and submit a
 * title, so the test proves the parentId round-trips into the create payload.
 */
async function submitSubtask(parentId: string, tasks: TaskRecord[]): Promise<CreateTaskBody[]> {
  const creates: CreateTaskBody[] = []
  const client = {
    state: async () => ({ schemaVersion: 1, revision: 1, tasks }),
    workspaces: async () => [{ id: 'ws-a', path: '/p/a', title: '工作区 A', sessionCount: 0 }],
    stream: () => () => {},
    create: async (body: CreateTaskBody) => { creates.push(body); return { id: 't-child' } },
  }
  const controller = new BoardController(client as never)
  controller.start()
  cleanups.push(() => controller.dispose())
  await waitFor(() => controller.getSnapshot().workspaces.length === 1)
  controller.newSubtask(parentId)
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  cleanups.push(() => { root.unmount(); host.remove() })
  root.render(<TaskFormModal controller={controller} />)
  await waitFor(() => host.querySelector('.dsh-atb-taskform-modal') !== null)
  const title = host.querySelector<HTMLInputElement>('.dsh-atb-taskform-modal input')!
  typeInto(title, '子任务标题')
  const save = host.querySelector<HTMLButtonElement>('button[data-primary="true"]')!
  await waitFor(() => !save.disabled)
  save.click()
  await waitFor(() => creates.length === 1)
  return creates
}

describe('dependency card badge', () => {
  it('renders only when the task has prerequisites, with completed/total', async () => {
    const done = task({ id: 't-done', title: '前置任务', status: 'done' })
    const withDeps = await setup([task({ dependsOn: ['t-done'] }), done], { view: 'card' })
    const badge = dependencyBadge(withDeps.host)
    expect(badge).toBeDefined()
    expect(badge!.textContent).toContain('1/1')
    // Neutral information chip (never the red blocked chip); ready is muted.
    expect(badge!.getAttribute('data-kind')).toBe('dependency')
    expect(badge!.getAttribute('data-ready')).toBe('true')
    // The tooltip carries the prerequisite name + status, not just counts.
    expect(badge!.getAttribute('title')).toContain('前置任务')
    expect(badge!.getAttribute('title')).toContain('完成')

    const without = await setup([task()], { view: 'card' })
    expect(dependencyBadge(without.host)).toBeUndefined()
  })

  it('marks a waiting prerequisite as a neutral chip (not the blocked error chip)', async () => {
    const pending = task({ id: 't-pending', title: '未完成前置', status: 'todo' })
    const view = await setup([task({ dependsOn: ['t-pending'] }), pending], { view: 'card' })
    const badge = dependencyBadge(view.host)
    expect(badge?.getAttribute('data-kind')).toBe('dependency')
    expect(badge?.getAttribute('data-ready')).toBeNull()
    expect(badge?.textContent).toContain('0/1')
    expect(badge?.getAttribute('title')).toContain('未完成前置')
    expect(badge?.getAttribute('title')).toContain('待办')
    // The genuinely blocked marker keeps its own loud kind.
    expect([...view.host.querySelectorAll('.dsh-atb-badge')].some(item => item.getAttribute('data-kind') === 'blocked')).toBe(false)
  })
})

describe('deleted prerequisite (D2)', () => {
  it('renders a distinct missing state, surfaces the audit comment, and removes in one click', async () => {
    const main = task({
      dependsOn: ['t-gone'],
      comments: [{
        id: 'c-audit', body: '[系统] 前置任务已删除', version: 1, createdAt: 2,
        systemKey: 'sys.prerequisiteRemoved', systemParams: { id: 't-gone', title: '已删除的前置' },
      }],
    })
    const view = await setup([main], { view: 'detail' })
    const row = view.host.querySelector('[data-missing="true"]')
    expect(row).not.toBeNull()
    expect(row!.textContent).toContain('前置任务已删除')
    expect(row!.textContent).toContain('t-gone')
    // The host audit comment is surfaced next to the dangling link.
    expect(row!.textContent).toContain('删除已记录')

    const remove = [...row!.querySelectorAll('button')].find(button => button.textContent === '移除')!
    remove.click()
    await waitFor(() => view.updates.length === 1)
    expect(view.updates[0]).toEqual({ ifVersion: 1, dependsOn: [] })
  })

  it('keeps a trashed prerequisite in the missing state and still removable', async () => {
    const trashed = task({ id: 't-trashed', title: '已回收前置', status: 'todo', trashedAt: 5 })
    const view = await setup([task({ dependsOn: ['t-trashed'] }), trashed], { view: 'detail' })
    const row = view.host.querySelector('[data-missing="true"]')
    expect(row).not.toBeNull()
    expect(row!.textContent).toContain('前置任务已删除')
    const remove = [...row!.querySelectorAll('button')].find(button => button.textContent === '移除')!
    remove.click()
    await waitFor(() => view.updates.length === 1)
    expect(view.updates[0]).toEqual({ ifVersion: 1, dependsOn: [] })
  })
})

describe('prerequisite combobox (F9)', () => {
  it('lives inside the collapsed dependency section and replaces the datalist', async () => {
    const view = await setup([task()], { view: 'detail' })
    const section = view.host.querySelector('[data-section="task-dependencies"]')!
    expect(section.querySelector('details')).not.toBeNull()
    expect(section.querySelector('details [role="combobox"]')).not.toBeNull()
    expect(view.host.querySelector('datalist')).toBeNull()
    expect(view.host.querySelector('input[list]')).toBeNull()
  })

  it('searches the host index by title and id, excludes self/linked, and commits with the keyboard', async () => {
    const main = task({ dependsOn: ['t-a'] })
    const alpha = task({ id: 't-a', title: 'Alpha 前置', status: 'done' })
    const beta = task({ id: 't-b', title: 'Beta 后续', status: 'todo' })
    const gamma = task({ id: 't-gamma', title: 'Gamma 已完成', status: 'done' })
    // Gamma is only in the host index (the board view may omit completed cards).
    const index = [main, alpha, beta, gamma].map(indexEntry)
    const view = await setup([main, alpha], { view: 'detail', index })
    const input = view.host.querySelector<HTMLInputElement>('[role="combobox"]')!
    expect(input).not.toBeNull()
    expect(input.getAttribute('aria-autocomplete')).toBe('list')
    expect(input.getAttribute('aria-expanded')).toBe('false')

    input.focus()
    await waitFor(() => view.host.querySelectorAll('[role="option"]').length === 2)
    expect(input.getAttribute('aria-expanded')).toBe('true')
    expect(input.getAttribute('aria-controls')).not.toBeNull()
    const texts = [...view.host.querySelectorAll('[role="option"]')].map(option => option.textContent ?? '')
    // Self (t-main) and the already-linked prerequisite (t-a) are excluded.
    expect(texts.some(text => text.includes('主任务'))).toBe(false)
    expect(texts.some(text => text.includes('Alpha 前置'))).toBe(false)
    expect(texts.some(text => text.includes('Beta 后续'))).toBe(true)
    expect(texts.some(text => text.includes('Gamma 已完成'))).toBe(true)
    // Candidates show status and workspace.
    expect(texts.some(text => text.includes('待办') && text.includes('工作区 A'))).toBe(true)
    expect(input.getAttribute('aria-activedescendant')).toBe(view.host.querySelector('[role="option"]')!.id)

    // Title search (case-insensitive).
    typeInto(input, 'gamma')
    await waitFor(() => view.host.querySelectorAll('[role="option"]').length === 1)
    expect(view.host.querySelector('[role="option"]')!.textContent).toContain('Gamma 已完成')

    // ID search.
    typeInto(input, 't-b')
    await waitFor(() => view.host.querySelectorAll('[role="option"]').length === 1)
    expect(view.host.querySelector('[role="option"]')!.textContent).toContain('Beta 后续')

    // Home/End/Arrow move the active option; Enter commits it.
    typeInto(input, '')
    await waitFor(() => view.host.querySelectorAll('[role="option"]').length === 2)
    const options = [...view.host.querySelectorAll<HTMLElement>('[role="option"]')]
    press(input, 'End')
    await waitFor(() => input.getAttribute('aria-activedescendant') === options[1]!.id)
    press(input, 'Home')
    await waitFor(() => input.getAttribute('aria-activedescendant') === options[0]!.id)
    press(input, 'ArrowDown')
    await waitFor(() => input.getAttribute('aria-activedescendant') === options[1]!.id)
    press(input, 'Enter')
    await waitFor(() => view.updates.length === 1)
    expect(view.updates[0]).toEqual({ ifVersion: 1, dependsOn: ['t-a', 't-gamma'] })

    // Keyboard-only path never traps focus: Tab stays untouched by the picker.
    const tab = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })
    input.dispatchEvent(tab)
    expect(tab.defaultPrevented).toBe(false)
  })

  it('closes on Escape and commits a clicked option', async () => {
    const beta = task({ id: 't-b', title: 'Beta 后续', status: 'todo' })
    const view = await setup([task(), beta], { view: 'detail' })
    const input = view.host.querySelector<HTMLInputElement>('[role="combobox"]')!
    input.focus()
    await waitFor(() => view.host.querySelectorAll('[role="option"]').length === 1)
    expect(input.getAttribute('aria-expanded')).toBe('true')
    press(input, 'Escape')
    await waitFor(() => input.getAttribute('aria-expanded') === 'false')

    // Typing reopens the list; a click on an option commits it.
    typeInto(input, 'beta')
    await waitFor(() => view.host.querySelectorAll('[role="option"]').length === 1)
    view.host.querySelector<HTMLElement>('[role="option"]')!.click()
    await waitFor(() => view.updates.length === 1)
    expect(view.updates[0]).toEqual({ ifVersion: 1, dependsOn: ['t-b'] })
  })

  it('navigates to a done prerequisite the collapsed completed column omitted from the ledger', async () => {
    // Collapsed Done column → the loaded ledger omits done cards, so the row
    // must resolve the prerequisite through the host index (requirement 12).
    localStorage.setItem('dsh-taskboard-view-v1', JSON.stringify({ doneCollapsed: true }))
    const main = task({ dependsOn: ['t-done'] })
    const doneEntry = indexEntry(task({ id: 't-done', title: '已完成前置', status: 'done' }))
    const view = await setup([main], { view: 'detail', index: [doneEntry] })
    expect(view.controller.getSnapshot().doneCollapsed).toBe(true)
    const row = view.host.querySelector('.dsh-atb-prereq-row')!
    await waitFor(() => row.textContent?.includes('已完成前置') === true)
    // Not misclassified as deleted: the index resolves it, status included.
    expect(view.host.querySelector('[data-missing="true"]')).toBeNull()
    expect(row.textContent).toContain('已完成')
    row.querySelector('button')!.click()
    await waitFor(() => view.controller.getSnapshot().selectedId === 't-done')
    expect(view.controller.getSnapshot().doneCollapsed).toBe(false)
  })

  it('falls back to the loaded ledger when the host index route is unavailable', async () => {
    const beta = task({ id: 't-b', title: 'Beta 后续', status: 'todo' })
    const view = await setup([task(), beta], { view: 'detail' })
    const input = view.host.querySelector<HTMLInputElement>('[role="combobox"]')!
    input.focus()
    await waitFor(() => view.host.querySelectorAll('[role="option"]').length === 1)
    expect(view.host.querySelector('[role="option"]')!.textContent).toContain('Beta 后续')
  })

  it('ships a visible focus ring, neutral single-line badges and no animation', () => {
    expect(STYLES).toContain('.dsh-atb-prereq-input:focus-visible')
    expect(STYLES).toContain('.dsh-atb-prereq-list')
    expect(STYLES).toContain('.dsh-atb-prereq-opt[data-active="true"]')
    expect(STYLES).not.toContain('.dsh-atb-prereq-list { animation')
    // Neutral information chips (dependency link and hierarchy subtask), single line.
    expect(STYLES).toContain('.dsh-atb-badge[data-kind="dependency"]')
    expect(STYLES).toContain('.dsh-atb-badge[data-kind="subtasks"]')
    expect(STYLES).toContain('white-space: nowrap')
  })
})

describe('duplicate copies structure (D8)', () => {
  it('carries dependsOn and parentId into the create payload', async () => {
    const original = { ...task({ dependsOn: ['t-a', 't-b'] }), parentId: 't-parent' } as TaskRecord
    const view = await setup([original], { view: 'card' })
    await view.controller.duplicate(original)
    await waitFor(() => view.creates.length === 1)
    expect(view.creates[0]).toMatchObject({ dependsOn: ['t-a', 't-b'], parentId: 't-parent' })
    // The copied array is a snapshot, never the live record's own array.
    expect((view.creates[0] as { dependsOn?: string[] }).dependsOn).not.toBe(original.dependsOn)
  })

  it('omits the structure fields when the source has none', async () => {
    const view = await setup([task()], { view: 'card' })
    await view.controller.duplicate(task())
    await waitFor(() => view.creates.length === 1)
    const payload = view.creates[0] as { dependsOn?: string[]; parentId?: string }
    expect(payload.dependsOn).toBeUndefined()
    expect(payload.parentId).toBeUndefined()
  })
})

describe('hierarchy surface (D6)', () => {
  it('renders the ▸ done/total badge only when the task has direct children', async () => {
    const child = task({ id: 't-child', title: '子任务', parentId: 't-main', status: 'done' })
    const view = await setup([task(), child], { view: 'card' })
    const badge = view.host.querySelector('.dsh-atb-badge[data-kind="subtasks"]')
    expect(badge).not.toBeNull()
    expect(badge!.textContent).toContain('1/1')
    // Neutral outline chip, visually distinct from the dependency chip.
    expect(badge!.getAttribute('title')).toContain('子任务')
    expect(view.host.querySelector('.dsh-atb-badge[data-kind="dependency"]')).toBeNull()

    const without = await setup([task()], { view: 'card' })
    expect(without.host.querySelector('.dsh-atb-badge[data-kind="subtasks"]')).toBeNull()
  })

  it('prefers the host-derived subtaskProgress projection when present', async () => {
    const projected = task({ subtaskProgress: { total: 3, done: 1, open: 2, blocked: 0, missing: 0 } })
    const view = await setup([projected], { view: 'card' })
    const badge = view.host.querySelector('.dsh-atb-badge[data-kind="subtasks"]')
    expect(badge?.textContent).toContain('1/3')
    expect(badge?.getAttribute('title')).toContain('2')
  })

  it('lists direct children in a collapsible Subtasks section and navigates on click', async () => {
    const parent = task({ id: 't-main', title: '父任务', status: 'in_review' })
    const openChild = task({ id: 't-child-a', title: '子任务 A', parentId: 't-main', status: 'todo' })
    const doneChild = task({ id: 't-child-b', title: '子任务 B', parentId: 't-main', status: 'done' })
    const view = await setup([parent, openChild, doneChild], { view: 'detail', focusTask: parent })
    const section = view.host.querySelector('[data-section="task-subtasks"]')!
    expect(section.querySelector('details')).not.toBeNull()
    expect(section.textContent).toContain('子任务 A')
    expect(section.textContent).toContain('子任务 B')
    // in_review parent surfaces the open-child count (no auto-completion, D6).
    expect(section.textContent).toContain('1 个子任务未完成')
    const childButton = [...section.querySelectorAll('button')].find(button => button.textContent === '子任务 A')!
    childButton.click()
    await waitFor(() => view.controller.getSnapshot().selectedId === 't-child-a')
  })

  it('shows a parent breadcrumb at the top of the detail and navigates to the parent', async () => {
    const parent = task({ id: 't-parent', title: '上级任务', status: 'todo' })
    const child = task({ id: 't-main', title: '子卡片', parentId: 't-parent' })
    const view = await setup([parent, child], { view: 'detail', focusTask: child })
    const crumbs = view.host.querySelector('.dsh-atb-crumbs')!
    expect(crumbs.textContent).toContain('上级任务')
    expect(crumbs.textContent).toContain('子卡片')
    crumbs.querySelector<HTMLButtonElement>('.dsh-atb-crumb-link')!.click()
    await waitFor(() => view.controller.getSnapshot().selectedId === 't-parent')
  })

  it('opens the existing create flow prefilled with parentId from "add subtask"', async () => {
    const parent = task({ id: 't-main', title: '父任务' })
    const view = await setup([parent], { view: 'detail' })
    const section = view.host.querySelector('[data-section="task-subtasks"]')!
    const add = [...section.querySelectorAll('button')].find(button => button.textContent?.includes('添加子任务'))!
    add.click()
    await waitFor(() => view.controller.getSnapshot().composerOpen)
    expect(view.controller.getSnapshot().subtaskParentId).toBe('t-main')
    const creates = await submitSubtask('t-main', [parent])
    expect(creates[0]).toMatchObject({ title: '子任务标题', parentId: 't-main' })
  })

  it('copies parentId through duplicate (D8)', async () => {
    const original = task({ parentId: 't-parent' })
    const view = await setup([original], { view: 'card' })
    await view.controller.duplicate(original)
    await waitFor(() => view.creates.length === 1)
    expect(view.creates[0]).toMatchObject({ parentId: 't-parent' })
  })
})

describe('i18n parity for the dependency surface', () => {
  it('keeps zh/en/ru key sets identical', () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(zh).sort())
    expect(Object.keys(ru).sort()).toEqual(Object.keys(zh).sort())
  })

  it('defines every new dependency key in all three dictionaries', () => {
    const keys = [
      'dependency.search', 'dependency.listLabel', 'dependency.noMatches', 'dependency.missing',
      'dependency.missingHint', 'dependency.audit', 'dependency.auditNote', 'dependency.limitReached',
      'dependency.badgeTitle', 'sys.prerequisiteRemoved',
      'hierarchy.subtasks', 'hierarchy.addSubtask', 'hierarchy.empty', 'hierarchy.badgeTitle',
      'hierarchy.breadcrumbLabel', 'hierarchy.openChildren', 'hierarchy.openWarning', 'hierarchy.formSubtitle',
    ] as const
    for (const key of keys) {
      expect(zh).toHaveProperty(key)
      expect(en).toHaveProperty(key)
      expect(ru).toHaveProperty(key)
    }
  })
})

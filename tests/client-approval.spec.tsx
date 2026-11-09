// @vitest-environment jsdom
/**
 * 0.10.1 dependency-change approval — client surface:
 * - card badge (`data-kind="approval"`) only when pendingChanges exist;
 * - detail approval panel: kind, ids with titles, reason, requester, time and
 *   Approve/Reject wiring to the controller routes (Reject carries the note);
 * - Run is disabled with a tooltip naming unmet prerequisites;
 * - the optional-note rejection comment renders without a literal {note}.
 */
import React from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { BoardController } from '../src/client/controller.ts'
import { TaskBoard } from '../src/client/board/TaskBoard.tsx'
import { TaskCard } from '../src/client/board/TaskCard.tsx'
import { TaskFormModal } from '../src/client/board/TaskFormModal.tsx'
import { TaskDetail, commentBody } from '../src/client/board/TaskDetail.tsx'
import type { TaskRecord } from '../src/shared/protocol.ts'
import type { CreateTaskBody, UpdateTaskBody } from '../src/shared/api.ts'
import { disposeI18n, translate } from '../src/client/i18n/runtime.ts'
import { waitFor } from './wait-for.ts'

const cleanups: Array<() => void> = []
beforeEach(() => { localStorage.clear(); document.documentElement.lang = 'zh-CN'; disposeI18n() })
afterEach(() => { cleanups.splice(0).reverse().forEach(fn => fn()); localStorage.clear() })

/** One pending dependency-change request (host shape). */
function change(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'dcr-1',
    kind: 'remove-prerequisites',
    taskId: 't-main',
    remove: ['t-a'],
    reason: '前置任务已合并进主分支',
    requestedBy: { kind: 'agent', sessionId: 'session-taskboard-abc12345' },
    createdAt: 1_000,
    ...extra,
  }
}

/** A task carrying optional host-only fields (pendingChanges). */
function task(extra: Partial<TaskRecord> = {}, pending?: Record<string, unknown>[]): TaskRecord {
  return {
    id: 't-main', title: '主任务', description: '', prompt: '', workspaceId: 'ws-a',
    urgency: 'normal', status: 'todo', blocked: false, execution: { mode: 'claim' },
    version: 1, createdAt: 1, updatedAt: 1,
    createdBy: { kind: 'user' }, updatedBy: { kind: 'user' }, comments: [], executions: [],
    ...(pending !== undefined ? { pendingChanges: pending } : {}),
    ...extra,
  } as unknown as TaskRecord
}

interface Harness {
  controller: BoardController
  host: HTMLElement
  root: Root
  approved: Array<{ taskId: string; changeId: string }>
  rejected: Array<{ taskId: string; changeId: string; note?: string }>
}

async function setup(tasks: TaskRecord[], options: { view?: 'card' | 'detail' | 'board' | 'form'; focusTask?: TaskRecord } = {}): Promise<Harness> {
  const approved: Harness['approved'] = []
  const rejected: Harness['rejected'] = []
  const client = {
    state: async () => ({ schemaVersion: 1, revision: 1, tasks }),
    workspaces: async () => [{ id: 'ws-a', path: '/p/a', title: 'A', sessionCount: 0 }],
    stream: () => () => {},
    approveChange: async (taskId: string, changeId: string) => { approved.push({ taskId, changeId }); return { ok: true } },
    rejectChange: async (taskId: string, changeId: string, body: { note?: string }) => { rejected.push({ taskId, changeId, ...(body.note !== undefined ? { note: body.note } : {}) }); return { ok: true } },
    create: async (_body: CreateTaskBody) => ({ id: 't-new', version: 1 }),
    update: async (_id: string, _body: UpdateTaskBody) => ({ id: tasks[0]?.id ?? 't-main', version: 2 }),
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
    : options.view === 'board'
      ? <TaskBoard controller={controller} />
      : options.view === 'form'
        ? <TaskFormModal controller={controller} task={focusTask} />
        : <TaskDetail task={focusTask} controller={controller} />)
  await waitFor(() => host.querySelector(options.view === 'card' ? '.dsh-atb-card' : options.view === 'board' ? '.dsh-atb-columns' : options.view === 'form' ? '.dsh-atb-taskform-modal' : '.dsh-atb-detail') !== null)
  return { controller, host, root, approved, rejected }
}

/** React-controlled input setter (jsdom does not run React's value tracking). */
function typeInto(input: HTMLInputElement, value: string): void {
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
  setValue.call(input, value)
  input.dispatchEvent(new Event('input', { bubbles: true }))
}

describe('Waiting for Me includes approval requests', () => {
  it('counts and filters approval tasks, even when waitingForHuman is explicitly false', async () => {
    const view = await setup([
      task({ id: 't-appr-1', title: '待审批一' }, [change()]),
      task({ id: 't-appr-2', title: '待审批二' }, [change({ id: 'dcr-2', kind: 'trash-prerequisite', affected: [] })]),
      task({ id: 't-clear', title: '显式清除', waitingForHuman: false }),
    ], { view: 'board' })
    const filter = view.host.querySelector<HTMLButtonElement>('[data-kind="needs-human-filter"]')!
    expect(filter.textContent).toContain('(2)')
    filter.click()
    await waitFor(() => view.host.querySelectorAll('.dsh-atb-card').length === 2)
    expect(view.host.textContent).toContain('待审批一')
    expect(view.host.textContent).toContain('待审批二')
    expect(view.host.textContent).not.toContain('显式清除')
  })
})

describe('dependency-change approval badge', () => {
  it('shows the hand badge only when the task has pending changes', async () => {
    const view = await setup([task({}, [change()])], { view: 'card' })
    const badge = view.host.querySelector('.dsh-atb-badge[data-kind="approval"]')
    expect(badge).not.toBeNull()
    expect(badge!.textContent).toContain('待审批')
    expect(badge!.getAttribute('title')).toContain('1')

    const without = await setup([task()], { view: 'card' })
    expect(without.host.querySelector('.dsh-atb-badge[data-kind="approval"]')).toBeNull()
  })
})

describe('detail approval panel', () => {
  it('renders kind, ids with titles, reason and requester; Approve calls the route', async () => {
    const prerequisite = task({ id: 't-a', title: '前置 A' })
    const view = await setup([task({ dependsOn: ['t-a'] }, [change()]), prerequisite], { view: 'detail' })
    const panel = view.host.querySelector('.dsh-atb-approval')!
    expect(panel).not.toBeNull()
    expect(panel.textContent).toContain('移除前置依赖')
    expect(panel.textContent).toContain('前置 A')
    expect(panel.textContent).toContain('t-a')
    expect(panel.textContent).toContain('前置任务已合并进主分支')
    expect(panel.textContent).toContain('abc12345')

    const approve = [...panel.querySelectorAll('button')].find(button => button.textContent === '批准')!
    expect(approve.getAttribute('data-primary')).toBe('true')
    approve.click()
    await waitFor(() => view.approved.length === 1)
    expect(view.approved[0]).toEqual({ taskId: 't-main', changeId: 'dcr-1' })
  })

  it('Reject forwards the optional note and disables while busy', async () => {
    const view = await setup([task({}, [change({ kind: 'trash-prerequisite', taskId: 't-main', remove: undefined, affected: ['t-dep'] })]), task({ id: 't-dep', title: '依赖方' })], { view: 'detail' })
    const panel = view.host.querySelector('.dsh-atb-approval')!
    expect(panel.textContent).toContain('删除前置任务')
    expect(panel.textContent).toContain('依赖方')
    const note = panel.querySelector<HTMLInputElement>('input')!
    expect(note.getAttribute('aria-label')).toContain('拒绝备注')
    typeInto(note, '先别删，等迭代结束')
    const reject = [...panel.querySelectorAll('button')].find(button => button.textContent === '拒绝')!
    reject.click()
    await waitFor(() => view.rejected.length === 1)
    expect(view.rejected[0]).toEqual({ taskId: 't-main', changeId: 'dcr-1', note: '先别删，等迭代结束' })
  })
})

describe('run blocked by unmet prerequisites', () => {
  it('disables Run and lists the unmet prerequisite titles in the tooltip', async () => {
    const blocked = await setup([
      task({ dependsOn: ['t-a'] }),
      task({ id: 't-a', title: '前置 A', status: 'todo' }),
    ], { view: 'detail' })
    const run = [...blocked.host.querySelectorAll<HTMLButtonElement>('.dsh-atb-detail-run')]
      .find(button => button.textContent?.includes('立即执行'))!
    expect(run.disabled).toBe(true)
    expect(run.getAttribute('title')).toContain('前置任务未完成')
    expect(run.getAttribute('title')).toContain('前置 A')

    const ready = await setup([
      task({ dependsOn: ['t-a'] }),
      task({ id: 't-a', title: '前置 A', status: 'done' }),
    ], { view: 'detail' })
    const enabled = [...ready.host.querySelectorAll<HTMLButtonElement>('.dsh-atb-detail-run')]
      .find(button => button.textContent?.includes('立即执行'))!
    expect(enabled.disabled).toBe(false)
  })

  it('disables the edit form Run now while a prerequisite is unmet', async () => {
    const view = await setup([
      task({ dependsOn: ['t-a'] }),
      task({ id: 't-a', title: '前置 A', status: 'todo' }),
    ], { view: 'form' })
    const runNow = [...view.host.querySelectorAll<HTMLButtonElement>('button')]
      .find(button => button.textContent?.includes('立即执行'))!
    expect(runNow.disabled).toBe(true)
    expect(runNow.getAttribute('title')).toContain('前置 A')
  })
})

describe('rejection comment localization', () => {
  const base = { id: 'c-1', body: 'x', version: 1, createdAt: 1 }
  it('omits the literal {note} when the rejection carries no note', () => {
    const text = commentBody(translate, {
      ...base,
      systemKey: 'sys.dcr.rejected',
      systemParams: { kind: 'remove-prerequisites', ids: 't-a', reason: 'x' },
    })
    expect(text).toContain('用户已拒绝')
    expect(text).not.toContain('{note}')
  })

  it('renders the note when present', () => {
    const text = commentBody(translate, {
      ...base,
      systemKey: 'sys.dcr.rejected',
      systemParams: { kind: 'remove-prerequisites', ids: 't-a', reason: 'x', note: '先别删' },
    })
    expect(text).toContain('先别删')
  })
})

/**
 * QA (Agent D) — agent-observability contract (§7.8 / F6) and the D5
 * "agents can never reach done" regression gate.
 *
 * The tool `render()` output is what the MODEL actually reads (the registry
 * feeds result.content, never the raw JSON), so these assertions are the
 * model-facing contract, not cosmetics.
 *
 * @module dsh-taskboard/tests/qa/agent-observability
 */
import { afterEach, describe, expect, it } from 'vitest'
import { createQaHost, QA_WS, type QaHost } from './harness.ts'

const hosts: QaHost[] = []
afterEach(async () => {
  while (hosts.length > 0) await hosts.pop()!.dispose()
})

async function host(): Promise<QaHost> {
  const h = await createQaHost()
  hosts.push(h)
  return h
}

async function createTask(h: QaHost, title: string, extra: Record<string, unknown> = {}): Promise<string> {
  const res = await h.post('/dsh-taskboard/tasks', { title, workspaceId: QA_WS.id, urgency: 'normal', ...extra })
  expect(res.status).toBe(201)
  return res.json.value.id as string
}

async function move(h: QaHost, id: string, status: string): Promise<void> {
  const res = await h.post(`/dsh-taskboard/tasks/${id}/move`, { ifVersion: h.store.get(id)!.version, status })
  expect(res.status).toBe(200)
}

describe('QA — agent tool observability (§7.8 / F6)', () => {
  it('taskboard_list marks a dependent as waiting and, once unblocked, executable', async () => {
    const h = await host()
    const a = await createTask(h, 'A')
    const b = await createTask(h, 'B', { dependsOn: [a] })

    const blockedList = await h.tool('taskboard_list', {})
    const blockedText = h.render('taskboard_list', {}, blockedList)
    expect(blockedText).toContain(b)
    expect(blockedText).toContain('等待前置1项')

    await move(h, a, 'in_progress')
    await move(h, a, 'in_review')
    await move(h, a, 'done')

    const readyList = await h.tool('taskboard_list', {})
    const readyText = h.render('taskboard_list', {}, readyList)
    expect(readyText).toContain('可执行')
  })

  it('taskboard_get explains per-prerequisite state and the downstream unblock list', async () => {
    const h = await host()
    const a = await createTask(h, 'A')
    const b = await createTask(h, 'B', { dependsOn: [a] })

    const bGet = await h.tool('taskboard_get', { id: b })
    const bText = h.render('taskboard_get', { id: b }, bGet)
    expect(bText).toContain('前置未满足')
    expect(bText).toContain('pending 未完成')
    expect(bText).toContain(a)

    const aGet = await h.tool('taskboard_get', { id: a })
    const aText = h.render('taskboard_get', { id: a }, aGet)
    expect(aText).toContain('完成后可解锁 1 个下游任务')
    expect(aText).toContain(b)

    await move(h, a, 'in_progress')
    await move(h, a, 'in_review')
    await move(h, a, 'done')
    const bGet2 = await h.tool('taskboard_get', { id: b })
    const bText2 = h.render('taskboard_get', { id: b }, bGet2)
    expect(bText2).toContain('前置就绪')
    expect(bText2).toContain('done 已完成')
  })

  it('taskboard_get renders a MISSING prerequisite distinctly (no silent wait)', async () => {
    const h = await host()
    const b = await createTask(h, 'B')
    // Simulate a hand-edited/legacy ledger with a dangling prerequisite id.
    await h.store.mutate('task-updated', ledger => {
      const task = ledger.tasks.find(t => t.id === b)!
      task.dependsOn = ['ghost-prerequisite']
      task.version += 1
      return [task]
    })
    const got = await h.tool('taskboard_get', { id: b })
    const text = h.render('taskboard_get', { id: b }, got)
    expect(text).toContain('missing 缺失')
    expect(text).toContain('（任务已删除或不存在）')
    expect(text).toContain('缺失/已删除 1 项')
  })

  it('taskboard_get exposes hierarchy: parent link and direct-child progress', async () => {
    const h = await host()
    const parent = await createTask(h, 'parent')
    const child = await createTask(h, 'child', { parentId: parent })
    const parentText = h.render('taskboard_get', { id: parent }, await h.tool('taskboard_get', { id: parent }))
    expect(parentText).toContain('子任务进度: 完成 0/1')
    const childText = h.render('taskboard_get', { id: child }, await h.tool('taskboard_get', { id: child }))
    expect(childText).toContain(`父任务: ${parent}`)
  })

  it('D5 regression: an agent can NEVER move a task to done', async () => {
    const h = await host()
    const a = await createTask(h, 'A')
    await move(h, a, 'in_progress')
    await move(h, a, 'in_review')
    const version = h.store.get(a)!.version
    await expect(h.tool('taskboard_move', { id: a, status: 'done', ifVersion: version })).rejects.toThrow(/done|forbidden|user/i)
    expect(h.store.get(a)!.status).toBe('in_review')
  })
})

describe('QA — tool write entry points reject invalid prerequisites (§7.5)', () => {
  it('taskboard_create/taskboard_update refuse duplicate, missing, self and cycle links', async () => {
    const h = await host()
    const a = await createTask(h, 'A')
    const b = await createTask(h, 'B', { dependsOn: [a] })
    // create: duplicate
    await expect(h.tool('taskboard_create', { title: 'dup', workspaceId: QA_WS.id, urgency: 'normal', dependsOn: [a, a] })).rejects.toThrow(/duplicate/i)
    // create: missing
    await expect(h.tool('taskboard_create', { title: 'miss', workspaceId: QA_WS.id, urgency: 'normal', dependsOn: ['ghost-id'] })).rejects.toThrow(/missing|not found/i)
    // update: self
    await expect(h.tool('taskboard_update', { id: a, ifVersion: h.store.get(a)!.version, dependsOn: [a] })).rejects.toThrow(/self/i)
    // update: indirect cycle A -> B -> A
    await expect(h.tool('taskboard_update', { id: a, ifVersion: h.store.get(a)!.version, dependsOn: [b] })).rejects.toThrow(/cycle/i)
    // Nothing was written by the rejected calls.
    expect(h.store.get(a)!.dependsOn).toBeUndefined()
    expect(h.store.get(b)!.dependsOn).toEqual([a])
  })
})

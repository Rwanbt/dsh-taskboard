// @vitest-environment jsdom
import { createElement, act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ExternalSyncPanel } from '../src/client/board/ExternalSyncPanel.tsx'
import { ExternalSourcePanel } from '../src/client/board/ExternalSourcePanel.tsx'
import { SettingsModal } from '../src/client/board/SettingsModal.tsx'
import type { BoardController } from '../src/client/controller.ts'
import { createBuiltinProviders } from '../src/host/external-providers.ts'
import type { TaskRecord } from '../src/shared/protocol.ts'
import { waitFor } from './wait-for.ts'
import { chooseSelect, selectByIndex, selectOptionLabels, selectText, type SelectTrigger } from './select-helpers.ts'

let root: Root | undefined
beforeEach(() => { vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true) })
afterEach(async () => { await act(async () => { root?.unmount() }); root = undefined; document.body.innerHTML = ''; vi.unstubAllGlobals() })
const choose = async (trigger: SelectTrigger, label: string) => {
  await act(async () => { chooseSelect(trigger, label) })
}
const buttonByText = (host: Element, pattern: RegExp) => [...host.querySelectorAll<HTMLButtonElement>('button')].find(b => pattern.test(b.textContent ?? ''))!

describe('provider-driven external UI', () => {
  it('blocks synchronization of stale settings until a successful save', async () => {
    let config = { provider: 'zentao', mappingMode: 'execution', account: 'alice', baseUrl: 'https://zentao.test', authMode: 'password', itemTypes: ['bug'], settings: {}, since: '', intervalMinutes: 0, mappings: [] }
    let failSave = false
    vi.stubGlobal('fetch', vi.fn(async (input: unknown, init?: RequestInit) => {
      if (String(input).endsWith('/config') && init?.method === 'POST') {
        if (failSave) return new Response(JSON.stringify({ ok: false, error: 'Save failed' }), { status: 500 })
        config = JSON.parse(String(init.body))
      }
      return new Response(JSON.stringify({ ok: true, value: String(input).endsWith('/workspaces') ? [] : {
        config, providers: createBuiltinProviders().list(), credentialValues: { username: 'alice' }, credentialPresent: { password: true }, running: false,
      } }))
    }))
    const host = document.createElement('div'); document.body.append(host); root = createRoot(host)
    await act(async () => { root!.render(createElement(ExternalSyncPanel)) })
    await waitFor(() => host.querySelector<HTMLInputElement>('input[autocomplete=username]')?.value === 'alice')
    const sync = buttonByText(host, /^立即同步$|^Sync now$/)
    const task = [...host.querySelectorAll<HTMLInputElement>('input[type=checkbox]')].find(i => /^(任务|Task)$/.test(i.parentElement?.textContent ?? ''))!
    expect(sync.disabled).toBe(false)
    await act(async () => { task.click() })
    expect(sync.disabled).toBe(true)
    expect(host.textContent).toMatch(/有未保存的修改|You have unsaved changes/)
    expect(buttonByText(host, /^测试连接$|^Test connection$/).disabled).toBe(false)
    await act(async () => { task.click() })
    expect(sync.disabled).toBe(false)
    await act(async () => { task.click() })
    failSave = true
    await act(async () => { buttonByText(host, /保存配置|Save configuration/).click() })
    expect(sync.disabled).toBe(true)
    failSave = false
    await act(async () => { buttonByText(host, /保存配置|Save configuration/).click() })
    expect(sync.disabled).toBe(false)
    expect(host.textContent).not.toMatch(/有未保存的修改|You have unsaved changes/)
    expect(config.itemTypes).toContain('task')
  })
  it('separates general/external settings with left tabs and retains drafts while switching', async () => {
    const providers = createBuiltinProviders().list()
    vi.stubGlobal('fetch', vi.fn(async (input: unknown) => new Response(JSON.stringify({ ok: true, value: String(input).endsWith('/workspaces') ? [] : { providers, running: false, credentialPresent: {} } }))))
    const controller = {
      getSnapshot: () => ({ ledger: { tasks: [], settings: {} } }), fetchModelCatalog: async () => [], fetchPresetCatalog: async () => ({ presets: [] }),
      closeSettings: vi.fn(), updateSettings: vi.fn(async () => true),
    } as unknown as BoardController
    const host = document.createElement('div'); document.body.append(host); root = createRoot(host)
    await act(async () => { root!.render(createElement(SettingsModal, { controller })) })
    const tabs = [...host.querySelectorAll<HTMLButtonElement>('[role=tab]')]
    const panels = [...host.querySelectorAll<HTMLElement>('[role=tabpanel]')]
    expect(tabs).toHaveLength(2)
    expect(panels[0]!.hidden).toBe(false); expect(panels[1]!.hidden).toBe(true)
    await act(async () => { panels[0]!.querySelectorAll<HTMLButtonElement>('.dsh-atb-mode-opt')[1]!.click() })
    await act(async () => { tabs[1]!.click() })
    expect(panels[0]!.hidden).toBe(true); expect(panels[1]!.hidden).toBe(false)
    expect(host.querySelector('.dsh-atb-modal-foot')).toBeNull()
    await waitFor(() => selectText(selectByIndex(panels[1]!, 0)).includes('ZenTao'))
    expect(panels[1]!.querySelectorAll('input[type=password]')).toHaveLength(1)
    const auth = selectByIndex(panels[1]!, 1)
    expect(selectText(auth)).toContain('Username and password')
    await act(async () => {
      expect(selectOptionLabels(auth).some(label => label.includes('Token'))).toBe(false)
    })
    await choose(selectByIndex(panels[1]!, 0), 'TAPD')
    await act(async () => { tabs[0]!.click() })
    expect(panels[0]!.querySelectorAll<HTMLElement>('.dsh-atb-mode-opt')[1]!.dataset.on).toBe('true')
    await act(async () => { tabs[0]!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })) })
    expect(tabs[1]!.getAttribute('aria-selected')).toBe('true')
    expect(selectText(selectByIndex(panels[1]!, 0))).toContain('TAPD')
  })
  it('renders auth fields and item types from descriptors, discovers projects, submits generic config', async () => {
    const calls: Array<{ path: string; body: Record<string, unknown> }> = []
    const providers = createBuiltinProviders().list()
    let saved: Record<string, unknown> | undefined
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input)
      const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : {}
      if (init?.method === 'POST') {
        calls.push({ path, body })
        if (path.endsWith('/config')) saved = body
        return new Response(JSON.stringify({ ok: true, value: path.endsWith('/projects') ? [{ id: body.provider === 'zentao' ? 'project:123' : '123', name: 'Team project' }] : {} }))
      }
      return new Response(JSON.stringify({ ok: true, value: path.endsWith('/workspaces') ? [{ id: 'ws', title: 'Local' }] : {
        providers, config: saved, credentialValues: saved?.provider === 'zentao' ? { username: (saved.credentials as Record<string, string>).username } : {}, credentialPresent: saved ? { accessToken: true } : {}, running: false, ignoredCount: 0,
      } }))
    }))
    const host = document.createElement('div'); document.body.append(host); root = createRoot(host)
    await act(async () => { root!.render(createElement(ExternalSyncPanel)) })
    await act(async () => {
      // Wait until the provider select is populated from the descriptors; the
      // provider set itself is host-owned and grows with new integrations.
      await waitFor(() => {
        if (host.querySelectorAll('.dsh-atb-sel').length === 0) return false
        const labels = selectOptionLabels(selectByIndex(host, 0))
        return labels.includes('ZenTao') && labels.includes('TAPD')
      })
    })
    const selects = () => [...host.querySelectorAll<SelectTrigger>('.dsh-atb-sel')]
    await choose(selects()[0]!, 'TAPD')
    expect(selectText(selects()[1]!)).toContain('Basic Auth')
    expect(host.querySelectorAll('input[type=password]')).toHaveLength(2)
    // 3 item types + the assignee filter (the dedupe checkbox is GitHub-only).
    expect(host.querySelectorAll('input[type=checkbox]')).toHaveLength(4)
    expect((host.querySelector('input') as HTMLInputElement).value).toBe('https://api.tapd.cn')
    await choose(selects()[1]!, 'Bearer Token')
    expect(host.querySelectorAll('input[type=password]')).toHaveLength(1)
    const inputs = [...host.querySelectorAll<HTMLInputElement>('input')]
    const update = async (input: HTMLInputElement, value: string) => {
      await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value)
        input.dispatchEvent(new Event('input', { bubbles: true }))
      })
    }
    await update(inputs[1]!, 'alice')
    await update(host.querySelector<HTMLInputElement>('input[type=password]')!, 'private-access-token')
    const settingsInputs = [...host.querySelectorAll<HTMLInputElement>('input')]
    const company = settingsInputs.find(i => i.parentElement?.textContent?.match(/公司 ID|Company ID/))!
    await update(company, '999')
    const testButton = buttonByText(host, /^测试连接$|^Test connection$/)
    expect(testButton.disabled).toBe(false)
    expect(testButton.nextElementSibling?.textContent).toMatch(/同步项目|Sync project/)
    await act(async () => { testButton.click() })
    expect(calls.at(-1)).toMatchObject({ path: '/dsh-taskboard/external/test', body: { provider: 'tapd', credentials: { accessToken: 'private-access-token' }, mappings: [] } })
    expect(calls.some(c => c.path.endsWith('/config'))).toBe(false)
    await act(async () => { buttonByText(host, /同步项目|Sync project/).click() })
    const scopeTrigger = () => host.querySelector<SelectTrigger>('.dsh-atb-external-mapping .dsh-atb-sel')!
    await act(async () => {
      await waitFor(() => selectOptionLabels(scopeTrigger()).some(label => label.includes('Team project')))
    })
    expect(calls.at(-1)).toMatchObject({ path: '/dsh-taskboard/external/projects', body: { provider: 'tapd', authMode: 'bearer', account: 'alice', mappings: [], settings: { companyId: '999' } } })
    await choose(scopeTrigger(), 'Team project')
    await choose(selects()[2]!, 'Todo')
    await choose(selects()[4]!, 'Local')
    await act(async () => { buttonByText(host, /保存配置|Save configuration/).click() })
    await waitFor(() => calls.some(c => c.path.endsWith('/config')))
    expect(calls.at(-1)!.body).toMatchObject({ provider: 'tapd', authMode: 'bearer', importStatus: 'todo', credentials: { accessToken: 'private-access-token' }, itemTypes: ['bug'], mappings: [{ projectId: '123', workspaceId: 'ws' }] })
    await waitFor(() => host.querySelector<HTMLInputElement>('input[type=password]')?.value === '')
    expect(host.textContent).not.toContain('private-access-token')
    await choose(selects()[0]!, 'ZenTao')
    expect(selectText(selects()[1]!)).toContain('Username and password')
    expect(host.querySelectorAll('input[type=checkbox]')).toHaveLength(6)
    expect(host.querySelector<HTMLInputElement>('input[type=password]')!.value).toBe('')
    await update(host.querySelector<HTMLInputElement>('input[autocomplete=username]')!, 'login-alice')
    const reuse = host.querySelector<HTMLInputElement>('input[type=checkbox]')!
    expect(reuse.checked).toBe(true)
    await act(async () => { buttonByText(host, /同步项目|Sync project/).click() })
    expect(calls.at(-1)!.body.account).toBe('login-alice')
    await choose(host.querySelector<SelectTrigger>('.dsh-atb-external-mapping .dsh-atb-sel')!, 'Local')
    await act(async () => { reuse.click() })
    const assignee = [...host.querySelectorAll<HTMLInputElement>('input')].find(i => /任务处理人账号|Task assignee/.test(i.parentElement?.textContent ?? ''))!
    await update(assignee, 'other-bob')
    await act(async () => { buttonByText(host, /保存配置|Save configuration/).click() })
    expect(calls.at(-1)!.body.account).toBe('other-bob')
    await act(async () => { reuse.click() })
    await act(async () => { buttonByText(host, /保存配置|Save configuration/).click() })
    expect(calls.at(-1)!.body.account).toBe('login-alice')
  })
  it('lists all scopes, preserves associations, flags unavailable rows, and clears drafts when changing modes', async () => {
    const requests: Array<Record<string, unknown>> = []
    let available = true
    vi.stubGlobal('fetch', vi.fn(async (input: unknown, init?: RequestInit) => {
      const path = String(input)
      if (init?.method === 'POST') {
        const body = JSON.parse(String(init.body)); requests.push(body)
        const projects = body.mappingMode === 'execution'
          ? [{ id: 'execution:3', name: 'Project / Sprint' }]
          : available ? [{ id: 'project:1', name: 'First project' }, { id: 'project:2', name: 'Second project' }] : [{ id: 'project:2', name: 'Second project' }]
        return new Response(JSON.stringify({ ok: true, value: path.endsWith('/projects') ? projects : {} }))
      }
      return new Response(JSON.stringify({ ok: true, value: path.endsWith('/workspaces') ? [{ id: 'ws', title: 'Local' }] : { providers: createBuiltinProviders().list(), running: false, credentialPresent: {} } }))
    }))
    const host = document.createElement('div'); document.body.append(host); root = createRoot(host)
    await act(async () => { root!.render(createElement(ExternalSyncPanel)) })
    await waitFor(() => host.querySelectorAll('input[type=radio]').length === 2)
    expect(host.querySelector<HTMLInputElement>('input[type=radio][value=project]')!.checked).toBe(true)
    expect(host.textContent).toMatch(/同步范围|Sync scope/)
    const refresh = () => act(async () => { buttonByText(host, /同步项目|Sync project/).click() })
    await refresh()
    expect(requests[0]).toMatchObject({ mappingMode: 'project', itemTypes: ['bug'], mappings: [] })
    expect(host.querySelectorAll('.dsh-atb-external-mapping')).toHaveLength(2)
    const first = host.querySelector<SelectTrigger>('.dsh-atb-external-mapping .dsh-atb-sel')!
    expect(selectText(first)).toContain('Not linked')
    expect(host.querySelector('.dsh-atb-external-remove')).toBeNull()
    await choose(first, 'Local')
    await refresh()
    expect(selectText(host.querySelector<SelectTrigger>('.dsh-atb-external-mapping .dsh-atb-sel')!)).toContain('Local')
    await act(async () => { buttonByText(host, /保存配置|Save configuration/).click() })
    expect(requests.at(-1)).toMatchObject({ mappingMode: 'project', mappings: [{ projectId: 'project:1', workspaceId: 'ws' }] })
    available = false; await refresh()
    expect(host.querySelectorAll('.dsh-atb-external-mapping')).toHaveLength(2)
    expect(host.querySelector('[role=alert]')!.textContent).toMatch(/无法读取|not readable/)
    expect(buttonByText(host, /保存配置|Save configuration/).disabled).toBe(true)
    await act(async () => { host.querySelector<HTMLInputElement>('input[type=radio][value=execution]')!.click() })
    expect(host.querySelectorAll('.dsh-atb-external-mapping')).toHaveLength(0)
    await refresh()
    expect(requests.at(-1)).toMatchObject({ mappingMode: 'execution', itemTypes: ['bug'], mappings: [] })
    expect(host.textContent).toContain('Project / Sprint')
    expect(host.textContent).not.toContain('Second project')
    expect(host.querySelector('.dsh-atb-external-mapping input')).toBeNull()
    await choose(host.querySelector<SelectTrigger>('.dsh-atb-external-mapping .dsh-atb-sel')!, 'Local')
    await act(async () => { buttonByText(host, /保存配置|Save configuration/).click() })
    expect(requests.at(-1)).toMatchObject({ mappingMode: 'execution', mappings: [{ projectId: 'execution:3', workspaceId: 'ws' }] })
  })
  it('retains legacy credentials but requires reassociation before synchronizing', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: unknown) => new Response(JSON.stringify({ ok: true, value: String(input).endsWith('/workspaces') ? [] : {
      providers: createBuiltinProviders().list(), config: { provider: 'zentao', account: 'alice', baseUrl: 'https://zentao.test', authMode: 'password', itemTypes: ['bug'], settings: {}, since: '', intervalMinutes: 5, mappings: [{ projectId: '1', workspaceId: 'ws' }] },
      credentialValues: { username: 'alice' }, credentialPresent: { password: true }, requiresMappingReview: true, running: false,
    } }))))
    const host = document.createElement('div'); document.body.append(host); root = createRoot(host)
    await act(async () => { root!.render(createElement(ExternalSyncPanel)) })
    await waitFor(() => host.querySelector('[role=alert]') !== null)
    expect(host.querySelector('[role=alert]')!.textContent).toMatch(/重新关联|Reassociate/)
    expect(host.querySelector<HTMLInputElement>('input[autocomplete=username]')!.value).toBe('alice')
    expect(host.querySelectorAll('.dsh-atb-external-mapping')).toHaveLength(0)
    expect(buttonByText(host, /立即同步|Sync now/).disabled).toBe(true)
  })
  it('saves unmapped synchronization without requiring a local project and changes its label with the mode', async () => {
    let saved: Record<string, unknown> | undefined
    vi.stubGlobal('fetch', vi.fn(async (input: unknown, init?: RequestInit) => {
      if (init?.method === 'POST') { saved = JSON.parse(String(init.body)); return new Response('{"ok":true,"value":{}}') }
      return new Response(JSON.stringify({ ok: true, value: String(input).endsWith('/workspaces') ? [] : { providers: createBuiltinProviders().list(), running: false, credentialPresent: {} } }))
    }))
    const host = document.createElement('div'); document.body.append(host); root = createRoot(host)
    await act(async () => { root!.render(createElement(ExternalSyncPanel)) })
    await waitFor(() => host.textContent?.includes('同步未关联项目') === true || host.textContent?.includes('Sync unlinked projects') === true)
    const toggle = [...host.querySelectorAll<HTMLInputElement>('input[type=checkbox]')].find(i => /同步未关联项目|Sync unlinked projects/.test(i.parentElement?.textContent ?? ''))!
    expect(toggle.checked).toBe(false)
    expect(buttonByText(host, /保存配置|Save configuration/).disabled).toBe(false)
    await act(async () => { toggle.click() })
    expect(buttonByText(host, /保存配置|Save configuration/).disabled).toBe(false)
    await act(async () => { host.querySelector<HTMLInputElement>('input[type=radio][value=execution]')!.click() })
    expect(host.textContent).toMatch(/同步未关联执行\/迭代|Sync unlinked executions/)
    expect(toggle.checked).toBe(true)
    await act(async () => { buttonByText(host, /保存配置|Save configuration/).click() })
    expect(saved).toMatchObject({ includeUnmapped: true, mappingMode: 'execution', mappings: [] })
  })
  it.each(['alice', 'bob'])('restores saved assignee %s without replacing another account', async account => {
    vi.stubGlobal('fetch', vi.fn(async (input: unknown) => new Response(JSON.stringify({ ok: true, value: String(input).endsWith('/workspaces') ? [] : {
      providers: createBuiltinProviders().list(), config: { provider: 'zentao', account, baseUrl: 'https://zentao.test', authMode: 'password', itemTypes: ['bug'], settings: {}, since: '', intervalMinutes: 0, mappings: [] },
      credentialValues: { username: 'alice' }, credentialPresent: { username: true, password: true }, running: false,
    } }))))
    const host = document.createElement('div'); document.body.append(host); root = createRoot(host)
    await act(async () => { root!.render(createElement(ExternalSyncPanel)) })
    await waitFor(() => host.querySelector<HTMLInputElement>('input[autocomplete=username]')?.value === 'alice')
    expect(host.querySelector<HTMLInputElement>('input[type=checkbox]')!.checked).toBe(account === 'alice')
    const assignee = [...host.querySelectorAll<HTMLInputElement>('input')].find(i => /任务处理人账号|Task assignee/.test(i.parentElement?.textContent ?? ''))
    if (account === 'bob') expect(assignee?.value).toBe('bob')
    else expect(assignee).toBeUndefined()
  })
  it('renders TAPD provenance and dispatches conflict resolution without ZenTao branding', async () => {
    const requests: unknown[] = []
    vi.stubGlobal('fetch', vi.fn(async (_input: unknown, init?: RequestInit) => {
      requests.push(JSON.parse(String(init?.body))); return new Response(JSON.stringify({ ok: true, value: {} }))
    }))
    const task = { id: 't-external', version: 7, status: 'in_review', external: { connectionId: 'c', provider: 'tapd', providerName: 'TAPD', syncedAt: 1, conflicts: ['title'],
      item: { projectId: '1', type: 'story', id: '123', url: 'https://www.tapd.cn/1/prong/stories/view/123', title: 'Remote', description: 'Details', urgency: 'normal', priority: 'medium', status: 'planning', assignedTo: 'alice', closed: false } } } as TaskRecord
    const host = document.createElement('div'); document.body.append(host); root = createRoot(host)
    await act(async () => { root!.render(createElement(ExternalSourcePanel, { task })) })
    expect(host.querySelector('a')!.textContent).toContain('TAPD')
    expect(host.textContent).not.toContain('ZenTao')
    await act(async () => { buttonByText(host, /采用外部|Use external/).click() })
    expect(requests[0]).toEqual({ taskId: task.id, field: 'title', acceptExternal: true, ifVersion: 7 })
  })
})

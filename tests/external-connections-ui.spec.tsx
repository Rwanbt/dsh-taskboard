// @vitest-environment jsdom
/**
 * Connection-manager UI suite (contract v1: several external connections).
 *
 * The host exposes every configured connection plus per-connection run state.
 * These tests drive the three surfaces the manager owes the user:
 * 1. a compact list with one row per connection, whose actions always carry
 *    that row's `connectionId` (sync / enable / remove),
 * 2. "Edit" loading the whole stored connection into the existing form (and
 *    saving with `connectionId` rather than appending), plus "New connection"
 *    emptying it and asking the host for `createNew`,
 * 3. the two-way-sync consent block and the declared adapter capabilities,
 *    which must never appear for a read-only provider.
 *
 * A legacy status without `connections` is also covered: the component falls
 * back to `[status.config]` so older hosts keep working (see external-ui.spec).
 */
import { createElement, act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ExternalSyncPanel } from '../src/client/board/ExternalSyncPanel.tsx'
import { createBuiltinProviders } from '../src/host/external-providers.ts'
import type { ExternalConnection, ExternalSyncStatus } from '../src/shared/external.ts'
import { waitFor } from './wait-for.ts'
import { chooseSelect, selectByIndex, selectText } from './select-helpers.ts'

let root: Root | undefined
beforeEach(() => { vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true) })
afterEach(async () => {
  await act(async () => { root?.unmount() })
  root = undefined
  document.body.innerHTML = ''
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

const providers = createBuiltinProviders().list()
const defaults = (id: string) => Object.fromEntries((providers.find(p => p.id === id)?.settingsFields ?? []).map(field => [field.key, field.defaultValue]))

const githubConnection: ExternalConnection = {
  id: 'conn-gh', provider: 'github', baseUrl: 'https://api.github.com', account: 'alice', authMode: 'token',
  label: 'GitHub main', enabled: true, direction: 'bidirectional',
  itemTypes: ['issue'], mappings: [{ projectId: 'acme/repo', workspaceId: 'ws' }], settings: defaults('github'),
  since: '', intervalMinutes: 0, importStatus: 'backlog', assigneeFilter: true, matchExisting: true,
}
const gitlabConnection: ExternalConnection = {
  id: 'conn-gl', provider: 'gitlab', baseUrl: 'https://gitlab.com/api/v4', account: 'bob', authMode: 'token',
  label: 'GitLab mirror', enabled: false, direction: 'inbound',
  itemTypes: ['issue'], mappings: [{ projectId: 'group/proj', workspaceId: 'ws' }], settings: defaults('gitlab'),
  since: '', intervalMinutes: 15, importStatus: 'todo', assigneeFilter: false, matchExisting: false,
}

const status: ExternalSyncStatus = {
  config: githubConnection,
  credentialPresent: { token: true },
  providers,
  running: false,
  ignoredCount: 0,
  contractVersion: 1,
  connections: [githubConnection, gitlabConnection],
  connectionStates: {
    'conn-gh': { running: false, ignoredCount: 2,
      lastResult: { created: 2, updated: 1, unchanged: 3, conflicts: 0, ignored: 0, at: 1_700_000_000_000 } },
    'conn-gl': { running: false, lastError: 'Bad credentials', ignoredCount: 0 },
  },
}

/** Stub the same-origin routes: status on GET, captured JSON body on POST. */
function stubFetch(value: ExternalSyncStatus) {
  const calls: Array<{ path: string; body: Record<string, unknown> }> = []
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input)
    if (path.endsWith('/workspaces')) return new Response(JSON.stringify({ ok: true, value: [{ id: 'ws', title: 'Local' }] }))
    if (init?.method === 'POST') {
      const body = init.body === undefined ? {} : JSON.parse(String(init.body)) as Record<string, unknown>
      calls.push({ path, body })
      return new Response(JSON.stringify({ ok: true, value: path.endsWith('/config') ? { id: 'conn-new' } : {} }))
    }
    return new Response(JSON.stringify({ ok: true, value }))
  }))
  return calls
}

const mount = async () => {
  const host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  await act(async () => { root!.render(createElement(ExternalSyncPanel)) })
  return host
}
const buttonByText = (host: Element, pattern: RegExp) => [...host.querySelectorAll<HTMLButtonElement>('button')].find(b => pattern.test(b.textContent ?? ''))!
const row = (host: Element, id: string) => host.querySelector<HTMLElement>(`.dsh-atb-external-connection[data-connection-id="${id}"]`)!
const click = async (element: Element | null) => { await act(async () => { (element as HTMLElement).click() }) }

describe('external connection manager', () => {
  it('lists every connection with its state and scopes each action to its own id', async () => {
    const calls = stubFetch(status)
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
    const host = await mount()
    await waitFor(() => host.querySelectorAll('.dsh-atb-external-connection').length === 2)

    expect(row(host, 'conn-gh').textContent).toContain('GitHub main')
    expect(row(host, 'conn-gh').textContent).toMatch(/Enabled/)
    expect(row(host, 'conn-gh').textContent).toMatch(/Last sync:/)
    expect(row(host, 'conn-gh').textContent).toMatch(/2 excluded/)
    expect(row(host, 'conn-gl').textContent).toContain('GitLab mirror')
    expect(row(host, 'conn-gl').textContent).toMatch(/Disabled/)
    expect(row(host, 'conn-gl').querySelector('.dsh-atb-external-conn-error')?.textContent).toContain('Bad credentials')

    // Per-connection sync: the row sends ITS id (no global round).
    await click(row(host, 'conn-gl').querySelector('[data-action="sync"]'))
    await waitFor(() => calls.some(call => call.path.endsWith('/external/sync')))
    expect(calls.filter(call => call.path.endsWith('/external/sync')).map(call => call.body)).toEqual([{ connectionId: 'conn-gl' }])

    // Enable/disable toggles the stored flag of that connection only.
    await click(row(host, 'conn-gh').querySelector('[data-action="toggle"]'))
    await waitFor(() => calls.some(call => call.path.endsWith('/external/enabled')))
    expect(calls.filter(call => call.path.endsWith('/external/enabled')).map(call => call.body)).toEqual([{ connectionId: 'conn-gh', enabled: false }])

    // Deletion asks first, then removes that id.
    await click(row(host, 'conn-gl').querySelector('[data-action="remove"]'))
    await waitFor(() => calls.some(call => call.path.endsWith('/external/remove')))
    expect(confirm).toHaveBeenCalledTimes(1)
    expect(calls.filter(call => call.path.endsWith('/external/remove')).map(call => call.body)).toEqual([{ connectionId: 'conn-gl' }])
  })

  it('loads a connection into the form, saves with its id, and appends a new one', async () => {
    const calls = stubFetch(status)
    const host = await mount()
    await waitFor(() => host.querySelectorAll('.dsh-atb-external-connection').length === 2)

    const inputs = () => [...host.querySelectorAll<HTMLInputElement>('input')]
    const byLabel = (pattern: RegExp) => inputs().find(input => pattern.test(input.parentElement?.textContent ?? ''))
    const configBodies = () => calls.filter(call => call.path.endsWith('/external/config')).map(call => call.body)

    await click(row(host, 'conn-gl').querySelector('[data-action="edit"]'))
    await waitFor(() => byLabel(/API base URL|API 基础地址/)?.value === 'https://gitlab.com/api/v4')
    // Every stored field is restored into the existing form.
    expect(selectText(selectByIndex(host, 0))).toBe('GitLab')
    expect(byLabel(/Sync account|同步账号/)?.value).toBe('bob')
    expect(byLabel(/Auto-sync interval|自动同步间隔/)?.value).toBe('15')
    await waitFor(() => host.querySelector('.dsh-atb-external-conn-editing')?.textContent?.includes('GitLab mirror') === true)

    await click(buttonByText(host, /^Save configuration$|^保存配置$/))
    await waitFor(() => configBodies().length === 1)
    // Editing updates THAT connection: id in the body, never a duplicate.
    expect(configBodies()[0]).toMatchObject({ connectionId: 'conn-gl', provider: 'gitlab', account: 'bob', direction: 'inbound', intervalMinutes: 15 })

    await click(host.querySelector('[data-action="new"]'))
    await waitFor(() => selectText(selectByIndex(host, 0)) === 'ZenTao')
    expect(byLabel(/API base URL|API 基础地址/)?.value).toBe('')
    expect(host.querySelector('.dsh-atb-external-conn-editing')).toBeNull()

    await click(buttonByText(host, /^Save configuration$|^保存配置$/))
    await waitFor(() => configBodies().length === 2)
    expect(configBodies()[1]).toMatchObject({ provider: 'zentao', createNew: true })
  })

  it('offers two-way sync and real capabilities only when the adapter declares them', async () => {
    stubFetch(status)
    const host = await mount()
    await waitFor(() => host.querySelectorAll('.dsh-atb-external-connection').length === 2)
    const twoWay = () => [...host.querySelectorAll<HTMLInputElement>('input[type=checkbox]')]
      .find(input => /Two-way sync|双向同步/.test(input.parentElement?.textContent ?? ''))
    const capabilities = () => host.querySelector('.dsh-atb-external-capabilities')?.textContent ?? ''

    await waitFor(() => twoWay() !== undefined)
    // GitHub declares outbound + write: the opt-in box reflects the stored choice…
    expect(twoWay()!.checked).toBe(true)
    // …and carries an explicit warning while it is on.
    expect(host.textContent).toMatch(/writes local changes back|写入远端/)
    // Capabilities come from the descriptor, never invented.
    await waitFor(() => capabilities().includes('Contract version v1'))
    expect(capabilities()).toMatch(/Code hosting/)
    expect(capabilities()).toContain('Create work item')
    expect(capabilities()).toContain('Polling')
    expect(capabilities()).toMatch(/Writable/)

    // A read-only adapter (ZenTao) never shows the write consent block.
    await act(async () => { chooseSelect(selectByIndex(host, 0), 'ZenTao') })
    await waitFor(() => twoWay() === undefined)
    expect(host.textContent).toMatch(/Read-only/)
    expect(capabilities()).toContain('Validate connection')
    expect(capabilities()).not.toContain('Create work item')
    expect(capabilities()).not.toContain('Webhook')
  })

  it('falls back to the primary connection when a legacy status has no connection list', async () => {
    stubFetch({
      config: githubConnection, credentialPresent: { token: true }, providers, running: false, ignoredCount: 3,
      lastResult: { created: 1, updated: 0, unchanged: 2, conflicts: 0, ignored: 0, at: 1_700_000_000_000 },
      lastAttemptAt: 1_700_000_000_000,
    })
    const host = await mount()
    await waitFor(() => host.querySelectorAll('.dsh-atb-external-connection').length === 1)
    const legacy = host.querySelector('.dsh-atb-external-connection')!
    expect(legacy.textContent).toContain('GitHub main')
    expect(legacy.textContent).toMatch(/Last sync:/)
    expect(legacy.textContent).toMatch(/3 excluded/)
    expect(host.querySelector('.dsh-atb-external-conn-empty')).toBeNull()
  })
})

// @vitest-environment jsdom
/**
 * External push (write-back) UI suite.
 *
 * The per-task panel is provider-driven: write-back availability comes from
 * the connection status (`providers[].capabilities.write`) and the workspace
 * mappings, never from the provider id. These tests drive the three visible
 * states the host contract allows:
 * 1. a linked task on a write-capable connection,
 * 2. an unlinked task whose workspace is mapped to several repositories,
 * 3. an unlinked task on a read-only provider (renders nothing).
 */
import { createElement, act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ExternalSourcePanel } from '../src/client/board/ExternalSourcePanel.tsx'
import type {
  ExternalConnection,
  ExternalPushOutcome,
  ExternalSyncStatus,
  ProviderDescriptor,
} from '../src/shared/external.ts'
import type { TaskRecord } from '../src/shared/protocol.ts'
import { waitFor } from './wait-for.ts'
import { chooseSelect, selectByLabel, selectOptionLabels, selectText } from './select-helpers.ts'

let root: Root | undefined
beforeEach(() => { vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true) })
afterEach(async () => { await act(async () => { root?.unmount() }); root = undefined; document.body.innerHTML = ''; vi.unstubAllGlobals() })
const buttonByText = (host: Element, pattern: RegExp) => [...host.querySelectorAll<HTMLButtonElement>('button')].find(b => pattern.test(b.textContent ?? ''))!

/** GitHub-shaped descriptor: the write capability is the only thing that matters here. */
const github: ProviderDescriptor = {
  id: 'github',
  name: 'GitHub',
  scopeLabel: 'ext.repoScope',
  defaultBaseUrl: 'https://api.github.com',
  settingsFields: [
    { key: 'urgentLabels', label: 'ext.urgentLabels', defaultValue: '' },
    { key: 'relaxedLabels', label: 'ext.relaxedLabels', defaultValue: '' },
  ],
  authModes: [{ id: 'pat', label: 'ext.githubToken', fields: [{ key: 'token', label: 'ext.githubToken', secret: true }] }],
  capabilities: { itemTypes: ['issue'], projectDiscovery: true, accountDiscovery: true, pagination: 'page', incremental: true, write: true },
}
const zentao: ProviderDescriptor = {
  id: 'zentao',
  name: 'ZenTao',
  scopeLabel: 'ext.productScope',
  defaultBaseUrl: 'https://zentao.test',
  authModes: [{ id: 'password', label: 'ext.usernamePassword', fields: [{ key: 'password', label: 'ext.password', secret: true }] }],
  capabilities: { itemTypes: ['bug'], projectDiscovery: true, accountDiscovery: false, pagination: 'page', incremental: false },
}

const connection = (provider: string, mappings: Array<{ projectId: string; workspaceId: string }>): ExternalConnection => ({
  id: 'c1', provider, baseUrl: 'https://api.github.com', account: 'alice', authMode: 'pat',
  itemTypes: ['issue'], mappings, settings: {}, since: '', intervalMinutes: 0,
})

const statusOf = (provider: ProviderDescriptor, mappings: Array<{ projectId: string; workspaceId: string }>): ExternalSyncStatus => ({
  config: connection(provider.id, mappings), credentialPresent: {}, running: false,
  providers: [provider], ignoredCount: 0,
})

const pushed: ExternalPushOutcome = {
  created: false,
  pushed: ['title'],
  item: {
    projectId: 'acme/repo', type: 'issue', id: '42', url: 'https://github.com/acme/repo/issues/42',
    status: 'open', priority: 'high', assignedTo: 'alice', title: 'Remote title', description: 'Remote body',
    urgency: 'normal', closed: false,
  },
}

/**
 * Stub the same-origin routes: status on GET, JSON body captured on POST.
 * A `pushError` flips the push route to the documented HTTP 400 failure.
 */
function stubFetch(value: ExternalSyncStatus, pushError?: string, pushValue: ExternalPushOutcome = pushed) {
  const calls: Array<{ path: string; body?: Record<string, unknown> }> = []
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input)
    const body = init?.body === undefined ? undefined : JSON.parse(String(init.body)) as Record<string, unknown>
    calls.push({ path, ...(body === undefined ? {} : { body }) })
    if (path.endsWith('/push')) {
      if (pushError !== undefined) return new Response(JSON.stringify({ ok: false, error: { message: pushError } }), { status: 400 })
      return new Response(JSON.stringify({ ok: true, value: pushValue }))
    }
    return new Response(JSON.stringify({ ok: true, value }))
  }))
  return calls
}

const linkedTask = {
  id: 't-linked', workspaceId: 'ws', version: 7, status: 'in_review',
  external: {
    connectionId: 'c1', provider: 'github', providerName: 'GitHub', syncedAt: 1_700_000_000_000, conflicts: [],
    item: {
      projectId: 'acme/repo', type: 'issue', id: '42', url: 'https://github.com/acme/repo/issues/42',
      title: 'Local title', description: 'Details', urgency: 'normal', priority: 'high',
      status: 'open', assignedTo: 'alice', closed: false,
    },
  },
} as unknown as TaskRecord

const unlinkedTask = { id: 't-new', workspaceId: 'ws', version: 1, status: 'todo', external: undefined } as unknown as TaskRecord

const mount = async (task: TaskRecord) => {
  const host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  await act(async () => { root!.render(createElement(ExternalSourcePanel, { task })) })
  return host
}

describe('external push UI', () => {
  it('pushes local changes for a linked task on a write-capable connection', async () => {
    const calls = stubFetch(statusOf(github, [{ projectId: 'acme/repo', workspaceId: 'ws' }]))
    const host = await mount(linkedTask)
    // Existing provenance UI is untouched by the status read.
    expect(host.querySelector('a')!.textContent).toContain('GitHub')
    await waitFor(() => buttonByText(host, /^Push local changes$/) !== undefined)
    const push = buttonByText(host, /^Push local changes$/)
    expect(push.disabled).toBe(false)
    await act(async () => { push.click() })
    await waitFor(() => host.textContent?.includes('Pushed to the remote tracker.') === true)
    expect(calls.filter(call => call.path.endsWith('/push')).map(call => call.body)).toEqual([{ taskId: 't-linked' }])
    expect(host.querySelector('[role=alert]')).toBeNull()
    expect(push.disabled).toBe(false)
  })

  it('reports an empty push and a failing push without losing the card', async () => {
    stubFetch(statusOf(github, [{ projectId: 'acme/repo', workspaceId: 'ws' }]), undefined, { ...pushed, pushed: [] })
    const host = await mount(linkedTask)
    await waitFor(() => buttonByText(host, /^Push local changes$/) !== undefined)
    await act(async () => { buttonByText(host, /^Push local changes$/).click() })
    await waitFor(() => host.textContent?.includes('Nothing to push.') === true)

    stubFetch(statusOf(github, [{ projectId: 'acme/repo', workspaceId: 'ws' }]), 'Bad credentials')
    await act(async () => { buttonByText(host, /^Push local changes$/).click() })
    await waitFor(() => host.querySelector('[role=alert]')?.textContent === 'Bad credentials')
  })

  it('creates an external issue into the picked repository for an unlinked mapped task', async () => {
    const calls = stubFetch(statusOf(github, [
      { projectId: 'acme/one', workspaceId: 'ws' },
      { projectId: 'acme/two', workspaceId: 'ws' },
      { projectId: 'acme/other', workspaceId: 'ws-elsewhere' },
    ]))
    const host = await mount(unlinkedTask)
    await act(async () => { await waitFor(() => host.querySelector('.dsh-atb-sel') !== null) })
    expect(host.textContent).toContain('Create an issue in the linked remote repository and link this card to it.')
    const target = selectByLabel(host, 'Target repository')
    // Only the repositories mapped to THIS workspace are offered, first by default.
    expect(selectText(target)).toBe('acme/one')
    let labels: string[] = []
    await act(async () => { labels = selectOptionLabels(target) })
    expect(labels).toEqual(['acme/one', 'acme/two'])
    await act(async () => { chooseSelect(target, 'acme/two') })
    expect(selectText(target)).toBe('acme/two')
    const create = buttonByText(host, /^Create external issue$/)
    await act(async () => { create.click() })
    await waitFor(() => host.textContent?.includes('External issue created and linked.') === true)
    expect(calls.filter(call => call.path.endsWith('/push')).map(call => call.body)).toEqual([{ taskId: 't-new', scope: 'acme/two' }])
  })

  it('renders nothing for an unlinked task on a read-only provider', async () => {
    const calls = stubFetch(statusOf(zentao, [{ projectId: '1', workspaceId: 'ws' }]))
    const host = await mount(unlinkedTask)
    await waitFor(() => calls.length > 0)
    // Let the status response settle, then assert the panel stayed hidden.
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)) })
    expect(host.querySelector('.dsh-atb-diag-sec')).toBeNull()
    expect(host.textContent).toBe('')
    expect(calls.some(call => call.path.endsWith('/push'))).toBe(false)
  })
})

// Regression for audit A04: a host restart/reconcile must NOT invalidate a
// still-running EXTERNAL execution. Uses an isolated temporary ledger.
import { it, expect } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PublicApiService } from '../../src/host/public-api.ts'
import { ExecutionService } from '../../src/host/execution.ts'
import { TaskStore } from '../../src/host/store.ts'
import { PUBLIC_API_PREFIX } from '../../src/shared/public-api.ts'

it('AUDIT A04: reconciliation keeps a still-running remote external claim alive', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'audit-external-reconcile-'))
  const store = new TaskStore({ file: join(dir, 'tasks.json') })
  const workspaces = { attach: async () => {}, list: () => [{ id: 'ws', title: 'Audit', path: dir }], get: (id: string) => id === 'ws' ? { id: 'ws', title: 'Audit', path: dir } : undefined }
  const api = new PublicApiService({ store, workspaces, now: () => 1000, token: () => 'audit-token' })
  const host = new ExecutionService({ store, workspaces, now: () => 2000, agents: {} as any, events: { onSessionEvent: () => () => {} }, liveAgent: () => undefined })
  async function call(path: string, body: Record<string, unknown>) {
    let status = 0; let raw = ''
    const res = { writeHead: (value: number) => { status = value }, write: (chunk: string) => { raw += chunk; return true }, end: (chunk?: string) => { raw += chunk ?? '' } }
    await api.handle({ method: 'POST', headers: { authorization: 'Bearer audit-token' } } as any, res as any, new URL(`http://localhost${PUBLIC_API_PREFIX}${path}`), body)
    return { status, body: JSON.parse(raw) }
  }
  try {
    await store.mutate('task-created', ledger => {
      const task = { id: 't-audit', title: 'Remote engine work', description: '', prompt: '', workspaceId: 'ws', urgency: 'normal' as const, status: 'todo' as const, blocked: false, execution: { mode: 'claim' as const }, version: 1, createdAt: 1, updatedAt: 1, createdBy: { kind: 'user' as const }, updatedBy: { kind: 'user' as const }, comments: [], executions: [] }
      ledger.tasks.push(task); return [task]
    })
    const claimed = await call('/executions/claim', { taskId: 't-audit', actor: 'remote-engine', idempotencyKey: 'audit-claim' })
    expect(claimed.status).toBeLessThan(300)
    const executionId = claimed.body.value.execution.executionId
    expect(store.get('t-audit')!.executions[0]).toMatchObject({ managedBy: 'external', outcome: 'running' })
    // The remote worker remains alive; only the DSH host restarts/reconciles.
    await host.reconcile()
    expect(store.get('t-audit')!).toMatchObject({ status: 'in_progress', executions: [{ managedBy: 'external', outcome: 'running' }] })
    expect(store.get('t-audit')!.claimedBy).toBe('remote-engine')
    // The remote completion still settles: the host never declared it failed.
    const completed = await call(`/executions/${executionId}/complete`, { actor: 'remote-engine', outcome: 'succeeded' })
    expect(completed.status).toBeLessThan(300)
    expect(store.get('t-audit')!.executions[0]).toMatchObject({ managedBy: 'external', outcome: 'succeeded' })
    expect(store.get('t-audit')!.executions[0]!.attempts?.[0]).toMatchObject({ outcome: 'succeeded' })
  } finally { host.dispose(); api.dispose(); await rm(dir, { recursive: true, force: true }) }
})

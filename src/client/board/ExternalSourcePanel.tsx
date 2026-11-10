/**
 * Per-task external provenance block (and, for write-capable providers, the
 * opt-in push controls).
 *
 * Two modes, decided by the task and the host-side connection status:
 * - a linked task shows the existing source/conflict UI plus "Push local
 *   changes" when the configured provider advertises `capabilities.write`;
 * - an unlinked task whose workspace is mapped shows the "create external
 *   issue" flow (with a repository picker when several mappings target it).
 *
 * Everything about write-back is host policy: the panel only reacts to
 * `status.providers[].capabilities.write`, it never infers capability from
 * the provider id. The host persists the link and the board refreshes over
 * SSE, so a successful create needs no local task mutation here.
 *
 * @module dsh-taskboard/client/board/ExternalSourcePanel
 */
import { useEffect, useState } from 'react'
import type { TaskRecord } from '../../shared/protocol.ts'
import {
  normalizeExternalSource,
  type ExternalPushOutcome,
  type ExternalSyncStatus,
} from '../../shared/external.ts'
import { useT } from '../i18n/runtime.ts'
import { externalRequest, externalTypeLabel } from '../external-api.ts'
import { Select } from './Select.tsx'

export function ExternalSourcePanel({ task }: { task: TaskRecord }) {
  const t = useT()
  const [status, setStatus] = useState<ExternalSyncStatus>()
  const [scope, setScope] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const source = normalizeExternalSource(task.external)

  // One status read per mount; failures only hide write-back controls, the
  // existing source/conflict UI must keep working without the connection.
  useEffect(() => {
    let active = true
    void externalRequest<ExternalSyncStatus>('').then(next => { if (active) setStatus(next) }).catch(() => {})
    return () => { active = false }
  }, [])

  const configured = status?.config
  const writeCapable = status?.providers?.find(provider => provider.id === configured?.provider)?.capabilities.write === true
  const targets = writeCapable && configured !== undefined
    ? [...new Set(configured.mappings.filter(mapping => mapping.workspaceId === task.workspaceId).map(mapping => mapping.projectId))]
    : []
  const target = targets.includes(scope) ? scope : targets[0] ?? ''
  if (source === undefined && targets.length === 0) return null

  const resolve = async (field: string, acceptExternal: boolean) => {
    setBusy(true); setError(''); setMessage('')
    try { await externalRequest('/resolve', { taskId: task.id, field, acceptExternal, ifVersion: task.version }) }
    catch (e) { setError(e instanceof Error ? e.message : String(e)) }
    finally { setBusy(false) }
  }
  const push = async (body: { taskId: string; scope?: string }, done: (result: ExternalPushOutcome) => string) => {
    setBusy(true); setError(''); setMessage('')
    try {
      const result = await externalRequest<ExternalPushOutcome>('/push', body)
      setMessage(done(result))
    } catch (e) { setError(e instanceof Error ? e.message : String(e)) }
    finally { setBusy(false) }
  }
  return <section className="dsh-atb-diag-sec">
    <h4>{t('ext.source')}</h4>
    {source === undefined ? <>
      <p>{t('ext.pushNewHint')}</p>
      {targets.length > 1 && <label>{t('ext.pushTarget')}<Select
        full
        ariaLabel={t('ext.pushTarget')}
        value={target}
        onChange={setScope}
        options={targets.map(id => ({ value: id, label: id }))}
      /></label>}
      <button type="button" disabled={busy || target === ''}
        onClick={() => void push({ taskId: task.id, scope: target }, () => t('ext.pushCreated'))}>{t('ext.pushNew')}</button>
    </> : <>
      <a href={source.item.url} target="_blank" rel="noopener noreferrer">{source.providerName ?? source.provider} · {externalTypeLabel(source.item.type, t)} #{source.item.id}</a>
      <p>{t('ext.status')}: {source.item.status} · {source.item.assignedTo}</p>
      <p>{t('ext.synced')}: {new Date(source.syncedAt).toLocaleString()}</p>
      {source.conflicts.map(field => <div key={field}>
        <p>{t('ext.conflict', { field: t(`ext.field.${field}`) })}</p>
        <pre style={{ whiteSpace: 'pre-wrap', maxHeight: 160, overflow: 'auto' }}>{source.item[field]}</pre>
        <button type="button" disabled={busy || task.status === 'in_progress'} onClick={() => void resolve(field, true)}>{t('ext.accept')}</button>
        <button type="button" disabled={busy || task.status === 'in_progress'} onClick={() => void resolve(field, false)}>{t('ext.keep')}</button>
      </div>)}
      {writeCapable && <button type="button" disabled={busy}
        onClick={() => void push({ taskId: task.id }, result => result.pushed.length > 0 ? t('ext.pushDone') : t('ext.pushNothing'))}>{t('ext.push')}</button>}
    </>}
    {message && <p role="status">{message}</p>}
    {error && <p role="alert">{error}</p>}
  </section>
}

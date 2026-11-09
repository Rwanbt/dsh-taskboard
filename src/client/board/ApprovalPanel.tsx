/**
 * Pending dependency-change approvals (0.10.1): the host stores agent requests
 * on the task (`pendingChanges`) and waits for an explicit user decision. This
 * panel is the user surface: one row per request with the kind, affected ids
 * (titles when resolvable), the agent's reason, requester + time, and the
 * Approve / Reject actions. Approve is primary; Reject carries an optional note
 * the agent reads from the audit comment.
 *
 * The panel is intentionally built from the existing board classes
 * (`dsh-atb-fieldcard`, `dsh-atb-bubble`, `dsh-atb-prereq-row`, `dsh-atb-btn`,
 * `dsh-atb-input`) plus the single `dsh-atb-approval` root hook.
 *
 * @module dsh-taskboard/client/board/ApprovalPanel
 */
import { useState } from 'react'
import type { BoardController } from '../controller.ts'
import type { DependencyChangeRequest, TaskRecord } from '../../shared/protocol.ts'
import { fmtTime } from './format.ts'
import { useAlert } from './AlertModal.tsx'
import { Icon } from './Icon.tsx'
import { useT } from '../i18n/runtime.ts'

/** One pending request as the client renders it (shared host shape). */
export type PendingChangeView = DependencyChangeRequest

/** Compact session-id display (execution sessions carry the taskboard infix). */
function shortSession(id: string): string {
  return id.replace(/^session-(taskboard-)?/, '').slice(0, 8)
}

/**
 * Render the pending approval requests of one task.
 * @param task - the task carrying the requests.
 * @param changes - pending requests (non-empty).
 * @param controller - approve/reject actions.
 * @param resolveTitle - id → task title when the card is known locally.
 */
export function ApprovalPanel({ task, changes, controller, resolveTitle }: {
  task: TaskRecord
  changes: readonly PendingChangeView[]
  controller: BoardController
  resolveTitle: (id: string) => string | undefined
}) {
  const t = useT()
  const { alert: showAlert, el: alertEl } = useAlert()
  const [busyId, setBusyId] = useState<string | undefined>(undefined)
  const [notes, setNotes] = useState<Record<string, string>>({})

  const labelOf = (id: string): string => {
    const title = resolveTitle(id)
    return title === undefined || title === id ? id : `${title} (${id})`
  }

  const decide = (change: PendingChangeView, approve: boolean): void => {
    if (busyId !== undefined) return
    setBusyId(change.id)
    const action = approve
      ? controller.approveChange(task.id, change.id)
      : controller.rejectChange(task.id, change.id, notes[change.id])
    void action.then(ok => {
      if (ok) {
        setNotes(previous => {
          if (previous[change.id] === undefined) return previous
          const next = { ...previous }
          delete next[change.id]
          return next
        })
        return
      }
      showAlert(t('approval.failed', { error: controller.getSnapshot().error ?? '' }))
    }).finally(() => setBusyId(undefined))
  }

  if (changes.length === 0) return null

  return (
    <div className="dsh-atb-approval dsh-atb-fieldcard" data-kind="approval">
      <div className="dsh-atb-fieldcard-label">
        <Icon name="hand" /> {t('approval.title')}
        <span className="dsh-atb-count2">{changes.length}</span>
      </div>
      <div className="dsh-atb-commentlist">
        {changes.map(change => {
          const busy = busyId !== undefined
          const ids = change.kind === 'trash-prerequisite' ? change.affected ?? [] : change.remove ?? []
          const summary = change.kind === 'trash-prerequisite'
            ? t('approval.affected', { ids: ids.map(labelOf).join(', ') })
            : t('approval.removes', { ids: ids.map(labelOf).join(', ') })
          return (
            <div key={change.id} className="dsh-atb-bubble" data-from="system">
              <div className="dsh-atb-bubble-avatar"><Icon name="hand" /></div>
              <div className="dsh-atb-bubble-main">
                <div className="dsh-atb-prereq-row">
                  <span className="dsh-atb-badge">
                    {change.kind === 'trash-prerequisite' ? t('approval.kind.trash') : t('approval.kind.remove')}
                  </span>
                  <span className="dsh-atb-prereq-state">{summary}</span>
                </div>
                <div className="dsh-atb-prereq-missing-hint">{t('approval.reason', { reason: change.reason })}</div>
                <div className="dsh-atb-prereq-row">
                  <span className="dsh-atb-prereq-audit">
                    <Icon name="bot" size={12} /> {t('approval.requestedBy', { id: shortSession(change.requestedBy.sessionId) })} · {fmtTime(change.createdAt)}
                  </span>
                </div>
                <div className="dsh-atb-prereq-row">
                  <input
                    className="dsh-atb-input"
                    value={notes[change.id] ?? ''}
                    maxLength={500}
                    disabled={busy}
                    aria-label={t('approval.rejectNote')}
                    placeholder={t('approval.rejectPlaceholder')}
                    onChange={event => setNotes(previous => ({ ...previous, [change.id]: event.target.value }))}
                  />
                  <button type="button" className="dsh-atb-btn" data-primary="true" disabled={busy}
                    onClick={() => decide(change, true)}>{t('approval.approve')}</button>
                  <button type="button" className="dsh-atb-btn" data-danger="true" disabled={busy}
                    onClick={() => decide(change, false)}>{t('approval.reject')}</button>
                </div>
              </div>
            </div>
          )
        })}
      </div>
      {alertEl}
    </div>
  )
}

/**
 * One board card, "DeepSeek Pastel" layout: project + id header, dominant
 * title, clamped description, deliverable block, semantic flags, a hairline
 * separator and a footer carrying the priority label and the update time.
 *
 * The card is a fully tinted pastel surface (see styles.ts): the tone comes
 * from the task id (stable hash) or from the user's local override, and is
 * completely independent from `urgency` — a violet card can be urgent, the
 * priority stays explicit in the footer and in the status/flag badges.
 *
 * Preserved contracts (do not weaken):
 * - single click opens the detail pane; double click jumps to the session;
 * - only the controller's allowed transitions are offered (quick review
 *   actions on in_review cards, drag on backlog/todo cards);
 * - every business alert (blocked, approval, human wait, dependency, subtasks,
 *   stale claim, permissions, unchecked checklist, external conflicts) stays
 *   visible on the card.
 *
 * @module dsh-taskboard/client/board/TaskCard
 */
import { useEffect, useRef, useState, type CSSProperties, type MouseEvent } from 'react'
import type { BoardController } from '../controller.ts'
import { taskSessionId, type TaskRecord } from '../../shared/protocol.ts'
import { dependencyState } from '../../shared/dependencies.ts'
import { subtaskProgress } from '../../shared/hierarchy.ts'
import { checkNeedsHuman, fmtTime, isStaleClaim } from './format.ts'
import { OUTCOME_KEYS, URGENCY_KEYS, statusText } from './labels.ts'
import { Icon } from './Icon.tsx'
import { useT } from '../i18n/runtime.ts'
import { externalTypeLabel } from '../external-api.ts'
import { resolveWorkspaceName } from './project-label.ts'
import { resolveTaskColor } from './coloring.ts'
import { useAppearance } from './appearance.ts'
import { categoriesOf } from '../../shared/protocol.ts'

/** dataTransfer type carrying the dragged task id. */
export const DRAG_TYPE = 'application/x-dsh-atb-task'

/**
 * Finger travel (px) above which a gesture is a swipe/pan, not a tap. Below it
 * a tap keeps its historic meaning: open the detail pane.
 */
export const SWIPE_TAP_SLOP = 10

/**
 * How long after a touch a click still counts as that gesture's tail. Browsers
 * emit the synthetic click within a few hundred milliseconds of `touchend`;
 * after this window the click is an independent input (mouse, trackpad) and
 * must never be swallowed by a stale touch origin.
 */
export const SWIPE_TAP_WINDOW_MS = 800

/** Compact session-id display (execution sessions carry the taskboard infix). */
export function shortId(id: string | undefined): string {
  if (id === undefined) return ''
  return id.replace(/^session-(taskboard-)?/, '').slice(0, 8)
}

/**
 * Resolve the most relevant session ID associated with a task.
 * Thin alias over the shared {@link taskSessionId} so the card and the detail
 * pane can never drift apart again (they had two copies, and the detail pane's
 * copy had lost the originating-conversation fallback).
 */
export const resolveTaskSessionId = taskSessionId

/**
 * The card view.
 * @param task - the task record.
 * @param controller - the controller.
 * @param draggable - enable dragging.
 * @param now - current epoch ms (stale-claim highlight).
 * @param onAlert - show an alert message (replaces native alert).
 */
export function TaskCard({ task, controller, draggable = false, now, onAlert }: { task: TaskRecord; controller: BoardController; draggable?: boolean; now?: number; onAlert?: (msg: string) => void }) {
  const t = useT()
  const appearance = useAppearance()
  const [rejectOpen, setRejectOpen] = useState(false)
  const [note, setNote] = useState('')
  const last = task.executions.length > 0 ? task.executions[task.executions.length - 1] : undefined
  const running = task.executions.find(ex => ex.outcome === 'running')
  const stale = now !== undefined && isStaleClaim(task, now)
  const reviewing = task.status === 'in_review' && task.trashedAt === undefined
  const dependency = task.dependencyProgress ?? dependencyState(task, controller.getSnapshot().ledger.tasks)
  // 0.10.1: agent-proposed dependency changes awaiting the user's decision.
  const pendingApprovals = task.pendingChanges ?? []
  // The card badge is information, never an error: its tooltip carries the
  // actual prerequisite names + statuses (the detail belongs there, not on the
  // card). Missing/trashed ids are resolved from the loaded ledger; a
  // prerequisite omitted by the collapsed completed column still shows its id.
  const dependencyTitle = (task.dependsOn ?? []).map(id => {
    const source = controller.getSnapshot().ledger.tasks.find(item => item.id === id)
    if (source !== undefined && source.trashedAt === undefined) {
      return `${source.title} (${statusText(t, source.status)})`
    }
    // The loaded ledger omits done cards while the completed column is
    // collapsed; the host-derived projection still tells missing from merely
    // not-loaded, so only genuinely dangling ids are labelled as deleted.
    if (dependency.missingIds.includes(id)) return `${source?.title ?? id} (${t('dependency.missing')})`
    return source?.title ?? id
  }).join(' · ')
  // Hierarchy progress (D6/D9): prefer the host's derived projection, fall
  // back to counting the loaded ledger. Only shown when direct children exist.
  const subtasks = task.subtaskProgress ?? subtaskProgress(task.id, controller.getSnapshot().ledger.tasks)
  const subtaskTitle = t('hierarchy.badgeTitle', { done: subtasks.done, total: subtasks.total, open: subtasks.open })
  const needsHuman = checkNeedsHuman(task, t)
  // Manual claims have no execution envelope: their report lives on the task.
  const latestReport = last?.report ?? task.report
  const latestWithGit = last
  const targetSessionId = resolveTaskSessionId(task)
  const sessionTitle = controller.getSessionTitle(targetSessionId)
  const clickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Touch bookkeeping for the focus-mode carousel: a pan that starts on a card
  // and travels horizontally must never be read as a tap on that card.
  const touchOriginRef = useRef<{ x: number, y: number, at: number } | null>(null)
  // One resolver for the four colour modes (never duplicated here). The result
  // is a pair of CSS custom properties, so a theme switch needs no re-render.
  const cardColor = resolveTaskColor({
    task,
    categories: categoriesOf(controller.getSnapshot().ledger.settings),
    preferences: appearance,
  })
  const categoryLabel = cardColor.unclassified ? t('category.unclassified') : cardColor.category.name
  const projectName = resolveWorkspaceName(
    task.workspaceId,
    controller.getSnapshot().workspaces,
    t('board.workspace.unassigned'),
  )
  const checklistDone = task.checklist?.filter(item => item.checked).length ?? 0
  const checklistTotal = task.checklist?.length ?? 0
  const checklistPct = checklistTotal > 0 ? Math.round(checklistDone / checklistTotal * 100) : 0

  useEffect(() => {
    return () => {
      if (clickTimerRef.current !== null) {
        clearTimeout(clickTimerRef.current)
        clickTimerRef.current = null
      }
    }
  }, [])

  /** Submit the quick-reject: one atomic route (move + optional note). */
  const submitReject = (): void => {
    void controller.reject(task.id, task.version, note).then(ok => {
      if (ok) { setRejectOpen(false); setNote('') }
      // On failure the error surface explains; the form stays open for retry.
    })
  }

  /**
   * True when the click is the tail of a horizontal swipe (or a vertical pan)
   * that started on this card. A real tap stays within the slop, and a click
   * arriving after the touch window is a fresh input, so both keep their exact
   * previous behaviour.
   */
  const isSwipeTail = (e: MouseEvent): boolean => {
    const origin = touchOriginRef.current
    touchOriginRef.current = null
    if (origin === null) return false
    if (Date.now() - origin.at > SWIPE_TAP_WINDOW_MS) return false
    const dx = Math.abs(e.clientX - origin.x)
    const dy = Math.abs(e.clientY - origin.y)
    return dx > SWIPE_TAP_SLOP || dy > SWIPE_TAP_SLOP
  }

  /** Single-click handler: debounce when a target session exists so double-click won't open details if closed. */
  const handleClick = (e: MouseEvent): void => {
    // A horizontal pan is the focus-mode carousel swipe, never a tap: some
    // webviews still emit the synthetic click at the end of the gesture.
    if (isSwipeTail(e)) return
    if (e.target !== e.currentTarget && (e.target as HTMLElement).closest('button, input, textarea')) return

    // If no target session, or this task's detail is ALREADY open, select immediately
    if (targetSessionId === undefined || controller.getSnapshot().selectedId === task.id) {
      controller.select(task.id)
      return
    }

    // Otherwise, debounce single click so double-click can jump to session WITHOUT opening details
    if (clickTimerRef.current !== null) {
      clearTimeout(clickTimerRef.current)
    }
    clickTimerRef.current = setTimeout(() => {
      clickTimerRef.current = null
      controller.select(task.id)
    }, 250)
  }

  /** Double-click opens the associated session conversation directly without opening details. */
  const handleDoubleClick = (e: MouseEvent): void => {
    if (clickTimerRef.current !== null) {
      clearTimeout(clickTimerRef.current)
      clickTimerRef.current = null
    }

    // Only the card surface itself, ignore nested buttons/inputs (like quick-reject controls)
    if (e.target !== e.currentTarget && (e.target as HTMLElement).closest('button, input, textarea')) return
    if (targetSessionId !== undefined) {
      void controller.openSession(targetSessionId).then(result => {
        if (result === 'missing') {
          const msg = t('card.session.missing', { id: shortId(targetSessionId) })
          if (onAlert !== undefined) onAlert(msg)
          else alert(msg)
        } else if (result === 'archived') {
          const msg = t('card.session.archived', { id: shortId(targetSessionId) })
          if (onAlert !== undefined) onAlert(msg)
          else alert(msg)
        } else if (result === 'unavailable') {
          const msg = t('card.session.unavailable', { id: targetSessionId })
          if (onAlert !== undefined) onAlert(msg)
          else alert(msg)
        }
      })
    }
  }

  return (
    <div
      role="button"
      tabIndex={0}
      className="dsh-atb-card"
      data-urgency={task.urgency}
      data-tone={cardColor.tone}
      data-color-mode={cardColor.mode}
      data-workspace={task.workspaceId}
      data-category={cardColor.unclassified ? undefined : cardColor.category.id}
      data-needs-human={needsHuman.needs ? 'true' : undefined}
      style={{ '--atb-card-bg': cardColor.background, '--atb-tone-accent': cardColor.accent } as CSSProperties}
      draggable={draggable && !rejectOpen}
      onDragStart={(e) => {
        // Block drag if a session is still executing this task
        if (running !== undefined) {
          e.preventDefault()
          const msg = t('card.drag.running', { title: task.title })
          if (onAlert !== undefined) onAlert(msg)
          else alert(msg)
          return
        }
        e.dataTransfer.setData(DRAG_TYPE, task.id)
        e.dataTransfer.effectAllowed = 'move'
        e.currentTarget.dataset.dragging = 'true'
      }}
      onDragEnd={(e) => { delete e.currentTarget.dataset.dragging }}
      onTouchStart={(e) => {
        const touch = e.touches[0]
        touchOriginRef.current = touch === undefined ? null : { x: touch.clientX, y: touch.clientY, at: Date.now() }
      }}
      onTouchCancel={() => { touchOriginRef.current = null }}
      onClick={handleClick}
      onDoubleClick={handleDoubleClick}
      onKeyDown={(e) => {
        // Only the card itself (not the nested quick-action controls).
        if (e.target !== e.currentTarget) return
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          controller.select(task.id)
        }
      }}
    >
      <div className="dsh-atb-card-top">
        <span className="dsh-atb-card-project" title={projectName}>
          <span className="dsh-atb-card-tone-dot" aria-hidden="true" />
          <span className="dsh-atb-card-project-name">{projectName}</span>
        </span>
        <span className="dsh-atb-card-id" title={task.id}>{task.id}</span>
      </div>

      <div className="dsh-atb-card-title">{task.title}</div>

      {appearance.descriptions && task.description.trim().length > 0 && (
        <p className="dsh-atb-card-desc" title={task.description}>{task.description}</p>
      )}

      {task.external && <small className="dsh-atb-card-external">{task.external.providerName ?? task.external.provider} · {externalTypeLabel(task.external.item.type, t)} #{task.external.item.id}{task.external.conflicts.length > 0 ? <><Icon name="warning" /> </> : ''}</small>}

      {(task.status === 'in_review' || task.status === 'done') && (
        <div className="dsh-atb-card-deliverable">
          <div className="dsh-atb-card-deliv-row">
            <span className="dsh-atb-card-deliv-tag"><Icon name="file" /> {t(latestReport?.changedFiles.length ? 'card.deliv.reportFiles' : 'card.deliv.gitFiles')}:</span>
            {latestReport?.changedFiles && latestReport.changedFiles.length > 0 ? (
              <span className="dsh-atb-card-deliv-val" title={latestReport.changedFiles.join('\n')}>
                {latestReport.changedFiles.length} {t('card.deliv.filesUnit')} ({latestReport.changedFiles[0]?.split(/[\\/]/).pop()}{latestReport.changedFiles.length > 1 ? ` +${latestReport.changedFiles.length - 1}` : ''})
              </span>
            ) : latestWithGit?.changedFiles ? (
              <span className="dsh-atb-card-deliv-val">
                {latestWithGit.changedFiles} {t('card.deliv.gitFilesChanged')}
              </span>
            ) : (
              <span className="dsh-atb-card-deliv-val">{t('card.deliv.noFilesRecorded')}</span>
            )}
          </div>
          <div className="dsh-atb-card-deliv-row">
            <span className="dsh-atb-card-deliv-tag"><Icon name="checklist" /> {t('card.deliv.acceptance')}:</span>
            {checklistTotal > 0 ? (
              <span className="dsh-atb-card-deliv-val" title={task.checklist!.map(c => `${c.checked ? '✓' : '✗'} ${c.text}`).join('\n')}>
                {t('card.deliv.checklistProgress', { done: checklistDone, total: checklistTotal })}
                {task.status === 'in_review' && checklistDone < checklistTotal && (
                  <span className="dsh-atb-deliv-warn"> ({t('card.deliv.uncheckedWarn')})</span>
                )}
              </span>
            ) : latestReport?.checks && latestReport.checks.length > 0 ? (
              <span className="dsh-atb-card-deliv-val" title={latestReport.checks.join('\n')}>
                • {t('card.deliv.checksCount', { n: latestReport.checks.length })}
              </span>
            ) : (
              <span className="dsh-atb-card-deliv-val dsh-atb-deliv-muted">
                <Icon name="warning" /> {t('card.deliv.noVerificationWarn')}
              </span>
            )}
          </div>
          {checklistTotal > 0 && (
            <div className="dsh-atb-card-progress" role="img" aria-label={t('card.deliv.checklistProgress', { done: checklistDone, total: checklistTotal })}>
              <span style={{ width: `${checklistPct}%` }} />
            </div>
          )}
          {latestReport?.summary && (
            <div className="dsh-atb-card-deliv-summary" title={latestReport.summary}>
              {latestReport.summary}
            </div>
          )}
        </div>
      )}

      <div className="dsh-atb-card-meta dsh-atb-card-flags">
        {needsHuman.needs && (
          <span className="dsh-atb-badge" data-kind="needs-human" title={t('card.badge.needsHumanTitle')}>
            <Icon name="hand" /> {needsHuman.reason ?? t('card.badge.needsHuman')}
          </span>
        )}
        {task.blocked && <span className="dsh-atb-badge" data-kind="blocked"><Icon name="warning" /> {t('shared.blocked')}</span>}
        {pendingApprovals.length > 0 && (
          <span
            className="dsh-atb-badge"
            data-kind="approval"
            title={t('card.badge.approvalTitle', { n: pendingApprovals.length })}
          >
            <Icon name="hand" /> {t('card.badge.approval')}
          </span>
        )}
        {dependency.total > 0 && (
          <span
            className="dsh-atb-badge"
            data-kind="dependency"
            data-ready={dependency.ready ? 'true' : undefined}
            title={t('dependency.badgeTitle', { list: dependencyTitle })}
          >
            <Icon name="link" /> {dependency.completed}/{dependency.total}
          </span>
        )}
        {subtasks.total > 0 && (
          <span
            className="dsh-atb-badge"
            data-kind="subtasks"
            data-ready={subtasks.open === 0 ? 'true' : undefined}
            title={subtaskTitle}
          >
            <Icon name="subtask" /> {subtasks.done}/{subtasks.total}
          </span>
        )}
        {stale && <span className="dsh-atb-badge" data-kind="stale"><Icon name="stale" /> {t('card.badge.stale')}</span>}
        {task.execution.mode === 'scheduled'
          && (task.execution.nextRunAt ?? task.execution.queuedRunAt ?? task.execution.runAt) !== undefined && (
          <span className="dsh-atb-badge" data-kind="scheduled">
            <Icon name="clock" /> {fmtTime(task.execution.nextRunAt ?? task.execution.queuedRunAt ?? task.execution.runAt)}
          </span>
        )}
        {task.model !== undefined && (
          <span
            className="dsh-atb-badge"
            title={t('card.badge.modelTitle', { model: task.model.provider + '/' + task.model.model }) + (task.model.reasoningEffort !== undefined ? t('card.badge.modelEffort', { effort: task.model.reasoningEffort }) : '')}
          >
            {task.model.model}{task.model.reasoningEffort !== undefined ? ` (${task.model.reasoningEffort})` : ''}
          </span>
        )}
        {task.permission === 'read-only' && (
          <span className="dsh-atb-badge" data-kind="blocked" title={t('card.badge.permReadOnlyTitle')}>
            <Icon name="lock" /> {t('card.badge.permReadOnly')}
          </span>
        )}
        {task.permission === 'danger-full-access' && (
          <span className="dsh-atb-badge" data-kind="urgent" title={t('card.badge.permFullTitle')}>
            <Icon name="shieldCheck" /> {t('card.badge.permFull')}
          </span>
        )}
        {checklistTotal > 0 && (
          <span
            className="dsh-atb-badge"
            data-kind={task.status === 'in_review' && checklistDone < checklistTotal ? 'blocked' : 'checklist'}
            title={task.status === 'in_review' && checklistDone < checklistTotal ? t('card.badge.checklistReview') : t('card.badge.checklist')}
          >
            <Icon name="checklist" /> {checklistDone}/{checklistTotal}
          </span>
        )}
        {task.status === 'done' && <span className="dsh-atb-badge" data-kind="done">{t('status.pill.done')}</span>}
        {last !== undefined && (
          <span className="dsh-atb-badge" data-kind={last.outcome === 'running' ? 'running' : last.outcome}>
            {t(OUTCOME_KEYS[last.outcome] ?? last.outcome)}
          </span>
        )}
        {targetSessionId !== undefined && (
          <span
            className="dsh-atb-badge"
            data-kind="session"
            title={
              sessionTitle && sessionTitle !== task.title
                ? t('card.session.tagTitleWithTitle', { title: sessionTitle, id: targetSessionId })
                : t('card.session.tagTitle', { id: targetSessionId })
            }
            onClick={(e) => {
              e.stopPropagation()
              void controller.openSession(targetSessionId).then(result => {
                if (result === 'missing') {
                  const msg = t('card.session.missing', { id: shortId(targetSessionId) })
                  if (onAlert !== undefined) onAlert(msg)
                  else alert(msg)
                } else if (result === 'archived') {
                  const msg = t('card.session.archived', { id: shortId(targetSessionId) })
                  if (onAlert !== undefined) onAlert(msg)
                  else alert(msg)
                } else if (result === 'unavailable') {
                  const msg = t('card.session.unavailable', { id: targetSessionId })
                  if (onAlert !== undefined) onAlert(msg)
                  else alert(msg)
                }
              })
            }}
          >
            <Icon name="comment" /> {t('card.session.badge', { id: shortId(targetSessionId) })}
          </span>
        )}
        {task.comments.length > 0 && <span className="dsh-atb-badge" data-kind="comments"><Icon name="comment" /> {task.comments.length}</span>}
        {task.trashedAt !== undefined && <span className="dsh-atb-badge" data-kind="trashed"><Icon name="trash" /> {t('card.badge.pendingPurge')}</span>}
      </div>

      <div className="dsh-atb-card-divider" aria-hidden="true" />

      <div className="dsh-atb-card-bottom">
        <span className="dsh-atb-card-category" title={t('card.category.title', { name: categoryLabel })}>
          <span className="dsh-atb-card-category-dot" aria-hidden="true" />
          <span className="dsh-atb-card-category-name">{categoryLabel}</span>
        </span>
        <span className="dsh-atb-card-priority" data-urgency={task.urgency} data-urgent={task.urgency === 'urgent' ? 'true' : undefined}>
          {task.urgency === 'urgent'
            ? <Icon name="warning" size={11} />
            : <span className="dsh-atb-dot" data-urgency={task.urgency} aria-hidden="true" />}
          {t(URGENCY_KEYS[task.urgency])}
        </span>
        <span className="dsh-atb-card-time">{fmtTime(task.updatedAt)}</span>
      </div>

      {reviewing && (rejectOpen
        ? (
            <div className="dsh-atb-quick-reject" onClick={e => e.stopPropagation()}>
              <input
                className="dsh-atb-input dsh-atb-quick-note"
                value={note}
                placeholder={t('card.reject.placeholder')}
                autoFocus
                spellCheck={false}
                onChange={e => setNote(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') submitReject()
                  else if (e.key === 'Escape') { setRejectOpen(false); setNote('') }
                }}
              />
              <button type="button" className="dsh-atb-quickbtn" data-act="reject-confirm" onClick={submitReject}>{t('card.reject.confirm')}</button>
              <button type="button" className="dsh-atb-quickbtn" data-act="reject-cancel" onClick={() => { setRejectOpen(false); setNote('') }}>{t('shared.cancel')}</button>
            </div>
          )
        : (
            <div className="dsh-atb-quick" onClick={e => e.stopPropagation()}>
              <button
                type="button"
                className="dsh-atb-quickbtn"
                data-act="done"
                title={t('card.action.doneTitle')}
                onClick={() => void controller.move(task.id, task.version, 'done')}
              >
                <Icon name="check" /> {t('card.action.done')}
              </button>
              <button
                type="button"
                className="dsh-atb-quickbtn"
                data-act="reject"
                title={t('card.action.rejectTitle')}
                onClick={() => setRejectOpen(true)}
              >
                <Icon name="close" /> {t('card.action.reject')}
              </button>
            </div>
          ))}
    </div>
  )
}

/**
 * Key maps for the board's enumerated display text (status / urgency /
 * outcome). The values are i18n dictionary keys (see src/client/i18n/zh.ts
 * for the canon and en.ts for the English side); components resolve them
 * with useT()/translate() at render time, so the text follows the GUI
 * language live.
 *
 * Review P2 history: the same status/urgency/outcome text used to live in
 * three components (TaskBoard / TaskCard / TaskDetail) and drifted — adding
 * a status meant three edits, missing one leaked the raw English key. The
 * three-way split below is deliberate and survived the i18n migration:
 *
 * - COLUMN_KEYS  — column headers on the five-column main board (+ secondary tab)
 * - STATUS_KEYS  — status pill text (detail pane); terminal states read short
 * - MOVE_KEYS    — move-button verbs (shorter than the pill text)
 *
 * @module dsh-taskboard/client/board/labels
 */
import type { TaskStatus, Urgency } from '../../shared/protocol.ts'
import type { Translate } from '../i18n/runtime.ts'

/** Column header keys on the five-column main board (+ secondary tab). */
export const COLUMN_KEYS: Readonly<Record<TaskStatus, string>> = {
  backlog: 'status.column.backlog',
  todo: 'status.column.todo',
  in_progress: 'status.column.in_progress',
  in_review: 'status.column.in_review',
  done: 'status.column.done',
  canceled: 'status.column.canceled',
  archived: 'status.column.archived',
}

/** Status pill keys (detail pane) — historical wording kept verbatim:
 *  terminal states read short here, the column headers carry the full forms. */
export const STATUS_KEYS: Readonly<Record<TaskStatus, string>> = {
  backlog: 'status.pill.backlog', todo: 'status.pill.todo', in_progress: 'status.pill.in_progress', in_review: 'status.pill.in_review',
  done: 'status.pill.done', canceled: 'status.pill.canceled', archived: 'status.pill.archived',
}

/** Move-button verb keys (shorter than the pill text). */
export const MOVE_KEYS: Readonly<Record<TaskStatus, string>> = {
  backlog: 'status.move.backlog', todo: 'status.move.todo', in_progress: 'status.move.in_progress', in_review: 'status.move.in_review',
  done: 'status.move.done', canceled: 'status.move.canceled', archived: 'status.move.archived',
}

/** Urgency chip keys. */
export const URGENCY_KEYS: Readonly<Record<Urgency, string>> = {
  urgent: 'urgency.urgent', normal: 'urgency.normal', relaxed: 'urgency.relaxed',
}

/** Execution outcome keys. */
export const OUTCOME_KEYS: Readonly<Record<string, string>> = {
  running: 'outcome.running', succeeded: 'outcome.succeeded', failed: 'outcome.failed', cancelled: 'outcome.cancelled',
}

/**
 * Human text for an arbitrary status string coming off the wire (task index,
 * summaries): known statuses localize through {@link STATUS_KEYS}, unknown
 * values pass through untouched so nothing ever renders as a blank chip.
 * @param t - the active translate function.
 * @param status - the raw status string.
 */
export function statusText(t: Translate, status: string): string {
  const key = (STATUS_KEYS as Readonly<Record<string, string | undefined>>)[status]
  return key === undefined ? status : t(key)
}

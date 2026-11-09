/**
 * Accessible prerequisite combobox for the task detail pane (F9).
 *
 * The old editor was a raw text input plus a `<datalist>` filled from the
 * currently loaded ledger, so completed/filtered cards could not be picked and
 * there was no keyboard or screen-reader semantics. This combobox searches
 * every untrashed task of the workspace by TITLE and ID. Its candidates are
 * the read-only host index (`GET /dsh-taskboard/task-index`, fetched by the
 * detail pane) merged with the loaded ledger: the index supplies cards the
 * board view omitted (collapsed completed column, active filters), the ledger
 * keeps statuses fresh and covers hosts that predate the route.
 *
 * Semantics (WAI-ARIA combobox + listbox): the text input carries
 * role=combobox with aria-expanded / aria-controls / aria-activedescendant;
 * the popup is role=listbox with one role=option per candidate. ArrowUp/Down
 * move, Home/End jump, Enter commits, Escape closes (a second Escape clears).
 * A click on an option commits too. No animation.
 *
 * @module dsh-taskboard/client/board/PrerequisitePicker
 */
import { useId, useMemo, useState, type KeyboardEvent } from 'react'
import type { TaskIndexEntry } from '../api.ts'
import type { BoardController } from '../controller.ts'
import type { TaskRecord } from '../../shared/protocol.ts'
import { MAX_TASK_DEPENDENCIES } from '../../shared/dependencies.ts'
import { useT } from '../i18n/runtime.ts'
import { statusText } from './labels.ts'

/** One pickable prerequisite (index entry or live ledger record). */
interface Candidate {
  id: string
  title: string
  status: string
  workspaceId: string
}

/**
 * The picker.
 * @param task - the task being edited (self and already-linked ids excluded).
 * @param controller - the board controller (update + workspaces).
 * @param linkedIds - current `dependsOn` of the task.
 * @param index - untrashed workspace tasks from the host index (optional).
 */
export function PrerequisitePicker({ task, controller, linkedIds, index }: {
  task: TaskRecord
  controller: BoardController
  linkedIds: readonly string[]
  index?: TaskIndexEntry[]
}) {
  const t = useT()
  const listId = useId()
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(0)
  const [busy, setBusy] = useState(false)

  // Index ∪ ledger: the index is the complete untrashed set, the ledger is
  // fresher for cards already loaded and is the fallback when the route is
  // absent. Trashed ledger records never become candidates (D2).
  const ledger = controller.getSnapshot().ledger.tasks
  const candidates = useMemo(() => {
    const byId = new Map<string, Candidate>()
    for (const entry of index ?? []) {
      byId.set(entry.id, { id: entry.id, title: entry.title, status: entry.status, workspaceId: entry.workspaceId })
    }
    for (const item of ledger) {
      if (item.trashedAt !== undefined) continue
      byId.set(item.id, { id: item.id, title: item.title, status: item.status, workspaceId: item.workspaceId })
    }
    return [...byId.values()]
  }, [index, ledger])

  const linkedKey = linkedIds.join('\u0000')
  const visible = useMemo(() => {
    const linked = new Set(linkedKey.length > 0 ? linkedKey.split('\u0000') : [])
    const needle = query.trim().toLowerCase()
    return candidates
      .filter(candidate => candidate.id !== task.id
        && candidate.workspaceId === task.workspaceId
        && !linked.has(candidate.id)
        && (needle.length === 0
          || candidate.title.toLowerCase().includes(needle)
          || candidate.id.toLowerCase().includes(needle)))
      .sort((a, b) => a.title.localeCompare(b.title) || a.id.localeCompare(b.id))
  }, [candidates, linkedKey, query, task.id, task.workspaceId])

  // The active row is clamped to the filtered list (onChange resets it to the
  // first candidate, ArrowUp/Down wrap, Home/End jump).
  const atLimit = linkedIds.length >= MAX_TASK_DEPENDENCIES
  const listOpen = open && !atLimit && visible.length > 0
  const activeClamped = visible.length === 0 ? -1 : Math.min(activeIndex, visible.length - 1)
  const active = activeClamped >= 0 ? visible[activeClamped] : undefined
  const optionId = (indexInList: number): string => `${listId}-opt-${indexInList}`

  const workspaceLabel = (workspaceId: string): string => {
    const workspace = controller.getSnapshot().workspaces.find(item => item.id === workspaceId)
    return workspace?.title ?? workspaceId
  }

  const commit = (candidate: Candidate | undefined): void => {
    if (candidate === undefined || busy || atLimit) return
    setBusy(true)
    void controller.update(task.id, task.version, { dependsOn: [...linkedIds, candidate.id] }).then(ok => {
      if (ok) {
        setQuery('')
        setOpen(false)
        setActiveIndex(0)
      }
    }).finally(() => setBusy(false))
  }

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      if (!listOpen) setOpen(true)
      else if (visible.length > 0) setActiveIndex(activeClamped < 0 ? 0 : (activeClamped + 1) % visible.length)
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      if (!listOpen) setOpen(true)
      else if (visible.length > 0) setActiveIndex(activeClamped <= 0 ? visible.length - 1 : activeClamped - 1)
    } else if (event.key === 'Home' && listOpen) {
      event.preventDefault()
      setActiveIndex(0)
    } else if (event.key === 'End' && listOpen) {
      event.preventDefault()
      setActiveIndex(visible.length - 1)
    } else if (event.key === 'Enter') {
      if (listOpen && active !== undefined) {
        event.preventDefault()
        commit(active)
      }
    } else if (event.key === 'Escape') {
      if (open) {
        event.preventDefault()
        event.stopPropagation()
        setOpen(false)
      } else if (query.length > 0) {
        event.preventDefault()
        setQuery('')
      }
    }
  }

  if (atLimit) {
    return <div className="dsh-atb-prereq-empty">{t('dependency.limitReached', { max: MAX_TASK_DEPENDENCIES })}</div>
  }

  return (
    <div className="dsh-atb-prereq-picker">
      <input
        type="text"
        className="dsh-atb-input dsh-atb-prereq-input"
        role="combobox"
        aria-label={t('dependency.search')}
        aria-autocomplete="list"
        aria-expanded={listOpen}
        aria-controls={listId}
        aria-activedescendant={listOpen && active !== undefined ? optionId(activeClamped) : undefined}
        placeholder={t('dependency.search')}
        value={query}
        disabled={busy}
        autoComplete="off"
        spellCheck={false}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onChange={event => { setQuery(event.target.value); setOpen(true); setActiveIndex(0) }}
        onKeyDown={onKeyDown}
      />
      {/* The listbox stays in the DOM (aria-controls always resolves); it is
          hidden while collapsed and carries options only when expanded. */}
      <ul
        className="dsh-atb-prereq-list"
        role="listbox"
        id={listId}
        aria-label={t('dependency.listLabel')}
        hidden={!listOpen}
      >
        {listOpen && visible.map((candidate, optionIndex) => (
          <li
            key={candidate.id}
            id={optionId(optionIndex)}
            role="option"
            aria-selected={optionIndex === activeClamped}
            className="dsh-atb-prereq-opt"
            data-active={optionIndex === activeClamped ? 'true' : undefined}
            onMouseDown={event => event.preventDefault()}
            onClick={() => commit(candidate)}
          >
            <span className="dsh-atb-prereq-opt-title">{candidate.title}</span>
            <span className="dsh-atb-prereq-opt-meta">
              <code className="dsh-atb-prereq-opt-id">{candidate.id}</code>
              {' · '}{statusText(t, candidate.status)}
              {' · '}{workspaceLabel(candidate.workspaceId)}
            </span>
          </li>
        ))}
      </ul>
      {open && !listOpen && query.trim().length > 0 && (
        <div className="dsh-atb-prereq-empty" role="status">{t('dependency.noMatches')}</div>
      )}
    </div>
  )
}

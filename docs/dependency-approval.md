# Dependency change approval (0.10.1)

Goal: an agent may *propose* weakening the dependency graph, but the change only
takes effect after an explicit user approval in the GUI. The agent is never
blocked waiting: it receives `pending_approval` immediately and keeps working on
anything else. Prerequisites stay enforced until the user decides.

## Scope of "weakening" (agent callers only; the GUI/user is never gated)
1. `taskboard_update` whose `dependsOn` removes at least one existing id
   (pure additions are applied immediately, as today).
2. `taskboard_delete` of a task that is a prerequisite of at least one live
   (non-trashed) task.
3. Any agent `update`/`delete`/`move` on a task outside the caller session's
   project (or its linked roots when `allowClaimFromLinkedRoots`) is **refused**
   with `workspace_mismatch` (not a request: cross-project edits are out of scope).

## Data model (shared/protocol.ts)
```ts
interface DependencyChangeRequest {
  id: string                 // 'dcr-' + short random
  kind: 'remove-prerequisites' | 'trash-prerequisite'
  taskId: string             // task whose dependsOn shrinks / task to trash
  remove?: string[]          // kind=remove-prerequisites: ids to drop
  affected?: string[]        // kind=trash-prerequisite: live dependents at request time
  reason: string             // required, 1..500 chars, agent-provided
  requestedBy: { kind: 'agent'; sessionId: string }
  createdAt: number
}
// TaskRecord: pendingChanges?: DependencyChangeRequest[]  (stored on taskId)
```
- At most one pending request per (kind, taskId); a new request from an agent
  replaces the previous one (same id kept, fields updated, audit comment).
- Validated on load/import like other fields (shape-only; unknown ids allowed).

## Agent tool behaviour
- `taskboard_update`: new optional arg `reason` (string). If `dependsOn` drops ids:
  additions + all other fields apply normally; the removal becomes a request.
  Missing `reason` → `invalid_input: reason required to request prerequisite removal`.
  Result includes `{ pendingApproval: { id, kind, remove } }` and a text line
  "Prerequisite removal awaits user approval (dcr-…); continue other work."
- `taskboard_delete`: if live dependents exist → no trash; request recorded
  (requires `reason`), result `pendingApproval`. Otherwise unchanged.
- `taskboard_get`/`list` expose `pendingChanges`.
- Protocol text (protocol-text.ts, zh/en): one line explaining the rule.

## User decision (routes.ts, POST, user-only)
- `POST /tasks/:id/changes/:cid/approve` → apply atomically in one mutation:
  remove-prerequisites: drop ids from dependsOn (ignore already absent);
  trash-prerequisite: trash task + existing `detachPrerequisitesOfTrashed` repair.
  Then delete the request, system comment "Approved by user: …".
- `POST /tasks/:id/changes/:cid/reject` body `{ note?: string }` → delete request,
  system comment "Rejected by user: …" (the agent reads comments).
- Stale handling: if the task is gone/trashed, approve → 409 `stale_request`, and
  the request is discarded.
- User edits in the GUI (`/update` from the form) keep working unguarded.

## Needs-human integration
- A task with `pendingChanges.length > 0` counts as needing the human
  (`computeNeedsHuman` source `'approval'`, reason key `human.reason.approval`),
  so it appears in "Waiting for Me" and the sidebar badge.

## Client
- Card: badge `data-kind="approval"` (icon hand, text "Approval").
- Detail: a panel at top listing each request: kind, ids (titles when known),
  reason, requester, time, buttons Approve (primary) / Reject (+ optional note).
- Run button: disabled with tooltip listing unmet prerequisites when
  dependency readiness is false (server still enforces).
- i18n zh/en/ru in sync.

## Tests (must exist)
- update removal → request, dependsOn unchanged, still blocked; additions applied.
- missing reason → invalid_input. replace semantics.
- delete prerequisite with dependents → not trashed, request; without dependents → trashed.
- approve/reject both kinds; stale approve → 409; comments written.
- cross-project agent update/delete/move → workspace_mismatch; same-project ok; user route unaffected.
- needs-human includes approval; client renders panel and buttons call routes; Run disabled w/ tooltip.

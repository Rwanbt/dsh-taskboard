# Lightweight task dependencies (fork P0)

This is a **fork-only work-in-progress** feature on `feat/dependencies-lite`. It is not an upstream release and must not be merged until the full CI and DeepSeek Harness host validation has passed.

## Behavior

- A task can declare up to 32 direct prerequisites in `dependsOn: string[]`.
- Only tasks in the same workspace are valid prerequisites.
- Invalid IDs, duplicates, direct/transitive cycles, missing or trashed prerequisites are rejected.
- A prerequisite counts as complete only when its task is `done` (human approval). `in_review` is **not** complete.
- Prerequisites are independent of the existing manual `blocked` marker and Definition of Done checklist.
- A blocked task cannot be claimed by an agent, moved manually to `in_progress`, or started via the real execution service (manual, scheduled or comment wake).
- A reopened prerequisite immediately blocks **new** executions; running executions are not force-cancelled.
- The scheduler leaves waiting queued work untouched rather than retrying it repeatedly.
- The five-column board stays unchanged. A small `🔗 completed/total` badge appears only for tasks with prerequisites, and links can be edited in a collapsed **Dependencies** panel in task details.
- IDs can be pasted when the completed column is collapsed; the server calculates the true progress against all tasks regardless of UI filtering.

## API examples

Create:
```json
{"title":"Build feature B","workspaceId":"<workspace-id>","urgency":"normal","dependsOn":["<task-id-A>"]}
```

Update (optimistic concurrency is mandatory):
```json
{"ifVersion":3,"dependsOn":["<task-id-A>","<task-id-C>"]}
```

Remove every prerequisite by updating with `"dependsOn":[]`.

Agent tools `taskboard_create` and `taskboard_update` also accept `dependsOn`; the `taskboard_list` and `taskboard_get` renderers surface links.

## Validation gates

Expected before merging:
```sh
npm ci
npm run typecheck
npm test
npm run build
```

Additionally, validate real DSH host runs and scheduler restart/resume behavior. Existing E2E/CI failures must remain visible and must **not** be bypassed.

## Later work (independent changes)

- Add searchable title-first prerequisite picker with efficient lookup for collapsed/historical tasks.
- Add task hierarchies (parent/subtasks) independently of ordering constraints.
- Add read-only GitHub CI / PR evidence with `passed/failed/pending/unknown` and SHA provenance.
- Optional dependency graph view, not a permanent dashboard.
- Optional warnings on already-running dependent tasks when an accepted prerequisite is reopened.

## Licensing/upstream

The original project is `cloader/dsh-taskboard`. Keep original Apache-2.0 licensing and preserve the ability to synchronize changes from upstream `dev`.

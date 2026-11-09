# P2 — optional read-only GitHub CI evidence (design)

Status: **not implemented in this iteration** unless the P0/P1 gate is fully green.
This file is the implementation contract so the work can be picked up without
re-deciding the design. It is deliberately small and must never become a required
service.

## Goal

Show the **real** verification state attached to a task's branch / pull request,
next to the human validation, without turning the board into a CI dashboard.

## Non-goals

- No write access to GitHub (no comments, no status updates, no PR creation).
- No mandatory token, no OAuth app, no webhook, no always-on server.
- No SQLite and no second database: results are a short-lived in-memory cache only.
- No automatic task acceptance. CI never moves a card to `done`.

## State model (four states, never conflated)

| State | Meaning |
| --- | --- |
| `passed` | every required check for the recorded SHA succeeded |
| `failed` | at least one required check failed / cancelled / timed out |
| `pending` | checks exist and are queued or running |
| `unknown` | no configuration, no network, no checks, no token, rate-limited, ambiguous branch |

Rules:
- absent CI is `unknown`, **never** `passed`;
- a mixed run (unit passed, E2E failed) is `failed`, and the failing check names are
  preserved;
- when several commits exist, the state is the one for the **exact SHA** recorded with
  the evidence, never "latest on branch";
- unknown/partial coverage is displayed as unknown, not as a soft pass.

## Evidence record

```ts
interface CiEvidence {
  state: 'passed' | 'failed' | 'pending' | 'unknown'
  provider: 'github'
  sha?: string                 // exact commit evaluated
  branch?: string
  pr?: { number: number; url: string }
  checks?: Array<{ name: string; conclusion: string; url?: string }>
  checkedAt: number
  reason?: string              // why unknown, when unknown
}
```

Never store tokens, headers or raw API responses in the ledger, comments or logs; only
the normalized fields above may be persisted.

## Configuration (opt-in, off by default)

```json
// board settings (GUI Settings panel / /dsh-taskboard/settings/update)
"github": {
  "enabled": false,
  "repository": "owner/name",   // optional: inferred from the workspace git remote
  "apiBaseUrl": "https://api.github.com",
  "tokenEnv": "GITHUB_TOKEN"    // name of an env var; the value is never stored
}
```

- Disabled by default ⇒ everything renders `unknown` and no request is made.
- `tokenEnv` names an environment variable; the secret is read at request time, never
  written to the ledger/settings file.
- `repository` may be inferred from the workspace remote when unambiguous; ambiguity
  yields `unknown`, not a guess.

## Host design

- `src/host/github-ci.ts` — a small service:
  - `resolveTarget(task)` → `{ repository, sha }` from the task's branch/branches and
    the workspace remote; unresolved ⇒ `unknown`.
  - `fetchEvidence(task)` → `CiEvidence`; uses `fetch` with a strict timeout (e.g. 4 s),
    `AbortController`, no redirects to other origins, no retries beyond one 5xx retry.
  - in-memory TTL cache (e.g. 60 s) keyed by `repository|sha`; **no persistence**.
  - maps the GitHub check-runs + commit-status APIs into the four states.
- `GET /dsh-taskboard/tasks/:id/ci` — read-only, returns the cached/refreshed evidence;
  never mutates the ledger; failures degrade to `unknown` with a `reason`.
- No background polling. The client asks when the detail panel's CI section is opened.
- Rate-limit / network errors ⇒ `unknown`, never `passed`.

## Client design

- Detail panel: one collapsed **Validation (CI)** section, only when the feature is
  enabled; shows state chip, SHA (short), PR link and the failing check names.
- Card: no permanent badge. At most a single compact chip when `state === 'failed'`,
  because a red signal is actionable; `passed`/`pending`/`unknown` stay in the panel.
- No new column, no graph, no animation.

## Tests required before enabling

1. No configuration ⇒ `unknown`, zero network calls.
2. `passed` only when every required check reports success for the exact SHA.
3. Mixed unit-pass / E2E-fail ⇒ `failed` with the E2E check named.
4. No checks at all ⇒ `unknown`.
5. Network timeout / 403 / rate limit ⇒ `unknown` (never `passed`).
6. Token value never appears in ledger, comments, logs or the API payload.
7. Branch/SHA ambiguity ⇒ `unknown`.
8. Cache TTL prevents request storms; the panel is read-only.

## Why deferred

P0 (dependency correctness) and P1 (hierarchy/UX) must be green and validated in a real
DSH host first. CI evidence is additive and independent; it should land as its own small
commit/PR behind the `enabled` flag so it can be reviewed and reverted in isolation.

# Real-host multi-agent E2E — 0.10.1 (2026-11-09)

Host: the user's daily DSH desktop profile (plugin `link:` install, hot-reloaded to 0.10.1).
Project: `default-workspace`, scratch folder `tb-e2e/` (git repo). Every agent ran through the
board's own Run path (one DSH session per task) with a **non-DeepSeek** model, proving the
`taskboard_*` tools are provider-agnostic.

| Step | Agent / model | Result |
| --- | --- | --- |
| Run B while prerequisite A not done | (user) | refused 400 `unsatisfied dependencies` |
| A: add `mul()` to `tb-e2e/calc.js`, report, move to in_review | Claude Haiku 5.5 (`anthropic-account`) | succeeded; file changed; report + checklist submitted |
| User moves A to done | (user) | B unblocked |
| B: write + run `calc.test.mjs` | GPT-5.6 Luna (`openai-codex`) | succeeded; test exit 0; in_review |
| D: `taskboard_update` C `dependsOn: []` with reason | Gemini 3.5 Flash (`google`) | `remove-prerequisites` request recorded, deps unchanged; run then failed on the provider's free-tier quota (429), not on the board |
| F: `taskboard_delete` A (dependents B, C) with reason | Mistral Medium (`mistral`) | nothing trashed; `trash-prerequisite` request; agent told "awaits user approval… continue other work" |
| User rejects F's request in the GUI with a note | (user) | request discarded; system comment carries the note |
| User approves D's request in the GUI | (user) | C's prerequisite removed; system comment |
| G: `taskboard_update` a task of another project | GLM 5.3 (`opencode-go`) | refused (`workspace_mismatch`); foreign task unchanged |

Finding fixed during the run: a **done** prerequisite carrying a pending deletion request
was not counted in "Waiting for Me". Pending approvals now need the human regardless of
status (trashed cards excepted); test added.

Not exercised: worktree isolation in this run (`isolation: none`), scheduled/cron dispatch.

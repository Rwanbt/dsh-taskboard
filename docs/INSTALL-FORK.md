# Installing, upgrading and validating this fork

This fork adds prerequisites, hierarchy and (optionally) CI evidence to
`cloader/dsh-taskboard`. The plugin contract with DeepSeek Harness is unchanged: it is a
normal DSH bundle (`dsh.bundle.patch` + `dsh.client` in `package.json`).

**Never develop or validate directly in the profile you use daily.** Use an isolated
`DSH_HOME` first; the procedure below was executed on this machine and is reproducible.

## 1. Requirements

| Dependency | Requirement |
| --- | --- |
| DeepSeek Harness | matching the `dsh.compatibility.dshReleases` entry in `package.json` |
| Node.js | ≥ 22 (for building / running the test suite) |
| git | optional; required only for worktree isolation and upstream sync |

The DSH launcher on Windows lives at
`%LOCALAPPDATA%\Programs\DeepSeek Harness\resources\runtime\cli\bin\dsh.cmd`.
`dsh --version` and `dsh --help` are the source of truth for the flags below.

## 2. Build from source

```sh
git clone https://github.com/Rwanbt/dsh-taskboard.git
cd dsh-taskboard
git checkout feat/dependencies-lite
npm ci
npm run typecheck
npm run build      # writes lib/ — required before npm test (two specs import lib/)
npm test
```

`npm test` on a clean checkout **without** `lib/` fails 6 tests that import `lib/`. That
is upstream behaviour (`prepublishOnly` runs build then test); the order above is the
supported one.

## 3. Install into an isolated validation profile (recommended first)

```powershell
# 1. Isolated home: the daily profile (~/.dsh/profiles/desktop) is untouched.
$env:DSH_HOME = 'C:\Users\<you>\dsh-tb-test'

# 2. Create a fresh profile from the shipped web template (boots once; stop it).
& 'C:\...\runtime\cli\bin\dsh.cmd' --profile tb --from-default-profile web --no-open --port 64780

# 3. Link this plugin into that profile.
& 'C:\...\runtime\cli\bin\dsh.cmd' plugin --profile tb add 'link:C:/path/to/dsh-taskboard'

# 4. Boot the host on a free port. Do NOT pass "web" after --profile (parsed as an app arg).
& 'C:\...\runtime\cli\bin\dsh.cmd' --profile tb --no-open --port 64781
# -> prints http://127.0.0.1:64781/?token=<token>
```

Open that URL. The sidebar/panel bar shows **Task board**; the board renders the five
columns (Backlog, To do, In progress, In review, Done).

Notes:
- A workspace appears once a session exists for a working directory. Booting the host
  from inside a project directory registers that workspace; `GET
  /dsh-taskboard/workspaces` then lists it. Model credentials are not required for that.
- Authentication is the cookie set by `GET /?token=...`; the plugin API itself is the
  local, CSRF-fenced `/dsh-taskboard/*` surface. The API is **POST-only with action
  suffixes** (`/tasks`, `/tasks/:id/update`, `/tasks/:id/move`, `/tasks/:id/run`,
  `/tasks/:id/delete`); plain `PUT`/`DELETE` return 405 from the DSH core webserver.
- Agent dispatch needs a real model credential in that isolated home. Gate refusals,
  board rendering, persistence and import/export do not.

## 4. Install into your normal profile

```powershell
$env:DSH_HOME = "$env:USERPROFILE\.dsh"
& 'C:\...\dsh.cmd' plugin --profile desktop add 'link:C:/path/to/dsh-taskboard'
```

Then restart the DSH app (or `dsh --profile desktop`) and refresh the page. Prefer the
`link:` install while iterating so a rebuild is picked up; use a packed tarball or the
published package for a stable install.

Remove: `dsh plugin --profile desktop remove dsh-taskboard`. The ledger data stays in
the active data directory.

## 5. Upgrading this fork

```sh
git fetch origin
git checkout feat/dependencies-lite
git pull --ff-only
npm ci
npm run typecheck && npm run build && npm test
```

Restart the host afterwards. Ledger changes are additive and optional; nothing to
migrate. Back up the data directory first anyway (see §7).

## 6. Synchronising with upstream

The fork keeps `upstream` as a remote and tracks `cloader/dsh-taskboard`:

```sh
git remote add upstream https://github.com/cloader/dsh-taskboard.git   # once
git fetch upstream --prune
git log --oneline upstream/dev..HEAD        # fork-only commits
git diff --stat upstream/dev...HEAD         # fork-only surface — keep it small
git merge upstream/dev                      # or rebase onto it
```

Conflict hotspots are the files this fork touches: `src/shared/{dependencies,hierarchy,
protocol,api}.ts`, `src/host/{routes,tools,execution,scheduler}.ts`, the client board
files and the three i18n dictionaries. Prefer small, additive changes upstream of these
files so merges stay mechanical. Re-run the full gate after every upstream merge.

## 7. Data and rollback

- The ledger lives under the active DSH data directory as `dsh-taskboard.json`, with
  `dsh-taskboard-templates.json` and `dsh-taskboard-assets/` beside it. The exact path
  is shown by the plugin's Settings/Storage panel (`/dsh-taskboard/storage`).
- New fields (`dependsOn`, `parentId`) are optional. A ledger created by this fork still
  loads in upstream; a ledger created by upstream loads here unchanged.
- Rollback = switch the profile back to the upstream package and restore the backup you
  took before the switch. Keep the ledger backup until the fork is proven on your data.

## 8. Troubleshooting

| Symptom | Cause / fix |
| --- | --- |
| No "Task board" entry | plugin not in the profile's `dsh.profile.bundles`; re-run `dsh plugin add` |
| `dsh --profile tb web` → "too many arguments" | pass app flags after `--profile <name>`, not the profile's app name |
| Board loads but stays empty of projects | no session/workspace registered in that `DSH_HOME`; boot from a project dir |
| `dependencyProgress` visible but the card cannot start | expected: prerequisites are not `done` (human acceptance), see the Dependencies panel |
| A task shows a deleted prerequisite | the id is missing/trashed; the panel offers one-click removal, and deleting a prerequisite now repairs dependents automatically |
| `npm test` fails on a clean clone | run `npm run build` first (§2) |

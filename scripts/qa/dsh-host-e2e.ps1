#requires -Version 7.0
<#
.SYNOPSIS
  Agent D — independent, isolated REAL-DSH-host E2E harness for dsh-taskboard.

.DESCRIPTION
  Boots a completely isolated DSH home (never C:\Users\barat\.dsh), installs the
  working-tree plugin as a `link:` dependency into an isolated profile created
  from the shipped `web` template, boots the real host, and drives the REAL
  plugin HTTP routes through the real DSH webserver with the real cookie-trust
  handshake (`GET /?token=<token>`). No product code is imported directly and
  nothing is stubbed: every assertion below is an HTTP call.

  What it proves end-to-end:
    * plugin loads inside a real host and its routes answer;
    * create A, create B dependsOn A; B cannot start (move/run) while A is not done;
    * A in_review never satisfies; A done satisfies; reopen A re-blocks new starts;
    * soft-delete / purge repair of dependents (F1/D2) — visible on the wire;
    * export (GET /state) -> import (POST /import replace) round-trip;
    * host restart persistence of dependsOn.

  What it cannot prove here (reported honestly):
    * a real agent execution/settlement, because the isolated DSH home has no
      model credential; the `run` route is exercised for its GATE outcomes only.

.PARAMETER HomeDir
  Isolated DSH_HOME. Refused if it is (or is inside) the user's real ~/.dsh.

.PARAMETER Port
  Loopback port for the isolated host (default 64934 — deliberately different
  from the Lead's 64781 and from the manual scratch boot 64933).

.PARAMETER Label
  Free-text label stored in the report (e.g. build identity under test).

.EXAMPLE
  pwsh -File scripts/qa/dsh-host-e2e.ps1 -Label "HEAD a11384e / lib 00:46 pre-fix"
#>
[CmdletBinding()]
param(
  [string] $HomeDir = 'C:\Users\barat\dsh-tb-test',
  [string] $ProfileName = 'tb',
  [int]    $Port = 64934,
  [string] $Label = 'unlabelled',
  [switch] $SkipSetup,
  [switch] $KeepHost
)

$ErrorActionPreference = 'Stop'
$script:Repo = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$script:Cli = 'C:\Users\barat\AppData\Local\Programs\DeepSeek Harness\resources\runtime\cli\bin\dsh.cmd'
$script:WorkspacePath = 'C:\Users\barat\Documents\deepseek-harness\default-workspace'
$script:Results = [System.Collections.Generic.List[object]]::new()
$script:Base = $null
$script:Token = $null
$script:Session = $null
$script:HostProc = $null
$script:BootLog = Join-Path $HomeDir 'boot-out.log'
$script:ErrLog = Join-Path $HomeDir 'boot-err.log'

# ---------------------------------------------------------------------------
# Safety: this harness must never touch the user's real DSH home.
# ---------------------------------------------------------------------------
$realHome = (Resolve-Path (Join-Path $HOME '.dsh')).Path
$homeResolved = [System.IO.Path]::GetFullPath($HomeDir).TrimEnd('\')
if ($homeResolved -eq $realHome -or $homeResolved.StartsWith($realHome + '\', [StringComparison]::OrdinalIgnoreCase)) {
  throw "REFUSING to run: HomeDir '$homeResolved' is the real DSH home '$realHome'. Use an isolated home."
}

function Log([string]$name, [bool]$ok, [string]$detail, [string]$phase = 'core') {
  $script:Results.Add([pscustomobject]@{ Phase = $phase; Check = $name; Result = $(if ($ok) { 'PASS' } else { 'FAIL' }); Detail = $detail })
  $colour = if ($ok) { 'Green' } else { 'Red' }
  Write-Host ("[{0}] {1} :: {2}" -f $(if ($ok) { 'PASS' } else { 'FAIL' }), $name, $detail) -ForegroundColor $colour
}

function Log-Info([string]$name, [string]$detail) {
  $script:Results.Add([pscustomobject]@{ Phase = 'info'; Check = $name; Result = 'INFO'; Detail = $detail })
  Write-Host "[INFO] $name :: $detail" -ForegroundColor Cyan
}

# ---------------------------------------------------------------------------
# Isolated profile setup (idempotent).
# ---------------------------------------------------------------------------
function Invoke-Cli([string[]] $Arguments) {
  $env:DSH_HOME = $HomeDir
  $out = & $script:Cli @Arguments 2>&1 | Out-String
  return [pscustomobject]@{ Exit = $LASTEXITCODE; Output = $out }
}

function Initialize-Profile {
  New-Item -ItemType Directory -Force -Path $HomeDir | Out-Null
  $profileDir = Join-Path $HomeDir "profiles\$ProfileName"
  if (-not $SkipSetup -and -not (Test-Path (Join-Path $profileDir 'package.json'))) {
    # --dump-config creates the profile from the shipped template and exits
    # (no boot, no browser).
    $r = Invoke-Cli @('--profile', $ProfileName, '--from-default-profile', 'web', '--dump-config')
    if (-not (Test-Path (Join-Path $profileDir 'package.json'))) { throw "profile creation failed: $($r.Output)" }
    Log-Info 'profile created from shipped web template' "$profileDir"
  } else {
    Log-Info 'profile reused' "$profileDir"
  }
  if (-not $SkipSetup) {
    $r = Invoke-Cli @('plugin', '--profile', $ProfileName, 'add', "link:$($script:Repo)")
    $pkg = Get-Content (Join-Path $profileDir 'package.json') -Raw | ConvertFrom-Json
    $linked = $null -ne $pkg.dependencies.PSObject.Properties['dsh-taskboard']
    $bundled = @($pkg.dsh.profile.bundles) -contains 'dsh-taskboard'
    Log 'plugin installed as link dependency into isolated profile' ($linked -and $bundled) "linked=$linked bundled=$bundled :: $(($r.Output -split "`n" | Select-Object -Last 1))"
    if (-not ($linked -and $bundled)) { throw 'plugin link install failed' }
  }
}

# The isolated host starts with an empty workspace registry; the taskboard
# create route requires a registered workspace. Seed the DSH core's own
# workspace storage with one real workspace (documented bootstrap, not a stub).
function Initialize-Workspace {
  $storages = Join-Path $HomeDir 'storages'
  New-Item -ItemType Directory -Force -Path $storages | Out-Null
  $file = Join-Path $storages 'workspace.json'
  $wsId = '6f1c2b8e-4a7d-4c3e-9b2a-1d5e7f9a0b3c'
  $canonical = (Resolve-Path $script:WorkspacePath).Path
  $now = (Get-Date).ToUniversalTime().ToString('o')
  $doc = [ordered]@{
    unit   = [ordered]@{ name = 'workspace'; version = 2 }
    global = [ordered]@{ initialized = $true; workspaceIds = @($wsId); archivedSessionIds = @(); pinnedSessionIds = @() }
    tables = [ordered]@{ workspaces = [ordered]@{ $wsId = [ordered]@{
      path = $canonical; title = (Split-Path $canonical -Leaf); sessionIds = @(); createdAt = $now; updatedAt = $now
    } } }
  }
  ($doc | ConvertTo-Json -Depth 10) | Set-Content -Path $file -Encoding utf8
  $script:WorkspaceId = $wsId
  Log-Info 'workspace registry seeded (isolated home only)' "id=$wsId path=$canonical"
  return $wsId
}

# ---------------------------------------------------------------------------
# Boot / stop the real host.
# ---------------------------------------------------------------------------
function Stop-Host {
  # Kill the launched launcher AND whatever node child is still listening on the
  # port (taskkill /T can hang on this host, so use Stop-Process + netstat).
  if ($null -ne $script:HostProc) {
    try { Stop-Process -Id $script:HostProc.Id -Force -ErrorAction SilentlyContinue } catch { }
  }
  $listener = netstat -ano | Select-String ":$Port\s+\S+\s+LISTENING\s+(\d+)"
  foreach ($line in @($listener)) {
    $parIdText = ([regex]::Match([string]$line, 'LISTENING\s+(\d+)')).Groups[1].Value
    if ($parIdText -and [int]$parIdText -gt 4) {
      try { Stop-Process -Id ([int]$parIdText) -Force -ErrorAction SilentlyContinue } catch { }
    }
  }
  $script:HostProc = $null
  # Wait until the port is actually free again.
  for ($i = 0; $i -lt 80; $i++) {
    $still = netstat -ano | Select-String ":$Port\s+\S+\s+LISTENING"
    if ($null -eq $still) { return }
    Start-Sleep -Milliseconds 250
  }
  throw "port $Port still busy after stopping the host"
}

function Start-Host {
  Remove-Item $script:BootLog, $script:ErrLog -ErrorAction SilentlyContinue
  $env:DSH_HOME = $HomeDir
  $script:HostProc = Start-Process -FilePath $script:Cli `
    -ArgumentList @('--profile', $ProfileName, '--no-open', '--port', "$Port") `
    -WorkingDirectory $script:WorkspacePath `
    -RedirectStandardOutput $script:BootLog -RedirectStandardError $script:ErrLog `
    -PassThru -WindowStyle Hidden
  $deadline = (Get-Date).AddSeconds(120)
  while ((Get-Date) -lt $deadline) {
    if ($script:HostProc.HasExited) {
      $tail = (Get-Content $script:BootLog -ErrorAction SilentlyContinue | Select-Object -Last 15) -join "`n"
      throw "host exited during boot (code $($script:HostProc.ExitCode)):`n$tail"
    }
    $line = Get-Content $script:BootLog -ErrorAction SilentlyContinue | Select-String -Pattern 'https?://127\.0\.0\.1:(\d+)/\?token=(\S+)' | Select-Object -Last 1
    if ($null -ne $line) {
      $m = [regex]::Match($line.Line, 'https?://127\.0\.0\.1:(\d+)/\?token=(\S+)')
      $script:Base = "http://127.0.0.1:$($m.Groups[1].Value)"
      $script:Token = $m.Groups[2].Value
      # Cookie-trust handshake exactly like a browser opening the printed URL.
      $script:Session = New-Object Microsoft.PowerShell.Commands.WebRequestSession
      Invoke-WebRequest -Uri "$($script:Base)/?token=$($script:Token)" -WebSession $script:Session -UseBasicParsing -TimeoutSec 30 | Out-Null
      # Wait for the plugin routes to answer.
      $ready = $false
      for ($i = 0; $i -lt 120; $i++) {
        try {
          $r = Invoke-WebRequest -Uri "$($script:Base)/dsh-taskboard/state" -WebSession $script:Session -UseBasicParsing -TimeoutSec 10
          if ($r.StatusCode -eq 200) { $ready = $true; break }
        } catch { }
        Start-Sleep -Milliseconds 500
      }
      if (-not $ready) { throw 'plugin routes never answered after boot' }
      return
    }
    Start-Sleep -Milliseconds 500
  }
  throw "timed out waiting for the boot URL in $($script:BootLog)"
}

# ---------------------------------------------------------------------------
# HTTP helpers (same mechanism the web app uses: cookie session, JSON bodies).
# ---------------------------------------------------------------------------
function Api([string]$method, [string]$path, $body) {
  $params = @{
    Uri = "$($script:Base)/dsh-taskboard$path"; Method = $method
    WebSession = $script:Session; TimeoutSec = 30
  }
  if ($null -ne $body) {
    $params.ContentType = 'application/json'
    $params.Body = ($body | ConvertTo-Json -Depth 10 -Compress)
  }
  try {
    $r = Invoke-RestMethod @params
    return [pscustomobject]@{ ok = $true; status = 200; body = $r }
  } catch {
    $status = 0
    if ($null -ne $_.Exception.Response) { $status = [int]$_.Exception.Response.StatusCode }
    $payload = $null
    if ($_.ErrorDetails -and $_.ErrorDetails.Message) {
      try { $payload = $_.ErrorDetails.Message | ConvertFrom-Json } catch { $payload = $_.ErrorDetails.Message }
    }
    return [pscustomobject]@{ ok = $false; status = $status; body = $payload; raw = $_.Exception.Message }
  }
}
function Post([string]$path, $body) { return Api 'POST' $path $body }
function GetApi([string]$path) { return Api 'GET' $path $null }
function State([string]$query = '') { return (GetApi "/state$query").body.value }
function TaskOf($state, [string]$id) { return $state.tasks | Where-Object { $_.id -eq $id } | Select-Object -First 1 }
function Msg($r) { if ($r.body) { return ($r.body | ConvertTo-Json -Depth 8 -Compress) } else { return "$($r.raw)" } }
function ErrCode($r) { if ($r.body -and $r.body.error) { return [string]$r.body.error.code } else { return '' } }
function ErrMsg($r) { if ($r.body -and $r.body.error) { return [string]$r.body.error.message } else { return "$($r.raw)" } }

# ---------------------------------------------------------------------------
# Scenario.
# ---------------------------------------------------------------------------
function Invoke-Scenario {
  $stamp = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
  $ws = (GetApi '/workspaces').body.value | Select-Object -First 1
  Log 'plugin loaded: GET /workspaces returns a registered project' ($null -ne $ws) "workspace=$($ws.id) path=$($ws.path)"
  if ($null -eq $ws) { throw 'no registered workspace; cannot drive create' }
  $workspaceId = $ws.id

  $state0 = State
  Log 'plugin loaded: GET /state answers with the ledger envelope' ($null -ne $state0 -and $null -ne $state0.revision) "revision=$($state0.revision) tasks=$(@($state0.tasks).Count)"

  # ---- D3 on the real host: the boot catchup tick must DEFER the seeded
  # blocked one-shot, never spend it on the offline missed-window policy.
  $seedDeadline = (Get-Date).AddSeconds(15)
  $seed = $null
  while ((Get-Date) -lt $seedDeadline) {
    $seed = TaskOf (State) 'seed-blocked'
    if ($null -ne $seed -and ($null -ne $seed.execution.queuedRunAt -or $seed.execution.mode -eq 'claim')) { break }
    Start-Sleep -Milliseconds 500
  }
  $seedAudit = @($seed.comments | Where-Object { $_.systemKey -eq 'sys.runAtMissed' }).Count
  $seedDeferred = $null -ne $seed -and $seed.execution.mode -eq 'scheduled' -and $seedAudit -eq 0 -and $null -ne $seed.execution.queuedRunAt
  Log 'D3: boot catchup DEFERS a blocked one-shot (not spent)' $seedDeferred "mode=$($seed.execution.mode) queuedRunAt=$($seed.execution.queuedRunAt) runAt=$($seed.execution.runAt) missedComments=$seedAudit"

  # ---- create A and B(dependsOn A) through the real routes.
  $a = Post '/tasks' @{ title = "QA-A $stamp"; workspaceId = $workspaceId; urgency = 'normal' }
  $aId = $a.body.value.id
  $b = Post '/tasks' @{ title = "QA-B $stamp"; workspaceId = $workspaceId; urgency = 'normal'; dependsOn = @($aId) }
  $bId = $b.body.value.id
  Log 'create A (todo v1)' ($a.ok -and $a.body.value.status -eq 'todo' -and $a.body.value.version -eq 1) "id=$aId"
  Log 'create B with dependsOn=[A]' ($b.ok -and (@($b.body.value.dependsOn) -contains $aId)) "id=$bId dependsOn=$(@($b.body.value.dependsOn) -join ',')"

  $st = State
  $bRec = TaskOf $st $bId
  Log 'GET /state derives dependencyProgress for B' ($null -ne $bRec.dependencyProgress) ($bRec.dependencyProgress | ConvertTo-Json -Compress)
  Log 'B not ready while A is todo' ($bRec.dependencyProgress.ready -eq $false -and $bRec.dependencyProgress.completed -eq 0) "ready=$($bRec.dependencyProgress.ready)"

  # ---- GATE: manual run refused for dependency (not for unknown workspace).
  $runB = Post "/tasks/$bId/run" @{}
  Log 'GATE run B refused with dependency reason' ((-not $runB.ok) -and ((ErrMsg $runB) -match 'dependen')) "status=$($runB.status) $(ErrMsg $runB)"

  # ---- GATE: move to in_progress refused.
  $moveB = Post "/tasks/$bId/move" @{ ifVersion = $bRec.version; status = 'in_progress' }
  Log 'GATE move B to in_progress refused with dependency reason' ((-not $moveB.ok) -and ((ErrMsg $moveB) -match 'dependen')) "status=$($moveB.status) $(ErrMsg $moveB)"

  # ---- A: todo -> in_progress -> in_review: must NOT satisfy B (D1).
  $aRec = TaskOf (State) $aId
  $p1 = Post "/tasks/$aId/move" @{ ifVersion = $aRec.version; status = 'in_progress' }
  $aRec = TaskOf (State) $aId
  $p2 = Post "/tasks/$aId/move" @{ ifVersion = $aRec.version; status = 'in_review' }
  $bRec = TaskOf (State) $bId
  Log 'A in_review does NOT satisfy B' ($p1.ok -and $p2.ok -and $bRec.dependencyProgress.ready -eq $false) "A=$($p2.body.value.status) B.ready=$($bRec.dependencyProgress.ready)"

  # ---- A -> done (user route): B becomes ready.
  $aRec = TaskOf (State) $aId
  $p3 = Post "/tasks/$aId/move" @{ ifVersion = $aRec.version; status = 'done' }
  $bRec = TaskOf (State) $bId
  Log 'A done makes B ready (completed=1)' ($p3.ok -and $bRec.dependencyProgress.ready -eq $true -and $bRec.dependencyProgress.completed -eq 1) "A=$($p3.body.value.status) ready=$($bRec.dependencyProgress.ready)"

  # ---- reopen A: new starts of B are re-blocked.
  $aRec = TaskOf (State) $aId
  $reopen = Post "/tasks/$aId/move" @{ ifVersion = $aRec.version; status = 'todo' }
  $bRec = TaskOf (State) $bId
  $moveB2 = Post "/tasks/$bId/move" @{ ifVersion = $bRec.version; status = 'in_progress' }
  $runB2 = Post "/tasks/$bId/run" @{}
  Log 'reopen A re-blocks NEW starts of B (move+run)' ($reopen.ok -and $bRec.dependencyProgress.ready -eq $false -and -not $moveB2.ok -and -not $runB2.ok) "ready=$($bRec.dependencyProgress.ready) move=$($moveB2.status) run=$($runB2.status)"

  # ---- GATE path 5 on the real host: comment wake refused while unmet.
  $x = Post '/tasks' @{ title = "QA-X $stamp"; workspaceId = $workspaceId; urgency = 'normal' }
  $xId = $x.body.value.id
  $y = Post '/tasks' @{ title = "QA-Y $stamp"; workspaceId = $workspaceId; urgency = 'normal'; dependsOn = @($xId) }
  $yId = $y.body.value.id
  $xRec = TaskOf (State) $xId
  $null = Post "/tasks/$xId/move" @{ ifVersion = $xRec.version; status = 'in_progress' }
  $xRec = TaskOf (State) $xId
  $null = Post "/tasks/$xId/move" @{ ifVersion = $xRec.version; status = 'in_review' }
  $xRec = TaskOf (State) $xId
  $null = Post "/tasks/$xId/move" @{ ifVersion = $xRec.version; status = 'done' }
  $yRec = TaskOf (State) $yId
  $null = Post "/tasks/$yId/move" @{ ifVersion = $yRec.version; status = 'in_progress' }
  $yRec = TaskOf (State) $yId
  $null = Post "/tasks/$yId/move" @{ ifVersion = $yRec.version; status = 'in_review' }
  $xRec = TaskOf (State) $xId
  $reopenX = Post "/tasks/$xId/move" @{ ifVersion = $xRec.version; status = 'todo' }
  $wake = Post "/tasks/$yId/comment-run" @{ body = 'please look again (QA gate probe)' }
  Log 'GATE comment wake refused with dependency reason' ($reopenX.ok -and (-not $wake.ok) -and ((ErrMsg $wake) -match 'dependen')) "status=$($wake.status) $(ErrMsg $wake)"

  # ---- reopen A re-blocking: an ALREADY running execution would not be killed;
  #      this host has no model credential, so a real run cannot be opened here.
  Log-Info 'real agent execution/settlement NOT exercised' 'isolated DSH home has no model credential; run route exercised for gate outcomes only'

  # ---- validation negatives on the real routes.
  $aRec = TaskOf (State) $aId
  $cycle = Post "/tasks/$aId/update" @{ ifVersion = $aRec.version; dependsOn = @($bId) }
  Log 'indirect cycle A->B->A rejected' ((-not $cycle.ok) -and ((ErrMsg $cycle) -match 'cycle')) "$(ErrCode $cycle) $(ErrMsg $cycle)"
  $self = Post "/tasks/$aId/update" @{ ifVersion = $aRec.version; dependsOn = @($aId) }
  Log 'self dependency rejected' ((-not $self.ok) -and ((ErrMsg $self) -match 'self|cannot depend on itself')) "$(ErrCode $self) $(ErrMsg $self)"
  $dup = Post "/tasks/$aId/update" @{ ifVersion = $aRec.version; dependsOn = @($bId, $bId) }
  Log 'duplicate dependency rejected' ((-not $dup.ok) -and ((ErrMsg $dup) -match 'duplicate')) "$(ErrCode $dup) $(ErrMsg $dup)"
  $missing = Post "/tasks/$aId/update" @{ ifVersion = $aRec.version; dependsOn = @('t-does-not-exist') }
  Log 'missing dependency rejected' ((-not $missing.ok) -and ((ErrMsg $missing) -match 'missing|not found')) "$(ErrCode $missing) $(ErrMsg $missing)"
  $bRec = TaskOf (State) $bId
  $legit = Post "/tasks/$bId/update" @{ ifVersion = $bRec.version; title = "QA-B bumped $stamp" }
  $stale = Post "/tasks/$bId/update" @{ ifVersion = $bRec.version; title = 'stale write must fail' }
  Log 'stale version write rejected' ((-not $stale.ok) -and ((ErrMsg $stale) -match 'version')) "$(ErrCode $stale) $(ErrMsg $stale)"

  # ---- F1/D2: soft-delete a prerequisite and inspect the dependent ON THE WIRE.
  $aRec = TaskOf (State) $aId
  $c = Post '/tasks' @{ title = "QA-C $stamp"; workspaceId = $workspaceId; urgency = 'normal'; dependsOn = @($aId) }
  $cId = $c.body.value.id
  $trashA = Post "/tasks/$aId/delete" @{ ifVersion = $aRec.version }
  $cRec = TaskOf (State) $cId
  $stillDangling = @($cRec.dependsOn) -contains $aId
  $hasAudit = @($cRec.comments | Where-Object { $_.systemKey -eq 'sys.prerequisiteRemoved' }).Count -gt 0
  $moveC = Post "/tasks/$cId/move" @{ ifVersion = $cRec.version; status = 'in_progress' }
  Log 'F1: soft-delete A repairs C.dependsOn (no dangling ref)' ($trashA.ok -and -not $stillDangling) "trash=$($trashA.ok) C.dependsOn=$(@($cRec.dependsOn) -join ',') missing=$(@($cRec.dependencyProgress.missingIds) -join ',')"
  Log 'F1: dependent C carries sys.prerequisiteRemoved audit comment' ($trashA.ok -and $hasAudit) "comments=$(@($cRec.comments).Count) keys=$(@($cRec.comments | ForEach-Object { $_.systemKey }) -join ',')"
  Log 'F1: dependent C is startable after the repair' ($trashA.ok -and $moveC.ok) "move status=$($moveC.status) $(ErrMsg $moveC)"

  # ---- F1/D2: hard purge path (soft-delete then purge a second prerequisite).
  $d = Post '/tasks' @{ title = "QA-D $stamp"; workspaceId = $workspaceId; urgency = 'normal' }
  $dId = $d.body.value.id
  $e = Post '/tasks' @{ title = "QA-E $stamp"; workspaceId = $workspaceId; urgency = 'normal'; dependsOn = @($dId) }
  $eId = $e.body.value.id
  $dRec = TaskOf (State) $dId
  $softD = Post "/tasks/$dId/delete" @{ ifVersion = $dRec.version }
  $purgeD = Post "/tasks/$dId/delete" @{ purge = $true }
  $eRec = TaskOf (State) $eId
  Log 'F1: purge of trashed prerequisite leaves no dangling ref in E' ($softD.ok -and $purgeD.ok -and -not (@($eRec.dependsOn) -contains $dId)) "purge=$($purgeD.ok) E.dependsOn=$(@($eRec.dependsOn) -join ',')"

  # ---- F1 on the IMPORT-MERGE path (post-fix acceptance): an incoming copy of
  # a live prerequisite marked trashed must repair its live dependents exactly
  # like the delete route does. Pre-fix this is expected-red.
  $ma = Post '/tasks' @{ title = "QA-MA $stamp"; workspaceId = $workspaceId; urgency = 'normal' }
  $maId = $ma.body.value.id
  $mb = Post '/tasks' @{ title = "QA-MB $stamp"; workspaceId = $workspaceId; urgency = 'normal'; dependsOn = @($maId) }
  $mbId = $mb.body.value.id
  $maRec = TaskOf (State) $maId
  $maCopy = $maRec | Select-Object -Property * -ExcludeProperty dependencyProgress, subtaskProgress
  $maCopy | Add-Member -NotePropertyName trashedAt -NotePropertyValue ([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()) -Force
  $mergeRes = Post '/import' @{ mode = 'merge'; ledger = @{ schemaVersion = 1; revision = 1; tasks = @($maCopy) } }
  $mbAfter = TaskOf (State) $mbId
  $mbHasAudit = @($mbAfter.comments | Where-Object { $_.systemKey -eq 'sys.prerequisiteRemoved' }).Count -gt 0
  Log 'F1 (import-merge path): trashed incoming prerequisite repairs its live dependent' ($mergeRes.ok -and -not (@($mbAfter.dependsOn) -contains $maId) -and $mbHasAudit) "merge=$($mergeRes.status) MB.dependsOn=$(@($mbAfter.dependsOn) -join ',') audit=$mbHasAudit"

  # ---- D6/D7 hierarchy on the real host routes.
  $p = Post '/tasks' @{ title = "QA-P $stamp"; workspaceId = $workspaceId; urgency = 'normal' }
  $parId = $p.body.value.id
  $k = Post '/tasks' @{ title = "QA-K $stamp"; workspaceId = $workspaceId; urgency = 'normal'; parentId = $parId }
  $kId = $k.body.value.id
  Log 'hierarchy: create child with parentId' ($k.ok -and $k.body.value.parentId -eq $parId) "parent=$parId child=$kId"
  $pRec = TaskOf (State) $parId
  Log 'hierarchy: GET /state exposes subtaskProgress' ($null -ne $pRec.subtaskProgress -and $pRec.subtaskProgress.total -eq 1 -and $pRec.subtaskProgress.open -eq 1) ($pRec.subtaskProgress | ConvertTo-Json -Compress)
  $delP = Post "/tasks/$parId/delete" @{ ifVersion = $pRec.version }
  Log 'hierarchy: delete-with-children refused (has_children)' ((-not $delP.ok) -and ((ErrMsg $delP) -match 'child|子')) "status=$($delP.status) $(ErrMsg $delP)"
  $selfP = Post "/tasks/$parId/update" @{ ifVersion = $pRec.version; parentId = $parId }
  Log 'hierarchy: self-parent refused' ((-not $selfP.ok) -and ((ErrMsg $selfP) -match 'self|own parent')) "status=$($selfP.status) $(ErrMsg $selfP)"
  # Hierarchy is NOT an execution gate: the child may start while the parent is todo.
  $kRec = TaskOf (State) $kId
  $moveK = Post "/tasks/$kId/move" @{ ifVersion = $kRec.version; status = 'in_progress' }
  Log 'hierarchy: child start is not gated by the parent status' ($moveK.ok) "status=$($moveK.status) $(ErrMsg $moveK)"

  # ---- A CLEAN pair (untouched by the F1 delete checks) for restart persistence.
  $f = Post '/tasks' @{ title = "QA-F $stamp"; workspaceId = $workspaceId; urgency = 'normal' }
  $fId = $f.body.value.id
  $g = Post '/tasks' @{ title = "QA-G $stamp"; workspaceId = $workspaceId; urgency = 'normal'; dependsOn = @($fId) }
  $gId = $g.body.value.id
  Log 'restart fixture: created F and G dependsOn F' ($f.ok -and $g.ok -and (@($g.body.value.dependsOn) -contains $fId)) "F=$fId G=$gId"

  # ---- Real-world backup path: a board where a TRASHED dependent still carries
  # an inert link to a TRASHED prerequisite must round-trip through export/import.
  $u = Post '/tasks' @{ title = "QA-U $stamp"; workspaceId = $workspaceId; urgency = 'normal' }
  $uId = $u.body.value.id
  $v = Post '/tasks' @{ title = "QA-V $stamp"; workspaceId = $workspaceId; urgency = 'normal'; dependsOn = @($uId) }
  $vId = $v.body.value.id
  $vRec = TaskOf (State) $vId
  $null = Post "/tasks/$vId/delete" @{ ifVersion = $vRec.version }
  $uRec = TaskOf (State) $uId
  $null = Post "/tasks/$uId/delete" @{ ifVersion = $uRec.version }
  Log-Info 'trashed-record round-trip fixture' "U=$uId trashed, V=$vId trashed while still linked to U"

  # ---- export -> import(replace) round-trip through the real routes.
  $exported = State
  $stripped = @($exported.tasks | ForEach-Object {
    $t = $_ | Select-Object -Property * -ExcludeProperty dependencyProgress, subtaskProgress
    $t
  })
  $doc = @{ schemaVersion = $exported.schemaVersion; revision = $exported.revision; tasks = $stripped }
  $imported = Post '/import' @{ mode = 'replace'; ledger = $doc }
  $afterImport = State
  # Round-trip must preserve a dependency that exists AT EXPORT TIME. Use the
  # clean F/G pair (the F1 probes intentionally trashed A, so B has no links).
  $fAfter = TaskOf $afterImport $fId
  $gAfter = TaskOf $afterImport $gId
  Log 'export -> import(replace) round-trip keeps dependsOn' ($imported.ok -and $null -ne $fAfter -and $null -ne $gAfter -and (@($gAfter.dependsOn) -contains $fId)) "import=$($imported.status) tasks=$(@($afterImport.tasks).Count) F.present=$($null -ne $fAfter) G.dependsOn=$(@($gAfter.dependsOn) -join ',')"
  # A queued scheduled one-shot has no runAt/cron left (queueRunAt consumed the
  # trigger); the import MUST still carry the durable queue entry instead of
  # silently dropping the record as invalid.
  $seedAfterImport = TaskOf $afterImport 'seed-blocked'
  Log 'export -> import(replace) preserves QUEUED scheduled work' ($null -ne $seedAfterImport -and $null -ne $seedAfterImport.execution.queuedRunAt) "seed-blocked present=$($null -ne $seedAfterImport) queuedRunAt=$($seedAfterImport.execution.queuedRunAt)"
  # Trashed linked records must round-trip too (inert links are exempt).
  $uAfter = TaskOf $afterImport $uId
  $vAfter = TaskOf $afterImport $vId
  Log 'export -> import(replace) round-trips a board with TRASHED linked records' ($imported.ok -and $null -ne $uAfter -and $null -ne $vAfter -and $null -ne $vAfter.trashedAt -and $null -ne $uAfter.trashedAt) "U.present=$($null -ne $uAfter) V.present=$($null -ne $vAfter) V.trashed=$($null -ne $vAfter.trashedAt)"

  # ---- import validation on the real host: a cyclic ledger is rejected
  # ATOMICALLY (revision unchanged, live ledger untouched).
  $revBeforeCyc = (State).revision
  $cycTask = {
    param([string]$id, [string]$dep)
    @{ id = $id; title = "cyc $id"; description = ''; prompt = ''; workspaceId = $workspaceId
       urgency = 'normal'; status = 'todo'; blocked = $false; execution = @{ mode = 'claim' }
       dependsOn = @($dep); version = 1; createdAt = 1; updatedAt = 1
       createdBy = @{ kind = 'user' }; updatedBy = @{ kind = 'user' }; comments = @(); executions = @() }
  }
  $cycDoc = @{ schemaVersion = 1; revision = 1; tasks = @((& $cycTask 'cyc-x' 'cyc-y'), (& $cycTask 'cyc-y' 'cyc-x')) }
  $cyc = Post '/import' @{ mode = 'replace'; ledger = $cycDoc }
  $revAfterCyc = (State).revision
  Log 'import replace rejects a cyclic ledger atomically' ((-not $cyc.ok) -and $revAfterCyc -eq $revBeforeCyc) "status=$($cyc.status) revision=$revBeforeCyc->$revAfterCyc msg=$(ErrMsg $cyc)"
}

function Invoke-RestartCheck {
  # Snapshot before restart: a CLEAN pair created by the scenario (untouched by
  # the delete/repair checks) proves the durable dependsOn round-trip.
  $before = State
  $gTask = $before.tasks | Where-Object { $_.title -like 'QA-G *' } | Select-Object -Last 1
  if ($null -eq $gTask) { Log 'restart: fixture present' $false 'QA-G task missing before restart' 'restart'; return }
  $fId = @($gTask.dependsOn)[0]
  $gId = $gTask.id
  $revBefore = $before.revision

  Stop-Host
  Start-Sleep -Seconds 2
  Start-Host

  $after = State
  $gAfter = TaskOf $after $gId
  $sameDep = $null -ne $gAfter -and (@($gAfter.dependsOn) -contains $fId)
  Log 'restart: task survives with dependsOn intact' ($null -ne $gAfter -and $sameDep) "id=$gId dependsOn=$(@($gAfter.dependsOn) -join ',')"
  Log 'restart: ledger revision is durable (>= pre-restart)' ($after.revision -ge $revBefore) "before=$revBefore after=$($after.revision)"

  # Gate still enforced after restart: F was never done, so G must stay blocked.
  $fAfter = TaskOf $after $fId
  if ($null -ne $fAfter -and $fAfter.status -ne 'done') {
    $blocked = Post "/tasks/$gId/move" @{ ifVersion = $gAfter.version; status = 'in_progress' }
    Log 'restart: dependency gate still enforced' ((-not $blocked.ok) -and ((ErrMsg $blocked) -match 'dependen')) "status=$($blocked.status) $(ErrMsg $blocked)"
  } else {
    Log-Info 'restart: dependency gate re-check skipped' "F status=$($fAfter.status); pair is satisfied"
  }

  # The plugin ledger lives under the ISOLATED home only (never the real one).
  $ledger = Join-Path $HomeDir 'dsh-taskboard.json'
  Log 'restart: ledger file is under the isolated DSH_HOME' (Test-Path $ledger) $ledger

  # D3 across restart: the deferred blocked one-shot must survive UNSPENT.
  $seedAfter = TaskOf $after 'seed-blocked'
  $seedAuditAfter = if ($null -ne $seedAfter) { @($seedAfter.comments | Where-Object { $_.systemKey -eq 'sys.runAtMissed' }).Count } else { -1 }
  Log 'restart: deferred blocked one-shot survives unspent (D3)' ($null -ne $seedAfter -and $seedAfter.execution.mode -eq 'scheduled' -and $null -ne $seedAfter.execution.queuedRunAt -and $seedAuditAfter -eq 0) "mode=$($seedAfter.execution.mode) queuedRunAt=$($seedAfter.execution.queuedRunAt) missedComments=$seedAuditAfter"
}

# ---------------------------------------------------------------------------
# Report.
# ---------------------------------------------------------------------------
function Write-Report([string]$outDir) {
  New-Item -ItemType Directory -Force -Path $outDir | Out-Null
  $head = 'unknown'
  try { $head = (& git -C $script:Repo rev-parse --short HEAD 2>&1 | Out-String).Trim() } catch { }
  $libInfo = 'missing'
  $lib = Join-Path $script:Repo 'lib\index.js'
  if (Test-Path $lib) { $libInfo = (Get-Item $lib).LastWriteTime.ToString('o') + ' (' + (Get-Item $lib).Length + ' bytes)' }
  $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
  $jsonPath = Join-Path $outDir "dsh-host-result-$stamp.json"
  $mdPath = Join-Path $outDir "dsh-host-report-$stamp.md"
  $payload = [pscustomobject]@{
    label = $Label; at = (Get-Date).ToString('o'); home = $HomeDir; port = $Port
    base = $script:Base; gitHead = $head; libIndex = $libInfo
    pass = @($script:Results | Where-Object { $_.Result -eq 'PASS' }).Count
    fail = @($script:Results | Where-Object { $_.Result -eq 'FAIL' }).Count
    info = @($script:Results | Where-Object { $_.Result -eq 'INFO' }).Count
    results = $script:Results
  }
  $payload | ConvertTo-Json -Depth 8 | Set-Content -Path $jsonPath -Encoding utf8

  $lines = [System.Collections.Generic.List[string]]::new()
  $lines.Add('# Real isolated DSH host — E2E validation report')
  $lines.Add('')
  $lines.Add("Generated: $($payload.at)  ")
  $lines.Add("Label: **$Label**  ")
  $lines.Add("Isolated DSH_HOME: ``$HomeDir`` (never the real ``~/.dsh``)  ")
  $lines.Add("Host: $($script:Base)  ")
  $lines.Add("Plugin git HEAD: ``$head`` — built lib/index.js: ``$libInfo``  ")
  $lines.Add('')
  $lines.Add("**Summary: $($payload.pass) PASS / $($payload.fail) FAIL / $($payload.info) INFO.** Every check below was executed against the real host over HTTP; nothing is simulated.")
  $lines.Add('')
  $lines.Add('| Phase | Check | Result | Detail |')
  $lines.Add('| --- | --- | --- | --- |')
  foreach ($r in $script:Results) {
    $d = ([string]$r.Detail) -replace '\|', '\|'
    $lines.Add("| $($r.Phase) | $($r.Check) | **$($r.Result)** | $d |")
  }
  $lines.Add('')
  $lines.Add('## Scope / honesty notes')
  $lines.Add('')
  $lines.Add('- The host is a real `dsh` process with an isolated `DSH_HOME` and a profile created from the shipped `web` template; the plugin is installed as a `link:` dependency and loaded by the real plugin manager.')
  $lines.Add('- Auth is the real DSH browser-trust handshake: `GET /?token=<token>` establishes the cookie, then the same `WebRequestSession` calls `/dsh-taskboard/*` (the routes carry no separate auth of their own; they are CSRF-fenced by content-type, as `tests/routes-security.spec.ts` documents).')
  $lines.Add('- The isolated workspace registry is seeded with one real workspace record (the DSH core storage format) because a fresh isolated home has no project; this is harness bootstrap, not a product stub.')
  $lines.Add('- Real agent execution/settlement is NOT exercised: the isolated home has no model credential. The `run` route is exercised only for its refusal/allowed gate outcomes.')
  $lines.Add('- These results reflect the **built `lib/`** loaded by the host, not `src/`. Rebuild (`npm run build`) before re-running to validate post-fix source.')
  $lines | Set-Content -Path $mdPath -Encoding utf8
  Log-Info 'report written' $mdPath
  Log-Info 'json written' $jsonPath
  return [pscustomobject]@{ Pass = $payload.pass; Fail = $payload.fail; Markdown = $mdPath; Json = $jsonPath }
}

# ---------------------------------------------------------------------------
# Main.
# ---------------------------------------------------------------------------
try {
  Log-Info 'harness safety' "isolated home '$homeResolved' != real '$realHome'"
  Log-Info 'repo under test' $script:Repo
  Initialize-Profile
  $null = Initialize-Workspace
  # Each harness run starts from a CLEAN plugin ledger in the ISOLATED home, so
  # a previous run's intentionally-dangling pre-fix artifacts cannot poison the
  # export/import check. Restart persistence is tested within this same run.
  Get-ChildItem $HomeDir -Filter 'dsh-taskboard.json*' -ErrorAction SilentlyContinue | Remove-Item -Force -ErrorAction SilentlyContinue
  Log-Info 'isolated plugin ledger reset' (Join-Path $HomeDir 'dsh-taskboard.json')
  # Seed ONE blocked scheduled one-shot BEFORE boot: the 3s catchup tick must
  # DEFER it (D3) rather than spend it on the offline missed-window policy.
  $seedNow = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
  $seedDoc = [ordered]@{
    schemaVersion = 1; revision = 1
    tasks = @(
      [ordered]@{ id = 'seed-prereq'; title = 'seed prereq'; description = ''; prompt = ''; workspaceId = $script:WorkspaceId
        urgency = 'normal'; status = 'todo'; blocked = $false; execution = [ordered]@{ mode = 'claim' }
        version = 1; createdAt = $seedNow; updatedAt = $seedNow
        createdBy = [ordered]@{ kind = 'user' }; updatedBy = [ordered]@{ kind = 'user' }; comments = @(); executions = @() },
      [ordered]@{ id = 'seed-blocked'; title = 'seed blocked one-shot'; description = ''; prompt = ''; workspaceId = $script:WorkspaceId
        urgency = 'normal'; status = 'todo'; blocked = $false
        execution = [ordered]@{ mode = 'scheduled'; runAt = ($seedNow - 360000) }
        dependsOn = @('seed-prereq')
        version = 1; createdAt = $seedNow; updatedAt = $seedNow
        createdBy = [ordered]@{ kind = 'user' }; updatedBy = [ordered]@{ kind = 'user' }; comments = @(); executions = @() }
    )
  }
  ($seedDoc | ConvertTo-Json -Depth 10) | Set-Content -Path (Join-Path $HomeDir 'dsh-taskboard.json') -Encoding utf8
  Log-Info 'seeded blocked scheduled one-shot (pre-boot)' 'seed-blocked dependsOn seed-prereq, runAt 6min in the past'
  Start-Host
  Log-Info 'host booted' "$($script:Base) pid=$($script:HostProc.Id)"
  Invoke-Scenario
  Invoke-RestartCheck
}
catch {
  Log 'harness aborted' $false ($_.Exception.Message + ' @ ' + $_.InvocationInfo.PositionMessage) 'harness'
}
finally {
  if (-not $KeepHost) { try { Stop-Host } catch { } }
  $summary = Write-Report (Join-Path $PSScriptRoot 'reports')
  Write-Host "`n===== $($summary.Pass) passed / $($summary.Fail) failed ====="
  Write-Host "report: $($summary.Markdown)"
  if ($summary.Fail -gt 0) { exit 1 }
}

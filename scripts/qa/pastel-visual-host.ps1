#requires -Version 7.0
<#
.SYNOPSIS
  DeepSeek Pastel — real-DSH-host visual validation harness.

.DESCRIPTION
  Boots a COMPLETELY ISOLATED DSH home (never C:\Users\barat\.dsh), installs the
  working-tree plugin as a `link:` dependency into an isolated profile, seeds a
  dense board (≈340 tasks, mostly backlog) through the plugin's own import route,
  then drives the REAL plugin in a real Chromium browser (puppeteer-core) to
  capture desktop dark/light, the detail pane, a narrow mobile viewport and a
  dense backlog column — plus a numeric metric comparison against the reference
  mockup HTML rendered in the same browser.

  Nothing is stubbed: auth is the real cookie handshake (`GET /?token=…`), the
  board is served by the real host, and the screenshots show the production
  client bundle built from this working tree.

.PARAMETER HomeDir
  Isolated DSH_HOME. Refused if it is (or is inside) the user's real ~/.dsh.

.PARAMETER Port
  Loopback port for the isolated host (deliberately not the user's 49949).

.PARAMETER KeepHost
  Leave the host running after the capture (prints the tokenized URL).

.EXAMPLE
  pwsh -File scripts/qa/pastel-visual-host.ps1 -Label "feat/ui-deepseek-pastel"
#>
[CmdletBinding()]
param(
  [string] $HomeDir = 'C:\Users\barat\dsh-tb-test',
  [string] $ProfileName = 'tb',
  [int]    $Port = 64941,
  [string] $Label = 'unlabelled',
  [int]    $SeedCount = 340,
  [string] $CaptureScript = 'pastel-capture.mjs',
  [switch] $SkipSetup,
  [switch] $SkipSeed,
  [switch] $KeepHost
)

$ErrorActionPreference = 'Stop'
$script:Repo = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$mockupCandidates = @(
  (Join-Path $HOME 'Downloads\TaskBoard_DeepSeek_Pastel_GOAL_et_References\design-reference'),
  'C:\Users\barat\Downloads\TaskBoard_DeepSeek_Pastel_GOAL_et_References\design-reference',
  (Join-Path $script:Repo 'docs\design\reference')
) | Where-Object { Test-Path (Join-Path $_ 'DSH_Task_Board_DeepSeek_Pastel_Maquette_V1.html') }
$script:Mini = if ($mockupCandidates.Count -gt 0) { (Resolve-Path $mockupCandidates[0]).Path } else { $null }
$script:Cli = 'C:\Users\barat\AppData\Local\Programs\DeepSeek Harness\resources\runtime\cli\bin\dsh.cmd'
$script:WorkspacePath = 'C:\Users\barat\Documents\deepseek-harness\default-workspace'
$script:Base = $null
$script:Token = $null
$script:Session = $null
$script:HostProc = $null
$script:WorkspaceId = $null
$script:BootLog = Join-Path $HomeDir 'boot-out.log'
$script:ErrLog = Join-Path $HomeDir 'boot-err.log'

# ---------------------------------------------------------------------------
# Safety: never touch the user's real DSH home.
# ---------------------------------------------------------------------------
$realHome = (Resolve-Path (Join-Path $HOME '.dsh')).Path
$homeResolved = [System.IO.Path]::GetFullPath($HomeDir).TrimEnd('\')
if ($homeResolved -eq $realHome -or $homeResolved.StartsWith($realHome + '\', [StringComparison]::OrdinalIgnoreCase)) {
  throw "REFUSING to run: HomeDir '$homeResolved' is the real DSH home '$realHome'. Use an isolated home."
}

function Info([string]$message) { Write-Host "[info] $message" -ForegroundColor Cyan }
function Step([string]$message) { Write-Host "[step] $message" -ForegroundColor Yellow }
function Fail([string]$message) { throw $message }

function Invoke-Cli([string[]] $Arguments) {
  $previous = $env:DSH_HOME
  $env:DSH_HOME = $HomeDir
  try { $out = & $script:Cli @Arguments 2>&1 | Out-String } finally { $env:DSH_HOME = $previous }
  return [pscustomobject]@{ Exit = $LASTEXITCODE; Output = $out }
}

function Initialize-Profile {
  New-Item -ItemType Directory -Force -Path $HomeDir | Out-Null
  $profileDir = Join-Path $HomeDir "profiles\$ProfileName"
  if (-not $SkipSetup) {
    if (-not (Test-Path (Join-Path $profileDir 'package.json'))) {
      $r = Invoke-Cli @('--profile', $ProfileName, '--from-default-profile', 'web', '--dump-config')
      if (-not (Test-Path (Join-Path $profileDir 'package.json'))) { Fail "profile creation failed: $($r.Output)" }
      Info "profile created from the shipped web template: $profileDir"
    } else {
      Info "profile reused: $profileDir"
    }
    # The link must point at THIS working tree: an isolated home may have been
    # created earlier from another checkout, and validating a stale copy would
    # be a false green. Re-point and reinstall when it differs.
    $pkgPath = Join-Path $profileDir 'package.json'
    $pkg = Get-Content $pkgPath -Raw | ConvertFrom-Json
    $declared = [string]$pkg.dependencies.'dsh-taskboard'
    $expected = 'link:' + ($script:Repo -replace '\\', '/')
    $linkedPath = Join-Path $profileDir 'node_modules\dsh-taskboard'
    $actual = if (Test-Path $linkedPath) { (Get-Item $linkedPath).Target } else { $null }
    $actualResolved = if ($null -ne $actual) { [System.IO.Path]::GetFullPath($actual) } else { '' }
    if ($declared -ne $expected -or $actualResolved.TrimEnd('\') -ne $script:Repo.TrimEnd('\')) {
      Info "re-pointing the isolated profile at $($script:Repo)"
      $pkg.dependencies.'dsh-taskboard' = $expected
      ($pkg | ConvertTo-Json -Depth 10) | Set-Content $pkgPath -Encoding utf8
      $r = Invoke-Cli @('plugin', '--profile', $ProfileName, 'install')
      $actual = (Get-Item $linkedPath).Target
      $actualResolved = [System.IO.Path]::GetFullPath($actual)
      if ($actualResolved.TrimEnd('\') -ne $script:Repo.TrimEnd('\')) {
        Fail "plugin link still points at '$actualResolved' after reinstall: $($r.Output)"
      }
    }
    $bundled = @($pkg.dsh.profile.bundles) -contains 'dsh-taskboard'
    if (-not $bundled) {
      $null = Invoke-Cli @('plugin', '--profile', $ProfileName, 'add', "link:$($script:Repo)")
    }
    Info "plugin linked from the working tree: $($script:Repo)"
  }
}

function Initialize-Workspace {
  $storages = Join-Path $HomeDir 'storages'
  New-Item -ItemType Directory -Force -Path $storages | Out-Null
  $file = Join-Path $storages 'workspace.json'
  $wsId = '6f1c2b8e-4a7d-4c3e-9b2a-1d5e7f9a0b3c'
  # A second real project so the per-project grouping has something to group.
  $wsId2 = 'a1b2c3d4-1111-4222-8333-9444aabbccdd'
  $canonical = (Resolve-Path $script:WorkspacePath).Path
  $repo = (Resolve-Path $script:Repo).Path
  $now = (Get-Date).ToUniversalTime().ToString('o')
  $doc = [ordered]@{
    unit   = [ordered]@{ name = 'workspace'; version = 2 }
    global = [ordered]@{ initialized = $true; workspaceIds = @($wsId, $wsId2); archivedSessionIds = @(); pinnedSessionIds = @() }
    tables = [ordered]@{ workspaces = [ordered]@{
      $wsId = [ordered]@{ path = $canonical; title = (Split-Path $canonical -Leaf); sessionIds = @(); createdAt = $now; updatedAt = $now }
      $wsId2 = [ordered]@{ path = $repo; title = (Split-Path $repo -Leaf); sessionIds = @(); createdAt = $now; updatedAt = $now }
    } }
  }
  ($doc | ConvertTo-Json -Depth 10) | Set-Content -Path $file -Encoding utf8
  $script:WorkspaceId = $wsId
  $script:WorkspaceId2 = $wsId2
  Info "workspace registry seeded (isolated home only): $wsId / $wsId2"
}

function Stop-Host {
  if ($null -ne $script:HostProc) {
    try { Stop-Process -Id $script:HostProc.Id -Force -ErrorAction SilentlyContinue } catch { }
  }
  $listener = netstat -ano | Select-String ":$Port\s+\S+\s+LISTENING\s+(\d+)"
  foreach ($line in @($listener)) {
    $idText = ([regex]::Match([string]$line, 'LISTENING\s+(\d+)')).Groups[1].Value
    if ($idText -and [int]$idText -gt 4) { try { Stop-Process -Id ([int]$idText) -Force -ErrorAction SilentlyContinue } catch { } }
  }
  $script:HostProc = $null
  for ($i = 0; $i -lt 80; $i++) {
    $still = netstat -ano | Select-String ":$Port\s+\S+\s+LISTENING"
    if ($null -eq $still) { return }
    Start-Sleep -Milliseconds 250
  }
  throw "port $Port still busy after stopping the host"
}

function Start-Host {
  Remove-Item $script:BootLog, $script:ErrLog -ErrorAction SilentlyContinue
  $previous = $env:DSH_HOME
  $env:DSH_HOME = $HomeDir
  try {
    $script:HostProc = Start-Process -FilePath $script:Cli `
      -ArgumentList @('--profile', $ProfileName, '--no-open', '--port', "$Port") `
      -WorkingDirectory $script:WorkspacePath `
      -RedirectStandardOutput $script:BootLog -RedirectStandardError $script:ErrLog `
      -PassThru -WindowStyle Hidden
  } finally { $env:DSH_HOME = $previous }
  $deadline = (Get-Date).AddSeconds(120)
  while ((Get-Date) -lt $deadline) {
    if ($script:HostProc.HasExited) {
      $tail = (Get-Content $script:BootLog -ErrorAction SilentlyContinue | Select-Object -Last 20) -join "`n"
      Fail "host exited during boot (code $($script:HostProc.ExitCode)):`n$tail"
    }
    $line = Get-Content $script:BootLog -ErrorAction SilentlyContinue | Select-String -Pattern 'https?://127\.0\.0\.1:(\d+)/\?token=(\S+)' | Select-Object -Last 1
    if ($null -ne $line) {
      $m = [regex]::Match($line.Line, 'https?://127\.0\.0\.1:(\d+)/\?token=(\S+)')
      $script:Base = "http://127.0.0.1:$($m.Groups[1].Value)"
      $script:Token = $m.Groups[2].Value
      $script:Session = New-Object Microsoft.PowerShell.Commands.WebRequestSession
      Invoke-WebRequest -Uri "$($script:Base)/?token=$($script:Token)" -WebSession $script:Session -UseBasicParsing -TimeoutSec 30 | Out-Null
      for ($i = 0; $i -lt 120; $i++) {
        try {
          $r = Invoke-WebRequest -Uri "$($script:Base)/dsh-taskboard/state" -WebSession $script:Session -UseBasicParsing -TimeoutSec 10
          if ($r.StatusCode -eq 200) { Info "host ready: $($script:Base)"; return }
        } catch { }
        Start-Sleep -Milliseconds 500
      }
      Fail 'plugin routes never answered after boot'
    }
    Start-Sleep -Milliseconds 500
  }
  Fail "timed out waiting for the boot URL in $script:BootLog"
}

function Api([string]$method, [string]$path, $body) {
  $params = @{ Uri = "$($script:Base)/dsh-taskboard$path"; Method = $method; WebSession = $script:Session; TimeoutSec = 60 }
  if ($null -ne $body) {
    $params.ContentType = 'application/json'
    $params.Body = ($body | ConvertTo-Json -Depth 12 -Compress)
  }
  try { return [pscustomobject]@{ ok = $true; status = 200; body = (Invoke-RestMethod @params) } }
  catch {
    $status = 0
    if ($null -ne $_.Exception.Response) { $status = [int]$_.Exception.Response.StatusCode }
    $payload = $null
    if ($_.ErrorDetails -and $_.ErrorDetails.Message) {
      try { $payload = $_.ErrorDetails.Message | ConvertFrom-Json } catch { $payload = $_.ErrorDetails.Message }
    }
    return [pscustomobject]@{ ok = $false; status = $status; body = $payload; raw = $_.Exception.Message }
  }
}
function ApiMessage($r) {
  if ($null -ne $r.body) { return ($r.body | ConvertTo-Json -Depth 8 -Compress) }
  return "$($r.raw) (status $($r.status))"
}
function Post([string]$path, $body) { return Api 'POST' $path $body }
function GetApi([string]$path) { return Api 'GET' $path $null }

# ---------------------------------------------------------------------------
# Seed a dense board through the REAL import route (one ledger replace).
#   - ~300 backlog cards, varied titles/descriptions/urgencies/checklists,
#   - a handful in todo / in_progress / in_review / done so every column and
#     the human review actions are exercised visually.
# ---------------------------------------------------------------------------
function New-SeedLedger([int]$count) {
  $now = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
  $epid = @(
    'Charte, gouvernance et exigences', 'Corpus de référence et baselines', 'Plateforme de développement continu',
    'Hot swap natif et rollback', 'Vérification, preuves et invalidation', 'DSP audio et contraintes temps réel',
    'Verticale full-stack inter-cibles', 'Contrats de synchronisation multi-agents', 'Panneau de configuration L0–L4',
    'Adaptateurs d''inférence sans régression', 'Tests de régression des dépendances', 'Navigation responsive du board'
  )
  $desc = @(
    'Stabiliser le périmètre, les décisions et les critères de qualité.',
    'Architecture du daemon, analyse incrémentale et retours de vérification.',
    'Préparer les garde-fous de mise à jour continue et les conditions de rollback.',
    'Formaliser les résultats déterministes, limites de preuve et contre-exemples.',
    'Contrats stricts : mémoire, latence, allocations et absence de blocages.',
    'Unifier les moteurs locaux, distants et hybrides derrière un point d''entrée.'
  )
  $urgencies = @('urgent', 'normal', 'normal', 'normal', 'relaxed')
  $statuses = @('backlog', 'backlog', 'backlog', 'backlog', 'todo', 'todo', 'in_progress', 'in_progress', 'in_review', 'done')
  # Functional categories (design brief): the factory palette plus one custom
  # category, so the capture proves custom categories work end to end.
  $categoryIds = @('development', 'bug', 'design', 'documentation', 'tests', 'performance', 'security', 'infrastructure', 'research', 'maintenance', 'analytics')
  $categorySettings = @(
    @{ id = 'development'; name = 'Développement'; color = '#a9c8f2'; order = 0 },
    @{ id = 'bug'; name = 'Bug / Correction'; color = '#f1abb4'; order = 1 },
    @{ id = 'design'; name = 'Design / UI-UX'; color = '#c5b2ef'; order = 2 },
    @{ id = 'documentation'; name = 'Documentation'; color = '#9ed9c6'; order = 3 },
    @{ id = 'tests'; name = 'Tests / QA'; color = '#f2c09d'; order = 4 },
    @{ id = 'performance'; name = 'Performance'; color = '#eadd95'; order = 5 },
    @{ id = 'security'; name = 'Sécurité'; color = '#d6a6c5'; order = 6 },
    @{ id = 'infrastructure'; name = 'Infrastructure / CI'; color = '#a4d6dc'; order = 7 },
    @{ id = 'research'; name = 'Recherche / R&D'; color = '#b8bbf0'; order = 8 },
    @{ id = 'maintenance'; name = 'Maintenance'; color = '#c8cdd6'; order = 9 },
    @{ id = 'analytics'; name = 'Données / Analyse'; color = '#b7d9c2'; order = 10 },
    @{ id = 'general'; name = 'Général / Non classé'; color = '#e4e7ec'; order = 11 }
  )
  $tasks = [System.Collections.Generic.List[object]]::new()
  for ($i = 0; $i -lt $count; $i++) {
    $projectId = if (($i % 4) -eq 0) { $script:WorkspaceId2 } else { $script:WorkspaceId }
    $status = if ($i -ge ($count - 10)) { $statuses[($i - ($count - 10)) % $statuses.Length] } else { 'backlog' }
    $urgency = $urgencies[($i * 7) % $urgencies.Length]
    $checklist = $null
    if (($i % 5) -eq 0) {
      $total = 3 + ($i % 4)
      $done = $i % ($total + 1)
      $checklist = @()
      for ($j = 0; $j -lt $total; $j++) {
        $checklist += [ordered]@{
          id = "c-$j"; text = @('Documentation cohérente', 'Tests et preuves', 'Revue indépendante', 'Compatibilité', 'Traçabilité')[ $j % 5 ]
          checked = ($j -lt $done); checkedAt = if ($j -lt $done) { $now - 60000 } else { $null }; checkedBy = if ($j -lt $done) { 'user' } else { $null }
        }
      }
    }
    $task = [ordered]@{
      id = ('t-pastel-{0:d3}' -f $i)
      title = ('[{0}] {1}' -f ('E{0:d2}' -f (($i % 12) + 1)), $epid[$i % $epid.Length])
      description = $desc[($i * 3) % $desc.Length]
      prompt = ''
      workspaceId = $projectId
      urgency = $urgency
      status = $status
      blocked = ($i % 37 -eq 0)
      execution = [ordered]@{ mode = 'claim' }
      isolation = 'none'
      permission = 'workspace-write'
      version = 1
      createdAt = $now - ($i * 3600000)
      updatedAt = $now - ($i * 600000)
      createdBy = [ordered]@{ kind = 'user' }
      updatedBy = [ordered]@{ kind = 'user' }
      comments = @()
      executions = @()
    }
    if ($null -ne $checklist) { $task.checklist = $checklist }
    if ($i % 13 -ne 0) { $task.category = $categoryIds[$i % $categoryIds.Length] }
    if ($i % 11 -eq 0) { $task.waitingForHuman = $true; $task.waitingReason = 'Décision requise sur le périmètre' }
    $tasks.Add($task)
  }
  return [ordered]@{
    schemaVersion = 1
    revision = 1
    tasks = $tasks
    settings = [ordered]@{
      categories = $categorySettings
      categoryLabelMap = [ordered]@{ analytics = 'analytics'; data = 'analytics' }
    }
  }
}

function Seed-Board([int]$count) {
  $state = (GetApi '/state').body.value
  $existing = @($state.tasks).Count
  $categorized = @($state.tasks | Where-Object { $null -ne $_.category }).Count
  if ($existing -ge ($count - 20) -and $categorized -ge ($count - 20)) {
    Info "board already seeded with categories ($existing tasks) — skipping"
    return
  }
  Step "seeding $count tasks through POST /import (mode=replace, backed up by the host)"
  $ledger = New-SeedLedger $count
  $preview = Post '/import/preview' $ledger
  if (-not $preview.ok) { Fail "import preview failed: $(ApiMessage $preview)" }
  $invalid = @($preview.body.value.plan.invalid)
  if ($invalid.Count -gt 0) { Fail "import preview rejected $($invalid.Count) task(s): $($invalid[0].reason)" }
  $commit = Post '/import' @{ mode = 'replace'; ledger = $ledger }
  if (-not $commit.ok) { Fail "import commit failed: $(ApiMessage $commit)" }
  Info "seeded: created=$($commit.body.value.created) replacedTotal=$($commit.body.value.replacedTotal)"
}

# ---------------------------------------------------------------------------
# Capture.
# ---------------------------------------------------------------------------
function Invoke-Capture {
  $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
  $kind = [System.IO.Path]::GetFileNameWithoutExtension($CaptureScript)
  $outDir = Join-Path $script:Repo "scripts/qa/reports/$kind-$stamp"
  New-Item -ItemType Directory -Force -Path $outDir | Out-Null
  $browser = @(
    'C:\Program Files\BraveSoftware\Brave-Browser\Application\brave.exe',
    'C:\Program Files\Google\Chrome\Application\chrome.exe',
    'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'
  ) | Where-Object { Test-Path $_ } | Select-Object -First 1
  if ($null -eq $browser) { Fail 'no Chromium executable found (Brave/Chrome/Edge)' }
  $env:PTB_BASE = $script:Base
  $env:PTB_TOKEN = $script:Token
  $env:PTB_OUT = $outDir
  $env:PTB_BROWSER = $browser
  $env:PTB_MOCKUP = if ($null -ne $script:Mini) { Join-Path $script:Mini 'DSH_Task_Board_DeepSeek_Pastel_Maquette_V1.html' } else { '' }
  $env:PTB_LABEL = $Label
  Step "capturing with $browser → $outDir"
  $script = Join-Path $PSScriptRoot $CaptureScript
  & node $script
  if ($LASTEXITCODE -ne 0) { Fail "capture failed with exit code $LASTEXITCODE" }
  Info "captures + metrics written to $outDir"
  return $outDir
}

# ---------------------------------------------------------------------------
# Main.
# ---------------------------------------------------------------------------
try {
  Initialize-Profile
  Initialize-Workspace
  Start-Host
  if (-not $SkipSeed) { Seed-Board $SeedCount }
  $out = Invoke-Capture
  if ($KeepHost) {
    Info "host kept alive at $($script:Base)/?token=$($script:Token)"
    Info "stop it later with: pwsh -File scripts/qa/pastel-visual-host.ps1 -KeepHost:$false -SkipSetup -SkipSeed  (or kill port $Port)"
  } else {
    Stop-Host
  }
} finally {
  if (-not $KeepHost) { try { Stop-Host } catch { } }
}




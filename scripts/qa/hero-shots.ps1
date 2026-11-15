# Hero screenshots with FICTIONAL data — no real project, path, task or person.
#
# Boots an isolated DSH home (cloned from the QA home so the plugin is already
# linked), replaces its workspace registry with three invented projects, wipes
# the board ledger, then runs `hero-capture.mjs`, which seeds the demo cards
# through the real import route and captures the plugin panel alone.
#
#   pwsh -File scripts/qa/hero-shots.ps1 [-Source <home>] [-HeroHome <home>] [-Port 64943] [-KeepHost]
#
# Output: scripts/qa/reports/hero-<stamp>/{hero-desktop-1440x900,hero-mobile-390x844,
# hero-landscape-844x390}.png + hero-shots.json + hero-seed.json

param(
  [string] $Source = (Join-Path $HOME 'dsh-tb-test'),
  [string] $HeroHome = (Join-Path $HOME 'dsh-hero'),
  [string] $ProfileName = 'tb',
  [int]    $Port = 64943,
  [ValidateSet('dark', 'light')] [string] $Theme = 'dark',
  [switch] $KeepHost
)

$ErrorActionPreference = 'Stop'
$script:Repo = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$script:Cli = 'C:\Users\barat\AppData\Local\Programs\DeepSeek Harness\resources\runtime\cli\bin\dsh.cmd'
$script:WorkspacePath = 'C:\Users\barat\Documents\deepseek-harness\default-workspace'
$script:BootLog = Join-Path $HeroHome 'hero-boot.log'
$script:ErrLog = Join-Path $HeroHome 'hero-boot-err.log'

function Info([string]$message) { Write-Host "[info] $message" -ForegroundColor Cyan }
function Step([string]$message) { Write-Host "[step] $message" -ForegroundColor Yellow }
function Fail([string]$message) { throw $message }

# 1. Isolated home: clone the QA home (profile + plugin link already installed).
if (-not (Test-Path $Source)) { Fail "source QA home not found: $Source (run scripts/qa/pastel-visual-host.ps1 once)" }
if (Test-Path $HeroHome) { Remove-Item $HeroHome -Recurse -Force }
Step "cloning $Source → $HeroHome"
Copy-Item $Source $HeroHome -Recurse -Force
Remove-Item (Join-Path $HeroHome 'dsh-taskboard.json') -Force -ErrorAction SilentlyContinue

# 2. Fictional workspace registry (invented projects, invented paths).
$ids = @(
  '11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222222',
  '33333333-3333-4333-8333-333333333333'
)
$projects = @(
  @{ id = $ids[0]; title = 'Atelier Lumen';  path = 'C:\demo\atelier-lumen' },
  @{ id = $ids[1]; title = 'Nova Labs';      path = 'C:\demo\nova-labs' },
  @{ id = $ids[2]; title = 'Studio Kestrel'; path = 'C:\demo\studio-kestrel' }
)
$now = (Get-Date).ToUniversalTime().ToString('o')
$workspaces = [ordered]@{}
foreach ($project in $projects) {
  $workspaces[$project.id] = [ordered]@{
    path = $project.path; title = $project.title; sessionIds = @(); createdAt = $now; updatedAt = $now
  }
}
$registry = [ordered]@{
  unit   = [ordered]@{ name = 'workspace'; version = 2 }
  global = [ordered]@{ initialized = $true; workspaceIds = @($ids); archivedSessionIds = @(); pinnedSessionIds = @() }
  tables = [ordered]@{ workspaces = $workspaces }
}
Step "writing fictional workspaces: $($projects.title -join ', ')"
($registry | ConvertTo-Json -Depth 10) | Set-Content (Join-Path $HeroHome 'storages\workspace.json') -Encoding utf8

# 3. Boot the host on its own port.
Remove-Item $script:BootLog, $script:ErrLog -ErrorAction SilentlyContinue
$previous = $env:DSH_HOME
$env:DSH_HOME = $HeroHome
try {
  $hostProc = Start-Process -FilePath $script:Cli `
    -ArgumentList @('--profile', $ProfileName, '--no-open', '--port', "$Port") `
    -WorkingDirectory $script:WorkspacePath `
    -RedirectStandardOutput $script:BootLog -RedirectStandardError $script:ErrLog `
    -PassThru -WindowStyle Hidden
} finally { $env:DSH_HOME = $previous }

$token = $null
$base = $null
$deadline = (Get-Date).AddSeconds(120)
while ((Get-Date) -lt $deadline) {
  $line = Get-Content $script:BootLog -ErrorAction SilentlyContinue | Select-String -Pattern 'https?://127\.0\.0\.1:(\d+)/\?token=(\S+)' | Select-Object -Last 1
  if ($null -ne $line) {
    $m = [regex]::Match($line.Line, 'https?://127\.0\.0\.1:(\d+)/\?token=(\S+)')
    $base = "http://127.0.0.1:$($m.Groups[1].Value)"
    $token = $m.Groups[2].Value
    break
  }
  Start-Sleep -Milliseconds 400
}
if ($null -eq $token) { Fail "no boot URL in $($script:BootLog)" }
Info "host ready: $base"

# 4. Wait for the plugin routes, then capture.
$session = New-Object Microsoft.PowerShell.Commands.WebRequestSession
Invoke-WebRequest -Uri "$base/?token=$token" -WebSession $session -UseBasicParsing | Out-Null
for ($i = 0; $i -lt 120; $i++) {
  try {
    $r = Invoke-WebRequest -Uri "$base/dsh-taskboard/state" -WebSession $session -UseBasicParsing -TimeoutSec 10
    if ($r.StatusCode -eq 200) { break }
  } catch { }
  Start-Sleep -Milliseconds 500
}

$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$outDir = Join-Path $script:Repo "scripts/qa/reports/hero-$stamp"
New-Item -ItemType Directory -Force -Path $outDir | Out-Null
$browser = @(
  'C:\Program Files\BraveSoftware\Brave-Browser\Application\brave.exe',
  'C:\Program Files\Google\Chrome\Application\chrome.exe',
  'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'
) | Where-Object { Test-Path $_ } | Select-Object -First 1
if ($null -eq $browser) { Fail 'no Chromium executable found' }

$env:PTB_BASE = $base
$env:PTB_TOKEN = $token
$env:PTB_OUT = $outDir
$env:PTB_BROWSER = $browser
$env:PTB_THEME = $Theme
Step "capturing hero shots ($Theme theme) → $outDir"
& node (Join-Path $PSScriptRoot 'hero-capture.mjs')
if ($LASTEXITCODE -ne 0) { Fail "hero capture failed with exit code $LASTEXITCODE" }
Info "hero shots written to $outDir"

if ($KeepHost) {
  Info "host kept alive at $base/?token=$token (kill port $Port when done)"
} else {
  foreach ($connection in (Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)) {
    Stop-Process -Id $connection.OwningProcess -Force -ErrorAction SilentlyContinue
  }
}

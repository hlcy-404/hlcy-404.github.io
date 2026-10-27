[CmdletBinding()]
param([switch]$Stop, [switch]$NoBrowser, [switch]$SetupOnly)
$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
$studio = Join-Path $PSScriptRoot 'studio'
$local = Join-Path $repo '.local\studio'
$port = 4010
$url = "http://127.0.0.1:$port"
New-Item -ItemType Directory -Force -Path $local | Out-Null
function Get-Instance {
  try { return Invoke-RestMethod "$url/api/health" -TimeoutSec 2 } catch { return $null }
}
try {
  $instance = Get-Instance
  if ($instance -and $instance.app -ne 'hlcy-local-studio') { throw 'Port 4010 is occupied by another application.' }
  if ($instance -and $instance.root -ne $repo) { throw 'A studio for another repository is using port 4010.' }
  if ($Stop) {
    if ($instance) {
      $session = Invoke-RestMethod "$url/api/session"
      Invoke-RestMethod "$url/api/shutdown" -Method Post -ContentType 'application/json' -Body '{}' -Headers @{'X-Studio-Token'=$session.token;Origin=$url} | Out-Null
      Write-Host 'Studio stopped. Drafts have been preserved.'
    } else { Write-Host 'Studio is not running.' }
    exit 0
  }
  if ($instance) { if (-not $NoBrowser) { Start-Process $url }; exit 0 }
  $version = 'v24.22.1'
  $runtime = Join-Path $repo ".local\runtime\node-$version-win-x64"
  $node = Join-Path $runtime 'node.exe'
  if (-not (Test-Path -LiteralPath $node)) {
    $runtimeParent = Split-Path -Parent $runtime
    New-Item -ItemType Directory -Force -Path $runtimeParent | Out-Null
    $file = "node-$version-win-x64.zip"
    $zip = Join-Path $runtimeParent $file
    Write-Host "Preparing project-local Node.js $version..."
    Invoke-WebRequest "https://nodejs.org/dist/$version/$file" -OutFile $zip -UseBasicParsing
    $checks = (Invoke-WebRequest "https://nodejs.org/dist/$version/SHASUMS256.txt" -UseBasicParsing).Content
    $expected = (($checks -split "`n" | Where-Object { $_.Trim().EndsWith(" $file") }) -split '\s+')[0]
    if (-not $expected -or (Get-FileHash -LiteralPath $zip -Algorithm SHA256).Hash.ToLowerInvariant() -ne $expected) { throw 'Node.js archive checksum failed.' }
    Expand-Archive -LiteralPath $zip -DestinationPath $runtimeParent -Force
  }
  $npm = Join-Path $runtime 'node_modules\npm\bin\npm-cli.js'
  Push-Location $studio
  try {
    $lock = Join-Path $studio 'package-lock.json'
    $stamp = Join-Path $local 'dependencies.sha256'
    $installCode = 0
    if (-not (Test-Path $lock)) {
      & $node $npm install --ignore-scripts --no-audit --no-fund
      $installCode = $LASTEXITCODE
    } elseif (-not (Test-Path (Join-Path $studio 'node_modules\easymde')) -or -not (Test-Path $stamp) -or (Get-Content $stamp -Raw).Trim() -ne (Get-FileHash $lock).Hash) {
      & $node $npm ci --ignore-scripts --no-audit --no-fund
      $installCode = $LASTEXITCODE
    }
    if ($installCode -ne 0) { throw 'Could not install the local editor dependencies.' }
    (Get-FileHash $lock).Hash | Set-Content $stamp
  } finally { Pop-Location }
  if ($SetupOnly) { Write-Host 'Local runtime and dependencies are ready.'; exit 0 }
  $script = Join-Path $studio 'server.mjs'
  Start-Process -FilePath $node -ArgumentList @(('"' + $script + '"')) -WorkingDirectory $repo -WindowStyle Hidden -RedirectStandardOutput (Join-Path $local 'server.out.log') -RedirectStandardError (Join-Path $local 'server.err.log') | Out-Null
  for ($i=0; $i -lt 40; $i++) { Start-Sleep -Milliseconds 250; $instance = Get-Instance; if ($instance) { break } }
  if (-not $instance) { throw 'Studio did not start. See .local/studio/server.err.log.' }
  Write-Host "Studio is ready: $url"
  if (-not $NoBrowser) { Start-Process $url }
} catch { Write-Host $_.Exception.Message -ForegroundColor Red; exit 1 }

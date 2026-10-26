[CmdletBinding()]
param(
    [string]$Message,
    [switch]$Yes,
    [switch]$CheckOnly
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$expectedOrigin = 'https://github.com/hlcy-404/hlcy-404.github.io.git'

function Invoke-Git {
    param([string[]]$GitArgs)
    $result = & git @GitArgs
    if ($LASTEXITCODE -ne 0) { throw "Git failed: git $($GitArgs -join ' ')" }
    return $result
}

function Get-ChangedPaths {
    $paths = @()
    foreach ($gitArgs in @(
        @('diff', '--name-only', '--no-renames', '-z'),
        @('diff', '--cached', '--name-only', '--no-renames', '-z'),
        @('ls-files', '--others', '--exclude-standard', '-z')
    )) {
        $raw = (Invoke-Git -GitArgs $gitArgs) -join "`n"
        $paths += $raw.Split([char]0) | Where-Object { $_.Length -gt 0 }
    }
    return @($paths | Sort-Object -Unique)
}

Push-Location -LiteralPath $repoRoot
try {
    if (-not (Get-Command git -ErrorAction SilentlyContinue)) { throw 'Git is not installed.' }
    $branch = Invoke-Git -GitArgs @('branch', '--show-current')
    if ($branch -ne 'main') { throw 'This publishing shortcut requires the main branch. Switch branches deliberately before publishing.' }
    $origin = Invoke-Git -GitArgs @('remote', 'get-url', 'origin')
    $pushOrigin = Invoke-Git -GitArgs @('remote', 'get-url', '--push', 'origin')
    if ($origin -ne $expectedOrigin -or $pushOrigin -ne $expectedOrigin) { throw 'Unexpected origin. Stop and review the repository connection.' }
    foreach ($state in @('MERGE_HEAD', 'CHERRY_PICK_HEAD', 'REVERT_HEAD', 'rebase-merge', 'rebase-apply')) {
        $statePath = Invoke-Git -GitArgs @('rev-parse', '--git-path', $state)
        if (Test-Path -LiteralPath $statePath) { throw "Finish the existing Git operation first: $state" }
    }
    if (Invoke-Git -GitArgs @('diff', '--name-only', '--diff-filter=U')) { throw 'Resolve merge conflicts before syncing.' }
    if (-not (Invoke-Git -GitArgs @('config', 'user.name'))) { throw 'Configure a commit author first.' }
    if (-not (Invoke-Git -GitArgs @('config', 'user.email'))) { throw 'Configure a commit email first.' }

    Write-Host 'Fetching the latest GitHub state...'
    Invoke-Git -GitArgs @('fetch', 'origin', 'main') | Out-Host
    $counts = (Invoke-Git -GitArgs @('rev-list', '--left-right', '--count', 'HEAD...origin/main')) -split '\s+'
    $ahead = [int]$counts[0]
    $behind = [int]$counts[1]
    $paths = @(Get-ChangedPaths)
    if ($behind -gt 0) {
        if ($ahead -gt 0 -or $paths.Count -gt 0) {
            throw 'GitHub has newer commits. Your local work has been preserved. Review and integrate remote changes before retrying; this shortcut will not overwrite either side.'
        }
        if ($CheckOnly) {
            Write-Host "Check only: the clean local branch is $behind commit(s) behind GitHub."
            exit 0
        }
        Invoke-Git -GitArgs @('merge', '--ff-only', 'origin/main') | Out-Host
    }

    Write-Host "Repository: $repoRoot"
    Write-Host "Changed files: $($paths.Count); existing unpushed commits: $ahead"
    Invoke-Git -GitArgs @('-c', 'core.quotepath=false', 'status', '--short') | Out-Host
    foreach ($path in $paths) {
        if ($path -match '(^|/)(\.env($|\.)|\.local/|secrets?(/|\.)|id_(rsa|ed25519)($|\.))|\.(pem|key|p12|pfx)$') {
            if ($path -notmatch '(^|/)\.env\.example$') { throw "Potentially private file: $path. Review it before publishing." }
        }
        if ($path -match '[\r\n]') { throw 'Rename files containing line breaks before using this shortcut.' }
        $absolute = Join-Path $repoRoot $path
        if ((Test-Path -LiteralPath $absolute -PathType Leaf) -and (Get-Item -LiteralPath $absolute).Length -gt 50MB) {
            throw "File is larger than 50 MB: $path. Review large files before publishing."
        }
    }
    if ($CheckOnly) { Write-Host 'Check complete. No files were staged, committed, or pushed.'; exit 0 }
    if ($paths.Count -eq 0 -and $ahead -eq 0) { Write-Host 'Already synchronized.'; exit 0 }
    if (-not $Yes) {
        $answer = Read-Host 'Publish the listed changes and unpushed commits to GitHub? [y/N]'
        if ($answer -notmatch '^(y|yes)$') { Write-Host 'Cancelled. Local changes have been preserved.'; exit 0 }
    }
    if ($paths.Count -gt 0) {
        if ([string]::IsNullOrWhiteSpace($Message) -and -not $Yes) { $Message = Read-Host 'Describe this update (Enter uses the current date)' }
        if ([string]::IsNullOrWhiteSpace($Message)) { $Message = 'Update blog ' + (Get-Date -Format 'yyyy-MM-dd HH:mm') }
        Invoke-Git -GitArgs (@('--literal-pathspecs', 'add', '-A', '--') + $paths) | Out-Host
        & git diff --cached --quiet
        if ($LASTEXITCODE -eq 1) { Invoke-Git -GitArgs @('commit', '-m', $Message) | Out-Host }
        elseif ($LASTEXITCODE -ne 0) { throw 'Could not inspect staged changes.' }
    }
    Invoke-Git -GitArgs @('push', 'origin', 'main') | Out-Host
    Invoke-Git -GitArgs @('fetch', 'origin', 'main') | Out-Host
    $localHead = Invoke-Git -GitArgs @('rev-parse', 'HEAD')
    $remoteHead = Invoke-Git -GitArgs @('rev-parse', 'origin/main')
    if ($localHead -ne $remoteHead) { throw 'GitHub changed during the sync. Inspect the new remote commits before retrying.' }
    Write-Host "Synchronized: $localHead"
    Write-Host 'Website deployment is a separate step. Check: https://github.com/hlcy-404/hlcy-404.github.io/actions'
}
catch {
    Write-Host "Sync stopped: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host 'Local files and existing commits are preserved. Fix the reported issue and run sync.cmd again.'
    exit 1
}
finally { Pop-Location }

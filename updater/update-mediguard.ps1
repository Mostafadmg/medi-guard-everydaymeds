# Replaces the already-loaded MediGuard folder with the latest GitHub copy.
$ErrorActionPreference = "Stop"
$Repo = "Mostafadmg/medi-guard-everydaymeds"
$Branch = "main"
$ZipUrl = "https://github.com/$Repo/archive/refs/heads/$Branch.zip"
$Log = Join-Path $env:LOCALAPPDATA "MediGuardUpdater\update.log"

function Write-Log($msg) {
  $dir = Split-Path $Log
  if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir | Out-Null }
  $line = "{0}  {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $msg
  Add-Content -Path $Log -Value $line
}

function Read-SharedText($path) {
  $fs = [System.IO.File]::Open($path, "Open", "Read", "ReadWrite")
  try {
    $reader = New-Object System.IO.StreamReader($fs)
    return $reader.ReadToEnd()
  } finally {
    $fs.Dispose()
  }
}

function Convert-JsonPath($raw) {
  return ($raw -replace '\\\\', '\') -replace '/', '\'
}

function Get-InstalledFolders {
  $roots = @(
    (Join-Path $env:LOCALAPPDATA "Google\Chrome\User Data"),
    (Join-Path $env:LOCALAPPDATA "Microsoft\Edge\User Data")
  )
  $found = @{}
  foreach ($root in $roots) {
    if (-not (Test-Path $root)) { continue }
    $prefs = Get-ChildItem $root -Directory -ErrorAction SilentlyContinue |
      ForEach-Object { Join-Path $_.FullName "Preferences" } |
      Where-Object { Test-Path $_ }
    foreach ($pref in $prefs) {
      $text = Read-SharedText $pref
      $pathMatches = [regex]::Matches($text, '"path"\s*:\s*"((?:\\.|[^"\\])*)"')
      foreach ($m in $pathMatches) {
        $folder = Convert-JsonPath $m.Groups[1].Value
        $manifestPath = Join-Path $folder "manifest.json"
        if (-not (Test-Path $manifestPath)) { continue }
        try {
          $manifest = Get-Content $manifestPath -Raw | ConvertFrom-Json
        } catch { continue }
        if ($manifest.name -like "*EverydayMeds*") { $found[$folder] = $true }
      }
    }
  }
  return @($found.Keys)
}

function Expand-GitHubZip($zipPath, $destRoot) {
  $extract = Join-Path $destRoot "extract"
  if (Test-Path $extract) { Remove-Item $extract -Recurse -Force }
  Expand-Archive -Path $zipPath -DestinationPath $extract -Force
  $inner = Get-ChildItem $extract -Directory | Select-Object -First 1
  if (-not $inner) { throw "GitHub zip had no folder" }
  return $inner.FullName
}

try {
  Write-Log "start"
  $folders = Get-InstalledFolders
  if ($folders.Count -eq 0) {
    Write-Log "no installed MediGuard folder found"
    exit 0
  }

  $work = Join-Path $env:TEMP ("mediguard-update-" + [guid]::NewGuid().ToString("N"))
  New-Item -ItemType Directory -Path $work | Out-Null
  $zip = Join-Path $work "src.zip"
  Invoke-WebRequest -Uri $ZipUrl -OutFile $zip -UseBasicParsing
  $source = Expand-GitHubZip $zip $work

  foreach ($dest in $folders) {
    Write-Log "update $dest"
    & robocopy $source $dest /E /NFL /NDL /NJH /NJS /nc /ns /np | Out-Null
    if ($LASTEXITCODE -ge 8) { throw "robocopy failed for $dest with code $LASTEXITCODE" }
  }

  $self = Join-Path $source "updater\update-mediguard.ps1"
  $installed = Join-Path $env:LOCALAPPDATA "MediGuardUpdater\update-mediguard.ps1"
  if ((Test-Path $self) -and (Test-Path (Split-Path $installed))) {
    Copy-Item $self $installed -Force
  }
  Write-Log "done"
} catch {
  Write-Log ("ERROR " + $_.Exception.Message)
  exit 1
} finally {
  if ($work -and (Test-Path $work)) { Remove-Item $work -Recurse -Force -ErrorAction SilentlyContinue }
}

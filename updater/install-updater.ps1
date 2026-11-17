# Run once on a staff computer. After this, GitHub updates land in the
# extension folder they already loaded. They do not download a new folder.
$ErrorActionPreference = "Stop"
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$destDir = Join-Path $env:LOCALAPPDATA "MediGuardUpdater"
$dest = Join-Path $destDir "update-mediguard.ps1"
New-Item -ItemType Directory -Path $destDir -Force | Out-Null
Copy-Item (Join-Path $here "update-mediguard.ps1") $dest -Force

$action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$dest`""
$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 30) -RepetitionDuration (New-TimeSpan -Days 3650)
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable
Register-ScheduledTask -TaskName "MediGuard Updater" -Action $action -Trigger $trigger -Settings $settings -Force | Out-Null

& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $dest
Write-Output "Updater installed. It checks GitHub every 30 minutes."
Write-Output "Restart Chrome once on this computer so the new copy loads."

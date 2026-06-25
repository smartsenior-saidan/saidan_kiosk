# NFC Reader Auto-Setup Script
# Deploy via Microsoft Intune as a PowerShell script (run as System, 64-bit).
#
# This uses the built-in Windows PC/SC API (winscard.dll) via PowerShell.
# No Node.js, no Python, no Visual Studio Build Tools, no compiling — nothing
# to download and build on the device. Just drop the script and register a task.

$ErrorActionPreference = "Stop"
$installPath = "C:\KioskProgram"
$logFile     = "C:\KioskProgram-setup.log"
$nfcDir      = "$installPath\nfc"
$readerScript = "$nfcDir\nfc-reader.ps1"

function Write-Log {
    param($message)
    $line = "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') - $message"
    Write-Output $line
    $line | Out-File -FilePath $logFile -Append -Encoding UTF8
}

Write-Log "Starting NFC Reader setup..."

# 1. Stop any running reader so its files aren't locked during update
Stop-ScheduledTask -TaskName "SmartSenior-NFCReader" -ErrorAction SilentlyContinue
Get-Process node -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -like "*nfc-reader.ps1*" } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }

# 2. Download and extract the project as a ZIP (no Git — avoids git stderr issues)
Write-Log "Downloading project..."
$zipUrl     = "https://github.com/smartsenior-saidan/kioskprogram/archive/refs/heads/main.zip"
$zipPath    = "$env:TEMP\kiosk.zip"
$extractDir = "$env:TEMP\kiosk-extract"
Invoke-WebRequest -Uri $zipUrl -OutFile $zipPath -UseBasicParsing

Write-Log "Extracting project..."
if (Test-Path $extractDir) { Remove-Item -Path $extractDir -Recurse -Force }
Expand-Archive -Path $zipPath -DestinationPath $extractDir -Force

# ZIP extracts to a subfolder (e.g. kioskprogram-main) — move it into place
$extractedRepo = Get-ChildItem -Path $extractDir -Directory | Select-Object -First 1
if (Test-Path $installPath) {
    Write-Log "Removing existing install folder..."
    Remove-Item -Path $installPath -Recurse -Force
}
Move-Item -Path $extractedRepo.FullName -Destination $installPath
Write-Log "Project files placed at $installPath"

if (-not (Test-Path $readerScript)) {
    Write-Log "ERROR: $readerScript not found in the downloaded project."
    throw "nfc-reader.ps1 missing"
}

# 3. Make sure the Smart Card service is running and starts automatically
Write-Log "Ensuring Smart Card service is enabled..."
try {
    Set-Service -Name SCardSvr -StartupType Automatic -ErrorAction Stop
    Start-Service -Name SCardSvr -ErrorAction SilentlyContinue
} catch {
    Write-Log "Could not configure SCardSvr: $_"
}

# 4. Create a VBScript that launches the PowerShell reader with no visible window
$vbsContent = @"
Set WshShell = CreateObject("WScript.Shell")
WshShell.Run "powershell.exe -ExecutionPolicy Bypass -WindowStyle Hidden -File ""$readerScript""", 0, False
"@
$vbsContent | Out-File -FilePath "$nfcDir\start-nfc.vbs" -Encoding ASCII
Write-Log "Created start-nfc.vbs"

# 5. Register Scheduled Task to run the NFC reader at every user login
$taskAction = New-ScheduledTaskAction `
    -Execute "wscript.exe" `
    -Argument "`"$nfcDir\start-nfc.vbs`""

$taskTrigger = New-ScheduledTaskTrigger -AtLogOn

$taskSettings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -ExecutionTimeLimit 0 `
    -RestartCount 3 `
    -RestartInterval (New-TimeSpan -Minutes 1)

$taskPrincipal = New-ScheduledTaskPrincipal -GroupId "BUILTIN\Users" -RunLevel Highest

Register-ScheduledTask `
    -TaskName "SmartSenior-NFCReader" `
    -Action $taskAction `
    -Trigger $taskTrigger `
    -Settings $taskSettings `
    -Principal $taskPrincipal `
    -Force

Write-Log "Scheduled task registered"
Write-Log "Setup complete!"

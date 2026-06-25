# NFC Reader Auto-Setup Script
# Deploy via Microsoft Intune as a PowerShell script (run as System, 64-bit)

$ErrorActionPreference = "Stop"
$installPath = "C:\KioskProgram"
$logFile = "C:\KioskProgram\nfc-setup.log"
$repoUrl = "https://github.com/smartsenior-saidan/kioskprogram.git"
$nodeVersion = "v20.11.0"
$nodeInstaller = "$env:TEMP\node-installer.msi"
$nodePath = "C:\Program Files\nodejs\node.exe"
$npmPath = "C:\Program Files\nodejs\npm.cmd"

function Write-Log {
    param($message)
    $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    $line = "$timestamp - $message"
    Write-Output $line
    if (Test-Path (Split-Path $logFile)) {
        $line | Out-File -FilePath $logFile -Append -Encoding UTF8
    }
}

# 1. Create install folder
if (-not (Test-Path $installPath)) {
    New-Item -ItemType Directory -Path $installPath -Force | Out-Null
}

Write-Log "Starting NFC Reader setup..."

# 2. Install Node.js silently if not installed
if (-not (Test-Path $nodePath)) {
    Write-Log "Downloading Node.js $nodeVersion..."
    Invoke-WebRequest -Uri "https://nodejs.org/dist/$nodeVersion/node-$nodeVersion-x64.msi" -OutFile $nodeInstaller -UseBasicParsing
    Write-Log "Installing Node.js..."
    Start-Process msiexec.exe -ArgumentList "/i `"$nodeInstaller`" /qn /norestart" -Wait
    Write-Log "Node.js installed"
} else {
    Write-Log "Node.js already installed"
}

# 3. Install Git silently if not installed
$gitPath = "C:\Program Files\Git\cmd\git.exe"
if (-not (Test-Path $gitPath)) {
    Write-Log "Downloading Git..."
    $gitInstaller = "$env:TEMP\git-installer.exe"
    Invoke-WebRequest -Uri "https://github.com/git-for-windows/git/releases/download/v2.43.0.windows.1/Git-2.43.0-64-bit.exe" -OutFile $gitInstaller -UseBasicParsing
    Write-Log "Installing Git..."
    Start-Process $gitInstaller -ArgumentList "/VERYSILENT /NORESTART /NOCANCEL /SP-" -Wait
    Write-Log "Git installed"
} else {
    Write-Log "Git already installed"
}

# 4. Clone or update the repo
if (-not (Test-Path "$installPath\.git")) {
    Write-Log "Cloning repository..."
    & "C:\Program Files\Git\cmd\git.exe" clone $repoUrl $installPath
} else {
    Write-Log "Updating repository..."
    & "C:\Program Files\Git\cmd\git.exe" -C $installPath pull
}

# 5. Install npm packages
Write-Log "Installing npm packages..."
& $npmPath install --prefix $installPath

# 6. Create a VBScript to launch node silently (no terminal window)
$vbsContent = @"
Set WshShell = CreateObject("WScript.Shell")
WshShell.Run """C:\Program Files\nodejs\node.exe"" C:\KioskProgram\nfc\read.js", 0, False
"@
$vbsContent | Out-File -FilePath "$installPath\nfc\start-nfc.vbs" -Encoding ASCII
Write-Log "Created start-nfc.vbs"

# 7. Register Scheduled Task to run NFC reader at every user login
$taskAction = New-ScheduledTaskAction `
    -Execute "wscript.exe" `
    -Argument "`"$installPath\nfc\start-nfc.vbs`""

$taskTrigger = New-ScheduledTaskTrigger -AtLogOn

$taskSettings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -ExecutionTimeLimit 0 `
    -RestartCount 3 `
    -RestartInterval (New-TimeSpan -Minutes 1)

Register-ScheduledTask `
    -TaskName "SmartSenior-NFCReader" `
    -Action $taskAction `
    -Trigger $taskTrigger `
    -Settings $taskSettings `
    -RunLevel Highest `
    -Force

Write-Log "Scheduled task registered - NFC reader will start on every login"
Write-Log "Setup complete!"

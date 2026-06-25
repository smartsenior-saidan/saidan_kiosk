# NFC Reader Auto-Setup Script
# Deploy via Microsoft Intune as a PowerShell script (run as System, 64-bit).
# Installs Python, pip dependencies, downloads the kiosk reader, registers login task.
# No Node.js, no VS Build Tools, no compiling needed.

$ErrorActionPreference = "Stop"
$installPath  = "C:\KioskProgram"
$logFile      = "C:\KioskProgram-setup.log"
$pythonExe    = "C:\Program Files\Python311\python.exe"
$pythonwExe   = "C:\Program Files\Python311\pythonw.exe"
$pipExe       = "C:\Program Files\Python311\Scripts\pip.exe"

function Write-Log {
    param($message)
    $line = "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') - $message"
    Write-Output $line
    $line | Out-File -FilePath $logFile -Append -Encoding UTF8
}

Write-Log "Starting NFC Reader setup..."

# 1. Stop any existing reader process
Stop-ScheduledTask -TaskName "SmartSenior-NFCReader" -ErrorAction SilentlyContinue
Get-CimInstance Win32_Process -Filter "Name='pythonw.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -like "*kiosk_reader*" } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }

# 2. Download project from GitHub
Write-Log "Downloading project..."
$zipUrl     = "https://github.com/smartsenior-saidan/kioskprogram/archive/refs/heads/main.zip"
$zipPath    = "$env:TEMP\kiosk.zip"
$extractDir = "$env:TEMP\kiosk-extract"
Invoke-WebRequest -Uri $zipUrl -OutFile $zipPath -UseBasicParsing

Write-Log "Extracting project..."
if (Test-Path $extractDir) { Remove-Item -Path $extractDir -Recurse -Force }
Expand-Archive -Path $zipPath -DestinationPath $extractDir -Force

$extractedRepo = Get-ChildItem -Path $extractDir -Directory | Select-Object -First 1
if (Test-Path $installPath) {
    Write-Log "Removing existing install..."
    Remove-Item -Path $installPath -Recurse -Force
}
Move-Item -Path $extractedRepo.FullName -Destination $installPath
Write-Log "Project placed at $installPath"

# 3. Install Python 3.11 system-wide (if not already installed)
if (-not (Test-Path $pythonExe)) {
    Write-Log "Downloading Python 3.11..."
    Invoke-WebRequest -Uri "https://www.python.org/ftp/python/3.11.9/python-3.11.9-amd64.exe" `
        -OutFile "$env:TEMP\python311.exe" -UseBasicParsing
    Write-Log "Installing Python..."
    Start-Process "$env:TEMP\python311.exe" `
        -ArgumentList "/quiet InstallAllUsers=1 PrependPath=1 Include_test=0" -Wait
    Write-Log "Python installed"
} else {
    Write-Log "Python already installed"
}

# 4. Install Python dependencies (all have pre-built Windows wheels - no compiling)
Write-Log "Installing Python packages..."
$env:PATH = [System.Environment]::GetEnvironmentVariable("PATH", "Machine") + ";" + $env:PATH
& $pipExe install --quiet --upgrade requests websocket-client pyscard ndeflib pynput pyserial
Write-Log "Python packages installed"

# 5. Ensure Smart Card service is running
Write-Log "Enabling Smart Card service..."
Set-Service -Name SCardSvr -StartupType Automatic -ErrorAction SilentlyContinue
Start-Service -Name SCardSvr -ErrorAction SilentlyContinue

# 6. Create VBScript launcher (runs Python silently, no terminal window)
$nfcDir    = "$installPath\nfc"
$scriptPy  = "$nfcDir\kiosk_reader.py"
$scriptVbs = "$nfcDir\start-nfc.vbs"

if (-not (Test-Path $scriptPy)) {
    Write-Log "ERROR: kiosk_reader.py not found at $scriptPy"
    throw "kiosk_reader.py missing from downloaded project"
}

@"
Set WshShell = CreateObject("WScript.Shell")
WshShell.Run """$pythonwExe"" ""$scriptPy""", 0, False
"@ | Out-File -FilePath $scriptVbs -Encoding ASCII
Write-Log "Created start-nfc.vbs"

# 7. Register scheduled task — runs at every user login
$action    = New-ScheduledTaskAction -Execute "wscript.exe" -Argument "`"$scriptVbs`""
$trigger   = New-ScheduledTaskTrigger -AtLogOn
$settings  = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
    -ExecutionTimeLimit 0 -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)
$principal = New-ScheduledTaskPrincipal -GroupId "BUILTIN\Users" -RunLevel Highest

Register-ScheduledTask `
    -TaskName "SmartSenior-NFCReader" `
    -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Force

Write-Log "Scheduled task registered"
Write-Log "Setup complete!"

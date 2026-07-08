# Kiosk Launch Install Script
# Install command for the "SmartSenior Kiosk Launch" Win32 app: sets up the
# NFC/QR reader daemon and registers the Edge kiosk auto-launch task. This
# script is identical across every tenant device — it reads the tenant's home
# URL from C:\ProgramData\SmartSenior\config.json rather than hardcoding it,
# so only that small per-tenant config script needs to differ per site.
#
# Autologin signs in the shared kiosk account (kiosk@smartsenior.onmicrosoft.com)
# automatically on every boot. The password is stored via the LSA secret store
# (see lib-lsa-secret.ps1) rather than the plaintext Winlogon registry value.

$ErrorActionPreference = "Stop"
$logFile = "C:\KioskProgram-launch-install.log"

function Write-Log {
    param($message)
    $line = "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') - $message"
    Write-Output $line
    $line | Out-File -FilePath $logFile -Append -Encoding UTF8
}

Write-Log "Starting Kiosk Launch install..."

# 1. Install the QR scanner's USB-COM driver (DENSO WAVE Active USB-COM
# Port). A factory reset wipes this, and without it the scanner never shows
# up as a COM port at all, so the reader daemon has nothing to read from.
# -S runs it fully silently — documented vendor option, see
# drivers\ActiveUSBCOM_2207_J\ActiveUSBCOM_UsersGuide.pdf section 2.1.5.
$qrDriverExe = "$PSScriptRoot\drivers\ActiveUSBCOM_2207_J\Install.exe"
$qrDriverProc = Start-Process -FilePath $qrDriverExe -ArgumentList "-S" -Wait -PassThru
if ($qrDriverProc.ExitCode -ne 0) {
    Write-Log "WARNING: QR scanner driver install exited with code $($qrDriverProc.ExitCode)"
} else {
    Write-Log "QR scanner driver installed"
}

# 2. Install the Elecom MR-ICA001BK (CIR315) NFC reader driver. Same
# situation as the QR driver — a factory reset wipes it, and without it the
# reader never shows up over PC/SC at all. MSI packages have a standard
# silent-install flag (/quiet) — no vendor-specific guessing needed here.
$elecomMsi = "$PSScriptRoot\drivers\ELECOM_MR-ICA001_CIR315\Package\CIR315DriverInstallerx64.msi"
$elecomProc = Start-Process -FilePath "msiexec.exe" -ArgumentList "/i `"$elecomMsi`" /quiet /norestart" -Wait -PassThru
if ($elecomProc.ExitCode -ne 0) {
    Write-Log "WARNING: Elecom NFC reader driver install exited with code $($elecomProc.ExitCode)"
} else {
    Write-Log "Elecom NFC reader driver installed"
}

# 3. NFC/QR reader daemon setup — delegates to the existing, already-tested
# script rather than duplicating its embedded Python payload here.
& "$PSScriptRoot\nfcsetup.ps1"
Write-Log "NFC/QR setup complete"

# 4. Register the Edge kiosk auto-launch scheduled task. Reads homeUrl from
# config.json (written separately by the per-tenant script) instead of a
# hardcoded site name, so this script stays the same for every tenant.
$configFile = "C:\ProgramData\SmartSenior\config.json"
if (-not (Test-Path $configFile)) {
    throw "config.json not found at $configFile — run the per-tenant config script first."
}
$config  = Get-Content $configFile -Raw | ConvertFrom-Json
$homeUrl = $config.homeUrl
if (-not $homeUrl) {
    throw "homeUrl missing from $configFile"
}

$edgePath = "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
# --remote-debugging-port lets the NFC/QR reader navigate the existing window
# instead of opening a new one on every tap/scan (same convention as before).
$edgeArgs = "--remote-debugging-port=9222 --remote-allow-origins=http://127.0.0.1:9222 --user-data-dir=`"C:\EdgeKiosk`" --start-fullscreen `"$homeUrl`""

$action    = New-ScheduledTaskAction -Execute $edgePath -Argument $edgeArgs
$trigger   = New-ScheduledTaskTrigger -AtLogOn
$settings  = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit 0
$principal = New-ScheduledTaskPrincipal -GroupId "BUILTIN\Users" -RunLevel Highest

Register-ScheduledTask `
    -TaskName "SmartSenior-EdgeKiosk" `
    -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Force

Write-Log "Edge kiosk task registered, will open: $homeUrl"

# 5. Configure autologin for the shared kiosk account.
. "$PSScriptRoot\lib-lsa-secret.ps1"

$kioskUser = "kiosk@smartsenior.onmicrosoft.com"
$kioskPass = "Nokotsudo2525"

[LsaSecret]::SetSecret("DefaultPassword", $kioskPass)

$winlogonPath = "HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon"
New-ItemProperty -Path $winlogonPath -Name "AutoAdminLogon"    -Value "1" -PropertyType String -Force | Out-Null
New-ItemProperty -Path $winlogonPath -Name "DefaultUserName"   -Value $kioskUser -PropertyType String -Force | Out-Null
New-ItemProperty -Path $winlogonPath -Name "DefaultDomainName" -Value "" -PropertyType String -Force | Out-Null
# Deliberately not setting DefaultPassword here — Windows falls back to the
# LSA secret above when this value is absent, avoiding a plaintext password
# sitting in the registry.
Remove-ItemProperty -Path $winlogonPath -Name "DefaultPassword" -ErrorAction SilentlyContinue

Write-Log "Autologin configured for $kioskUser"

# 6. Write the Intune detection marker so this app shows as installed.
$markerPath = "HKLM:\SOFTWARE\SmartSenior\KioskLaunch"
if (-not (Test-Path $markerPath)) {
    New-Item -Path $markerPath -Force | Out-Null
}
New-ItemProperty -Path $markerPath -Name "Version" -Value "1.0.0" -PropertyType String -Force | Out-Null

Write-Log "Kiosk Launch install complete!"

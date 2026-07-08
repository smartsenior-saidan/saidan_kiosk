# Kiosk Launch Uninstall Script
# Uninstall command for the "SmartSenior Kiosk Launch" Win32 app. Reverses
# everything kiosk-launch-install.ps1 sets up: the NFC/QR reader daemon, the
# Edge kiosk auto-launch task, and the Intune detection marker.

$ErrorActionPreference = "Stop"
$logFile = "C:\KioskProgram-launch-uninstall.log"

function Write-Log {
    param($message)
    $line = "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') - $message"
    Write-Output $line
    $line | Out-File -FilePath $logFile -Append -Encoding UTF8
}

Write-Log "Starting Kiosk Launch uninstall..."

# 1. Remove the Edge kiosk auto-launch task.
Unregister-ScheduledTask -TaskName "SmartSenior-EdgeKiosk" -Confirm:$false -ErrorAction SilentlyContinue
Write-Log "Edge kiosk task removed"

# 2. Stop and remove the NFC/QR reader daemon (mirrors nfcsetup.ps1's setup).
Stop-ScheduledTask -TaskName "SmartSenior-NFCReader" -ErrorAction SilentlyContinue
Unregister-ScheduledTask -TaskName "SmartSenior-NFCReader" -Confirm:$false -ErrorAction SilentlyContinue
Get-CimInstance Win32_Process -Filter "Name='pythonw.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -like "*kiosk_reader*" } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }

$nfcDir = "C:\KioskProgram\nfc"
if (Test-Path $nfcDir) {
    Remove-Item -Path $nfcDir -Recurse -Force -ErrorAction SilentlyContinue
}
Write-Log "NFC/QR reader daemon removed"

# 3. Remove autologin — clears both the Winlogon registry values and the
# stored LSA secret.
. "$PSScriptRoot\lib-lsa-secret.ps1"

$winlogonPath = "HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon"
Set-ItemProperty -Path $winlogonPath -Name "AutoAdminLogon" -Value "0" -ErrorAction SilentlyContinue
Remove-ItemProperty -Path $winlogonPath -Name "DefaultUserName"   -ErrorAction SilentlyContinue
Remove-ItemProperty -Path $winlogonPath -Name "DefaultDomainName" -ErrorAction SilentlyContinue
Remove-ItemProperty -Path $winlogonPath -Name "DefaultPassword"   -ErrorAction SilentlyContinue
[LsaSecret]::SetSecret("DefaultPassword", "")

Write-Log "Autologin removed"

# 4. Uninstall the QR scanner's USB-COM driver.
$qrUninstallExe = "C:\Program Files\DENSO WAVE\Active USB-COM Port\DNWA_AUSBD_Uninstaller.exe"
if (Test-Path $qrUninstallExe) {
    $qrUninstallProc = Start-Process -FilePath $qrUninstallExe -ArgumentList "-S" -Wait -PassThru
    if ($qrUninstallProc.ExitCode -ne 0) {
        Write-Log "WARNING: QR scanner driver uninstall exited with code $($qrUninstallProc.ExitCode)"
    } else {
        Write-Log "QR scanner driver uninstalled"
    }
} else {
    Write-Log "QR scanner driver uninstaller not found, skipping (may not have been installed)"
}

# 5. Uninstall the Elecom NFC reader driver (MSI packages can be removed by
# pointing msiexec /x at the same .msi file used to install them).
$elecomMsi = "$PSScriptRoot\drivers\ELECOM_MR-ICA001_CIR315\Package\CIR315DriverInstallerx64.msi"
if (Test-Path $elecomMsi) {
    $elecomUninstallProc = Start-Process -FilePath "msiexec.exe" -ArgumentList "/x `"$elecomMsi`" /quiet /norestart" -Wait -PassThru
    if ($elecomUninstallProc.ExitCode -ne 0) {
        Write-Log "WARNING: Elecom NFC reader driver uninstall exited with code $($elecomUninstallProc.ExitCode)"
    } else {
        Write-Log "Elecom NFC reader driver uninstalled"
    }
} else {
    Write-Log "Elecom driver package not found, skipping"
}

# 6. Remove the Intune detection marker.
Remove-Item -Path "HKLM:\SOFTWARE\SmartSenior\KioskLaunch" -Recurse -Force -ErrorAction SilentlyContinue

Write-Log "Kiosk Launch uninstall complete!"

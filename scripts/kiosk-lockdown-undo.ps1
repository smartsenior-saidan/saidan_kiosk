# Kiosk Lockdown Undo Script
# Reverses everything scripts/kiosk-lockdown.ps1 sets, back to normal Windows
# defaults. Assign this script (instead of kiosk-lockdown.ps1) to a device
# group when a tablet needs to come out of kiosk lockdown temporarily (e.g.
# for maintenance) — unassigning kiosk-lockdown.ps1 alone does NOT revert its
# changes, since Intune scripts just stop re-running, they don't undo what
# they already wrote.
#
# Reboot is required after this runs for the changes to take effect.

$ErrorActionPreference = "Stop"

function Write-Log {
    param($message)
    Write-Host "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') - $message"
}

# 1. Re-enable OS-level screen edge-swipe gestures.
$edgeUiPath = "HKLM:\SOFTWARE\Policies\Microsoft\Windows\EdgeUI"
if (Test-Path $edgeUiPath) {
    Remove-ItemProperty -Path $edgeUiPath -Name "AllowEdgeSwipe" -Force -ErrorAction SilentlyContinue
}

$edgeUiPathUser = "HKCU:\SOFTWARE\Policies\Microsoft\Windows\EdgeUI"
if (Test-Path $edgeUiPathUser) {
    Remove-ItemProperty -Path $edgeUiPathUser -Name "AllowEdgeSwipe" -Force -ErrorAction SilentlyContinue
}

$lockdownPath = "HKLM:\SOFTWARE\Microsoft\PolicyManager\default\LockDown"
if (Test-Path $lockdownPath) {
    Remove-ItemProperty -Path $lockdownPath -Name "AllowEdgeSwipe" -Force -ErrorAction SilentlyContinue
}

Write-Log "Edge-swipe gesture re-enabled (reboot required to take effect)"

# 2. Restore the power/sleep buttons to their normal "Sleep" action.
powercfg /setacvalueindex SCHEME_CURRENT SUB_BUTTONS PBUTTONACTION 1
powercfg /setdcvalueindex SCHEME_CURRENT SUB_BUTTONS PBUTTONACTION 1
powercfg /setacvalueindex SCHEME_CURRENT SUB_BUTTONS SBUTTONACTION 1
powercfg /setdcvalueindex SCHEME_CURRENT SUB_BUTTONS SBUTTONACTION 1
powercfg /setactive SCHEME_CURRENT
Write-Log "Power/sleep buttons restored to normal sleep behavior"

# 3. Re-enable Connected Standby.
$powerPath = "HKLM:\System\CurrentControlSet\Control\Power"
New-ItemProperty -Path $powerPath -Name "CsEnabled" -Value 1 -PropertyType DWord -Force | Out-Null
Write-Log "Connected Standby re-enabled (reboot required to take effect)"

Write-Log "Kiosk lockdown undo complete!"

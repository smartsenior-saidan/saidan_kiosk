# Kiosk Lockdown Script
# OS-level lockdown tweaks for the kiosk tablets — kept separate from
# nfcsetup.ps1 so it can be assigned/unassigned to an Intune device group on
# its own, independent of the NFC/QR reader setup.
#
# Reboot is required after this runs for the changes to take effect.

$ErrorActionPreference = "Stop"

function Write-Log {
    param($message)
    Write-Host "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') - $message"
}

# 1. Disable OS-level screen edge-swipe gestures (Action Center, Widgets,
# Task View, etc.). The kiosk browser runs fullscreen with no chrome, but
# that doesn't lock down the Windows shell underneath — swiping in from a
# screen edge still reaches the OS directly. Modern Windows 11 builds read
# the PolicyManager/MDM-backed key rather than (or in addition to) the legacy
# Group Policy EdgeUI key, so all three locations are set together.
# Confirmed working via manual testing on the Surface Pro 7+.
$edgeUiPath = "HKLM:\SOFTWARE\Policies\Microsoft\Windows\EdgeUI"
if (-not (Test-Path $edgeUiPath)) {
    New-Item -Path $edgeUiPath -Force | Out-Null
}
New-ItemProperty -Path $edgeUiPath -Name "AllowEdgeSwipe" -Value 0 -PropertyType DWord -Force | Out-Null

$edgeUiPathUser = "HKCU:\SOFTWARE\Policies\Microsoft\Windows\EdgeUI"
if (-not (Test-Path $edgeUiPathUser)) {
    New-Item -Path $edgeUiPathUser -Force | Out-Null
}
New-ItemProperty -Path $edgeUiPathUser -Name "AllowEdgeSwipe" -Value 0 -PropertyType DWord -Force | Out-Null

$lockdownPath = "HKLM:\SOFTWARE\Microsoft\PolicyManager\default\LockDown"
if (-not (Test-Path $lockdownPath)) {
    New-Item -Path $lockdownPath -Force | Out-Null
}
New-ItemProperty -Path $lockdownPath -Name "AllowEdgeSwipe" -Value 0 -PropertyType DWord -Force | Out-Null

Write-Log "Edge-swipe gesture disabled (reboot required to take effect)"

# 2. Make the power button do nothing instead of sleeping.
# Pressing the power button was putting the tablet to sleep, and waking it
# dropped guests on the Windows lock screen (requiring a swipe/PIN) instead of
# straight back to the kiosk. Setting the power button action to "do nothing"
# on both AC and battery means it can never trigger sleep/lock in the first
# place, so there's nothing to swipe back in from.
powercfg /setacvalueindex SCHEME_CURRENT SUB_BUTTONS PBUTTONACTION 0
powercfg /setdcvalueindex SCHEME_CURRENT SUB_BUTTONS PBUTTONACTION 0
# Also cover a dedicated Sleep key, if the keyboard/cover has one — separate
# control from the power button above, same "do nothing" goal.
powercfg /setacvalueindex SCHEME_CURRENT SUB_BUTTONS SBUTTONACTION 0
powercfg /setdcvalueindex SCHEME_CURRENT SUB_BUTTONS SBUTTONACTION 0
powercfg /setactive SCHEME_CURRENT
Write-Log "Power/sleep buttons set to do nothing (no more sleep/lock screen)"

# 3. Disable Connected Standby so closing the Type Cover can't sleep/lock the
# tablet. Surface devices don't treat the Type Cover as a laptop "lid" — the
# usual lid-close power setting has no effect here — closing it instead
# triggers Surface's Connected Standby (Modern Standby) low-power mode, which
# is what drops guests on the Windows lock screen. This device stays plugged
# in as a fixed kiosk, so the battery-life tradeoff of disabling Connected
# Standby doesn't apply.
$powerPath = "HKLM:\System\CurrentControlSet\Control\Power"
New-ItemProperty -Path $powerPath -Name "CsEnabled" -Value 0 -PropertyType DWord -Force | Out-Null
Write-Log "Connected Standby disabled (reboot required to take effect)"

Write-Log "Kiosk lockdown complete!"

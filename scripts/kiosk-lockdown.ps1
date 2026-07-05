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

# 2. Let the power/sleep button sleep the tablet normally, but skip the
# password/lock-screen prompt on wake. Pressing the power button puts the
# tablet to sleep as usual; CONSOLELOCK=0 means waking it (power button or
# opening the Type Cover) goes straight back to the kiosk instead of the
# Windows lock screen.
powercfg /setacvalueindex SCHEME_CURRENT SUB_BUTTONS PBUTTONACTION 1
powercfg /setdcvalueindex SCHEME_CURRENT SUB_BUTTONS PBUTTONACTION 1
powercfg /setacvalueindex SCHEME_CURRENT SUB_BUTTONS SBUTTONACTION 1
powercfg /setdcvalueindex SCHEME_CURRENT SUB_BUTTONS SBUTTONACTION 1
powercfg /setacvalueindex SCHEME_CURRENT SUB_NONE CONSOLELOCK 0
powercfg /setdcvalueindex SCHEME_CURRENT SUB_NONE CONSOLELOCK 0
powercfg /setactive SCHEME_CURRENT
Write-Log "Power/sleep button set to sleep normally; sign-in on wake disabled"

# 3. Keep Connected Standby enabled (Windows default). Surface devices only
# support Modern Standby, not classic S3 sleep — Connected Standby is what
# actually lets the power button/Type Cover put the tablet to sleep at all.
# It's safe to leave enabled now that CONSOLELOCK above skips the lock screen
# on wake, which was the real problem, not Connected Standby itself.
$powerPath = "HKLM:\System\CurrentControlSet\Control\Power"
New-ItemProperty -Path $powerPath -Name "CsEnabled" -Value 1 -PropertyType DWord -Force | Out-Null
Write-Log "Connected Standby left enabled (required for sleep to work on this hardware)"

Write-Log "Kiosk lockdown complete!"

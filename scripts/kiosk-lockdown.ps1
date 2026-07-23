# Kiosk Lockdown Script
# OS-level lockdown tweaks for the kiosk tablets — kept separate from
# nfcsetup.ps1 so it can be assigned/unassigned to an Intune device group on
# its own, independent of the NFC/QR reader setup.
#
# Reboot is required after this runs for the changes to take effect.
#
# DESIGN NOTE — every step is best-effort; nothing here is allowed to abort the
# run. Some of these keys can be OWNED by an Intune configuration profile or
# security baseline (e.g. Widgets / "News and interests" via the Policy CSP).
# When a profile manages a key, the policy engine locks it and a script write
# throws UnauthorizedAccessException ("許可されていない操作") EVEN AS SYSTEM.
# That is harmless here — the profile is already enforcing the same setting — so
# a locked key logs a WARNING and we continue. Previously the whole script ran
# under $ErrorActionPreference = "Stop", so a single locked key (the Dsh /
# AllowNewsAndInterests write) aborted every step after it — the power/sleep and
# Connected-Standby config never ran and Intune reported the script as Failed,
# even though the edge-swipe lockdown had already succeeded.

$ErrorActionPreference = "Stop"

function Write-Log {
    param($message)
    Write-Host "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') - $message"
}

# Best-effort registry write: creates the key if missing, sets the value, and
# NEVER throws. A key locked by an Intune Policy CSP logs a WARNING and the
# script keeps going, so one denied write can't take down the rest of the
# lockdown. try/catch works because $ErrorActionPreference = "Stop" makes the
# registry cmdlets raise terminating errors the catch can see.
function Set-RegValue {
    param(
        [string]$Path,
        [string]$Name,
        $Value,
        [string]$Type = "DWord"
    )
    try {
        if (-not (Test-Path $Path)) {
            New-Item -Path $Path -Force | Out-Null
        }
        New-ItemProperty -Path $Path -Name $Name -Value $Value -PropertyType $Type -Force | Out-Null
    } catch {
        Write-Log "WARNING: could not set $Path\$Name ($($_.Exception.Message)) — likely owned by an Intune profile; skipping"
    }
}

# 1. Disable OS-level screen edge-swipe gestures (Action Center, Widgets,
# Task View, etc.). The kiosk browser runs fullscreen with no chrome, but
# that doesn't lock down the Windows shell underneath — swiping in from a
# screen edge still reaches the OS directly. Modern Windows 11 builds read
# the PolicyManager/MDM-backed key rather than (or in addition to) the legacy
# Group Policy EdgeUI key, so all three locations are set together.
# Confirmed working via manual testing on the Surface Pro 7+.
Set-RegValue -Path "HKLM:\SOFTWARE\Policies\Microsoft\Windows\EdgeUI"       -Name "AllowEdgeSwipe" -Value 0
Set-RegValue -Path "HKCU:\SOFTWARE\Policies\Microsoft\Windows\EdgeUI"       -Name "AllowEdgeSwipe" -Value 0
Set-RegValue -Path "HKLM:\SOFTWARE\Microsoft\PolicyManager\default\LockDown" -Name "AllowEdgeSwipe" -Value 0
Write-Log "Edge-swipe gesture disabled (reboot required to take effect)"

# 1b. Disable the Widgets board. On Windows 11, swiping in from the LEFT screen
# edge opens the Widgets/news-and-interests board, which AllowEdgeSwipe above does
# NOT govern — it's a separate feature with its own policy. Turning the feature off
# removes the left-edge swipe target entirely. AllowNewsAndInterests is the current
# (Win11 22H2+) machine policy; EnableFeeds is the legacy key, set too as a harmless
# belt-and-suspenders for older builds.
#
# NOTE: the AllowNewsAndInterests (Dsh) key is a common one for an Intune
# configuration profile / baseline to manage. If a profile already owns it, the
# write below is denied (UnauthorizedAccessException) and logged as a WARNING —
# which is fine, because the profile is already enforcing the same setting.
Set-RegValue -Path "HKLM:\SOFTWARE\Policies\Microsoft\Dsh"                  -Name "AllowNewsAndInterests" -Value 0
Set-RegValue -Path "HKLM:\SOFTWARE\Policies\Microsoft\Windows\Windows Feeds" -Name "EnableFeeds"          -Value 0
Write-Log "Widgets board disabled (removes the left-edge swipe target; reboot required)"

# 2. Let the power/sleep button sleep the tablet normally, but skip the
# password/lock-screen prompt on wake. Pressing the power button puts the
# tablet to sleep as usual; CONSOLELOCK=0 means waking it (power button or
# opening the Type Cover) goes straight back to the kiosk instead of the
# Windows lock screen. Wrapped so a powercfg hiccup can't abort the run either.
try {
    powercfg /setacvalueindex SCHEME_CURRENT SUB_BUTTONS PBUTTONACTION 1
    powercfg /setdcvalueindex SCHEME_CURRENT SUB_BUTTONS PBUTTONACTION 1
    powercfg /setacvalueindex SCHEME_CURRENT SUB_BUTTONS SBUTTONACTION 1
    powercfg /setdcvalueindex SCHEME_CURRENT SUB_BUTTONS SBUTTONACTION 1
    powercfg /setacvalueindex SCHEME_CURRENT SUB_NONE CONSOLELOCK 0
    powercfg /setdcvalueindex SCHEME_CURRENT SUB_NONE CONSOLELOCK 0
    powercfg /setactive SCHEME_CURRENT
    Write-Log "Power/sleep button set to sleep normally; sign-in on wake disabled"
} catch {
    Write-Log "WARNING: power/sleep configuration failed: $($_.Exception.Message)"
}

# 3. Keep Connected Standby enabled (Windows default). Surface devices only
# support Modern Standby, not classic S3 sleep — Connected Standby is what
# actually lets the power button/Type Cover put the tablet to sleep at all.
# It's safe to leave enabled now that CONSOLELOCK above skips the lock screen
# on wake, which was the real problem, not Connected Standby itself.
Set-RegValue -Path "HKLM:\System\CurrentControlSet\Control\Power" -Name "CsEnabled" -Value 1
Write-Log "Connected Standby left enabled (required for sleep to work on this hardware)"

# 4. Write the Intune detection marker so this app shows as installed.
Set-RegValue -Path "HKLM:\SOFTWARE\SmartSenior\KioskLockdown" -Name "Version" -Value "1.0.0" -Type String

Write-Log "Kiosk lockdown complete!"

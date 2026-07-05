# Kiosk Tablet Scripts

PowerShell scripts deployed to the kiosk tablets (Surface Pro 7+) via Intune.
All run as unsigned scripts under SYSTEM (see "Intune upload settings" below).

## nfcsetup.ps1

Installs the NFC/QR scanning setup: a Python daemon (`kiosk_reader.py`,
embedded in this script) that watches for NFC taps and QR scans, and drives
the kiosk browser (Edge, via DevTools Protocol on port 9222) to navigate to
the scanned URL.

### Supported NFC readers

Two readers are supported side by side:

- **ACR122U** — detected by PC/SC name containing `ACR` or `ACS`.
- **Elecom MR-ICA001BK** (chipset reports as `Circle CIR315 CL 0` over
  PC/SC) — detected by name containing `CIR315`.

Detection logic lives in `_detect_reader()` inside the embedded Python. If a
new reader model is ever added, find its exact PC/SC name from the
`Available readers: [...]` line in `reader.log` and add a matching substring
there.

### Elecom MR-ICA001BK driver

The Elecom reader needs its own driver installed on Windows before PC/SC
(and this script) can see it — it does not show up at all until installed.

Driver download portal (search by model number):
`https://www2.elecom.co.jp/search/download/search.asp?kataban=`

Direct pages for MR-ICA001BK (confirm your reader's printed model number
matches before using these):
- Windows: https://www.elecom.co.jp/support/download/data-media/ic-rw/ic_card_reader_installer/win_mr-ica001.html
- Windows 11: https://www.elecom.co.jp/support/download/data-media/ic-rw/ic_card_reader_installer/win_mr-ica001_win11.html

After installing, confirm in Device Manager that it shows up under
**Smart card readers** as `CIR315` with no warning icon.

### Troubleshooting

Check `reader.log` on the tablet:
- `Available readers: [...]` — lists every PC/SC reader Windows currently
  sees. If a plugged-in reader isn't in this list, it's a Windows/driver
  problem, not a script problem (reboot / reinstall driver / check Device
  Manager first).
- `NFC reader: <name>` — confirms the script found and is using that reader.
- `Card detected, ATR=...` — confirms a tap was read at the hardware level.
- `NDEF read-binary failed: SW=... data=...` — hardware detected the tag but
  the raw-read command (`0xFF, 0xB0, ...`, the ACS-proprietary pseudo-APDU)
  didn't return valid NDEF data. This command is ACS-specific, not a PC/SC
  standard — a new reader chipset may need a different read command in
  `_read_url()`.

### Version history

- 1.0.0 — initial NFC/QR daemon, ACR122U only.
- 1.1.0 — added diagnostic logging (ATR on card detect, status word on
  failed reads) to help debug new reader chipsets without guessing at
  command bytes.
- 1.2.0 — added Elecom MR-ICA001BK (`CIR315`) detection alongside ACR122U.

## kiosk-lockdown.ps1 / kiosk-lockdown-undo.ps1

OS-level lockdown for the Surface Pro tablets, kept in a separate script
from `nfcsetup.ps1` so it can be assigned/unassigned to an Intune device
group independently.

`kiosk-lockdown.ps1` sets:
1. Disables OS edge-swipe gestures (Action Center, Widgets, Task View).
2. Leaves the power/sleep button at its normal "Sleep" action, but sets
   `CONSOLELOCK = 0` so waking (power button or opening the Type Cover)
   skips the Windows lock screen/sign-in prompt and goes straight back to
   the kiosk. This was the actual fix for guests getting dropped on the
   lock screen — not disabling sleep itself.
3. Leaves Connected Standby enabled (Windows default). Surface devices only
   support Modern Standby, not classic S3 sleep, so Connected Standby is
   what lets the power button/Type Cover actually sleep the tablet at all —
   disabling it isn't needed now that `CONSOLELOCK` handles the lock-screen
   problem directly.

**Important:** these are one-time registry writes, not a persistent policy.
Unassigning `kiosk-lockdown.ps1` in Intune does NOT undo the changes — it
only stops the script from running again. To actually restore normal
Windows behavior on a tablet (e.g. for maintenance), assign
`kiosk-lockdown-undo.ps1` to it instead, which explicitly writes each
setting back to its Windows default, then reboot.

## Intune upload settings

For all scripts in this folder:
- Run this script using the logged on credentials: **No**
- Enforce script signature check: **No**
- Run script in 64 bit PowerShell Host: **Yes**

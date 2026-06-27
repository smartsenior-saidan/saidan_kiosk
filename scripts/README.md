# SmartSenior Kiosk Scripts

Two scripts are deployed via Microsoft Intune to set up each kiosk tablet. They have separate responsibilities and are deployed independently.

---

## nfcsetup.ps1 — Hardware Setup (Universal)

**Deploy via:** Intune → Devices → Scripts (run as System, 64-bit)

**What it does:** One-time hardware and runtime setup. This script is identical across all tenants — it never needs to change per deployment.

- Installs Python 3.11 system-wide
- Installs required Python packages: `requests`, `websocket-client`, `pyscard`, `ndeflib`, `pynput`, `pyserial`
- Writes `C:\KioskProgram\nfc\kiosk_reader.py` to disk (embedded directly in the script — no GitHub download)
- Ensures the Smart Card service (SCardSvr) is running for the ACR122U NFC reader
- Creates a silent VBScript launcher (`start-nfc.vbs`) so Python runs with no terminal window
- Registers the `SmartSenior-NFCReader` scheduled task that starts the reader on every user login

**What kiosk_reader.py does at runtime:**

- Reads NFC cards (ACR122U) and navigates Edge to the card's URL
- Listens on the Denso QK30-U QR scanner serial port and navigates Edge to scanned URLs
- Connects to Edge via remote debugging port 9222 to control navigation
- Reads `C:\ProgramData\SmartSenior\config.json` to know the tenant home URL (set by the tenant script below)
- Returns to home after card removal

> **Note:** The Denso QK30-U driver must be installed by Intune's separate Denso Win32 app. Do NOT add driver staging (pnputil) to this script — it will cause the Denso app's detection rule to skip installation.

---

## set-tenant-template.ps1 — Tenant Config (Per Tenant)

**Deploy via:** Intune → Devices → Scripts, assigned to that tenant's device group

**What it does:** Sets the tenant identity on the device. This is the only script that changes between deployments.

- Writes `C:\ProgramData\SmartSenior\config.json` with the tenant's `site` name and `homeUrl`
- Registers the `SmartSenior-EdgeKiosk` scheduled task that opens Edge fullscreen on the tenant URL at every login, with `--remote-debugging-port=9222` enabled so the NFC reader can control navigation

**To deploy a new tenant:** Duplicate this file, change `$siteName` on line 10, and upload the copy to Intune assigned to that tenant's device group.

---

## Deployment Order

Intune deploys both scripts independently. Order does not matter — `nfcsetup.ps1` reads `config.json` at runtime (not at setup time), so even if it runs before the tenant script, it will use the correct URL once `config.json` exists.

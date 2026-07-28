- TODO

* go to thank you after if nfc card is removed instead of welcome
  * where: kiosk_reader.py (embedded in scripts/nfcsetup.ps1) — on card removal, navigate to /thankyou.html instead of the home URL (keep the ?site= tenant)
  * deploy gotcha: ships inside the "SmartSenior Kiosk Launch" Win32 app; detection (kiosk-launch-detect.ps1) is health-based (only checks the reader file exists, not its contents), so a plain re-upload WON'T update already-working tablets. Use Intune supersedence, or manually run nfcsetup.ps1 / swap kiosk_reader.py + restart the reader on the device.

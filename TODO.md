# TODO — saidan_kiosk

## 1. Cross-tenant reads — anyone can read any site's data 🔴

- Verified live: an unauthenticated request returns any tenant's real records. No login or device needed.
- Nesting fixed **writes**, not reads — `firestore.rules` still has `allow read: if true`.
- **The idea:** right now a kiosk just _claims_ which tenant it is and Firestore believes it. Each tenant needs a credential that _proves_ it, so the rules can check the claim instead of trusting `if true`.
- ⚠️ Ship the kiosk sign-in **first**, verify both tenants, _then_ tighten the rules — reverse order blanks every kiosk. No device visits (normal git push).

## 2. Photos are not backed up 🔴

- The 2026-08-09 backups (PITR, daily, delete protection) cover **Firestore only**.
- Photos/video/audio live in Firebase Storage — untouched by any of it.
- Delete a profile → text recoverable, images gone permanently.
- **Next:** check if object versioning is on for the bucket; enable it.

## 3. NFC cards work on the wrong temple's tablet 🟡

- Cards hold a fixed URL with `&site=<tenant>`; `kiosk_reader.py` navigates with no checks.
- Worse: any `?site=` seen gets saved to `localStorage`, so one wrong tap **permanently re-points that tablet** until someone notices.
- **The idea:** a card is a passive chip — it can never enforce anything, no matter what's written on it. The only place a barrier can exist is the reader deciding whether to trust what it just read.
- **Fix:** compare the card's `site=` against the device's own config before navigating; refuse on mismatch. One shared script, no per-tenant copies.

## 4. NFC removal should go to thank-you page 🟡

- On card removal `kiosk_reader.py` goes to the home URL; should go to `/thankyou.html`, keeping `?site=`.
- Same file as item 3 → **ship both together**, one deploy instead of two.

### Why these need _both_ an Intune script and an Intune app!!!

- Intune decides whether to install by asking `kiosk-launch-detect.ps1` "is this already installed?" — and that script only checks **health** (file exists, tasks registered, Python imports), never **which version**. A tablet running the old reader answers "yes, installed", so Intune skips it and never looks at the new code.
- So the **app package alone can't fix tablets already in the field** — they're invisible to updates. And a **script alone can't help future tablets** — a fresh device installs the app's old copy.
- **Script = fixes the tablets that exist now. App = fixes every tablet made from here on.** Same `nfcsetup.ps1` behind both; two channels only because Intune treats "already has it" and "installing fresh" as separate cases.
- Practical: script needs no Windows PC (browser only); repackaging the app does (`IntuneWinAppUtil.exe`). Applies on Intune check-in (~1h, up to 8h).

## 5. Automatic offsite backup — needs a decision 🟡

- Manager asked for regular backups to GitHub. **Not built on purpose:** this repo is public — it would expose real names, dates and biographies permanently.
- Built instead: on-demand CSV download in the admin console (`e91f32e`).
- **Decision:** private repo or private GCS bucket? Then it can be built.

## 6. Lower priority 🟢

- Add a version check to `kiosk-launch-detect.ps1` — the root cause of the two-channel problem above. Keep the health checks.
- Remove `legacyOwnsTenant()` + `/admins/{uid}` once no old sessions remain. **Both rule files must change together.**
- `SPEC.md` §10.2 is stale (says no backups / PITR off / delete protection off — all fixed 2026-08-09).

---

## Done — 2026-08-08 → 08-10

- **Backups:** delete protection + PITR (~7-day window, was 1h) + daily backups (30-day retention) + CSV download button.
- **Static display IDs** — `display_id` persisted, assigned once, never renumbered. Previously recomputed from list position, so a delete silently renumbered everyone after it. Backfills on first load.
- **Search** now matches display ID, section, row, and column. New `plot_col` field added (didn't exist before).
- **Multi-tab logout fixed** — `browserLocalPersistence` + `ss_*` keys moved to `localStorage`.
- **Kiosk:** online/offline indicator (real Firestore check every 10s); `tokyo_reien` thank-you follows its own accent color; `DEFAULT_TENANT` now fails loudly instead of silently showing nothing.

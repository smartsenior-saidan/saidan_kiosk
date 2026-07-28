# Columbarium Interactive Guide — kiosk frontend

The Tokyo Reien columbarium guide (SRS: *Columbarium Interactive Guide System /
Touch Kiosk*). A self-contained touch kiosk that reads the **same Firestore
project** as the saidan Digital Altar, scoped to the `tokyo_reien` tenant.
Read-only. Its own look and flow — only backend logic (Firebase reads, the kana
matcher) is shared with saidan, and duplicated here so this folder runs and
deploys on its own.

## Flow (SRS §4 state machine)

`welcome → search → map(2D) → map(2.5D)`, with idle-timer returns and a
motion-sensor / touch wake. Orchestrated in [js/app.js](js/app.js).

- **Welcome** — full-screen background (`assets/welcome/background.jpg`) +
  guidance. Touch or a sensor keystroke wakes it. The reveal is gated on the
  image + display font so the screen appears complete, with no shift.
- **Search** — two tab modes:
  - **お名前 (name)** — on-screen kana keyboard, fuzzy reading match.
  - **区画番号 (section)** — keypad, matched against `plot` (full-width safe).
  - Results list fills the area left of the panel; "場所を表示" opens the map.
- **Map** — [js/map.js](js/map.js):
  - **2D floor plan**: target section highlighted, "現在地" marker + a path to
    it. Pan (drag), zoom (wheel / pinch); tap the section or zoom past the
    threshold →
  - **2.5D niche wall**: target row highlighted from `plot_row`; back button.
- **Offline** — the record list is cached to localStorage; search still works
  offline and shows a badge (SRS §3 / AC-8).

## Data model

Reads `deceased_individuals` where `tenant_id == "tokyo_reien"`. Uses
`plot_section` (block) + `plot_row` (row) for the map, `plot` for section
search, and the kana reading fields for name search.

## Placeholders to replace with real assets/data

The map ships with working stand-ins (the SRS has the client provide the real
artwork):

- **Section layout** — drop `assets/map/sections.json`
  (`[{ id, label, x, y, w, h }]` in the 1000×700 map space) to replace the
  generated A–H grid.
- **Exact niche** — currently highlights the whole row. Add a `plot_col` (and
  tier) field in the admin and the single niche lights up — [js/map.js](js/map.js)
  already reads `plot_col`.
- **Wall size** — `nicheRows` / `nicheCols` in [config.json](config.json).

## Swappable content (no rebuild — SRS §5-1 / AC-9)

- Backgrounds: `assets/welcome/`, `assets/search/`.
- UI text: `assets/strings.json` (overrides the defaults in [js/strings.js](js/strings.js)).
- Welcome text: `assets/welcome/welcome_text.json`.
- Timers, zoom threshold, niche dims, sensor keystroke: [config.json](config.json).

## Config / tenant

[js/config.js](js/config.js) pins the device to `tokyo_reien`; override
per-device with `?site=<tenant>`.

## Run locally (dev)

```
cd columbarium && python3 -m http.server 8000   # → http://localhost:8000
```

Serve over http — the Firebase SDK and the JSON `fetch`es don't work from
`file://`. (For the on-device deployment this becomes a packaged app; see the
Electron plan.)

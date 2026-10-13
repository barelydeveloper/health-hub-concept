# Body Composition Tracker

A browser-based personal tracker for weight, body composition, nutrition, activity, and refeed/forecast planning. Data stays in your browser (`localStorage`); there is no backend or build step.

**Not medical advice.** Estimates (TDEE, fat/lean projections, refeed models) are heuristics for your own logging—not clinical guidance.

## Quick start

Open [`index.html`](index.html) in a modern browser, or serve the folder locally:

```bash
# Python
python3 -m http.server 8765

# then visit http://127.0.0.1:8765/
```

No install, no dependencies, no build.

**Install / offline (PWA)** needs HTTP or HTTPS. Serving as above (or any static host) lets Chrome/Edge show **Install app**, and Safari can use Share → Add to Home Screen. After the first visit, the app shell stays available offline; your log still lives in `localStorage`. Opening the HTML file directly (`file://`) still runs the tracker, but the service worker cannot register, so install and offline caching are unavailable.

## What’s included

| Tab | Purpose |
|-----|---------|
| **Today** | Current metrics, day-over-day deltas, interactive trend charts, nutrition averages, exercise analysis, forecast preview |
| **Log** | Daily entry (weight, BIA fields, macros, steps, sleep, training, glycogen state) |
| **History** | Filterable log table, pagination, date-to-date compare, delete blank days |
| **Forecast** | Personal TDEE, composition forecast with physiological caps, accuracy vs saved forecasts |
| **Goals** | Target weight / BF% / fat / muscle |
| **Diet** | Calorie scenarios compared against TDEE |
| **Refeed** | Glycogen/water refill model from depleted metrics |
| **Phases** | Training phases, objective (CUT / RECOMP / GAIN / …), Samsung import, JSON backup |

### Trends

- Multi-metric charts (weight, BF%, fat, muscle, water, calories, steps)
- Range presets (7d / 30d / 90d / All) with drag-to-pan on fixed windows
- Per-chart **Omit blank days** (only drops days missing *that* metric)
- Hover/touch tooltips and phase shading on body charts

### Exercise

- Per-session workouts from Samsung Health: walking (1001), running (1002), resistance (15004), and any other imported types
- Type pills on Today switch analysis; speed vs HR and calories vs distance hide when that type has no speed/distance
- Time-in-zone bars (live HR samples when the full export folder is dropped; otherwise mean-HR zone)
- Zones are % of max HR (50 / 60 / 70 / 80 / 90). Set max HR under **Phases → Data** (default 220 − age, else 190)
- Units: miles and mph (Samsung meters / m/s converted on import)

### Forecasting

- Prefers Samsung burned calories / BMR+activity when present; otherwise intake vs weight trend
- Projects weight, fat, BF%, and lean with caps (e.g. max fat loss ~1% BW/week, lean gain limits, fat floor near ~5% BF)
- Conservative / expected / aggressive bands; deltas colored by whether the direction is “good” for that metric (fat down = green; muscle down = red; water/steps = neutral)

## Data & privacy

- Storage key: `bodyCompApp` in `localStorage`
- Export / import JSON from **Phases → Data**
- The service worker caches only the app shell (HTML, manifest, icons)—not your log
- Clearing site data for this origin wipes the app store—export first if you care about history
- Raw Samsung Health dumps under `data/` are gitignored; keep exports off public remotes

## Samsung Health import

Under **Phases → Data**, drop an unzipped `samsunghealth_*` folder (or selected CSVs).

Mapped when present:

- Weight / BIA (kg → lb)
- Steps, nutrition, sleep
- Exercise daily totals (workout minutes, exercise calories; resistance type 15004)
- Exercise sessions (walking 1001, running 1002, resistance 15004, others) → per-workout speed, distance, HR, calories; optional live_data JSON → time in HR zone
- User profile birth date → seeds max HR as 220 − age
- Calories burned details → BMR, active, daily burned (TDEE proxy)
- Activity day summary → walk time and related fill-ins

Existing dates keep body/nutrition values; missing energy/activity fields can be filled on re-import. Days with no weight / BF% / fat mass / intake calories are treated as **blank** for History exclude/delete.

## Project layout

```
fitness-tracker/
├── index.html              # App UI + logic (HTML + CSS + JS)
├── manifest.webmanifest    # PWA name, icons, standalone display
├── sw.js                   # Network-first cache of the app shell
├── icons/                  # Favicon, maskable, and Apple touch icons
├── LICENSE                 # MIT
├── README.md
└── data/                   # Local exports only (gitignored)
```

## License

[MIT](LICENSE) © 2026 barelydeveloper

# Streetlifting

Mobile-first streetlifting tracker: programs, session logging, rest timer, analytics, and plate calculator for dip-belt loading.

**Live:** https://dong-xuyong.github.io/streetlifting/

## Features

- **Home** — today’s workout from the active program, quick stats, start session
- **Log** — sets with warm-up/drop/failure types, supersets, per-set notes, previous-set hints, live PR badges, auto rest timer, workout duration
- **History** — month calendar of trained days; session detail with personal notes per exercise section
- **Summary** — post-workout screen: duration, volume, PRs hit, per-exercise breakdown, muscle split, copyable share text
- **Analytics** — per-exercise progress charts (e1RM / heaviest / best set / volume, 1m–all time), e1RM trends, streetlifting total, relative strength, PR feed
- **Program** — multi-day programs with double/linear/manual progression; pull-up and dip micro/macro waves
- **Exercises** — 61-lift catalog with equipment and muscle filters, favorites, instructions, per-exercise rest defaults, custom exercises
- **Settings** — kg/lb display, auto-rest and vibrate toggles, belt-load plate stack, JSON and CSV backup export/import, wipe

Data lives in `localStorage` (`streetlifting-v1`, schema v2). v1 data migrates automatically and the original blob is kept at `streetlifting-v1-backup`. Built-in exercises come from `data/exercises.json`.

CSV export uses Strong's column layout (`Date,Workout Name,Duration,Exercise Name,Set Order,Weight,Reps,RPE,Notes,Workout Notes`), so exports interoperate with the Strong app in both directions.

## Stack

Plain HTML/CSS/JS — no build step, no npm. PWA-ready via `manifest.webmanifest`.

## Run locally

```bash
cd streetlifting
python -m http.server 8792
# open http://localhost:8792
```

(The app fetches `data/exercises.json`, so use HTTP — opening `index.html` as a file will not work.)

## Deploy

From the Second Brain source repo:

```bash
python scripts/sync_streetlifting.py
python scripts/sync_streetlifting.py --dry-run
```

Pushes `streetlifting/` to [`Dong-Xuyong/streetlifting`](https://github.com/Dong-Xuyong/streetlifting). GitHub Pages serves https://dong-xuyong.github.io/streetlifting/

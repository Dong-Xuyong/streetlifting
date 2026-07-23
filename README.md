# Streetlifting

Mobile-first streetlifting tracker: programs, session logging, rest timer, analytics, and plate calculator for dip-belt loading.

**Live:** https://dong-xuyong.github.io/streetlifting/

## Features

- **Home** — today’s workout from the active program, quick stats, start session
- **Log** — log/edit sets with rest timer; prefill from program day
- **History** — month calendar of trained days; session detail with personal notes per exercise section
- **Analytics** — e1RM trends, streetlifting total, relative strength, volume, PRs
- **Program** — multi-day programs with double/linear/manual progression
- **Exercises** — competition + accessory catalog, custom exercises, cues
- **Settings** — kg/lb display, session defaults, belt-load plate stack, full backup export/import (programs + workout history), wipe

Data lives in `localStorage` (`streetlifting-v1`). Built-in exercises come from `data/exercises.json`.

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

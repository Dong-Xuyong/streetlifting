# Streetlifting

A read-only progress dashboard for weighted calisthenics (pull-up, dip, muscle-up, squat).

Live: https://dong-xuyong.github.io/streetlifting/

Data lives in Dong-Xuyong/progress-sync, file streetlifting.json.

The page auto-loads that file on open, on focus, and every 60 seconds. It also reads nutrition.json when that file exists, and only to fill in a missing bodyweight.

Nothing on the page is editable. Grok writes the file.

CONTRACT.md is the writer spec for updating streetlifting.json.

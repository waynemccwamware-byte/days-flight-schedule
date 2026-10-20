# Day's Flight Schedule

GeezerGeek Pilot app — plan a flying day from wheels up at home to wheels down at home.
Live: https://days-flight-schedule.netlify.app/

- `site/` — what Netlify publishes (index.html, claude.md, airport-tz.json, manifest.json, sw.js, icons/)
- `netlify/functions/sync.js` — cross-device sync of saved schedules (Netlify Blobs store `days-flight-schedule-sync`; dependency-free)
- `netlify.toml` — publish dir and functions dir; no build step

Every push to `main` redeploys the site.

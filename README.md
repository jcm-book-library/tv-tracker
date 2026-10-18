# TV tracker

A friendlier front end for the `📺` tab of the Entertainment Tracker sheet. Sister app to Jackets & Manuscripts.
See `CLAUDE.md` for the data model and sheet rules.

## Sheet changes made on 2026-10-18
- Full copy of `📺` kept as `📺 backup 2026-10-18`.
- Added columns M–U to `📺`: id (1–370, sheet order), Season, Episode, Started, Finished, Plan (dropdown), Up next #, Why, Sorted.
- New tabs: `📺 Log`, `📺 Seasons`, `📺 Quotes`, `📺 Settings`.
- Checked by script: columns A–L unchanged against the backup (372 rows, 1,480 dropdown cells), ids stored as plain numbers.
- Copied the C–F dropdown rules (chip mode) from row 372 down to row 1013 so shows added by the app get dropdowns.

## Stage 2 (2026-10-18): Log and Library
- `app.html`: Log tab (stat tiles, Watching now with +1 ep / log several / set position / next season / pause / finish,
  Start watching from Next Up, Today / Yesterday / date backdating, recent episodes with edit and delete, episodes per week)
  and Library tab (search, status chips, sortable table, details, edit/add dialog writing only changed cells).
- Hosted as a private claude.ai artifact (mcp: Google Sheets get_values / append_values / update_values) and as `index.html` on GitHub Pages.
- `node tests/smoke.mjs`: Playwright smoke test against a fake sheet built from `tests/fixture.json` (53 checks, 390px and 1280px).

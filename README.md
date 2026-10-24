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

## Stage 3 (2026-10-24): Plan
- Plan tab: Up next (about 10, ordered, with a why, Start watching), Soon, Not out yet (by premiere date), backlog in sheet order
  with one-tap Up next / Soon, and a sort deck ranked by how promising each show looks (Someday comes back after a year).
- Putting a Watchlist show in Up next sets its status to Next Up; taking a Next Up show out sets it back to Watchlist.
- Dates show as `24 Oct 26` across the app.
- `📺 Seasons` filled from TVmaze on 2026-10-24: 81 season rows for 27 Watching / Next Up / New Season / Coming Soon shows
  (Robocop and Sucker Punch left out: no reliable match). Checked by script against the source file.
- Fix: the first rows written to an empty tab took the header's formatting, so dates read back as serial numbers.
  The app now writes the first log rows directly into row 2 and reads serial dates correctly.

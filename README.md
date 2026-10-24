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
- `node tests/smoke.mjs`: Playwright smoke test against a fake sheet built from `tests/fixture.json` (390px and 1280px; also covers all 13 themes).

## Stage 3 (2026-10-24): Plan
- Plan tab: Up next (about 10, ordered, with a why, Start watching), Soon, Not out yet (by premiere date), backlog in sheet order
  with one-tap Up next / Soon, and a sort deck ranked by how promising each show looks (Someday comes back after a year).
- Putting a Watchlist show in Up next sets its status to Next Up; taking a Next Up show out sets it back to Watchlist.
- Dates show as `24 Oct 26` across the app.
- `📺 Seasons` filled from TVmaze on 2026-10-24: 81 season rows for 27 Watching / Next Up / New Season / Coming Soon shows
  (Robocop and Sucker Punch left out: no reliable match). Checked by script against the source file.
- Fix: the first rows written to an empty tab took the header's formatting, so dates read back as serial numbers.
  The app now writes the first log rows directly into row 2 and reads serial dates correctly.

## Stage 4 (2026-10-24): Dashboard
- Dashboard tab (read-only, never writes to the sheet): six tiles, episodes per month (last 12), a 53-week calendar, binge or weekly per show,
  ratings, genres, library by status, platforms, how to watch, top actors and decades. Every tile, bar, row and calendar day opens a list;
  tapping a show in it opens the Library edit dialog.
- Log-based panels show "Fills in as you log episodes on the Log tab." until the log has rows. Dashboard tests: `node tests/dashboard.mjs`
  (own fixture `tests/dash-fixture.json`); `node tests/smoke.mjs` still covers the rest.

## Themes
The app wears one show's look for the whole month (no drift): Jan Breaking Bad / Better Call Saul, Feb Deadwood, Mar Mr Inbetween,
Apr Chernobyl, May Hannibal, Jun Ripley, Jul The Sopranos, Aug Succession, Sep Fleabag, Oct Arcane, Nov Mad Men, Dec Blackadder the Third.
A plain navy **Default** is always one tap away. Source: `design/themes-board.html` (notes in `design/theme-notes.md`).
- Header: the palette button opens the menu (This month / shows by month / Your themes / Default); the arrows flick to the next or previous theme.
  "This month" is the default.
- Settings (gear): pick a theme and edit its colours, heading and text fonts, roundness, grain and light/dark. Reset this theme, Save as a copy.
- Fonts change the wordmark and panel titles only. Body text stays Figtree, numbers stay Atkinson Hyperlegible; status chips keep the sheet's colours.
- Stored in this browser only, never in the sheet: `tv-theme` (choice, `auto` = this month), `tv-theme-edits`, `tv-theme-custom`.

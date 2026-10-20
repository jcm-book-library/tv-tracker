# TV tracker: notes for Claude sessions

**Read the house rules first:** [HOUSE-RULES.md](https://github.com/jcm-book-library/control-room/blob/main/HOUSE-RULES.md) in `control-room` (plain text: https://raw.githubusercontent.com/jcm-book-library/control-room/main/HOUSE-RULES.md). They cover Google Sheet safety, branches and pull requests into `main`, using cheaper models to save usage credits, and the build template. The notes below are this repo's own; where they are more specific, they win. The project charter is `project.json`.

Sister app to the book tracker "Jackets & Manuscripts" (repo `jcm-book-library/my-book-library`,
reference file `v3/reading-log.html` on branch `claude/keen-sagan-yf9rqf`; read it, never change it).

Model use: see "Using models" in the house rules. In this repo, TVmaze episode-count look-ups go to Haiku.

## Sheet: "Entertainment Tracker" `1558jWeUc8gCzQuph6wOVyOocvTBhQf22UuCSXza8klc`

Only touch these tabs: `📺` (sheetId 133341767), `📺 Log` (920000002), `📺 Seasons` (920000003),
`📺 Quotes` (920000004), `📺 Settings` (920000005). Backup: `📺 backup 2026-10-18` (920000001), never write to it.
Never read or write Books, Reading Log, App Settings, Ratings, Contents, Wishlist, Calibre Review, any "Books backup",
or other apps' tabs (🎥, 🎮, 🎸 …).

### 📺 (headers on row 2, data from row 3; row 1 has "RATINGS" in C1)
A Title · B Rating (/10) · C Status* · D How to Watch* · E Genre* · F Platform* · G Starring · H Release Date (free text, e.g. "25 Nov") ·
I Year · J Total Seasons · K Total Eps · L Notes · **M id** · N Season · O Episode · P Started · Q Finished · R Plan* · S Up next # · T Why · U Sorted

`*` = dropdown with CHIP formatting. Status: Coming Soon, Rewatch, Watchlist, Watched, Watching, New Season, Next Up, DNF, Paused.
How to Watch: NA, Owned, To Purchase, Subscription, Pirate. Plan: Up next, Soon, Someday.
No formula columns. `id` is a permanent number (1–370 assigned 2026-10-18 in sheet order); new show = highest id + 1.

### 📺 Log: `date | showId | title | season | episode | eps | loggedAt | source | note`
One row per episode (owner's choice; may consolidate later). `source` = app / import.

### 📺 Seasons: `showId | title | season | episodes | premiere | finale | source | updatedAt`
### 📺 Quotes: `quote | who | showId | title | season | episode | addedAt | note`
### 📺 Settings: `key | value | note` (weeklyGoalEps, streakMinEps, appName …)

### Write rules (non-negotiable)
- Find the row by id right before every write; write only changed cells. Never rewrite whole tabs, never delete and re-add rows.
- Dates yyyy-mm-dd, numbers as numbers, text prefixed with `'`.
- Keep dropdowns; any setDataValidation must set `customUiMode: CHIP`.
- After any bulk change, read the tab back and compare with a script. Never hand-type long arrays into tool calls.

## Hosting
- `app.html` is the single source (no `<head>`), published as a private claude.ai artifact using the `mcp` capability
  (server "Google Sheets": get_values, append_values, update_values).
- `python3 tools/build-pages.py` builds `index.html` for GitHub Pages (jcm-book-library.github.io/tv-tracker/).
  Google sign-in reuses the book app's Client ID (localStorage `mbl_config`); everything else uses `tv-` keys.
- Scripts only from cdnjs (Chart.js 4.4.1), fonts from Google Fonts, everything else inline.
- Test headless with Playwright (Chromium at /opt/pw-browsers/chromium, stubbed window.claude) at 390px and 1280px before every publish.

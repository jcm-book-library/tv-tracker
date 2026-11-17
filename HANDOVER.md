# Handover: TV Tracker

Rewritten 17 Nov 2026 at the end of the session that built stages 2 to 5, the themes and the Library rework.
`CLAUDE.md` has the sheet schema and the write rules. This file has where things stand.

## Owner actions
1. Merge the pull request that carries this file. It changes nothing on the live site.
2. Decide the open questions at the bottom (the name and the Dashboard clean-up are the big ones).

## Where we are
- **Live site:** https://jcm-book-library.github.io/tv-tracker/ (GitHub Pages, built from `main`).
- **claude.ai page:** a private artifact built from the same `app.html`. It shows generated covers instead of posters (see gotchas).
- **Everything built so far is merged into `main`** (pull requests 2 to 10).
- **Tabs:** Log, Library (List or Shelf, floating edit panel), Plan, Dashboard, Tools, Discover. Back to top button on every tab.
- **Tests:** seven suites, 1,379 checks, all passing. Commands are in `README.md` ("Running the tests and the build").
  Smoke 154, favourites 137, tools 269, dashboard 120, layout 169, library 255, shelf 275.
- **Sheet:** the `📺` tab runs A to Y. Tabs this app owns: `📺`, `📺 Log`, `📺 Seasons`, `📺 Quotes`, `📺 Settings`.
  Four dated backup tabs exist (list in `CLAUDE.md`). Never write to them.
- **Data state (as of 7 Nov 2026, not re-read since):** 372 shows. Posters filled for 313 (TVmaze links). "Based on" is filled for 89 shows (87 from the last session, 2 are the owner's own). "Source title" for 81.
  `📺 Seasons` has 81 rows for 27 shows. `📺 Log` started on 24 Oct 2026, so time-based panels are still thin.

## What changed this session (newest first)
- Library search also matches "Based on" and "Source title". The Favourite control is the pill at the top of the edit panel only.
- Blackadder: seven entries share the one TVmaze poster. "Based on" and "Source title" filled for 87 shows where the adaptation is very clear. Backup: `📺 backup 2026-11-07 (before Based on)`.
- Library shelf view (List | Shelf toggle) with posters, generated covers, poster preview in the panel, and a Find poster button (TVmaze search).
- Library rework: even category chips, left floating edit panel (bottom sheet on phones), new fields Based on, Source title, Poster link.
- Log and Plan reordered as the owner listed. Tonight's pick deleted. Drag to reorder Up Next. Soon has a Future releases section. Backlog shows 10.
- Stage 5: Tools (lucky dip, where can I watch this, stalled shows, finishing soon, goal planner, year in review, recommendations) and Discover (quote of the day, on this day, coming soon, links).
- Earlier: Favourites (column V, remote-button sticker, front-page panels), the 13 monthly show themes with a navy Default and a theme menu and editor, Dashboard, Plan, Log and Library, the sheet preparation (ids, Plan columns, new tabs).

## Decisions made (do not re-ask)
- Name stays "TV Tracker" for now (set by `appName` in `📺 Settings`). "Pilots & Finales" was suggested; the owner said TV Tracker is fine.
- The app wears the current month's theme for the whole month; no colour drift. Default is a plain dark navy. Themes are inspiration only (no logos or artwork). Status chips keep the sheet's colours in every theme.
- One log row per episode. Consolidate later if it gets too big.
- Plan lives in `Plan`, `Up next #`, `Why`, `Sorted`. Putting a Watchlist show in Up next sets it to Next Up; taking it out sets it back to Watchlist.
- "Next Up" list lives on Log only (Plan has no Start watching panel).
- Favourite is a date in column V. The remote-button heart is the sticker. Only the header pill toggles it in the panel.
- Adaptations: two columns, "Based on" (chip: Book, Film, Game, Comic, Other show, True story, Original) and "Source title". A source id can be added later to link to the book, film and game apps.
- Posters: TVmaze `medium_portrait` links stored in column Y. Links live in the sheet, not in the repo.
- Only confident poster and adaptation matches are written. Wrong or ambiguous ones stay blank.
- The sheet id stays in public code for now (same as the book app). The owner will clean it up later.
- Dashboard is "keep for a future clean-up". Do not touch it until the owner asks.
- Model split: strongest model plans, writes to the sheet and reviews; Sonnet builds; Haiku does mechanical look-ups. No model names in commits, code or PRs.

## Next steps
1. Dashboard clean-up (owner asked to park it; ask what they want first).
2. Fill the rest of the posters from the edit panel's Find poster (works on the website only). 59 shows have none (specials, stand-up, single episodes and a few ambiguous titles).
3. Add `📺 Seasons` rows for Robocop and Sucker Punch when TVmaze has them, and check Rick and Morty (TVmaze lists a 10th season).
4. Check the real thing on a phone: drag to reorder on a touch screen, posters on the website, and the episodes-per-week bars (Chart.js has only ever been stubbed in tests).
5. Remove the sheet id from public code when the owner is ready (settings in the sheet or browser).
6. Standards gaps to close when the audit asks: A1 (shared build template is not used, see gotchas), A3 (Roboto), A7/A8 (Supabase and sign-in). See "Open questions".

## Gotchas
- **Header-only tabs:** `append_values` onto a tab that has only its header copies the header's formatting (bold, dates come back as serial numbers). The app writes the first row of `📺 Log`, `📺 Quotes` and `📺 Settings` straight into row 2 with `update_values`, and `toDate` also accepts a Sheets date serial. Do the same for any new tab.
- **Bulk writes:** `update_values` skips `null` cells and clears cells with `""`. Never trust a long pasted array: in the last session a 93-row paste landed 20 rows on the wrong shows. It was caught only because every cell was compared against the backup by script. Write in small chunks, read back, compare, and fix only the differing cells.
- **Reading the sheet:** `get_spreadsheet` with grid data is huge. Save it to a file and read it with a script. `📺` headers are on row 2 (row 1 has "RATINGS" in C1); the sheet row is the list index plus 2. Ids are permanent (1 to 372 now; a new show is the highest id plus 1).
- **claude.ai artifact limits:** it blocks images and fetches from other websites. Posters and Find poster only work on the GitHub Pages site; the artifact shows generated covers.
- **This sandbox's limits:** it cannot reach github.io or cdnjs, and cannot load TVmaze images (the TVmaze API itself works). Tests stub Chart.js and image requests, and use made-up shows only, never real poster links.
- **Focus bug fixed:** two dialogs' close handlers both called `restoreDrillFocus`; it now ignores a call while the drill dialog is open and does nothing if there is no opener.
- **Sub-agent reports can be wrong** (one quoted 138 checks, the real number was 137). Re-run the suites yourself.
- **Build template:** `control-room/templates/tools/build-pages.py` refuses any `app.html` containing the text `<head`, which also matches the normal `<header>` element, so this repo keeps its own `tools/build-pages.py` (the output is identical). Do not swap it in until the template is fixed.
- **Git:** push only what is committed and tested. Merge a pull request before pushing more to the same branch, or the branch drifts. The "unpushed commits" hook counts commits that are in an open pull request but not yet in `main`; check with `git ls-remote` that the remote already has them.
- **Commit trailers:** the house rules say no model names in commits. Commits up to and including the Favourites work carry a co-author line naming a model; they are already merged, leave them. Later commits have none.
- **Settings keys:** `weeklyGoalEps`, `streakMinEps` and `appName` were created with the sheet; the app adds `yearGoalEps` the first time the goal is saved.

## Open questions for the owner
- Keep "TV Tracker" or pick a name (the app name is one cell in `📺 Settings`)?
- When to do the Dashboard clean-up, and what is wrong with it?
- Move `project.json` from stage "Building" to "Working"? (The app is in daily use.)
- Open the lesson issues below in `control-room`? (Needs that repo attached to a session.)
- Fix "Blood & Fire" to "Fire & Blood" in House of the Dragon's Source title (owner's own entry; not changed)?

## Lessons that may apply to every app (not yet raised as `standard` issues)
1. The shared build template rejects `<header>` (see gotchas).
2. A new log tab needs its first row written directly, or the first append inherits the header's formatting.
3. Anything showing images (posters, covers, album art) needs a generated fallback and a note that the claude.ai page blocks other websites' images.
4. Bulk sheet writes: chunks of about 25 rows, read back after each chunk and compare against the backup by script.
5. Candidates for the tracker standard: drag to reorder `Up next #`, a Back to top button, and a floating edit panel on the left (the music app's component works well).

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
  and Library tab (search, status chips, sortable table; a row opens the show panel (see Library rework below), which edits or adds a show writing only changed cells).
- Hosted as a private claude.ai artifact (mcp: Google Sheets get_values / append_values / update_values) and as `index.html` on GitHub Pages.
- `node tests/smoke.mjs`: Playwright smoke test against a fake sheet built from `tests/fixture.json` (390px and 1280px; also covers all 13 themes).

## Stage 3 (2026-10-24): Plan
- Plan tab, top to bottom: Up next (about 10, with a why and Start watching; drag the grip handle to reorder, or Space, arrow keys, Space on the keyboard; only changed Up next # cells are written), Sort deck, Soon (with a Future releases section for Coming Soon shows by premiere date), Backlog (10 at a time, Show 10 more), Recent episodes (edit and delete)
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
  tapping a show in it opens the show panel.
- Log-based panels show "Fills in as you log episodes on the Log tab." until the log has rows. Dashboard tests: `node tests/dashboard.mjs`
  (own fixture `tests/dash-fixture.json`); `node tests/smoke.mjs` still covers the rest.

## Favourites (2026-10-26)
- Each show has a Favourite date (column V). The sticker is a TV-remote rubber button with a heart: tap it on a Library row, in the show panel (header pill, or the toggle in its form that is saved with Save) or on the Log tab front page. It writes only that one cell (today's date, or blank to remove).
- Log tab, top to bottom: Watching now, stat tiles, Episodes per week, Last 5 watched and Favourites (5 that rotate daily; two columns from 900px), then Next Up (Start buttons). Tonight's pick was removed; Recent episodes moved to the Plan tab. Library has a Favourites filter and a sort by favourite date; the Dashboard has a Favourites tile. Tests: `node tests/favourites.mjs`.

## Themes
The app wears one show's look for the whole month (no drift): Jan Breaking Bad / Better Call Saul, Feb Deadwood, Mar Mr Inbetween,
Apr Chernobyl, May Hannibal, Jun Ripley, Jul The Sopranos, Aug Succession, Sep Fleabag, Oct Arcane, Nov Mad Men, Dec Blackadder the Third.
A plain navy **Default** is always one tap away. Source: `design/themes-board.html` (notes in `design/theme-notes.md`).
- Header: the palette button opens the menu (This month / shows by month / Your themes / Default); the arrows flick to the next or previous theme.
  "This month" is the default.
- Settings (gear): pick a theme and edit its colours, heading and text fonts, roundness, grain and light/dark. Reset this theme, Save as a copy.
- Fonts change the wordmark and panel titles only. Body text stays Figtree, numbers stay Atkinson Hyperlegible; status chips keep the sheet's colours.
- Stored in this browser only, never in the sheet: `tv-theme` (choice, `auto` = this month), `tv-theme-edits`, `tv-theme-custom`.

## Sheet change 2026-10-26: Favourite
- Full copy of `📺` kept as `📺 backup 2026-10-26 (before Favourite)`.
- Added column V `Favourite` (date, yyyy-mm-dd): a date means favourited that day, blank means not a favourite. Independent of the rating.
- Pre-marked 13 favourites on 2026-10-26: Hannibal, Arcane, Breaking Bad, Better Call Saul, Blackadder the Third, Fleabag, Chernobyl,
  Deadwood, Mad Men, Mr Inbetween, Ripley, Succession, The Sopranos.
- Checked by script: A–U identical to the backup; V holds exactly those 13 dates.

## Stage 5: Tools and Discover
- Tools tab: Lucky dip by mood, "Where can I watch this?" (search the library, plain-English verdict, Add to Library when missing), Stalled shows (+1 ep, Pause, Call it DNF), Finishing soon, Goal planner (weekly and yearly episode goals, saved to `📺 Settings`), Year in review, and What to watch next (recommendations from your own ratings, five modes).
- Discover tab: Quote of the day from `📺 Quotes` (with an Add a quote dialog), On this day, Coming soon (next premiere from `📺 Seasons`, plus a status pipeline that opens the Library), and search links.
- Only the buttons above write to the sheet; browsing, searching and switching modes never do. Tests: `node tests/tools.mjs` (uses `tests/tools-fixture.json`).

## Sheet change 2026-11-07: Based on, Source title, Poster
- Full copy of `📺` kept as `📺 backup 2026-11-07 (before Poster)`.
- Added columns W `Based on` (chip dropdown: Book, Film, Game, Comic, Other show, True story, Original), X `Source title` (text) and Y `Poster`.
  `Based on` and `Source title` are for "this show is an adaptation of…"; a source id can be added later to link to the book, film and game apps.
- Poster links are TVmaze `medium_portrait` image links (swap `medium_portrait` for `original_untouched` for the large version).
  Matched by title against TVmaze; 306 of 372 shows filled. Confident matches plus clear ones (sheet typos or renamed shows) were written; wrong or ambiguous
  matches (e.g. Spawn, Molly, The Transformers, Formula 1, Bait, The Twelve) and specials, stand-up and single episodes with no TVmaze entry were left blank.
- Checked by script afterwards: A–V identical to the backup, W and X empty, Y equal to the intended list (306 filled, 0 missing, 0 extra, 0 wrong).
- A round Back to top button appears bottom-right on every tab after scrolling. Layout tests: `node tests/layout.mjs`.

## Library rework (2026-11-07): chips, show panel, Based on / Source title / Poster
- Library, top to bottom: search box, category chips, the list. The chips (All, Favourites, then the nine statuses) are all one size and the rows are centred as a group
  (about 6 per row on a laptop, 3 on a phone); each keeps its status dot, count and pressed state.
- Clicking a row no longer expands it: it selects the row and opens a floating panel with that show (another row swaps it; the same row, the close button or Escape closes it).
  The panel is docked on the left on screens wider than 900px (the page moves over so nothing sits under it) and is a bottom sheet (up to 70% of the height, with a grab bar) on phones.
  It shows the heading, a Favourite pill, the details and the full edit form, with Save and Cancel always in view. Unsaved changes ask "Discard changes?" inside the panel before another row or close replaces them.
- The same panel opens from Dashboard drills, the Log tab's Last 5 and Favourites cards, Tools and Discover. Add show opens it with an empty form (Status Watchlist).
- New fields in the form and details: Based on (select), Source title and Poster link (blank or starting with https://, otherwise an inline error and nothing is written). A small Based on chip sits beside the title in the list.
- Reads cover `A2:Y`; a new show appends a full 25-column row. Writes are unchanged: the row is found by id first, only changed cells are written.
- Tests: `node tests/library.mjs` (chips, panel, writes, guards, all 13 themes at 390px and 1280px).
## Shelf view and posters (2026-11-07)
- Library has a small **List | Shelf** switch under the chips (remembered on each device) and a Sort box (Sheet order, Title A-Z, Rating, Year, Recently watched, Favourites first; it stays in step with the list's column sort). Search, the chips and Favourites apply to both views.
- **Shelf** shows upright box sets in rows, each row resting on its own ledge. The number per row follows the width (3 on a phone). Each box has a spine in the status colour, a tiny remote-heart sticker for favourites and a thin progress bar when you are Watching. The first 60 boxes show, then "Show 60 more". Arrow keys move between boxes; Enter or Space opens the show panel, Escape closes it.
- A box shows the **poster** when the Poster link is set (https only). Without one, or if the picture will not load, it wears a generated cover made from the title (colours from the current theme, readable in every theme).
- The show panel shows the poster at the top (the large version when the link has `medium_portrait`, falling back to the saved link).
- **Find poster** (next to the Poster link field) searches TVmaze and lists up to 6 matches; picking one only fills the box, and Save writes just that one cell. It works on the GitHub Pages site only.
- **claude.ai limitation:** the claude.ai page blocks images and calls to other websites, so there posters never appear (covers are shown instead) and Find poster says "Finding posters works on the website version. Paste an image link instead."
- Tests: `node tests/shelf.mjs` (toggle, rows and ledges, posters and covers, keyboard, sorts and filters, contrast in 13 themes, Find poster, reduced motion).

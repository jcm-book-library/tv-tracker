# Theme notes (inspiration only: no stills, posters, logos or logo lettering go in the app)

Owner decisions (2026-10-24): the app wears THIS MONTH's show theme for the whole month (no drift between months).
A plain **Default** is always available: dark navy with grey/silver tinting, kept simple so the show themes stand out.
Themes can be changed or reverted to Default from a header menu, and edited in Settings, the same way as the film app
(`my-film-library`: THEMES / applyTheme / theme menu / Settings editor). Fonts change for headings, the wordmark and
panel titles only; reading text stays easy to read. Light or dark per theme, lighter for the warmer months.
Each theme gets colours, a heading font and ONE small motif drawn in CSS/inline SVG (header only, never over data).
Status chips keep the sheet's dropdown colours in every theme.

| Month | Show | Mode | Heading font | Tokens: bg / surface / raise / line / fg / muted / accent / ink / accent2 / danger | Radius | Grain | Motif |
|---|---|---|---|---|---|---|---|
| — | Default | dark | Atkinson Hyperlegible + Figtree | #0d1424 / #141c2e / #1b2438 / #283249 / #e8ebf2 / #9aa4b8 / #c5ccd8 / #0d1424 / #8ea8cf / #f29a9a | 12 | 0 | none |
| Jan | Breaking Bad / Better Call Saul | light | Barlow Condensed 700 + Figtree | #efe7d4 / #fbf7ee / #f4ecdc / #d9cdb2 / #1b1a14 / #5b5546 / #1f6b45 / #ffffff / #b8900a / #b3261e | 6 | .15 | the "TV" letters sit in a small square element tile (green, thin border, tiny atomic number) beside the wordmark; faint desert-heat haze gradient across the header |
| Feb | Deadwood | light | Rye (wordmark + h1 only), Playfair Display 700 for panel titles + Figtree | #e8dcc2 / #f6eedd / #eee3cb / #cdbb98 / #2a1d12 / #6a5640 / #7a3f1c / #ffffff / #a87a2a / #9a2b1b | 3 | .35 | ornamental double rule with a centre diamond under the header, sepia vignette |
| Mar | Mr Inbetween | dark | Saira Condensed 700 + Figtree | #0b0a0d / #141217 / #1c1a21 / #2b2833 / #f1eef4 / #a59fb0 / #f08a2c / #1a0b00 / #7a6cff / #ff6a5a | 4 | .1 | thin crosshair reticle over one letter of the wordmark; a match-flame glow at the header's left edge fading into ultraviolet on the right |
| Apr | Chernobyl | dark | Jura 600 + Figtree | #111513 / #191e1b / #212824 / #313a34 / #e9eee8 / #9faca2 / #ef7a3c / #1a0a02 / #b5c3b0 / #ff8a6a | 6 | .4 | heavy film grain + a soft orange glow rising from the bottom of the header band (fog over it) |
| May | Hannibal | dark | Cormorant Garamond 700 + Figtree | #0b1120 / #121a2c / #19233a / #26314d / #eef0f6 / #a2aac0 / #d5605a / #1a0606 / #e6dcc4 / #ff8a7a | 10 | 0 | a small stag-antler silhouette against a thin dusk-amber-to-navy band at the very top of the header |
| Jun | Ripley | dark (pure greyscale) | Italiana (wide tracking, uppercase) + Figtree | #0c0c0c / #151515 / #1e1e1e / #2e2e2e / #f2f2f2 / #9a9a9a / #e6e6e6 / #111111 / #8a8a8a / #d0d0d0 | 2 | .25 | vertical window-blind slats across the header and very faintly across the page background; wordmark letters widely spaced. Homage to classic black-and-white TV |
| Jul | The Sopranos | dark | Abril Fatface + Figtree | #121418 / #1a1d22 / #22262c / #33383f / #eef1f4 / #a3abb5 / #d93a30 / #ffffff / #dfe8f0 / #ff8a7a | 8 | .1 | a few soft snowflakes drifting in the header (static dots; animated only if motion is allowed) and a cold pale band at the top |
| Aug | Succession | dark | Raleway 300 uppercase, very wide tracking + Figtree | #0f151b / #161e26 / #1e2832 / #2c3946 / #edf1f5 / #9eacba / #8fb5d8 / #0a1520 / #c75a62 / #ff8a7a | 4 | 0 | a glass curtain-wall grid of fine lines behind the header with a lighter cloudy reflection |
| Sep | Fleabag | dark | Oswald 700 + Figtree | #15100f / #1f1817 / #2a201f / #3c2f2d / #f6eeea / #b3a29d / #e8453c / #ffffff / #d9b45a / #ff8a7a | 8 | .1 | a thin Breton-stripe band along the header bottom and a faint gold halo ring behind the wordmark mark |
| Oct | Arcane | dark | Marcellus SC + Figtree | #120f1c / #1b1729 / #241f36 / #352e4d / #f2eefa / #aaa2c4 / #4fb8ea / #04131c / #f2559a / #ff8a7a | 12 | .1 | a spray-paint splatter of pink and blue in one header corner plus a fine gold hairline arc (Piltover brass) |
| Nov | Mad Men | light | Jost 600 + Figtree | #ecebf0 / #fafafc / #f1f0f5 / #d4d2dc / #141418 / #55545e / #d93a26 / #ffffff / #3f6fb5 / #b3261e | 4 | .08 | a single grey smoke curl drifting up from the header's left corner |
| Dec | Blackadder the Third | light | IM Fell English (+ IM Fell English SC for small caps) + Figtree | #e9d8b0 / #f6ead0 / #efdfbd / #cdb688 / #2a1a10 / #6b5236 / #a82a24 / #ffffff / #6b3f1f / #8a1f14 | 3 | .3 | parchment wash with a couple of faint stains, and a small red wax seal stamped "III" beside the wordmark |

Notes
- Warm months (Nov–Feb) are light; the rest are dark. Ripley is deliberately monochrome.
- Body text everywhere: Figtree; numbers and data: Atkinson Hyperlegible (as the book app). Only headings take the theme font.
- Contrast: fg on bg and on surface >= 7:1; muted >= 4.5:1; accent text/bars on surface >= 3:1 (>= 4.5:1 where used as text); ink on accent >= 4.5:1. Adjust a value slightly if a check fails and note it here.

## Contrast adjustments
Made while building `themes-board.html` (the board's THEMES array carries the adjusted values; the table above is unchanged).
- **Fleabag**: accent #e8453c changed to #d93a33. White ink on the original accent was 3.9:1 (needs 4.5); now 4.6:1, and the accent on surface is still 3.8:1 (needs 3).

Note: the accent is only used for bars, icons, buttons and large numerals in the mock-ups (3:1 rule), never as small text. Sopranos (3.7) and Mad Men (4.4) pass on that basis and were left as specified.

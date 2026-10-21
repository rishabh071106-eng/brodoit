# Brodoit design framework

Every screen is built from the same few parts, in the same font, on the same scale. If a screen needs something this file
doesn't describe, add it here first. The components live in `app/ui.css`, which every page loads last.

## Type
One family everywhere: **Plus Jakarta Sans** (self-hosted in `app/fonts/`), with Noto Sans Devanagari for Hindi.
Code uses the system monospace. No serif, no Inter, no web-font downloads.

| Role | Token | Use |
|---|---|---|
| Large title | `--ui-t-large` 700 28px | the page title, once per screen |
| Title | `--ui-t-title` 700 20px | a card or sheet title |
| Headline | `--ui-t-head` 600 16px | a row title, a button |
| Body | `--ui-t-body` 400 15px | reading text |
| Subhead | `--ui-t-sub` 500 13px | a row subtitle, a status line |
| Caption | `--ui-t-cap` 500 12px | labels on charts, timestamps |

Sentence case. Uppercase only for tiny labels of three words or fewer.

## Colour
- Surfaces: `--b-bg` (page), `--b-card` (cards and lists), `--b-bg-2` (pressed, tracks). Text: `--b-ink`, `--b-mute`.
- One brand accent, `--b-primary` (brick), for the primary action and focus.
- Each app or game has one accent (`--g-memory`, `--g-python`, …) used **only** on its icon tile and its progress bar
  (and, on a hub button, as a light tint of the button itself).
- No gradients on controls, no full-colour screens outside a game's play area.

## Shape and depth
- 4/8 spacing. Radius 12 (controls), 16, 20 (cards and lists).
- Depth is a hairline border (`--b-line`) plus `--ui-shadow`. Never a hard bottom shadow, a 3D press, or text shadow.
- Motion: short fades and slides (≤ 250 ms), nothing that bounces. Respect reduced motion.

## Components (`app/ui.css`)
- **Page header** `.ui-page-h`: back chevron (inner pages), large title, at most one trailing icon action.
- **Section header** `.ui-sec`: a short muted label above a list or card.
- **List and row** `.ui-list` / `.ui-row`: the one way to show an app, a course, a game, a language, a setting.
  A row is a 44px icon tile (`.ui-ic`, tinted with the item's accent), a title, one line of status, an optional
  thin progress bar, and a chevron. Minimum height 68px.
- **Hub buttons** `.ui-hubs` / `.ui-hub`: up to three big choices that share the screen; used on Learn.
  Each is a 64px solid icon tile, a 24px title, one line of status (ellipsis), and an arrow, on a surface tinted
  with the item's accent (`--hub-accent`, 9% light, 17% dark) with an 18% accent hairline, radius 24, and the
  item's icon large and faint in the corner (`aria-hidden`). The page gives `.ui-hubs` the height to share; each
  button takes an equal part and never less than 124px, so short and landscape screens scroll. A button 168px or
  taller stacks (icon top-left, text bottom-left, arrow bottom-right); a shorter or very wide one is a single row.
  `aria-label` is the title and the status. Pressed: scale .985 and a slight darken.
- **Card** `.ui-card`: one idea per card (today's workout, a chart).
- **Buttons** `.ui-btn` (48px, flat): one primary per screen; `.sec` and `.ghost` for the rest.
- **Segmented control** `.ui-seg`, **sheet** for secondary actions, **field** `.ui-field` (48px, 16px text, brick focus ring).

## Navigation
Tabs at the bottom. Inside a tab, a list of rows opens an inner page with a back chevron; the phone's back button
returns to the list. Learn is three hub buttons (Games, Coding, Languages) filling the screen, each opening its own list.

## Words
- Titles of one to three words. Subtitles of one line.
- No exclamation marks, no emoji, no "Brilliant", "Awesome", "Superb". Say what happened: "Level 4 unlocked".
- One primary action per screen. Secondary actions go in a sheet behind a single "More" button.

## Celebration (v21: lessons and games only)
The owner asked for learning that feels exciting. Inside a lesson or a game (the Languages Listen and Practice players,
their end screens and course path, Mind rounds, Python levels) these are allowed on top of the rules above:
- **Words:** Bro's spoken and written cheers may use one exclamation mark ("Five in a row!", "Lesson done!"). They come
  from `lang/data/cheers.json` (recorded in Bro's voice), at most one every 5 correct answers.
- **Motion:** one pop of at most 400 ms (the XP "+2", the combo chip, the stats strip), confetti when a lesson is done or
  today's goal is reached, a gently pulsing "next" node on the course path, and the mascot's poses (speaking, listening,
  celebrating). Reduced motion: no pops, no confetti, no pulse; the numbers still change.
- **Colour:** the streak flame (orange), the goal ring (green) and XP (gold) are the only extra colours, on small chips.
  The course path's next node and the Continue card may use the brand gradient.
- **Sound and touch:** short game sounds (`app/sound.js`) with a mute button in the player, and haptics
  (`app/haptics.js`).
- Never on lists, settings or anything outside a lesson or game. Icons, not emoji, in the chrome.

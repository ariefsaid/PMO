# Screen rules (binding for every UI change)

A person works by sight and habit: position, size, colour and icon first, words last. Every rule below
removes reading or makes the same thing identical everywhere.

## Order on any screen
1. What waits on this person (a decision, a return, something late), as rows that link to the fix.
2. What is off track, worst first.
3. Position figures.
4. Everything else lives on its own page and is linked, not repeated.

## Words
- No explanatory sentence under a page title. No sentence inside a figure tile. No running commentary in toolbars.
- At most ONE help control per screen (page level). Per-tile and per-column "?" icons go; a definition that
  matters moves into that one page-level help.
- A caption is at most 6 words and at most one per figure.
- Empty state: one line saying what is absent, plus the one control that fixes it. The control it names must exist on that screen.
- A screen never gains words: `scripts/ux-proof.sh` word budget is the check; update the budget downward only.

## Numbers
- Money always carries its currency. Tiles: 2–3 significant digits ("IDR 7.7B"). Tables: full amount, right-aligned, tabular.
- One currency per figure: the organisation's currency is the figure; another currency sits on a second line ("+ USD 5,300"). Never "A · B" in one figure.
- A count never sits in a row of money figures. Counts go in the "waits on you" rows.
- Unknown is never a sentence in a tile and never "0": the tile or column is hidden, and ONE page-level line says what is missing and links to the fix ("3 figures hidden: accounting is not connected · Set up").
- A column that is blank on every row is not rendered.
- Two different quantities never share a name, and one quantity never has two. Where two screens show different figures under one word (two populations, two clocks), give each its own short name ("Invoice age" / "Waiting to pay") or show the same one on both; do not explain the difference in a sentence.
- No verdict words from thin data: a trend needs 3+ data points, else no chart and no "Rising/Falling".

## One name, one look
- Send back for correction = **Return**, always asks for a reason, reason is shown to the person who gets it back. **Reject** = final refusal, also with a reason. Same dialog layout for both: reason field, quiet Cancel, filled confirm.
- Dates: `10 Nov 2026`; within the current year `10 Nov`; never numeric-only, never "Nov 26" for a month and year (write `Nov 2026`). Relative age only as a number with unit ("118 days overdue").
- Status colour means exception only: overdue / over budget / rejected = red; due soon / waiting on someone = amber; done = green; everything normal = neutral grey. Same state, same colour on every screen.
- One name per state per record type, from one shared map; lists, records, filters and menus all read it.
- Record pages: one header (title 20px+, status pill, key facts row, one filled primary action, the rest in a menu).
- A row opens its record in the side drawer over the list; "Open full page" inside it. Creating a record uses the form dialog unless the form needs more than one screen of fields.
- Navigation icons are unique per item.

## Layout
- One dominant thing per screen: the first "waits on you" row, or the worst item. Filled blue is for the screen's one main action.
- A card heading sits 16px above its content. No empty bands.
- Type: 14px floor for anything read; 12px only for chart ticks, count badges, shortcut hints, timestamps, version footer; nothing below 12. Figure tile: label 14 medium dark, value, one caption.

## Graphics (owner, 11 Nov: a calm screen must not be a bare one)
Remove words, never information. Where the data calls for a picture, draw it:
- A trend over time with 3 or more points: a line or column chart.
- A comparison across items (projects, stages, clients): bars, sorted, values labelled on the bars.
- Parts of a whole (stages, categories, hours by project): one stacked bar.
- A funnel (sales stages): a funnel or descending bars on ONE scale.
- A single number stays a figure; three items or fewer stay rows. No chart without a decision behind it.
- A chart is labelled directly (no legend to decode), 12px ticks allowed, one neutral series colour plus one
  accent; red only marks an exception (over budget, overdue). A chart whose data is fully unknown is not drawn: it joins the page-level hidden line. When it is partly unknown, draw the known series and state the gap in one line under the chart. Use recharts and the `dataviz` skill.
- A full-width card is for a table or a wide chart. A short list ("Waits on you") takes a third of the row
  beside related content.

## Phone (390)
- The list or the task comes first; summary figures sit behind a tap or below.
- Touch targets 44px high minimum. Form inputs 16px text.
- The action bar for a decision (Approve / Return) stays in view with its evidence.

## Feature floor
Nothing a screen can do today is deleted. A block removed from a screen must have a home it is linked to;
name that home in your notes. If it has none, keep it lower on the page under a plain heading and say so.

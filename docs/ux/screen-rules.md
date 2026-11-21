# Screen rules (binding for every UI change)

A person works by sight and habit: position, size, colour and icon first, words last. Every rule below
removes reading or makes the same thing identical everywhere.

## Order on any screen
1. What waits on this person (a decision, a return, something late), as rows that link to the fix.
2. What is off track, worst first.
3. Position figures.
4. Everything else lives on its own page and is linked, not repeated.

## Words
- No sentence explaining the page or how to use it under a page title. No sentence inside a figure tile. No running commentary in toolbars.
- Allow ONE data finding line directly under the title or directly under the figures band: today's facts from the data, each clause linking to its place ("3 of 11 projects off track · 1 invoice 120 days overdue"). Omit it when there is nothing to report; it never describes the page or how to use it.
- At most ONE help control per screen (page level). Per-tile and per-column "?" icons go; a definition that
  matters moves into that one page-level help.
- A caption is at most 6 words and at most one per figure.
- Empty state: one line saying what is absent, plus the one control that fixes it. The control it names must exist on that screen.
- A screen never gains words: `scripts/ux-proof.sh` word budget is the check; update the budget downward only.
- A word-budget cut never removes a statement of scope, consequence or optionality that a user acts on. Cut decoration first; if nothing else is left, raise the budget and say why.
- Overdue is for tasks and invoices past their due date ("8 tasks overdue", "5 days overdue"); late is for phases. Never cross them.

## Numbers
- Money always carries its currency. Tiles: 2–3 significant digits ("IDR 7.7B"). Tables: full amount, right-aligned, tabular. Read-only money uses the currency symbol and whole units; inputs, exports and editable values keep their exact value. Never show a non-zero amount or difference as zero: show its exact value or “under $1” (in its currency).
- One currency per figure: the organisation's currency is the figure; another currency sits on a second line ("+ USD 5,300"). Never "A · B" in one figure.
- A count never sits in a row of money figures. Counts go in the "waits on you" rows.
- Unknown is never a sentence in a tile and never "0": hide the tile or column and report the reason and fix link in the screen's one hidden-figures line and Why list.
- A partly drawn chart or table may keep one short line directly beneath it. State the same missing fact once in each screen region; don't repeat it in neighboring cards.
- A column that is blank on every row is not rendered.
- Two different quantities never share a name, and one quantity never has two. Where two screens show different figures under one word (two populations, two clocks), give each its own short name ("Invoice age" / "Waiting to pay") or show the same one on both; do not explain the difference in a sentence.
- No verdict words from thin data: a trend needs 3+ data points, else no chart and no "Rising/Falling".

## One name, one look
- Send back for correction = **Return**, always asks for a reason, reason is shown to the person who gets it back. **Reject** = final refusal, also with a reason. Same dialog layout for both: reason field, quiet Cancel, filled confirm.
- Dates: `10 Nov 2026`; within the current year `10 Nov`; never numeric-only, never "Nov 26" for a month and year (write `Nov 2026`). Relative age only as a number with unit ("118 days overdue").
- Date inputs: one `DateField` everywhere, never the browser's own date control (a phone keeps its system picker). It shows `10 Nov 2026`, takes typed `10 Nov 2026`, `10/11/2026`, `10-11-2026` or `2026-11-10`, and hands the form an ISO day.
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

## Hierarchy (added 11 Nov after blind re-review C: "everything is 14px grey in white boxes; 87% of text is one size")
The 14px floor fixed legibility and flattened the page. Levels must differ by more than one step, using size
for figures, weight for titles and ONE muted grey for secondary text:
1. Page title: 24px / 600.
2. Key figure: 30px / 600, tabular: the largest thing in its card, larger than the page title's neighbours
   and never styled like a title.
3. Card or section title: 16px / 600, foreground.
4. Body and table cells: 14px / 400, foreground. Body text is never 600; only titles, figure labels (500)
   and the one emphasised row are heavier.
5. Secondary (captions, meta, table header labels): 14px / 400 in ONE muted grey that still passes AA
   (4.5:1). Collapse the near-identical dark greys to two text colours: foreground and muted.
6. 12px only for the allowed list (chart ticks, count badges, shortcut hints, timestamps, version).
Emphasis:
- The block that waits on the person ("Waits on you", a return, an approval to decide) sits on a tinted
  surface (the waiting tone's soft surface) so it is the heaviest block at a glance; its count is a figure.
- Exception colour appears ONCE per group: on the group's count or pill ("14 overdue"), and on the single
  most urgent row of the screen. Rows below it state lateness in plain foreground text ("263 days late").
  A list where every row is red tells nothing.
- A money exception gets size, not just colour: an overdue amount is shown as a figure with its age beside it.
- No decorative bar: a bar that always reads 100% (e.g. "Contract") is removed; bars compare at least two values.

## Layout
The rendered proof (`scripts/ux-proof.sh`) **measures** rules 1, 2, 6 and 7, **warns** on rule 3, and leaves rules
4, 5 and 8 to 11 to the reviewer's eye. It reuses the repo's own checkers (taste `panel-void`, `ragged-row`,
the canvas edge; stageshow `layout-core`) and adds what none of them measures: painted-content gap scale, one left edge, columns ending level by their content, and figure-to-action centring. The numbers
live in `LAYOUT_NUMBERS` in `scripts/ux-proof-metrics.mjs`; this text and the self-tests use the same ones.
`docs/ux/layout-baseline.json` lists, per route, state, width, login and language, the failure fingerprints
(check plus element, no text; repeats of one row group or card class count once). The gate fails on any
fingerprint not listed; `docs/ux/layout-baseline.md` carries counts for reading only. A route under redesign
reaches an empty list.
**Five fixed rules** (owner, 16 Nov) fail whatever any baseline says; `scripts/ux-proof.sh --rules-only /route ...` prints
them at 1440, 1024 and 390 with no baseline or word budget touched, and a plain run prints them as warnings until the screens are fixed.
R1 card inset: in a card with a heading, every direct block starts at the heading's left x (±1), except a table or media spanning the card edge to edge. R2 trailing tag: in a list, menu or picker row a tag is one line and the tags of one list share a right edge (±1). R3 section frame: tab bars with the same labels keep one left x, top y and width across routes at a viewport (±1). R4 no lone centring: one item in a container over twice its height (and 64px) starts within the container's top padding. R5 shared ends: stacked bars share start and end x (±1); right-aligned figures of one column share their right x (±1). The numbers are `RULE_NUMBERS` in `scripts/ux-proof-metrics.mjs`.
1. One left edge per surface (measured): every block in a panel starts at the same x (the panel inset); on the
   page, flat content and panels share the gutter. Tables stay flush; their cells keep the 16px cell inset.
   A KPI tile is its own surface with a 16px inset (DESIGN.md), so its inset is not a page-column edge.
   Structural indents (table columns after the first, nested list levels, trees, chart internals, a chip's or
   field's own padding, a row's leading checkbox, avatar or swatch, a centred or right-aligned control) are exempt; mark one deliberate exception `data-layout-ignore`. The proof reports the
   markers per route and fails one that covers a panel or more than 30% of `main`. `data-layout-surface` makes
   an element count as a panel when it has no border or shadow of its own.
2. Spacing follows the relationship (measured, between painted content, not box edges): a heading sits 12 to
   16px above its content (±2); sibling sections or panels sit 16, 24 or 32px apart (±2): panels 24px on
   desktop and 16px on a phone, sections 32px; no block is more than 48px of white space from the next while
   content follows. Gaps under 12px inside one group (label to value, icon to text) are not judged. Paddings
   never stack: a panel inside a panel, or a padded wrapper around a panel, adds no second inset; stacked
   padding shows up as one gap above 48px.
3. No section for one value (warning): a heading over a single label and value becomes a line in the block above.
4. Every action has a place: the header action slot, or a sticky bar on a phone. None floats in the
   page flow under unrelated content.
5. One surface language per page: bordered panels or flat sections, not a mix with different insets.
6. Rows share a baseline (measured): in a record row the figure and its action are centred on one line, unless
   the figure sits in its own right-aligned numeric column shared by every row. A figure has a currency or ISO
   prefix, a separator or a %, or is set in tabular numerals; a date or a count badge is not one.
7. Columns end level in every state (measured). Columns of one row end within one panel gap (24px) of their
   tallest neighbour while the page continues below. Error and empty states are designed to that height, not
   collapsed to a line. The height is kept by pinning the action to the foot (`flex-col` with `mt-auto`) or by
   stretching the card: the gap check does not judge the children of a flex or grid item stretched to its row's
   height, nor a child pushed down by `margin-top:auto`.
8. A message fits its cell: one line plus its action, or the action under the text. It never wraps into a
   narrow column beside a button.
9. Removing words re-flows the screen: when copy goes, the blocks below close up to the scale; no hole is
   left where text was.
10. Secondary text under a figure uses the supporting token: 14px, regular weight, muted colour.
11. Long lists use numbered pages with Previous / Next and "Showing a–b of n"; the page is kept in the
    address so Back and a shared link return to it.

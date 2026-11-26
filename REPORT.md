# Stock, receiving, transfers, material requests: screen-owner report, round 2 (1126)

Work branch: `ui/1126-stock-receiving-r2` (from `origin/batch/1126-ui`, merged up to date before the gates).
Screenshots: this branch only, `ux-shots/stock-receiving-r2/{before,after}/<screen>-<en|id>-<width>[-full].png`
(`-full` = the whole inner scroll pane; widths 1440, 1024, 390). BEFORE = the base branch served on its own dev server;
AFTER = the work branch. Same local database, same records, same logins. Roles used: storekeeper and site person =
Engineer (`engineer@`), purchaser = Finance, approver = Project Manager, setup = Admin.

## Purpose and structure (the order of work, settled before layout)

**1. Receive against an order** (`/stock/new/receive?order=`). Storekeeper: *what did I count for each line?*
Round 1 composed it; round 2 fixes the last column only.
```
Item                 Ordered  Received  Outstanding  Status   Counted
Kabel NYY 4 x 4 mm²  1,250.5 m    0 m    1,250.5 m   …        [____] m   ⋯   <- menu cell on the row's own surface
Jasa pengiriman          1        0          1       …          —            <- no menu: an empty cell, no strip, no rule
```

**2. Stock transfers** (largest new screen, composed this round). Storekeeper / coordinator: *what is on the road,
what came short and needs a decision, what is closed?* Receiver: *did what was sent arrive?*
```
LIST  Stock transfers                                         [Send stock transfer]
      Transfer        From           To          Lines  Sent           Status
      Short, waiting for a decision (1)
      TST-…0004       Central store  Site A store    2  26 Nov, 14:58  [Received, shortfall open]
        1 shortfall open · Proof outstanding   (inside the row link)
      In transit (2) …         Closed (2) …
DETAIL [Stock transfer TST-…0001  (In transit)]          [Print delivery note] [⋯ Recall]
       Central store → Site A store · Sent by … on 26 Nov 2026, 14:58 · Addressed to … · Note …
       Count what arrived:  Item | Sent | Counted [__] unit | Accepted [__] unit
          (reason / quality / "n short: stays in transit" under the table) · handover checkbox · [Confirm receipt]
       or Lines (on record): Item | Sent | Counted | Accepted | Rejected | Note
       Shortfalls (tinted, waits on a decision): reason · item · "6 m short" · [It arrived] [Send back] [Write off]
       Handover confirmations: signer · when · stage · proof · recorded by · photos
SEND   Where (From, To; Receiver on its own row) · Lines (Item n | Quantity n + unit | Remove) · Details (Note)
PRINT  unchanged composition; quantities in the locale's number format.
```

**3. Material requests.** Site person on a phone: *raise a request for this work order and see, per item, where it
stands against the plan.* Approver: *read each line against its plan and decide.*
```
FORM line   [Item ▾] [Quantity (bag)]
            Plan      Requested before   New total       <- one figure each, unit beside it, shared baseline
            300 bag   120 bag ▸          270 bag
            From material allowance       (Over plan, when it is)
            (earlier requests open here, full width)  · usage warning line · reason when over plan
DETAIL      Items: Item | Requested | Plan | Requested before | New total   (source, over-plan reason, warning under the item)
```

**4. Stock home, opening stock, counts, usage standards.** Stock home: *what is here, how much is free?*
```
Item / name   Warehouse      On hand   Free     Reserved   Avg cost   Value     [Reserve]
```
Opening stock: tabs now sit where they sit on every stock page. Counts and usage standards: no sentence-shaped data
found (the count notice states a consequence and stays; usage standards is already a table).

## What changed and why (10 lines)
1. **Shared table, row-menu column:** the sticky ⋯ cell painted white with its own left rule on every row, even when
   nothing scrolled under it and even on rows with no menu. It now paints no surface and no rule unless content is
   hidden under it (the table already flags that). Embedded tables keep the page's grey; scrolling tables keep the cover.
2. **Transfers list:** five bordered cards of loose lines → one grouped table (short first, then in transit, then closed);
   dates in the house format (`26 Nov, 14:58`, was `Nov 26, 2026, 02:58 PM`); status as a pill (amber only for an open
   shortfall, green for closed).
3. **Transfer page:** a sentence per line ("Sent 40 · counted 34 · accepted 32 / rejected 2: …") → one table, every
   quantity with its unit; a record header (number, status pill, facts, print, recall); recall moved from an always-open
   reason box to the menu → the shared reason dialog; the shortfall decision is the tinted block; breadcrumb read
   "Loading…" forever → `Stock › Stock transfers`.
4. **Send:** labels read "Item1 / Quantity1" → "Item" (or "Item 2"…); the unit shows beside each quantity; the
   receiver's 4-line helper is one line on its own row.
5. **Material request line:** the five-in-one sentence → three figures with units on one baseline; the earlier-requests
   list opens under them instead of splitting the sentence.
6. **Material request page:** the same sentence per item, with the quantity stranded at the far right → one table.
7. **Stock home:** "400 free + 0 reserved" in one cell → Free and Reserved columns; Reserve is a trailing action column;
   the item name under the code is secondary (it was as heavy as the code).
8. **Receive:** column widths so "Outstanding" fits at 1024; on a phone the unit sits beside the count (it fell under it).
9. **Opening stock:** "Back to set-up" link removed (the breadcrumb and the Setup tab lead there); tabs line up.

## Measured edges, before → after (1440×900 unless stated, same data, measured in the browser)

| Screen | Measure | Before | After |
|---|---|---|---|
| Receive | ⋯ cell background / left rule (no scroll) | white `rgb(255,255,255)` / inset rule | transparent / none |
| Receive | ⋯ cell when content scrolls under it | white + rule | white + rule (kept) |
| Receive @1024 | headers truncated | "Outstanding" | none |
| Receive | Outstanding figures right x | 912 | 912 (unchanged) |
| Transfers list | tables / transfer rows | 0 / 5 cards | 1 / 5 rows |
| Transfers list | left x of transfer numbers | 248 (cards) | one column, rows share the cell inset |
| Transfers list | date format | `Nov 26, 2026, 04:09 PM` | `26 Nov, 16:09` |
| Transfer (receive) | tables | 0 | 1 |
| Transfer (receive) | Counted inputs right x / Accepted right x | 626 / 1003 (two half-width inputs per card) | 1199 / 1367, every row equal |
| Transfer | quantities with a unit | none | every quantity |
| Transfer (short) | lines written as a sentence | 2 | 0 (table cells) |
| Transfer | breadcrumb | `Stock › Loading…` | `Stock › Stock transfers` |
| Request form | plan figures in their own cell | 0 (one sentence) | 3 |
| Request form | top y of Plan / Requested before / New total (1440; 390) | n/a | 705/705/705; 759/759/759 |
| Stock home | cells holding a "free + reserved" sentence | 30 | 0 (Free and Reserved columns) |
| Opening stock | tab bar top y vs /stock/ledger | 172 vs 124 | 124 vs 124 |

## Screenshots (this branch)
`ux-shots/stock-receiving-r2/before/` and `/after/`, file names:
`receive-purchaser`, `receive-storekeeper`, `transfers-list`, `transfers-list-keeper`, `transfer-send`,
`transfer-sent-sender`, `transfer-sent-receiver`, `transfer-closed`, `transfer-short`, `transfer-recalled`,
`transfer-recall-dialog` (after only), `transfer-print`, `stock-home`, `stock-home-pm`, `stock-opening`, `stock-count`,
`usage-standards`, `mrq-list`, `mrq-list-all` (before), `mrq-new`, `mrq-draft`, `mrq-draft-prior`, `mrq-detail`,
`mrq-settings` (before) — each `-en-`/`-id-` and `-1440`/`-1024`/`-390` (+ `-full`).
Shared-table check on two other screens: `after/companies-en-{1440,800}.png`, `after/projects-id-{1440,800}.png`.
The owner's crop for item 1: `before/receive-purchaser-en-1440.png` vs `after/receive-purchaser-en-1440.png` (right edge).

## Skill lines applied
- **restructure:** "Freeze the feature floor before any edit; simplification cannot silently remove a figure, capability
  or safeguard." — every figure kept a home: sent/counted/accepted/rejected/reason/resolution → transfer table columns;
  plan/prior/total/source/over plan → figure strip and table; free/reserved/holders/Reserve → two columns + action column.
- **restructure:** "Render restricted roles as well as the top role" — transfer receiver (Engineer) and sender (Admin),
  purchaser and blind storekeeper, site person and approver all rendered.
- **taste (app-screens §7.4):** "Numbers right-aligned, in tabular figures" and "One right edge per row or card" —
  every quantity column; the count inputs share one right edge.
- **taste (§7.4):** "Two measures stack in one cell rather than taking two columns" — *not* applied to free/reserved on
  purpose: the brief's "one figure per cell" wins; they are two quantities a storekeeper compares down the column.
- **impeccable (craft-floor, Verify):** "Spacing: tight groups, generous separation" — the handover checkbox and Confirm
  button moved into the foot of the count panel instead of floating between cards.
- **impeccable (craft-floor, Refuse):** "A modal for a task that needs neither interruption nor protected focus" — the
  reverse case: recall *is* a protected, consequential write, so it moved from an always-open box to the reason dialog.
- **screen-rules:** "Send back for correction = Return … Reject = final refusal … Same dialog layout for both" — recall
  uses the same ReasonDialog (reason field, quiet Cancel, filled confirm).
- **screen-rules:** "Dates: `10 Nov 2026`; within the current year `10 Nov`" — list `26 Nov, 14:58`; record facts
  `26 Nov 2026, 14:58` (a journey reads the year there).
- **screen-rules:** "Status colour means exception only" — transfer pill amber only for an open shortfall.

## Journeys and gates (real results)
- `npm run check:guards` pass · `npm run typecheck` pass · `npx eslint --max-warnings=0` on all 37 touched files pass.
- Touched unit tests pass (transfer detail 23, send 5, list 3 new, receiving 14, request form/usage 57, request page 33,
  on-hand 55, opening 8, route map 98, DataTable 184 incl. the pre-existing failure below).
- `npx vitest related --run` on the 15 changed source files: **1,179 files, 11,994 tests passed** (run before the list-link
  fix; the list file and its new test pass on their own, see above).
- Journeys (40 chosen; `affected-e2e.mjs` lists 460+ because DataTable and the route map are app-wide), fresh database.
  **Run 1: 48 passed / 6 failed** (54 incl. setup). Both causes were mine and are fixed:
  (a) four journeys found the on-hand figure as "the cell reading 70 bag"; the new Free column shows the same figure
  when nothing is reserved. One shared helper (`e2e/support/stockUi.ts` `onHandCell`) now reads the On hand column by
  its header, for every journey that checks an on-hand figure;
  (b) AC-TST-028: the transfer list rows had no link (DataTable renders it only with `onActivate` beside `rowHref`).
  Fixed, with a new unit test that fails without the fix (mutation-checked).
  **Run 2** failed for a different reason: run 1's AC-TST-028 failure happened before it recorded its shortfall, so
  its clean-up could not close it and the organisation stayed in two-step mode (an open shortfall blocks the switch).
  The one-step journeys then found no "Post stock transfer" button. Database reset.
  **Run 3: 7 red again** → re-diagnosed from the trace: after a warehouse filter change the table is briefly replaced
  while the filtered list loads; the helper read the headers once in that gap (no headers → index −1 → the last cell,
  "Reserve"). The helper now polls until the header is there.
  **Final, on the final code:** the 7 + the 4 that use the helper or the list → **18 passed** and **14 passed**
  (incl. setup), 0 failed. Specs green on the final code: AC-STK-001, AC-SVL-012, JOB-F9 (receipt at site), AC-OSH-014,
  AC-TST-028, JOB-F9 (recount), JOB-F20, JOB-F10 (handover photo), JOB-F11 ×2, JOB-F21; the other 34 of run 1 passed
  on code whose only later changes are the list link and the helper.
- `scripts/ux-proof.sh` on 9 routes (`/stock`, `/stock/transfers`, `/stock/transfers/new`, `/stock/new/receive`,
  `/stock/opening`, `/stock/new/count`, `/stock/usage-standards`, `/material-requests`, `/material-requests/new`),
  1440 and 390, light and dark: min text 14px everywhere, no input under 16px, no phone target under 44px except one on
  usage standards at 390 (same on the base), no overflow, **impeccable findings 0** (4 on `/stock` fixed: the tag chip's
  6px padding), **axe serious/critical 0**. Exits non-zero for reasons that are **identical on the base branch**
  (served on its own dev server against the same data): every route prints "missing shrink-only target baseline";
  `/stock/usage-standards` and `/material-requests` each carry one empty-state blank-band fingerprint; `/stock` carries
  one figure/action centring fingerprint (the Reserve button beside the two-line item cell) and a word count above its
  recorded budget of 19 (**20 now, 23 on the base**). Words per route: transfers 18, send 14, receive 16, opening 16,
  count 19, usage standards 15 (390: 26), requests 17, new request 25. R3 tab-bar warnings on usage standards are the
  same on the base.

**Journey steps updated (goals unchanged):**
- `serial/JOB-W18`: the line's sent/counted/rejected/reason read from its table cells, not one list item's sentence.
- `serial/JOB-F9-recount`, `serial/AC-SITE-009`, `serial/AC-TST-028`: the short quantity now carries its unit
  (`1 <unit> short`); `serial/JOB-W8`, `JOB-W6`, `JOB-F9`, `AC-TST-028`, `JOB-W18`: the count inputs found as
  `textbox` "Counted"/"Accepted" (the column headers carry the same words).
- `AC-CUS-015`: the plan figure read from its own cell (`mrq-plan-qty`).
- `serial/AC-RSV-018`: free and reserved read from their columns.
- `AC-STK-001`, `AC-SVL-012`, `serial/AC-OSH-014`, `JOB-F20` and every `expectOnHand` caller: the on-hand figure read
  from the On hand column.
**Unit tests replaced (pinned a sentence or the old label):** request form "Plan 10 · already requested 4 · new total 7"
(×2) and the section line; request page "Plan 10 · already requested 0 · new total 12"; on-hand "50 free + 20 reserved"
(×3) and "0 free + 20 reserved"; send "Item1/Quantity1"; DataTable sticky-cell surface regex (now allows the
overflow-only cover). Mocks gained the units read.

**Pre-existing, not mine:** `DataTable.tableIds.test.ts` fails on the base branch too (duplicate tableId between a
dashboard section and the leave list).

## Owner to confirm
1. **Transfers list order:** short (waiting for a decision) first, then in transit, then closed (was in transit first).
2. **Recall** moved from a reason box always open at the bottom of the transfer to the header's ⋯ menu → reason dialog.
3. **"Back to stock transfers"** link under the title removed: the breadcrumb `Stock › Stock transfers` replaces it.
4. **Stock home:** "Free and reserved" split into **Free** and **Reserved** columns; **Reserve** is a trailing action
   column. AC-RSV-017/018 say "x free + y reserved"; the figures are the same, only no longer one sentence.
5. **Opening stock:** "Back to set-up" link removed (breadcrumb + Setup tab).
6. **Units are read** on the transfer page and the request page (the existing stock-units list, already loaded by the
   print page and the form): no repository, RPC or schema change, but one more existing read on those two pages.
7. **Material request form:** "already requested" is now labelled "Requested before" (Bahasa "Sudah diminta"); the
   tappable figure keeps the old wording as its accessible name.
8. **Bahasa:** transfer column "No. transfer"; reserved column "Dicadangkan" (the page's existing word).

## Needs a data change
- Breadcrumb of a material request (`Material requests › Loading…`): the shell resolves record names from lists it
  already holds; requests are not among them, so naming the request there needs a read in the shell. Left as is.

## Not done
- Material requests list on a phone opens on "Waiting for me (0)" for a site person who approves nothing; choosing the
  "All requests" tab by default for them changes behaviour, so it is only suggested here.
- Earlier-requests list rows are still "MR-009 · Approved · 3 · needed 2 Dec" text (a small table would be better).
- Stock count page: the count sheet keeps its line cards; the notice stays (a consequence statement).
- Move leftover (`/stock/work-order-transfer`) and its detail: not in this round's list.
- Stock tab bar wraps to three rows at 390 (shared `StockTabs`), so the list starts low on a phone.

## Local sample data (local database only)
Two seed steps run as Playwright scripts against the local stack and kept out of the repository: two-step transfers on;
five transfers from Central (two in transit, one received in full, one received short with one rejected, one recalled);
receiving against orders on, a purchase with three lines (two mapped to stock items) and order PO-2611-0007; a work order
on the seeded project with planned cement and rebar, a site location, a one-step approval chain, usage warnings at
80/100%, one pending and one draft request raised by the site engineer. The database was reset before the journeys.

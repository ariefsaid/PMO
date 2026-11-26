# Round 2 — stock transfers, receive-table menu column, material requests, stock home and counts

Two-step transfers WERE turned on locally (Administration → Modules → "How stock transfers are made" → Two steps, as Admin).

Branch: `ui/1126-stock-receiving` (round-2 commits on top of `origin/batch/1126-ui`, merged up to date).
Screenshots: `ux-shots/stock-receiving/before-r2/` and `after-r2/` on this branch, `<screen>-<en|id>-<width>[-full].png`.

## Sample data (local only, through the app)
Admin sent four transfers Central store → Site A store, addressed to the Site A storekeeper:
TST-2611260002 in transit (3 lines incl. 250,5 m cable, a long Bahasa note); TST-2611260003 received in full (closed);
TST-2611260004 received short (cement 27 of 30 → shortfall open); TST-2611260005 recalled with a reason.
The storekeeper counted the received ones on the transfer page.

## 1. Receive table — row-menu column (owner item 1)
**What was wrong:** the ⋯ column was a sticky cell with its own white surface and an inset rule, on a table whose rows sit
on the grey page. **Fix (shared `DataTableDesktop`):** the actions column pins to the right edge, paints its own surface and
draws its rule **only while the table scrolls sideways** (the scrollport's existing `data-dt-overflowing` marker). When all
columns fit it is an ordinary cell on the row's own surface; rows without a menu leave it empty. Checked on two other
screens: Companies (carded table — unchanged except no rule when it fits) and Stock setup.
The rule that a pinned cell is opaque is kept and its test extended to the conditional classes.

## 2. Stock transfers (owner item 2) — list, send, detail, print
**Purpose.** Receiver: count what arrived and confirm. Sender/keeper: see what is in transit, short or closed, decide shortfalls.
**Structure.**
```
Stock transfers                                         [Send stock transfer]
Transfer        From          To           Sent         Status                   Open
In transit 1
TST-…0002       Central store Site A store 26 Nov 14.39 In transit
Short, waiting for a decision 1
TST-…0004       Central store Site A store 26 Nov 14.40 Received, shortfall open 1 shortfall open
Closed 3  …
```
```
Stock transfer TST-…0002  [In transit]              [Print delivery note] [⋯ Recall]
From warehouse   To warehouse   Sent                     Receiver
Central store    Site A store   Erin Adebayo · 26 Nov 14:39   Tomas Beck
Count what arrived
Item                    Sent   Counted   Accepted   Short
CEM-50 - Cement 50kg      20   [  20 ]   [  20 ]
(line checks: short note, rejection reason, quality — only for lines that need them)
[ ] Confirm the handover in PMO now                         [Confirm receipt]
Shortfalls: reason field, then Item | Short | It arrived / Send back / Write off
Handover confirmations: Signed by | Step | Proof (+photos) | When | Recorded by
```
**Changed:** list — boxes per transfer → one table grouped in transit / short / closed (cards on phone). Detail — a box of
sentences ("In transit · Sent by … on …", "Sent 20 · counted 20 · accepted 20") → record header with status pill and
actions, a facts row, ONE lines table (inputs in the Counted/Accepted columns while receiving; Sent/Counted/Accepted/Rejected/
Shortfall after), shortfalls and handover confirmations as tables. **Recall** moved from an always-open section (reason field +
button at the bottom) to the header ⋯ menu, which opens a dialog asking for the same reason. Dates now `26 Nov 14:39`
(were `Nov 26, 2026, 02:39 PM`). Send — a boxed "Item1 / Quantity1" per line → one lines grid headed once, quantity
right-aligned with its unit. Print — already a proper table; unchanged.
On a phone the receive form is one card per line: name and sent quantity on top, Counted and Accepted side by side, the
short quantity under them, Confirm receipt in the bar above the bottom navigation.

## 3. Material requests (owner item 3)
- "already requested N" disclosure (`PriorRequests`): one sentence per earlier request → one aligned row per request
  (number, status, quantity right-aligned, needed date); "stock already sent to this work order" is its own row with its figure.
  Built as spans with grid roles because it opens inside the line's plan sentence on the request page (that sentence lives in
  `pages/MaterialRequestNew.tsx`, another owner's file).
- Approvals inbox setting (Administration → Modules): the checkbox showed no words (16px box, words only in the accessible
  name) → visible label and the whole line as its target.
- The request form itself (`pages/MaterialRequestNew.tsx`) is not in my folder: on a phone it already has 44px fields; its
  submit buttons are not in a sticky bar and the plan line is a sentence ("Plan 10 · already requested 4 · new total 7") —
  listed for that page's owner.

## 4. Stock home and counts (owner item 4)
- **Stock on hand:** the "Free and reserved" column was a sentence ("600 free + 0 reserved") with a Reserve button stacked
  under it → two right-aligned figure columns, Free and Reserved (shortfall and "show work orders" under the reserved figure).
  **Reserve moved into the row's ⋯ actions menu** (a button in every row broke the run of figures).
- **Stock count:** a boxed card per line with "System now / Difference" as label pairs under it → one count sheet headed
  once: Item | Counted | System now | Difference | remove; unit cost appears under the row only when that line needs it.
  Phone: one card per line with the figures right-aligned. Adjustments keep their form.
- **Opening balances:** template and preview are already tables; unchanged.

## 5. Partly received stays neutral (agreed).

## Measured (1440×900, same data)
| Screen | Measure | Before | After |
|---|---|---|---|
| Receive table | ⋯ column surface / rule when the table fits | white `bg-card` + 1px rule on a grey row | row surface, no rule |
| Transfers list | tables | 0 (5 boxes of text) | 1 grouped table |
| Transfer detail | quantities in their own cell | 0 (all in sentences) | every quantity |
| Transfer detail | receive inputs right edge | 625 / 1002 (two half-width fields per line) | one column each, all rows equal |
| Transfer detail | recall reason field always on screen | yes | in a dialog from the menu |
| Stock on hand | figures per reservation cell | 2 in one sentence | 1 per column |
| Stock count | per-line label pairs below the inputs | 2 per line | 0 (column headers once) |

## Journeys and gates
All seen passing on the final merged code unless stated.
- `npm run check:guards` pass · `npm run typecheck` pass · `npx eslint --max-warnings=0` on every touched file pass.
- Touched unit tests (stock on hand, count, transfer detail/send, receiving, material request new, material-request blocks, DataTable): 22 files, 217 tests pass.
- `vitest related` on my round-2 screen files: 40 files, 439 tests pass. The shared-table suite (`src/components/ui/__tests__`) plus Companies/StockSetup/StockOnHand/OrderReceiving: 1091 pass, **1 fails and is not mine**: `AC-TBL-RESIZE-002` duplicate tableId between `src/components/dashboard/AccountingSnapshotsSection.tsx` and `pages/leave/LeaveRequestList.tsx` (both from the batch). `vitest related` on `DataTableDesktop.tsx` pulls in almost the whole suite; per the project rules that full run is CI's job, so I stopped it locally.
- Serial journeys (all green after step updates): JOB-W18, JOB-W19, AC-TST-028, JOB-W6, JOB-W8, JOB-F9 (recount), JOB-F10, AC-SITE-009, AC-RSV-018, JOB-W9, JOB-W7, AC-RGO-012, AC-MRI-018, JOB-PC24, JOB-F21, JOB-F11. First run: 16 passed / 8 failed (steps reading old sentences, the "Summary" region, and **one real regression I then fixed: transfer cards on a phone were not tappable**).
- Chromium journeys (all green): JOB-F9 (receipt), JOB-F20, JOB-F11, AC-SVL-012, JOB-PU14 (site), JOB-W20, JOB-W4, JOB-W5, AC-MRQ-015, JOB-F10 (handover), AC-STK-031, JOB-W16. First run had 7 failures caused by my local two-step switch (those journeys expect one-step); after resetting the local database to the seed, 2 remained (On hand read by position; unit added) and pass after step updates.
- `scripts/ux-proof.sh` /stock /stock/transfers /stock/transfers/new /stock/new/count /stock/new/receive: min text 14px, no input under 16px, axe serious/critical 0, impeccable 0 on all. Words: /stock 23 → 20 at 1440 (base measured on a second server), transfers 18, send 14, count 19, receive 16. One fingerprint on /stock @1440 remains: "row action not centred with the item code" — **the base has the same finding** (with the old Reserve button); not introduced here.

**Journey steps updated (goals unchanged):** JOB-W18 (sent / counted / rejected read from the Lines table), JOB-W8 (Sent and Received facts name the person with day and time; "on <year>" dropped because dates within this year show no year), AC-SITE-009 (goods named inside the count form), AC-TST-028 (shortfall read on the transfer's phone card), AC-RSV-018 and JOB-W9 (Reserve opened from the row's ⋯ menu; free/reserved read from their columns), AC-SVL-012 and the shared `expectOnHand` helper (On hand read by its column header), JOB-W5 (on-site figure with unit).
**Unit tests updated:** StockTransferDetail (receiver named once in the facts; goods as the row header), MaterialRequestNew (earlier request read from its row), StockOnHand.reservations (Free/Reserved cells; Reserve from the row menu), DataTable sticky test (covers cells pinned only while scrolling). New helpers: `pmo-portal/e2e/support/tableCell.ts`.

## Owner to confirm
1. Recall a transfer: now in the record's ⋯ menu with a reason dialog (was a section with a reason field at the bottom of every in-transit transfer).
2. Transfer quantities show no unit (the transfer read carries none; adding it needs another read — not done this round).
3. Stock on hand: "Free and reserved" became two columns, "Free" and "Reserved" (the export carries both); **Reserve is now in the row's ⋯ menu**, not a button in every row.
4. Stock count: the per-line boxes became one sheet; "Remove line" sits at the row's end.
5. The transfer list's status pill repeats its group for in-transit and short rows (it distinguishes Closed from Recalled in the closed group).

## Needs a data change
- Units on transfer lines (item → unit code is not on the transfer read).
- Transfer record breadcrumb shows "Loading…": the shell resolves a detail name only for stock documents; transfers need a name lookup.

## Local environment notes
- After the journeys, my sample transfers could not be closed back to one-step mode: nine orphan transfer lines left by journey cleanups (parent transfers deleted, lines guarded against deletion) keep the server saying stock is short. I reset the local database to the seed. Worth a look by whoever owns the journey cleanups (they delete transfers but cannot delete lines).

## Not done
- `pages/MaterialRequestNew.tsx` (sticky submit, plan line as figures) — another owner's file.
- Print delivery note: unchanged (already a table).
- Stock opening balances: unchanged (template and preview are already tables).
- The receiving AFTER shots in after-r2 show the menu-column fix; the receiving sample order went away with the database reset, so later shots of it were not retaken.

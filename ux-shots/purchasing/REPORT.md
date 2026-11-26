# Purchasing screens — order-of-work round (ui/1126-purchasing)

Work branch: `ui/1126-purchasing` (from `origin/batch/1126-ui`, merged with it again before READY).
Screenshots: this branch, `ux-shots/purchasing/before/` and `ux-shots/purchasing/after/`, named
`<screen>-<en|id>-<width>[-full].png` (`-full` = the whole inner scroll pane). Widths 1440, 1024, 390.
Roles: Finance (buyer/finance officer), Engineer (requester, site person), Project Manager (approver).

## 1. Purchase record `/procurement/:id` (worst first)

**Purpose.** A buyer or finance officer follows one purchase from request to bill; a requester sees where it stands.
One question per section: *where is it and what waits on me* (header), *what and how much* (Line items),
*when and for which work* (Line planning), *which documents and money* (Files ledger).
```
┌ Header: title · status · key facts ············ [waiting note] [Record ▾] [Primary] [⋯] ┐
│ Request ── Order ── Receive ── Pay      (stage strip)                                    │
│ Money: figures · budget line                                                             │
└──────────────────────────────────────────────────────────────────────────────────────────┘
 Timeline | Line items | Quotations | Files | Details
 Line items:   [ Description | Qty | Unit price | Line total ]  Estimated total
 Line planning:[ Line | Category | Needed by | Work order | Discipline ]  [Save]   (order date in heading)
 Files:        [ Date | Type | System # | e-Faktur | Amount | Withholding | Status | File | ⋯ ]
 Details:      label/value list … Payment channel [select][Save channel]
```
**What changed and why**
- Line items tab: three blocks listed the same lines again ("Category and needed by" with headerless dashes, a separate
  "Needed by" card, "Work order per line" as a whole card holding one sentence) and touched each other (0px). Now ONE
  Line planning table, one column per fact, one Save. "Needed by" had two editors for the same line field; now one column.
- Files ledger: the Amount cell answered five questions (amount, tax basis, VAT, PPh, net, slip state, slip history).
  Amount now holds the figure + tax basis on one right edge; a Withholding column holds VAT/PPh/net and the slip.
  External ref / Group ref columns blank on every row are no longer drawn (screen rule); the explanatory sentence under the ledger is gone.
- Header: the long "Waiting for …" note sat in the action slot and crushed the title into four lines; it now wraps in a 320px slot.
- Payment channel (one value) was a full section on Timeline and again on Details; now one line of the Details list.
- The loose "2 line items" line above the table is gone (the tab carries the count).

## 2. Request form `/procurement/new`

**Purpose.** A requester raises a purchase for a work order. Same structure as the record: details → Line items → Line planning.
```
 Procurement details (fields) │ Line items [add row] │ Line planning [Line|Category|Needed by|Work order|Discipline] │ [Cancel][Save draft]
```
- The form listed the lines twice more ("Work order per line", "Category and needed by"); now the same `LinePlanTable` as the record.

## 3. Progress certificates `/subcontract-certificates` and `/:id`

**Purpose.** Finance prepares, approves and bills a subcontractor's monthly certificate. Record: *what is certified and payable*, then the evidence tables.
```
 Procurement › Progress certificates
 ┌ Vendor · Mar 2026 [Billed] ······················ [One filled action] [⋯ Prepare acceptance / Print / Cancel] ┐
 │ Certified work | Backcharges | Payable                                                                        │
 └───────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
 Measured work [Item|Measured|Rate|Amount]   Measured days   Left out [Item|Day|Measured|Why]   Backcharges [Reason|Amount|Remove]
```
- Header showed up to seven buttons; now one filled action for the state (Submit / Return+Approve / Create bill / Open bill) and a menu.
- Top bar said "Not found" (no place in the route map); now Procurement › Progress certificates, and the rail lights Procurement.
- "Open bill" pointed at a non-existent `ledger` tab and landed on Timeline; it opens Files (where the bill is).
- Backcharges were a free list with floating amounts; now a table with a money column. Tables run edge to edge (were a card in a card).
- List: the status filter was a 320px form field with its label above; now a compact toolbar control. A filtered-empty list says
  "No certificates in this status" with "Show all", not "No certificates yet". Bill date uses the shared date field.

## 4. Site cash record `/imprest/:id` — Open purchase requests

**Purpose.** The custodian/approver sees what is about to be bought before planning the month's cash.
```
 Open purchase requests                                    [Start the plan from these]
 [ Request (number, title, lines)      | Work order | Status | Amount (total, then line amounts) ]
   ▸ Materials (group row) …   ▸ No purpose set …
```
- Was nested headings (purpose, then work order), the request number beside the same title repeated, amounts with no column.
  Now one table grouped by purpose; each request's lines under its name with their amounts on the same right edge.

## 5. Expense claims, lists (reviewed, not recomposed)
Expense record: the new work order/discipline block is a small two-fact section with its own Change action; left as is.
Procurement / site cash / expenses lists: reviewed at three widths in both languages; findings below.

## Measured edges (1440 unless noted; base = `origin/batch/1126-ui`, after = this branch)

| What | Before | After |
|---|---|---|
| Record title box (ordered purchase, long waiting note) | 140 × 129 px (4 lines) | 373 × 32 px (1 line) |
| Line items tab: per-line lists without column headers | 1 (plus a headerless dash grid) | 0 |
| Line items tab: tables | 1 | 2 (money, planning) |
| Gap Category card → Work order card | 0 px (touching) | merged; panel gap 32 px |
| Ledger bill row height | 141 px | 79 px |
| Ledger Amount: figure right vs header right | 977 vs 1080 (103 px short) | 849 vs 865 (= the 16 px cell inset) |
| Ledger columns | 10 (3 blank on every row) | 9 (Withholding added, 2 blank ones dropped) |
| Phone ledger card: value left edge | Amount right-aligned, tax basis and slip on two other edges | all values on x=149 (pills 157, icon button 167) |
| Certificate header visible controls (billed) | Open bill + Print (up to 7 in draft) | Open bill + ⋯ (one filled action in every state) |
| Certificate top bar | "Not found" | Procurement › Progress certificates |
| Certificate: nested cards (impeccable detect) | 4 findings | 0 |
| Open requests: column headers / amount right edge | none / 1391 | Request·Work order·Status·Amount / 1375 = header 1391 − 16 inset |
| Record word count (ux-proof, ordered / invoiced) | 115 / 79 | 111 / 75 |

## Skill lines applied
- restructure: "Freeze the feature floor before any edit; simplification cannot silently remove a figure, capability or safeguard." Every value and action kept a named home (list below).
- restructure (compose): "Compose the whole screen before polishing its cards; a better card can still leave an accidental dashboard." The record's Line items tab and the form were recomposed as money table + planning table, not card fixes.
- impeccable craft floor: "Cards are the lazy container; nested cards are always wrong." Certificate tables now run edge to edge.
- taste app-screens §7.4: "Two measures stack in one cell rather than taking two columns … both lines on one right edge." Open-request totals and line amounts; ledger amount + tax basis.
- taste app-screens §7.8: "When a row needs doing … its action is a visible ghost button … in one fixed trailing column." Backcharge Remove.
- screen rules: "Record pages: one header (title 20px+, status pill, key facts row, one filled primary action, the rest in a menu)." Certificate header.
- screen rules: "A column that is blank on every row is not rendered." / "No section for one value." / "Date inputs: one DateField everywhere." Ledger refs, payment channel, needed-by and bill date.

## Journeys and gates (all run on the final commit unless noted)
- `npm run check:guards` pass · `npm run typecheck` pass · `npx eslint --max-warnings=0` on the 23 touched .ts/.tsx files pass.
- `npx vitest related --run` (13 changed source files): 188 files, 2245 tests pass.
- Unrelated red seen once in a wider run: `src/lib/i18n` "keeps faktur for the tax invoice only" flags `workOrders.json billing.invoicesTitle` — a file not touched here, already red on the integration branch.
- Journeys (E2E_WORKERS=1): 40 selected from `affected-e2e` (it lists 464 because the shell route map changed):
  chromium AC-816, AC-1200, AC-APR-040, AC-BUPOT-020, AC-EPS-006, AC-EXP-070, AC-IMP-090, AC-LRC-005, AC-PAGE-030, AC-PCH-001,
  AC-PFE-001, AC-PFR-001, AC-PR-020, AC-PR-026, AC-PROC-001, AC-SCA-001, AC-SCV-009, AC-SPC-020, AC-STK-035, AC-WPL-012,
  JOB-PU2, JOB-PU21, JOB-PU22, JOB-PU23, JOB-PU10-cash-advance, JOB-T2, layout/procurement-files, layout/procurement,
  m365-procurement-reference-ui, procurement-currency-position; serial AC-PLP-009, JOB-PU3 (both), AC-HP-001, JOB-PU6, JOB-PU7 (both),
  AC-TWM-024, JOB-PU9, AC-VPAY-001. Result: all pass (106 tests incl. setup). JOB-PU6 failed once on the moved payment channel; step updated, re-run green.
  AC-SPC-020 + AC-SCA-001 re-run after the last commit: 12 passed.
- Journey steps updated (goals unchanged): AC-WPL-012, JOB-PU2 (test ids `line-plan-section`/`line-plan-panel`, rows not list items);
  AC-PLP-009 (needed-by textbox by role; value reads "31 Dec 2026"); JOB-PU3-purchase-needed-by-date (panel id, help words, date reads day + month);
  JOB-PU6 (opens Details before the payment channel).
- Unit tests replaced: LinePlanningPanel, OrderNeededByPanel, LineWorkOrdersPanel, LineWorkOrdersSection tests → LinePlanPanel.test + LinePlanTable.test (same behaviours: saves only changed lines, grouped writes, retries, read-only, refusals, cancelled work order).
  Certificate test: Prepare acceptance asserted in the menu; bill date reads as a date; Open bill href /files. Open-requests test asserts rows, not containers.
- `scripts/ux-proof.sh` (11 routes): exit 1 on the base branch and on this branch. Mine removed the Payment-channel gap finding and the certificate nested-card,
  left-edge and 32px findings; remaining ones are listed under "Not done".

## Owner to confirm
- Payment channel: no longer on Timeline; one line in Details (it was on both). Before/after: `rec-invoiced-timeline-*`, `rec-invoiced-details-*`.
- Needed by: one column (the line date); the order date sits in the Line planning heading with a 6-word help "Required to send the order. Fills every line." (was a sentence).
- Line planning Save is always enabled (the old "Change a line's work order to save." hint and the disabled state are gone).
- "This line is for a different work order" note shortened to "Not the request's WO-2".
- Ledger: External ref / Group ref columns appear only when some record carries one; the line "Every record appears once, chronological…" removed.
- Certificate: Prepare acceptance, Print and Cancel certificate moved into the ⋯ menu. Open bill now opens the purchase's Files tab.
- The "N line items" line above the line table removed (count stays on the tab).

## Needs a data change
- Rate card "Contract item" shows the first 8 characters of an id: rate lines carry only the item id; the read needs the item code/description.
- Certificate list pages with Newer/Older: the rules want numbered pages and "Showing a–b of n"; the read returns no total.

## Not done (and why)
- Three-way match drawer and bill/receipt line editors (BillMatchDrawer, MatchLinesEditor): need the organisation's match setting on and a held bill; not rendered or recomposed this round.
- PlanSeedEditor, RequesterRouteNote (site cash): text lines; not recomposed.
- Shared: phone list row checkboxes are under 44px (31–37 on /procurement at 390); a section heading over an edge-to-edge table measures 31px (want 12–16) on the certificate and site-cash Limit tables; first-tab 0px inset flagged on /subcontract-certificates (shared Tabs default, same as /procurement). Other owners share these components, so not changed here.
- Timeline → "Purchase order" print section measures a 20px gap; that section repeats the header menu's Print action but carries the "printing is off" notice, so it stays.
- Word budget: /imprest 9 vs 5 and /expenses 12 vs 8 come from the "Showing a–b of n" line the rules require (added after the budget); not cut.
- /expenses/new: 119px gap on phone and a 29px uneven row (the approval helper under Budget category); fields predate the redesign.
- Local sample data: the certificate and "Line planning journey" purchases were created by the journeys AC-SPC-020 and AC-PLP-009 on the local database; nothing was created by hand.

# Stock, receiving, transfers, material requests — screen-owner report (round 1126)

Branch with the work: `ui/1126-stock-receiving` (15 commits on `origin/batch/1126-ui`, merged up to date).
Screenshots: this branch, `ux-shots/stock-receiving/{before,after}/` — `<screen>-<en|id>-<width>[-full].png`
(`-full` = the whole inner scroll pane). BEFORE = `origin/batch/1126-ui` served on its own dev server; AFTER = the work
branch; same local database, same records, same logins.

## 1. Receive against an order (`/stock/new/receive?order=…`) — worst screen, done first

**Purpose.** A storekeeper counts what arrived against a purchase order and records it; purchasing reads what is still
to come and maps order lines to stock items. One question: *what did I count for each line of this order?*

**Structure.** Order / warehouse / date in one row → ONE table, a row per order line → record button → receipts on record.
The org-wide switch is a setting, so it moved to the header's action slot. Clearing a mapping is a secondary action, so it
moved to the row's ⋯ menu.

```
Receive against order                              [x] Receive goods against orders
[Purchase order v] [Warehouse v] [Receipt date]
Item                          Ordered  Received  Outstanding  Status          Counted
Cement 50kg Portland …          200 bag   180 bag     20 bag  Partly received  [____] bag  ⋯
  [CEM-50 - Cement 50kg v]   (purchasing only: picker under the line name)
Site signage boards               6         0          6     Not received          —
  Service or direct use: use the existing receipt path.
                                                                         [Record receipt]
Quality check (only when a counted line needs one)
Receipts
26 Nov  ·  Receipt posted   Open stock movement  [Reverse receipt]
  Cement 50kg …                                   180 bag
```
Storekeeper (blind) sees only Item and Counted. Phone: each line is a card, figures right-aligned, the record button
stays in a bar above the bottom navigation.

**What changed and why.** Before, every line was listed twice (once with a mapping picker, once with a full-width input
below), and ordered / received / outstanding sat inside a sentence ("Ordered 200 · Received 0 · Outstanding 200") — the
owner's "not even a table". Now: one table, one figure per cell, figures right-aligned with the unit as a grey suffix,
the count input in its own column on one right edge, receipts grouped by day with status, the date (was not shown) and
their actions, the rejected quantity and reason in their own column.
The same columns replace the sentence list on the purchase record's "Goods received" block (`OrderReceivingProgress`).

## 2. Work order — "Stock for this work order" block (`WorkOrderStockBalance`)
Purpose: what material is held / issued for this work order. The table already existed but its two value columns ran
186px past the record's right edge (clipped) and only "On site" carried a unit. Now every quantity carries its unit,
columns fit the width, the block turns into cards when its container is under 900px, the "move leftover" link sits on
the table's left inset. The two warnings above it ("issued ahead of progress", "installed past the usage warning") were a
sentence per item; now a row per item with the figures in columns (issued share, points ahead; installed, planned,
warning %). The shared fact (work-order progress, threshold) is stated once above the rows.

## 3. Material completion print (`/work-orders/:id/material-completion`)
Totals per unit were a second table whose columns did not line up with the lines above. They are now footer rows of the
same table (shared `PrintTable` gained an optional `footer`), so each total sits under the figures it sums; the value
total is one footer row under the two value columns.

## 4. Smaller fixes
- **Stock at risk:** "5 5 above cover" printed the count twice → "5 above cover".
- **Breadcrumb:** `/stock/at-risk`, `/stock/opening`, `/stock/usage-standards` showed "Loading…" → their page names (shared `routeMatch.ts`).
- **Move leftover between work orders, Usage standards:** the sentence explaining the page moved into the page's one help (?) control; it states a consequence (credited/charged; stock stays put), so it is kept, not cut.
- **Stock setup:** three setting buttons stacked on three lines → one row; an opened panel takes the full width under it.

## Measured edges (1440×900, same data)

| Screen | Measure | Before | After |
|---|---|---|---|
| Receive (purchaser) | right x of Ordered / Received / Outstanding figures | none (inside a sentence) | 669 / 791 / 912, every row equal |
| Receive | count inputs left..right | 248..1416 (full width, one per line, below the list) | 1213..1309, every row equal |
| Receive | times each line appears | 2 (mapping list + count list) | 1 |
| Receive | tables | 0 | 2 (lines, receipts) |
| Receipts | right x of received figures | none (list item text) | 1400, every row equal |
| WO stock block | rightmost painted x vs container right (1416) | 1618 (202px past, value columns clipped) | 1416 |
| WO stock block | quantities with a unit | 1 of 4 columns | 4 of 4 |
| Material completion | totals columns under the lines' columns | no (separate table, own widths) | yes (footer rows of the same table) |
| Receive @1024 | count column on screen without sideways scroll | n/a | yes (picker under the line name; status column from 1280) |

Words per route (`scripts/ux-proof.sh`, before → after): receive 16→16; at-risk 26→25 (390: 21→20); usage-standards
34→15 (390: 45→26); move-leftover 51→22; setup 17→17; opening 19→19; transfers 18→18. Min text 14px everywhere, no
input under 16px, axe serious/critical 0, impeccable findings 0 on every route.

## Skill lines applied
- **restructure:** "Freeze the feature floor before any edit; simplification cannot silently remove a figure, capability or safeguard." — every figure kept a home (table below); the receiving switch and clear-mapping moved, not removed.
- **restructure:** "Render restricted roles as well as the top role" — storekeeper (blind count) and purchaser both rendered; the blind rule is untouched (purchasing-only columns).
- **taste (app-screens):** "Tables are rules and alignment. No zebra striping, no header bands, numbers right-aligned." and "units as smaller grey suffixes, tabular figures, right alignment in columns" — every quantity in my screens.
- **impeccable (distill):** "Remove redundancy: If it's said elsewhere, don't repeat it here" — lines listed once; progress stated once above the warning rows.
- **impeccable (clarify):** "Say each idea once. If the heading already explains the state, the introduction should add new information or disappear." — page intros moved into help.
- **screen-rules:** "One table when the data is rows; one figure per cell" (brief) and "Setup actions are actions, not columns" — switch to header, clear-mapping to row menu.

## Journeys and gates (all seen passing on the final code)
- `npm run check:guards` pass · `npm run typecheck` pass · `npx eslint --max-warnings=0` on all touched files pass.
- Touched unit tests: 5 files, 23 tests pass. `npx vitest related --run` on the 15 changed source files: 210 files, 2740 tests pass.
- Chromium journeys (29 tests incl. setup): AC-MIP-016, AC-CUS-015, JOB-1122-10, JOB-W16, AC-SSW-001, AC-SVL-012, JOB-PU16, JOB-PU14 (site), JOB-PU12, JOB-F9, JOB-M5, JOB-PC23, JOB-W20, AC-SAR-305, JOB-PC7, AC-STK-001, AC-STK-031, JOB-W10, layout/stock-long-code — first run 26 passed / 3 failed (steps that read the old sentence or a bare figure); after the step updates all pass.
- Serial journeys: AC-RGO-012, JOB-PU14 (order), AC-OSH-014, AC-UW-012, AC-WOT-018, AC-TST-028, JOB-PU7 over-receipt, AC-WCO-040, JOB-F21, JOB-PC24, AC-MRI-018 — 19 passed / 2 failed first run (same cause); after the step updates both pass.
- `affected-e2e.mjs` selects 460 specs because `routeMatch.ts` is shell-wide; I ran the 32 that open my screens (cap 40).
- `scripts/ux-proof.sh` on my 7 routes: 3 layout fingerprints reported (usage-standards empty-table panel-void; setup first-tab 0px left padding at 1440 and 390). **All three are identical on the base branch** (measured on a second dev server) — pre-existing, not introduced. The R3 tab-bar warnings (stock tab bar at a different y on setup/opening/usage) are also pre-existing.

**Journey steps updated (goal unchanged):**
- `serial/JOB-PU14-order-receiving-outstanding`: purchaser reads Ordered 40 / Received 37 / Outstanding 3 from the order line's cells, not one sentence.
- `serial/AC-RGO-012-storekeeper-order-receipt`: same, on the receiving page.
- `serial/AC-UW-012-installed-usage-warning`: installed 85 / planned 100 / 80% from the warning row.
- `AC-MIP-016`, `JOB-M5`: item row shows the issued % and points ahead; progress read once; the existing item-row step scoped to the stock table (there are now two tables).
- `JOB-W10`: on-site cell reads `4 <unit>` (unit added) → asserts the figure `^4\b`.
**Unit tests replaced (pinned the sentence):** OrderReceiving "gives purchasing progress…" and "a receipt on record shows what was rejected…", OrderReceivingProgress "shows purchasing the exact order progress…", the two banner tests, the material-completion "Totals region" check — each now reads the figure from its cell (new `src/test/tableCell.ts`).

## Owner to confirm
1. **Receiving switch moved** from a band above the form to the header's right slot (same checkbox, same confirm dialog). Crop: `before/receive-purchaser-en-1440.png` vs `after/receive-purchaser-en-1440.png` (top).
2. **"Use service or direct-use path" moved** from a link under every mapped line to that line's ⋯ menu.
3. **Stock-item picker** is under the order line's name instead of a separate column (so the count fits at 1024).
4. **Status column hidden below 1280px** on the receiving table (the three figures carry the same fact; full status at wide screens and on phone cards).
5. **Partly received is neutral grey**, not amber (screen rules: colour only for exceptions); fully received is green.
6. **Material completion:** the separate "Totals" table is gone; totals are footer rows labelled "Totals", value total labelled "Total value".
7. **Two page intros** (move leftover, usage standards) are now behind the page's ? help.

## Needs a data change
None needed for what I changed.

## Not done (next)
- **Stock transfers list / send / detail / print** (`StockTransferDetail` 210 lines, the largest new screen): two-step transfers are off in the local seed, so only the "off" empty state rendered; not recomposed.
- **Work order page frame:** the stock block's heading/frame lives in `pages/WorkOrderDetail.tsx` (another owner's file): it sits unframed between cards with a small heading. One-line fix for that owner: wrap it in the same card as its siblings.
- **Material requests sub-blocks** (`PriorRequests`, `ApproverInboxSetting`, `UsageThresholdsEditor`, `UsageInstalledSourceEditor`, `UsageWarning`) and the stock opening-history page: rendered only partly, not recomposed.
- On-hand / documents / ledger / count / setup's tab padding: untouched beyond the setting row.
- English shot of the purchase "Goods received" crop (the Items tab locator did not match in English; Bahasa set captured).

## Local sample data created (local DB only)
Receiving switch on (left OFF again before the chromium lane and turned on for shots); 2 stock items `INV-50`, `CB-16`;
3 purchase lines and 4 stock mappings on the seeded order PO-2510100001; 1 receipt as the Site A storekeeper (cement 180,
cable 1.250,5) through the app; work order `WO-2611-0042` + one work item (SQL, the seed has no work orders) and 3 issues to
it from Central through the app's Issue form as Admin.

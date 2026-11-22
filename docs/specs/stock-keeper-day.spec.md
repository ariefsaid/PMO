# The storekeeper's day (SKD)

Issue #1122, branch `fix/walk-stock`. Status: **partly built**; the open items are listed in section 4. Money path: stock postings. Ships alone.
IDs: `FR-SKD-###`, `AC-SKD-###`. Builds on `stock-two-step-transfer.spec.md` (FR-TST), `stock-site-work.spec.md` and `stock-work-order-transfer.spec.md`.

**Job story.** When I keep a central warehouse and a site store on my phone, I want to receive, move, count and correct stock without
hunting for the action or guessing a rule, so the books match the shelf.

## 1. Requirements (EARS)
- FR-SKD-001 When a transfer is sent to a named receiver, the receiver's home shall list "a delivery for you" with a link that opens the transfer (every account type).
- FR-SKD-002 While a person sent a transfer they shall not be shown its receive form; only an Admin may count their own shipment (the database refuses everyone else, FR-TST-024).
- FR-SKD-003 The receiver picker shall offer only active keepers of the chosen destination and field accounts, never the sender.
- FR-SKD-004 When a receipt is entered for an item whose tag is zero-cost (client-supplied), the form shall mark the line with the tag name and post cost zero without asking for it.
- FR-SKD-005 Before a receipt, transfer, issue or return posts, the form shall ask once, naming each item with its quantity and the location.
- FR-SKD-006 The stock home shall lead with "Receive goods"; the other movements sit in its menu. Section tabs shall wrap on a phone.
- FR-SKD-007 The settings entry shall be named for the jobs it holds; refusing to switch two-step off while transfers are in transit shall say how many.
- FR-SKD-008 Where transfers between work orders are on, the stock home menu and the work order's stock shall offer a visible start.
- FR-SKD-009 A transfer shall offer "Print delivery note" when delivery notes are on; when they are off the print page says so.
- FR-SKD-010 A role that cannot set reorder levels shall be told so in the panel and pointed to "Request purchase" on the list row.
- FR-SKD-011 The item form shall set the consumable flag.
- FR-SKD-012 A new count shall say, before saving, that a Project Manager posts any difference.

## 2. Acceptance criteria
Each is owned by one Vitest file (lowest sufficient layer, ADR-0010); the title carries `JOB-1122-<n>`.
- AC-SKD-001 `MyHome.test.tsx`, `DeliveriesSection.test.tsx`, `myHome.test.ts` (FR-SKD-001).
- AC-SKD-002 `StockTransferDetail.test.tsx`; the self-receive rule itself: `1306_stock_two_step_transfer.test.sql` (mut:self_receive).
- AC-SKD-003 `stockReceivers.test.ts`, `StockTransferSend.test.tsx`.
- AC-SKD-004 `StockMovementForm.test.tsx`. AC-SKD-005 same file, plus the updated posting journeys.
- AC-SKD-006 `StockOnHand.test.tsx`. AC-SKD-007 `StockTransferSettings.test.tsx`. AC-SKD-008 `WorkOrderStockBalance.test.tsx`.
- AC-SKD-009 `StockTransferDetail.test.tsx`, `StockTransferPrint.test.tsx`. AC-SKD-010 `StockReorder.test.tsx`.
- AC-SKD-011 `StockSetup.floor.test.tsx`. AC-SKD-012 `StockCount.test.tsx`.

## 3. Findings where the walker was partly wrong
- The phone home already had a deliveries section; it was fed by a stub that always returned an empty list, and full accounts' home had no section at all.
- The delivery-note action already exists on an approved request, behind the organisation's delivery-note switch (default off).
- The "waiting for paper" list exists on the stock home but shows only while an organisation lets proof follow the posting.
- Reorder worklist already offers "Request purchase" to a keeper; the panel under it was what confused.
- The count form already said who posts, but only after a variance was typed, beside the button.

## 4. Not built in this lane (open)
Correct-a-posted-document action (reversal with who and why), cost taken from the purchase / filled later by a costing role,
client-material tag on the list, ledger and document screens, per-work-order client balances beyond the existing panel,
the one-tap item request to the Admin from the receive form, the "waiting for paper" list shown regardless of timing setting,
and the browser journeys. See the report.

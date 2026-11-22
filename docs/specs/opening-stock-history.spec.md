# Opening stock with movement history (gap-material, item opening-stock-history)

Size M. Extends `docs/specs/opening-balances.spec.md` (FR-OPB-006, AC-OPB-006) and `docs/specs/stock-site-work.spec.md` (FR-SSW-010..015, the zero-cost tag).
Every stock-ledger change ships alone (OD-SCOPE-5).

## Job story

When an organisation starts on PMO, I want the opening load to carry each item's stock movements from the start, including the in-and-out
history of client-supplied material, so that the ledger tells how today's balance came about, not only what it is. Client-supplied material stays at zero cost.

## Today (verified in code, 2026-11-22)

- Ledger: `stock_documents` / `stock_document_lines` / `stock_ledger` (append-only) / `stock_balances` (0413). The only writer of ledger and balance is
  `stock_write_entry` (0413:252). Balance = running sum; negative balance refused (`STK_INSUFFICIENT`). Out value = moving average. Posted rows are immutable (`guard_stock_*`, 0413:122-150).
  Proofs: `supabase/tests/stock_ledger_invariant.test.sql` (ledger sums = balance rows, AC-STK-004), `stock_immutability_idempotency.test.sql`.
  Document idempotency: unique `(org_id, created_by, client_request_id)` (0413).
- Opening load exists: `load_stock_opening(warehouse, as_of, lines, note)` (1046:192), Admin only (`opening_assert_load`, 1046:110), reachable from the `pmo rpc` command line (1047).
  It takes **counted balances only** (quantity + unit cost per item, one document of kind `opening`), per location, **once**, only **before the location's first movement**
  (`opening_location_has_movement`), one go-live date per organisation, no re-submit key, no preview, **no screen and no data-access function** in `pmo-portal/` (only generated types).
  Reverse: `reverse_opening_balance` (1046:233) while nothing real has moved. Report: `opening_balance_report`.
- Client-supplied material: a stock tag flagged `zero_cost` (1029). A trigger on document lines (`guard_stock_line_zero_cost`, 1029:153) **refuses** a non-zero `unit_cost` for such an item (`STK_ZERO_COST`);
  receipts then carry value 0, and every later out/transfer of it carries 0. The tag cannot change once the item has movements.
- Gap, therefore: no way to load dated in-and-out history; the balance-only opening cannot show how a client-supplied item arrived and left.
- Existing import wizard (ADR-0027; descriptors in `pmo-portal/src/lib/import/`, e.g. `stockItemDescriptor.ts`) with preview, row errors and template; cap `MAX_IMPORT_ROWS` 500, a descriptor may set `maxRows`.

## Scope

- In: ONE template of dated movements (in and out) per item and location, loaded as the location's opening through the ledger's own writer; preview; atomic confirm; invariant proof.
- Out: any other "all history" format; movements that name a project or work order (history carries no project cost, so project totals do not move, cf. FR-SSW-015);
  transfers between locations as a movement kind (load each side as in/out, or load the balance at the receiving location); editing a loaded history (reverse and reload instead);
  work-order or billing history (unchanged, FR-OPB-003..005).

## The one template (visible on the screen, downloadable as a file, Bahasa headers accepted as aliases)

One row = one movement. Header row, then rows. Rows are applied in date order, ties in file order.

| Column | Required | Meaning |
|---|---|---|
| `date` | yes | Day of the movement, ISO `YYYY-MM-DD`. Not after the go-live date, not in the future. |
| `location` | yes | Code of an existing, active stock location. |
| `item` | yes | Code of an existing, active stock item. |
| `direction` | yes | `in` (received, returned, found) or `out` (issued, used, returned to supplier). |
| `quantity` | yes | Greater than 0, up to 3 decimals; whole numbers only for whole-unit items. |
| `unit_cost` | in: cost items yes; client-supplied items blank or 0 | Cost per unit for an `in` row. Ignored (blank) on `out` rows: out is priced at the moving average. |
| `reference` | no | Delivery note, site report or other paper number (max 100 characters). |

Plus, on the screen (not in the file): the go-live date (as of), and an optional note.

## Requirements (EARS)

- FR-OSH-001 Only an active Admin shall preview or confirm an opening history (the rule `load_stock_opening` already applies via `opening_assert_load`). Stock-manager level is not enough: it moves the whole organisation's start point.
- FR-OSH-002 The preview shall run the same validation and the same running-balance calculation as the confirm, in one database function, and write nothing.
  It shall return per row an accepted/refused verdict with a refusal code, and per item and location the closing quantity and value.
- FR-OSH-003 When any row is refused, confirm shall refuse the whole file and post nothing. When the file is accepted, confirm shall post it as one transaction: one `opening` document per location,
  every line written through `stock_write_entry` (the only writer; no second write path), each ledger row dated at its row's `date`.
- FR-OSH-004 Where an `in` row names a client-supplied (zero-cost) item, the database shall store unit cost 0 (blank means 0) and refuse a non-zero cost (`STK_ZERO_COST`, rule of 1029 unchanged).
  Where an `in` row names a cost item without a unit cost, confirm shall refuse the row.
- FR-OSH-005 An `out` row shall be refused when it would take that item below zero at that location on its date (running balance, rows in date order); an `out` row is valued at the moving average, so a client-supplied item's out value is 0.
- FR-OSH-006 Confirm shall be idempotent: the screen sends one request id per file; re-submitting the same id shall return the opening records already created and post nothing again.
- FR-OSH-007 Confirm shall keep the existing opening rules: one live opening per location, only before the location's first real movement, one go-live date per organisation, the `stock` feature on.
- FR-OSH-008 After confirm, for every item and location the `stock_balances` row shall equal the sum of its ledger rows (quantity and value), and the last row's running balance shall equal that sum.
- FR-OSH-009 An opening history shall be reversible with the existing reverse, under its existing conditions (nothing real has moved since); the reversal nets every item to zero. Load and reverse are audited (`opening_balance.load`, `opening_balance.reverse`).
- FR-OSH-010 The file shall have 1 to 5000 rows. A larger load is split by location.
- FR-OSH-011 Every refusal shall be a coded sentence in English and Bahasa Indonesia that says what to do next, in `refusals.ts` locale files.
- FR-OSH-012 The balance-only `load_stock_opening` shall post through the same shared routine as the history load (one posting path), with unchanged behaviour.
- FR-OSH-013 Imported lines shall expose no unit cost to non-cost roles (line cost columns stay ungranted, 0413 rule).

## Screen (restructure; tokens only; shared primitives)

Stock set-up > "Opening stock" section, visible to Admin only (others see nothing; a link in the empty state says "An Admin loads the opening stock").
Steps on one page: (1) go-live date, (2) template card showing the seven columns with example row and a "Download template" button, (3) upload, (4) preview table
(row verdicts with plain-sentence refusals, then closing balance per item and location, with "cost" hidden for client-supplied items showing "client-supplied"), (5) Confirm, disabled with the reason beside it
("Fix the N refused rows first") until the preview is clean. Empty state: "No opening stock loaded yet. An Admin loads it here." EN and ID. Checked at 390 px and 1440 px.

## Acceptance criteria

| AC | Given / When / Then | Layer |
|---|---|---|
| AC-OSH-001 | Given a Finance or Project Manager member, when they preview or confirm, then refused; another organisation's Admin cannot use this organisation's locations or items. | pgTAP |
| AC-OSH-002 | Given a valid file, when previewed, then nothing is written (ledger, balances, documents unchanged) and closing balances equal the hand sum. | pgTAP |
| AC-OSH-003 | Given a file with one refused row, when confirmed, then refused and nothing posts; the preview named the same row and code. | pgTAP |
| AC-OSH-004 | Given a client-supplied item received 10, issued 4, then received 2 at blank cost, when confirmed, then three ledger rows, all value 0, balance 8 at value 0; a non-zero cost row is refused. | pgTAP (mutation: drop the zero-cost rule, red) |
| AC-OSH-005 | Given a cost item in 10 at 5.00, out 4, when confirmed, then out value 20.00 and balance 6 at 30.00. | pgTAP |
| AC-OSH-006 | Given an out row dated before the stock came in, or larger than the running balance, then refused naming the row. | pgTAP |
| AC-OSH-007 | Given a row dated after go-live or in the future, then refused. | pgTAP |
| AC-OSH-008 | Given the same request id submitted twice, then the second returns the same openings and the ledger row count is unchanged. | pgTAP |
| AC-OSH-009 | Given a loaded history, then for every item and location balance = sum of ledger rows (qty and value) and each row's running balance equals the cumulative sum up to it (the AC-STK-004 query, extended to `opening` rows). | pgTAP (invariant) |
| AC-OSH-010 | Given a location that already moved, or already has a live opening, then refused. | pgTAP |
| AC-OSH-011 | Given a loaded history with nothing moved since, when reversed, then every item's balance is 0 and the opening is marked reversed; audit rows exist. | pgTAP |
| AC-OSH-012 | Given ledger-writing code, then `stock_write_entry` is still the only function that inserts into `stock_ledger` (single-writer guard) and the new functions call it. | existing guard `scripts/stock-single-writer.test.mjs` |
| AC-OSH-013 | Given the descriptor, then the header aliases (EN and ID), the date, direction and quantity rules produce the row sentences before any call. | Vitest |
| AC-OSH-014 | Given an Admin on the screen, when they upload a file with a refused row, then Confirm is disabled and says why; with a clean file, Confirm posts once and the screen shows the result and a link to the stock ledger. | Vitest + one e2e journey |
| AC-OSH-015 | Given every new refusal code, then EN and ID sentences exist and say what to do next. | Vitest (`check-refusal-codes`) |

## Refusal codes (family OPN)

`OPN_NOT_ADMIN`, `OPN_ROW_INVALID`, `OPN_UNKNOWN_ITEM`, `OPN_UNKNOWN_LOCATION`, `OPN_COST_NEEDED`, `OPN_OVER_ISSUE`, `OPN_DATE_AFTER_GO_LIVE`, `OPN_LOCATION_MOVED`, `OPN_ALREADY_LOADED`, `OPN_TOO_MANY_ROWS`.
Zero-cost breach reuses `STK_ZERO_COST`. Sentences (EN / ID) are authored in the build, each ending with the next step.

## Open questions for the customer

See the build report; they are recorded with recommended answers in `docs/plans/2026-11-22-opening-stock-history.md` section 6.

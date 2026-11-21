# Vendor stock location: material sent out to an outside vendor and back (SVL)

Issue #2683 (map #2516). Status: **Accepted, 2026-11-21**. Plan `docs/plans/2026-11-21-stock-vendor-location.md`.
IDs: `FR-SVL-###`, `AC-SVL-###`. **Money path: stock ledger** (transfers); the ledger stays written only by
`stock_write_entry`. Head of a stacked chain: the two-step transfer (#2690), work-order-to-work-order transfer (#2691),
reservations (#2693) and the daily-report stock issue (#2676) build on this branch.

**Job story.** When material goes to an outside vendor for a process and returns, I want it to stay on record at the vendor,
so I know where it is.

## 1. AS-IS
- `stock_warehouses.kind in ('central','site','yard','staging')` (0412, widened by 1029). Locations are client data
  (Setup, import). A transfer posts two ledger rows (out at source, in at destination) through `stock_write_entry`, value
  carried at the source's moving average (`stock_apply_transfer`, 0413).
- Today an organisation that sends material out has to stand a vendor in for a `site` location, which needs a project and
  which the work-order balance (1031) then counts as a project location.
- The on-hand RPC `get_stock_on_hand` already returns `warehouse_kind` per row; the reorder suggestion
  `get_reorder_suggestions` (0418) treats any transfer out that does not land in a `central` location as usage.
- A work order is named only on an issue or return (the document's project) or on a transfer into a `site`, `yard` or
  `staging` location of that project (1029 §1, 1101).
- `companies.type = 'Vendor'` is the vendor master (0001).

## 2. Requirements (EARS)

**The kind**
- FR-SVL-001 `stock_warehouses.kind` shall also allow `vendor`: a location held at an outside vendor. Existing kinds and rows
  are unchanged (FR-SSW-003).
- FR-SVL-002 A vendor location may link to one vendor company (`vendor_company_id`, optional). The link shall name a company of
  the same organisation whose type is Vendor; any other company, or another organisation's, is refused in the database.
- FR-SVL-003 A vendor location shall have no project: material at a vendor is not held by a project, and one vendor location
  serves every project. The rule is a table check, so import and API writes meet it.
- FR-SVL-004 Only a vendor location carries `vendor_company_id`.
- FR-SVL-005 Admin and stock master writers create, rename, archive and delete vendor locations exactly as other locations
  (no new grant, no new policy); the new column is added to the existing insert and update column grants.

**Moving material out and back**
- FR-SVL-010 A transfer to a vendor location and a transfer from a vendor location shall post through the existing transfer
  engine unchanged: two ledger rows, value carried, the per-item per-location negative-stock rule applies at the vendor too
  (a vendor cannot send back more than it holds).
- FR-SVL-011 A vendor location shall take only transfers, adjustments and counts. A receive, an issue or a return naming a
  vendor location is refused in the database (`STK_VENDOR_LOCATION`): material is received from a supplier into a
  warehouse, and is consumed from a project location, never at a vendor.
- FR-SVL-012 A transfer to a vendor location shall not name a work order (the vendor holds no project; the 1029 rule already
  refuses it). A transfer from a vendor location back to a `site`, `yard` or `staging` location is an ordinary transfer and may
  name the work order of that destination's project.
- FR-SVL-013 A location that already has receive, issue or return documents shall not change kind to `vendor` (`STK_VENDOR_LOCATION`),
  and one that carries a project or transfers naming a work order cannot become `vendor` either (the table check and the 1029 move
  guard). Changing a vendor location to another kind requires its vendor company to be cleared in the same update (the table check).

**Reading it**
- FR-SVL-020 `get_stock_on_hand` shall return, per row, `warehouse_kind` (already) and, for a vendor location,
  `vendor_name` (the linked company's name, else null), so on-hand reports show the stock as at the vendor. Rows of other
  kinds are byte-identical to today (key absent).
- FR-SVL-021 The on-hand screen and the location picker shall label the kind ("Vendor") in English and Bahasa Indonesia, and
  show the vendor name beside a vendor location where known.
- FR-SVL-022 The work-order balance (1031) and the project location balance count only `site`, `yard`, `staging` locations of the
  project, so stock at a vendor leaves the project's location total on transfer out and re-enters on transfer back. No change to
  1031.
- FR-SVL-023 A transfer out to a vendor location shall not count as usage in the reorder suggestion (it comes back); the
  suggestion's rule becomes "a transfer out that does not land in a central or vendor location".

## 3. Acceptance criteria

| AC | Given / When / Then | Owning layer |
|---|---|---|
| AC-SVL-001 | Given a vendor location linked to a Vendor company, when created by a master writer, then it saves; a project on it is refused; a Client or Internal company, another org's company, or a link on a non-vendor kind is refused. | pgTAP |
| AC-SVL-002 | Given stock of an item at a warehouse, when transferred to a vendor location then back, then both legs are posted, value is carried (value at vendor = value sent; back at the source's cost), and the vendor holds zero at the end. | pgTAP |
| AC-SVL-003 | Given a vendor location holding 5, when transferring 8 back, then refused (negative stock). | pgTAP |
| AC-SVL-004 | Given a vendor location, when posting a receive, issue or return naming it, then refused `STK_VENDOR_LOCATION`; adjustment and count are accepted; a location that already has receipts cannot become a vendor location. | pgTAP (mutation-check: drop the rule, red) |
| AC-SVL-005 | Given a transfer to a vendor location naming a work order, then refused; given vendor -> site naming a work order of the site's project, then accepted; of another project, refused. | pgTAP |
| AC-SVL-006 | Given stock at a vendor, when reading `get_stock_on_hand`, then the row has `warehouse_kind = 'vendor'` and `vendor_name`; a non-vendor row has no `vendor_name`; the cost keys follow the existing role rule. | pgTAP |
| AC-SVL-007 | Given only central/site/yard/staging locations, after migrating, then on-hand output for them is byte-identical to before and no existing test changes. | pgTAP (existing suite untouched) |
| AC-SVL-008 | Given movements to a vendor, when the reorder suggestion is computed for the source warehouse, then the transfer to the vendor is not usage. | pgTAP |
| AC-SVL-009 | Given a project's site holding 10, when 4 go to a vendor and 4 return, then the work-order/project location totals read 6 then 10. | pgTAP |
| AC-SVL-010 | Given the Setup form for a location with kind Vendor, then the project field is hidden, an optional vendor selector lists Vendor companies, and kind labels read in both languages. | Unit |
| AC-SVL-011 | Given a location import file row with kind `vendor` and a project, then the row is refused; without a project it is accepted. | Unit |
| AC-SVL-012 | Given an admin, when creating a vendor location in Setup, sending material to it and back from the transfer form, then the on-hand screen shows it "at" the vendor in between and zero after. | E2E (extends the shipped round-trip journey JOB-F20 to use the vendor kind; the existing spec stays untouched) |

## 4. Settings
| Setting | Default |
|---|---|
| The vendor locations themselves (code, name, optional vendor company) | none exist; each organisation creates its own in Stock setup or by import |

No new organisation switch is needed: the kind is data. Nothing is hard-coded per client.

## 5. Default-off
The migration only widens a check, adds a nullable column and adds guards that fire on `vendor` rows. No `vendor` location exists
after it, so no existing document, balance, report or screen changes; the two replaced read functions return identical output for
every non-vendor row. The Setup kind list gains one option and the form one conditional field; nothing else on any screen moves.

## 6. Out of scope (owned by siblings)
Two-step transfer with recount (#2690), work-order-to-work-order transfer (#2691), reservations (#2693), daily-report stock issue (#2676).
A vendor's QC sign-off, return document or process cost is not modelled here; the paper is a stock document attachment (FR-SSW-020).

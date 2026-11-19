# Stock for site work: yard and staging, client-supplied stock, balance per work order (SSW)

Issue #2523 (map #2516, blocked by #2517). Status: **Draft, 2026-11-20**. Executor on sign-off: **Director-dispatched
Orca worker, ships alone** (stock value and posting engine). Plan `docs/plans/2026-11-20-stock-site-work.md`.
IDs: `FR-SSW-###`, `AC-SSW-###`. **Money path: stock valuation.** The ledger remains the single writer
(`stock_write_entry`, FR-STK-072); nothing here writes the ledger except through that function.

**Builds on #2517:** `stock_documents.work_order_id` / `discipline_id`; the rule "a transfer names the work order of its
destination site warehouse's project; issue/return name the document's project".

**Job story.** When materials reach a site, I want them to move warehouse → yard → work order with their paperwork,
client-supplied items costing nothing, and to see what each work order holds, so cost and stock on site are right
without a side spreadsheet.

## 1. AS-IS
- `stock_warehouses.kind in ('central','site')`, optional `project_id` (0412). Documents: receive, transfer, issue,
  return, adjustment, count; `stock_documents_shape` check ties issue to a project (0413). Ledger `stock_ledger`
  (qty_delta, value_delta, qty_after, value_after, project_id, boq_item_id); balances `stock_balances` derived.
- Moving-value costing: issues take value from the ledger. A receive carries `unit_cost` per line.
- Documents have no attachments. Items have no tags. There are no yard or staging kinds; no balance per work order.

## 2. Requirements (EARS)

**Location kinds**
- FR-SSW-001 `stock_warehouses.kind` shall also allow `yard` and `staging`. A yard or staging location may name a project
  (as `site` does) and behaves as a normal location for every posting rule.
- FR-SSW-002 A transfer between any two locations (warehouse, site, yard, staging) shall be allowed; a transfer into a
  `site`, `yard` or `staging` location of a project may name a work order of that project (#2517 rule widened to the new kinds).
- FR-SSW-003 Existing documents, balances and reports keep their meaning: `central` and `site` rows are unchanged.

**Client-supplied (free-issue) tag**
- FR-SSW-010 An organisation shall hold stock tags it names itself (e.g. its own word for client-supplied), each with a flag
  "zero cost". Only Admin creates, renames, archives tags (soft archive). One tag may be flagged as the zero-cost tag; an org may have several tags and
  several zero-cost ones. Tag names are free text; the app's English and Bahasa labels never hardcode the org's word.
- FR-SSW-011 A stock item shall carry zero or one tag.
- FR-SSW-012 While an item's tag is zero cost, the system shall record every receive of it at unit cost 0 and shall refuse a non-zero cost
  on its receive lines, in the database. Its ledger value is therefore 0 and every issue, transfer and return of it carries 0.
- FR-SSW-013 A purchased (untagged or non-zero-cost) item keeps moving-value costing: a transfer carries its value; an issue to a
  work order carries that value into the work order's cost (#2517/#2519).
- FR-SSW-014 Changing an item's tag shall be refused while the item has any ledger row (it would change meaning retroactively);
  the way out is a new item.
- FR-SSW-015 A project's cost totals shall be unchanged by zero-cost items (they add quantity, no value).

**Transfer paper**
- FR-SSW-020 A stock document (any kind) shall hold zero or more attachments (picking slip, delivery note, photo): file, uploader, time,
  optional label. Attachments are added by the document's creator and warehouse keepers while it is Draft or Posted; read by anyone who reads the document.
- FR-SSW-021 A Posted document's attachments cannot be deleted, only archived with a reason (audit row); the posting itself stays immutable.
- FR-SSW-022 A client-supplied transfer may be flagged "paper required": posting is refused until an attachment exists (org setting, default off).

**Balance per work order**
- FR-SSW-030 The system shall report, per work order, quantity (and value) on hand, derived only from ledger rows: net of posted
  transfers into the site/yard/staging with that work order, issues and returns naming it.
- FR-SSW-031 Quantities by item, by location, and by zero-cost vs costed; value is shown only to roles that read stock value today.
- FR-SSW-032 Balances come only from ledger movements; no stored per-work-order balance exists. A reconciliation test proves
  sum over work orders + unassigned = project's location balance.
- FR-SSW-033 An issue that would take a work order's balance below zero shall follow today's negative-stock rule (refuse unless the org allows it).

## 3. Acceptance criteria

| AC | Given / When / Then | Owning layer |
|---|---|---|
| AC-SSW-001 | Given a yard and a staging location, when a transfer is posted warehouse → yard → work-order issue, then balances at each step are correct. | pgTAP + E2E (one journey) |
| AC-SSW-002 | Given a zero-cost tag on an item, when I receive 10 at cost 5, then it is refused; at cost 0 it posts with value 0. | pgTAP (mutation-check: drop the rule → red) |
| AC-SSW-003 | Given a zero-cost item moved warehouse → yard → issued to a WO, then ledger value_delta is 0 at each step and WO stock cost is 0. | pgTAP |
| AC-SSW-004 | Given a purchased item at 4.00, when transferred and issued to a WO, then the WO cost equals 4.00 x quantity. | pgTAP + Layer-1 money test |
| AC-SSW-005 | Given an item with ledger rows, when its tag changes, then refused. | pgTAP |
| AC-SSW-006 | Given a non-Admin, when creating or changing a tag, then refused; another org's tag cannot be applied. | pgTAP |
| AC-SSW-007 | Given a posted document, when an attachment is added, then it saves; when deleted, then refused and archive with reason works with an audit row. | pgTAP |
| AC-SSW-008 | Given paper-required on, when posting a client-supplied transfer without an attachment, then refused. | pgTAP |
| AC-SSW-009 | Given movements for two work orders, when I read balance per work order, then each equals its ledger sums and the reconciliation holds. | pgTAP + Layer-1 money test |
| AC-SSW-010 | Given no ledger rows for a WO, then its balance is an empty state, not zero money. | Unit |
| AC-SSW-011 | Given the org's tag named "X", then the UI shows "X" in lists, forms and reports in both languages. | Unit |
| AC-SSW-012 | Given a transfer naming a WO of another project, then refused (#2517 rule, new kinds). | pgTAP |
| AC-SSW-013 | Given existing central/site data, after migrating, then reports are byte-identical. | pgTAP |

## 4. Open questions
1. **Moving-value on transfer:** does the transfer move value (as shipped) or only quantity? Assumed shipped behaviour; confirm no change to valuation.
2. Is "balance per work order" meant to be stock *physically at the work order's location* or *issued to* it? Proposed: both, shown separately ("on site for", "issued to").
3. May a zero-cost item be sold/consumed and later billed to the client at cost-plus? Assumed no; out of scope.
4. A client-supplied item returned to the client: use the existing return/adjustment, or a new kind? Assumed adjustment (reason required).
5. Paper required (FR-SSW-022): per tag, or org-wide? Proposed per zero-cost tag.
6. Do yard/staging need keepers and allowances as `site` does (0412 keepers, 0417 allowances)? Assumed yes, same rules.
7. Bucket for attachments: new `stock-documents` bucket with the document's read rule (proposed) vs project-documents.

## 5. Out of scope
New posting kinds, ERP/Odoo posting changes (`docs/specs/odoo-stock-posting.spec.md` stays as is; a zero-value ledger row must still post cleanly or be skipped: check at build), costing methods other than moving value, barcode scanning.

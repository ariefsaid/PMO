# Procurement flexible entry and ERP document linking (PFE)

Issue #1319. ADR-0093 (supersedes DD-XING-2 for purchase documents; amends ADR-0033's "status is declared").
Plan: `docs/plans/2026-10-23-procurement-flexible-entry.md`.

**Job story.** When a purchase already happened (or is happening) outside the ideal request → approval → order
chain, I want to record it from whatever step I am at — and pull in the documents ERPNext already holds — so the
project's Procurement tab tells the truth about what was bought, with its files, without counting any money twice
and without opening ERPNext.

## Owner rulings this encodes (2026-10-23, issue #1319)

1. **A purchase can start at any step**: request, order, receipt, vendor invoice or payment. No request is needed
   before an order, no order before a receipt. Builds the "flexible procurement chain entry" retrofit recorded under
   `OD-SAR-GATES` (2026-07-14).
2. **Existing ERPNext purchase documents may be linked into PMO purchases** without re-pushing anything to ERPNext
   and without double counting. Supersedes `DD-XING-2`'s "read, not adopted" **for purchase documents only**
   (ADR-0093).
3. **Reuse, don't reinvent.** Port the earlier Frappe portal's *logic* (start anywhere; status = furthest document;
   link, don't create; orphan list with single and bulk link). Keep PMO's Model C (ADR-0033: many documents per
   step) and its files/SharePoint handling. Do not copy that portal's gaps (one document per type, no files, no
   check that linked documents belong together).
4. (2026-10-23, via the Director) **Bulk link input is a file** (JSON or CSV rows: ERP document number → a purchase
   id or a project, plus an optional SharePoint item), with a `--dry-run` that applies **exactly the same checks**
   as the real run, reports every row as link / skip / refused-with-reason, and writes nothing.
5. (2026-10-23, via the Director) **A SharePoint folder is linked as a folder.** Never force a category or a status
   on it (the project "Add document" form wrongly does so today, #1320 — not reused here because it is not shipped).
6. (production fact, 2026-10-23) "Create folder in SharePoint" does nothing until an Admin sets the org's default
   document library; it shows "Folder not linked. Ask an Admin…". No test may assume that library is set.

Out of scope: creating ERP documents for history; expense claims / petty cash (`OD-PROC-5`); per-org custom
pipelines beyond the four gates below (`OD-PROC-6`); offering a *second* native record of a kind the ledger already
holds from the capture row (the shipped one-per-kind capture offer is unchanged — many documents per step arrive by
linking, by the ERP mirror, or by the record forms as today).

## Terms

- **Purchase** — a `procurements` row (the case folder, ADR-0033).
- **Step** — one of the ranked statuses: Draft 0 · Requested 1 · Approved 2 · Vendor Quoted 3 · Quote Selected 4 ·
  Ordered 5 · Received 6 · Vendor Invoiced 7 · Paid 8. Cancelled and Rejected are terminal/rework and unranked
  for derivation.
- **Document-evidenced step** — Ordered, Received, Vendor Invoiced, Paid. Evidence is a PMO record row
  (any `purchase_orders` row whatever its status, any `procurement_receipts` row, a `procurement_invoices` row not
  cancelled in ERPNext, a `payments` row with status Paid not cancelled in ERPNext) **or** a linked ERP document
  with ERP docstatus submitted (Purchase Order, Purchase Receipt, Purchase Invoice, Payment Entry).
- **ERP purchase document** — a row of `erp_purchase_documents` (the sweep's read model, #1277), now including
  Purchase Receipts and supplier Payment Entries.
- **Orphan** — a submitted ERP purchase document that PMO did not push (`pmo_owned = false`) and that no purchase
  links.
- **Ledger-held amount of a purchase** — the pre-tax amount of its ERP purchase invoices that are on the ERPNext
  ledger: linked submitted Purchase Invoices (`net_total`, falling back to `grand_total` when the mirror has no net)
  plus PMO-pushed vendor invoices mirrored as submitted (`procurement_invoices.erp_docstatus = 1`, not cancelled;
  net = `amount − tax_amount` for inclusive rows, `amount` for exclusive). Returns (debit notes) carry negative
  totals and reduce it.
- **Gates** — four org settings, all default OFF: `request_before_order`, `approval_before_order`,
  `approval_before_payment`, `receipt_before_invoice`.
- **User write / machine write / direct SQL** — a write carrying a user's JWT (`auth.uid()` set); a write by the
  ERP mirror (service-role JWT, no user); a write with no JWT at all (migrations, seed, test fixtures).

## Requirements (EARS)

### Start anywhere and derived status
- **FR-PFE-001** The system shall let a member who may record a step's document create a purchase whose first
  recorded document is a request, an order, a receipt, a vendor invoice or a payment, with or without a project and
  with or without a supplier.
- **FR-PFE-002** When a user write or a machine write adds document-evidenced step evidence to a purchase, the
  system shall set the purchase status to the furthest document-evidenced step it holds, if that step ranks above
  the current status. Direct SQL derives nothing (NFR-PFE-010).
- **FR-PFE-003** The system shall never move a purchase's status to a lower-ranked step as a result of adding,
  linking or unlinking a document.
- **FR-PFE-004** While a purchase is Cancelled or Rejected, the system shall not derive a new status for it, and
  linking an ERP document into it shall be refused (`purchase_closed`).
- **FR-PFE-005** The status transition RPC shall additionally allow these forward skips, subject to FR-PFE-010:
  Draft → Ordered | Received | Vendor Invoiced | Paid; Approved and Quote Selected → Received | Vendor Invoiced |
  Paid; Ordered → Vendor Invoiced | Paid; Received → Paid. Roles by target: Ordered — Project Manager, Finance;
  Received from Ordered — the requester or a Project Manager (shipped); Received by a skip — Project Manager,
  Finance; Vendor Invoiced — Finance; Paid — Finance; Admin break-glass except SoD.
- **FR-PFE-006** When the transition RPC is asked for a document-evidenced step the purchase already holds, it shall
  succeed without change (idempotent), so a client that records a document and then requests the step does not fail.
- **FR-PFE-007** Every derived status change shall be appended to `procurement_status_events` with the acting user
  (null for the ERP mirror) and a note naming the evidence ("Derived: …").
- **FR-PFE-008** When a machine write adds evidence whose derived status a guard refuses, the system shall keep the
  record, leave the status unchanged and write an audit event `procurement.derive_skipped`; for a user write the
  refusal shall fail the write.

### Gates (org settings, default OFF, enforced server-side)
- **FR-PFE-010** Where a gate is ON, the system shall refuse — on the transition RPC, on inserting the step's PMO
  record by a user write, on linking an ERP document, and in the ERP dispatch before any ERP write — any step that
  violates it: `request_before_order` (Ordered or later without a request: no request record, no PR number and
  status below Requested); `approval_before_order` (Ordered or later without a recorded approver);
  `receipt_before_invoice` (Vendor Invoiced or later without receipt evidence and status below Received);
  `approval_before_payment` (Paid without a recorded approver). The refusal carries the gate's reason code; the
  user-facing sentence comes from one server helper (`procurement_gate_message`).
- **FR-PFE-011** The system shall store the gates as `organizations.procurement_gates` (jsonb), readable by active
  members through `get_procurement_gates()` and changeable only by an active Admin through
  `set_procurement_gates(jsonb)`, which accepts only the four known keys with boolean values and is audited.
- **FR-PFE-012** When a gate key is absent or not a boolean, the system shall treat it as OFF (the owner's default).
- **FR-PFE-013** The gate seam is separate from the ERPNext binding's `process_gates` (which governs sales invoices
  and is absent for an org without ERPNext); both follow `OD-SAR-GATES`.

### Separation of duties (whenever an approval is recorded)
- **FR-PFE-015** The requester shall not approve or reject their own purchase (shipped SoD-a, unchanged).
- **FR-PFE-016** On every path that moves a purchase to Paid (transition, a Paid payment record, a linked Payment
  Entry), the acting user shall not be the purchase's recorded approver or the approver of a raised amount; the
  check lives in the procurement update guard so no path skips it, Admin included.
- **FR-PFE-017** When a purchase has a recorded approved amount, the shipped payment ceiling (0349) shall apply on
  every path to Paid. When it has no recorded approver and `approval_before_payment` is OFF, the system shall allow
  Paid without an approved amount; otherwise it shall refuse ("Cannot pay without a recorded approved amount.").

### Linking ERP documents
- **FR-PFE-020** The system shall let an active Admin, Executive, Project Manager or Finance member link a submitted
  ERP Purchase Order, Purchase Receipt, Purchase Invoice or Payment Entry of their org, as mirrored in PMO, into a
  purchase — or into a new purchase created for it — singly or in a batch of up to 500 rows per call.
- **FR-PFE-021** An ERP document shall belong to at most one purchase (database-unique).
- **FR-PFE-022** Linking shall write nothing to ERPNext, create no outbox command and no ERP document.
- **FR-PFE-023** The system shall refuse a link, with a reason code, when: the row has no document number
  (`erp_name_missing`); the document is not found (`document_not_found`), ambiguous by number without a doctype
  (`document_ambiguous`), cancelled (`document_cancelled`), pushed by PMO (`document_recorded_by_pmo`), linked to
  another purchase (`document_linked_to_another_purchase`); the purchase is not found or not in the org
  (`purchase_not_found`) or closed (`purchase_closed`); the project is not found (`project_not_found`); an id is
  malformed (`invalid_id`); the supplier differs (`supplier_mismatch`); the project differs (`project_mismatch`);
  the currency differs (`currency_mismatch`); an ERP invoice is attributed to more than one project
  (`document_spans_projects`, FR-PFE-025); a SharePoint item on the row is not on the organization's own SharePoint
  host (`sharepoint_host_not_allowed`) or the organization has no default SharePoint library (`m365_not_configured`);
  a gate refuses the step (`gate_*`); or a guard refuses the derived status (its message, e.g. the SoD sentence).
- **FR-PFE-024** Supplier match: the purchase's supplier identity is the ERP supplier mapped to its vendor company
  (`external_refs`, domain `companies`); when the vendor has no mapping, the vendor's name compared trimmed and
  case-insensitively with the document's supplier name; and in all cases the supplier of every document already
  linked to the purchase. A purchase with no vendor takes the vendor company mapped to the document's supplier,
  when one exists.
- **FR-PFE-025** Project match: a document whose attributed projects (`project_ids`) are non-empty shall be linked
  only to a purchase whose project is one of them; a document with no attributed project may link to any purchase.
  An ERP Purchase Invoice attributed to more than one project shall not be linked (one purchase would deduct the whole
  invoice while each project's actuals carry only its share): link it from ERPNext per project, or record it in PMO.
  An ERP order and the invoices billing it are linked one at a time, so they always end up in one purchase.
- **FR-PFE-026** When a row names no purchase, the system shall create a Draft purchase (requester = caller, currency
  = the document's, project = the row's project, title = the row's title or "<supplier> <document number>",
  `origin = 'erp_link'`, a purchase number in `code` minted as PROC-YYMMDD#### by the normal minter, and the vendor
  company when the supplier maps to exactly one live company of the organization: the companies mapping, else
  `erp_supplier_name`, else the name; otherwise no vendor) and link the document to it; rows of one call sharing a `group` key (default: the document
  number) and the same project go into one new purchase.
- **FR-PFE-027** For a purchase with `origin = 'erp_link'`, `total_value` shall be kept equal to the pre-tax total of
  its linked Purchase Orders when it has any, else of its linked Purchase Invoices, else Purchase Receipts, else
  the amount of its linked Payment Entries. Linking into a PMO-originated purchase never changes its `total_value`,
  except (0372) a PMO purchase with no line items that never entered approval and whose total is 0 — or is still the
  total its linked documents gave it — takes the same linked-documents total when a document is linked or unlinked.
  An item-derived, approved or typed total is never changed.
- **FR-PFE-028** Re-running the same rows shall be safe: a document already linked to the row's purchase, or a row
  naming no purchase whose document is already linked, is reported `skip` with the existing purchase id.
- **FR-PFE-029** A row may carry one SharePoint item (drive id, item id, web URL, name, kind file|folder) on the
  organization's own SharePoint host; on a `link` outcome the system shall attach it to that linked document on the
  purchase (FR-PFE-050).
- **FR-PFE-030** When `p_dry_run` is true, the link RPC shall run the identical per-row code, report the identical
  outcomes, and roll back every write (new purchases are reported with `procurement_id = null`).
- **FR-PFE-031** The system shall let an active Admin or Finance member unlink a linked document; the purchase
  status does not move back; SharePoint items attached to that document move to the purchase level; it is audited.
  Unlinking and attaching a file to one recorded document serialize on the purchase, so a file is never left pointing
  at a document that is no longer linked.
- **FR-PFE-032** The purchase shall show each linked ERP document with its doctype, ERP number, date, amount,
  currency and ERP status, marked "From ERPNext".

### No double counting
- **FR-PFE-035** Actuals shall come only from the ERP ledger (GL mirror → `project_mapped_actuals`), as today. No
  linked document, link row or purchase total shall feed actuals.
- **FR-PFE-036** A purchase's **open commitment** shall be: 0 when Cancelled or Rejected; when the org reads the ERP
  ledger (`org_reads_erp_ledger()`), `greatest(0, total_value − ledger-held amount)`; otherwise `total_value`.
- **FR-PFE-037** Committed spend of a project shall be Σ open commitment over its purchases in the committed
  statuses (Ordered, Received, Vendor Invoiced, Paid) — `project_committed_spend(project_id)` — and the client's
  `getProjectCommittedSpend` and the procurement list summary shall read the server's open commitment rather than
  summing `total_value` themselves.
- **NFR-PFE-001** The budget-line routing figure (`spend_approval_route.line_used`) stays procurement-sourced and
  unchanged: it has no ledger term, so a linked purchase's full value counts once on its line.
- **NFR-PFE-002** For an org that does not read the ERP ledger every figure is unchanged (open commitment =
  `total_value`).

### Orphans
- **FR-PFE-040** The sweep shall mirror submitted and cancelled Purchase Receipts and supplier Payment Entries
  (`payment_type = Pay`, `party_type = Supplier`) alongside Purchase Orders and Invoices, with `net_total` for
  orders, receipts and invoices and the paid amount as the Payment Entry's total.
- **FR-PFE-041** The org-wide ERP purchases page and each project's Procurement tab shall list the orphans in scope
  (this replaces the read-only "Purchases recorded in ERPNext" list), each with "Link to purchase" and "New purchase
  from this", with multi-select for bulk "Link to purchase" and bulk "New purchase from these". The org-wide
  Procurement list keeps its link to that page, renamed "ERPNext documents not in a purchase".
- **FR-PFE-042** The project tab's AP aging buckets (FR-EPR-008) shall keep counting all of the project's unpaid ERP
  invoices, linked or not.
- **FR-PFE-043** Orphans are readable through the view `erp_purchase_orphans` by the same audience as
  `erp_purchase_documents` (active Admin, Executive, Project Manager, Finance of the org).

### Files
- **FR-PFE-050** A SharePoint/OneDrive file or folder may be linked on the purchase or on one recorded document
  (PMO record or linked ERP document) via `procurement_documents.record_kind` + `record_id`; the database shall
  refuse a target that is not part of the same purchase.
- **FR-PFE-051** A linked folder shall display as a folder (name + open link); the UI shall not ask for or show a
  category or status for it.
- **FR-PFE-052** Upload stays available on PMO records as today; record folders (#1284/#1289) shall work for a
  purchase whatever step it started at and whether it was created by linking.

### Pushes
- **FR-PFE-055** A document authored in PMO shall be pushed to ERPNext exactly as today (same repository routing,
  same dispatch). A step a purchase skipped pushes nothing (its capture is never offered). A linked ERP document is
  never pushed.

### API and CLI
- **FR-PFE-060** The PMO CLI shall offer `pmo purchases orphans [--project <id>] [--limit n]`,
  `pmo purchases link <file.json|file.csv|-> [--dry-run]` and `pmo purchases link-file <json|@file|->`.
- **FR-PFE-061** `link` shall accept JSON (array of row objects) or CSV with header
  `erp_doctype,erp_name,procurement_id,project_id,group,title,budget_category,sp_drive_id,sp_item_id,sp_web_url,sp_name,sp_kind`,
  send rows in batches of ≤500 to `link_erp_purchase_documents`, and print every row's outcome and reason plus
  counts; `--dry-run` sends `p_dry_run = true` and nothing else differs.
- **FR-PFE-062** The OAuth API-client guard shall allow, to an active Admin, Executive, Project Manager or Finance
  token only: POST `/rpc/link_erp_purchase_documents`, POST `/rpc/link_procurement_sharepoint_item`, GET
  `/erp_purchase_orphans`. Everything else stays as shipped. (Owner ruling overrides DD-API-3's "never a money RPC"
  for these three; none moves money or writes to ERPNext.)
- **FR-PFE-063** "Create a purchase at any step" from the CLI is the link file with rows naming a project and no
  purchase (FR-PFE-026). PMO-authored documents (which push to ERPNext) stay in the app, where the push path lives.

### Existing data
- **NFR-PFE-010** The migrations shall not change any existing purchase's status or status history; derivation runs
  only on user and machine writes after deployment, never on direct SQL.
- **NFR-PFE-011** Every migration ships a rollback file under `supabase/migrations/rollback/`.
- **NFR-PFE-012** Every new table has RLS forced, no client write grant, and the `org_id` seam; machine-side writers
  scope by org themselves.

## Acceptance criteria (Given/When/Then)

Issue AC mapping: AC-1 → 001 · AC-2 → 002 · AC-3 → 003, 013, 014 · AC-4 → 004, 015 · AC-5 → 005 · AC-6 → 006, 016 ·
AC-7 → 007 · AC-8 → 008 · AC-9 → 009, 017 · AC-10 → 010 · AC-11 → 011, 018, 019 · AC-12 → 012, 021, 022.

- **AC-PFE-001** (e2e) Given gates OFF and a Project Manager, When they start a new purchase choosing "Order" as the
  first document and record a purchase order, Then the purchase shows status Ordered with no request or approval
  step recorded.
- **AC-PFE-002** (pgTAP) Given a Draft purchase, When a user records an invoice, Then status is Vendor Invoiced;
  When a purchase order record is added later, Then status stays Vendor Invoiced and no status event moves it back.
- **AC-PFE-003** (pgTAP) Given each gate ON in turn, When the violating step is attempted through the transition
  RPC, a user's record insert and a link, Then each is refused with the gate's reason; Given all gates OFF (default,
  and a fresh org reads all four as false), Then the same steps succeed.
- **AC-PFE-004** (pgTAP) Given an orphan Purchase Invoice and a purchase, When a Finance member links it, Then one
  link row exists, the purchase status is Vendor Invoiced, and `external_command_outbox` has no new row.
- **AC-PFE-005** (pgTAP) Given an ERP-ledger org, a project with mapped actuals A and an Ordered purchase of
  total 1,000 with a linked submitted invoice of net 600, Then `project_mapped_actuals` still totals A,
  `procurement_open_commitment` is 400 and `project_committed_spend` counts 400 for it; a linked return of net −100
  raises it to 500; Given a non-ledger org, Then open commitment equals `total_value`.
- **AC-PFE-006** (unit, `ErpOrphansSection.test.tsx`) Given three orphans of a project, When the tab renders, Then
  each row offers "Link to purchase" and "New purchase from this", and selecting two shows bulk "Link 2 to purchase"
  and "New purchase from 2".
- **AC-PFE-007** (pgTAP) Given a purchase with two orders, two partial receipts and two invoices, Then the derived
  status is Vendor Invoiced; When a Paid payment is recorded, Then it is Paid and every document stays attached.
- **AC-PFE-008** (pgTAP) Given a purchase with vendor V mapped to ERP supplier S1, When a document of supplier S2 is
  linked, Then it is refused `supplier_mismatch`; likewise `project_mismatch` and `currency_mismatch`; Given a
  document linked to purchase P1, When it is linked to P2, Then it is refused
  `document_linked_to_another_purchase`, and a direct second link row is refused by the database.
- **AC-PFE-009** (unit, `ProcurementMicrosoftReferences.test.tsx`) Given a purchase, When a SharePoint folder is linked
  on it and a file is linked on a linked ERP invoice, Then the folder shows as a folder with no category or status,
  and the file shows under that invoice.
- **AC-PFE-010** (unit, `pages/procurement/ledgerCapture.startAt.test.ts`) Given a Draft purchase started at
  "Vendor invoice" with an empty ledger, When the capture row is computed, Then it offers only the vendor-invoice
  capture — so the skipped steps get no capture and therefore no record and no ERP dispatch; without a start step
  the shipped capture offer is unchanged. (The push itself is the shipped repository routing, unchanged; the ERP
  dispatch's gate check is wired before any ERP write — `procurementGateWiring.test.ts`.)
- **AC-PFE-011** (node, `scripts/pmo-purchases.test.mjs`) Given a CSV of three rows, When `pmo purchases link file.csv
  --dry-run` runs, Then the CLI posts the three rows with `p_dry_run: true` and prints each row's outcome and the
  counts; without `--dry-run` it posts the identical rows with `p_dry_run: false`.
- **AC-PFE-012** (pgTAP) Given the seeded purchases after migrating, Then no status event with a "Derived:" note
  exists and every seeded purchase keeps its seeded status; the rollback files apply and re-apply cleanly
  (round-trip test in the plan).
- **AC-PFE-013** (pgTAP) Given an approved purchase whose approver links a Payment Entry, records a Paid payment or
  transitions to Paid, Then each is refused "separation of duties: approver cannot pay own procurement"; a
  different Finance member succeeds.
- **AC-PFE-014** (unit, `OrgProcurementGates.test.tsx`) Given an Admin, When they turn on "Approval required before
  payment", Then `set_procurement_gates` is called with that key true; Given a non-Admin, Then the switches are
  read-only.
- **AC-PFE-015** (unit, `LinkedErpDocuments.test.tsx`) Given a purchase with a linked Purchase Invoice, Then the
  purchase shows its ERP number, date, amount, currency and ERP status, marked "From ERPNext".
- **AC-PFE-016** (pgTAP) Given orphan, linked, PMO-pushed and cancelled ERP documents across two orgs, Then
  `erp_purchase_orphans` returns only the caller org's unlinked, submitted, not-PMO-pushed rows, an Engineer reads
  none, and no client can write `procurement_erp_links`.
- **AC-PFE-017** (pgTAP) Given purchases P1 and P2, When a SharePoint reference on P1 targets a record of P2, Then the
  insert is refused; targeting a record of P1 succeeds.
- **AC-PFE-018** (pgTAP) Given an OAuth client token, Then a Finance token may POST the two purchase RPCs and GET
  `erp_purchase_orphans`, an Engineer token is refused, unlink stays app-only, and every other endpoint keeps its
  shipped answer.
- **AC-PFE-019** (pgTAP) Given 5 rows (2 linkable into one new grouped purchase, 1 already linked here, 2 refused),
  When the RPC runs with `p_dry_run = true`, Then it reports link ×2, skip ×1, refused ×2 with reasons and no row in
  `procurement_erp_links`, `procurements` or `procurement_documents` changed; When run for real, Then the outcomes
  and reasons are identical.
- **AC-PFE-020** (unit, `purchaseMirrorFeed.test.ts`) Given ERPNext returns a Purchase Receipt and a Pay-type supplier
  Payment Entry, When the feed runs, Then both are mapped with supplier, date, totals (net and grand), status and
  project, and Payment Entries are requested filtered to supplier payments.
- **AC-PFE-021** (e2e) Given a seeded orphan Purchase Invoice on a project, When a Finance user opens the project's
  Procurement tab and chooses "New purchase from this", Then the new purchase shows the invoice "From ERPNext" with
  its number and amount, status Vendor Invoiced, and the orphan is gone from the tab.
- **AC-PFE-022** (e2e) Given two seeded orphans and an existing purchase on a project, When a Finance user selects
  both and links them to that purchase, Then the purchase lists both documents.
- **AC-PFE-023** (pgTAP) Given a linked document, When an Admin unlinks it, Then the link is gone, the document is an
  orphan again and the purchase status is unchanged; a Project Manager's unlink is refused.
- **AC-PFE-024** (pgTAP) Given an unlinked ERP document, When it is linked as a new purchase, Then the purchase gets
  the next `PROC-YYMMDD####` number from the org's counter and no request or order number.
- **AC-PFE-025** (pgTAP) Given an unlinked ERP document, When it is linked as a new purchase, Then its vendor is the one
  live Vendor company in the same org that the supplier maps to (mapping, then ERP supplier id, then exact name);
  otherwise the vendor stays empty.

## Traceability (owning layer)

| AC | Owning test |
|---|---|
| AC-PFE-001 | e2e `pmo-portal/e2e/AC-PFE-001-start-at-order.spec.ts` |
| AC-PFE-002, 003, 007, 012, 013 | pgTAP `supabase/tests/procurement_flexible_status.test.sql` (003 defaults in `procurement_flexible_foundation.test.sql`; link paths of 003/013 in `procurement_erp_links.test.sql`) |
| AC-PFE-004, 008, 019, 023 | pgTAP `supabase/tests/procurement_erp_links.test.sql` |
| AC-PFE-005 | pgTAP `supabase/tests/procurement_no_double_count.test.sql` |
| AC-PFE-006 | unit `pmo-portal/pages/procurement/ErpOrphansSection.test.tsx` |
| AC-PFE-009 | unit `pmo-portal/pages/procurement/ProcurementMicrosoftReferences.test.tsx` |
| AC-PFE-010 | unit `pmo-portal/pages/procurement/ledgerCapture.startAt.test.ts` |
| AC-PFE-011 | node `scripts/pmo-purchases.test.mjs` |
| AC-PFE-014 | unit `pmo-portal/pages/admin/OrgProcurementGates.test.tsx` |
| AC-PFE-015 | unit `pmo-portal/pages/procurement/LinkedErpDocuments.test.tsx` |
| AC-PFE-016, 017 | pgTAP `supabase/tests/erp_purchase_orphans.test.sql` |
| AC-PFE-018 | pgTAP `supabase/tests/api_client_purchase_surface.test.sql` |
| AC-PFE-020 | unit `pmo-portal/src/lib/adapterSeam/erpnext/purchaseMirrorFeed.test.ts` |
| AC-PFE-021 | e2e `pmo-portal/e2e/AC-PFE-021-new-purchase-from-erp-invoice.spec.ts` |
| AC-PFE-022 | e2e `pmo-portal/e2e/AC-PFE-022-bulk-link-orphans.spec.ts` |
| AC-PFE-024 | pgTAP `supabase/tests/procurement_link_create_number_vendor.test.sql` |
| AC-PFE-025 | pgTAP `supabase/tests/procurement_link_create_number_vendor.test.sql` |

Superseded/updated proofs (deliberate, owner ruling 2026-10-23): AC-EPR-006's "no function other than the upsert reads
`erp_purchase_documents`" becomes an allow-list of the readers this spec adds (the actuals assertion is unchanged);
AC-EPR-008's journey follows the section's new name and the orphan list (its goal oracle — supplier, amount, project
on screen — is unchanged). Existing procurement pgTAP and e2e expectations that a status *stays* after a user records
a document change to the derived status (FR-PFE-002); each is listed in its PR.

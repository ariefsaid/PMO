# ERP purchases — read-only list per project and org-wide (EPR)

**Job story.** When I open a project, I want to see the purchase orders and supplier invoices recorded in
ERPNext for it — supplier, date, number, amount, paid or not — so I understand where its actual cost came
from without opening ERPNext.

**Why it is separate from Procurement.** RIS's 2025–2026 purchases were loaded natively into ERPNext
(`OD-SEED-3/4`: money history goes to ERPNext, never PMO). PMO already counts that cost as **Actuals**
from the GL mirror (`erp_gl_entry_mirror` → `erp_actuals_snapshot` → `project_mapped_actuals`). Adopting
those documents as PMO procurement cases would double-count spend and skip PMO's approval controls, so
they are **read, never adopted** (`DD-XING-2`). This list is visibility only.

## Rulings this encodes
- `DD-XING-2` — ERP-native history is a read-only read model; nothing here is adopted or editable.
- ADR-0048 — PMO shows ERP's figures (`grand_total`, `outstanding_amount`, `status`); it never computes them.
- Actuals stay GL-only. This list is never summed into spent, committed, actuals or any budget figure.

## Requirements (EARS)
- **FR-EPR-001** The sweep shall mirror every submitted or cancelled ERPNext Purchase Order and Purchase
  Invoice of the binding's Company into `erp_purchase_documents`, incrementally by `modified`.
- **FR-EPR-002** When a fetched document is older (`modified`) than the stored copy, the sweep shall keep
  the stored copy.
- **FR-EPR-003** The sweep shall attribute a document to every PMO project whose mapped ERP project name
  (binding `project_map`) appears on the document header, or — for a Purchase Invoice — on any of its
  live GL entries. Attribution shall be recomputed every tick, so a remap applies without a refetch.
- **FR-EPR-004** The sweep shall flag a document that PMO itself pushed (an `external_refs` row in the
  `procurement` domain names it) as `pmo_owned`, and the list shall hide flagged documents — they
  already appear as PMO procurement cases.
- **FR-EPR-005** Clients shall only read `erp_purchase_documents`; every write is service-role only.
  Read access matches the org-wide procurement index (`procurement.view`): active Admin, Executive,
  Project Manager and Finance members of the same org. Engineers see only their own requests, so not this.
- **FR-EPR-006** The project's Procurement tab shall show the project's ERP purchases (supplier, date,
  number, supplier invoice no., amount, status, paid/unpaid) when there is at least one, labelled as
  already counted in Actuals.
- **FR-EPR-007** `/erp-purchases` shall list the org's ERP purchases with a project column and a
  "no project" bucket, reachable from the Procurement page.
- **FR-EPR-008** Where a project has unpaid ERP purchase invoices, the section shall show AP aging
  buckets by days past due (Not due, 1–30, 31–60, 61–90, 90+), using ERP's `outstanding_amount`.
  Invoices shared with other projects are excluded from the buckets (counting them in full would
  overstate this project's payables) and listed with a "shared" marker.
- **NFR-EPR-001** Nothing in this feature writes to, or is read by, any spent/committed/actuals figure.

## Acceptance criteria (Given/When/Then)
- **AC-EPR-001** (unit, `purchaseMirrorFeed.test.ts`) Given ERPNext returns a PO and a PI since the
  watermark, When the feed runs, Then it sends both to `upsert_erp_purchase_documents` with ERP's
  supplier, dates, bill no, totals, outstanding and status, and advances the watermark to max `modified`.
- **AC-EPR-002** (pgTAP) Given a stored document with `erp_modified` T, When an upsert carries T−1,
  Then the stored copy is unchanged; with T+1 it is replaced.
- **AC-EPR-003** (pgTAP) Given `project_map` maps project P to `ERP-A`, When a PI has no header project
  but a live GL entry on `ERP-A`, Then the upsert stamps `project_ids = {P}`; When the map changes to
  `ERP-B`, Then the next call clears it.
- **AC-EPR-004** (pgTAP) Given an `external_refs` procurement row naming a PI, Then the PI is `pmo_owned`.
- **AC-EPR-005** (pgTAP) Given members of org A and org B, Then each reads only its own org's rows, an
  Engineer reads none, and
  no `authenticated` role can insert, update, delete or execute the upsert function.
- **AC-EPR-006** (pgTAP) Given a project with mirrored ERP purchases, Then `project_mapped_actuals` is
  unchanged by them, and no view or function other than the upsert reads `erp_purchase_documents`.
- **AC-EPR-007** (unit, `ErpPurchasesSection.test.tsx`) Given a project with two ERP invoices (one
  paid, one overdue) and one shared invoice, Then the section lists all three with paid/unpaid, states
  "already counted in Actuals", and the aging buckets total only the unshared outstanding.
- **AC-EPR-008** (e2e, `e2e/AC-EPR-008-erp-purchases.spec.ts`) Given seeded ERP purchases on a project,
  When a user opens the project's Procurement tab, Then they see the ERP purchases with supplier and
  amount; When they follow "All ERP purchases" from Procurement, Then the org list shows the project.

## Out of scope (ponytail)
- Purchase Order item-level projects: POs attribute by header project only (POs post no GL). Add a
  child-table read when a client splits POs across projects.
- Per-project amount split of a shared invoice: shown as the invoice total with a "shared" marker.
- Drill-through into ERPNext; Purchase Receipts; Payment Entries as rows.

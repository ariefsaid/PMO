---
status: accepted
---

# Procurement as a case folder over ERP-canonical record tables

## Context

The owner is underwhelmed by procurement's *functionality* despite liking its visuals ("looks rich but
does little"). The long-term product vision (memory: product-vision-operational-layer) is that PMO is a
**usable operational layer over a pluggable ERP backend** (ERPNext / Odoo / Supabase-now). Under that
vision, "simplify first" means **less infrastructure** (one client, single-tenant, Supabase-only) — it
does **not** mean an under-modeled domain. Procurement is genuinely multi-record (PR, RFQ, Quotation,
PO, Goods Receipt, Vendor Invoice, Payment), and a real procure-to-pay case has *many* of several of
them (partial deliveries, multiple invoices, progress payments).

Today the model is asymmetric: `procurement_quotations` / `procurement_receipts` / `procurement_invoices`
are real tables, but the Purchase Request **is** the `procurements` aggregate, the PO is a `po_number`
*column*, Payment is an invoice *status*, and RFQ does not exist. The system-assigned numbers (minted by
the lifecycle RPC) and the external reference numbers (`procurement_documents.reference_number`, a
separate free-form register) live in two disconnected places. Real-world documents cannot be uploaded for
PR/PO/Payment.

## Decision

Model a **procurement as a case folder** (`procurements` = title, project, requester, type, current
status) over a complete set of **ERP-canonical record tables**, each its own table, **1:N**, carrying a
**dual identity** (minted *system-assigned number* + nullable *external reference number*), plus
status / date / amount and one or more uploaded files:

`Purchase Request → RFQ → Quotation → Purchase Order → Goods Receipt → Vendor Invoice → Payment`

New tables: **purchase_requests, rfqs, purchase_orders, payments**. Existing tables reused: quotations,
receipts (GR), invoices (VI). RFQ→Quotation is 1:N. This *finishes* the table-per-record pattern PMO
already half-adopted, and makes the record set the **seam** that a future ERP-backend adapter maps onto —
the same role `org_id` plays for multi-tenancy.

### Aggregate structure — case-spine + optional PO-anchored settlement chain (Model C)

The records do **not** all hang flat off the case (that flat-star shape loses the referential graph — which
invoice for which PO, which payment for which invoice — and would make PMO *less* capable than RIS, whose
chain lives natively in ERPNext underneath). Nor is the **PO** the sole aggregate root (pure PO-anchoring
breaks the moment there is **no PO** — emergency/verbal/sole-source buys, which every major ERP supports as
PO-less / non-PO invoices — forcing a fabricated phantom PO). Instead, two layers:

- **The case (`procurement_id`) is the mandatory structural anchor** — every record carries it; nothing is
  ever orphaned. The optional *sourcing* pipeline (PR, RFQ, Quotation) lives on the case.
- **The PO is the *commercial* anchor of the *settlement* sub-chain when it exists.** Settlement records
  carry a **nullable** predecessor FK — `goods_receipts.po_id`, `vendor_invoices.po_id`,
  `payments.invoice_id` — **and** the mandatory `procurement_id`. With a PO they anchor on it (enabling
  reconciliation / future 3-way match); **without a PO** the FK is null and they anchor on the case. Same
  model, every combination (PR-less, quote-less, PO-less, multi-PO, partial GR, progress payments).

Analogy: **PO : procurement :: won-Project : delivery** — the sourcing pipeline converges onto the PO the
way the sales pipeline converges onto a won Project.

### No fabricated POs; business date ≠ system time

A PO-less procurement is a **first-class supported path**, never a reason to invent a PO. Every record
carries a **user-set business `date`** (the real-world order/receipt/invoice date) **distinct from the
immutable system `created_at`**. Recording a real PO late is data entry on `date` (legitimate); inventing a
PO that never existed is refused by design (the model never *requires* one). An invoice raised before its
PO may be **back-linked** later (`po_id` is nullable and updatable).

**Status remains declared on the case via the SoD-gated `transition_procurement()` RPC.** Records are
**evidence** attached at each phase, *not* the status authority. (Deriving status from documents — as the
ERP-wrapper RIS-portal does — is the future *adapter's* job, not PMO's while it owns the data.) The
**progression history** is the transition log + record events unioned into one single-page timeline; no
separate audit engine.

**Authorization:** no new role. The operational-capture actions (raise PR, issue RFQ, capture quotations,
cut PO, record GR/Invoice/Payment, upload files) are an **operational hat** on the existing
procurement-write set (Admin / PM / Finance). The "actionable from the procurement admin's seat" goal is a
**UI gap** — expose all capture inline on the one procurement page — not a permissions gap. **SoD is
untouched:** approve ≠ requester, pay ≠ approver remain enforced by the RPC + RLS. A dedicated
"Procurement Officer" role is deferred to the OD-PROC-6 config engine.

## Considered options

- **Columns-on-aggregate (today / "stay lean").** Rejected: under-models a genuinely multi-record domain,
  cannot represent partial deliveries / multiple invoices / progress payments, and keeps the
  system-id ↔ reference-id split. "Lean" wrongly applied to the data model.
- **One generic `procurement_documents` register for all types (RIS's model).** Rejected: PMO already has
  typed tables (quotation/GR/VI); a generic row-polymorphic register is *less* type-safe and *less*
  ERP-faithful than finishing the typed-table pattern. The owner explicitly asked "why not each document
  its own table?"
- **Derive status from records (RIS/ERPNext hooks).** Rejected for Supabase-now: PMO owns the data and its
  integrity edge is the SoD-gated transition RPC; record-derived status is the adapter's job once a real
  ERP is the backend.
- **Aggregate root: flat-star (A) vs PO-anchored-pure (B) vs case-spine + PO-anchored chain (C).** Chose
  **C.** A (everything FKs only to the case) loses the referential graph and is less capable than RIS. B
  (the PO *is* the entity) is the ERP-canonical backbone but **breaks on PO-less procurement** (forces a
  fabricated PO). C keeps the case as the always-present structural anchor *and* anchors the settlement
  sub-chain on the PO via nullable predecessor FKs — correct for every combination, portable, and keeps the
  one-page case UX.

## Consequences

- **Revises OD-PROC-2** (which deliberately made PR#/PO# columns and GR/VI header tables "for MVP").
- Schema migration adds 4 tables + RLS (read-in-org, write to the procurement-write set, `org_id` stamp
  trigger) + extends the storage/file-attachment pattern (migration 0028) to every record type.
- The lifecycle RPC changes where it *writes* minted numbers (onto record rows, not aggregate columns) but
  keeps its transition map + SoD gates. pgTAP must re-prove SoD and the new RLS.
- Settlement records carry **nullable** predecessor FKs (`goods_receipts.po_id`, `vendor_invoices.po_id`,
  `payments.invoice_id`) **plus** the mandatory `procurement_id`; pgTAP must prove the PO-less path
  (null FK) and the multi-PO attribution path both work.
- Every record gets an explicit **business `date`** (user-set, backdate-able) distinct from immutable
  `created_at`; reads/labels use the business date, audit uses `created_at`.
- `procurements.pr_number` / `po_number` columns are migrated into the PR/PO records (or retained as a
  denormalized convenience pointer to the latest — to decide in the plan).
- Enables the single-page "Pipeline & Documents" timeline, dual-ID display + upload, and inline
  actionability — the "looks rich but does little" fix.
- Sequenced as **Issue 1** (this foundation); bid-comparison + budget signal ride on top as **Issue 2**.

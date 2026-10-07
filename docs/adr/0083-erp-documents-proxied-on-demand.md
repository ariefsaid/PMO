# ADR-0083 — ERP-rendered client documents are proxied on demand, never stored in PMO

- **Status:** Accepted (Director, 2026-10-07, #912)
- **Deciders:** Director (on the planner's proposal); owner ruling `OD-INV-PDF-1` sets the requirement
- **Related:** ADR-0055 (ERP is SoT for the revenue domain), ADR-0057 (caller-JWT verification in edge functions), ADR-0072 (one ERP credential resolver), `OD-ERP-3`, spec `docs/specs/invoice-pdf.spec.md`

## Context

Under `OD-ERP-3` nobody at the client opens the ERP, yet the client must receive the invoice the books
hold. `OD-INV-PDF-1` rules that for an ERP-connected organisation PMO hands over the ERP's own
print-format PDF of a submitted invoice, so the document matches the ledger.

Two shapes were possible:

1. **Store** — on submit (or first download) fetch the PDF and keep it in a Supabase Storage bucket,
   serving later downloads from the bucket.
2. **Proxy** — every download is a fresh, caller-authorised fetch from the ERP, streamed straight back.

Storing adds a bucket, its RLS, a write path in the money dispatch, a retention policy nobody has ruled
on, and a copy that can drift from the books (a later re-print after an amend, a changed letterhead).
Proxying costs one ERP render per click and depends on the ERP being up at download time.

The same question will recur for every other ERP-rendered document PMO may hand out (vendor bills,
purchase orders, receipts), so it is decided once here.

## Decision

1. **ERP-rendered documents are fetched on demand and streamed to the caller; PMO stores no copy.**
2. The fetch runs in a **dedicated edge function per document family** (first: `external-invoice-pdf`).
   It verifies the caller's JWT, reads every PMO row under the caller's JWT (RLS is the tenancy
   boundary), resolves the ERP document name from PMO's machine-written `external_refs` link (never
   from the request), fixes the document type in code, and uses the service role only for the ERP
   binding and the credential (`resolveErpAuthPair`). The credential never leaves the function.
3. The ERP's **live** docstatus is checked before rendering, in addition to the PMO mirror, so a lagging
   mirror cannot hand out a document the ERP has cancelled.
4. Frappe vocabulary for the render (endpoint path, parameters, PDF validation) lives in
   `pmo-portal/src/lib/adapterSeam/erpnext/` beside the other ERP fetchers (FR-ENA-013 confinement).
5. Layout, letterhead and language are **ERP configuration**, not PMO settings.

## Consequences

- No bucket, no new table, no migration, no retention question for this feature.
- Each download costs one ERP list read and one ERP render; the edge worker is bounded by two 20 s
  deadlines and a 10 MiB cap. If the ERP is down, downloads fail with a retryable message while the rest
  of PMO keeps serving from read-models.
- The document a client receives always reflects the ERP's current print setup; a re-download after the
  operator changes the letterhead yields the new letterhead. If a ruling later requires keeping the
  exact copy that was sent, that is a new decision (store-on-send), not a change to this proxy.
- The no-ERP PDF (#784) is a different producer (PMO renders it) and is not governed by this ADR.
- A new document family adds its own function and its own role rule; it must not widen
  `external-invoice-pdf` into a generic doctype pass-through.

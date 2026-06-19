# Feature: Procurement records — case folder over ERP-canonical record tables (Issue 1)

> **Authority:** ADR-0033 (ACCEPTED). Revises OD-PROC-2 (its column-based shape). Consumes the
> *unchanged* OD-PROC-1 (SoD matrix), OD-PROC-3 (number minting), OD-PROC-4 (state machine),
> OD-PROC-7 (build-time resolutions), OD-PROC-8 (Admin break-glass except SoD), OD-BUDGET-2
> (Committed spend). JTBD oracle: `docs/jtbd.md` → Procurement P1 (this issue), with P2/P3/P4 the
> data-model dependents this foundation must *support* but not *build* (see Out of Scope).
> Glossary: Procurement (case), Procurement record, System-assigned number, External reference
> number, RFQ, Committed spend.

## Overview

Today `procurements` **is** the Purchase Request: PR# and PO# are columns on the aggregate, Payment is
an invoice status, RFQ does not exist, and the real-world reference numbers live in a disconnected
free-form register (`procurement_documents`). Real documents can be uploaded only for quotation/GR/VI —
not for PR/PO/RFQ/Payment. The module "looks rich but does little" (ADR-0033 §Context; JTBD anchor
"dishonest doorway").

This feature reshapes procurement into a **case folder** (`procurements` = title, project, requester,
type, current lifecycle status) over a complete set of **seven ERP-canonical record types**, each its
own **1:N** table: Purchase Request → RFQ → Quotation → Purchase Order → Goods Receipt → Vendor Invoice
→ Payment. Every record carries a **dual identity** — a minted *system-assigned number* + a nullable
free-form *external reference number* — plus status, date, amount, and one or more uploaded files. Status
stays **declared** on the case via the SoD-gated `transition_procurement()` RPC (records are *evidence*,
never the status authority); the RPC keeps its legal-transition map + SoD gates but writes minted numbers
onto **record rows** instead of aggregate columns. The single `/procurement/:id` page gains a progression
**history timeline** (transition log ∪ record-creation events) and **inline capture + upload** of every
record adjacent to its phase — the JTBD P1 "operate the whole case on one page" fix.

This is **Issue 1**: the foundation. The bid-comparison view (P2) and budget signal (P3) ride on top as
Issue 2; the data model here must *support* them (see Out of Scope).

**User value (JTBD P1 — "Operate the case"):** *When I'm running a procurement, I already hold the real
documents (PR, RFQ, quotes, PO, GR, invoice, payment); I want to capture each one — its real reference
number **and** the file — and move the case forward, all on one page, so I don't hunt across screens.*

---

## Functional Requirements

### Record tables & dual identity

**FR-PR-001 — Case folder is not a Purchase Request.**
The system shall model `procurements` as a case folder carrying title, project, requester, type, and the
current lifecycle status, and shall **not** treat the case row as the Purchase Request, Purchase Order, or
any single document.

**FR-PR-002 — Seven canonical record types.**
The system shall provide, hanging off a procurement case, exactly seven typed record kinds, each its own
table: **Purchase Request** (`purchase_requests`, NEW), **RFQ** (`rfqs`, NEW), **Quotation**
(`procurement_quotations`, REUSE), **Purchase Order** (`purchase_orders`, NEW), **Goods Receipt**
(`procurement_receipts`, REUSE), **Vendor Invoice** (`procurement_invoices`, REUSE), **Payment**
(`payments`, NEW).

**FR-PR-003 — 1:N cardinality for every record type.**
The system shall permit **many** records of each type under one case (multiple PRs, multiple RFQs,
multiple quotations, re-issued POs, partial goods receipts, multiple vendor invoices, progress payments),
each related to the case by a `procurement_id` FK with `on delete cascade`.

**FR-PR-004 — RFQ → Quotation 1:N linkage.**
The system shall allow a Quotation to optionally cite the RFQ it answers via a nullable `rfq_id` FK on
`procurement_quotations` (`references rfqs(id)`), so one RFQ may gather many Quotations and a Quotation
may stand alone (no RFQ).

### Aggregate structure — case-spine + optional PO-anchored settlement chain (ADR-0033 Model C)

**FR-PR-004a — Case is the mandatory structural anchor.**
The system shall make `procurement_id` a **non-null** FK on every record (and file) row, so no record is
ever orphaned. The optional sourcing pipeline (PR, RFQ, Quotation) relates to the case directly. (The case
is the always-present handle; the PO is a commercial pivot *within* it — not the aggregate root.)

**FR-PR-004b — Settlement chain anchors on the PO via nullable predecessor FKs.**
The system shall give the settlement records nullable predecessor FKs — `procurement_receipts.po_id`
(→ purchase_orders), `procurement_invoices.po_id` (→ purchase_orders), `payments.invoice_id`
(→ procurement_invoices) — so that **when a PO exists** GR/VI/Payment anchor on it (enabling reconciliation
and a future 3-way match), and **when it does not** the FK is null and they anchor on the case alone.

**FR-PR-004c — PO-less procurement is a first-class path.**
The system shall permit a complete procure-to-pay case with **no Purchase Request, no quotation, and no
Purchase Order** — e.g. a direct/emergency/sole-source buy recorded as Vendor Invoice + Payment only — and
shall **never require** a PO (or any upstream record) to record a GR, Vendor Invoice, or Payment. The
system shall **not** fabricate a placeholder/phantom PO to satisfy the model.

**FR-PR-004d — Invoice may be back-linked to a later PO.**
Where a Vendor Invoice was recorded before its PO, the system shall allow setting its `po_id` later
(the FK is nullable and updatable), without recreating the invoice.

**FR-PR-004e — Business date distinct from system timestamp.**
The system shall give every record a user-set **business `date`** (the real-world order/receipt/invoice/
payment date, which may legitimately predate entry) **separate from** the immutable system `created_at`.
Lists and labels shall display the business `date`; the audit trail (history timeline, `created_at`) shall
use system time. Setting a real past business date is legitimate data entry; it is **not** a fabricated
backdate.

**FR-PR-005 — Org stamp (unspoofable seam).**
The system shall stamp `org_id` on every record row server-side — via the security-definer creation RPC
(computing org from the parent case) or a `BEFORE INSERT` trigger inheriting from the parent — and shall
**never** trust a client-supplied `org_id`. An explicitly client-sent `org_id` is preserved untouched so
a cross-org spoof hits the `WITH CHECK` rather than being silently rewritten (the 0015/0028 stamp
pattern).

**FR-PR-006 — System-assigned number on every record.**
When a record of any type is created, the system shall mint a **system-assigned number** via
`next_procurement_doc_number(org, prefix)` with prefix per type (`PR`, `RFQ`, `VQ`, `PO`, `GR`, `VI`,
`PAY`), format `{PREFIX}-YYMMDD####` (daily-reset, per-org, gap-tolerant), atomically inside the creation
RPC.

**FR-PR-007 — External reference number on every record.**
The system shall provide a nullable, free-form `reference_number text` column on every record table,
captured by the procurement admin alongside the system-assigned number, so a record is findable from
either identity. (Glossary: External reference number.)

**FR-PR-008 — Record header fields.**
The system shall give every record a `status`, a `date` (per type: request/issue/receipt/invoice/payment
date), and an `amount` (`numeric(14,2)`), recorded header-level (not per-line — see Out of Scope §3-way
matching).

**FR-PR-009 — Quotation captures vendor + amount + validity (P2 seam).**
The system shall ensure each Quotation record carries `vendor_id`, `total_amount`, and a nullable
validity (`valid_until date`) so the deferred bid-comparison view (P2) can compare vendor × amount ×
validity with **no further schema change**.

### Files (per-record, mirror migration 0028)

**FR-PR-010 — Per-record file tables for all seven types.**
The system shall provide a per-record file table for **every** record type (extending the 0028
quotation/GR/VI pattern to PR, RFQ, PO, Payment): each file row has `org_id` (stamped), a parent-record
FK `on delete cascade`, `title`, `file_path`, `uploaded_by_id`, `created_at`, and `archived_at`
(soft-archive per ADR-0018).

**FR-PR-011 — One or more files per record.**
The system shall allow **one or more** uploaded files per record (the file tables are 1:N on the parent
record), so a record may attach several documents (e.g. a PO plus its amendment).

**FR-PR-012 — Storage bucket + RLS.**
Where a record file is uploaded, the system shall store the object in the private `procurement-files`
bucket (5 MB cap, MIME allowlist of migration 0028/OD-DOC-5) under a path keyed by
`{org}/{procurement_id}/{record_type}/{record_id}/{file_id}/{filename}`, gated by storage RLS:
read = in-org + path-shape; write = in-org + writer role + path-shape + segment-2 references an in-org
procurement.

**FR-PR-013 — Soft-archive, never hard-delete files.**
When a user removes a record file, the system shall set `archived_at` (soft-archive) rather than delete
the row, and shall exclude archived files from list reads.

### Status authority — the transition RPC (numbers → records)

**FR-PR-014 — Status remains declared via the SoD-gated RPC.**
The system shall keep `transition_procurement(p_id, p_to, p_notes)` as the **single authority** for the
case's lifecycle status, with its existing legal-transition map (OD-PROC-4) and role×transition matrix
(OD-PROC-1) unchanged; records are evidence and shall never set the case status.

**FR-PR-015 — SoD gates intact.**
While a transition is requested, the system shall enforce SoD-a (requester ≠ approver on
`Requested → Approved|Rejected`) and SoD-b (approver ≠ payer on `Vendor Invoiced → Paid`), and shall run
both checks for **every** actor including Admin (Admin break-glass overrides the role matrix but **not**
SoD — OD-PROC-8).

**FR-PR-016 — Minted numbers write onto record rows, not aggregate columns.**
When the RPC mints a system number at a phase boundary, the system shall write that number onto the owning
**record row** (the PR record at `→Requested`, the PO record at `→Ordered`, the Payment record at
`→Paid`) — **not** onto `procurements.pr_number` / `po_number` aggregate columns.

**FR-PR-017 — Permissive record capture (OD-PROC-7-D).**
The system shall allow creating any record (PR, RFQ, quotation, PO, GR, VI, payment) **without** forcing
the matching status transition, and shall allow advancing status without requiring a record — capture and
transition stay independently invocable (records are evidence, the case advance is the declaration).

**FR-PR-018 — Tenant isolation re-asserted in every definer function.**
The system shall re-assert `auth_org_id()` (and `auth_role()` / SoD where applicable) **inside** every
security-definer creation/transition RPC, because definer rights bypass RLS; a parent-case-org guard
(`exists … procurements p where p.id = parent and p.org_id = auth_org_id()`) shall gate every record and
file write.

### Authorization (operational hat — no new role)

**FR-PR-019 — Operational capture = existing procurement-write set.**
The system shall permit operational capture of every record + file upload (raise PR, issue RFQ, capture
quotation, cut PO, record GR/VI/Payment, upload files) to the existing procurement-write roles
(**Admin / Project Manager / Finance**, plus Executive in the table write-set), with **no new role
introduced**.

**FR-PR-020 — Approve and pay remain SoD-gated.**
The system shall keep `Requested → Approved|Rejected` gated to PM/Finance/Executive (≠ requester) and
`Received → Vendor Invoiced → Paid` gated to Finance only (≠ approver), enforced by the RPC + RLS
(unchanged from OD-PROC-1).

**FR-PR-021 — `can()` is UX, RLS is authority.**
The system shall gate every capture/upload/advance affordance with `can(action, entity, ctx)` /
`<CanWrite>` on the real JWT role (impersonation view-only), while RLS/RPC remains the enforcement
authority; the FE may be stricter than RLS (ADR-0016).

### Single-page UX (JTBD P1)

**FR-PR-022 — Full pipeline on one page.**
While a user views `/procurement/:id`, the system shall display the full procure-to-pay pipeline (the
lifecycle stepper) with the case's current declared status, on the single page, without requiring
navigation to other screens.

**FR-PR-023 — Inline capture + upload adjacent to each phase.**
While a user with the operational hat views the case, the system shall present, adjacent to each phase, an
inline affordance to capture a record of that phase's type (its external reference, date, amount, status)
**and** upload one or more files — without leaving the page.

**FR-PR-024 — Both identities shown per record.**
The system shall display, for every record, **both** the system-assigned number and the external
reference number (when present), so the record is recognizable from either identity.

**FR-PR-025 — Progression history timeline.**
While a user views the case, the system shall display a chronological **progression history** = the
status-transition events ∪ the record-creation events, unioned into one single-page timeline. Status-
transition events are persisted to an **append-only `procurement_status_events` log** (one row per
transition: `from_status`, `to_status`, `actor_id`, `notes`, `created_at`) written **inside**
`transition_procurement` — they are **not** reconstructable from terminal stamps (rejections / re-cycles /
multiple approvals would be lost). Record-creation events derive from each record's `created_at`. The log is
the lightweight "transition log" of ADR-0033 (read-in-org, no direct write — RPC-only), **not** a separate
audit engine.

**FR-PR-026 — Advance-the-case action present (honest doorway).**
The system shall present the advance-the-case action(s) on the single page, and shall ensure **every**
affordance the page implies actually works (no dead/placeholder controls — JTBD "honest doorway"); a
routine forward advance is single-click + toast, consequential transitions (Approve/Reject/Cancel/Pay)
are confirm-gated (OD-UX-1).

### Backward compatibility & migration

**FR-PR-027 — Existing PR#/PO# carried into records.**
When the migration runs, the system shall create, for each existing procurement that has a non-null
`pr_number` (resp. `po_number`), a corresponding `purchase_requests` (resp. `purchase_orders`) record
carrying that number as its system-assigned number, so no existing case loses its PR#/PO#.

**FR-PR-028 — Existing quotation/GR/VI rows preserved.**
The system shall leave existing `procurement_quotations` / `procurement_receipts` /
`procurement_invoices` rows (and their 0028 file rows) intact and visible after the model change; the
`rfq_id` / `valid_until` additions to quotations are nullable and non-breaking.

**FR-PR-029 — Free-form `procurement_documents` register survives.**
The system shall retain the `procurement_documents` register as an "Other / misc attachment" catch-all
(or fold it in — the eng-plan decides the mechanics; see Open Questions), so no historical reference rows
are lost.

**FR-PR-030 — Aggregate `pr_number`/`po_number` columns deprecation path.**
Where the migration moves PR#/PO# onto records, the system shall either retain
`procurements.pr_number` / `po_number` as a denormalized convenience pointer to the latest record or drop
them after backfill (the eng-plan decides — ADR-0033 §Consequences; see Open Questions), without breaking
any read that currently selects them until that read is migrated.

---

## Observed / legacy behavior to preserve (OBS)

**OBS-PR-001 — Minter contract.** `next_procurement_doc_number(p_org, p_prefix)` is an internal-only
security-definer helper (NOT granted to `authenticated`); only the creation/transition RPCs call it. New
prefixes (`RFQ`, `PAY`) reuse this same minter — no new minting mechanism. (Migration 0006 §A4; OD-PROC-7-C.)

**OBS-PR-002 — `select_procurement_quote` RPC.** The quote-selection authority (sets `is_selected`, syncs
header total/vendor, advances `Vendor Quoted → Quote Selected`, role-gated Admin/PM/Finance) stays as the
sourcing authority; adding `rfq_id`/`valid_until` to quotations must not change its behavior. (Migration 0015.)

**OBS-PR-003 — Committed-spend basis unchanged.** Committed spend stays `Σ procurements.total_value WHERE
status IN ('Ordered','Received','Vendor Invoiced','Paid')` (`COMMITTED_STATUSES`, OD-BUDGET-2) — driven by
the **case status**, not by record rows. The record redesign must not change what `getCommittedSpend`
reads. (`src/lib/db/procurements.ts`.)

**OBS-PR-004 — `force row level security` on every business table.** Every new table inherits ADR-0004
force-RLS so even the table owner is subject to policies. (Migrations 0006/0028 precedent.)

**OBS-PR-005 — VQ co-located capture.** Vendor-invoice capture co-located with the Mark-Vendor-Invoiced
transition (OD-W3-3) and quote evidence-with-state patterns stay; inline record capture in FR-PR-023
generalizes this pattern to all phases.

---

## Non-Functional Requirements

### Security (OWASP / STRIDE) — see dedicated section below

- **NFR-PR-SEC-001 — Force-RLS + write-gate on every new table.** Every new table (`purchase_requests`,
  `rfqs`, `purchase_orders`, `payments`, and their four file tables) has `enable` + `force` RLS, a
  read-in-org `select` policy, and a write policy gated on `auth_role() ∈ {Admin,Executive,Project
  Manager,Finance}` + parent-case-org guard.
- **NFR-PR-SEC-002 — Atomic minting.** Number minting stays collision-free under concurrency (the
  `insert … on conflict do update … returning` single statement, NFR-PROC-SEQ-001) and gap-tolerant.
- **NFR-PR-SEC-003 — `reference_number` is untrusted free-form text.** External reference numbers and file
  `title`s are user-controlled free text — they shall be rendered as **text, never HTML/markup** (React's
  default escaping; no `dangerouslySetInnerHTML`), and used only as parameterized values (never string-
  concatenated into SQL — all writes go through parameterized RPC/PostgREST). Length-bounded on the
  client.
- **NFR-PR-SEC-004 — Definer search_path pinned.** Every security-definer function pins
  `set search_path = public` and schema-qualifies table refs (LOW-BV-1).
- **NFR-PR-SEC-005 — Minter not client-callable.** The new prefixes do not change OBS-PR-001: the minter
  stays revoked from `authenticated`/`anon`.

### Performance

- **NFR-PR-PERF-001 — Parent index per record + file table.** Each record table is indexed on
  `(procurement_id)`; each file table on `(parent_record_id, created_at desc) where archived_at is null`
  (the 0028 partial-index hot-path).
- **NFR-PR-PERF-002 — Single-page load.** The `/procurement/:id` page fetches the case + all record types
  + history in a bounded set of queries (repository seam, ADR-0017); the history union is computed without
  an N+1 per record.

### Accessibility (WCAG 2.1 AA)

- **NFR-PR-A11Y-001 — Inline capture forms keyboard-operable.** Every inline capture + upload affordance is
  reachable and operable by keyboard, with visible focus, programmatic labels on every field, and file
  inputs that announce selected filename.
- **NFR-PR-A11Y-002 — Timeline semantics.** The progression history is a semantic list with an accessible
  name; each event's role/actor/timestamp is in the accessible text (not color-only).
- **NFR-PR-A11Y-003 — Both-IDs not color-only.** The system-assigned vs external reference distinction is
  conveyed by label/text, not color alone; `axe-core` passes with zero violations on the page.

### Responsive

- **NFR-PR-RESP-001 — No horizontal bleed @390/360.** The single page (stepper, record cards, timeline,
  inline forms) reflows with no element exceeding the viewport at 390px and 360px (the
  `AC-MOBILE-OVERFLOW-001` gate); the lifecycle stepper uses the established `overflow-x` pattern.
- **NFR-PR-RESP-002 — Touch targets ≥44px** on every capture/upload/advance control.

---

## Acceptance Criteria

> Layer per ADR-0010: **Unit** (Vitest/RTL) for logic/render; **pgTAP** for RLS/tenancy/SoD/role
> read+write contracts; **E2E** (Playwright, curated) for cross-stack journeys. Each AC names its owning
> layer; the traceability table records the canonical owner.

### Schema, tables & dual identity

**AC-PR-001 — Four new tables exist with required columns. [pgTAP]**
Given the migration is applied,
When the schema is inspected,
Then `purchase_requests`, `rfqs`, `purchase_orders`, `payments` each exist with `id`, `org_id` (not null,
default seed-org), `procurement_id` (FK → procurements, on delete cascade), a `*_number` system column,
`reference_number` (nullable text), `status`, a date column, and `amount numeric(14,2)`.

**AC-PR-002 — 1:N cardinality. [pgTAP]**
Given a procurement case,
When two purchase_orders (and two payments, two goods receipts) are inserted for it,
Then both rows persist (no unique constraint forbids multiple records of a type per case).

**AC-PR-003 — RFQ → Quotation 1:N. [pgTAP]**
Given an RFQ record and two quotations citing its `rfq_id`,
When the quotations are inserted,
Then both persist and join back to the one RFQ; a quotation with null `rfq_id` is also valid.

**AC-PR-004 — System number minted per record. [pgTAP]**
Given a creation RPC for a record type,
When a record is created,
Then its system-assigned number matches `{PREFIX}-YYMMDD####` for that type's prefix and increments
per-org-per-day.

**AC-PR-005 — External reference captured and round-trips. [Unit]**
Given the inline capture form for a record,
When the user enters an external reference number and saves,
Then the saved record exposes both the minted system number and the external reference, and both render
on the card.

**AC-PR-006 — Quotation carries vendor+amount+validity (P2 seam). [pgTAP]**
Given the migration is applied,
When `procurement_quotations` is inspected,
Then it has `rfq_id` (nullable FK → rfqs) and `valid_until` (nullable date) in addition to its existing
vendor/amount columns.

### Aggregate structure & PO-less path (Model C)

**AC-PR-028 — Case is a non-null anchor; settlement FKs are nullable. [pgTAP]**
Given the migration is applied,
When the schema is inspected,
Then `procurement_id` is `not null` on every record table, while `procurement_receipts.po_id`,
`procurement_invoices.po_id` (→ purchase_orders) and `payments.invoice_id` (→ procurement_invoices) exist
and are **nullable**.

**AC-PR-029 — PO-less case: invoice + payment with null po_id persist. [pgTAP]**
Given a procurement case with no PR, no quotation, and no PO,
When a Vendor Invoice (`po_id` null) and a Payment (`invoice_id` → that invoice) are created,
Then both persist and read back under the case — no PO is required or fabricated.

**AC-PR-030 — Settlement anchors on the PO when present; multi-PO attribution. [pgTAP]**
Given a case with two POs and an invoice whose `po_id` points to the second PO,
When the invoice is read,
Then it attributes to the correct PO (the `po_id` resolves to PO #2, not #1).

**AC-PR-031 — Invoice back-links to a later PO. [pgTAP]**
Given a Vendor Invoice created with `po_id` null,
When a PO is later created and the invoice's `po_id` is set to it,
Then the update succeeds and the invoice is not recreated (FK nullable + updatable).

**AC-PR-032 — Business date is user-set and distinct from created_at. [pgTAP]**
Given a record created today with a business `date` of a prior day,
When the row is read,
Then `date` is the prior (user-set) day and `created_at` is the system insert time — the past business
date is accepted and the two differ.

**AC-PR-033 — Each transition appends an append-only status-event. [pgTAP]**
Given a case transitioned Requested → Approved → Ordered,
When `procurement_status_events` is read for the case,
Then there is one row per transition (from/to/actor/created_at, chronological), the log is readable
in-org, and a direct client `insert`/`update` to the table is denied (RPC-only, append-only).

### Files

**AC-PR-007 — Per-record file tables for all seven types. [pgTAP]**
Given the migration is applied,
When the schema is inspected,
Then a file table exists for PR, RFQ, PO, and Payment (extending the existing quotation/GR/VI file tables),
each with `org_id`, parent FK on delete cascade, `title`, `file_path`, `uploaded_by_id`, `created_at`,
`archived_at`.

**AC-PR-008 — Multiple files per record. [pgTAP]**
Given a record,
When two file rows are attached,
Then both persist (file tables are 1:N on the record).

**AC-PR-009 — Soft-archive excludes from list. [Unit]**
Given a record with two files,
When one file is archived (`archived_at` set),
Then the file list read returns only the non-archived file.

**AC-PR-010 — Storage RLS path-shape + org gate. [pgTAP]**
Given a user in org A,
When they attempt to read/write a `procurement-files` object whose path segment-1 is org B (or
segment-2 references an out-of-org procurement),
Then the storage policy denies it; an in-org, writer-role, correct-path write succeeds.

### Status authority & SoD (RPC)

**AC-PR-011 — Minted number lands on the record row, not the aggregate. [pgTAP]**
Given a case at `Requested` transitions to `Approved`→`Ordered`,
When the PO phase is reached,
Then the PO **record row** carries the minted `PO-…` number (and the PR record carries the `PR-…`),
proving numbers write to records (FR-PR-016).

**AC-PR-012 — SoD-a: requester cannot approve own case. [pgTAP]**
Given the requester of a `Requested` case,
When they call `transition_procurement(..,'Approved')`,
Then it raises 42501 (separation of duties), even for an Admin requester (OD-PROC-8).

**AC-PR-013 — SoD-b: approver cannot pay own case. [pgTAP]**
Given the approver of a `Vendor Invoiced` case,
When they call `transition_procurement(..,'Paid')`,
Then it raises 42501.

**AC-PR-014 — Permissive capture (no forced transition). [pgTAP]**
Given a case at `Ordered`,
When a goods-receipt record is created via its RPC,
Then the record persists and the case status stays `Ordered` (capture does not force the transition,
OD-PROC-7-D).

**AC-PR-015 — Cross-org record write blocked. [pgTAP]**
Given a user in org A,
When they attempt to create a record under org B's procurement (or send org B's `org_id`),
Then the parent-org guard / `WITH CHECK` denies it (42501).

### Authorization (operational hat)

**AC-PR-016 — Operational capture allowed to write-set. [pgTAP]**
Given an Admin / PM / Finance user,
When they create a PR / RFQ / PO / Payment record under an in-org case,
Then the write succeeds; no new role is required.

**AC-PR-017 — Engineer cannot capture org-wide records. [pgTAP]**
Given an Engineer (not the requester),
When they attempt to write a record under another user's case,
Then RLS denies it (the existing own-scoped Engineer contract is preserved).

**AC-PR-018 — `can()` gates affordances on real role. [Unit]**
Given an impersonating user / an Engineer,
When the case page renders,
Then capture/upload/advance affordances are hidden per `can()` on the real JWT role, while RLS remains the
authority.

### Single-page UX (P1)

**AC-PR-019 — One page shows pipeline + history + both IDs + inline capture. [E2E]**
Given a procurement admin on `/procurement/:id`,
When the page loads,
Then they see the full pipeline, the progression history timeline, each record with **both** its system
number and external reference, and an inline capture+upload affordance adjacent to each phase — without
navigating away.

**AC-PR-020 — Capture a record + upload a file, then advance, on one page. [E2E]**
Given a procurement admin on the case page,
When they capture a record (external ref + date + amount), upload a file, and advance the case,
Then the record + file appear under their phase, the history timeline gains the capture and transition
events in order, and the case status updates — all without leaving the page (JTBD P1, honest doorway).

**AC-PR-021 — Progression history unions transitions and record events chronologically. [Unit]**
Given a case with N transitions and M record creations,
When the history model is built,
Then it yields N+M events sorted chronologically, each labeled with kind/actor/timestamp.

**AC-PR-022 — No dead affordances (honest doorway). [E2E]**
Given the case page,
When each implied affordance (capture, upload, advance) is exercised,
Then each performs its action (none is a no-op/placeholder).

### Backward compatibility & migration

**AC-PR-023 — Existing PR#/PO# carried into records. [pgTAP]**
Given pre-migration procurements with `pr_number`/`po_number`,
When the migration runs,
Then each yields a `purchase_requests`/`purchase_orders` record carrying that number, and the case loses
no PR#/PO#.

**AC-PR-024 — Existing quotation/GR/VI rows intact. [pgTAP]**
Given pre-migration quotation/receipt/invoice rows and their 0028 files,
When the migration runs,
Then all rows + files remain readable and unchanged; new quotation columns (`rfq_id`,`valid_until`) are
null.

**AC-PR-025 — Committed spend unchanged. [pgTAP]**
Given a project with committed procurements,
When committed spend is computed after migration,
Then it equals the pre-migration value (driven by case status, OD-BUDGET-2 — OBS-PR-003).

### NFRs

**AC-PR-026 — Page passes axe-core (WCAG-AA). [E2E]**
Given the `/procurement/:id` page rendered with records and history,
When `axe-core` runs,
Then there are zero violations.

**AC-PR-027 — No horizontal bleed @390/360. [E2E]**
Given the case page at viewport 390px and 360px,
When rendered with records, timeline, and inline forms,
Then no element's right edge exceeds the viewport (the `AC-MOBILE-OVERFLOW-001` measuring gate).

---

## Traceability

| AC | Owning layer | Owning test (name / file) |
|---|---|---|
| AC-PR-001 | pgTAP | `AC-PR-001 four new record tables exist` (`supabase/tests/procurement_records_schema_test.sql`) |
| AC-PR-002 | pgTAP | `AC-PR-002 records are 1:N per case` |
| AC-PR-003 | pgTAP | `AC-PR-003 rfq to quotation 1:N` |
| AC-PR-004 | pgTAP | `AC-PR-004 system number minted per record type` |
| AC-PR-005 | Unit | `AC-PR-005 external reference round-trips` (`pages/procurement/*Section.test.tsx`) |
| AC-PR-006 | pgTAP | `AC-PR-006 quotation has rfq_id and valid_until` |
| AC-PR-007 | pgTAP | `AC-PR-007 per-record file tables for all types` |
| AC-PR-008 | pgTAP | `AC-PR-008 multiple files per record` |
| AC-PR-009 | Unit | `AC-PR-009 archived file excluded from list` |
| AC-PR-010 | pgTAP | `AC-PR-010 storage RLS path + org gate` (`supabase/tests/procurement_records_rls_test.sql`) |
| AC-PR-011 | pgTAP | `AC-PR-011 minted number on record row` (`..._transition_test.sql`) |
| AC-PR-012 | pgTAP | `AC-PR-012 SoD-a requester cannot approve own` |
| AC-PR-013 | pgTAP | `AC-PR-013 SoD-b approver cannot pay own` |
| AC-PR-014 | pgTAP | `AC-PR-014 capture does not force transition` |
| AC-PR-015 | pgTAP | `AC-PR-015 cross-org record write blocked` |
| AC-PR-016 | pgTAP | `AC-PR-016 write-set may capture records` |
| AC-PR-017 | pgTAP | `AC-PR-017 engineer cannot capture org-wide` |
| AC-PR-018 | Unit | `AC-PR-018 can() gates affordances on real role` |
| AC-PR-019 | E2E | `AC-PR-019 one page shows pipeline history ids capture` (`e2e/AC-PR-019-single-page.spec.ts`) |
| AC-PR-020 | E2E | `AC-PR-020 capture upload advance on one page` (`e2e/AC-PR-020-capture-advance.spec.ts`) |
| AC-PR-021 | Unit | `AC-PR-021 history unions transitions and records` |
| AC-PR-022 | E2E | `AC-PR-022 no dead affordances` (folded into AC-PR-019/020 journey) |
| AC-PR-023 | pgTAP | `AC-PR-023 existing PR#/PO# carried into records` |
| AC-PR-024 | pgTAP | `AC-PR-024 existing quotation/GR/VI intact` |
| AC-PR-025 | pgTAP | `AC-PR-025 committed spend unchanged` |
| AC-PR-026 | E2E | `AC-PR-026 procurement detail axe-core clean` |
| AC-PR-027 | E2E | `AC-MOBILE-OVERFLOW-001` (existing route sweep covers `/procurement/:id`) |
| AC-PR-028 | pgTAP | `AC-PR-028 case non-null anchor, settlement FKs nullable` (`..._schema_test.sql`) |
| AC-PR-029 | pgTAP | `AC-PR-029 PO-less invoice+payment persist` (`..._rls_test.sql`/`..._chain_test.sql`) |
| AC-PR-030 | pgTAP | `AC-PR-030 settlement anchors on correct PO (multi-PO)` |
| AC-PR-031 | pgTAP | `AC-PR-031 invoice back-links to later PO` |
| AC-PR-032 | pgTAP | `AC-PR-032 business date distinct from created_at` |
| AC-PR-033 | pgTAP | `AC-PR-033 transition appends append-only status-event` (`..._transition_test.sql`) |

---

## SoD & Security (OWASP / STRIDE)

**Spoofing / tenancy (STRIDE-S, OWASP A01 broken access control).** Every new table is `enable`+`force`
RLS with read-in-org `select` and write gated on `auth_role()` ∈ the write-set + a **parent-case-org
guard**. `org_id` is server-stamped (RPC computes it from the parent; trigger inherits it) and never
client-trusted; an explicit cross-org `org_id` is preserved so it hits `WITH CHECK` (42501) rather than
being rewritten (the 0015/0028 seam). Storage RLS keys on the org segment + an in-org-procurement
existence check (FR-PR-012).

**Tampering / elevation (STRIDE-T/E, OWASP A01).** Status remains declared only via
`transition_procurement` (security-definer, re-asserting org+role+SoD internally — definer bypasses RLS).
SoD-a/SoD-b run for **every** actor incl. Admin (OD-PROC-8); Admin break-glass overrides the role matrix
but not SoD. Records cannot move status — they are evidence (FR-PR-014/017). The minter stays
internal-only (revoked from `authenticated`), called only by definer RPCs (OBS-PR-001/NFR-PR-SEC-005).

**Injection / XSS (OWASP A03).** `reference_number` and file `title` are untrusted free-form text:
rendered as text via React's default escaping (no `dangerouslySetInnerHTML`), written only through
parameterized RPC/PostgREST (never string-concatenated SQL), and length-bounded client-side
(NFR-PR-SEC-003). Definer functions pin `search_path = public` and schema-qualify (NFR-PR-SEC-004).

**Repudiation (STRIDE-R).** The progression history (transition events ∪ record-creation events, with
actor + timestamp) is the lightweight audit trail (ADR-0033 — no separate audit engine); `created_at` +
`uploaded_by_id` on file rows, `approved_by_id`/notes on the case give the evidentiary record.

**Concurrency (NFR-PR-SEC-002).** Number minting is collision-free (single `on conflict do update …
returning` statement) and gap-tolerant; the transition RPC `select … for update` locks the case row to
serialize concurrent transitions.

**Depth note (model-tiering).** This change touches auth/RLS/RPC/storage surfaces heavily — the
security-auditor should run at full depth on the four new tables + four new file tables + the revised
transition RPC minting target + the storage policy, and confirm the migration's backfill (FR-PR-027)
cannot leak cross-org rows.

---

## Error Handling

| Error condition | Surface / code | User message |
|---|---|---|
| Illegal status transition | RPC `P0001` | "That step isn't allowed from the current status." |
| Not authorized (role/tenant) | RPC/RLS `42501` | "You don't have permission to do that." |
| SoD violation (requester=approver / approver=payer) | RPC `42501` | "Separation of duties: you can't approve/pay your own request." |
| Parent case not found | RPC `P0002` | "This procurement no longer exists." |
| File over 5 MB / disallowed type | Storage `400` | "File too large (max 5 MB) or unsupported type." |
| Reference number too long | Client validation | "Reference number is too long." |
| Cross-org write attempt | RLS `WITH CHECK` `42501` | "You don't have permission to do that." |

---

## Implementation TODO

### Backend (migrations + RPC)

- [ ] Migration: create `purchase_requests`, `rfqs`, `purchase_orders`, `payments` (cols per AC-PR-001;
      `(procurement_id)` index each) with `enable`+`force` RLS, read-in-org `select`, write policy
      (role + parent-case-org guard), and `BEFORE INSERT` org-stamp triggers (0015 pattern).
- [ ] Migration: add `rfq_id` (FK → rfqs) + `valid_until` to `procurement_quotations` (nullable,
      non-breaking).
- [ ] Migration: per-record file tables for PR/RFQ/PO/Payment (mirror 0028) + storage RLS extended to the
      new `record_type` path segment.
- [ ] New creation RPCs `create_purchase_request / create_rfq / create_purchase_order / create_payment`
      (security-definer, parent-org guard + role gate + `next_procurement_doc_number` with new prefixes
      `RFQ`/`PAY`) — reuse the minter (OBS-PR-001).
- [ ] Revise `transition_procurement` to write minted PR#/PO#/PAY# onto the owning **record rows** (not
      `procurements.pr_number/po_number`); keep map + SoD untouched. Decide aggregate-column
      retention/drop (FR-PR-030 / Open Q).
- [ ] Migration backfill: existing `pr_number`/`po_number` → PR/PO records (FR-PR-027); preserve
      `procurement_documents` (FR-PR-029).
- [ ] pgTAP: schema, RLS/tenancy, SoD-a/b, minting-on-record, permissive-capture, cross-org-deny,
      committed-spend-unchanged, backfill (AC-PR-001..004,006..008,010..017,023..025).

### Frontend (repository seam + page)

- [ ] Repositories for the four new record types + their file tables (`src/lib/repositories/*`), typed
      from regenerated DB types (regenerate, do not hand-cast).
- [ ] Extend `procurementLifecycle.ts` / lifecycle TS for new record creators + the history-union model.
- [ ] `/procurement/:id` single page: pipeline + progression-history timeline + per-phase inline
      capture+upload + dual-ID display + advance action (FR-PR-022..026), gated via `can()` / `<CanWrite>`.
- [ ] Unit tests: external-ref round-trip, archived-file exclusion, `can()` gating, history-union
      (AC-PR-005,009,018,021).

### E2E / gates

- [ ] `e2e/AC-PR-019-single-page.spec.ts`, `e2e/AC-PR-020-capture-advance.spec.ts` (P1 journey incl.
      honest-doorway AC-PR-022).
- [ ] axe-core pass on the page (AC-PR-026); confirm `AC-MOBILE-OVERFLOW-001` covers `/procurement/:id`
      @390/360 (AC-PR-027).
- [ ] Full `npm run verify` before PR; visual gate (render the page before promote — MEMORY durable rule).

---

## Out of Scope (deferred — Issue 2 and beyond)

- **Bid-comparison VIEW (JTBD P2).** Deferred to Issue 2. The data model here **must support it**:
  quotations capture `vendor_id` + `total_amount` + `valid_until` (FR-PR-009/AC-PR-006), 1:N per case /
  per RFQ — no further schema change needed for P2.
- **Budget signal (JTBD P3; OD-W5-4/-5 advisory-vs-blocking).** Deferred to Issue 2. The committed-spend
  basis is unchanged (OBS-PR-003); P3 reads the existing derivation. Advisory-vs-blocking remains an open
  owner decision (OD-W5-4 advisory now; OD-W5-5 PO-commitment gate is a separate feature track).
- **Per-line 3-way matching** (PO line ↔ GR line ↔ invoice line). Deferred — records are **header-level**
  with amount, multiple-per-phase, but not line-matched (consistent with OD-PROC-2's deferred line
  matching).
- **Derive status from records.** Deferred — status stays declared via the SoD-gated RPC (FR-PR-014);
  record-derived status is the future ERP-adapter's job (ADR-0033).
- **Odoo / ERPNext adapter, multi-tenant activation, "Procurement Officer" role** (OD-PROC-6 config
  engine). All future; the record set is the seam an adapter will map onto, and `org_id` the multi-tenant
  seam — both forward-compatible here, neither built.
- **Petty cash / reimbursement** (OD-PROC-5) — separate flow, not in `procurements`.

---

## Open Questions — RESOLVED (Director adjudication, 2026-06-19)

All four are technical, within the signed scope — resolved by the Director so the eng-plan has no
ambiguity. Recorded here; the eng-planner consumes these as decided.

- [x] **OQ-1 — `procurement_documents` fate (FR-PR-029). RESOLVED: keep** as the typed "Other / misc
      attachment" catch-all (do **not** fold/migrate its rows). Least migration risk; preserves historical
      free-form reference rows; add file upload to it so it's a real misc-doc bucket.
- [x] **OQ-2 — Aggregate `pr_number`/`po_number` retention (FR-PR-030). RESOLVED: retain denormalized**
      as a "latest PR/PO number" convenience pointer for **one cycle**, mark deprecated in a comment, drop
      in a later issue. Avoids a big read-migration of `ProcurementDetails.tsx` + lifecycle TS inside this
      issue. The record row is the authority; the column is a cache.
- [x] **OQ-3 — PR record creation timing. RESOLVED: the transition RPC upserts/creates the PR record at
      `→Requested`** (so every requested case has exactly one canonical PR record carrying the minted PR#),
      while additional PR records may be captured inline (FR-PR-003). Preserves the no-PR#-loss guarantee
      and OBS behavior. Same pattern applies to PO at `→Ordered` and Payment at `→Paid` (the
      transition-owned record), with extra records of those types capturable inline.
- [x] **OQ-4 — Payment vs `Paid` status. RESOLVED: payments are 1:N evidence records** (progress
      payments) under a case that reaches the single terminal `Paid` status **once** (SoD-b gated). The
      payer's `→Paid` transition is the declaration; the payment records are the evidence trail
      (consistent with FR-PR-014). Multiple payment records may precede the single `Paid` declaration.

---

## Contradictions / conflicts flagged against existing code & locked decisions

1. **OD-PROC-2 (column shape) is explicitly *revised* by ADR-0033** — not a conflict, but the spec must
   not be read against the original OD-PROC-2 text (PR#/PO# columns, GR/VI header tables). The decisions
   log already marks OD-PROC-2 "⚑ REVISED". **No contradiction with any *still-locked* OD-\*.**

2. **`VQ` prefix vs "Quotation" record name.** OD-PROC-3 mints quotations with prefix `VQ` (Vendor
   Quote); the new glossary/ADR names the record **"Quotation"**. The minter prefix stays `VQ` (existing
   data + OBS-PR-001) while the UI label is "Quotation". Flagged so the eng-plan keeps prefix `VQ` and
   does **not** rename to `QT` (would orphan existing `VQ-…` numbers). Not a blocker — a naming note.

3. **No new prefixes were defined in OD-PROC-3** for `RFQ` and `PAY`. OD-PROC-3 lists `PR/VQ/PO/GR/VI`
   only. This spec adds `RFQ` and `PAY` prefixes (FR-PR-006). This is **within** the OD-PROC-3 minting
   mechanism (same `next_procurement_doc_number` helper, same format) — a forward extension, not a
   conflict — but the Director should note it as a (minor) extension of the locked OD-PROC-3 prefix list.

4. **OBS-PR-003 / OD-BUDGET-2 dependency.** Committed spend reads `procurements.total_value` by **case
   status**, not records. Because records are now where amounts live per-phase, there is a latent future
   question (which amount is authoritative for committed spend once POs are records?) — **out of scope
   here** (status-driven basis unchanged), but flagged: Issue 2's budget signal must not silently change
   the committed basis without an owner decision.

5. **`select_procurement_quote` + new quotation columns.** Adding `rfq_id`/`valid_until` to
   `procurement_quotations` must not perturb the existing select-quote RPC (OBS-PR-002). Low risk
   (nullable adds), flagged for the pgTAP regression set.

No hard contradiction with any currently-locked OD-* decision was found; ADR-0033 is the controlling
authority and only revises the already-superseded OD-PROC-2.

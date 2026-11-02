# Glossary

Canonical domain language for the PMO Portal. Terms here are binding across specs, code, and
conversation — when everyday usage conflicts with a definition below, the definition wins.
Implementation details do not belong in this file.

---

**Delivery** — the post-win, pre-handover execution of a project. Finite: it ends at
handover/commissioning. One of the nine business spines (see `docs/roadmap-spines.md`).

**Milestone** — a named, ordered chunk of delivery work within a single project (e.g.
"Engineering design", "Procurement", "Site construction"). Carries a percent-complete, a
target date, and a weight. Created free-form per project — there is no org-level milestone
taxonomy. Progress is held in two columns: a *calculated* percent (derived from its tasks'
completion; empty when it has no tasks) and an *input* percent (typed by the PM, optional).
The effective percent is the input value when present, otherwise the calculated one, or zero
when neither exists. Calculated progress excludes subtasks and archived tasks. Both values are
shown side by side, so any divergence between the PM's figure and task-derived progress is
self-evident. A project's overall delivery progress is the weight-weighted rollup of its
milestones' effective percent; it is unavailable (null) when no milestone has a progress signal.
⚠ Deliberate deviation from strict PM vocabulary: here a milestone is a *work chunk that
progresses*, not a zero-duration checkpoint event.
**Shown to users as "Phase" / "Fase"** (DD-VOCAB-1); "milestone" stays the model, code and spec term.

**Task** — the smallest unit of tracked work. Belongs to a project; may optionally be grouped
under exactly one milestone. The delivery hierarchy is two levels only: milestone → tasks
(decided 2026-06-11; deeper nesting deferred until a real customer needs it).

**Document** — a controlled file record in a project's document register (drawing,
specification, report, contract …). Carries a category, a revision mark, and a lifecycle
status with separation-of-duties approval (approver ≠ author). A register entry can have one
PMO-held upload, one linked Microsoft 365 file (SharePoint or OneDrive), or no attached source
yet; it cannot have both sources. A linked Microsoft 365 folder may also appear as a
reference-only entry, but it is not an issuable or approvable document file. Once a controlled
file is issued, content changes require a new revision: PMO prevents changes to a held upload,
while a linked file can change at Microsoft and PMO detects that change (see **Content drift**).
(One-source rule decided 2026-06-12; linking decided 2026-07-29.)

**Content drift** — a linked document file's currently observed content differs from the
content baseline recorded when it was issued. Each verification compares against that same
issue-time baseline, not the result of the previous check. The result is **Changed**,
**Unchanged**, or **Not verified**; an unavailable check is never a clean result. A Microsoft
rename is a name change, not content drift. Drift is detected, never prevented — PMO does not
own the bytes — and a drifted document **keeps whatever status it had**. Resolving drift is an
explicit act: the user creates a new revision from the current file, which walks the normal
lifecycle. (Decided 2026-07-29.)

**Revision** — a successive issue of the same document (Rev A → Rev B …). Each revision is
its own register entry and walks the full lifecycle itself. A revision is always created
*from* its predecessor — that explicit act is what links the lineage (no name/code matching).
Prior revisions are not deleted or hidden. When a successor is Approved, only its immediate
predecessor is automatically marked Superseded, and only if that predecessor is Issued or
Approved. A Closed predecessor and earlier ancestors keep their status.

**Superseded** — terminal document status meaning "replaced by an Approved successor revision
of the same document". Approval automatically moves only the immediate predecessor to this
status, and only when that predecessor is Issued or Approved. A Closed predecessor and earlier
ancestors are unchanged. Read-only, reached automatically, never hand-picked.

**O&M (Service)** — recurring post-handover service performed under its own contract
(maintenance schedules, breakdown response, installed-asset care). NOT part of Delivery:
delivery is finite, O&M is recurring. The handover of a delivered project is the birth event
of an O&M contract. Spine 9 in the spine model.

**Spine** — one of the nine top-level business-capability domains a project contractor runs on
(Commercial, Cost/AP, Delivery, Revenue/AR, CRM, HSE/Quality, Documents, Resources/Assets,
Service/O&M). Defined in `docs/roadmap-spines.md`.

**Active contract value** (shown on dashboards as **Contract on hand**) — the sum of signed contract values of projects whose status is Ongoing (its own status filter: won-but-not-started and closed-out projects are excluded). Positions are shown per currency and never blended. It is **not** earned revenue: revenue accrues only on work performed and billed, while contract value on hand is the value still to deliver. Delivery-risk figures and delivery charts each qualify their own cohort in their help text; "delivery" alone is not a status filter.

**Committed spend** (canonical: OD-BUDGET-2) — a project's open purchase commitment: Σ open commitment over its procurement cases in statuses `Ordered`, `Received`, `Vendor Invoiced`, `Paid`. Each case counts in its own currency — positions are never blended across currencies. Where the organisation reads its ledger from its ERP, a case contributes its total minus the amounts the ledger already holds for it (never below zero); otherwise the full case total is the commitment (the PMO-proxy basis). This is the single live committed basis used throughout the app: project header "Committed" tile, the Finance dashboard, the Delivery summary, and the at-risk threshold. The stored `projects.spent` column (seeded to 0, never auto-populated) is **not** this value and is not read by any tile. Code reference: `COMMITTED_STATUSES` in `pmo-portal/src/lib/db/procurements.ts`; SQL `project_committed_spend`.

**Actual (Recorded spending)** — the one cost figure every money surface shows for a project. Where the organisation reads its ledger from its ERP, it is the project's mapped ledger cost; otherwise it is **Committed spend** — the committed-purchase proxy. It is therefore not always the same number as Committed spend (the two coincide only on the proxy basis), and it is never a separately tracked second total. The Finance view labels it "Recorded spending" and shows its basis and freshness; "Actual" is the tile label on the project header and the "Budget vs Actual" card.

**Budget version** — a named, versioned project budget with a currency and lifecycle status, made up of budget line items. Planned money — distinct from **Committed spend**, which measures purchases already ordered.

**Budget line item** — an amount and description for a budget category and fiscal year within a budget version.

**Budget projection** — a project/category/fiscal-year estimate to complete, with an optional explanatory note and currency.

**Cost attribution rule** — a versioned, effective-dated rule matching external cost attributes to percentage allocations across projects; its targets carry the project shares.

**PMO Project Number** — the human-readable identifier PMO assigns to a project. It is unique within the organisation and independent of the organisation's own **Client Project Code** and any identifier assigned by an external system. (OD-ID-1.)

**Client Project Code** — the optional, free-form code the organisation uses for the same project. It is shown and searched alongside the PMO Project Number, but is never used as PMO's identifier. (OD-ID-1.)

**Procurement (case)** — one procure-to-pay effort, modeled as a **case folder**: the thing that carries a title, an optional project link, a requester, a type, and a current lifecycle status. It is **not** itself a Purchase Request or any single document — it is the folder those documents hang under. The UI speaks of a **purchase** (and of the **supplier**, not vendor) for the case; case-directed copy should prefer "purchase" or "procurement case" for the aggregate — "**Procurement record**" always means a typed child document. (ADR-0033.)

**Procurement record** — a real document that hangs under a Procurement case: a **Purchase Request, RFQ, Quotation, Purchase Order, Goods Receipt, Vendor Invoice,** or **Payment**. Each is its own typed entity, of which a case may have **many** (e.g. several partial Goods Receipts, multiple Vendor Invoices, progress Payments). A record is **evidence** of where the case stands; it is not the authority for the case's status (that is the declared lifecycle status — see **Committed spend**). The kinds are defined below. (ADR-0033.)

**Purchase request** — a numbered, dated request record under a procurement case, with a status and amount; the case's opening document.

**Purchase order** — a numbered, dated order record under a procurement case, with a status and amount.

**Goods receipt** — a numbered receipt record under a procurement case, optionally linked to a purchase order, with a receipt date and status.

**Vendor invoice** (UI: **Supplier invoice**) — a supplier billing record under a procurement case, optionally linked to a purchase order, carrying an amount, date, status and tax details.

**Procurement payment** — a dated payment record under a procurement case, optionally linked to a vendor invoice, with an amount and status.

**Procurement item** — a named quantity and rate on a procurement case, with a calculated or recorded amount.

**System-assigned number** — the identifier PMO mints when a Procurement record is created through the standard PMO flow. It uses the per-org daily sequence and type prefix defined in OD-PROC-3 (for example, `PR-YYMMDD####`). Distinct from the optional **External reference number**.

**External reference number** — the optional, free-form identifier the *outside* document behind a procurement record carries — the vendor's quotation reference, the real PO number, or the supplier's invoice number. It is shown as "External ref" and captured where the record type supports it; a record need not carry one. (ADR-0033.)

**Group reference** — the optional reference the client group assigns to a case's Purchase Request, Purchase Order or Vendor Invoice: the group's own number for that document, shown as "Group ref". Distinct from the **External reference number**, which is the outside document's reference — a record can carry either, both, or neither.

**RFQ (Request for Quotation)** — a Procurement record representing a formal request for pricing issued to a set of vendors. One RFQ may gather **many** Quotations (1:N); a Quotation may cite the RFQ it answers. (ADR-0033.)

**Quotation** — a vendor's priced response associated with a procurement case and, optionally, the RFQ it answers, carrying validity and selection information.

**Assistant** — the in-app agent a signed-in user converses with to explore their data, perform writes (always with the user's explicit approval), and compose views. The Assistant is a **deputy**: it acts under the user's own identity and permissions and can never see or do more than that user could in the UI. It is an end-user product feature, not an admin or developer tool. (ADR-0036, ADR-0040.)

**Deputy** — the authorization stance of the Assistant: it carries the user's badge, never a master key. Whatever bounds the user (tenancy, role, separation-of-duties) bounds the Assistant identically, by construction. (ADR-0036 §2.)

**Operator** — the platform-level persona (the vendor operating PMO itself), distinct from
any org role. Owns what a client never touches: creating orgs, granting AI credits,
toggling per-org feature entitlements. Not a sixth org role — an Operator transcends the
org boundary, so operator powers are granted by a separate platform-level mechanism, never
by the in-org role enum. Contrast **Admin**, the client's own in-org administrator role.
(Decided 2026-07-04.)

**Organization (org)** — the tenant boundary: one paying client **group**, holding all its
users and data behind one RLS wall. An org is a commercial/contract boundary, not a legal
entity — a client group with subsidiaries is still **one** org (decided 2026-07-04). Two
unrelated clients never share an org.

**Entity** — an operating/legal company *within* a client group (parent or subsidiary),
modeled as a dimension on the org's data (e.g. a project belongs to an Entity), never as a
separate org. Users and dashboards span Entities by default; intra-group visibility is the
norm and cross-Entity rollup is a feature. Not to be confused with **Company**, which is a
CRM counterparty (client/vendor) in the sales sense. (Decided 2026-07-04.)

**User view** — a dashboard/view a user composes at runtime (manually or via the Assistant) and owns as data, not code. Private to its owner by default; sharing shows each viewer only their own authorized data. Distinct from built-in pages, which are part of the app itself. (ADR-0036.)

---

## Integration (ERP & external apps)

**Source of truth (SoT)** — the single system whose record is authoritative for a domain.
When a client employs an external system (ERP, ClickUp), that system is SoT for every domain
it natively owns; PMO never holds a competing authoritative copy. (Decided 2026-07-10.)
_Avoid_: system of record, master.

**Externally-owned domain / PMO-owned domain** — the per-domain ownership split when an
external system is employed: an externally-owned domain has that system as SoT (PMO holds a
read-model plus enhancements); a PMO-owned domain has PMO as SoT (optionally pushed down as
reference data). Ownership is per domain, never per record. (Decided 2026-07-10.)
_Avoid_: ERP-owned (too narrow — ClickUp owns tasks the same way).

**Enhancement** — an additive, PMO-side decoration of an externally-owned record (extra
attributes, version history, groupings, rollups). An enhancement never duplicates a field
the native object carries — the external system owns the record's existence and all native
fields — so no field is writable in two places and conflicts are impossible by construction.
(Decided 2026-07-10.)

**Read-model (mirror)** — PMO's local, machine-written copy of an externally-owned domain,
kept for display, querying, and the Assistant. Never written by users directly; user actions
on an externally-owned domain travel to the external system as commands, and the read-model
reflects that system's answer. (Decided 2026-07-10.)
_Avoid_: cache, replica, sync table.

**Capability map** — the per-external-system declaration of which domains it can natively
own. Employing a system flips exactly the domains in its capability map to externally-owned;
a missing capability leaves that domain PMO-owned for that client. (Decided 2026-07-10.)

**Adapter** — the per-system implementation of PMO's adapter contract, running PMO-side and
speaking that system's stock API (one adapter per product: ERPNext, Odoo, ClickUp, …).
Adding a system means adding an adapter; the app above the contract does not change.
(Decided 2026-07-10.)
_Avoid_: connector, bridge, integration.

**Adapter contract** — the PMO-shaped set of operations (per domain: commands + reads)
every adapter must implement. Owned by PMO and expressed in PMO's domain language, never in
any external system's vocabulary. (Decided 2026-07-10.)

**Helper app** — an optional module installed inside an ERP instance PMO's vendor controls
(e.g. a Frappe custom app) that gives an adapter richer endpoints than the stock API. An
accelerator only: no adapter may require one, because client-owned ERP instances cannot be
assumed to accept installs. (Decided 2026-07-10.)
_Avoid_: pmo_connector (legacy name).

**External tier (optional)** — the per-client choice to employ an external system under PMO
(an ERP, ClickUp). PMO runs fully standalone without any (all domains PMO-owned); employing
one flips the domains in its capability map to externally-owned. (Decided 2026-07-10.)
_Avoid_: ERP tier (too narrow).

**Graph connection** — an org's standing authorization for PMO to act on Microsoft 365 on a user's
behalf. It has **two independent legs**, and a claim about one says nothing about the other:
the **connect leg** (the org grants consent and PMO takes custody of the authorization) and the
**use leg** (PMO actually exercises that authorization to read Microsoft data). A connection can be
established and yet unusable. (Clarified 2026-07-29 after "a proven live connection" was read as
covering both legs when only the connect leg had ever run — four documents went stale on the
ambiguity, and a feature was nearly built on the unproven leg.)
_Avoid_: "live connection" unqualified — always name the leg.

---

## Progress & billing

**Bill of quantities item** — a project work item with a code, description, unit, quantity, rate and earning basis, used for measured work and billing.

**Project progress entry** — a dated monthly record of a project's percent complete and an optional note.

**Progress assessment quantity** — the quantity completed to date for a bill-of-quantities item in a project progress entry.

**Progress claim** — a project billing claim, optionally associated with a work order, for progress or a down payment, recording gross value and any down-payment recovery.

**Progress claim line** — the quantity, rate and amount claimed for a bill-of-quantities item on a progress claim.

**Claim evidence** — a document revision and its status attached to support a progress claim.

**Sales invoice** — a customer-facing invoice associated with a project and optionally a work order, carrying amount, currency, status and tax details.

**Incoming payment** — a customer payment record, optionally linked to a sales invoice, carrying amount, currency, status and receipt/withholding details.

---

## Expenses & vendor tax

**Expense claim** — a claimant's numbered staff expense record, whose amount is the sum of its lines, with purpose, currency, approval and payment state, optionally assigned to a project.

**Cash advance** — a staff request for an entered amount in advance of expenses, which can later be applied to claims or partly returned.

**Expense claim line** — a dated, typed expense with a description and amount under a claim.

**Advance return** — an amount returned against an expense advance, with its date, reference and recorder.

**Expense claim evidence** — a file attached to an expense claim as supporting documentation.

**Vendor withholding slip** — a numbered vendor tax record for a tax period, currency, withholding type, tax base and withheld amount, with status and revision.

**Vendor withholding slip bill** — an association of a slip to a vendor invoice preserving the withheld amount, type and currency at recording.

---

## Stock & inventory (#1512)

**Stock item** — a material the organisation holds and tracks by quantity. Has a code, name and one base unit. Not a
procurement line (`procurement_items` is free text) and not a BoQ line.

**Unit** — a base unit of measure on an org-owned list (bag, m, kg …) with a "whole numbers only" flag. No conversion.

**Warehouse** — a place that holds stock: **central** (head-office store) or **site**. Not a PMO Entity, not a project.

**Keeper** — a user assigned to a warehouse who may record its stock movements.

**Stock document** — one recorded movement event with a system-assigned number: **Receive**, **Transfer**, **Issue**,
**Return**, **Adjustment**, **Count**. Posted documents are immutable; a mistake is corrected by a later document, never
an edit. Distinct from the **Goods Receipt** procurement record, which stays header-only.

**Stock ledger entry** — one signed quantity-and-value line per item and warehouse written when a document posts.
Append-only. The ledger is the trace.

**On hand** — quantity and value of an item at a warehouse now: the sum of its ledger entries (kept in a balance row).

**Moving-average cost** — value on hand ÷ quantity on hand at the moment of a stock-out.

**Work item** — a BoQ line (`boq_items`). Every issue names a project and a work item of that project.

**Material allowance** — the planned quantity of an item for a work item.

**Consumption** — net quantity (and value) of an item taken to a project work item: issues minus returns, by period.
It is operational and is not committed spend or an ERP actual.

**Reorder level / suggestion** — the on-hand quantity at which an item should be reordered at a warehouse; a
*suggestion* is computed from past usage and only a person turns it into a level.

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
taxonomy. Progress is held in two columns: a *calculated* percent (derived from its top-level
tasks' completion; empty when it has no tasks) and an *input* percent (typed by the PM, optional).
The effective percent is the input value when present, otherwise the calculated one, or zero
when neither exists. Calculated progress excludes subtasks and archived tasks. Both values are
shown side by side, so any divergence between the PM's figure and task-derived progress is
self-evident. A project's overall delivery progress is the weight-weighted rollup of its
milestones' effective percent; it is unavailable (null) when no milestone has a progress signal.
⚠ Deliberate deviation from strict PM vocabulary: here a milestone is a *work chunk that
progresses*, not a zero-duration checkpoint event.
**Shown to users as "Phase" / "Fase"** (DD-VOCAB-1); "milestone" stays the model, code and spec term.

**Task** — the smallest unit of tracked work. It may belong to a project or to no project at all
(a meeting action item can be a task); it may optionally be grouped under exactly one milestone
(shown to users as **Phase**) and may nest under a parent task as a **subtask** (OD-INT-9,
2026-07-20 — this superseded the earlier two-level-only hierarchy). Only top-level, non-archived
tasks count toward milestone and delivery progress; subtasks render nested under their parent and
never move a percentage on their own. A subtask has no independent project identity — it follows
its parent between projects (OD-TASK-2).

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

**Active contract value** — the sum of signed contract values across projects currently in delivery (status = Ongoing). Excludes closed-out and won-but-not-started projects. Smaller than *Revenue on hand* because revenue also accrues on completed work; the two figures are intentionally compared side by side to make the scope difference self-evident.

**Committed spend** (canonical: OD-BUDGET-2) — Σ `total_value` of all procurement records in statuses `Ordered`, `Received`, `Vendor Invoiced`, `Paid` for a given project. This is the single live spend basis used throughout the app: project header "Committed" tile, the Finance dashboard, the Delivery summary, and the at-risk threshold. The stored `projects.spent` column (seeded to 0, never auto-populated) is **not** this value and is not read by any tile. Code reference: `COMMITTED_STATUSES` in `pmo-portal/src/lib/db/procurements.ts`.

**Actual / Realized spend** — a UI label for **Committed spend** (same number, same basis). In the project header stat-strip and the Finance dashboard "BvA" card, the tile labeled "Actual" displays the committed-PO sum (Ordered..Paid), not a separately tracked actual-cost figure. The two words are deliberately synonymous here because the committed-PO basis IS the realized-cost proxy until a time-and-materials actuals system is added. If a future feature introduces a separate "actuals" ledger distinct from PO commitments, rename the UI tile at that point and add a new glossary entry.

**PMO Project Number** — the human-readable identifier PMO assigns to a project. It is unique within the organisation and independent of the organisation's own **Client Project Code** and any identifier assigned by an external system. (OD-ID-1.)

**Client Project Code** — the optional, free-form code the organisation uses for the same project. It is shown and searched alongside the PMO Project Number, but is never used as PMO's identifier. (OD-ID-1.)

**Procurement (case)** — one procure-to-pay effort, modeled as a **case folder**: the thing that carries a title, a project, a requester, a type, and a current lifecycle status. It is **not** itself a Purchase Request or any single document — it is the folder those documents hang under. (ADR-0033.)

**Procurement record** — a real document that hangs under a Procurement case: a **Purchase Request, RFQ, Quotation, Purchase Order, Goods Receipt, Vendor Invoice,** or **Payment**. Each is its own typed entity, of which a case may have **many** (e.g. several partial Goods Receipts, multiple Vendor Invoices, progress Payments). A record is **evidence** of where the case stands; it is not the authority for the case's status (that is the declared lifecycle status — see **Committed spend**). (ADR-0033.)

**System-assigned number** — the identifier PMO mints when a Procurement record is created through the standard PMO flow. It uses the per-org daily sequence and type prefix defined in OD-PROC-3 (for example, `PR-YYMMDD####`). Distinct from the optional **External reference number**.

**External reference number** — the optional, free-form identifier a Procurement record has in the *outside* world — the vendor's quotation number, the real PO number, or the supplier's invoice number. It can be captured alongside the **System-assigned number** so the record is findable from either side. (ADR-0033.)

**RFQ (Request for Quotation)** — a Procurement record representing a formal request for pricing issued to a set of vendors. One RFQ may gather **many** Quotations (1:N); a Quotation may cite the RFQ it answers. (ADR-0033.)

**Assistant** — the in-app agent a signed-in user converses with to explore their data, perform writes (always with the user's explicit approval), and compose views. The Assistant is a **deputy**: it acts under the user's own identity and permissions and can never see or do more than that user could in the UI. It is an end-user product feature, not an admin or developer tool. (ADR-0036, ADR-0040.)

**Deputy** — the authorization stance of the Assistant: it carries the user's badge, never a master key. Whatever bounds the user (tenancy, role, separation-of-duties) bounds the Assistant identically, by construction. (ADR-0036 §2.)

**Operator** — the platform-level persona (the vendor operating PMO itself), distinct from
any org role. Owns what a client never touches: creating orgs, granting AI credits,
toggling per-org feature entitlements. Not a sixth org role — an Operator transcends the
org boundary, so operator powers are granted by a separate platform-level mechanism, never
by the in-org role enum. Contrast **Admin**, the client's own in-org administrator role.
(Decided 2026-07-04.)

**Sole operator** (budget rule) — the single active member of an organisation, NOT the platform
**Operator** persona. While an org has exactly one active member, that member may activate a
budget version they drafted or edited (the OD-BUDGET-6 amendment, 2026-10-16); the exception
switches itself off the moment a second member is active. The version history and badge read
"Activated by sole member". The stored activation basis keeps the `sole_operator` value.

**Organization (org)** — the tenant boundary: one paying client **group**, holding all its
users and data behind one RLS wall. An org is a commercial/contract boundary, not a legal
entity — a client group with subsidiaries is still **one** org (decided 2026-07-04). Two
unrelated clients never share an org.

**Entity** — an operating/legal company *within* a client group (parent or subsidiary), intended
as a dimension on the org's data, never as a separate org. The dimension is design vocabulary,
not a shipped column: no project row carries an Entity reference today. Users and dashboards span
Entities by default; intra-group visibility is the norm and cross-Entity rollup is a feature.
Two deliberate overloads are NOT this term: in much of the code "entity" names any persisted
record or type generically (e.g. the agent's entity catalogue, repository contracts), and
`projects.bidding_entity` records a bid's participation mode (alone/consortium), not a company.
Not to be confused with **Company**, which is a CRM counterparty (client/vendor) in the sales
sense. (Decided 2026-07-04; disambiguated 2026-11-03.)

**User view** — a dashboard/view a user composes at runtime (manually or via the Assistant) and owns as data, not code. Private to its owner by default; sharing shows each viewer only their own authorized data. Distinct from built-in pages, which are part of the app itself. (ADR-0036.)

---

## Projects, CRM & collaboration

**Project** — the organisation's tracked engagement: a name, a lifecycle status, a client, a
manager, a contract value and dates, to which delivery and financial records attach. Its
sales-pipeline statuses are the **Pipeline stage** values.

**Pipeline stage** — a project status used in the sales pipeline, with an organisation-configured
probability of winning.

**Notification** — a message to a user carrying a severity, a title, an optional body and a read
state.

**Contact** — a named person associated with a CRM **Company**, with a role and contact details.

**CRM activity** — a recorded call, email, meeting or note tied to a contact, a company or a
project, with an occurrence date and an author.

**Meeting** — a dated, titled meeting record with notes and an optional project, attendees and
explicit access grants.

**Meeting attendee** — a person recorded as attending a meeting: an internal profile, an external
contact, or a display name.

**Meeting access grant** — an explicit grant letting a user access a meeting, recording who
granted it and when.

**Comment** — an authored message on a project or task, optionally mentioning other users.

## Resources, HSE & reference data

**User profile** — an organisation's user record: identity, role, status and an optional
reporting manager.

**Spend approver** — a user designated to approve spending for a project.

**Task dependency** — a directed relation stating that one task depends on another task (see
**Task**).

**Timesheet** — a user's weekly record of time entries, with submission and approval status.

**Timesheet entry** — hours recorded against a project on a date within a timesheet, optionally
with notes.

**Incident report** — a dated report of an incident with a type, severity, location, description
and status, optionally linked to a project.

**Exchange rate** — the rate converting a base currency to a quote currency on a date, with its
source.

---

## Integration (ERP & external apps)

**Source of truth (SoT)** — the single system whose record is authoritative for a domain.
When a client employs an external system (ERP, ClickUp), ownership follows the org's configured
assignment (per-domain ownership rows) plus any project bindings — not the system's mere
presence: a domain the system can natively own is externally owned only where it is actually
assigned, tasks can be externally owned for bound projects while other tasks stay PMO-owned,
and PMO stays SoT for timesheets and budgets even though it pushes them into the ERP (the
PMO-SoT push posture, ADR-0059 — still Proposed). (Decided 2026-07-10; qualified 2026-11-03.)
_Avoid_: system of record, master.

**Externally-owned domain / PMO-owned domain** — the per-domain ownership split when an
external system is employed: an externally-owned domain has that system as SoT (PMO holds a
read-model plus enhancements); a PMO-owned domain has PMO as SoT — it may still be pushed to
the external system, where the pushed copy is a mirror (see **Read-model**), never the
authority. Ownership is configured per org and per domain, and a project binding narrows it
further (e.g. tasks externally owned only for bound projects); it is never per record.
(Decided 2026-07-10; qualified 2026-11-03.)
_Avoid_: ERP-owned (too narrow — ClickUp owns tasks the same way).

**Enhancement** — an additive, PMO-side decoration of an externally-owned record (extra
attributes, version history, groupings, rollups). An enhancement never duplicates a field
the native object carries — the external system owns the record's existence and all native
fields — so no field is writable in two places and conflicts are impossible by construction.
(Decided 2026-07-10.)

**Read-model (mirror)** — the word covers two directions; always name the direction and owner.
An **external-SoT read-model** is PMO's local, machine-written copy of an externally-owned
domain, kept for display, querying, and the Assistant — written FROM the external system, never
by users, and never the authority. An **external-side mirror** (push-state mirror) is the
opposite direction: the ERP-side state tracking of a PMO-authoritative record PMO pushed — e.g.
`timesheet_erp_mirror` states where an approved PMO timesheet stands in ERPNext; PMO owns the
data and the ERP only reflects it. Generic derived views of PMO's own data (a meeting read
model, a revenue aggregate) are read models, not external mirrors. (Decided 2026-07-10;
directions separated 2026-11-03.)
_Avoid_: cache, replica, sync table.

**Capability map** — the per-external-system declaration of which domains it CAN natively own.
A capability is an upper bound, not an ownership flip: what is actually externally owned follows
the org's configured ownership assignment and any project bindings; a missing capability leaves
that domain PMO-owned for that client. (Decided 2026-07-10; qualified 2026-11-03.)

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
(an ERP, ClickUp). PMO runs fully standalone without any (all domains PMO-owned). Employing one
does not by itself flip ownership: the org configures which of the system's capable domains
become externally owned, and PMO-authoritative domains (timesheets, budgets) may still push
into it. (Decided 2026-07-10; qualified 2026-11-03.)
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

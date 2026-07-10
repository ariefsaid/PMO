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
The effective percent is the input value when present, otherwise the calculated one; both
are shown side by side, so any divergence between the PM's figure and task-derived progress
is self-evident. A project's overall delivery progress is the weight-weighted rollup of its
milestones' effective percent.
⚠ Deliberate deviation from strict PM vocabulary: here a milestone is a *work chunk that
progresses*, not a zero-duration checkpoint event.

**Task** — the smallest unit of tracked work. Belongs to a project; may optionally be grouped
under exactly one milestone. The delivery hierarchy is two levels only: milestone → tasks
(decided 2026-06-11; deeper nesting deferred until a real customer needs it).

**Document** — a controlled record in a project's document register (drawing, specification,
report, contract …). Carries a category, a revision mark, and a lifecycle status with
separation-of-duties approval (approver ≠ author). A document may carry **one file**; the
file may change only while the document is Draft — once issued, content changes require a
new revision (decided 2026-06-12).

**Revision** — a successive issue of the same document (Rev A → Rev B …). Each revision is
its own register entry and walks the full lifecycle itself. A revision is always created
*from* its predecessor — that explicit act is what links the lineage (no name/code matching).
Prior revisions are never deleted or hidden: when a newer revision is Approved, the older
one becomes Superseded but stays readable (audit trail).

**Superseded** — terminal document status meaning "replaced by a newer Approved revision of
the same document". Read-only, reached automatically, never hand-picked.

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

**Procurement (case)** — one procure-to-pay effort, modeled as a **case folder**: the thing that carries a title, a project, a requester, a type, and a current lifecycle status. It is **not** itself a Purchase Request or any single document — it is the folder those documents hang under. (ADR-0033.)

**Procurement record** — a real document that hangs under a Procurement case: a **Purchase Request, RFQ, Quotation, Purchase Order, Goods Receipt, Vendor Invoice,** or **Payment**. Each is its own typed entity, of which a case may have **many** (e.g. several partial Goods Receipts, multiple Vendor Invoices, progress Payments). A record is **evidence** of where the case stands; it is not the authority for the case's status (that is the declared lifecycle status — see **Committed spend**). (ADR-0033.)

**System-assigned number** — the identifier PMO mints for a Procurement record (e.g. `PR-250619-0001`), unique per org and gap-tolerant. Every record has one. Distinct from the **External reference number**. (OD-PROC-3.)

**External reference number** — the identifier the document carries in the *outside* world — the vendor's quotation number, the real PO number, the supplier's invoice number. Optional, free-form, captured by the procurement admin alongside the **System-assigned number** so a record is findable from either side. Every Procurement record carries both. (ADR-0033.)

**RFQ (Request for Quotation)** — a Procurement record representing a formal request for pricing issued to a set of vendors. One RFQ may gather **many** Quotations (1:N); a Quotation may cite the RFQ it answers. (ADR-0033.)

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

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

**Document category** — an organisation-owned label on every register document that also decides which roles may see it. Eight system categories are seeded (Drawing, Specification, Report, Transmittal, Submittal, Certificate, Other, Reference); organisations add their own.

**Viewer roles** — the roles allowed to see documents of one category, files included. A role not listed sees no trace of those documents; Admin is always listed.

**System category** — a seeded document category that cannot be renamed, archived or deleted; `Other` is the fallback when a document is filed without a recognised category.

**Reference** — the system category that labels a linked Microsoft 365 folder entry. It is created by the link routine, so the ordinary register forms do not offer it.

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

**Active contract value** (shown on dashboards as **Contract on hand · excl. tax**) — the sum of the **net-of-tax** contract amounts (a tax-inclusive contract counts its value less its tax; a tax-exclusive one counts its value as entered) of projects in the on-hand set: Won, Pending KoM, Ongoing Project, On Hold and Close Out (archived projects excluded). The same net amount feeds *left after spending* and the on-hand margin, so all three sit on the basis of Invoiced · excl. tax and Left to bill (#2348). Positions are shown per currency and never blended. It is **not** earned revenue: revenue accrues only on work performed and billed, while contract value on hand is the value still to deliver. Delivery-risk figures and delivery charts each qualify their own cohort in their help text; "delivery" alone is not a status filter.

**Committed spend** (canonical: OD-BUDGET-2) — a project's open purchase commitment: Σ open commitment over its procurement cases in statuses `Ordered`, `Received`, `Vendor Invoiced`, `Paid`. Each case counts in its own currency — positions are never blended across currencies. Where the organisation reads its ledger from its ERP, a case contributes its total minus the amounts the ledger already holds for it (never below zero); otherwise the full case total is the commitment (the PMO-proxy basis). This is the single live committed basis used throughout the app: project header "Committed" tile, the Finance dashboard, the Delivery summary, and the at-risk threshold. The stored `projects.spent` column (seeded to 0, never auto-populated) is **not** this value and is not read by any tile. Code reference: `COMMITTED_STATUSES` in `pmo-portal/src/lib/db/procurements.ts`; SQL `project_committed_spend`.

**Actual (Recorded spending)** — the one cost figure every money surface shows for a project. Where the organisation reads its ledger from its ERP, it is the project's mapped ledger cost; otherwise it is **Committed spend** — the committed-purchase proxy. It is therefore not always the same number as Committed spend (the two coincide only on the proxy basis), and it is never a separately tracked second total. The Finance view labels it "Recorded spending" and shows its basis and freshness; "Actual" is the tile label on the project header and the "Budget vs Actual" card.

**Budget version** — a named, versioned project budget with a currency and lifecycle status, made up of budget line items. Planned money — distinct from **Committed spend**, which measures purchases already ordered.

**Budget line item** — an amount and description for a budget category and fiscal year within a budget version.

**Correction** — a previewed, one-record change to a value the starting-data loader wrote, made with `pmo correct`; it never changes a record's identity, and a claim already created keeps the figures it was created with.

**Fiscal calendar** — the fiscal years an organization's spending is cut by. Where the organization reads an accounting system, that system's calendar; otherwise PMO's own, derived from the **fiscal year start month** (#2329). PMO's years are named by their calendar year for a January start (`2027`) and `<start year>-<end year>` otherwise (`2026-2027` = 2026-04-01 to 2027-03-31). A budget year counts as a fiscal year only when its label is that exact name.

**Fiscal year start month** — the month (1–12) an organization with no accounting system says its fiscal year starts (`organizations.fiscal_year_start_month`, Admin-set). PMO places each payment in a fiscal year by its date and each hire charge by its work month. Changing it re-sorts every past payment; it is ignored while an accounting system is read.

**Budget projection** — a project/category/fiscal-year estimate to complete, with an optional explanatory note and currency.

**Cost attribution rule** — a versioned, effective-dated rule matching external cost attributes to percentage allocations across projects; its targets carry the project shares.

**Organization name** — unique across the deployment. Two names are the same when they match ignoring letter case and spacing: leading and trailing whitespace is ignored and any run of whitespace (spaces, tabs, newlines, non-breaking spaces) counts as one space, so names that look the same on screen collide. The database enforces it for every writer (unique index `organizations_name_normalized_key`, #2264), so `pmo org add` can re-run safely by name.

**PMO Project Number** — the human-readable identifier PMO assigns to a project. It is unique within the organisation and independent of the organisation's own **Client Project Code** and any identifier assigned by an external system. (OD-ID-1.)

**Client Project Code** — the optional, free-form code the organisation uses for the same project. It is shown and searched alongside the PMO Project Number, but is never used as PMO's identifier. (OD-ID-1.)

**Procurement (case)** — one procure-to-pay effort, modeled as a **case folder**: the thing that carries a title, an optional project link, a requester, a type, and a current lifecycle status. It is **not** itself a Purchase Request or any single document — it is the folder those documents hang under. The UI speaks of a **purchase** (and of the **supplier**, not vendor) for the case; case-directed copy should prefer "purchase" or "procurement case" for the aggregate — "**Procurement record**" always means a typed child document. (ADR-0033.)

**Line planning** — an organisation setting (off by default) that lets each request line carry a **line category** and a **needed-by** date. The categories are the organisation's own list (an Admin adds, renames or retires them; two general starter rows are seeded when the setting is first turned on). A retired category stays on the lines that already carry it. A needed-by date is per line; there is no request-level date. (#2696.)

**Procurement record** — a real document that hangs under a Procurement case: a **Purchase Request, RFQ, Quotation, Purchase Order, Goods Receipt, Vendor Invoice,** or **Payment**. Each is its own typed entity, of which a case may have **many** (e.g. several partial Goods Receipts, multiple Vendor Invoices, progress Payments). A record is **evidence** of where the case stands: document evidence advances the case to its furthest evidenced step, alongside explicit lifecycle decisions (ADR-0093). The kinds are defined below. (ADR-0033.)

**Purchase request** — a numbered, dated request record under a procurement case, with a status and amount; the case's opening document.

**Purchase type** (#2697) — one of the organisation's own list of kinds of purchase (goods, service and rental are the starter rows an Admin gets when switching the feature on; the Admin renames, adds or retires them). A purchase carries at most one, chosen when it is raised and never changed after. The list is data: no rule reads a type's name. Off by default; a purchase with no type behaves exactly as before.

**Rental purchase** (#2697) — a purchase whose type is flagged `is_rental` ("has a rental period"). It carries a rental period (from and to dates). The flag, not the type's name, makes a purchase a rental.

**Rental extension** (#2697) — the guided "Extend rental" step on a live rental purchase: it creates a NEW purchase (its own order, in Draft) for a later period, linked to the original, and takes the normal approval and spend routing. The original is not changed. The extension starts after the original's end, never overlaps another extension of the same original, and can itself be extended.

**Purchase order** — a numbered, dated order record under a procurement case, with a status and amount.

**Goods receipt** — a numbered receipt record under a procurement case, optionally linked to a purchase order, with a receipt date and status.

**Vendor invoice** (UI: **Supplier invoice**) — a supplier billing record under a procurement case, optionally linked to a purchase order, carrying an amount, date, status and tax details.

**Void (vendor bill)** — in an organisation with no ERP, an Admin or Finance user marks a mistyped PMO-native subcontract bill as voided, with a reason. Soft: the bill and its lines stay, it stops counting against the PO and the purchase's payments, and it can never be paid or un-voided. The person who captured the bill cannot void it unless they are the organisation's only active member. Distinct from an ERP cancel, which comes from the ERP (#1671).

**Payment channel** — how a purchase request will be paid (for example bank transfer or cash), one optional field on the request, shown beside its payment status. The list of channels is the organisation's own data, managed by an Admin; an Admin turning the feature on for the first time gets four general starter channels to edit. Off for every organisation until an Admin turns it on. The requester or an Admin sets it while the request is Draft or Rejected; Finance or an Admin can set or change it until the request is Paid or Cancelled. No code treats one channel differently from another (#2698).

**Three-way match** — an organisation switches it on (Admin) with a quantity and an amount tolerance in percent. From then, each PMO-native bill on a goods purchase is checked line by line against the purchase's ordered items (the order) and what its goods receipts received: the quantity billed so far may not pass what was received or ordered beyond the quantity tolerance, the billed rate may not pass the order rate beyond the amount tolerance, and the bill's pre-tax amount must agree with its lines. A bill that fails, or states no lines, is **held**: nothing on its purchase moves to payment. Subcontract bills (capped by acceptance), ERP-mirrored bills, bills recorded before the switch and organisations whose ERP owns purchasing are not matched (#2525).

**Match exception** — the release of a held bill: an Admin or Finance user approves it with a reason, and the purchase may be paid again. Never the person who recorded the bill or its match lines; refused when the bill's author is not recorded. Permanent, and it freezes the bill's lines (#2525).

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

**Sole operator** (budget rule) — the single active member of an organisation, NOT the platform
**Operator** persona. While an org has exactly one active member, that member may activate a
budget version they drafted or edited (the OD-BUDGET-6 amendment, 2026-10-16); the exception
switches itself off the moment a second member is active. The version history and badge read
"Activated by sole member". The stored activation basis keeps the `sole_operator` value.

**Assistant thread** — one user's named conversation context with the Assistant. A thread
is private to its owner (owner-scoped RLS; no cross-owner read, not even Admin) and may be
pinned to hold the top of the thread list. Archiving removes a thread from the list without
deleting its history. (ADR-0040; FR-AGP-007/008.)

**Assistant automation** — an owner's Assistant prompt that runs on a schedule or on a data
event, with an optional condition narrowing when it fires. Each automation is enabled or
disabled by its owner; a disabled automation never fires. Individual runs, delivery state
and credit reservations are operational detail, not part of the definition.

**AI credit grant** — an amount of AI credit granted to an organization (or to one of its
users) by an Operator, recorded with its grantor and an optional note. Credits are an
append-only ledger: the balance is the sum of grants less usage, never an in-place edit.

**Credit allocation** — the share of an organization's granted AI credit that an org-Admin
sets aside for one user. Allocating divides credit the org already holds: it moves an amount
between users, or between a user and the org's unallocated credit, and never changes the org's
total. The allocations of an org never add up to more than its granted total. Removing a user
returns their allocation to the org. Only an Operator grant raises the total. (#564.)

**Organization feature entitlement** — one organization's enabled or disabled access to a
named product feature. Entitlements are toggled per org by the Operator; a feature with no
entitlement row resolves to its environment's default for that feature. A member's access
follows the org's entitlement on top of their role.

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

**Approval tier** — an optional minimum amount on a spend approver. Where the organisation turns tiers on, a request goes to the highest tier whose minimum is at most its amount (anyone with no minimum sits in the base tier); an unknown or foreign-currency amount goes to the top tier.

**Issue (site)** — a problem raised on site (#2521): an incident record that also names the person in
charge, what must be done, a due time, optionally a work order of its project, and photo evidence.
One record serves safety incidents and site issues; the UI says *issue* for site work and *incident*
for safety events. High and Critical issues close only with a **close proof** (a photo or document
attached at close).

**Escalation** — the once-only step when an open issue passes its due time: the database marks it
escalated, tells the person in charge and the project manager (Admins when the project has none),
and writes an audit row. Moving the due time forward clears it, so a later miss escalates again.
*Overdue* (the badge and filter) is computed from the due time alone and does not wait for the job.

**Supplier** — the party a purchase is bought from. Kept in English in Bahasa (like Timesheet and
Dasbor), not translated as "Pemasok" (owner, 16 Nov).

**Invoice** — a request for payment, sales or supplier ("invoice supplier"). Kept in English in Bahasa.
"Faktur" names only the tax invoice (Faktur Pajak, e-Faktur); "invoiced" reads "ditagih" (owner, 16 Nov).

**Task dependency** — a directed relation stating that one task depends on another task (see
**Task**).

**Timesheet** — a user's weekly record of time entries, with submission and approval status.

**Timesheet entry** — hours recorded against a project on a date within a timesheet, optionally
with notes.

**Crew** — a named group of people who work together in the field (#2528), with an organisation-unique code, a
field controller, a kind (own staff or a supplier's crew) and its standard roles. A crew does not replace a person's
project assignment; it says who works together.

**Standard role (crew)** — a role a crew is built from (for example foreman, welder, helper) with the headcount the
crew should have; the roster compares it with the people placed.

**Crew member (placement)** — a person placed in a crew for an inclusive date range with an optional end; a person is
in at most one crew on any day. A correction is versioned and audited and never rewrites approved attendance.

**Roster (crew)** — which crews serve a work order on which dates; a crew serves one work order on any day.

**Crew loan** — a worker lent from their home crew to a host crew for an inclusive date range (#2704). On those days the
worker is on the host crew's roster and not the home crew's, and attendance lands on the host crew's work order; hours
already submitted or approved never move. A worker has at most one loan on any day.

**Effective crew** — the crew a worker is in on a date: the host crew on a loan day, otherwise the crew they are placed in.
One database function answers it, so the roster and attendance agree.

**Field controller** — the user who records a crew's daily attendance; may not approve the hours they recorded.

**Attendance record** — one person's attendance for one day on one work order (present, absent, leave or off
rotation, with hours), whatever the capture method (roster tick, phone check-in, office correction). It becomes the
person's timesheet line, or, for a person with no login, holds their approved hours itself. Approved attendance is
locked; it changes only by re-opening the timesheet (the correction path).

**Attendance rate** — a crew's present member-days over its countable member-days for a period, as a percentage. A
member-day is expected when the person was placed in the crew and the crew was rostered on a work order that day; leave
and off rotation are excused, and a day nobody recorded counts against the rate and is shown apart. It is a review
figure, not a payroll rule.

**Attendance target** — the organisation-wide percentage an attendance rate is measured against. It is a setting the
client owns: unset means the rate is not offered, and PMO writes no default.

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

**Graph connection** — one user's delegated authorization, within their org, for PMO to act on
Microsoft 365 on that user's behalf; PMO holds it in custody per user. **Org approval** (the tenant
admin's consent for the PMO app) is a separate step and is not a user's connection. A connection
has **two independent legs**, and a claim about one says nothing about the other: the **connect
leg** (the user consents and PMO takes custody of the authorization) and the **use leg** (PMO
actually exercises that authorization to read Microsoft data). The **status** a card shows
("Connected") is custody metadata only; it is not proof that any read succeeded. A connection can be
established and yet unusable. (Clarified 2026-07-29 after "a proven live connection" was read as
covering both legs when only the connect leg had ever run — four documents went stale on the
ambiguity, and a feature was nearly built on the unproven leg.)
_Avoid_: "live connection" unqualified — always name the leg.

---

## Progress & billing

**Bill of quantities item** — a project work item with a code, description, unit, quantity, rate and earning basis, used for measured work and billing.

**Project progress entry** — a dated monthly record of a project's percent complete and an optional note.

**Work order** — a client's purchase order against a project, with an order value, tax basis and a Draft, Issued, Closed or Cancelled status; it is the commitment that billing and acceptance run against.

**Work order area** and **work order group** — two optional, organisation-owned lists (an Admin adds, renames and archives entries; nothing is coded). A work order names at most one area and one group; the project work-order list can be grouped by either. An archived entry leaves the pickers but stays on the work orders that already name it.

**Cost attribution** — the optional work order and discipline a cost record names (purchase request, purchase order, goods receipt, vendor bill, timesheet line, stock movement, equipment usage); a cost with neither is a project-level cost. The work order must be on the cost's own project (ADR-0104).

**Discipline** — an entry in the organisation's own list of trades or engineering disciplines (for example civil, mechanical, electrical) that a cost can name. The Admin keeps the list on the **Cost disciplines** screen (*disiplin biaya*) and archives rather than deletes (#2623).

**Direct cost** (of a work order) — the counted cost records that name the work order, in its own currency: vendor bills pre-tax, posted stock issues and returns at stock-ledger value, and approved equipment usage at a hire rate. Purchase requests, orders and receipts are commitments and never add to it; hours with no rate are carried as hours (#2519).

**Shared cost** — counted cost records of a project that name no work order; split over the project's work orders by their share of direct cost unless Finance saves a custom split, and shown as "Not assigned" when there is no work order to carry it (#2519).

**Direct margin** — a work order's billed work revenue (excluding tax) less its direct cost. **Result after shared cost** is the direct margin less the work order's share of shared cost (#2519).

**Plan figure** — a planned amount for a work order (optionally per discipline): direct budget or indirect budget in the work order's currency, or equipment hours or crew hours. It never changes an actual, a project total or a budget version (#2519).

**Shared-cost split** — a project's saved percentage per live work order (up to 4 decimals, summing to exactly 100) used instead of the default split; it goes stale when a work order is added or cancelled, and the default applies until it is saved again (#2519).

**Work order line** — an allocation of a positive quantity of one project contract line (bill-of-quantities item) to a work order, so one contract line can be ordered across several work orders.

**Work order acceptance** — a BAST (acceptance record) for a work order, in Draft, Confirmed or Withdrawn status; a stage acceptance is cumulative evidence, and a confirmed final acceptance closes the work order at its accepted value. **Who confirms:** Finance or an Admin, never the person who prepared it (unless they are the organisation's only active member); the Draft chip reads "Waiting for Finance or an Admin to confirm" (Bahasa: "Menunggu konfirmasi Keuangan atau Admin"). **Delivery record** is the plain-words name for a BAST, and the default document category "Delivery record (BAST)" holds its signed file.

**Work order acceptance line** — the quantity accepted for one contract line on a work order acceptance; the latest confirmed quantity, not a sum, is what has been accepted to date.

**Opening balance** — where a running work order or a stock location stood at go-live, loaded once by an Admin and dated at the organisation's one go-live date (#2588). A work order's opening is a confirmed acceptance marked `opening` (certified quantity) plus the quantity and value claimed before go-live, which counts as already invoiced; a location's opening is a posted stock document of kind `opening` (counted quantity at unit cost). It is not new activity, it counts once, and an Admin can reverse it only before the first real transaction. Finished work orders carry none.

**Progress assessment quantity** — the quantity completed to date for a bill-of-quantities item in a project progress entry.

**Progress claim** — a project billing claim, optionally associated with a work order, for progress or a down payment, recording gross value and any down-payment recovery.

**Progress claim line** — the quantity, rate and amount claimed for a bill-of-quantities item on a progress claim.

**Claim evidence** — a document revision and its status attached to support a progress claim.

**PMO down payment item** — the one fixed item (`DOWN-PAYMENT`) a down-payment claim names while no ERP owns revenue and the organisation has set no down-payment item; the ERP raise refuses a claim that names it. Its lines read "Down payment" and "Down payment recovery" on the invoice.

**Billing stage** — one ordered step a progress claim passes before its invoice can be raised (for example internal measurement, joint survey, client approval). A project lists its stages; each new progress claim takes a copy (its *stage plan*), and the invoice is refused while any stage is open (#2522).
**Step owner role** — the role responsible for a billing step of a claim (from the existing role set); optional, set per step on the project's list, a template or the claim (#2680). **Step target date** — the date a step should be done by; when set it wins over the step's target days. **Step template** — an organisation's named list of billing steps (names, owner roles, target days, documents) that the client's team writes; loading it onto a project or claim copies it. **Waiting step pointer** — a needs-you entry for current steps owned by the viewer's role; derived on read, so it clears when the step completes.

**Client-side stage** — a billing stage done in the client's own system; PMO records it by hand with the date, the client's document number and the proof document.

**Stage checklist** — the documents a billing stage needs; a required item must have an issued or approved project document with a file before the stage completes, and that document becomes the claim's evidence.

**Stage age** — days a billing stage has been current: from its start (the previous stage's completion) to its completion, or to today while open.

**Stage target** — the number of days (1 to 365) a billing stage is expected to take, set per stage on the project's list and copied onto each new claim. No target means the stage is never overdue (#2592).

**Overdue stage** — a current billing stage whose age in days is greater than its target. The claim shows it as overdue with its age and target, and the claim's project manager (the organisation's Admins when there is none) is notified once (#2592).

**Optional stage** — a billing stage the project's list marks as one that may not apply to a claim. Only an optional, current stage can be marked not needed (#2592).

**Skipped stage** — an optional billing stage marked not needed by Finance or an Admin, with a date and a reason. It counts as complete for ordering and for the invoice gate, and it is not undone (#2592).

**Billing board** — a read-only screen listing every open claim (not withdrawn, has billing steps, no invoice yet) as a card under its current step, with the days on that step and an overdue chip. It is a view over the claims' own steps: nothing is stored for it, and a claim moves on only by completing its step on the claim. Bahasa Indonesia: Papan penagihan (#2681).

**Billing plan** — a screen at the Receivables header that lists billing candidates against a monthly target. Candidates only: ticks are view state, nothing is stored for them, and nothing raises a claim or an invoice. Over-claim shows as a warning, never a block. Bahasa Indonesia: Rencana penagihan (#2682).

**Billing candidate** — accepted work that is not yet claimed: accepted quantity above claimed quantity on a work-order allocation (the Cascade's "Unclaimed"), or a money-only order with an amount left. "Progress not yet client-certified" in the ticket words (#2682).

**Monthly target** — the amount the organisation aims to bill in a calendar month, with its currency; a default plus optional per-month overrides, set by Admin or Finance. Other currencies are listed apart, not converted (#2682).

**Board column** — one step name on the billing board, ordered by the median position of that name across the claims; a final column, All steps done, holds claims ready to invoice (#2681).

**Invoice deadline** — the project's monthly day (1–31, clamped to the month's end) by which its invoice must reach the client, with a warning window in days. A claim shows it while its stages are still open or it has no stage plan; it is hidden once every planned stage is complete (#2522).

**Measured quantity** — quantity on progress claims that are not withdrawn and whose invoice, if any, is not cancelled. **Billed quantity** — quantity on progress claims with an invoice that is not cancelled. Per bill-of-quantities item the reconciliation reads unbilled, partly billed, fully billed or surplus.

**Retention** — the share of a progress claim the client holds back until a later event; stamped on the claim at creation from the project's percentage, held on the receivable (never an invoice line), and released through scheduled then recorded **retention releases** (ADR-0105).

**Sales invoice** — a customer-facing invoice associated with a project and optionally a work order, carrying amount, currency, status and tax details.

**Left after this purchase** — the approval panel's decision figure: Active budget − recorded spending − open orders − Reserved − this purchase, before tax, each amount counted once. A request already in Reserved, or already an order, is not subtracted again. Spending is the project header's reading (the one Budget used divides); open orders are the order total less what spending already holds. When spending or open orders are not known the figure is not shown as a number; with only spending unknown the panel states the amount without it under its own label (OD-APPROVAL-LEFT). It is advisory; approver routing reads the same project reading and tests the line and the project in SQL (OD-APPROVER-BASIS). Not the same as **Left after open orders** (project Budget tab: budget less committed orders, before this purchase and Reserved).

**Left to bill** — signed contract value (net of tax) less invoiced to date (also read per issued work order, #2575), per held contract (on-hand status, not archived: the Contract on hand set, whatever the selected period) and currency at a month; it does not depend on the revenue recognition basis. The management pack derives it once and every report tile, row, total, export and the home dashboard read that one figure (#2203). A held contract with no contract value is not in it; the total stays a number and the count of such contracts is said beside it ("N contracts with no value, not in the total").

**Remaining work** — signed contract value less recognised revenue to date in the management pack; it follows the recognition basis (progress, earned value or invoiced) and is distinct from Left to bill. Formerly named "backlog" in the pack (DD-MMP-3).

**Earned value (work order)** — validated daily-site-report progress at the frozen contract rate, to a date (#2597). Not Left to bill or Remaining work, which are invoice and recognition quantities: earned value exists before anything is invoiced.

**Planned value (work order)** — the work order's net value (its closing value once closed) times the share of calendar days elapsed between its start and end dates (#2597). A straight-line plan; a front- or back-loaded job reads ahead or behind by the plan's shape alone.

**Cost performance index** — earned value divided by actual direct cost counted to the work order, rounded half up to two decimals, as of a date (#2597). Earned value is on the revenue basis, so this is a margin-style ratio, not a ratio against a cost budget. A project's index is the ratio of sums over its issued and closed work orders, never an average of their indices. Reading bands (default 0.90 and 1.10) are organisation settings.

**Schedule performance index** — earned value divided by planned value, rounded half up to two decimals, as of a date (#2597). Same bands and project rule as the cost performance index.

**Cancelled invoice pair** — an invoice pair whose linked ERP invoice was later cancelled; Finance can review the pair and decide whether to undo it.

**Incoming payment** — a customer payment record, optionally linked to a sales invoice, carrying amount, currency, status and receipt/withholding details.

---

**Work in hand** — **Left to bill** on the Contract on hand set and on its issued work orders, ranked per currency. A contract and its work orders are shown as a hierarchy and never added together (#2575).

**Billed to date** (of a contract or work order) — the pack's *invoiced to date*: billed work (the single definition shared by the billing summary and the management pack: submitted, unpaid or paid invoices, net of tax, plus the down-payment recovery; a down payment counts zero) summed over a contract or a work order.

**Current billing rate** — billed work in the last six complete months divided by the months counted, from the first month billing began inside that window; undefined when nothing was billed in it.

**Months of backlog** — Left to bill divided by the current billing rate, to one decimal; undefined (shown as "no billing rate") when the rate is undefined.

## Expenses & vendor tax

**Expense claim** — a claimant's numbered staff expense record, whose amount is the sum of its lines, with purpose, currency, approval and payment state, optionally assigned to a project.

**Cash advance** — a staff request for an entered amount in advance of expenses, which can later be applied to claims or partly returned.

**Expense claim line** — a dated, typed expense with a description and amount under a claim.

**Advance return** — an amount returned against an expense advance, with its date, reference and recorder.

**Expense claim evidence** — a file attached to an expense claim as supporting documentation.

**Site cash** (Bahasa *kas lapangan*) — cash one custodian holds on site for one project (code: imprest float). One name in
the UI; never "float". Its figures: **Limit** (*batas kas*, the approved amount it is topped up to), **Cash in hand**,
**Advances given**, **Receipts waiting** (paid claims not yet refilled), **Top-up on its way**, **Still needed**.

**Top-up** (*tambahan dana*) — a request to refill site cash with the receipts waiting (code: replenishment). **Funding**
(*pendanaan*) is the first cash put in, up to the limit.

**Cash count** — the custodian's count of cash in hand: **Counted**, **Expected** (by the books) and the **Difference**.

**Vendor withholding slip** — a numbered vendor tax record for a tax period, currency, withholding type, tax base and withheld amount, with status and revision.

**Vendor withholding slip bill** — an association of a slip to a vendor invoice preserving the withheld amount, type and currency at recording.

---

## Manual journals (#895)

**Manual journal** — a balanced set of debit and credit lines that Finance writes in PMO for a ledger move no other
record makes (a bank fee, interest, an accrual, a correction). It is drafted, submitted, approved by a second
approver and then posted to the connected ledger, where it shows as Posted, Scheduled (dated later in the ledger),
Needs a check or Refused. A posted one is undone only by a reversal: a new manual journal with every side swapped.
Ledger moves PMO did not write are listed beside them as *outside PMO*, read-only.

**Second approver** — the Finance, Executive or Admin member who approves or returns a manual journal. Never anyone
who wrote it (its maker or any editor) and, for a reversal, nobody who wrote the original. Rank does not matter.
One exception: when the organisation has only one member (one profile in total, whatever its status), that member
approves their own journal, and the approval is recorded as made by the sole member. A second member, even a disabled
one, brings the second-approver rule back for good: the organisation keeps a permanent "has had a second member"
marker, so removing that member later does not restore the exemption.

**Desk journal** — the one general Odoo journal that manual journals post to, chosen by an Admin in Odoo setup.
Until it is chosen, manual journals cannot post to Odoo.

---

## Stock & inventory (#1512)

**Stock item** — a material the organisation holds and tracks by quantity. Has a code, name and one base unit. Not a
procurement line (`procurement_items` is free text) and not a BoQ line.

**Unit** — a base unit of measure on an org-owned list (bag, m, kg …) with a "whole numbers only" flag. No conversion.

**Warehouse** — a place that holds stock: **central** (head-office store) or **site**. Not a PMO Entity, not a project.

**Keeper** — a user assigned to a warehouse who may record its stock movements.

**Near duplicate** (stock item) — an active item whose name reads the same as a newly typed name once case, spacing,
punctuation and accents are ignored, or whose name is one or two small typing mistakes away (the allowance grows with
name length and is none for very short names). The new-item form names each match and links to it; it is information,
never a rule — the item can still be created (#2692).

**Stock document** — one recorded movement event with a system-assigned number: **Receive**, **Transfer**, **Issue**,
**Return**, **Adjustment**, **Count**. Posted documents are immutable; a mistake is corrected by a later document, never
an edit. Distinct from the **Goods Receipt** procurement record, whose only lines are the quantities a three-way match reads.

**Stock ledger entry** — one signed quantity-and-value line per item and warehouse written when a document posts.
Append-only. The ledger is the trace.

**Issued share** — for one item on one work order: its net issued quantity (issues less returns) as a percent of the quantity planned for that work order (the BoQ material allowance, prorated by the work order's share of the line). Per item, by quantity. #2674.

**Progress share** — a work order's progress as one percent, value-weighted over its allocated contract lines; each line counts the greater of its Confirmed accepted quantity and its validated daily-report quantity, capped at the allocated quantity. #2674.

**Issue-progress gap** — issued share minus progress share, in percentage points. An item warns when the gap is strictly greater than the organisation's threshold; the threshold is unset (no warning) until an Admin sets it. A warning never blocks. #2674.

**On hand** — quantity and value of an item at a warehouse now: the sum of its ledger entries (kept in a balance row).

**Moving-average cost** — value on hand ÷ quantity on hand at the moment of a stock-out.

**Work item** — a BoQ line (`boq_items`). Every issue names a project and a work item of that project.

**Material allowance** — the planned quantity of an item for a work item.

**Consumption** — net quantity (and value) of an item taken to a project work item: issues minus returns, by period.
It is operational and is not committed spend or an ERP actual.

**Issued material cost** — where an ERP owns the organisation's inventory, the cost the ERP books to the project when material is
issued to it (Odoo: the issue's project analytic line). It reaches the project's actuals from the ERP ledger once; the PMO stock document
supplies only the quantity and the work item, never a second amount. An issue made in the ERP with no PMO document still counts in the
project's actuals and is listed on consumption as having no work item. (#2282.)

**Uncategorised actuals** — a project's actual cost on accounts that map to no budget category. Shown with its amount, never dropped from
the project's actuals. (#2282.)

**Reorder level / suggestion** — the on-hand quantity at which an item should be reordered at a warehouse; a
*suggestion* is computed from past usage and only a person turns it into a level.

## Material requests (#2524)

**Material request** — a request for stock items and quantities for one work order, with a needed-by date. Draft,
Pending (waiting for approval), Approved, Rejected, Cancelled or Fulfilled. An approved request becomes a stock
**Transfer** draft to one of the work order's project's stock locations (its site, a yard or a staging location,
named when the project has several); a keeper posts it, which marks the request Fulfilled. Not a purchase
request: it moves stock the organisation already holds.

**Planned quantity (material request)** — for an item on a work order: the work order's **consumable plan** quantity
when it has a plan line for that item (adjusted if adjusted, else generated), otherwise the material allowances of the
contract lines the work order carries, in proportion to the share of each line the work order holds, otherwise zero.
Each request line keeps the figure it was submitted against and where it came from (standard, adjusted, allowance,
none). A line whose already-requested quantity plus the new quantity exceeds it is **over plan** and carries a reason.

**Approval chain** — the organisation's ordered list of approval steps for material requests, each naming a role and
a purpose; a step may apply only to over-plan requests. A submitted request keeps a copy of the chain as it was, and
steps are decided in order. The requester never decides a step, and one person decides at most one step of a request.

**Stand-in** — a person named, for a date range, to decide approval steps on behalf of someone away. Only that
person's own role counts (one hop), never on a request the stand-in or the person away raised; both names are kept on
the decision.

**Pinned approver** — a project's choice that one approval-chain step is decided by a named person: on requests for
that project's work orders, only that person, or their in-window stand-in, may decide the step; every other chain
rule (order, not the author, one step per person) still holds. The pinned person must be an active member holding
the step's role; an Admin or the project's manager sets the pin on the project screen, and a step with no pin stays
role-level (#2598).

**Approver notification (material request)** — an in-app notification to each person who can decide the open step of a
material request now (the step's role holders, or the live pin, plus in-window stand-ins; never the author, never
someone who already decided another step). It is written by the database, removed when the step is decided, and exists
only while the organisation's approvals-inbox setting is on (default off) (#2685).

**Approvals inbox (material-request section)** — the "Material requests awaiting you" part of the Approvals page: the
open steps the viewer may decide, from the same queue as the material-requests screen. Shown only while the
organisation's setting is on (#2685).

**Pin needing attention** — a pinned approver whose person is no longer an active member or no longer holds the
step's role: the pin stops binding, the step falls back to its role rule (and stand-ins for role holders), and the
project's setting screen flags the pin as needing attention until an Admin or the project's manager re-points or
clears it; the pin row is kept (#2605).

**Cut-off (material request)** — an optional time of day after which a request needed by the next day is refused;
later dates are not affected. Checked on the server clock in the organisation's time zone.

**Usage standard** (*standar pemakaian*) — the organisation's rule "this consumable, this much per unit of work", for
example welding rod per dia-inch welded. Names a consumable stock item, a work unit (matched to the contract line's unit,
ignoring case and spaces), an optional contract-line code prefix, a quantity per unit in the item's own unit and a waste
margin %. Where several standards of one item match a line, the longest prefix wins. Archived, never deleted.

**Consumable plan** (*rencana bahan habis pakai*) — the stock items a work order is expected to use, generated on request
from its contract-line allocations and the active usage standards, and stored as a snapshot with the basis of each quantity.
A planner may adjust a quantity, or add an item no standard covers, with a reason. It goes **out of date** when the work or
the standards change after it was made and is regenerated only on request. Quantities of stock items only: it is not the
cost plan of a work order.

## Work orders down to the cost line (#2516)

Terms added by the work-order map (#2517-#2531, #2542). **Work order**, **Discipline**, **Cost attribution**,
**Work order line** and **Work order acceptance** are defined under *Progress & billing*.

### Plan versus actual (#2519)

**Direct cost** (of a work order) — the counted cost records that name the work order, in its own currency: vendor bills
pre-tax, posted stock issues and returns at stock-ledger value, and approved equipment usage at a hire rate. Purchase
requests, orders and receipts are commitments and never add to it; hours with no rate are carried as hours.

**Shared cost** — counted cost records of a project that name no work order. Split over the project's work orders by
their share of direct cost unless Finance saves a custom split; shown as "Not assigned" (*Belum dialokasikan*) when
there is no work order to carry it.

**Shared-cost split** — a project's saved percentage per live work order (up to 4 decimals, summing to exactly 100),
used instead of the default split. It goes stale when a work order is added or cancelled, and the default applies until
it is saved again.

**Direct margin** (*margin langsung*) — a work order's billed work revenue (excluding tax) less its direct cost.
**Result after shared cost** is the direct margin less the work order's share of shared cost.

**Plan figure** — a planned amount for a work order, optionally per discipline: direct budget or indirect budget in the
work order's currency, or equipment hours or crew hours. It never changes an actual, a project total or a budget version.

**Actual crew hours** — the crew hours a work order's plan versus actual counts: hours on **Approved** timesheet weeks
naming the work order; hours on a Draft, Submitted or Rejected week are named apart as not yet approved and never
counted. Crew size is the count of distinct people with approved hours (#2626).

### Third-party inspections (#2580)

**Third-party inspection** (*inspeksi pihak ketiga*) — one external test or inspection of a work order by an outside
company, tracked from request through purchase, invitation, execution and report (Requested, Purchase raised, Invited,
Executed, Reported; Cancelled only when it is required for no gate). Its cost is never entered on the inspection: it is
read from the procurement case it links to. A re-test is a new inspection.

**Inspection prerequisite** (*prasyarat inspeksi*) — the inspections a work order must have complete before a gate
(readiness or billing). An inspection is **complete** when it is reported with a Pass or Conditional result, or when a
manager other than its creator has recorded a **waiver** with a reason. Fail and Pending are not complete. The read only
reports; the billing and readiness features own the block.

### Unit-rate catalogue (#2520)

**Rate catalogue** (*daftar tarif*) — a contract's list of priced work items (category, class, item), each with a rate per
location variant. Distinct from a contract line (what is being billed) and from contract labour rates (hour/day).

**Location variant** (*lokasi*) — a per-contract name (for example Remote, Non-remote) that selects which rate of a
catalogue item applies. Names are added, never renamed or removed.

**Effective-dated rate** — a rate that applies from a date until a later rate replaces it. An amendment adds a row and
never edits an earlier one; a contract line already priced keeps the rate it was priced at.

**Stage weights** — an optional split of an item's progress credit across named stages (for example 10 / 80 / 10),
adding to 100 and effective-dated.

### Billing stages, measurement and retention (#2522)

**Billing stage** (*tahap penagihan*) — one ordered step a progress claim passes before its invoice can be raised (for
example internal measurement, joint survey, client approval). A project lists its stages; each new progress claim takes
a copy (its *stage plan*), and the invoice is refused while any stage is open.

**Step owner role** (*peran penanggung jawab langkah*), **Step target date** (*tanggal target langkah*), **Step template**
(*templat langkah*) and **Waiting step pointer** (*penanda langkah menunggu*) — see the entry above (#2680). The pointer
sits in the needs-you list of the person whose role owns a current step and goes away when the step completes.

**Client-side stage** (*di sistem klien*) — a billing stage done in the client's own system; PMO records it by hand with
the date, the client's document number and the proof document.

**Stage checklist** — the documents a billing stage needs. A required item must have an issued or approved project
document with a file before the stage completes, and that document becomes the claim's evidence.

**Stage age** — days a billing stage has been current: from its start (the previous stage's completion) to its
completion, or to today while open.

**Invoice deadline** — the project's monthly day (1-31, clamped to the month's end) by which its invoice must reach the
client, with a warning window in days. A claim shows it while its stages remain open or it has no stage plan; it is
hidden when every planned stage is complete (#2522).

**Measured quantity** — per bill-of-quantities item, the quantity on progress claims that are not withdrawn.
**Billed quantity** — the quantity on progress claims whose invoice exists and is not cancelled. The reconciliation reads
unbilled, partly billed, fully billed or surplus.

**Retention** (*retensi*) — the share of a progress claim the client holds back until a later event; stamped on the claim
at creation from the project's percentage and held on the receivable, never as an invoice line (ADR-0103).
**Retention release** — a scheduled, then recorded, payment-due event for part or all of a claim's retention.
**Due now** (*jatuh tempo sekarang*) — what is outstanding on a client invoice less the retention still held on it
(never below zero). Ageing and overdue count only this; the retention held stays in what is owed, as its own figure,
until a release is recorded (#2625, ADR-0105 §4).

### Work-order close-out (#2593)

**Close-out checklist** (*daftar periksa penutupan*) — the organisation's ordered list of what a work order must collect
before it closes (the organisation names the items; PMO ships none). A work order takes a copy when it is issued, and
it closes only when every required item is done. A material joint count, loss report or completion report is an item of
the same list, not a separate mechanism.

**Close-out item** (*butir penutupan*) — one line of a work order's checklist: required or optional, with an attached
issued or approved project document, a done date and who marked it. Items are done in order; an item's age counts from the
previous item's done date (the issue date for the first).

### Site issues and task proof (#2521, #2531)

**Issue (site)** (*isu*) — a problem raised on site: an incident record that also names the person in charge, what must
be done, a due time, optionally a work order of its project, and photo evidence. One record serves safety incidents and
site issues; the UI says *issue* for site work and *incident* for safety events. High and Critical issues close only with
a **close proof** (a photo or document attached at close).

**Escalation** (*dieskalasi*) — the once-only step when an open issue passes its due time: the database marks it
escalated, tells the person in charge and the project manager (Admins when the project has none), and writes an audit
row. Moving the due time forward clears it, so a later miss escalates again. *Overdue* (badge and filter) is computed from
the due time alone and does not wait for the job.

**Proof of completion** (*bukti penyelesaian*) — one or more photo or document attachments on a task, held in a private
bucket. A task flagged "proof required" cannot be set Done until at least one live proof exists, for every role; once such
a task is Done its proof cannot be removed until the task is reopened. A task may also name one work order of its own
project, so a work order lists its open tasks.

### Stock for site work and material requests (#2523, #2524)

**Stock location** — a place that holds stock: a warehouse, a **site**, a **yard** or **staging** location. A yard or
staging location may name a project and behaves as any location for every posting rule.

**Site cover** (#2694) — the protection value an organisation records on a stock location (`stock_warehouses.cover_value`).
A plain recorded figure the client controls: PMO never computes, insures or enforces it, and blank means not recorded.
**Stock at risk** (the #2694 report) — the value held at a location above its cover: `max(held − cover, 0)`; with no cover
recorded the whole held value counts as at risk. The report lists every location holding stock, exposure first.

**Yard** (*halaman proyek*) — a stock location on or near a project's site where deliveries wait before use.
**Staging** (*area penyiapan*) — a stock location where materials are made ready for a work order, between the yard and the
point of use.

**Stock tag** (*label*) — a label an organisation names itself and puts on stock items (zero or one per item). A tag may be
flagged zero cost; the app never hardcodes the organisation's own word for it.

**Client-supplied (free-issue) stock** — items the client provides for the job, carried under a zero-cost tag so they add
quantity and no value. **Zero-cost item** — an item whose tag is zero cost: received only at cost 0, so its ledger value
is 0 at every step.

**Material request** (*permintaan material*) — a request for stock items and quantities for one work order, with a
needed-by date: Draft, Pending, Approved, Rejected, Cancelled or Fulfilled. An approved request becomes a stock
**Transfer** draft to one of the work order's project's stock locations (its site, a yard or a staging location,
named when the project has several); a keeper posts it, which marks the request Fulfilled. Not a purchase request:
it moves stock the organisation already holds.

**Planned quantity (material request)** — the material allowances of the contract lines a work order carries, in
proportion to the share of each line the work order holds. A line whose already-requested quantity plus the new quantity
exceeds it is **over plan** and carries a reason.

**Approval chain** — the organisation's ordered list of approval steps for material requests, each naming a role and a
purpose; a step may apply only to over-plan requests. A submitted request keeps a copy of the chain as it was, and steps
are decided in order. The requester never decides a step, and one person decides at most one step of a request.

**Stand-in** (*pengganti*) — a person named, for a date range, to decide approval steps on behalf of someone away. Never
on a request the stand-in or the person away raised; chains of stand-ins are not followed (one hop); both names are kept
on the decision.

**Cut-off (material request)** (*batas waktu harian*) — an optional time of day after which a request needed by the next
day is refused, with the earliest accepted date given; later dates are not affected. Checked on the server clock, not the
browser's.

### Client material requisitions (#2585)

**Client material requisition** (*permintaan material klien*) - a request to the client to release material the organisation
does not own, for one work order. Draft, Open (sent) or Cancelled. Different from a material request, which moves the
organisation's own stock under an approval chain. Only quantities are tracked; no requisition holds an amount of money.

**Take-off** (*take-off*) - the quantity of an item a work order needs, as typed or imported per requisition line.

**Reservation (client material)** (*reservasi*) - the client's confirmation that a quantity is set aside, recorded with the
client's own reference. Append-only; the client withdrawing part of it is a **release**. Reserved = reservations minus releases.

**Pickup (client material)** (*pengambilan*) - the physical collection of reserved material. It posts one stock receipt at
no cost into a site, yard or staging location of the work order's project, and cannot exceed what is still to collect.
Still to collect = reserved minus collected; awaiting reservation = requested minus reserved, never below zero.

### Three-way match (#2525)

**Three-way match** — an organisation switches it on (Admin) with a quantity and an amount tolerance in percent. From then,
each PMO-native bill on a goods purchase is checked line by line against the purchase's ordered items and what its goods
receipts received: billed quantity may not pass received or ordered beyond the quantity tolerance, the billed rate may not
pass the order rate beyond the amount tolerance, and the bill's pre-tax amount must agree with its lines. A bill that
fails, or states no lines, is **held**: nothing on its purchase moves to payment. Subcontract bills, ERP-mirrored bills,
bills recorded before the switch and organisations whose ERP owns purchasing are not matched.

**Match lines** — what the three-way match reads: per ordered item, the quantity a goods receipt received and the quantity and rate a bill charges. Both are edited in the app (#2634) while no money has posted on them: a Paid bill's lines, and the receipt lines of a Paid or Cancelled purchase, are refused. Whoever last records a bill's lines can no longer approve its exception; receipt edits carry no separation of duties, and are audited with the lines before and after (small teams enter both). An Admin may switch the match off while bills are held; the setting screen names how many are held now.

**Match exception** — the release of a held bill: an Admin or Finance user approves it with a reason and the purchase may
be paid again. Never the person who recorded the bill or its match lines. Permanent, and it freezes the bill's lines.

### Equipment availability (#2526)

**Equipment status** — the condition of a machine on one calendar day: ready, standby, broken, at vendor or waiting for
parts. One per machine per day; separate from what the machine did (usage).

**Physical availability** (*ketersediaan*) — the share of a machine's recorded in-service days on which it was ready or
standby, shown to one decimal. A day with no status is unrecorded and counts in neither the top nor the bottom of the
fraction; the screen names how many.

**Utilisation** (*pemanfaatan*) — approved work hours divided by available days times the organisation's working hours per
day. Standby is available but not utilised; unapproved usage is left out and named.

**Downtime period** — a run that starts at the first down status after a non-down status and ends at the first later ready
or standby status. Derived from the daily statuses, never stored. **Proven downtime** — a downtime period with at least
one proof (photo or vendor ticket) attached.

**Rental downtime deduction** (*potongan waktu henti*) — proven down days in the invoice period times the daily rate (a
monthly rate divided by the calendar days of that month), never more than the period's rental amount. Unproven days are
deducted only when a user includes them with a stated reason. The invoice check compares the vendor's bill with rent minus
this deduction; it never edits, posts or pays the bill.

### Crews, roster and attendance (#2528)

**Crew** (*kru*) — a named group of people who work together in the field, with an organisation-unique code, a field
controller, a kind (own staff or a supplier's crew) and its standard roles. A crew does not replace a person's project
assignment; it says who works together.

**Standard role (crew)** — a role a crew is built from (for example foreman, welder, helper) with the headcount the crew
should have; the roster compares it with the people placed.

**Crew member (placement)** — a person placed in a crew for an inclusive date range with an optional end; a person is in at
most one crew on any day. A correction is versioned and audited and never rewrites approved attendance.

**Roster (crew)** (*jadwal kru*) — which crews serve a work order on which dates; a crew serves one work order on any day.

**Field controller** (*pengawas lapangan*) — the user who records a crew's daily attendance; may not approve the hours they
recorded.

**Attendance record** (*kehadiran*) — one person's attendance for one day on one work order (present, absent, leave or off
rotation, with hours), whatever the capture method (roster tick, phone check-in, office correction). It becomes the
person's timesheet line, or, for a person with no login, holds their approved hours itself. Approved attendance is locked
and changes only by re-opening the timesheet.

**Attendance rate** (*tingkat kehadiran*) — a crew's present member-days over its countable member-days for a period, as a
percentage. A member-day is expected when the person was placed in the crew and the crew was rostered on a work order that
day; leave and off rotation are excused, and a day nobody recorded counts against the rate and is shown apart. It is a
review figure, not a payroll rule.

**Attendance target** (*target kehadiran*) — the organisation-wide percentage an attendance rate is measured against. It is
a setting the client owns: unset means the rate is not offered, and PMO writes no default.

### Crew tools (#2581)

**Tool line** (*baris alat*) - a named hand tool held by one crew, with a quantity and an optional serial number. Machines
that are hired, costed or tracked by usage stay equipment assets and are not tool lines.

**Tool report** (*laporan alat*) - a field report that a quantity of a tool line is damaged or lost. It lowers the crew's
usable quantity at once and creates one replacement task for the equipment coordinator.

**Equipment coordinator** (*koordinator peralatan*) - the user the organisation names to receive replacement tasks for
damaged or lost tools.

### Document expiry and the people register (#2527, #2542)

**Expiring document** (*dokumen kedaluwarsa*) — a certificate, permit or similar record with an expiry date that belongs to
a person or an equipment asset, of an org-defined document type. Added, edited and archived on the subject's record;
warned about at the organisation's thresholds (default 30, 14 and 7 days) and listed on the expiring-documents screen. A
medical type holds a status (fit / unfit) and dates only. Distinct from a project **Document** in the document register.

**People register** (*personel*) — the workforce register: anyone who holds expiring documents, whether or not they use the
app (a person may optionally link to an app user profile). Kept under Administration by Admin; app users are never added
automatically. Each person has a **person code**, assigned by the database as `P-0001`, `P-0002`, ... per organisation when
left blank, editable and unique among live people. Archiving hides a person and their warnings (soft, ADR-0018).

**People import** (*impor personel*) — the daily sync of the people register from a file. A row is matched by **person code**
(live people only): a known code updates that person's display name, job title and manager, a new code adds one, and a
preview lists every add and each changed field (old to new) before the confirm. A blank cell or absent column leaves the
stored value (the import never clears a field and never archives anyone). The manager is named by sign-in email and must
be an active user. **Person document import** is its sibling: one sheet of person code, document type, number, issue date
and expiry date adds a document or updates the person's live document of that type (the one expiring last); medical
types are never imported. Both write under the caller's own permissions (people: Admin and Project Manager; documents:
the person page's Add document rule).

**Former staff** (*mantan personel*) — a person on the register who has left, recorded by archiving them. They stay on
record with their code and documents, leave the default active list and the expiry warnings, and appear only under the
register's Former staff view (#2703). Restoring is a separate, later capability.

### Terminology and imports (#2529, #2530)

**Term override** (*istilah*) — an org Admin's replacement display name (singular and plural, per language) for one of five
fixed terms: work order, project, client-supplied stock, purchase request, discipline. It changes the wording shown, never
the data or the code identifier. Generic terms are not overridable.

**Import template** — a spreadsheet a person downloads from an import screen: the field labels as headers, one example row,
dropdowns for closed lists and a Notes sheet saying what each column holds. It carries a version; an upload of the current
or the previous version is accepted.

**Failed-rows file** — the spreadsheet offered when an import ends with rows that did not go in: the original cells of those
rows plus "Row in your file" and "Reason", so they can be fixed and uploaded again. Rows that already existed are on their
own "Already there" sheet.

### Quantity change requests (#2578)

**Quantity change request** (*permintaan perubahan kuantitas*) — a request to raise the contract quantity of one or more
contract items, raised when reported progress or the forecast passes the current contract quantity. A second person
approves it internally before it is recorded as sent to the client; the client's decision is what changes the quantity.
Not a **PO variation**, which changes what is owed to a supplier.

**Contract quantity** — the current agreed quantity of one contract item on a project. Billing, assessment and acceptance
read it; it is the quantity of the item's latest version.

**Quantity version** — one immutable record of a contract item's quantity at a point in time, with its source (baseline,
setup edit or change request), the request and the person. The history is never edited.

**Forecast quantity at completion** — the quantity a Project Manager expects a contract item to total when finished.
Recorded append-only, the latest wins. Distinct from the cost-side estimate at completion in the budget.

**Over-contract** — a contract item whose reported progress or forecast quantity is strictly greater than its contract
quantity; equal is not over. It is what allows a quantity change request to be raised.

**Request limit** — an organisation-set whole number of quantity change requests one work order may raise; empty means no
limit.

**Internal approval** — the second person's sign-off on a quantity change request before it goes to the client. It gates
submission only; the contract quantity changes on the client's acceptance.
### Subcontractor progress certificates (#2584)

**Subcontractor progress certificate** (*sertifikat kemajuan subkontraktor*) — a monthly calculation and approval record
drawn from validated daily-report quantities of a subcontractor's crews, priced at the subcontractor's rate card, less
backcharges. Once approved it becomes one vendor bill through the subcontract capture function; it never posts or pays by
itself.

**Measured line** — one certificate line: a contract item on a work order, the validated quantity measured in the month
and its rate, with amount equal to the quantity times the rate rounded to 2 decimals. Lines that cannot be certified are
listed as excluded, with the reason.

**Rate card (subcontractor)** — the versioned rates agreed with one subcontractor per contract item, each with a start
month. It is cost-side data, separate from the client-side contract rates.

**Backcharge** — an amount the subcontractor owes back (for example for damage or material we supplied), recorded on a
certificate and deducted from its gross.

**Net certified amount** — the certificate's gross measured amount less backcharges; the figure stored at submit and
captured as the vendor bill.
### Record-linked tasks (#2587)

**Record-linked task** — a task tied to one purchase, expense claim or material request, showing that record's live status.
A person who cannot read the record sees only its type and "cannot view".

**End state** — a status after which a record cannot continue, per record type (for example Paid or Cancelled for a
purchase). Reaching it closes the linked task.

**System close** — the database setting a linked task to Done when its record reaches an end state, with a stored closing reason; the history names whoever moved the record (or no one for a service sync), and a task a person closed carries no such reason.

**Open task** — a task that is not Done, archived or tombstoned.
### Work-order sections (#2576)

**Section** (child of a work order; the organisation's own word comes from the terminology dictionary) — an optional part
of one work order with its own crew, foreman, planned amounts, material check and readiness. Money, billing, acceptance
and status stay on the work order.

**Unsectioned remainder** — the part of a work order's plan not assigned to any section: the work-order total less the
sections' figures. It makes sections add up to the work order exactly.

**Roll-up invariant** — a work order's total equals its sections plus the unsectioned remainder, exactly; moving a figure
between sections never changes the total.

**Section readiness** — a per-section status (for example material and crew ready) that rolls up to a work-order
readiness view.

**Section allocation** — the planned quantity of one material assigned to a section, capped by the work order's plan for
that material.
## Supplier supply risk (#2583)

**Supply-risk status** — a supplier's state as a source of supply: Active, At risk or Inactive, set by a person (Admin or Finance) with a reason and audited; it never changes by itself and blocks nothing.

**Unpaid supplier total** — what the organisation still owes a supplier: per procurement case, its bills less its payments — or the outstanding amounts of its linked ERP invoices when the case has no PMO bill — with a missing amount meaning unknown, never zero, and a voided bill counting nothing (#2600). The payables screen, the procurement list and the supply-risk suggestion all read this one figure.

**Payables age** — whole calendar days from a *procurement case's earliest* supplier-invoice date — voided bills skipped (#2600) — to the organisation's today, for the case's unpaid balance (the payables figure is per case, one age per case); when the organisation's procurement domain is externally owned, the ERP's own aging buckets are used instead. It only suggests a supply-risk status.

**Exposed work order** — a Draft or Issued work order that has at least one open purchase order (Issued or Acknowledged) from a given supplier; it is warned when that supplier is At risk or Inactive.

## Purchase history & figure language

The purchase-history terms below describe the intended model; their presence does not assert that
every entry path is available. The associated purchase-history ADR is a draft.

**Record-only purchase** — a purchase that tracks evidence of buying already performed outside PMO;
recording that evidence does not instruct the accounting system to buy again.

**Captured purchase** — a purchase whose document evidence has been recorded in PMO.
It describes how evidence arrived, not a separate purchase lifecycle.

**Order family** — one ERP purchase order and every submitted supplier invoice that bills it; the order and its
invoices always sit in one purchase, so the order's commitment and its invoices' cost are counted once.

**Family placement** — an active Admin's decision that an order family belongs to one PMO project, recorded as one
record-only purchase (new) or as invoices attached to the order's captured purchase (attach).

**Attachment** — the invoices one family placement linked to a purchase that already held the order; it can be
undone on its own, leaving the purchase and its order.

**Capture** — the act of recording a purchase document in PMO. Whether it also creates a document
in the connected accounting system depends on the chosen entry path; record-only capture does not.

**Linked step** — a purchase step evidenced by an existing document in the connected accounting
system; it does not imply that every other step is already recorded there.

**Completeness report** — the statement of which required facts are known, missing or not checked
for a figure; it is not a claim that all the organisation's data is complete.

**Named remainder** — an amount excluded from a displayed total, identified by the reason it is
excluded, such as a missing category or project assignment.

**Capital spending** — spending classified toward an asset's acquisition or improvement rather
than the period's operating cost; lack of a project assignment alone does not decide this classification.

**Overhead** — spending not charged directly to a project; it is not a synonym for all capital spending
or for spending whose project assignment has not yet been established.

**Figure family** — a named business quantity across screens with the same meaning, population,
period, currency and treatment of incomplete evidence; a different basis is a different quantity.

**Figure agreement** — figures in the same family agree when evaluated over the same facts and
scope, including agreement that an amount is unknown.

**Feature floor** — the user actions and information a screen must retain when its composition changes.

**Pattern floor** — the minimum shared interaction and presentation conventions a screen follows;
it does not freeze a previous screen composition.

**Finding line** — a screen's short statement of current data findings, with links to the records
behind them; distinct from instructions or an explanation of the page.

**Waits on you** — work requiring the current person's action, such as a decision or a returned
submission; distinct from general project risk or everything assigned to them.

**Import key** — the stable id a row of `purchases import-history` carries; it makes a rerun safe (same row: skip) and names the row
for `purchases undo-import`. Undoing an import frees its key.

**Undo of an imported purchase** — a preview-first, Admin-only removal of one import's rows, refused once anything outside the import
exists against the purchase; audited with a reason.

**Row link** — how a list row opens its record: a real link to the record's own page, not a button, so it opens in a
new tab like any link and the list stays in place (#2077).

### Third-party inspections (#2580)

**Third-party inspection** (*inspeksi pihak ketiga*) — one external test or inspection of a work order (or later one of its
sections), tracked from request through purchase, invitation, execution and report. Its cost is never entered on it: it
is read from the linked purchase, already attributed to the work order.

**Inspection prerequisite** — a required inspection that must be complete (reported with a passing or conditional result,
or waived with a reason) before a readiness check or billing stage may pass. This feature exposes the read; the billing
and readiness tickets own the block.

UI vocabulary keeps **Supplier** rather than vendor, **Purchase** for a procurement case,
and **Phase** for a milestone. **Actual** and **Recorded spending** name the same spending position;
**Cash received** and **Settlement** name different quantities and must stay distinct.

**Proof of completion** (#2531): one or more photo or document attachments on a task, held in a private bucket. A task
flagged "proof required" cannot be set Done until at least one live proof exists; the database refuses it for every
role. Once a proof-required task is Done its proof can no longer be removed; reopen the task first. A task may also name
one **work order** of its own project, so a work order lists its open tasks.

## Unit-rate catalogue (#2520)
- **Rate catalogue** — a contract's list of priced work items (category → class → item), each with a rate per location variant. Distinct from a contract line (what is being billed) and from contract labour rates (hour/day).
- **Location variant** — a per-contract name (e.g. Remote, Non-remote) that selects which rate of a catalogue item applies. Names are added, never renamed or removed.
- **Effective-dated rate** — a rate that applies from a date until a later rate replaces it. An amendment adds a row; it never edits an earlier one, and a contract line already priced keeps the rate it was priced at.
- **Stage weights** — optional split of an item's progress credit across named stages (e.g. 10 / 80 / 10), adding to 100, effective-dated.

## Daily site report (#1522)
- **Daily site report** — one record per work order and work date: progress quantities on the work order's contract items, working hours and idle periods, weather, consumables used, and photos of the paper form. It links to equipment usage and timesheet hours; it never copies them, posts stock, or bills anything.
- **Sub-stage** — a named stage of a contract item on a progress line; it is a stage of the catalogue item's stage weights, and its rate is the item rate times that stage's weight share.
- **Daily revenue** — progress quantity times the rate in force for that item, sub-stage and work location on the work date, rounded to cents per line. A line with no rate shows "no rate" and adds nothing.
- **Validation (site report)** — a second person (never the author) confirms a submitted report; only then does it count toward revenue and progress, and its rates are frozen. **Return** sends it back with a reason. A validated report changes only by a **correction**, a new version that replaces it once validated.

## Stock for site work (#2523)
- **Yard** — a stock location on or near a project's site where deliveries wait before use. Behaves as any location for every posting rule.
- **Staging** — a stock location where materials are made ready for a work order, between the yard and the point of use.
- **Stock tag** — a label an organisation names itself and puts on stock items (zero or one per item). A tag may be flagged zero cost; the app never hardcodes the organisation's own word for it.
- **Client-supplied (free-issue) stock** — items the client provides for the job; carried under a zero-cost tag, so they add quantity and no value.
- **Zero-cost item** — an item whose tag is zero cost: received only at cost 0, so its ledger value is 0 at every step.

## Equipment availability (#2526)

**Equipment status** — the condition of a machine on one calendar day: ready, standby, broken, at vendor or waiting for parts. One per machine per day; separate from what the machine did (usage).

**Physical availability** — the share of a machine's recorded in-service days on which it was ready or standby, shown to one decimal. A day with no status is unrecorded and counts in neither the top nor the bottom of the fraction; the screen names how many.

**Utilisation** — approved work hours divided by available days times the organisation's working hours per day. Standby is available but not utilised; unapproved usage is left out and named.

**Downtime period** — a run that starts at the first down status after a non-down status and ends at the first later ready or standby status. Derived from the daily statuses, never stored.

**Proven downtime** — a downtime period with at least one proof (photo or vendor ticket) attached. Only proven down days are deducted from a rental bill unless a user includes unproven days with a stated reason.

**Rental downtime deduction** — proven down days in the invoice period times the daily rate (a monthly rate divided by the calendar days of that month), never more than the period's rental amount. The invoice check compares the vendor's bill with rent minus this deduction; it never edits, posts or pays the bill.

## Expiring document
A certificate, permit or similar record with an expiry date that belongs to a person or an equipment asset, of an org-defined document type. Added, edited and archived on the subject's record (#2542); warned about at the org's thresholds and listed on the expiring-documents screen (#2527). A medical type holds a status (fit / unfit) and dates only.

## People register
The workforce register: anyone who holds expiring documents, whether or not they use the app (a person may optionally link to an app user profile). Kept under Administration › People by Admin (HR maps to Admin); app users are never added automatically. Each person has a **person code**, assigned by the database as `P-0001`, `P-0002`, … per organisation when left blank, editable, unique among live people. Archiving hides a person and their warnings (soft, ADR-0018); **former staff** (*mantan personel*, #2703) are those archived people, kept on record and shown only in the register's Former staff view.

## Organisation terminology
**Term override** — an org Admin's replacement display name (singular and plural, per language) for one of
sixteen fixed terms: work order, project, client-supplied stock, purchase request, discipline, material request, bill of quantities,
contract item, day revenue, accepted quantity, cost variation, delivery note, stock count, imprest, stand-in, progress claim (#2712). It changes
the wording shown, never the data or the code identifier. Generic terms are not overridable. A term whose word is ordinary language elsewhere
(stand-in) is rewritten only inside its own screens' namespaces.
**Role name override** — an org Admin's own display name, per language, for one of the 28 built-in roles (#2712). Display only: the role key,
access level and stored data never change; with none, the catalogue default name shows.
**Usage standard** — an organisation rule of how much of a consumable stock item one unit of planned work uses (for example welding rod per dia-inch), matched on the contract line's unit, with an optional code prefix and a waste margin (#2577).

**Consumable plan** — a work order's stored list of consumable quantities, generated from its work-order lines and the usage standards and adjustable with a reason; material requests are checked against it before the contract allowances (#2577).
**Client material requisition** — a request to the client to release client-supplied material for one work order, tracked
from the **take-off** (the quantity the work order needs) through the client's **reservation** (their confirmation that a
quantity is set aside) to **pickup** (collection, which posts a zero-cost stock receipt). The work order shows reserved,
collected and still to collect; the figures are derived from recorded events, never stored. Distinct from a material request,
which moves the organisation's own stock.
**Tracker reading** — one figure from a machine's tracker for one unit and calendar day: engine hours and an optional place label, matched to an equipment asset by its tracker unit identifier. Held apart from usage entries; it never counts in any cost or total until a person proposes it as a Draft usage entry and a different person approves it (#2582).

**Direct-cost account** — an active posting account under an expense group in the connected company's chart, linked to a budget category for its costs. Admin or Finance may request a leaf account under an existing group from PMO; the group and the rest of the chart remain under the accountant's control.

**Unresolved account reconciliation** — an account request awaiting an authoritative link or an audited administrator disposition after its outcome could not be settled. A disposition records the administrator's reason and attestation and is available only once the original outbox is terminal and unclaimable.

## Import templates (#2530)
- **Import template** — a spreadsheet a person downloads from an import screen: the field labels as headers, one example row, dropdowns for closed lists and a Notes sheet saying what each column holds. It carries a version, and an upload of the current or the previous version is accepted.
- **Failed-rows file** — the spreadsheet offered when an import ends with rows that did not go in: the original cells of those rows plus "Row in your file" and "Reason", so they can be fixed and uploaded again. Rows that already existed are on their own "Already there" sheet.

## Contractor scope for the 15 December 2026 release (#2516, owner 2026-11-21)

**Foreman** (*mandor*) — the field role that leads a crew. A light account: one phone home screen with its own tasks,
clock-in at rostered work orders, deliveries addressed to it and its own reported issues; it also ticks its own crew's roster.
See *Light account*.

**Light account** — a cheaper seat counted separately from full accounts, for the two field roles **Foreman** and **Field user**.
It reaches only what is assigned to it (access follows roster and assignment, with no cap on the number of projects) and has no
project page, work-order page, list, dashboard, price or budget. Anyone who needs to look at a project has a full account.

**Field user** — a field role (worker, courier, receiver) that is a light account: the phone home screen shows its tasks,
clock-in where rostered, deliveries addressed to it, and issues it reported.

**Reservation** (stock) — a held quantity of one item at one location for one work order. Nothing is physically locked: stock reads
"x free + y reserved", and a work order's own request uses its reservation first. Distinct from a client's *reservation* inside a
client material requisition, which is the client's confirmation that material is set aside.

**Borrowing** — a material request that takes stock reserved for another work order. It is marked as borrowing and goes to an
approval step; whether it approves or only warns is an organisation setting.

**Delivery note** — the printable document generated from an approved material request, with signature blocks, for a handover of
goods. A client may rename it. See *Handover proof*.

**Handover proof** — the evidence that goods changed hands: the photographed signed paper, or a handover confirmed in PMO (the
logged-in person's name, time and counted quantity, photos of the goods and of the receiver; a person with no account signs on
an account holder's phone with their name typed). The organisation chooses which counts, per stock tag.

**Daily target** — a figure entered per work order for a day or a month and spread evenly over working days unless edited. PMO does not
calculate it from crews or productivity; the daily report's revenue is read against it.

**Billing board** — a view over billing records: cards are claims, columns are the steps of the claim, with age on each card. It holds
no data of its own. A step waiting on a role shows in that person's needs-you list and clears when the step completes.

**Candidate work order** — a work order that starts as an offer under a contract and is assessed with a checklist before the project
manager accepts or rejects it, with the reason recorded.

**Assessment checklist** — the organisation's own list of checks made on a candidate work order (the system supplies none); each candidate
copies it when opened, and every check there has an owner, a target date, a result (open, passed, failed or not applicable), a note and proof files.

**Ready to accept** — a candidate whose required checks are all passed or not applicable. Only then can it be accepted; rejecting is always possible.

**Close-out checklist** — the ordered list of items a work order must complete before it closes (certificates, close-out documents and
the material close-out: joint count, loss report, material completion report). The closer is recorded.

**Built-in role** — one of 28 stable roles (key such as `storekeeper`) in three tiers, offered once an organization turns the set on. Each starts from exactly one **base access level** and adds only the narrower rules listed for it as **role capabilities**. A person with no built-in role behaves exactly as before. Names are defaults a client may rename. (#2709, `docs/specs/builtin-role-set.spec.md`.)

**Base access level** — one of today's five levels (Executive, Project Manager, Finance, Engineer, Admin) that every existing rule reads from `profiles.role`. While a person holds a built-in role it is set to that role's base level and moves only with it.

**Role tier** — manager, officer or field. Managers approve, officers prepare, field roles are light accounts; a manager stands in for a manager, never upward.

**Role capability** — a narrow difference from the base level held by named built-in roles only (for example posting stock, validating a daily report, running billing stages). Other features read it through `actor_has_role_capability`.
## Leave requests (#2708)

**Leave request** — a request by or for a person to be away for an inclusive range of days, of a type from the organisation's own list.
It is Pending until the person's line manager, or a user holding the organisation's approver role, approves or rejects it. Nobody
decides a request they made, are the subject of, or entered, whatever their role.

**Leave type** — an entry on the organisation's own list of reasons for being away (leave, sickness, and so on). PMO ships none.

**Leave approver role** — the organisation setting naming which role decides leave requests besides the line manager; empty means Admin.

**On leave (roster marker)** — a chip beside a rostered person who has approved leave on the day shown. It is information only and does
not stop attendance being ticked.

**Scheduled report** — an organisation-defined record that emails a report of one kind to a list of people and roles on a daily or weekly
schedule, at a local send time in the organisation's timezone. Nothing exists until an Admin creates one.

**Report kind** — one of a small fixed set of generic reports a scheduled report can send: the daily progress summary (from the day's site
reports) and overdue tasks. The body is computed per recipient, so a figure the recipient's role may not see is left out.

**Light account** — a person whose built-in role is Foreman or Field user. One phone home screen (own tasks, clock-in at work orders they are rostered on, deliveries addressed to them, issues they reported; the Foreman also ticks their own crew). No project page, work-order page, list, dashboard, price or budget. The database confines it with restrictive row policies; the organization sets nothing beyond who holds the role. (#2710, `docs/specs/light-accounts.spec.md`.)

**Seat type** — `light` (a light account) or `full` (everyone else), derived from the built-in role. Seat reports split the two; price and counts stay the owner's.

**Hide prices setting** — the organisation setting (`hide_prices_from_requesters`, default off) that hides unit prices and amounts from a **requester**. While off, nothing changes for anyone. (#2699.)

**Requester (price visibility)** — a person with no purchasing or finance authority: a built-in officer or field role without price right (every one except Buyer, Finance Officer, Billing Officer), or a legacy Engineer who holds no built-in role. Judged per person on the real signed-in role, not per request and never on the view-as role. Prices read as empty for them through the masked views. (#2699.)
**Work-order area** — an optional point (latitude, longitude) and radius in metres on a work order. Where it is set, a phone check-in
reads the person's position once and the database decides inside or outside; where it is empty no location is asked.

**Check-in request** — a phone check-in that did not become attendance by itself (outside the area, not on the roster that day,
or no position). It waits for the check-in supervisor, who approves (attendance is recorded) or rejects with a reason; the person
who checked in never decides their own. The supervisor is the organisation's configured built-in role, or by default the crew's
field controller or a crew manager.

## Timed checkpoints (#2594)
- **Checkpoint** — a named point in the working day, set by the organisation, with a local target time, a grace in minutes and a photo-required flag. Nothing about its name or time is built in.
- **Day checkpoint** — a copy of a checkpoint for one work order, crew and date, with its due instant; once recorded it carries the server time, the person, an optional note and a photo, and never changes.
- **Started on time** — the crew's `start` checkpoint was recorded at or before its due time plus grace. Reported as a count of days, not an average of minutes.
- **Lost time by cause** — idle minutes of submitted or validated daily site reports, summed by the organisation's own lost-time cause list.

**Safety day** — one record per work order and date holding the five daily safety parts: the fitness check, the toolbox talk with its
attendance photo, the pre-work checklist, the permit to work and the safety officer's report. It is a draft until submitted, then
locked; a correction is a new version naming the one it replaces, with a reason. The check types, permit types and checklist items
come from lists the client keeps. Off until an Admin switches safety records on (#2596).

**Safe hours** — worked hours (present attendance, locked or approved) since the date of the project's last lost-time incident, or
since the start of attendance when there is none. Hidden with a reason when there is nothing to count from; never shown as 0.

**Lost-time incident** — an incident marked as one that cost working time. Only an incident manager (Admin, Executive, Project
Manager, Finance) sets the mark; it restarts the safe-hours count for the project.

**Availability target / use target** — optional organisation settings (percent) the equipment availability screen compares each metric figure with; a figure below its target is marked. Unset means no marking.

**Escalation limit** — the organisation setting (whole days, default 2) after which an open equipment downtime is flagged and notified: more than this many recorded down days.

**Task group** — a named set of a project's tasks, optionally linked to one phase (milestone). While linked and not archived, the group's
top-level, non-archived tasks count toward the phase's calculated progress, once each, together with the tasks placed directly on the
phase. A phase with no linked group is measured exactly as before. Only Admin and Project Manager manage groups (#2679).

**Issue task** — a task linked to a site issue through `incident_tasks`; one issue has many, one task serves one issue (#2677).

**Root cause** — the cause of an issue, recorded apart from the visible problem (description) and the close note (#2677).

- **Breakdown** — an equipment downtime period: from the first down status until the next ready or standby status. Identified by asset and start date; never stored.
- **Response time** (vendor) — whole minutes from the reported time of a breakdown to the recorded time the rental vendor responded; a breakdown with no recorded response is awaiting, not zero.

- **Done-not-claimed age** (#2675): whole days from the latest confirmed acceptance of a candidate's work order to the organisation's today. Information, shown on every candidate line of the billing plan.
- **Done-not-claimed alert** (#2675): off by default; when an organisation switches the reminder on and sets a day limit, lines older than the limit are flagged and Finance is told once per line. It never raises a claim or an invoice.

**Vendor location** (stock) — a stock location of kind `vendor`: material held at an outside vendor, e.g. sent out for a process. Optionally linked to a Vendor company; it names no project, takes only transfers (out and back), adjustments and counts, and is not a project location for the work-order balance. A send-out to it is not usage for reorder suggestions. Created by the organisation in Stock setup; none exists by default. (#2683, `docs/specs/stock-vendor-location.spec.md`.)
**Usage threshold** (*ambang pemakaian*) — one of two percentages of a work order's planned material quantity, set per organisation by an Admin on the material-request settings (empty = off). When a submitted material request takes an item's use (already used plus the request's quantity) to or past a threshold, the request shows a warning and the project's manager gets one notification for that work order, item and threshold. A warning never blocks a request (#2686).
**Monthly plan** — one project's plan of equipment and services for one calendar month, in Draft, Submitted, Approved or Rejected status; approving it creates one Draft rental purchase per line, once (#2700).

**Plan line** — one item of a monthly plan: what is needed, optionally a work order and a plan category, a vendor, a quantity, a rate and dates inside the month; after approval it links to the purchase it created (#2700).

**Plan category** — an entry in the organisation's own list that a plan line can name (for example a kind of equipment or service); an Admin keeps it and retires rather than deletes (#2700).

**Plan approval step** — the organisation setting that says who approves a monthly plan: the project's spend approvers (then the senior approvers, then an Admin) or anyone whose role can approve spend; the author may not approve their own plan unless the organisation allows it (#2700).

**Two-step transfer** (stock) — a transfer made in two steps: *send* moves the goods out of the source into an *in-transit* location (one per transfer, made and archived by the system); *receive* records the counted quantity, accepts or rejects it (with a quality check where the item is flagged) and posts it to the destination. Off by default; an organisation setting turns it on. The one-step transfer is unchanged while it is off.

**In transit** — goods that left the source and are not yet counted at the destination. They stay on the books in the transfer's own in-transit location, so quantity and value are never lost on the road.

**Shortfall** — the sent quantity minus the counted quantity of a two-step transfer. It stays in transit, open, until someone resolves it: it arrived later, it is returned to the source, or an Admin writes it off with a reason. Rejected quantity (counted but refused) goes straight back to the source with a reason.

**Handover confirmation** — one way to give *Handover proof* in PMO: at send or receive, the logged-in person confirms the handover with their name, the time, the counted quantities, a photo of the goods and a photo of the person receiving. A person with no account signs on the logged-in person's phone with their name typed. It cannot be changed afterwards.

**Proof rule** (per stock tag) — which proof counts for items of that tag: none, signed paper, a handover confirmation in PMO, or either. A separate organisation setting says whether the proof must come *before* the movement posts or may *follow* it; a movement whose proof has not arrived reads "proof outstanding" and "proof complete" once it has.

**Proof chase list** (*daftar bukti tertunda*) — the card on the stock home listing movements whose required proof has not arrived, oldest first, with the days waiting and the missing proof. It is read live (never a stored snapshot), shown only while the organisation lets proof follow, and only to an Admin or a keeper of one of the movement's locations. See *Proof rule*.


**Work-order transfer (WOT)** — one document that moves leftover material from one work order to another of the same project: a return from the first work order and an issue to the second, both at one project location, posted together or not at all. The stock does not leave the location; the first work order is relieved of its cost and the second is charged at the location's moving average. It is off until an Admin turns on the organisation setting "work-order transfers"; a posted one is corrected by a transfer the other way. Not a *Transfer* between locations. (#2691)

**Free stock** — on hand at a location minus the active reservations there, never shown below zero; when on hand falls below what is reserved the screen says "reserved, short by n". It is computed on read, so it cannot drift from the ledger. A reservation is active until released, expired or consumed, or until its work order closes.

**Material line** (daily report) — a stock item and a quantity used, entered on the daily report (the "consumables used" rows), optionally naming the contract item it went into. While the organisation setting "validated daily reports issue their material from stock" is on, validating the report issues each in-stock line from the work order's *site location* to the work order. A line the stock cannot cover is left out whole and flagged (short, no site location, no contract item, refused), never part-issued and never blocking the report; correcting the report returns the earlier issue once and issues the corrected lines. Off by default. (#2676)

**Site location** (work order) — the site, yard or staging location of the work order's project that its daily reports take material from. Client data on the work order; empty means reports flag their material "no site location". (#2676)
## Work-order sections (#2576)
**Section** — an optional child of one work order: a place or scope with a code (unique per work order, reserved for its life), a name, an optional note and foreman, a held readiness and a sort order. It carries no value, invoice, acceptance or status of its own, and is neither a discipline (the organisation-wide cost list) nor a work-order line (a contract quantity). The organisation's word for it is the shared term `terms.section` ("Section" / "Bagian"); no screen spells it. Not the record page's layout regions, which are *panels*.
**Unsectioned remainder** — the records of a work order that name no section; shown as "Not in a section". A work order with no section has none and reads exactly as before.
**Roll-up invariant** — for every work order and every measure, the sum over its sections plus the unsectioned remainder equals the work-order total exactly (exact decimals, no rounding in between). It holds by construction: every record keeps its work order, and the roll-up is a group by section over the same records.
**Section readiness** — one held value per section (`not ready`, `ready`, `blocked`) with a note, who set it and when, each change kept in history. The work order shows counts over its live sections and "all ready"; readiness gates no transition, approval or posting.
**Section allocation** — a planned material quantity for one stock item on one section, taken from the work order's planned quantity for that item (never a second stored plan); the allocations of an item never exceed the work order's plan (#2576).

### Subcontractor progress certificate (#2584)

**Subcontractor progress certificate** — a month's measured work of one subcontractor on one subcontract purchase order and its work order, priced at the subcontractor's agreed rates, less backcharges, approved by a different person and then turned into one vendor bill. It is a calculation and approval record: it never posts or pays.
**Measured line** — a progress line of a validated, not superseded daily report whose crew is a vendor crew of the purchase order's vendor, on the order's effective revision, in the month, and in no other live certificate. Measured work is claimed per work order, day, contract line and crew.
**Rate card (subcontractor)** — the cost rate paid to a vendor per contract item and month window; separate from the client rate catalogue. A rate takes effect on the first day of a month.
**Backcharge** — a recovery from a subcontractor (rework, damage, safety, materials we supplied, other) deducted on the certificate that includes it. It lowers the bill's payable, never its amount.
**Net certified amount** — the certificate's gross less its backcharges; the figure the payment ceiling allows (the payable).
**Live certificate** — one that is submitted, approved or billed; only a live certificate holds measured work or a backcharge.
**Labour cost rate** — what an hour of a person's time costs the organisation: set per person or per role, hourly, daily or fixed monthly, with an overtime multiplier, a labour class and a start date. Cost only, never pay (#2670).

**Labour class** — an organisation-defined label on a labour cost rate (defaults direct, indirect and guard, renameable) that breaks a work order's labour cost down in plan versus actual (#2670).

**Priced hours** — approved timesheet hours on a date the person has an applicable labour cost rate; **overtime hours** are a person's hours beyond the rate's day length on one date, across all their approved lines. Labour cost is internal costing outside the ledger: it adds to a work order's direct cost, never to project actuals (#2670).

## Profit per discipline (#2669)

**Discipline revenue** — the validated progress of a project at the contract rate frozen at validation, grouped by the discipline of the contract line it was recorded against. A contract line with no discipline rolls under "No discipline". Only current, validated reports count; a validated line frozen without a rate is named as unrated and makes that discipline's revenue incomplete, never zero.

**Earned revenue** — a work order's validated daily progress at the contract rate frozen at validation (the same figure as discipline revenue, taken per work order or project). A work order with no validated progress has earned revenue "not available", never zero; a project where only some work orders have it reads "incomplete", with the count of those without (#2733).

**Billed revenue** — claims and invoices excluding tax, as the work-order billing derivation gives them: a down payment bills zero, a withdrawn claim and a cancelled invoice do not count. Per discipline it is the amount of live claim lines by the contract item's discipline; billed work no claim line itemises is shown as "Not itemised" (#2733).

**Gap between earned and billed** — earned less billed: positive is work done and not yet billed, negative is billed ahead of validated work. Shown only when both figures exist in one currency. Margin is shown on each basis (earned, billed) with the same cost; it is a management view, not revenue recognition (#2733).

**Discipline margin** — discipline revenue less the discipline's direct cost and its allocated shared cost. Shown after shared cost (the headline) and, beside it, before shared cost. A loss reads "Loss of X". Revenue and cost in different currencies are never blended. The Admin turns the view on with the organisation setting **Profit per discipline** (off by default).

**Revenue plan** (*rencana pendapatan*) — per work order, an amount of revenue entered for each plan date, in the work order's own currency, by date or by month spread evenly over the organisation's working days (the extra cents go to the earliest dates). Off until an Admin switches it on. It never changes an actual, a budget or an invoice (#2671).

**Plan to date** — the sum of a work order's revenue-plan amounts dated on or before the as-of date. **Actual to date** is validated daily revenue (validated, non-superseded daily site reports, by report date) on or before the same date; submitted reports are named apart as not yet validated and never counted. **Gap** is actual to date less plan to date; negative reads "behind plan". The project roll-up totals per currency, over the work orders that have a plan, and never blends currencies.

**Daily target, as built** (*target harian*) — the daily target above is stored as the revenue amount entered for one work order on one date. It is the same record as the revenue plan row (#2671), not a second figure; a month amount is spread over working days. The project and work-order pages read it per day, **month to date** (the sum from the first of the month to the as-of date, for target and for actual) and as a **projection to month end**: the actual so far plus its average per elapsed working day times the working days left in the month. The projection is a forecast of actual, never a target, and is empty until a working day has elapsed. No target is calculated from crews or productivity (OD-SCOPE-7) (#2672).

**Non-working date** (*hari tidak kerja*) — a calendar date an organisation does not work (a holiday or shutdown), listed by an Admin on top of its working weekdays. A working day is a working weekday that is not a non-working date. Adding a date changes later month spreads only; a target already entered on it stays and is marked (#2672).

**Working days** (*hari kerja*) — the weekdays an organisation marks as working (default Monday to Friday). A month's revenue plan is spread over them; the same setting is the base for the daily target (#2672).

**Idle cost** — the recorded idle hours of validated daily site reports, per idle reason, multiplied by the work order's hourly cost (priced labour amount divided by priced labour hours, a weighted average over its history). A lost-time view of cost already inside direct cost: shown apart, never added to it. OFF until an organisation switch and labour cost in money are both on (#2673).

**Management profit and loss** — the Reports screen (management pack) read as a profit and loss PMO produces from its own records: recognised, invoiced and earned revenue per project and, while Profit per discipline is on, cost and margin on both revenue bases. It is not a ledger statement; trial balance, profit and loss and balance sheet come from a connected accounting system. An organisation with none connected is led from Statements and the Finance hub Net profit tile to it (#2734).

**Site cash limit** (*batas kas lapangan*) — the largest single spend site cash covers (code: the organisation's imprest procurement limit). An Admin sets it on the Purchase rules card in Administration, Accounting; site cash cannot be set up until it exists.

**Receipt value** (*nilai penerimaan*) — the money a receipt stands for. A receipt stores none of its own; when there is one receipt, received in full, the screen reads it from the order lines and says so. A work order's direct cost counts the purchase once its supplier bill is recorded.
**Direct manager** — the app user recorded as a person's manager on the people register (`people.manager_id`). They are warned first when that person's documents are about to expire and may record the renewal (a later expiry date) for their own people only; Admin keeps the existing write. Separate from the line-management link on user accounts.

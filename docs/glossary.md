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

**Document category** — an organisation-owned label on every register document that also decides which roles may see it. Seven system categories are seeded (Drawing, Specification, Report, Transmittal, Submittal, Certificate, Other); organisations add their own.

**Viewer roles** — the roles allowed to see documents of one category, files included. A role not listed sees no trace of those documents; Admin is always listed.

**System category** — a seeded document category that cannot be renamed, archived or deleted; `Other` is the fallback when a document is filed without a recognised category.

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

**Procurement record** — a real document that hangs under a Procurement case: a **Purchase Request, RFQ, Quotation, Purchase Order, Goods Receipt, Vendor Invoice,** or **Payment**. Each is its own typed entity, of which a case may have **many** (e.g. several partial Goods Receipts, multiple Vendor Invoices, progress Payments). A record is **evidence** of where the case stands: document evidence advances the case to its furthest evidenced step, alongside explicit lifecycle decisions (ADR-0093). The kinds are defined below. (ADR-0033.)

**Purchase request** — a numbered, dated request record under a procurement case, with a status and amount; the case's opening document.

**Purchase order** — a numbered, dated order record under a procurement case, with a status and amount.

**Goods receipt** — a numbered receipt record under a procurement case, optionally linked to a purchase order, with a receipt date and status.

**Vendor invoice** (UI: **Supplier invoice**) — a supplier billing record under a procurement case, optionally linked to a purchase order, carrying an amount, date, status and tax details.

**Void (vendor bill)** — in an organisation with no ERP, an Admin or Finance user marks a mistyped PMO-native subcontract bill as voided, with a reason. Soft: the bill and its lines stay, it stops counting against the PO and the purchase's payments, and it can never be paid or un-voided. The person who captured the bill cannot void it unless they are the organisation's only active member. Distinct from an ERP cancel, which comes from the ERP (#1671).

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

**Field controller** — the user who records a crew's daily attendance; may not approve the hours they recorded.

**Attendance record** — one person's attendance for one day on one work order (present, absent, leave or off
rotation, with hours), whatever the capture method (roster tick, phone check-in, office correction). It becomes the
person's timesheet line, or, for a person with no login, holds their approved hours itself. Approved attendance is
locked; it changes only by re-opening the timesheet (the correction path).

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

**Cost attribution** — the optional work order and discipline a cost record names (purchase request, purchase order, goods receipt, vendor bill, timesheet line, stock movement, equipment usage); a cost with neither is a project-level cost. The work order must be on the cost's own project (ADR-0104).

**Discipline** — an entry in the organisation's own list of trades or engineering disciplines (for example civil, mechanical, electrical) that a cost can name. The Admin keeps the list on the **Cost disciplines** screen (*disiplin biaya*) and archives rather than deletes (#2623).

**Direct cost** (of a work order) — the counted cost records that name the work order, in its own currency: vendor bills pre-tax, posted stock issues and returns at stock-ledger value, and approved equipment usage at a hire rate. Purchase requests, orders and receipts are commitments and never add to it; hours with no rate are carried as hours (#2519).

**Shared cost** — counted cost records of a project that name no work order; split over the project's work orders by their share of direct cost unless Finance saves a custom split, and shown as "Not assigned" when there is no work order to carry it (#2519).

**Direct margin** — a work order's billed work revenue (excluding tax) less its direct cost. **Result after shared cost** is the direct margin less the work order's share of shared cost (#2519).

**Plan figure** — a planned amount for a work order (optionally per discipline): direct budget or indirect budget in the work order's currency, or equipment hours or crew hours. It never changes an actual, a project total or a budget version (#2519).

**Shared-cost split** — a project's saved percentage per live work order (up to 4 decimals, summing to exactly 100) used instead of the default split; it goes stale when a work order is added or cancelled, and the default applies until it is saved again (#2519).

**Work order line** — an allocation of a positive quantity of one project contract line (bill-of-quantities item) to a work order, so one contract line can be ordered across several work orders.

**Work order acceptance** — a BAST (acceptance record) for a work order, in Draft, Confirmed or Withdrawn status; a stage acceptance is cumulative evidence, and a confirmed final acceptance closes the work order at its accepted value.

**Work order acceptance line** — the quantity accepted for one contract line on a work order acceptance; the latest confirmed quantity, not a sum, is what has been accepted to date.

**Opening balance** — where a running work order or a stock location stood at go-live, loaded once by an Admin and dated at the organisation's one go-live date (#2588). A work order's opening is a confirmed acceptance marked `opening` (certified quantity) plus the quantity and value claimed before go-live, which counts as already invoiced; a location's opening is a posted stock document of kind `opening` (counted quantity at unit cost). It is not new activity, it counts once, and an Admin can reverse it only before the first real transaction. Finished work orders carry none.

**Progress assessment quantity** — the quantity completed to date for a bill-of-quantities item in a project progress entry.

**Progress claim** — a project billing claim, optionally associated with a work order, for progress or a down payment, recording gross value and any down-payment recovery.

**Progress claim line** — the quantity, rate and amount claimed for a bill-of-quantities item on a progress claim.

**Claim evidence** — a document revision and its status attached to support a progress claim.

**PMO down payment item** — the one fixed item (`DOWN-PAYMENT`) a down-payment claim names while no ERP owns revenue and the organisation has set no down-payment item; the ERP raise refuses a claim that names it. Its lines read "Down payment" and "Down payment recovery" on the invoice.

**Billing stage** — one ordered step a progress claim passes before its invoice can be raised (for example internal measurement, joint survey, client approval). A project lists its stages; each new progress claim takes a copy (its *stage plan*), and the invoice is refused while any stage is open (#2522).

**Client-side stage** — a billing stage done in the client's own system; PMO records it by hand with the date, the client's document number and the proof document.

**Stage checklist** — the documents a billing stage needs; a required item must have an issued or approved project document with a file before the stage completes, and that document becomes the claim's evidence.

**Stage age** — days a billing stage has been current: from its start (the previous stage's completion) to its completion, or to today while open.

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

**Stock document** — one recorded movement event with a system-assigned number: **Receive**, **Transfer**, **Issue**,
**Return**, **Adjustment**, **Count**. Posted documents are immutable; a mistake is corrected by a later document, never
an edit. Distinct from the **Goods Receipt** procurement record, whose only lines are the quantities a three-way match reads.

**Stock ledger entry** — one signed quantity-and-value line per item and warehouse written when a document posts.
Append-only. The ledger is the trace.

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

**Planned quantity (material request)** — the material allowances of the contract lines a work order carries, in
proportion to the share of each line the work order holds. A line whose already-requested quantity plus the new
quantity exceeds it is **over plan** and carries a reason.

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

**Pin needing attention** — a pinned approver whose person is no longer an active member or no longer holds the
step's role: the pin stops binding, the step falls back to its role rule (and stand-ins for role holders), and the
project's setting screen flags the pin as needing attention until an Admin or the project's manager re-points or
clears it; the pin row is kept (#2605).

**Cut-off (material request)** — an optional time of day after which a request needed by the next day is refused;
later dates are not affected. Checked on the server clock in the organisation's time zone.

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

### Three-way match (#2525)

**Three-way match** — an organisation switches it on (Admin) with a quantity and an amount tolerance in percent. From then,
each PMO-native bill on a goods purchase is checked line by line against the purchase's ordered items and what its goods
receipts received: billed quantity may not pass received or ordered beyond the quantity tolerance, the billed rate may not
pass the order rate beyond the amount tolerance, and the bill's pre-tax amount must agree with its lines. A bill that
fails, or states no lines, is **held**: nothing on its purchase moves to payment. Subcontract bills, ERP-mirrored bills,
bills recorded before the switch and organisations whose ERP owns purchasing are not matched.

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

**System close** — the database setting a linked task to Done when its record reaches an end state, with no person acting.

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
The workforce register: anyone who holds expiring documents, whether or not they use the app (a person may optionally link to an app user profile). Kept under Administration › People by Admin (HR maps to Admin); app users are never added automatically. Each person has a **person code**, assigned by the database as `P-0001`, `P-0002`, … per organisation when left blank, editable, unique among live people. Archiving hides a person and their warnings (soft, ADR-0018).

## Organisation terminology
**Term override** — an org Admin's replacement display name (singular and plural, per language) for one of
six fixed terms: work order, project, client-supplied stock, purchase request, discipline, material request. It changes the
wording shown, never the data or the code identifier. Generic terms are not overridable.
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

**Close-out checklist** — the ordered list of items a work order must complete before it closes (certificates, close-out documents and
the material close-out: joint count, loss report, material completion report). The closer is recorded.

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

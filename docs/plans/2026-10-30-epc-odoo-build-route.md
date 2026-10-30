# EPC/Odoo build route — proposed tickets

Parent: #1481. These are planning tickets, not filed issues. The decisions in closed children #1482–#1492, #1496, #1498, #1501 and #1502 set scope; the owner must approve the ADR and each issue's spec before build. The IDs below are local dependency references, not GitHub numbers. Each slice includes its UI, persistence, authorisation, integration and behavioural proof as applicable; split further during spec if it exceeds one worker context. No prospect-specific workflow. Money, separation of duties (SoD), authentication and token custody slices are **Director-dispatched per issue**; other bounded slices are Orca workers under the normal review gates. #902 is a cross-cutting dependency, not a replacement for server-side enforcement.

Existing-work check: searches of GitHub issues, `git log origin/dev` and `supabase/migrations` show shipped procurement, invoices, timesheets, external ownership and budget push foundations. An extension named below continues that work; closed decision tickets record scope and are not new build tickets. Research on `research/odoo20-api`, `research/odoo20-native-coverage`, and `research/lark-google-workspace` is evidence, not a substitute for verifying Odoo 20 Community against a running stock instance. The pilot order is #1486's order (a sequencing preference; real blockers are listed per ticket, most only need O1); each stage-one slice includes PMO screens for its owned domain. All ERP calls use stock APIs, the existing adapter seam and money outbox; no custom ERP module.

## Cross-cutting

### R1 — User-defined roles and scopes — extends #902

Enable an organisation admin to configure role × module × action × scope and apply it consistently to the new workflows. Preserve actual server-enforced permissions and separation of duties; view-only impersonation cannot grant authority.

**Acceptance:** Given a configured role, when a user opens or attempts a permitted or forbidden action, then the interface and server enforce the assigned scope; changing a role takes effect for subsequent actions. **Blocked by:** none. **Blocks:** nothing: new modules ship on today's built-in roles with server-side checks and register their actions in the matrix when R1 lands. **Executor:** Director-dispatched (auth/SoD).

## Stage 1 — stock Odoo adapter and PMO screens, in pilot order

### O1 — Connect and manage master data

Extend the existing adapter/repository foundation to connect self-hosted Odoo Community using JSON-2 and present partner, item/unit, project analytic account, warehouse/location and Indonesian account mappings in PMO. Include connection lifecycle, stock API capability discovery, change feed and recoverable watermark reconciliation; check version-specific claims against the running instance.

**Acceptance:** Given a stock instance, when a user maps and reads master data in PMO, then records and project/account mappings reconcile without custom modules; an unavailable connection is visible. **Blocked by:** none. **Executor:** Director-dispatched (auth/token custody).

### O2 — Purchase through payment — extends #1319

Use PMO's existing procurement workflow for Odoo purchase orders, goods receipts, vendor bills, payments and withholding, including PMO screens and status reconciliation. Preserve project analytics, approval and budget rules and the existing money outbox across uncertain outcomes.

**Acceptance:** Given approved purchasing, when a user receives goods and processes a bill and payment, then PMO shows the authoritative ERP outcomes and prevents duplicate financial posting on recovery. **Blocked by:** O1. **Executor:** Director-dispatched (money/SoD).

### O3 — Client invoices, collections and tax documents

Extend the shipped client invoice and receipt workflows to create Odoo invoices from PMO volume or time-and-materials claims, associate project analytic distribution, record incoming payments and expose ERP-generated e-Faktur through PMO. Do not claim ERP tax-document capability until tested on stock Community 20.

**Acceptance:** Given an approved claim, when invoiced and paid, then the user sees the ERP document, project attribution, payment and available tax document in PMO without duplicate posting. **Blocked by:** O1; T3 for time-and-materials claims. **Executor:** Director-dispatched (money).

### O4 — Project actuals and financial statements — extends #897 and #1173

Read and reconcile Odoo journal lines into PMO's budget-versus-actual and financial statement surfaces, retaining source, period and project analytic attribution. Reuse existing statement work and show freshness and unmapped data honestly.

**Acceptance:** Given posted journal lines, when a user opens project actuals or a statement, then totals reconcile to the ERP and unmapped or stale data is identifiable. **Blocked by:** O1. **Executor:** Director-dispatched (money).

### O5 — Stock transfers and project consumption

Connect standard ERP warehouse transfers, site issues and valuation to PMO inventory. Because project analytics on stock moves must not be assumed, post the validated consumption cost as a project-tagged journal entry using stock APIs, with an auditable link and safe recovery.

**Acceptance:** Given received stock, when transferred and issued to a project and work item, then ERP quantity and valuation reconcile with PMO's copy and the project cost is posted once. **Blocked by:** O1, T1. **Executor:** Director-dispatched (money).

### O6 — Site cash accounting

Connect PMO site advances, settlements and replenishments to Odoo cash-journal entries and surface posting status in PMO. Preserve PMO ownership of the cash plan and float while the ERP owns the accounting entry.

**Acceptance:** Given an approved site cash settlement, when replenishment posts, then the PMO float and ERP cash entry reconcile once and exceptions are visible. **Blocked by:** O1, T4. **Executor:** Director-dispatched (money/SoD).

### O7 — Labour hours and project costs

Connect approved PMO timesheets and attendance-derived labour costs to Odoo's analytic records, preserving PMO's entry and approval authority under ADR-0059. Reuse shipped timesheet approval and mirror foundations.

**Acceptance:** Given approved hours and payroll costs, when posted, then the user can reconcile each project attribution and recover an uncertain posting without duplication. **Blocked by:** O1, T7. **Executor:** Director-dispatched (money/SoD).

### O8 — Fleet and maintenance register — extends #899

Provide PMO screens for stock Odoo Community vehicle and equipment register and maintenance records, through the adapter and its reconciled copy. Keep operational usage in PMO and avoid requiring an ERP interface.

**Acceptance:** Given a registered asset, when a user records or updates maintenance in PMO, then the authoritative ERP record and PMO view reconcile. **Blocked by:** O1. **Executor:** Orca bounded worker.

## Stage 2 — PMO-native modules

### T1 — Inventory and project consumption — extends #1487

Build standard inventory: items, units, central and site warehouses, receipts, transfers, issues, returns, adjustments and counts. With ERP connected, quantities and valuation remain ERP-owned; standalone mode uses PMO authority only when delivered. Issue requires project and BoQ work item; report consumption by project/item/period against BoQ and suggest reorder levels from usage.

**Acceptance:** Given stock at a warehouse, when issued to a project work item, then a user can trace its movement and consumption against BoQ in standalone mode. **Blocked by:** none. **Executor:** Director-dispatched (stock valuation/money). Connected posting and reconciliation are delivered in O5.

### T2 — Subcontract acceptance, caps and variations — extends #1489 and #471

Reuse client acceptance and procurement approvals for periodic signed subcontract BoQ acceptance and vendor bills. Cap billable quantity by both verified and PO quantities; retain verified excess as unpayable until a budget-backed variation and PO revision is approved, or expose the dispute. Link client-chargeable variations to the existing client work-order path.

**Acceptance:** Given 120 verified against a PO of 100, when billed before a variation, then only 100 is payable and 20 remains visible; approval of a revised PO permits the remainder without bypassing SoD. **Blocked by:** O2 when connected to an ERP; none standalone. **Executor:** Director-dispatched (money/SoD).

### T3 — Time-and-materials claims — extends #1488 and #1443

Add contract rates per role or equipment unit, assemble approved timesheets and equipment usage into a client sign-off and invoiceable claim, and retain it as contract billing. Reuse the existing acceptance and invoice flows rather than a second billing system.

**Acceptance:** Given approved hours and a contract rate, when a client signs off a claim, then the resulting invoice lines show the approved quantities and rates; unsigned hours cannot be invoiced. **Blocked by:** T8. **Executor:** Director-dispatched (money/SoD).

### T4 — Site imprest plan and replenishment — extends #775 and #1490

Extend existing advances and returns with an approved monthly project/category cash plan and a fixed site float. Track cash plus settled receipts, replenish by settled receipts, route out-of-plan spend to approval and above-threshold spend to procurement.

**Acceptance:** Given a settled receipt, when head office replenishes the float, then cash plus receipts reconcile to the float and unapproved exceptions cannot bypass the required route. **Blocked by:** none. **Executor:** Director-dispatched (money/SoD).

### T5 — Employees, assignment and rotation roster — extends #1496

Create PMO-owned employee records, project/site assignments and on/off rotation roster as a usable first payroll increment. Attribute attendance and subsequent costs to the assigned project without assuming a payroll service.

**Acceptance:** Given an employee and rotation, when the roster is viewed for a period, then the assigned site and on/off days are clear. **Blocked by:** none. **Executor:** Orca bounded worker.

### T6 — GPS attendance and requests — extends #1496

Add phone clock-in/out checked against the assigned site and overtime and leave requests through existing approval routes. Retain captured time and location evidence and support the offline capture rules in T9.

**Acceptance:** Given an assigned site, when a user clocks in and requests leave or overtime, then the site check and approval state are visible; offline capture is revalidated on sync. **Blocked by:** T5, T9. **Executor:** Director-dispatched (SoD).

### T7 — Manual payroll sheet and payslips — extends #1496

Populate a monthly payroll sheet from attendance, overtime and allowances; HR manually enters or adjusts salary, PPh 21 and BPJS and produces payslips. Attribute labour cost to projects for O7; automated tax calculation and employee tax slips remain Stage 3 questions.

**Acceptance:** Given a month's approved records, when HR completes and adjusts the sheet, then payslips and project costs reflect the inputs with an auditable approval trail. **Blocked by:** T6. **Executor:** Director-dispatched (money/SoD).

### T8 — Equipment usage and allocation — extends #1271 and #1498

Capture asset hours/days by project, fuel and trips where recorded; let an organisation choose per asset internal hire rate with optional standby, actual-cost allocation by usage, or another approved allocation basis. Reuse cost-attribution rules and the ERP-owned asset register when connected.

**Acceptance:** Given one asset used across two projects, when the configured allocation is applied, then both usage and the explainable allocated amounts are visible without requiring an internal rate. **Blocked by:** none. **Executor:** Director-dispatched (money).

### T9 — App-wide PWA offline capture and targeted push — extends #718; supersedes its read-only scope

Deliver one installable PMO app with offline creation of clock events, daily reports, material issues, equipment logs and photos. Approvals, money and edits to shared records stay online; server revalidation accepts valid queued records and puts failures with reasons in a device-local Needs fixing list. Send action-needed push for approval, rejection, failed sync and low cash; user chooses phone, Lark or email per message, without duplicates.

**Acceptance:** Given an offline field record, when connectivity returns, then it is saved after server validation or remains actionable with its reason; money and approvals cannot be completed offline, and each notification uses the chosen channel once. **Blocked by:** none. **Executor:** Director-dispatched (auth and notification identity).

### T10 — Lark assistant and approval cards — extends #1502 and #720

Expose the PMO assistant in Lark direct messages with the matched PMO user's permissions; refuse unmatched users. Groups receive notifications only, and approvals use explicit card buttons rather than free text. External MCP access follows #720 and the identity model determined by #723.

**Acceptance:** Given a matched user, when they ask in a DM or use an approval card, then PMO applies their permissions and SoD; unmatched users are refused and group messages cannot invoke the assistant. **Blocked by:** none (#723, the sign-in model, is decided). **Executor:** Director-dispatched (auth/SoD/token custody).

### T11 — Daily site report — extends #1491

Build the phone-friendly PMO screen for daily installed volume, crew hours, equipment usage, materials issued, activities and photos, linked to project and BoQ work item. Reuse source records and T9 offline capture; no separate prototype or field app.

**Acceptance:** Given a foreman offline at a site, when they capture a report and later sync, then the linked report and photos are available or appear in Needs fixing with the reason. **Blocked by:** T1, T5, T8, T9. **Executor:** Orca bounded worker.

## Stage 3 — standalone ERP: open questions only

- What is the validated sequence for standalone ledger, tax, payments, stock valuation and statutory reporting, and which decisions require separate ADRs?
- How are ownership, historical records, opening balances and reconciliation cut over from an ERP without dual writers or loss of audit history?
- When and how should PMO calculate PPh 21 and BPJS and issue employee tax slips, beyond the manual sheet?
- What coexistence, rollback, data portability and certification evidence is required before removing the headless ERP?

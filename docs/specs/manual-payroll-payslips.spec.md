# Manual payroll sheet and payslips (#1518)

> **Status:** proposed; owner sign-off of §7 required before build. Defaults are recommendations, not rulings. Route #1481 and ruling #1496; blocked by #1517 (itself dependent on #1516 and #1520). Money/SoD executor: Director-dispatched Orca workers; money, authorization and SoD slices ship alone. Migration reservation: 0541–0544 only, with down migrations.

## 1. Job story and value

When a month's attendance and requests are approved, HR needs to complete a payroll sheet, review its inputs and issue each person's payslip, so people receive an explainable result and project labour costs can be reconciled to the same approved payroll. PMO owns this manual process (#1496, ADR-0094 proposed); the connected ERP owns its ledger (#1485). #1510 posts the approved project costs, not this feature. Success means the approved sheet, individual payslips and project allocations reconcile exactly, with a history of who changed and approved them.

## 2. Scope and dependencies

Include monthly draft assembly, manual payroll components and adjustments, evidence and approval history, individual payslips, and a versioned allocation export contract for #1510. The existing employee/site/rotation source (#1516) and approved attendance, overtime and leave (#1517) must expose stable identifiers, dates, approval state and project assignment; consume their shipped repository/server contracts after they land. If their actual contract cannot provide the inputs below, stop and resolve that dependency; do not invent parallel attendance records. #1520 supplies offline field capture, while all payroll changes and approvals require an online server (#1501). #902 supplies the eventual permission matrix; until then explicit server permissions and existing role policy must implement the signed audience, with a migration path to its module/action/scope model.

Excluded: automatic PPh 21/TER or BPJS calculation, statutory rates, THR calculation, employee tax slips, bank files, payments and journals. HR is responsible for the manually entered figures; this does not determine statutory correctness. #1510 owns ledger posting, reconciliation and uncertain-post recovery. Existing `cost_attribution_rules` (0376, #1271) apply only to unprojected ledger lines on read; they are not a payroll ledger or payroll input. #1510 must prevent those read-side rules and directly tagged payroll postings from counting the same cost twice. #1488 establishes attribution from operational assignments and attendance; timesheet billing rates are revenue and are not payroll rates.

## 3. Data and lifecycle

A period is an organisation-local calendar month; use the organisation's configured timezone and store its snapshot on creation. One live sheet per organisation/month; a sheet has draft, submitted and approved states. Draft rows are keyed by employee and contain input snapshots with source IDs, approval version, project and units; leave appears as evidence, never as invented paid time. Include employees with qualifying approved sources or active assignments in the month, including zero-activity employees so HR can enter salary. A source spanning a month is split at the local month boundary without duplicating duration; unresolved assignment, overlapping source, pending/rejected input, or ambiguous time is shown as an exception and excluded until resolved upstream. No GPS coordinates are copied into payroll.

Draft refresh explicitly replaces source-derived values and keeps manual amounts and their change history; show added, changed and removed sources before confirmation. Submission locks the snapshot; an upstream change thereafter marks it stale and blocks approval until returned to draft and refreshed. Concurrent refresh, submission and approval serialize on the sheet, recheck source versions and use a version token; stale writes fail visibly. Approval freezes the sheet, payslips and allocation version. Corrections after approval create a new revision referencing the prior revision, require a reason and fresh independent approval, and retain the prior issued result. A correction cannot silently replace a version already handed to #1510: expose both versions and their delta for #1510 reconciliation; no posting occurs here.

A row has non-negative manually entered base salary, overtime pay, allowance amounts, PPh 21 and employee BPJS deductions, plus named signed adjustments with a required reason. Approved hours and allowance evidence are displayed as inputs; no rate or tax computation is inferred. Gross = salary + overtime pay + allowances + positive adjustments; deductions = PPh 21 + employee BPJS + absolute negative adjustments; net = gross − deductions. Reject negative gross or net, malformed values and more than two decimal places; calculate in exact decimal currency units, not floating point. Employer contributions, if required, are a separate owner decision (§7), never silently added to take-home or project cost.

Recommended allocation (§7) allocates gross labour cost, not net pay or tax deductions, by approved attendance hours per assigned project in the month; overtime hours already included in attendance are not counted twice. Use project IDs captured with source evidence. Round to two decimal places using largest remainder, tie-break by project ID, so allocations sum exactly to gross. With no positive eligible hours, keep the amount unallocated and block submission until HR chooses an active assigned project with a reason; do not invent a project. The finance-facing allocation contains employee/revision, project, amount, period and source provenance; its audience is restricted as in §7. Posting and correction delta semantics must be agreed with #1510 before that integration ships.

## 4. Functional requirements (EARS)

- **FR-PAY-001** When HR creates a month, the system shall create at most one live sheet per organisation and month using its timezone snapshot.
- **FR-PAY-002** When HR assembles or refreshes a draft, the system shall snapshot eligible approved source evidence and assignments, include eligible zero-activity employees, and report excluded or ambiguous inputs.
- **FR-PAY-003** When HR confirms a refresh, the system shall show source differences, retain manual entries and record the actor, time and before/after values.
- **FR-PAY-004** While a sheet is draft, the system shall allow authorized HR to enter the components in §3 and reject invalid values with a field-level explanation.
- **FR-PAY-005** When amounts change, the system shall compute gross, deductions and net exactly as §3 and display the arithmetic before submission.
- **FR-PAY-006** When HR submits, the system shall validate inputs, resolve allocations and atomically freeze the source and amounts snapshot.
- **FR-PAY-007** When an authorized independent approver approves a current submitted sheet, the system shall atomically freeze an immutable approved revision, actor, timestamp, payslips and allocations; self-approval shall be denied server-side, including Admin.
- **FR-PAY-008** When a submitted sheet is rejected or returned, the system shall require a reason, retain the transition and restore editability without erasing history.
- **FR-PAY-009** When a frozen source changes or a concurrent write uses an old version, the system shall refuse approval or write and require a refresh; it shall never silently overwrite.
- **FR-PAY-010** When an approved revision requires correction, the system shall create a linked draft revision with reason and require the same validation and independent approval, preserving earlier revisions and their issuance history.
- **FR-PAY-011** When an authorized reader opens or prints a payslip, the system shall show only that employee's approved revision, period, component breakdown, gross, deductions and net; draft data shall not be issued.
- **FR-PAY-012** When an approved revision is read by #1510, the system shall supply immutable, reconciled project allocations with stable revision identifiers, provenance and correction lineage; it shall not post to an ERP.
- **FR-PAY-013** While payroll data exists, the system shall enforce organisation isolation and the signed reader/action scopes at the server on every table, RPC, export, print and aggregate; UI `can()` gates are convenience only.
- **FR-PAY-014** When any payroll input, state or issued revision changes, the system shall retain an auditable actor, timestamp, reason where required and before/after values, visible only to authorized payroll readers.
- **FR-PAY-015** While payroll is used, the system shall reuse the repository seam, permission framework, shared form primitives and soft archive conventions; approved revisions and their evidence shall not be deleted.

## 5. Non-functional requirements and errors

- **NFR-PAY-001:** All writes and approvals are online and transactional; retries use a stable request ID and cannot create duplicate sheets, approvals or revisions.
- **NFR-PAY-002:** Payroll fields, payslip output and audit history are restricted independently of project-cost visibility; no amounts or personal information appear in notifications, logs or URLs. Never expose service credentials to the client.
- **NFR-PAY-003:** Preserve approved records and audit history until an owner-approved retention policy exists; do not implement automatic deletion. Define lawful retention and employee access with the owner before rollout.
- **NFR-PAY-004:** Provide accessible keyboard-operable forms, readable errors and loading/empty states; use current design tokens and both supported locales.
- **NFR-PAY-005:** The sheet shall support 500 employees in a period without a browser crash; paginate the list at 50 rows and measure p95 first-page retrieval under 2 seconds on the local representative seed.

| Condition | User-visible result |
|---|---|
| Source missing, pending, overlapping or unassigned | Identify the exception without exposing another person's payroll; correct it upstream and refresh. |
| Invalid amount, negative net or allocation | Explain the relevant field or unallocated balance; no transition occurs. |
| Stale version or changed source | Explain that inputs changed and require refresh; preserve manual entries. |
| Unauthorized, cross-org or self-approval | Deny server-side without disclosing protected details. |
| Offline or transient failure | Preserve the local form for retry; report no success until the server confirms. |
| Correction of already exported revision | Display prior revision and delta; #1510 reconciles before any posting. |

## 6. Acceptance criteria

- **AC-PAY-001:** Given an approved month with assigned employees, when HR assembles it, then eligible source evidence and zero-activity assigned employees appear once and exceptions are identified.
- **AC-PAY-002:** Given a draft with manual amounts, when HR refreshes changed approved evidence, then the difference is shown and manual amounts remain unchanged.
- **AC-PAY-003:** Given salary 1000.00, overtime 100.00, allowance 50.00, adjustment −10.00, tax 80.00 and BPJS 20.00, when calculated, then gross is 1150.00, deductions 110.00 and net 1040.00.
- **AC-PAY-004:** Given malformed precision or a negative net, when HR submits, then the server rejects it and leaves the draft unchanged.
- **AC-PAY-005:** Given two assigned projects with approved hours 1 and 2 and gross 100.00, when submitted, then allocations are 33.33 and 66.67 and sum to 100.00; without eligible hours submission requires a reasoned assignment.
- **AC-PAY-006:** Given a submitted sheet, when its preparer or another organization attempts approval, then approval is denied; an authorized different approver succeeds and the actor and time are retained.
- **AC-PAY-007:** Given a submitted sheet whose evidence changes or version is stale, when approval is attempted, then it is refused until refreshed and resubmitted.
- **AC-PAY-008:** Given an approved revision, when HR corrects it, then a reasoned linked draft is created, the prior result remains unchanged, and a new independent approval is required.
- **AC-PAY-009:** Given an approved payroll, when an eligible employee opens their payslip, then it contains their own approved breakdown and not another employee's data.
- **AC-PAY-010:** Given unauthorized users and another organisation, when they query payroll, payslips, audit, exports or aggregates directly, then protected data and mutations are denied.
- **AC-PAY-011:** Given an approved revision and its correction, when #1510 reads the contract, then each allocation is traceable to its version and the correction delta reconciles without modifying either revision.
- **AC-PAY-012:** Given an authorized HR user and independent approver, when they prepare, submit, approve and open a payslip, then the displayed approved figures and project allocations match the entered values and evidence.
- **AC-PAY-013:** Given a submitted sheet, when an approver returns it with a reason, then it becomes editable and retains its transition history.

## 7. Owner decisions required before implementation

| ID | Decision and recommended default | Failure if wrong |
|---|---|---|
| OD-PAY-1 | Approval: authorized payroll approver other than every preparer who edited this revision; no sole-member or Admin exception. | Self-approval lets a preparer issue an unreviewed payroll; no second approver blocks small organisations. |
| OD-PAY-2 | Visibility: explicitly authorized payroll HR prepares/reads all; separately authorized approver reads all; an employee reads only their own approved payslip; project managers receive only permitted project-level totals, never person-level payroll. Admin has no implicit payroll-read override. Register actions/scopes in #902. | Broad access exposes compensation; overly narrow access prevents payroll review or employee access. |
| OD-PAY-3 | Allocate gross by approved attendance hours, with explicit reasoned assignment for zero-hour cases; employee deductions do not change labour cost. | A wrong driver or cost basis misstates project costs and margins. |
| OD-PAY-4 | Employer BPJS/other employer costs excluded until explicitly entered as separate employer-cost components in a later signed slice. | Exclusion understates loaded cost; including an assumed amount overstates it. |
| OD-PAY-5 | Payroll is a single currency per sheet, two decimal places, and only one monthly period; configured currency must be fixed for the revision. | Mixed currency or unsupported precision yields misleading totals. |
| OD-PAY-6 | Issue via authenticated in-app view and print only; no email attachments or bank payment. | Offline distribution can expose personal pay or leave employees without their expected channel. |
| OD-PAY-7 | Corrections create an immutable replacement revision; #1510 posts reconciled deltas, not both full revisions. | Posting both revisions double-counts cost; replacing history hides the issued result. |

## 8. Implementation checklist

- [ ] Owner signs decisions and confirms retention, source contract and #1510 correction handshake.
- [ ] Build source snapshots and private server permissions, then money/approval and allocation slices independently with pgTAP mutation proofs.
- [ ] Build authorized sheet and payslip UI using existing repository and policy seams; validate locales and accessibility.
- [ ] Execute AC ownership in the companion plan, review security and rendered states, then release under project gates.

# Employee assignment and rotation roster — #1516

**Status:** proposed; owner decisions below require sign-off before build. **Job story:** When planning a crew over a period, an operations administrator wants to see each person's project, site and on/off days, so the right people can be scheduled and later attendance and costs can be attributed. Success: a scheduler can create a person without a login, assign them to a site, and correctly read their cycle across a period boundary.

## Scope and grounding

This is the first usable increment of #1496: PMO-owned people, project/site assignments and roster. #1488 says attribution follows operational records; this increment supplies an effective-dated assignment lookup, not attendance, payroll, postings or client billing. #1517 owns clock-in/out, GPS and leave/overtime; #1518 owns the manual payroll sheet and payslips; #1510 owns the Odoo labour/cost connection; #1514 owns T&M billing. #1520 implements the #1501/#718 offline capture ruling; shared roster edits are online only. #902 owns the eventual configurable role matrix. Nothing here requires a payroll service or an ERP connection.

Existing `erp_employees` is an external mirror, with a separately confirmed profile link (0136/0148); it is not a PMO employee master. Existing `timesheets` identify a profile and `timesheet_entries` carry their own project and date (0001); their approval and ERP paths remain intact. A PMO employee may exist without a profile or ERP identity; an explicit one-to-one profile link permits a future consumer to resolve an employee without matching names or email. Existing ERP matching remains the authority for ERP links; this increment does not auto-create, import, merge, overwrite or link an ERP employee. The lookup below is a contract for later consumers, not a change to existing timesheet attribution.

## Proposed defaults for owner decision

These are recommendations, **not signed rulings**. Implement only after owner sign-off; changing one requires updating the spec, plan and tests.

| ID | Decision and recommended default | If wrong, what breaks |
|---|---|---|
| OQ-ER-1 | One assignment per employee per calendar day; reject overlaps, including different projects/sites. | A person legitimately split across sites cannot be represented; allowing overlap without an allocation rule makes later attribution ambiguous. |
| OQ-ER-2 | Site is a required human-readable label scoped to the assignment and project, not a GPS boundary or new global site register. | A site renamed independently in multiple assignments becomes inconsistent; a free label cannot verify location. #1517 must decide its own authoritative site/geofence model. |
| OQ-ER-3 | Cycle is on-days then off-days, each an integer from 1 to 366, anchored on the first on-day; no ad hoc daily overrides in this increment. | Irregular shifts cannot be represented without ending and replacing a segment; silently treating an exception as a regular day misstates the roster. |
| OQ-ER-4 | Admin manages employee identity and links; Admin and Finance manage assignments; Admin, Finance and Executive view all; a linked employee views their own roster. | An operations scheduler without those roles cannot plan crews, or a broader audience could see people outside its remit. #902 must register employee.view/manage, assignment.view/manage and roster.view with scope before custom roles are enabled. |
| OQ-ER-5 | Assignments are inclusive dated segments, with an optional open end. Corrections replace a segment atomically with optimistic version checking and audit; archive a person only after all their open/future assignments end. | A mistaken historical correction could alter downstream attribution; later consumers must freeze the assignment ID and relevant facts at capture and define their own correction rules. |
| OQ-ER-6 | Employee fields: organisation-unique employee code, display name, active/archive status, optional explicitly selected same-org profile. No salary, personal contact, tax, GPS or bank data. | A later payroll increment needs more fields; collecting them here would expose information unnecessary for planning. |

## Functional requirements

- **FR-ER-001** When an authorized Admin creates or edits an employee, the system shall save a nonblank display name and case-insensitively unique, trimmed code within the organisation, and preserve a stable employee ID.
- **FR-ER-002** When an Admin links a profile, the system shall require an active profile in the same organisation, prevent a profile from linking to more than one unarchived employee, and record the actor and change in the audit log. It shall not infer identity from a name or email.
- **FR-ER-003** When an authorized planner creates or corrects an assignment, the system shall require an active employee, same-organisation project, nonblank site label, inclusive start and optional end dates, and a cycle anchor, on-days and off-days; the end shall not precede the start and the anchor shall equal the start.
- **FR-ER-004** When an assignment overlaps another non-archived segment for the same employee, including an open-ended segment, the system shall reject the write atomically, including under concurrency; adjacent dates are permitted.
- **FR-ER-005** When an authorized planner corrects or ends an assignment, the system shall require the version last read, reject stale writes, record before/after and actor, and preserve its stable ID. When archiving an employee with an assignment ending today or later or with no end, the system shall refuse and explain that the assignment must first end.
- **FR-ER-006** When a roster is requested for inclusive dates, the system shall display the employee, project, site and on/off state for each assigned date, and explicitly display unassigned dates. The cycle day offset is `(date - anchor) mod (on_days + off_days)`; offsets below on_days are on, the rest off. Dates are calendar dates, independent of browser timezone.
- **FR-ER-007** When a period has no employee or no assignment, the system shall show an actionable empty state; when loading or saving fails, it shall retain the user's inputs and present a retryable error. Roster reads shall be limited to a maximum 62 days per request and paginate employees without silently truncating results.
- **FR-ER-008** When a downstream authorized service asks for an employee and date, the system shall return the unique effective assignment ID, project, site and on/off state, or an explicit unassigned result. It shall not invent hours, attendance, wages or cost, or mutate existing timesheets.
- **FR-ER-009** While the user lacks permission, the system shall deny reads and writes at the server, scope every relationship to the same organisation, and hide unavailable actions using `can()` as UX only. The linked employee may read only their own employee and roster data.
- **FR-ER-010** When an employee or assignment is archived, the system shall retain historical records and audit history; it shall not hard-delete referenced business records. Archive requires confirmation. All writes are online.

## Non-functional requirements

- **NFR-ER-001:** RLS and server-side writer authorization enforce the role and organisation scope, including inactive users and foreign IDs; never rely on hidden controls. Use ADR-0016/0017/0018/0019 and `org_id` stamping.
- **NFR-ER-002:** Inputs and table headers are keyboard accessible, labelled and available in English and Indonesian; loading, empty, error and mobile views are usable and axe-clean.
- **NFR-ER-003:** The date interval and employee page are bounded, indexed by organisation, employee and date; no PII, secret or sensitive data in tests, public documents or logs. Audit stores only the minimum changed fields.
- **NFR-ER-004:** Migrations are reversible and preserve existing timesheet and ERP employee contracts. Rollback must refuse if it would discard employee or assignment records.

## Acceptance criteria

- **AC-ER-001** Given no profile for a new person, when Admin saves a code and name, then the employee exists and can be assigned without an ERP connection.
- **AC-ER-002** Given two employees in one organisation, when Admin links the same active profile to both, then the second link is refused; a profile in another organisation is also refused.
- **AC-ER-003** Given an employee assigned to a project and site from 1 March with a 14-on/7-off cycle, when the roster is viewed for 14–23 March, then 14 is on, 15–21 are off and 22–23 are on, with the site visible.
- **AC-ER-004** Given an assignment ending 10 March, when another begins 10 March, then it is refused; when it begins 11 March, then it is accepted. Two concurrent overlapping creates result in exactly one success.
- **AC-ER-005** Given a stale assignment version, when a planner saves a correction, then no change is made and a conflict is returned; a fresh correction is audited with actor and before/after.
- **AC-ER-006** Given an employee with an open assignment, when Admin archives them, then archive is refused; after the assignment ends before today in the organisation timezone (UTC if unset), archive succeeds and history remains readable.
- **AC-ER-007** Given an assignment on a date and a date outside it, when an authorized consumer resolves each date, then the first returns its ID, project, site and state and the second returns unassigned.
- **AC-ER-008** Given another organisation's employee and a nonprivileged user, when they attempt a read or write, then no foreign data is returned and the write is denied; an inactive member is denied and a linked employee sees only their own roster.
- **AC-ER-009** Given an empty period or a failed save, when a planner uses the roster, then the empty state explains the next action or the error preserves entered values and offers retry.
- **AC-ER-010** Given an employee with an assignment, when a planner opens a period, then each date clearly shows its site and on/off state, including an unassigned day, with keyboard access.
- **AC-ER-011** Given 63 requested days or an invalid cycle/date, when submitted, then the server rejects it with an actionable validation error; a 62-day request succeeds and employee pages have a continuation.
- **AC-ER-013** Given an Admin and a project, when they create a person without a login, assign a site with 14-on/7-off from 1 March and view a period spanning the start and cycle boundary, then the roster shows unassigned, on and off days with the assigned site.
- **AC-ER-012** Given an existing profile-linked ERP employee and timesheet, when a PMO employee is created or linked, then their existing ERP link and timesheet project remain unchanged.

## Error handling

| Condition | Response |
|---|---|
| Duplicate code/profile or overlapping assignment | Refuse; identify the conflicting field/period without disclosing another organisation. |
| Stale version | Conflict; retain input, reload current version before retry. |
| Missing/foreign/inactive reference or unauthorized caller | Deny safely; do not reveal foreign record details. |
| Invalid dates/cycle or period >62 days | Field or period validation message; no partial write. |
| Network failure | Keep form input and allow retry; no offline shared edit. |

## Implementation checklist

- [ ] Sign off OQ-ER-1 through 6 and the UI sketch; update this spec and plan if changed.
- [ ] Deliver isolated employee, assignment and read contracts with RLS, audit, collision-safe writes and rollback.
- [ ] Register role actions, repository/hooks, accessible UI and translations; prove the journey and listed ACs at their owning layers.
- [ ] Have #1517/#1518/#1510 explicitly adopt the dated lookup and immutable capture semantics when those issues are designed; do not assert that this increment already posts costs.

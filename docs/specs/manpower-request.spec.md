# Spec: Manpower request, ask for roles and head counts, get approval, watch it filled

**Status:** proposed. IDs `FR-MPR-###`, `AC-MPR-###`. Plan: `docs/plans/2026-11-22-manpower-request.md`. Map: People, crews and time (lane gap-people). Scope ruling OD-SCOPE-2 (no client process in code). No on/off setting: on for every organisation.

## Job story
When a site needs people, I want to request the roles and head counts needed by a date, have the request approved, and see per need how many were asked, filled and are still open until it is met, so the people team can fill it by assigning people.

## Today (verified, base fc42e1a0)
- No manpower, staffing or resource request exists. `scripts/prior-art.sh` on manpower, requisition (only client material requisitions, 1162/1163), "resource request", staffing, position, trade finds nothing for people; absence in those five sources, not proof elsewhere. Reuse is therefore the pattern, not a feature.
- **The trade/position list exists:** `public.cost_disciplines` (`supabase/migrations/0950_cost_disciplines.sql:7`), the organisation's own list of trades, kept by the Admin, archived not deleted; every active member reads it (policy `cost_disciplines_select`). Glossary "Discipline" (`docs/glossary.md:406`) names it a list of trades. A crew already names one (`crews.discipline_id`, `1035_crews_roster.sql:20`). Other candidates are not lists: `people.job_title` is free text (`1035:53`), `crew_standard_roles.name` is per crew (`1035:35`). Decision: a need names a discipline. No new position list.
- **People to assign:** `public.people` (workforce register; Admin and Project Manager insert/update, `1035:58-64`) and the member-readable `people_directory` view (`1035:69`). Crew placement is `crew_members` (`1035:76`) and `crew_can_manage()` (Admin, Executive, Project Manager, `1035:207`). Placement needs a crew and a date range; a manpower need has neither, so assignment to a need is its own record (see Model).
- **Approval pattern to reuse (two shipped, both DB-enforced, no direct table writes):**
  - Single approver, author never approves: `qcr_assert_approver` (`1177_quantity_change_approval.sql:19-31`): role check, then `v_uid = author_id ... raise 'separation of duties'`; `qcr_approve`/`qcr_return` call it; no sole-user exception (OD-QCR-3). ADR-0019 item 2 (`approver != author`).
  - Configurable multi-step chain for material requests (`approval_chain_steps`, `1000_material_requests.sql:35`), requester never approves, stand-ins. Too heavy for this item: a manpower request has one decision. Not reused; the single-approver rule is.
- **Telling people:** `notify_workflow_user(org, user, title, body, kind, entity, entity_id, label)` (`0237_workflow_notifications.sql:13`) tells the requester the outcome (as `qcr_approve` does, `1177:45`). The approver's needs-you pointer is derived on read, never stored: `my_waiting_billing_steps` -> `summariseWaitingSteps` (`pmo-portal/src/lib/waitingSteps.ts`) -> `waitingBillingSteps` fact in `buildNeedsItems` (`pmo-portal/src/components/dashboard/restructure/useNeedsYou.ts`). Reuse that shape.
- Roles are access roles (`user_role`, `0001`); they are not used as job positions here.

## Model
- `manpower_requests`: project, needed-by date, note, status `pending | approved | rejected | cancelled` (met is derived, not stored), requester, decider, decision note. Code `MP-0001` per organisation.
- `manpower_request_needs`: request, discipline (from `cost_disciplines`), head count asked (1 to 500). Distinct discipline per request.
- `manpower_assignments`: need, person (from `people`), assigned by, assigned at, released at (soft release, ADR-0018). One live assignment per (need, person).
- `manpower_need_progress` (view, security barrier): per need `asked`, `filled` (live assignments), `open = asked - filled`. A request is **met** when every need has open = 0.
- No client table write: security-definer RPCs only (ADR-0019), RLS + FORCE RLS, reads same-org active members, org stamped by trigger.

## Requirements (EARS)
- FR-MPR-001 The system shall let a requester submit a request for a project with a needed-by date and one to twenty needs, each a discipline and head count; it enters `pending`.
- FR-MPR-002 The database shall refuse a needed-by date earlier than today (organisation time zone), a head count outside 1 to 500, an archived or foreign discipline, a duplicate discipline in one request, and an archived or foreign project.
- FR-MPR-003 When a request is pending, an approver (Admin, Executive, Project Manager) other than the requester shall approve it or reject it with a reason; the database shall refuse the requester (separation of duties, no sole-user exception) and every other role.
- FR-MPR-004 The requester shall cancel a request while it is pending, or an approver before anyone is assigned; a decided request is never edited.
- FR-MPR-005 While a request is approved, a people manager (Admin, Project Manager) shall assign a person from the register to a need and release them; the database shall refuse assignment on a request that is not approved, an archived or foreign person, the same person twice on one need, and more people than the head count asked (`MPR_FULL`).
- FR-MPR-006 The system shall show per need asked, filled and open, and per request whether it is met, from the one view above on every surface.
- FR-MPR-007 When a request is submitted the approvers shall be told (notification) and the request shall list in their needs-you list until decided; the pointer is derived on read and excludes the requester's own requests.
- FR-MPR-008 When a request is approved, rejected or cancelled by someone else, the requester shall be notified of the outcome with the reason; when the last open head count is filled the requester shall be notified that it is met.
- FR-MPR-009 While an approved request has open head count, people managers shall see it in their needs-you list with the open total and the earliest needed-by date.
- FR-MPR-010 The Manpower page (project tab entry and a company list) shall show loading, empty (says what is missing and who adds it), error and filled states; a disabled control says why; strings in English and Bahasa Indonesia; works at 390 px and 1440 px.
- FR-MPR-011 Every refusal shall have an English and Bahasa Indonesia sentence in the refusals catalogue saying what to do next: `MPR_SELF_APPROVE`, `MPR_NOT_APPROVER`, `MPR_NOT_PENDING`, `MPR_NOT_APPROVED`, `MPR_FULL`, `MPR_DUPLICATE`, `MPR_DATE_PAST`, `MPR_REASON_REQUIRED`, `MPR_NOT_FOUND`.
- FR-MPR-012 Another organisation shall read and write nothing; every decision and assignment is audit-logged.

## Acceptance criteria and owning layer
| ID | Given / When / Then | Layer |
|---|---|---|
| AC-MPR-001 | Given a PM, when they submit a request with two disciplines and a future date, then it is `pending` with code MP-0001 and two needs. | pgTAP |
| AC-MPR-002 | Given past date, head count 0 or 501, archived discipline, duplicate discipline, archived project, when submitted, then each is refused with its code. | pgTAP |
| AC-MPR-003 | Given a pending request by PM A, when A approves it, then `MPR_SELF_APPROVE`; when PM B approves, it is approved with decider B. Engineer, Finance are `MPR_NOT_APPROVER`. A sole Admin who requested cannot approve. | pgTAP (+ mutation check) |
| AC-MPR-004 | Given a pending request, when rejected without a reason then `MPR_REASON_REQUIRED`; with a reason it is rejected and a second decision is `MPR_NOT_PENDING`. | pgTAP |
| AC-MPR-005 | Given a pending request, when the requester cancels it, then cancelled; an approved request with an assignment cannot be cancelled. | pgTAP |
| AC-MPR-006 | Given an approved need of 3, when two people are assigned, then asked 3, filled 2, open 1; a third fills it (request met); a fourth is `MPR_FULL`; the same person twice is `MPR_DUPLICATE`. | pgTAP |
| AC-MPR-007 | Given a pending request, when assigning, then `MPR_NOT_APPROVED`; given an archived person or a foreign-org person, then refused. | pgTAP |
| AC-MPR-008 | Given a released assignment, then filled drops by one and open rises by one; the person can be assigned again. | pgTAP |
| AC-MPR-009 | Given roles and a second organisation, when each reads and writes tables directly, then members read, nobody writes outside the RPCs, the other organisation sees nothing. | pgTAP |
| AC-MPR-010 | Given submit, approve, reject, cancel, last fill, then the right person gets one notification each (approvers on submit excluding the requester; requester on outcome and on met). | pgTAP |
| AC-MPR-011 | Given pending requests by others and by me, then `my_waiting_manpower_requests` lists only those I may decide and not mine; given approved requests with open head count, people managers see the open total and earliest date; a fully met request is in neither. | pgTAP + Unit (`buildNeedsItems`) |
| AC-MPR-012 | Given the Manpower page, then loading, empty (names who adds it), error with retry, and a request card with asked/filled/open per need render; Approve is disabled for the requester with the reason shown. | Unit (RTL) |
| AC-MPR-013 | Given the en and id dictionaries and refusals catalogue, then every new key and code exists in both and none is an untranslated copy. | Unit |
| AC-MPR-014 | Journey: PM requests two roles for a project, a second PM approves from the needs-you list, the people manager assigns three people, the requester sees filled 3 of 3 and "met". | E2E (one curated, `e2e/AC-MPR-014-manpower-request-journey.spec.ts`) |

Mutation checks (break the rule, the named test must go red): remove the `v_uid = requester` clause (AC-MPR-003); drop the `filled >= asked` guard (AC-MPR-006); drop the status = approved guard on assign (AC-MPR-007); drop the notify call to the requester (AC-MPR-010); drop the requester exclusion in `my_waiting_manpower_requests` (AC-MPR-011).

## Settings proposed
None. Approver roles, filler roles and the discipline list are code constants shared with `crew_can_manage` / people policy and the customer's own list. No customer process in code.

## Questions only the customer can answer
1. Who approves? Recommended: Admin, Executive or Project Manager other than the requester, one decision, no sole-user exception. If the customer needs several steps, that is a later reuse of the material-request chain.
2. Is the existing trades list (the Cost disciplines screen) the right list for "role"? Recommended: yes; the Admin adds missing trades there.
3. Is a request per project enough, or per work order too? Recommended: per project now.
4. Should assigning a person also place them in a crew? Recommended: no; the people team places them in a crew on the Crews page as today (avoids guessing a crew and dates).

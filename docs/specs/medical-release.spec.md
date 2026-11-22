# Spec: Medical release before rostering again

**Status:** re-scoped to the minimal form (steering, 2026-11-22): a release per person and date, modelled on leave requests. IDs `FR-MR-###`, `AC-MR-###`. Plan: `docs/plans/2026-11-22-medical-release.md`. Map: People, crews and time. Scope: OD-SCOPE-12 (leave and sick requests, pulled forward). Executor: Orca worker; approval and the rostering block are enforced in the database (ADR-0019).
**Relates to:** `leave-requests.spec.md`, `crews-roster-attendance.spec.md`, `builtin-role-set.spec.md` (medical documents held by HR Manager, HR Officer, Administrator only; `docs/decisions.md`).

## Job story
When a worker returns after sickness or injury, I want their direct manager to approve the medical release before they can be rostered again, so that nobody is put back on site unreleased; and the worker is told after the decision.

## Today (verified, base land/fix-1122 at fc42e1a0)
- Leave and sick requests exist: `supabase/migrations/1240_leave_requests.sql` (tables `leave_types`, `leave_requests`; `leave_authority` at 1240 §4), `1241_leave_rpcs.sql` (`leave_request_submit`, `leave_request_decide` at :55, `leave_request_cancel`, `leave_on_date` at :156). Whole feature off until `organizations.leave_requests_enabled` (1240 §1, default false). Leave types are organisation data with no "sick" flag and no release step.
- Nothing blocks rostering today. Approved leave is only a roster marker (`leave_on_date`, 1241:156); `leave-requests.spec.md` FR-LV-010 says it never blocks. Placements are `crew_members` and `crew_loans` (`1035_crews_roster.sql:76`, `1245_crew_loans.sql:10`); their only write guards are `guard_crew_refs` (1035:125, crew_members branch :160) and the crew-loan guard (1245), neither of which looks at leave or health.
- "Direct manager" has two columns: `profiles.manager_id` (0007; used by `leave_authority`, 1240 §4, for a person with a login) and `people.manager_id` (0970:11, `people` register incl. workers without a login; used by the expiry-document read policy). `leave_authority` reads only the first.
- Medical content: `expiry_documents.is_medical` + `medical_status` fit/unfit and dates only (0970:61-72). A manager reads only non-medical documents of their reports (policy `expiry_documents_select`, 0970:139). Medical rows are Admin-only on the base.
- Role rule: branch `feat/role-capabilities-one-gate` is NOT merged into `land/fix-1122` (9 commits ahead incl. temporary "mut" commits). It adds `may_see_medical_documents(profile)` / `actor_may_see_medical_documents()` (migration 1535) = Admin level or capability `medical_documents_view` (HR Manager, HR Officer, Administrator). Its migrations are 1530-1540; this item uses 1750-1759, so they do not collide.
- Item text vs code: the base has no notion of a "release". It is new, and deliberately NOT hung off leave approval or a per-type flag.
- Shared notice: `notify_workflow_user` (0237, latest form with email event) writes an in-app notice to an active same-org member. Migration 1750 adds `notify_person(person, kind, title, body, link)` over it, for this item and the expiry-to-manager notice.

## Boundary (do not widen)
- A release is a decision (Pending / Approved / Deferred) with decider, time and a short note. It holds NO medical content: no diagnosis, no fit/unfit, no document. It is not a general approvals engine.
- The manager sees only the release state for their reports. Medical documents stay behind the role rule (`feat/role-capabilities-one-gate`, not merged). This item adds no read of `expiry_documents`; it reads the capability table (`role_has_capability`) only to decide who is "the people team".
- Join with the role branch: disjoint files and migration numbers (it uses 1530-1540). `role_has_capability` and the `people_documents_view` capability exist at head of `land/fix-1122` (migration 1200, verified by SELECT); the branch keeps that capability, so nothing here changes when it merges.

## Requirements (EARS)
- FR-MR-001 The people team (the Admin level, or the people-documents capability: HR Manager, HR Officer, Administrator) shall be able to open a release for a person and a date, with an optional note; one per person and date.
- FR-MR-002 The direct manager (`people.manager_id`, else the linked profile's `manager_id`) shall be the only one who can decide: Approved, or Deferred with a reason. A Deferred release can be decided again; an Approved one cannot.
- FR-MR-003 The database shall refuse a decision by the person or by whoever opened the release, whatever their role including Admin (SoD).
- FR-MR-004 Each create and each decision shall write an audit line.
- FR-MR-005 After a decision the system shall tell the worker (where they have a login) through `notify_person`; the notice carries the outcome and next step, never the manager's reason.
- FR-MR-006 While a release is Pending or Deferred, the database shall refuse (`MR_BLOCKED`) a new or extended `crew_members` placement, a new or extended `crew_loans` placement, and an `attendance_days` insert or change that puts the person to work (status present, the only status that carries hours; absent, leave and off-rotation rows are allowed) for any day on or after the release date. Shrinking a placement and stamping an existing row (approval, lock) are not refused. Enforced by BEFORE triggers; `attendance_record` is not restated.
- FR-MR-007 Roster and attendance screens shall show a held person as "release pending" (or "deferred") with the controls disabled and the reason; the state word is the only thing roster users can read (`medical_release_holds`), whose read is scoped to rostering roles: the people team, the person's direct manager, a crew manager, and whoever can record attendance for a crew the person is placed in or loaned to that day; everyone else gets no rows. A field (light) account, such as a foreman ticking their own crew, may call it and qualifies only through attendance_can_record for that crew; the read is listed as a field path in the field-account sweep. If the read fails, the tick screen shows no hold and the database still refuses the row.
- FR-MR-008 Releases are readable by the person, whoever opened them, the people team and the direct manager only. Writes only through the RPCs; `org_id` stamped by trigger.
- FR-MR-009 The direct manager shall find releases awaiting them in a section of the Approvals page; the people team shall open a release from the same page. Refusals have English and Bahasa Indonesia sentences saying what to do next.
- FR-MR-010 `notify_person(p_person, p_kind, p_title, p_body, p_link)` shall notify only an active member of the person's organisation, never the acting user, and do nothing for a person with no login; clients cannot execute it.

## Setting
None. Nothing changes for an organisation until the people team opens a release, so today's behaviour is kept by construction.

## Acceptance criteria and owning layer
| ID | Given / When / Then | Layer |
|---|---|---|
| AC-MR-001 | the people team opens a release; a non-people-team user is refused; a second for the same person and date is refused | pgTAP |
| AC-MR-002 | the direct manager (either manager column) approves; a peer or an Admin who is not the manager is refused | pgTAP + mutation check |
| AC-MR-003 | the person and the opener cannot decide, even an Admin | pgTAP + mutation check |
| AC-MR-004 | deferring needs a reason; a deferred release can be approved later; an approved one cannot be decided again; each step audited | pgTAP |
| AC-MR-005 | after a decision the worker has a notice with no reason text; none for a worker without a login | pgTAP |
| AC-MR-006 | with a pending or deferred release, a placement or loan reaching the release date and a present attendance row on or after it are refused `MR_BLOCKED` (absent and leave rows are allowed); earlier ones, other people, a shrink and a lock stamp are allowed; after approval all are allowed | pgTAP + mutation check (drop a trigger; must go red) |
| AC-MR-007 | rostering roles read a state word only; an active member outside them (an Engineer outside the crew, a foreman of another crew) gets no rows; the foreman of the person's crew gets the state word; no row, no note; another organisation reads nothing | pgTAP + mutation check (remove the scope predicate) |
| AC-MR-008 | the tick screen shows a held person as release pending with disabled controls and the reason; the save leaves them out | Unit |
| AC-MR-009 | the manager sees Approve and Defer (with reason) on their reports' releases; the people team sees the open form; others see neither | Unit; one e2e journey |
| AC-MR-010 | `notify_person` notifies an active member, nobody else; not executable by signed-in callers | pgTAP (1750 test, shipped) |
| AC-MR-011 | every `MR_*` code has an English and a Bahasa Indonesia sentence | Unit (refusals gate) |

Mutation plan: (1) remove `zz_mr_attendance_days` -> AC-MR-006 red; (2) make `medical_release_authority` return true -> AC-MR-002 red; (3) drop the SoD test in decide -> AC-MR-003 red.

## Questions (coordinator collects)
Whether a deferral should expire; whether a person with no direct manager is decided by an Admin (today: no one but the Admin-level people team cannot, so such a person is released by setting a manager). Recommended: set a manager first; no fallback.

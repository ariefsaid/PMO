# Spec: Leave and sick requests with approval (#2708)

**Status:** proposed. IDs `FR-LV-###`, `AC-LV-###`. Plan: `docs/plans/2026-11-21-leave-requests.md`. Map #2516; scope ruling OD-SCOPE-12 (`docs/decisions.md`). Executor: Orca worker; approval is SoD, enforced in the database.

**Relates to:** `crews-roster-attendance.spec.md` (people register, crews, work-order roster, `attendance_days.status = 'leave'`), `timesheets-approval.spec.md` and ADR-0070 (line manager via `profiles.manager_id`, approver authority by rank), ADR-0019 (server-enforced SoD).

## Job story
When I cannot work, I want to request leave or report sickness, so my manager approves and the roster follows.

## Boundary
- A request belongs to a person in the workforce register (`people`). A person with a login (`people.profile_id`) can request for themselves; a person without a login (vendor or field worker) is entered by an office user on their behalf.
- Leave types are an organisation-defined list. PMO ships no type names and no day allowances; a new organisation starts with an empty list and an admin adds the types.
- No balance or allowance tracking, no payroll: out of scope (OD-SCOPE-14). Days are counted only for display (calendar days in the range).
- Roster marker is additive: it is read through its own function; the existing `work_order_roster` and the attendance tick are unchanged.

## Requirements (EARS)
- FR-LV-001 The system shall keep an organisation list of leave types (name, archived flag); a name is unique among live types; archiving a type keeps existing requests.
- FR-LV-002 The system shall let a person request leave for an inclusive date range with a type and an optional reason; a request starts `Pending`.
- FR-LV-003 If a person already has a `Pending` or `Approved` request overlapping the range, the system shall refuse the new request.
- FR-LV-004 Where the request is entered by someone other than the person (office user), the system shall record who entered it.
- FR-LV-005 When a decision is made, the system shall allow it only by (a) the person's line manager, or (b) a user whose role is the organisation's configured approver role; while the setting is empty the approver role is Admin, so a person with no line manager is decided by an Admin (never their own or an entered request). The approver role is stored as a role key (text) so a built-in role key (#2709) can be accepted later without a type change; today it takes a base role.
- FR-LV-006 The system shall never allow the requester, the person on leave, or whoever entered the request to decide it, whatever their role, including Admin (SoD, ADR-0019), in the database.
- FR-LV-007 When a decision is made, the system shall store decider, time and an optional note; a rejection requires a note. Only `Pending` requests can be decided.
- FR-LV-008 While a request is `Pending`, the requester or the person may cancel it; an approver may cancel an `Approved` one, with the same SoD rule.
- FR-LV-009 Where a person is on `Approved` leave on a date, the work-order roster shall show a leave marker beside that person; an organisation with no approved leave sees the roster unchanged.
- FR-LV-010 Approved leave shall not change attendance entry or block the attendance tick. (An optional block setting is not built; see Deferred note in the plan.)
- FR-LV-011 The approvals page shall list `Pending` requests the viewer may decide, and nothing else; users who cannot decide see only their own requests on a "My leave" list.
- FR-LV-014 Where the organisation setting `leave_requests_enabled` is false (the default), the system shall show no leave navigation entry, no approvals section, no roster marker and no needs-you pointer, and shall refuse new requests. Where it is true, the approvals section and the roster marker still render nothing when there are no requests.
- FR-LV-012 Reads and writes are scoped to the organisation (RLS); `org_id` is stamped by trigger, never from the client.
- FR-LV-013 Screens shall be usable at 390 px and 1440 px, use shared form primitives and `DESIGN.md` tokens, and have English and Bahasa Indonesia strings. Writes are gated by `can()` (UX only; the RPC is the authority).

## Acceptance criteria and owning layer
| ID | Given / When / Then | Layer |
|---|---|---|
| AC-LV-001 | Given an empty type list, when an admin adds "A", then "A" is listed; a duplicate live name is refused; archived names are reusable. | pgTAP |
| AC-LV-002 | Given a person, when they request leave 10 to 12 with a type, then a `Pending` request exists; end before start is refused. | pgTAP |
| AC-LV-003 | Given a Pending request 10 to 12, when the same person requests 12 to 14, then refused; a rejected or cancelled range can be re-requested. | pgTAP |
| AC-LV-004 | Given an office user entering for a person with no login, when submitted, then the request records the enterer and the person. | pgTAP |
| AC-LV-005 | Given a request, when its line manager approves, then status is `Approved` with decider and time. | pgTAP |
| AC-LV-006 | Given a request, when the requester, the person, the enterer, or an Admin who is one of them tries to decide, then refused. | pgTAP + mutation check |
| AC-LV-007 | Given the approver-role setting is a role, when a user with that role (not the line manager) decides, then allowed; a user with another role (not manager) is refused. With the setting empty a non-manager non-Admin is refused. | pgTAP |
| AC-LV-008 | Given a rejection without a note, then refused; an already decided request cannot be decided again. | pgTAP |
| AC-LV-009 | Given another organisation's user, when reading or deciding, then refused. | pgTAP |
| AC-LV-010 | Given approved leave on day D for a rostered person, when the roster leave read is called for D, then the person is returned; for a pending or rejected request, not; with no leave requests the result is empty and `work_order_roster` is unchanged. | pgTAP |
| AC-LV-016 | Given leave is off (default), when anyone opens the app, then no leave rail entry, approvals section or roster marker shows, and a new request is refused. | Unit + pgTAP |
| AC-LV-011 | Given approved leave, when the person is ticked present for that day, then the tick still succeeds (off by default). | pgTAP |
| AC-LV-012 | Given the request form, when a person submits with a type and range, then it posts one request; a conflict error is shown in words; strings render in Bahasa Indonesia. | Unit |
| AC-LV-013 | Given pending requests, when a decider opens approvals, then they see only requests they may decide, with Approve and Reject (note required); a non-decider sees no decide buttons. | Unit |
| AC-LV-014 | Given an approved leave, when the roster is opened for that day, then the member shows a leave marker; with none, the roster renders as before. | Unit |
| AC-LV-015 | Given a person, when they request leave and their manager approves it, then the marker shows on the roster. | E2E (one journey) |

## Errors
| Condition | Result |
|---|---|
| Overlapping live request | Field error naming the existing range |
| Decider not authorised or self | Refused, "you cannot decide this request" |
| Rejection without note | Field error |
| Already decided | Refused, shows current status |

## Settings (organisation controls)
| Setting | Default (unchanged behaviour) |
|---|---|
| Leave types list | Empty; leave screens show an empty state until filled |
| `leave_requests_enabled` | false: the feature is invisible and refuses writes |
| `leave_approver_role` | Empty: line manager, or Admin |
| (not built) block attendance on approved leave | Not built; FR-LV-010 |

## Open questions
- OQ-LV-1 Half days and hours: not built; whole days only. If wrong, part-day absences cannot be shown.
- OQ-LV-2 (settled) Where a person has no line manager and the setting is empty, Admin decides, never on their own or an entered request.
- Settings write path (settled): there is no generic Admin-checked organisation-settings write route, so `set_leave_settings` (migration 1242) is an Admin-only security-definer setter, audited, with pgTAP (non-Admin refused, other organisation untouched).
- Needs-you pointer: the Approvals page section and the decision list on /leave carry the pointer; the dashboard needs-you list is not changed.
- The Admin settings page is at /leave/settings (not in the Administration section list, to keep that screen unchanged for every existing organisation); it is linked from /leave for an Admin.

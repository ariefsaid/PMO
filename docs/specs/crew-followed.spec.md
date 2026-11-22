# Spec: Followed crew, record on the day whose crew a worker followed

**Status:** proposed. IDs `FR-FOL-###`, `AC-FOL-###`. Plan: `docs/plans/2026-11-22-crew-followed.md`. Builds on `docs/specs/crews-roster-attendance.spec.md` and `docs/specs/crew-loan.spec.md`; read both. Scope ruling OD-SCOPE-2 (no client process in code). No setting: new for every organisation. It adds a way to record a day that is refused today; it changes no money figure, approval route or visibility for anyone not using it.

## Job story
When a worker joined a different crew for the day without anyone arranging it in advance, I want the foreman of that crew (or the roster keeper) to record on the day whose crew the worker followed, so hours and roster agree, with no advance loan.

## Today (verified on base `land/fix-1122`, fc42e1a0)
- Day roster ticked through ONE RPC `attendance_record(work_order, date, source, rows)`; head body is `supabase/migrations/1465_attendance_phone_path.sql` (restating 1248, which restated 1110/1036). Sources `phone_check_in | roster_tick | manual_correction`. Rows stored in `attendance_days` (1036:103), unique per (worker, work order, date) (1036:133); `crew_id` = "crew the person was in when recorded" (1036:111).
- What refuses an un-loaned worker: 1465:77 resolves the crew by joining the work order's rostered crews to `worker_effective_crew(worker, date)` (1246); no match raises `ATT_NOT_ROSTERED` (1465:81; catalogue `pmo-portal/public/locales/{en,id}/refusals.json:11`). `worker_effective_crew` = loan host crew on a loan day, else the placement (`crew_members`, newer placement wins). So a worker placed in crew A cannot be recorded on crew B's work order unless an advance loan (`crew_loans`, 1245) or a new placement exists.
- Planned loan: `crew_loans` (1245:12) separate record, one per worker per day (gist exclusion), guard `guard_crew_loan` (1245:37) refuses locked/submitted/approved days (`LOAN_HOURS_LOCKED`), writers = `crew_can_manage()` (Admin, Executive, Project Manager; 1035:207), delete Admin only.
- Roster read: `work_order_roster` (1247) lists a crew's placed members plus loans into it, kept when `worker_effective_crew(...) = crew`; loaned-in marked `on_loan`, no standard role.
- Who may record: `attendance_can_record(crew)` (1036:219) = `crew_can_manage()` or the crew's `field_controller_id = auth.uid()`; enforced inside `attendance_record` (1465:102) on the resolved crew. Read policy on `attendance_days` (1036:~206): office roles, the field controller of the row's `crew_id`, the person.
- 24-hour ceiling across work orders per person-day: trigger in 1036 (`ATT_DAY_CEILING`, ~line 177). Week submitted/locked refusals `ATT_SUBMITTED`/`ATT_LOCKED`; date window `ATT_DATE_FUTURE`/`ATT_DATE_WINDOW`.
- UI: `pmo-portal/pages/crews/AttendanceTick.tsx` ticks only `crew.members` from the roster. No way to add an off-roster person; the DAL is `pmo-portal/src/lib/db/attendance.ts:74`.
- Prior-art sweep (`scripts/prior-art.sh`) for "crew roster", "loan": only the migrations above. The base does NOT answer the ask: a one-day follow without a loan is refused.

## Model
A day record may carry `followed_crew_id`: "this worker followed this crew on this day". It lives on the `attendance_days` row (same record, same work order, same hours); the home placement and the loans table are never touched. When set, `crew_id = followed_crew_id`. For that worker and date it becomes the effective crew: the worker shows on the receiving crew's roster (marked `followed`, no standard role, like a loan) and not on the home crew's. Timesheet derivation is untouched: it reads the saved row exactly as now.

## Requirements (EARS)
- FR-FOL-001 The system shall let `attendance_record` accept per row an optional `followed_crew_id` (sources `roster_tick`, `manual_correction`; refused for `phone_check_in`).
- FR-FOL-002 When `followed_crew_id` is given, the crew shall be rostered on this work order that day, differ from the worker's effective crew that day, be a live crew of the organisation, and the worker shall hold a placement that day (a person with no crew is not "following" anyone).
- FR-FOL-003 Who may record a followed day shall be decided by `attendance_can_record(followed crew)`: the receiving crew's field controller or a crew manager (roster keeper). The home crew's foreman, as such, may not. Enforced in the database.
- FR-FOL-004 While a followed record exists for (worker, date), `worker_effective_crew` shall return the followed crew, so the roster lists the worker on the receiving crew and not on the home crew, and a later recording on the receiving crew's work order is accepted without repeating the follow.
- FR-FOL-005 Where a loan covers the date to a different crew than the one followed, the system shall refuse (the planned loan stands). Where it covers the date to the same crew, nothing extra is needed.
- FR-FOL-006 The row shall keep `followed_crew_id = crew_id`; the audit entry for `attendance.record` shall carry it; all existing day rules (window, week submitted, locked, 24 hours, off rotation) apply unchanged.
- FR-FOL-007 Where no row carries `followed_crew_id`, every roster and attendance result shall equal today's.
- FR-FOL-008 The tick screen shall offer "Add someone from another crew" (person picker over people placed elsewhere), shown to who may tick the crew; the added person appears marked "followed from <home crew>" and is saved with the rest. Strings in English and Bahasa Indonesia, phone and desktop.
- FR-FOL-009 Every refusal a person can meet shall have an English and a Bahasa Indonesia sentence in the refusals catalogue saying what to do next.

## Acceptance criteria and owning layer
| ID | Given / When / Then | Layer |
|---|---|---|
| AC-FOL-001 | Given W placed in crew A (no loan), crew B rostered on work order WB day D, when B's foreman records W on WB with `followed_crew_id = B`, then the row exists with crew B and `followed_crew_id` B; without `followed_crew_id` it is still `ATT_NOT_ROSTERED`. | pgTAP |
| AC-FOL-002 | Given that record, when the roster of WB for D is read, then W is listed under B marked `followed`, W is absent from A's roster for D, present on other days; a second tick of W on WB (no follow param) is accepted. | pgTAP |
| AC-FOL-003 | Given roles, when recording a followed day: B's foreman, Admin, Executive, Project Manager succeed; A's foreman (not B's), Engineer, Finance, another organisation are refused. | pgTAP (+ mutation check) |
| AC-FOL-004 | Given followed crew not rostered on that work order that day, equal to the worker's own crew, archived, foreign-org, or worker with no placement, when recorded, then refused. | pgTAP |
| AC-FOL-005 | Given a loan of W to crew C covering D, when a follow to crew B is recorded, then refused; a follow to C is accepted. | pgTAP |
| AC-FOL-006 | Given `phone_check_in` with `followed_crew_id`, then refused; given a submitted or approved week, then `ATT_SUBMITTED`/`ATT_LOCKED` as today; 24-hour ceiling still holds across the follow. | pgTAP |
| AC-FOL-007 | Given no followed rows, the existing roster, loan and attendance pgTAP files pass untouched. | pgTAP (existing) |
| AC-FOL-008 | Given the tick screen, when a foreman adds a person from another crew with hours and saves, then the RPC is called with `followed_crew_id`; a refusal shows its catalogue sentence; the add control is hidden for someone who may not tick. | Unit (RTL) |
| AC-FOL-009 | Given the en and id catalogues, then every new refusal key exists in both. | Unit |
| AC-FOL-010 | Given a foreman, when they add a person from another crew and save on a rich seed, then the roster shows the person on the receiving crew and the hours appear in the week. | E2E (one journey) |

## Errors (new codes)
`ATT_FOLLOW_CREW` (crew not rostered here that day, same as own crew, or not live), `ATT_FOLLOW_UNPLACED` (worker has no placement that day), `ATT_FOLLOW_LOAN` (a loan to another crew covers the day), `ATT_FOLLOW_SOURCE` (phone check-in cannot follow). Not authorised stays `42501` as today.

## Rulings and open question
- Hours already submitted or approved never move: the follow is a new row or an unsubmitted row only (existing `ATT_SUBMITTED`/`ATT_LOCKED`).
- Customer question: may the receiving foreman do this on their own authority with no home-crew foreman notice? Recommended answer: yes, and the home crew's roster simply shows the person as away for the day (the loan rule's inverse), with the follow visible on the day record and in the audit entry. If the customer wants notice, that is a later item.
- Not in scope: crew-multi-wo (splitting a crew's day across work orders) and pay-time (hours to timesheet); this change only records the follow and keeps roster and hours consistent.

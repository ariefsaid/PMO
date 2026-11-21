# Spec: Attendance rate per crew against a target (#2706)

**Status:** proposed for build. IDs `FR-ATR-###`, `NFR-ATR-###`, `AC-ATR-###`. Plan: `docs/plans/2026-11-21-attendance-rate.md`. Map #2516; ticket #2706; target 15 December 2026. Inherits the attendance record from `crews-roster-attendance.spec.md` (#2528) and the organisation-setting pattern (`organizations` column + Admin-only row policy, ADR-0016/0017).

## Job story

When I review a crew, I want its attendance rate against a target, so absence is visible.

## Context and boundary

- The ticket's "What ships": **a report of attendance rate per crew and period against a target**. "Settings the client controls: the target rate." Nothing deferred.
- The target is an **organisation setting** (one percentage for the organisation). A client may set it, change it, or clear it. Cleared means the report is **not offered** — an existing organisation sees no change until it sets a target.
- The rate is computed from data that already exists: the crew master, placements, the work-order roster and the daily attendance record (#2528). No new attendance capture, no new table, no new per-day row.
- General for contract-based organisations: no client's process, crew names, work patterns or day counts are coded. Working days are not assumed — the roster is the evidence that the crew was expected to work a day, so weekends and rest days need no calendar setting.
- Attendance statuses are the shipped four: `present`, `absent`, `leave`, `off_rotation`.

## Requirements (EARS)

- FR-ATR-001 The system shall keep an organisation setting for the **attendance target rate**: a percentage from 0 to 100 with two decimals, unset by default.
- FR-ATR-002 While the target is unset, the system shall not offer the attendance-rate report, and every other screen shall look and behave exactly as before.
- FR-ATR-003 Only an Admin shall change the target. The database shall enforce this (column-scoped grant on `organizations`, whose only update policies are Admin-only); the app's control mirrors it and is UX only (ADR-0016).
- FR-ATR-004 When a period is chosen, the system shall report for each crew: expected member-days, present, absent, leave, off-rotation, no-record days, the attendance rate and the target.
- FR-ATR-005 The system shall count **expected member-days** as: for each date in the period, each person placed in the crew on that date (the newest placement covering the date wins, as the work-order roster reads it), and only while the crew is rostered on at least one work order on that date. A person counts once per date even where the roster or placement data overlaps.
- FR-ATR-006 The system shall count attendance against those member-days: `present` attended, `absent` not attended, `leave` and `off_rotation` excused (removed from the rate's denominator), and a member-day with no attendance record counted as **no record** and not attended.
- FR-ATR-007 The system shall compute the rate as `present ÷ (expected − leave − off_rotation) × 100`, with two decimals; when the denominator is zero the rate shall be empty, shown as a dash, never as 0 %.
- FR-ATR-008 Where a target is set, the system shall mark each crew whose rate is below the target, and shall leave the mark off a crew with no rate.
- FR-ATR-009 The system shall accept an inclusive period from and to date; it shall refuse an end before the start, and a period longer than 366 days.
- FR-ATR-010 The report shall be readable by an active member whose role reads the whole organisation's attendance — Admin, Executive, Project Manager and Finance, mirroring `attendance_days_select`. Any other member shall be refused by the database and shall not be offered the report.
- FR-ATR-011 A crew shall appear when it is live, or when it has a placement, a roster or an attendance record in the period. An archived crew with no activity in the period shall not appear.
- FR-ATR-012 A caller of another organisation shall read nothing; the crew, roster, placement and attendance reads shall all be scoped to the caller's organisation.
- FR-ATR-013 The system shall show the period's rate on phone and desktop, with the target beside it, and shall state what the columns mean in one helper sentence.

## Non-functional requirements

- NFR-ATR-001 No new table and no new write path beyond the organisation setting. `org_id` is never sent by the client; RLS and the column default keep the seam (ADR-0017).
- NFR-ATR-002 The report is one read per period change. The period is capped at 366 days so the query stays bounded.
- NFR-ATR-003 `DESIGN.md` tokens only; keyboard reachable; 320px phone layout; English and Bahasa Indonesia strings.
- NFR-ATR-004 The target is a plain number the client owns, not a productivity standard PMO invents; no default is written into existing organisations.

## Acceptance criteria and owning layer

| ID | Given / When / Then | Layer |
|---|---|---|
| AC-ATR-001 | Given an organisation that never set a target, when its settings are read, then the target is empty and the Crews page offers no rate view. | pgTAP + Unit |
| AC-ATR-002 | Given an Admin sets the target to 95.5, when a Project Manager or a Finance user tries to change it, then refused; the Admin's saved value stands. | pgTAP |
| AC-ATR-003 | Given a crew of three people serving a work order on five days, when nine member-days are present, two absent, one leave, one off rotation and two have no record, then expected is 15, the rate is 69.23 % (9 ÷ 13) and no-record is 2. | pgTAP |
| AC-ATR-004 | Given a person placed in crew A for the first days of the period and in crew B from day three, when each crew's rate is read, then each crew counts only the member-days the person was placed in it — crew A 15, crew B 3 — and neither absorbs the other's days. | pgTAP |
| AC-ATR-005 | Given a crew with no roster on a date, when the period covers that date, then no expected member-day is counted for it. | pgTAP |
| AC-ATR-006 | Given a period whose end is before its start, or one longer than 366 days, when the report is read, then refused and nothing is returned. | pgTAP |
| AC-ATR-007 | Given an Engineer who is not a crew's field controller, or a user of another organisation, when the report is read, then refused/empty; Admin, Executive, Project Manager and Finance are allowed. | pgTAP |
| AC-ATR-008 | Given a period with two crews — one at or above the target and one below — when the rate view opens, then both are listed with their counts and rate, the lower one marked below target, and a crew with no countable day shows a dash rather than 0 %. | Unit |
| AC-ATR-009 | Given the Administration › Projects panel, when an Admin sets 90 % and later clears it, then the value is saved, the Crews rate view appears, and clearing turns it off again; a non-Admin sees no control. | Unit |
| AC-ATR-010 | Given a target and a period with attendance, when a reviewer opens Crews › Rate, then the crew's rate, target and below-target mark are on screen and the counts agree with the records. | E2E |

## Errors and refusals

| Condition | Result |
|---|---|
| Period end before start, or longer than 366 days | Refused with a sentence naming the range rule |
| Target outside 0–100 | Refused by the column check; field error in the setting panel |
| Non-office role opens the report | Report not offered; a direct call is refused `42501` |
| Target unset | Rate view not offered; no other screen changes |
| No countable day for a crew | Rate shown as "—", never 0 %; below-target mark omitted |

## Data and settings

| Setting | Where | Default | Who changes it |
|---|---|---|---|
| Attendance target rate (0–100, %) | `organizations.attendance_target_rate` | `NULL` (off) | Admin |

## Owner decisions carried into this spec

| ID | Decision | If wrong, what breaks |
|---|---|---|
| OD-ATR-1 | The target is one organisation-wide percentage, not per crew or per project. A per-crew target is a later addition. | A client with crews held to different standards cannot express it; today's single number stays honest as the common floor. |
| OD-ATR-2 | Unrecorded member-days count against the rate and are shown separately. | Counting only recorded days would hide the absence the ticket asks to make visible; showing "no record" lets a reviewer tell a recording gap from real absence. |
| OD-ATR-3 | Leave and off-rotation are excused (out of the denominator). | Counting excused days as absence would penalise approved leave. |
| OD-ATR-4 | Reads are limited to the roles that read the whole organisation's attendance. | A crew-level reader would see totals built from rows they cannot read, which is worse than no report. |

## Delivery checklist
- [ ] Organisation setting + rollback (`1436`).
- [ ] Report read + rollback (`1437`), pgTAP `attendance_rate.test.sql`.
- [ ] Repository, hooks, report view, Admin setting panel; en + id strings; glossary.
- [ ] Units for the view and the setting; E2E journey for AC-ATR-010.
- [ ] Gates: guards, typecheck, eslint, related vitest, pgTAP on the spare runner.

# Spec: Crews, work-order roster and daily attendance that becomes the timesheet (#2528)

**Status:** proposed; owner decisions below need sign-off before build. IDs `FR-CRW-###`, `NFR-CRW-###`, `AC-CRW-###`. Plan: `docs/plans/2026-11-20-crews-roster-attendance.md`. Executor: Orca worker for crew master and roster; the attendance-to-timesheet conversion and approval touch the money path (hours feed cost) and are Director-dispatched, shipping alone. Map #2516; blocked by #2517.

**Relates to:** `docs/specs/employee-roster.spec.md` (#1516: employee master, effective-dated project/site assignment, on/off rotation) and `docs/specs/gps-attendance.spec.md` (#1517: per-person phone clock events with location). Timesheets: `timesheets` / `timesheet_entries` (0001/0007; weekly per profile, Draft/Submitted/Approved/Rejected, approval in `timesheets-approval.spec.md`).

## Job story

When a crew works a day on a work order, I want its attendance recorded once, by whichever method the organisation uses, so that each person's approved hours per work order exist without anyone retyping them into a timesheet.

## Context and boundary

- **Open owner question (#2528 note, OQ-CRW-1):** how attendance is captured: (A) each person checks in on their phone at the site (#1517 clock events), or (B) the field controller ticks the crew roster for the day, with a group photo. This spec builds what both share: a single **daily attendance record** per person per day per work order, with a `source` (`phone_check_in`, `roster_tick`, `manual_correction`). Either method creates the same record; neither is built here beyond the roster tick screen (the tick screen is the shared minimum; #1517 remains the phone path and writes to the same record when both exist, OQ-CRW-2).
- A crew is a **group**; it does not replace #1516 assignments. An assignment says a person is at a project/site on dates; crew membership says who works in which crew on dates; the roster says which crews serve a work order on dates. Attendance for a person on a work order is valid only if they are a member of a crew rostered on that work order that day (OD-CRW-3).
- People in a crew may be own staff (#1516 employees) or a **vendor crew** (company-supplied people who may have no PMO login).

## Requirements (EARS)

**Crew master**
- FR-CRW-001 The system shall keep a crew master: organisation-unique code, name, discipline (from #2517's discipline list), field controller (a same-organisation user), kind (`own` | `vendor`), vendor company when `vendor`, and a list of **standard roles** (e.g. foreman, welder, helper) each with a standard headcount.
- FR-CRW-002 The system shall allow a crew to be archived (ADR-0018) only when it has no open or future memberships or roster placements.

**Membership**
- FR-CRW-003 The system shall place a person in a crew for an inclusive date range with an optional open end and a standard role; a person shall be in at most one crew on any day; overlapping placements are refused.
- FR-CRW-004 A person is an #1516 employee (own crew) or a named vendor worker (name, optional ID reference, no salary or personal contact data); vendor workers are crew-scoped records and are not given logins.
- FR-CRW-005 A placement correction replaces the segment atomically with a version check and audit; it does not rewrite approved attendance.

**Roster per work order**
- FR-CRW-006 The system shall roster one or more crews to a work order for an inclusive date range; a crew may serve one work order on any day (OD-CRW-2); overlaps are refused.
- FR-CRW-007 The work-order roster view shall show, for a chosen date, each crew with its members and standard-role headcount versus placed, flagging a shortfall.

**Daily attendance**
- FR-CRW-008 The system shall record attendance per person per date per work order, with status (`present`, `absent`, `leave`, `off_rotation`), hours (0 to 24, exact decimals) when present, optional overtime hours, and source.
- FR-CRW-009 Where the field controller uses the roster tick screen, it shall list the crew's members for that date and let them mark each and enter default hours with one action for the whole crew and a per-person override; it shall accept a group photo as an attachment (OD-CRW-4).
- FR-CRW-010 A person with an #1516 rotation marked off that day shall default to `off_rotation` and cannot be marked `present` without a reason.
- FR-CRW-011 When attendance exists for a person from both a phone check-in and a roster tick on the same day and work order, the system shall keep one record, mark it `needs_review` when hours differ by more than a configurable tolerance, and show both sources (OQ-CRW-2).
- FR-CRW-012 A person shall not have attendance hours above 24 in one date across work orders; the server refuses a record that would exceed it.
- FR-CRW-013 Attendance entry is open for dates up to the organisation's back-date limit (default 7 days, OD-CRW-5) and not future.

**Attendance becomes the timesheet**
- FR-CRW-014 When a week's attendance for a person is complete, the system shall generate their timesheet entries (project, work order via #2517, date, hours) from `present` attendance, with no re-entry; the person's weekly timesheet for a linked profile moves to `Submitted` for approval.
- FR-CRW-015 The timesheet approver (supervisor) shall be a user other than the attendance recorder and the person (SoD, ADR-0019), enforced in the existing approval RPC; approval of the timesheet makes the attendance `locked`.
- FR-CRW-016 Where a person has no profile (a vendor worker or an employee without login), approved hours shall be held on the attendance record itself through the same supervisor approval and exposed to cost attribution the same way as timesheet hours (OQ-CRW-3).
- FR-CRW-017 A change to attendance after the week is submitted shall follow the timesheet correction path (`timesheet-correction-path.spec.md`), not a silent edit; locked attendance is immutable.
- FR-CRW-018 Generation is idempotent: running it again for the same person and week produces no duplicate entries; changed attendance before submission updates the draft entries.

**Access, lists**
- FR-CRW-019 Actions (manage crews, manage membership, manage roster, record attendance, approve) shall be registered in the role matrix (#902) and gated by `can()`; field controller may record attendance for their crews' work orders; RLS/RPC enforce.
- FR-CRW-020 Lists filter by crew, work order, date and status with stable order and bounded pagination. Imports for crews and people are #2530.

## Non-functional requirements
- NFR-CRW-001 `org_id` seam; RLS on every new table; indexes on (crew, date), (work_order, date), (person, date).
- NFR-CRW-002 Tick screen usable at 320px, large tap targets, keyboard accessible, `DESIGN.md` tokens, English and Bahasa Indonesia.
- NFR-CRW-003 Vendor-worker data is minimal and gets no location data here; GPS stays under #1517 consent rules.

## Acceptance criteria and owning layer

| ID | Given / When / Then | Layer |
|---|---|---|
| AC-CRW-001 | Given a crew with standard roles, when created with a duplicate code, then refused; archived crews free the code. | pgTAP |
| AC-CRW-002 | Given a person in crew A from 1 to 15, when placed in crew B on 10, then refused; placed from 16 it is accepted. | pgTAP |
| AC-CRW-003 | Given a crew rostered on work order W from 1 to 10, when also rostered to W2 on day 5, then refused. | pgTAP |
| AC-CRW-004 | Given a rostered crew, when the work-order roster is opened for a date, then members and role shortfall are shown. | Unit + pgTAP |
| AC-CRW-005 | Given a field controller using the tick screen for a 6-person crew, when they mark the crew present for 8 hours and override one person to 6, then 6 attendance records exist with the right hours and the group photo is attached. | Unit + E2E |
| AC-CRW-006 | Given a person off-rotation, when marked present without a reason, then refused. | pgTAP |
| AC-CRW-007 | Given a person with 8 hours on work order W1 and 17 on W2 the same day, when saved, then the second is refused (24-hour ceiling). | pgTAP |
| AC-CRW-008 | Given phone and roster records for the same person/day with hours 8 and 5, when both exist, then one record is `needs_review` showing both sources. | pgTAP |
| AC-CRW-009 | Given a complete week of attendance on one work order, when timesheet generation runs, then entries per day with the work order exist and the sheet is `Submitted`; a second run changes nothing. | pgTAP |
| AC-CRW-010 | Given a submitted timesheet generated from attendance, when the recorder tries to approve it, then refused; a different supervisor can approve and attendance becomes locked. | pgTAP (+ mutation check) |
| AC-CRW-011 | Given locked attendance, when edited directly, then refused; the correction path is offered. | pgTAP |
| AC-CRW-012 | Given a vendor worker without a profile, when their week is approved, then approved hours per work order exist on the attendance and are readable by cost attribution. | pgTAP |
| AC-CRW-013 | Given a date beyond the back-date limit or in the future, when attendance is recorded, then refused. | pgTAP |
| AC-CRW-014 | Given a user from another organisation or lacking permission, when they read or write, then refused. | pgTAP |
| AC-CRW-015 | Given a crew's day on a work order, when attendance is ticked, the week submitted and a supervisor approves, then approved hours per person and work order exist with no re-entry. | E2E (one journey) |

## Errors
| Condition | Result |
|---|---|
| Overlapping membership/roster | Field error naming the conflict |
| Person over 24 hours in a day | Refused with the other work order shown |
| Attendance outside back-date window | Refused with the earliest allowed date |
| Locked attendance edit | Refused; link to correction path |
| No eligible supervisor | Timesheet stays `Submitted`, shown as unassigned |

## Owner decisions (recommended defaults, not rulings)
| ID | Decision and default | If wrong, what breaks |
|---|---|---|
| OQ-CRW-1 | **Attendance method: phone check-in vs field-controller roster tick.** Default for this build: both feed one record; ship the roster tick first (no consent/legal prerequisite), phone path via #1517 once its owner decisions are signed. | Building only one locks out the other client style; GPS path carries legal consent work (#1517 OD-GPS-1). |
| OQ-CRW-2 | Which wins on conflict? Default: neither; flag `needs_review`, tolerance 1 hour. | Silent override pays the wrong hours. |
| OQ-CRW-3 | Hours of people with no login (vendor crew): do they enter the timesheet table or a separate approved-hours store? Default: hold approved hours on the attendance record, attributed like timesheet hours. | Vendor crew hours are missing from work-order cost or double-counted with a vendor bill. |
| OD-CRW-2 | A crew serves one work order per day. | A split-day crew cannot be represented; per-day hours split would need another rule. |
| OD-CRW-3 | Attendance must match crew membership and roster. | A mismatch silently charges hours to a work order the person was not rostered on. |
| OD-CRW-4 | Group photo is recommended, required only when OQ-CRW-1 selects tick-only. | Without proof, roster tick hours are unverifiable. |
| OD-CRW-5 | Back-date limit 7 days. | Too short blocks late site reporting; too long weakens control. |

## Delivery checklist
- [ ] Owner answers OQ-CRW-1..3 and signs OD-CRW-2..5; reconcile #1516 and #1517 shipped contracts.
- [ ] Crew master + roster slice, then attendance + timesheet slice (alone, SoD), then tick screen.
- [ ] Glossary: crew, standard role, roster (crew), attendance record.

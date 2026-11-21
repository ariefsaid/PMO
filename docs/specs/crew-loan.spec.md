# Spec: Crew loan, a worker on loan follows the host crew (#2704)

**Status:** proposed. IDs `FR-LOAN-###`, `AC-LOAN-###`. Plan: `docs/plans/2026-11-21-crew-loan.md`. Map #2516, scope ruling OD-SCOPE-2 (no client process in code). Builds on `docs/specs/crews-roster-attendance.spec.md` (crews, placements, roster, attendance); read it first. Settings the client controls: none.

## Job story
When a worker is lent to another crew, I want them to follow the host crew's roster, so hours land on the right work order.

## Model
A **loan** is (worker, home crew, host crew, start date, end date), both dates inclusive. It is a separate record; the worker's home placement (`crew_members`) is never edited, so ending or deleting a loan returns the worker with no repair. On a loan day the worker's **effective crew** is the host crew; on every other day it is the crew resolved today (the placement, newer placement wins the day). One SQL function, `worker_effective_crew(worker, date)`, is the single definition; the roster read and attendance recording both call it.

## Requirements (EARS)
- FR-LOAN-001 The system shall keep loans with worker, home crew, host crew, inclusive start and end date (end required), org-stamped, versioned and audited.
- FR-LOAN-002 The home crew shall be a crew where the worker has a placement covering the whole loan period; the host crew shall differ from the home crew and both shall be live crews of the organisation.
- FR-LOAN-003 While a loan covers a date, the worker shall appear on the host crew's roster for that date and not on the home crew's roster.
- FR-LOAN-004 While a loan covers a date, attendance for the worker shall be accepted on a work order rostered to the host crew and refused on one rostered only to the home crew; the record carries the host crew.
- FR-LOAN-005 A worker shall have at most one loan on any day; an overlapping loan is refused by the database.
- FR-LOAN-006 Where a worker has no loan covering the date, every roster and attendance result shall equal today's, byte for byte.
- FR-LOAN-007 Hours already approved, locked or submitted for approval shall never move: creating, changing (dates) or deleting a loan is refused when any day it covers (before or after the change) holds such attendance for that worker. Past unapproved days follow the new crew only on the next recording; saved attendance rows are not rewritten.
- FR-LOAN-008 Whoever may manage crews today (`crew_can_manage`: Admin, Executive, Project Manager) shall create and change loans; every active member reads them; delete is Admin only (as for crew placements); another organisation sees nothing.
- FR-LOAN-009 A crew with a current or future loan (home or host) shall not be archived.
- FR-LOAN-010 The crew page shall let a manager lend a member (host crew, start, end) and list a crew's loans out and in; strings in English and Bahasa Indonesia, phone and desktop.

## Acceptance criteria and owning layer
| ID | Given / When / Then | Layer |
|---|---|---|
| AC-LOAN-001 | Given worker W placed in crew A, when a loan to crew B is made for days 10 to 14, then days 10 to 14 resolve to B and days 9 and 15 resolve to A. | pgTAP |
| AC-LOAN-002 | Given that loan, when the roster of a work order served by B is read for day 12, then W is listed; the roster of a work order served by A on day 12 lacks W and lists W on day 9. | pgTAP |
| AC-LOAN-003 | Given that loan, when attendance is recorded on day 12 on A's work order, then `ATT_NOT_ROSTERED`; on B's work order it is accepted with crew B; B's field controller may record it. | pgTAP |
| AC-LOAN-004 | Given a loan 10 to 14, when another loan for the same worker 14 to 16 (any crew) is made, then refused; 15 to 16 is accepted. | pgTAP |
| AC-LOAN-005 | Given approved attendance for W on day 11 (before the loan existed), when a loan covering day 11 is created, changed to cover it, or deleted, then refused and the approved hours are unchanged. | pgTAP (+ mutation check) |
| AC-LOAN-006 | Given no loans in the organisation, when the roster and attendance run, then results equal the pre-loan behaviour; the existing roster and attendance tests pass untouched. | pgTAP (existing) |
| AC-LOAN-007 | Given host equal to home, a home crew without a covering placement, an archived host, or a foreign-org crew, when a loan is made, then refused. | pgTAP |
| AC-LOAN-008 | Given roles Admin, Executive, Project Manager versus Engineer and another organisation, when each creates or reads, then only the managers write, members read, the other organisation reads nothing; delete is Admin only. | pgTAP |
| AC-LOAN-009 | Given a crew with a current loan, when archived, then refused. | pgTAP |
| AC-LOAN-010 | Given a crew member row, when a manager opens "Lend to another crew" and saves, then the loan shows on both crews and a non-manager sees no action. | Unit (RTL) + `can()` unit |
| AC-LOAN-011 | Given the en and id dictionaries, then every new key exists in both. | Unit |

## Errors
| Condition | Result |
|---|---|
| Overlapping loan | Field error naming the conflicting dates (`LOAN_OVERLAP`) |
| Period touches approved hours | Refused (`LOAN_HOURS_LOCKED`), naming the first locked date |
| Home placement does not cover the period | Refused (`LOAN_HOME`) |
| Host equals home, or crew not live | Refused (`LOAN_CREW`) |

## Rulings (restated, no owner question open)
Approved hours never move retroactively (FR-LOAN-007). A loan does not alter the home placement. No setting is added: an organisation that creates no loans sees no change (FR-LOAN-006).

# Equipment targets and breakdown escalation limit as settings

Status: Phase 1 draft (#2701). Extends `docs/specs/equipment-availability.spec.md` (#2526). Rulings: OD-SCOPE-2 (no client process in code).

## Job story
When I review equipment, I want the availability and use targets and the breakdown escalation limit to be mine to set, so they fit my operation.

## Findings in shipped code (artifact-read, scope: `supabase/migrations/`, `pmo-portal/src`, `pmo-portal/pages`, `pmo-portal/public/locales`)
- Escalation limit: one fixed value. `equipment_downtime_escalations` (migration 1033) flags an open downtime period with `count(*) > 2` recorded down days; the notice title and the on-screen label ("Down more than 2 days", `equipment.json` `availability.flagged`) repeat the 2 in text.
- Availability target and use target: none exist today. The screen shows `availability_pct` and `utilisation_pct` with no comparison. So the targets are new and carry no default figure: unset means nothing changes on any screen.
- Working hours per day already follows the pattern we reuse: a column on `organizations` with an Admin-only security-definer RPC (`set_equipment_working_hours`, 1032).

## Requirements (EARS)
- FR-ETS-001 The system shall store three organisation settings: availability target (percent, optional), use target (percent, optional) and breakdown escalation limit (whole days, default 2).
- FR-ETS-002 When an Admin saves the settings, the system shall validate them in the database: each target between 0 and 100 with at most one decimal, or empty to clear; the limit a whole number from 1 to 365.
- FR-ETS-003 If a caller who is not an Admin tries to change the settings, the system shall refuse with 42501 and leave them unchanged.
- FR-ETS-004 The downtime escalation rule (job and on-screen flag) shall flag an open period with more than the organisation's limit of recorded down days, reading the setting at run time, not a constant.
- FR-ETS-005 The escalation notice title shall name the organisation's limit.
- FR-ETS-006 Where a target is set, the availability screen shall mark each metric figure that is below it and show the target beside the column; where a target is unset, the screen shall look exactly as today.
- FR-ETS-007 Any active member may read the three settings of their own organisation; no member can read another organisation's.
- FR-ETS-008 While no setting has been saved, the organisation shall see the same numbers and flags as before (limit 2, no targets).

## Acceptance criteria
| ID | Given / When / Then | Layer |
|---|---|---|
| AC-ETS-001 | Given a new organisation, when the settings are read, then limit = 2 and both targets are empty. | pgTAP |
| AC-ETS-002 | Given default settings, when an asset is down 3 recorded days, then it is flagged and the job logs one notice; at 2 days it is not (the existing 1033 cases stay green, untouched). | pgTAP (existing `equipment_status.test.sql`) |
| AC-ETS-003 | Given the limit set to 5, when an asset is down 3 days, then it is not flagged and the job sends nothing; at 6 days it is flagged and the notice title says 5. | pgTAP |
| AC-ETS-004 | Given a Project Manager, Finance, Engineer or Executive, when they call the save RPC, then 42501 and the values are unchanged; an Admin succeeds. | pgTAP |
| AC-ETS-005 | Given out-of-range input (limit 0 or 366 or 2.5, target 100.1 or -1 or 2 decimals), when an Admin saves, then 22023 and nothing is stored; an empty target clears it. | pgTAP |
| AC-ETS-006 | Given a member of organisation A, when they read settings, then they get A's values, never B's. | pgTAP |
| AC-ETS-007 | Given availability 80.0 and a target of 90, when the table renders, then the figure is marked below target and the target is shown; with no target nothing is marked. | Vitest |
| AC-ETS-008 | Given a limit of 5, when the screen renders a flag, then the label says "Down more than 5 days". | Vitest |
| AC-ETS-009 | Given an Admin (real role, not impersonating), when they save the form, then the RPC is called with the typed values; other roles do not see the form. | Vitest |
| AC-ETS-010 | Mutation checks: hard-code the limit back to 2 in the function, AC-ETS-003 goes red; widen the role check to Project Manager, AC-ETS-004 goes red. | pgTAP (run, quoted in report) |

## Decisions taken from the spec/ticket
- Store on `organizations` (the working-hours pattern, #2526), not a new table: three scalar settings of one organisation, no list. No new table, so no isolation fragment is needed for a table; the two new definer functions get a fragment.
- Targets are optional with no default figure; the only shipped constant is the limit (2).
- Read through a security-definer RPC for any active member (the `organizations` row is not column-granted for these).
- Out of scope: vendor response time (#2702), per-asset or per-class targets, repeat-notice interval.

## Owner questions
None. (Noted for the report: the ticket speaks of replacing fixed targets; none exist, so targets are new and off until set.)

# Timesheet review drawer: round 3

Branch `ui/1126-crews-attendance` (merged `origin/batch/1126-ui` first; no new migrations in that merge). No blocker.
Captures: `after-r3/` (1440, 1024, 390; English and Bahasa).

## What changed
The drawer stacked seven day rows per project, mostly empty (a week on three projects was 21 rows of scroll).
It is now one compact table (`pages/timesheets/WeekHoursTable.tsx`):
```
Project                     Mon Tue Wed Thu Fri Sat Sun  Total
Acme Internal Platform        8                            8
P003
Innovate Corp HQ Fit-Out              4                    4
P001
Daily total                   8       4                   12
```
- one row per project: name, the code under it, and the work order under that when the line names one;
- columns Mon..Sun (weekday over date) then Total; hours right-aligned, tabular; an empty day is blank (screen readers hear "No hours");
- a daily-total row at the foot;
- the table is fixed-layout at the drawer's width, so it fits at 1440 and 1024 with no horizontal scroll (`after-r3/admin-timesheets-review-open-1024-id.png`: all seven days and Total visible in Bahasa);
- on a phone each project lists only the days that have hours, then its total; the week total closes the list (`after-r3/admin-timesheets-review-open-390-en.png`).

The `stacked` option I added to the shared `TimesheetGrid` in round 2 had no other caller, so it is removed again (own commit);
its test went with it. The grid's other fix from round 2 (project code on its own line) stays.

## Tests and journeys (real results)
- `npm run typecheck` pass; `eslint --max-warnings=0` on the five touched files pass.
- Touched tests: `WeekHoursTable.test.tsx` (new: columns and cell values per row, totals row, phone shows only days with hours and the week total), `TimesheetReview.test.tsx`, `timesheet.mobile.test.tsx`: 22 tests pass.
- Timesheet journeys: JOB-HR-timesheet-work-order (opens the review drawer and reads the work orders), AC-911, AC-TSE-021, JOB-A1, JOB-H8, layout/timesheets, layout/approvals: all pass (22 tests incl. sign-in setup).
- AC-TSP-011 (serial) **skipped**, not passed: it needs the ERP test bed, which this environment does not run.

## Owner to confirm
- An empty day is blank, not a dot or 0 (as asked).

## Not done
- Nothing else in this round's ask is open. Earlier open items stay as listed in REPORT-r2.md.

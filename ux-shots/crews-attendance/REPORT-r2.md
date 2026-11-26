# Crews, attendance, leave, manpower and timesheets: round 2

Branch `ui/1126-crews-attendance`, merged with `origin/batch/1126-ui` at the start and again at the end (the second
merge brought migrations 2725 and 2740: local DB reset, attendance journeys re-run on them). No blocker.
No repository, RPC or schema change. Screenshots: `after-r2/` (final code) and `before-r2/` (round-1 state, 1440 and 1024 only).

## 1. Purpose and structure of the new screen in this round

**Timesheet review** (`/timesheets/review`, HR / project admin): *whose week is in, how many hours, on which projects?*
```
Timesheet review  8                                              [My time]
[From][To][Project][Person]                                      (filters, unchanged)
Person | Week | Projects | Hours→ | Status                       ← one row per sheet, read-only
row → right drawer: "Name · week", status, total hours; the week's entries stacked by project, all 7 days
Showing 1–25 of n  [Previous][Next]                              (unchanged)
```
**Hours approvals** (`/approvals?scope=timesheets`, where "Team review" leads) is the Approvals inbox: list on the left,
the selected week's grid and Return/Approve on the right. That frame belongs to the Approvals screen, so I left its layout
and fixed what was mine underneath it: the week grid (below).

## 2. What changed and why (the owner's four points)
1. **Headers read whole.** Manpower "Dibutuhkan paling lambat" was cut at 1440 in Bahasa: the column header is now
   "Tenggat" (EN keeps "Needed by"; the form field keeps its full label). Crew list "Pengawas lapangan" was cut at 1024:
   columns given room. Every table header on my screens is now checked in the live DOM at 1440 and 1024 in English and
   Bahasa (`before-r2/headers-cut.jsonl` lists what was cut before; the same check on `after-r2` found **none**).
2. **No bare dash.** A need whose position or project is no longer listed (archived) reads "Position no longer listed" /
   "Posisi tidak lagi tersedia" (and the same for a project), in the row, the drawer title and the row's button name.
3. **Timesheets.** Review list → one table + side drawer (it stacked name, pill, a sentence of projects, hours and a
   Show entries toggle on each line). The week grid in the drawer uses a new opt-in `stacked` layout so all seven days
   and the totals are visible (the table form did not fit a drawer). The grid also ran a short project name into its
   code ("Acme Internal PlatformP003") on My time, review and the Approvals inbox: fixed in the shared `TimesheetGrid`.
4. **From the "not done" list:** a crew's people now open in the side drawer from the crew row (was a second card under
   the table); the two import buttons moved from a toolbar band of their own into the page header beside New crew.

Shared-component changes, each in its own commit: `TimesheetGrid` (`stacked` prop, default off; project code on its own
line). Callers checked: Timesheets (My time), TimesheetReview, Approvals inbox preview; their tests and the timesheet and
approvals journeys pass.

## 3. Measured
| Check (live DOM) | Before (round 1) | After (round 2) |
|---|---|---|
| Table headers cut, 1440 + 1024, EN + ID, all my screens | 2 real cuts: "Dibutuhkan paling lambat" (manpower, 1440 ID), "Pengawas lapangan" (crew list, 1024 ID) | 0 |
| Timesheet review: hours figures | inside each line as "12 h", no column | one Hours column, right-aligned, one right x |
| Review drawer week grid at 1440 | n/a (inline expansion, full width) | 7 of 7 days and row totals visible, no horizontal scroll |
| Week grid: project name and code | ran together on short names | code on its own line in all three grid layouts |
| Crews tab, 1440: blocks above the table | header + a toolbar band holding 2 buttons + tabs | header (3 buttons) + tabs |

## 4. Screenshots
`after-r2/<role>-<screen>-<width>-<en|id>.png`; new screens this round: `timesheets-review`, `timesheets-review-open`
(drawer), `approvals-hours`, `approvals-hours-open`. Key: `admin-manpower-1440-id`, `admin-timesheets-review-open-1440-en`,
`admin-crews-selected-1024-id`, `admin-timesheets-review-1440-id`. Sample data created and removed as in round 1 (service
API like the e2e fixtures; removed by the DB reset after the final merge).

## 5. Skill lines applied
- restructure: "A row opens its record in the side drawer over the list" (screen rules) with the brief's "row to scan, right drawer to triage" → review rows and crew people.
- taste (app-screens): "Tables are rules and alignment … numbers right-aligned." → review Hours column.
- impeccable: "Run the real copy at every breakpoint and fix what overflows." → the header sweep in Bahasa at 1440 and 1024.

## 6. Journeys and gates (final code, after the last merge)
- `check:guards` pass · `typecheck` pass · `eslint --max-warnings=0` on touched files pass
- `vitest related --run` on the changed pages: 18 files, 213 tests pass; `TimesheetGrid` callers (grid, timesheet, Timesheets,
  TimesheetReview, timesheets/*, Approvals tests): 31 files, 353 tests pass (`related` on the shared grid itself pulls most of
  the suite and timed out at 10 minutes, so I ran its callers' tests directly)
- Journeys, all green (31 specs on round-2 code before the final merge; after the final merge and DB reset re-ran AC-CRW-015,
  AC-PAY-010, JOB-F4, JOB-H8, JOB-F7, AC-MPN-010, AC-LV-015, JOB-HR-timesheet-work-order, AC-SITE-004, AC-HC-011, AC-ATR-010: green).
  Full list: AC-CRW-015, AC-CTR-012, AC-FOL-010, AC-LV-015, AC-MPN-010, AC-MR-009, AC-PAY-010, AC-PCI-E2E, JOB-A1, JOB-F22,
  JOB-F4, JOB-F5, JOB-F6, JOB-F7, JOB-F8, JOB-H5, JOB-H8, JOB-PC9, JOB-W14, AC-911, AC-TSE-021, JOB-HR-timesheet-work-order,
  layout/timesheets, layout/approvals; serial AC-ATR-010, AC-HC-011, AC-SITE-004, AC-SITE-006, JOB-H9, JOB-PC21, AC-NLL-014.
  No journey step needed changing this round (the review's row button keeps the name "Show entries for …").
- Unit tests changed: TimesheetReview (hours from the Hours cell; entries read in the drawer; the Person filter found as a
  combobox, since a column header now also says Person); new test for `TimesheetGrid stacked`.
- `ux-proof /crews /leave /timesheets/review`: /timesheets/review has no layout finding; text, inputs, targets, overflow, axe (0)
  and impeccable (0) pass on all three. It still exits 1: none of the three routes has a layout baseline, and on /crews and
  /leave it reports the heading-to-table-header text gap (33px) and the standard card-head gap (19px) described in round 1.

## 7. Owner to confirm
1. Manpower header "Tenggat" (Bahasa) instead of "Dibutuhkan paling lambat"; English stays "Needed by".
2. Timesheet review: "Show entries" expansion → the row opens the week in a side drawer, stacked by project.
3. Crews: the selected crew's people open in a drawer instead of a card under the table.
4. Crews: Import crews / Import crew members moved into the page header. On a phone the header now holds three buttons on two lines.

## 8. Needs a data change
None. (An archived position cannot be named, because the positions read excludes archived ones; the row says it is no longer listed.)

## 9. Not done
- Hours approvals frame (`/approvals?scope=timesheets`): left as the Approvals screen's own master-detail layout.
- My time (`/timesheets`): rendered for regression only; not recomposed this round.
- Phone date inputs on Timesheet review: the native phone date field renders narrower than its column with the calendar mark
  outside it; this is the shared `DateField` native branch, not fixed.
- Check-in area settings on the Roster tab keep their own work-order picker; moving them changes the locate-and-reload flow.
- Attendance-rate tab not rendered (needs an organisation target set; not changed in the shared local DB).
- Phone date field shorter than the picker beside it on the attendance tick (shared field heights).
- No layout baseline seed for my routes.

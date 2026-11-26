# Crews, attendance, leave and manpower: screen-owner report

Branch `ui/1126-crews-attendance` (merged with `origin/batch/1126-ui`, pushed). Screenshots on this branch only.
No blocker. No repository, RPC or schema change.

## 1. Purpose and structure (settled before layout)

**Attendance tick** (`/crews?view=attendance`). A foreman on a phone, one hand: *who of my crew is here today?*
First thing: the people of the crew, each with a large status control. Then the day's defaults, then the actions.
For approvers, the weeks waiting for them come first, on the tinted waiting surface.
```
[Weeks waiting for your approval]  Person | Work orders | Week | Hours→ | Return Approve   (approvers only)
[Work order ........][Date]  [Crew ......]            (one row; on a phone WO + date share a row)
┌ CRW-01 · Crew name ................................. 3 of 6 present ┐
│ Person          Status [Present ▾]  Hours [8]  Overtime  Reason       │
│ ...                                                                   │
│ Hours for the crew [8]   Group photo [choose]                         │
│ Add someone from another crew [▾]     (Send the week) [Save attendance]│  ← docked bar on a phone
└───────────────────────────────────────────────────────────────────────┘
┌ Head count ........................... 3 named present above ┐  Count only people not named above
```
**Roster** (`?view=roster`): who serves this work order on this day, and what is short. Per crew: role table
(Crew role | Placed→ | Shortfall→), then a people table (Person + markers | Crew role); placements table below.

**Leave** (`/leave`): *what waits on me to decide, and where are my requests?*
```
Leave                                   [Leave settings] [+ Request leave]
[Waiting for your decision (3)]  Person | Type | Dates | Days→ | Reason | Reject Approve
[Requests]                       Person | Type | Dates | Days→ | Decider | Status   ⋯ Cancel
row → right drawer: dates, days, reason, waiting for / decided by, note, and the actions
```
**Manpower** (`?view=manpower`): *which positions are still to fill, and how far?*
```
Manpower needs                                                     [+ Record a need]
Position (project under it) | Needed by | Asked→ | Filled→ | In progress→ | To fill→ | Status
row → right drawer: progress bar, the four counts, people linked (unlink), Link a person, Cancel / Mark as met / Reopen
```
**Check-ins waiting for you** (top of `/crews`, only when some wait): one table on the waiting surface.
**Tools** (`?view=tools`): the crew's tools first; the equipment-coordinator setting moved below.

## 2. What changed and why
1. Leave: stacked sentences + pills + buttons → one table per block, details in the side drawer (owner: "not even a table").
2. Manpower: each card answered five questions → a row to scan, a drawer to triage (owner: "too much for 1 component").
3. Attendance phone: the first person was below the fold; defaults (hours, photo) moved under the list, Save/Send dock to the bottom on a phone, pickers share rows, the card head shows "N of M present".
4. Waiting weeks and check-in requests: header-less tables / boxed sentences → tables with headers, figures right-aligned.
5. Head count: two sentences → a figure ("3 named present above") and a six-word rule.
6. Roster: role figures right-aligned under headers; people list → two-column table.
7. One name per thing: the manpower count "Open" shared its name with the status "Open" → the count is "To fill".
8. Shared pattern (my files only): a framed table nested inside a padded card body doubled the inset; those cards are seamed and the tables embedded.
No shared component was changed.

## 3. Measured edges (1440, EN, from the live DOM; `measure-compare.json`)
Figure cells: right x of each numeric cell, per column; "ragged" = a column whose figures do not share one right x.

| Screen | Before | After |
|---|---|---|
| Leave (admin) | 0 figure columns (days inside a sentence) | 2 columns, 0 ragged |
| Manpower (admin) | 0 (counts in per-card `dl` grids, left-aligned) | 4 columns, 0 ragged |
| Attendance, weeks waiting (admin) | 0 ("17 hours" text, no header) | 1 column, 0 ragged |
| Roster (admin, foreman) | 2 columns, left-aligned under left headers | 2 columns, right-aligned under right-aligned headers, 0 ragged |
| Tools (foreman) | 4 columns, 0 ragged | 4 columns, 0 ragged (unchanged) |
| Attendance tick, phone 390 (ID): y of first person's name | 753 (only its name shows, its controls below the fold) | 477 (first person with its controls on the first screen, second person starts at 678) |
| Manpower 1024 | Status/To fill columns cut off (horizontal scroll) | table fits ≥1000px container, cards below |
Left edges: card heading x = 273, table cells x = 265 (table spans the card edge to edge, the R1 exemption); page gutter 248 on every tab.

## 4. Screenshots
`ux-shots/crews-attendance/before/` and `after/`, named `<role>-<screen>-<width>-<en|id>.png`.
Roles: `admin` (Admin), `foreman` (site supervisor who is the crew's field controller). Widths 1440, 1024, 390; English and Bahasa.
Screens: crews, crews-selected, roster, attendance, tools, manpower, manpower-open (drawer), leave, leave-open (drawer, after only),
leave-settings, approvals, timesheets, timesheets-review. Key pairs: `foreman-attendance-390-id`, `admin-leave-1440-en`,
`admin-manpower-1440-id`, `admin-manpower-open-1440-id`, `admin-roster-1024-id`.
Sample data: the seed has no crews/leave/manpower rows. I created them through the service API (the same way the
e2e job fixtures do), not through the app UI: one project (IDR), two work orders, three crews with roles, ten people with
long Indonesian names, placements, roster, one loan, three leave types, five leave requests, three manpower needs with links,
three tool lines, one site-supervisor login. Every id was logged and all were deleted afterwards by id. (Later after-shots also
show leftover rows from other e2e journeys, e.g. E2E-* crews; those are not mine.)

## 5. Skill lines applied
- restructure: "Compose 390 separately around the phone job: task/list and evidence first, summary figures below or disclosed, every action reachable." → tick list first, defaults and actions below, docked bar.
- restructure: "Each decision has its evidence beside it; a person should not decide blind." → reason column in the waiting leave table; work area under "Why it waits" on check-ins.
- restructure: "Freeze the feature floor before any edit" → floor below; every item has a home.
- taste (app-screens): "Tables are rules and alignment. … numbers right-aligned." and "Data states are honest. Zeros print as zeros, missing values as a grey dash" → right-aligned figure columns; manpower unknown counts stay "—". Where taste says "no header bands", the shared DataTable keeps its header band (screen-rules/DESIGN win; not changed).
- impeccable (craft floor): "States: hover, disabled, loading, error, empty." → each table keeps loading/error/empty with the card inset; the manpower read failure shows Retry both above the table and inside the drawer.
- impeccable: "Run the real copy at every breakpoint and fix what overflows." → Bahasa headers truncated in manpower → widened; status pill truncated on phone → fixed. `ux-proof` impeccable findings: 0 on /crews and /leave.

## 6. Journeys and gates (real results)
Merged result (after merging `origin/batch/1126-ui`, 106 files from the batch, none of mine):
- `npm run check:guards` — pass
- `npm run typecheck` — pass
- `npx eslint --max-warnings=0 <touched files>` — pass
- `npx vitest related --run <11 changed source files>` — 38 files, 488 tests pass
Journeys (run before the final batch merge; see the update at the end for the re-run):
chromium — AC-CRW-015, AC-CTR-012, AC-FOL-010, AC-LV-015, AC-MPN-010, AC-MR-009, AC-PAY-010, AC-PCI-E2E, JOB-A1, JOB-F22, JOB-F4,
JOB-F5, JOB-F6, JOB-F7, JOB-F8, JOB-H5, JOB-H8, JOB-PC9, JOB-W14, AC-911, AC-TSE-021, JOB-HR-timesheet-work-order,
layout/timesheets, layout/approvals; serial — AC-ATR-010, AC-HC-011, AC-SITE-004, AC-SITE-006, JOB-H9, JOB-PC21: all green after the
step updates below. After the last code commit I re-ran AC-CTR-012, JOB-F22, JOB-F7, JOB-F6, JOB-PC9, AC-LV-015: green.
`affected-e2e.mjs` selects 460 specs (the shared locale file makes everything "affected"); I ran the 30 that open these screens.

Journey steps updated (goals unchanged): AC-LV-015, JOB-H5 (request and roster person are table rows, not list items);
AC-MPN-010 (opens the row, then reads the drawer; count label "To fill"); AC-PCI-E2E, JOB-F5 (check-in request is a table row);
AC-CRW-015, AC-PAY-010, JOB-H8 (week hours read from the Hours column, "8" not "8 hours"); AC-MR-009 (pick Person inside the
release dialog — the leave table on /approvals now also has a Person column); AC-HC-011, JOB-PC21 (empty head-count text).
Unit tests updated (look/word pins replaced by behaviour): LeaveRequests (decider shown in the requester's row), ManpowerNeeds
(opens via the row or the address; new row→drawer test), HeadCountSection and AttendanceTick (named count figure; week hours
figure), WorkOrderRoster leave/release (marker in the person's row).

`scripts/ux-proof.sh /crews /leave` — **fails, as before my work**: neither route has a layout baseline ("missing shrink-only target
baseline; run the measured seed after fixes"), and it reports "heading content starts 33px below it" for a card heading over a
table. That gap is measured from the heading text to the table's header text; the painted gap to the table's band is the standard
card head padding, and the same flag appeared on Crew loans before I touched it. Leave's empty "Requests" card reports 19px, the
same as every CardHead + CardPad in the app. Text size, inputs, 44px targets, overflow, axe (0 serious/critical) and impeccable (0)
pass at 390 and 1440. I did not run the measured baseline seed.

## 7. Owner to confirm
1. Leave settings moved from the corner of the Requests card (and the off-state sentence link) to a header button beside Request leave.
2. Leave rows no longer carry the reason, "Waiting for X to decide", "Approved by X" and the note as lines: the decider is a column, the rest is in the drawer (reason is also a column in the waiting table).
3. Manpower cards → table + drawer; linking, unlinking, Mark as met, Cancel and Reopen are in the drawer. The count "Open" is renamed **"To fill"** (status keeps "Open"). The writer's empty-state sentence "Record the positions a site needs and by when." is gone (the empty state keeps its Record a need button).
4. Attendance: "Hours for the crew" and "Group photo" moved below the people; on a phone Save/Send sit in a bottom bar. The sentence "Save attendance before sending the week" is hidden on a phone (still read by screen readers, and Send stays disabled).
5. Head count: "N named people are ticked present on this crew today. Count here only the people not named on the roster." → "N named present above" + "Count only people not named above"; the empty sentence about who adds it → "No head count for this day" (the read-only line still names who enters it).
6. Check-ins: the helper sentence → "Approving records their attendance"; the reasons are the "Why it waits" column.
7. Weeks waiting: "17 hours" → 17 under an Hours header.
8. Tools: the equipment-coordinator card moved from the top to the bottom of the tab.

## 8. Needs a data change
None.

## 9. Not done
- Check-in area settings on the Roster tab keep their own work-order picker (a second question on that tab); candidate to move next to the work order.
- The Crews tab's import toolbar is a band holding only two buttons above the tabs (shared ListPage toolbar); not changed.
- Selecting a crew still opens its people as a card under the crews table, not a side drawer.
- Crew list, crew loans, leave settings, leave request form, attendance-rate tab and the timesheets screens were rendered for regression only, not recomposed. The attendance-rate tab was not reachable (no target set in the sample data).
- On a phone the date field is shorter than the work-order picker beside it (shared field heights).
- No layout baseline seed for /crews and /leave; no blind re-review.

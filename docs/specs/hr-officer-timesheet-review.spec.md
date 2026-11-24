# HR Officer timesheet review list

Lane `rolescreens` (branch `feat/1124d-role-screens`). Follow-up 2 to migrations 2040–2051 (`2042_people_team_role_rights.sql`). Rulings read: ADR-0016, ADR-0017, `docs/ux/screen-rules.md`, `docs/specs/timesheets.spec.md`.

**Job story.** When I hold the HR Officer job role, I want a list screen to review everyone's timesheets and entries across the organisation — filtered by period, project, and person — so I can check recorded hours for payroll and attendance without having approval authority.

## 1. Today (verified at head)

- Migration `2042` shipped `public.actor_may_review_timesheets()` (`actor_holds_job_role('hr_officer')`) and widened `timesheets_select` and `timesheet_entries_select` so the HR Officer reads every timesheet and entry in their organisation, while `transition_timesheet` remains closed to the HR Officer (`RR-HR-10`, `RR-HR-11`).
- In the app, `/timesheets` (`Timesheets.tsx`) queries `.eq('user_id', userId)` (own week only), and `TimesheetWeekToolbar` offers no review doorway to `Engineer`-level roles.

## 2. Requirements (EARS)

- **FR-HTR-001 (State-driven — access & doorway).** While the signed-in user holds `hr_officer` (or `Admin`, `can('review', 'timesheet')`), the app SHALL permit `/timesheets/review` and, for a non-approver reviewer (`hr_officer`), `TimesheetWeekToolbar` on `/timesheets` SHALL render the `My time` / `Review timesheets` view navigation; any user without `can('review', 'timesheet')` SHALL see `AccessDenied` on `/timesheets/review`.
- **FR-HTR-002 (Ubiquitous — repository & keyset DAL).** `timesheetRepository.listForReview` SHALL read visible `timesheets` joined with `owner` (`profiles`) and `entries` (`projects`, `work_orders`) through `fetchAllRowsByKeyset` without sending `org_id`, applying server-side `user_id` and date-window bounds when supplied.
- **FR-HTR-003 (Ubiquitous — review list & entry inspection).** The `/timesheets/review` screen SHALL list matching timesheets ordered newest week first with person name, formatted week range (`formatDay`), projects worked, exact total hours (`tabular-nums`), and status pill, and expanding a row SHALL display its entries in a read-only `TimesheetGrid`.
- **FR-HTR-004 (Event-driven — URL-persisted filters & pagination).** When the viewer filters by period (`From` and `To` via `DateField`), project (`SelectField`), or person (`SelectField`), or steps pages (`Previous` / `Next` with `Showing a–b of n`), the screen SHALL narrow the list accordingly and keep `from`, `to`, `project`, `person`, and `page` in the URL search parameters.
- **FR-HTR-005 (Ubiquitous — no approve action).** The `/timesheets/review` screen SHALL render no Approve, Return, Reject, Bulk-approve, or Reopen action on any row or expanded entry panel.

## 3. Acceptance criteria (Given / When / Then)

- **AC-HTR-001 (Vitest).** Given `can('review', 'timesheet', ctx)` and `/timesheets` + `/timesheets/review`, when the signed-in user is an `Engineer` holding `hr_officer` vs an `Engineer` holding `storekeeper` or `null`, then `hr_officer` sees the `Review timesheets` link on `/timesheets` and opens `/timesheets/review`, whereas `storekeeper` and plain `Engineer` do not see the link and receive `AccessDenied` on `/timesheets/review`.
- **AC-HTR-002 (Vitest).** Given `listTimesheetsForReview`, when called with optional `personId`, `from`, `to`, and `projectId`, then it reads through `fetchAllRowsByKeyset` without sending `org_id`, normalises entry hours to numbers, and filters sheets whose week/entries match the requested period, project, and person.
- **AC-HTR-003 (Vitest).** Given timesheets with entries across projects, when an HR Officer opens `/timesheets/review` and expands a row, then the row shows the person, week range, project names, total hours, and status, and the expanded panel renders the week's read-only `TimesheetGrid` breakdown.
- **AC-HTR-004 (Vitest).** Given multiple timesheets across periods, projects, and people, when the HR Officer sets the period (`From` / `To`), project, and person filters, then only matching timesheets remain and the filter values are stored in the URL query string.
- **AC-HTR-005 (Vitest).** Given Submitted and Approved timesheets rendered and expanded on `/timesheets/review`, when the DOM is inspected, then no Approve, Return, Reject, or Reopen button exists anywhere on the screen.
- **AC-HTR-006 (Vitest + guards).** Given Bahasa Indonesia (`id`) active, when `/timesheets/review` renders, then headings, filter labels, empty state, and navigation labels render in Bahasa Indonesia.

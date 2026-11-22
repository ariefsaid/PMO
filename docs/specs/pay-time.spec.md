# Pay time: a second record for a worker's day, and a named role decides which stands

Slug `pay-time`. Builds on `docs/specs/crews-roster-attendance.spec.md` (FR-CRW-008..019) and `docs/specs/daily-site-report.spec.md`.
Migration range 1700-1709.

## Job story
When two records of the same worker's day disagree (the foreman's crew tick, and a surveyor's or timekeeper's record), I (payroll
and cost) want a manager role the organisation names to choose which stands, so that exactly one figure is paid and costed and the
other stays on file as evidence. Clock-in stays attendance evidence beside it.

## Today (verified on the base, `land/fix-1122` at fc42e1a00; the code wins over the item text)
- The foreman's per-person tick already becomes hours without any clock-in: `attendance_record(..., 'roster_tick', ...)` writes
  `attendance_days.hours` (`supabase/migrations/1036_attendance_days.sql` §6, restated in 1110 / 1248 / 1465; body read from the
  database at head). A no-login worker's week is approved by `attendance_decide_week` (Admin, Executive, Project Manager; a recorder of any
  day in the week is refused, `recorded_by_ids`); a login worker's week becomes a timesheet via `attendance_generate_timesheet`
  (1037) and is approved through the timesheet path with a recorder separation trigger (`a1_timesheets_attendance_sod`).
- Two sources exist today, but only clock-in (`phone_check_in`) versus crew tick (`roster_tick`): one `attendance_days` row keeps both
  figures (`tick_hours`, `phone_hours`), flags `needs_review` past `organizations.attendance_conflict_tolerance_hours`
  (default 1), and `attendance_generate_timesheet` refuses while flagged. The first writer's `hours` stands meanwhile; the flag is cleared by
  whoever next records `manual_correction` (the crew manager or field controller) with their own figure. No role is named by the
  organisation, and the person who recorded a figure can settle it.
- A third source (surveyor or timekeeper) does not exist. No table, RPC or screen.
- Cost reads one figure per day: `work_order_cost_lines` (view) takes an `attendance_day` row only when `approved_at is not null` and
  `timesheet_entry_id is null`; a day that became a timesheet line is counted through the line. `dsr_report_hours` (1111) follows
  the same once-only rule.
- The site report screen shows one total "People hours" (`pmo-portal/pages/siteReports/SiteReportDetail.tsx:285`, from
  `dsr_report_hours`). Not per person, no source, no disagreement shown.
- `crew_time_approve` exists only in the role catalogue (`1200_builtin_role_catalogue.sql`, `builtInRoles.ts`); no gate reads it
  (approval uses the base level list inside `attendance_decide_week`). So no named right is added here, and the role-capabilities
  branch is NOT merged: the deciding and entering roles are organisation settings (the pattern already used by
  `phone_check_in_supervisor_role`, `leave_approver_role`).
- Settings for this today have no admin screen (the two role settings above are set in the database).

## Design (one line each)
- A second record is a separate table row, never a second `attendance_days` row, so cost readers (including the parallel labour-cost
  reader) keep reading one figure per worker-day. `attendance_record` is not restated.
- Deciding writes the chosen figure INTO the attendance day (`hours`, `overtime_hours`, `status`); the loser stays in the second-record
  table as evidence. The day always carries the standing hours.
- An undecided disagreement blocks the day from reaching a timesheet line, submission or approval (a trigger on `attendance_days`
  evaluates it live, so a later `manual_correction` cannot silently clear it).

## Settings (organisations columns; no on/off switch; defaults keep today's behaviour)
- `attendance_second_record_roles text[]` default `{quantity_surveyor}`: built-in role keys that may enter a second record. Admin,
  Executive and Project Manager base levels always may. Harmless by default: a second record changes no paid figure by itself.
- `attendance_decider_roles text[]` default `{}`: built-in role keys that decide a disagreement. Empty means today's approvers (Admin,
  Executive, Project Manager). Never overrides the separation rule.
- Tolerance reuses `attendance_conflict_tolerance_hours` (default 1).
- No "default winning source" setting: a disagreement is always decided by a person (see question 2).

## Requirements (EARS)
- FR-PAY-001 When a permitted person records a second record (present with hours and optional overtime, or absent) for a rostered worker, work
  order and day, the system shall store it separately from the attendance day, one per worker, work order and day, and change no paid figure.
- FR-PAY-002 The system shall allow a second record only from a role in `attendance_second_record_roles` or an Admin, Executive or
  Project Manager, for a date inside the existing back-date window, and refuse it once the day's week is submitted or locked.
- FR-PAY-003 While a second record differs from the attendance day's total hours by more than the tolerance, or in presence, the system
  shall treat the day as undecided and refuse to link it to a timesheet line, submit it or approve it.
- FR-PAY-004 When a decider chooses a side, the system shall copy that side's figure into the attendance day, mark the other as evidence,
  record who decided and why, and count the day once everywhere (timesheet, cost lines, report).
- FR-PAY-005 The system shall refuse a decision from anyone who recorded the attendance day (any entry in `recorded_by_ids`) or the second
  record, and from anyone outside `attendance_decider_roles` (or the default approvers when empty). The decider is added to
  `recorded_by_ids`, so they cannot then approve the same week.
- FR-PAY-006 Where the second record is within the tolerance, the attendance day's figure stands, the second record is kept as evidence,
  and nothing needs deciding.
- FR-PAY-007 The site report screen shall list each worker's hours for the report's work order and day with the source of the standing
  figure, show the other record beside it, and flag a day awaiting a decision, to people who may record or decide; everyone else keeps the total.
- FR-PAY-008 Each refusal shall have an English and a Bahasa Indonesia sentence in the refusals catalogue saying what to do next.
- FR-PAY-009 The day's decision and each second record shall be audited (`log_audit`).

## Acceptance criteria (Given / When / Then; owner layer)
- AC-PAY-001 Given a rostered worker with a tick of 8 h, when a surveyor records 5 h, then one second record exists, the day still reads
  8 h and `work_order_cost_lines` has no extra row. (pgTAP)
- AC-PAY-002 Given a role not in the setting and not a manager level, when it records a second record, then 42501. A locked or submitted
  week refuses with ATT_SUBMITTED. (pgTAP)
- AC-PAY-003 Given 8 h versus 5 h (tolerance 1), when anyone tries to generate the timesheet, submit or approve the week, then it is refused
  until decided; a `manual_correction` of the day does not clear it. (pgTAP)
- AC-PAY-004 Given a decider chooses the second record, then the day reads 5 h, the tick figure is kept as evidence, and the week
  generates and approves with 5 h. (pgTAP)
- AC-PAY-005 Whole ledger, one worker, one day, two records, decided either way: the sum of `work_order_cost_lines` `hours` for that worker-day
  equals exactly the chosen figure, and `dsr_report_hours` counts it once. (pgTAP)
- AC-PAY-006 Separation: the foreman who ticked cannot decide; the surveyor who recorded the second record cannot decide; a manager who is neither
  can; the decider then cannot approve that week. (pgTAP)
- AC-PAY-007 Setting `attendance_decider_roles = {project_control_manager}` makes a Project Manager (not that role) refused and that role
  accepted; empty restores the default approvers. (pgTAP)
- AC-PAY-008 Given 8 h versus 7.5 h, then no decision is needed and the day's 8 h stands with the 7.5 h kept. (pgTAP)
- AC-PAY-009 Site report screen: a manager sees per-worker rows, the disagreement flag and Decide; a role with no right sees only the total; a
  disabled Decide says why; empty state says who adds records. English and Bahasa Indonesia, 390 and 1440 px. (Vitest component)
- AC-PAY-010 Journey: foreman tick 8 h, surveyor second record 5 h, manager decides "second", week approved, cost shows 5 h. (one Playwright)

## Mutation plan (break the rule, the named test must go red)
1. Drop the recorder check in the decision RPC: AC-PAY-006 red. 2. Drop the role check: AC-PAY-002 / 007 red. 3. Drop the guard trigger or make it
read `needs_review` only: AC-PAY-003 red. 4. Make the decision write the second figure as an extra attendance row or keep both: AC-PAY-005 red.
5. Make the tolerance test `>=`/ignore it: AC-PAY-008 red.

## Open questions only the customer can answer (recommended answers)
1. Who may enter a second record by default? Recommend `quantity_surveyor` plus the manager levels; the customer adds a timekeeper role in the setting.
2. The job story asked for a default winning source (site report). The steering says nobody is paid without a person choosing. Recommend no
   automatic winner; a person decides each disagreement. (If wanted later: a setting, default "none".)
3. Which role decides? Recommend empty (today's approvers) until the customer names one.
4. Is there an admin screen for these settings? None exists for the sibling role settings; recommend a small Administration card in Phase B only if the owner wants it, else database-set like its siblings.

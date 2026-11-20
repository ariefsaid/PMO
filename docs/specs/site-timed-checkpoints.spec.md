# Spec: Timed checkpoints on the daily site report (#2594)

**Status:** proposed; owner decisions below need sign-off before build. Map #2516. Target February to March 2027, after the 15 December go-live. IDs `FR-STC-###`, `NFR-STC-###`, `AC-STC-###`, `OD-STC-#`. Plan: `docs/plans/2026-11-21-site-timed-checkpoints.md`. Executor: Orca worker; the database slice (server-stamped times, role gates, the reminder job) is Director-dispatched with the security-auditor. **Not money path:** it posts nothing, adds no amount and does not gate validation or revenue of the daily site report. Builds on the daily site report (`docs/specs/daily-site-report.spec.md`, #1522, migrations 1040 and 1041) and the crews roster (1035, #2528).

## Job story

When a crew is due on site, I want the day's checkpoints (arrival, pre-work check, start, after the break, progress every few hours) set by my organisation with a time each, recorded by the field controller with a photo, so that a late checkpoint reminds the reporter and flags the work order, and I can see which crews started on time.

## Context and boundary (checked against `origin/dev`, 20 Nov 2026)

- A daily site report is one work order and one work date (`daily_site_reports`, 1040), entered by Admin, Engineer or the project's manager (`dsr_may_enter`, 1041). Its photos live in the private bucket `site-report-photos` under `<org>/<report>/…`, with an object policy keyed to the report (1041).
- The crews roster (1035) gives, per work order and date, the crews placed on it and each crew's `field_controller_id` through `work_order_roster(p_work_order_id, p_date)` (a `security invoker` read) and the `work_order_crews` date ranges. A crew's field controller is the natural reporter. Daily reports are not tied to a crew today, so checkpoints are keyed to **work order, crew and date**, not to the report row (OD-STC-1).
- The overdue-job precedent is `escalate_overdue_incidents()` (1028): a `security definer` function on `cron.schedule`, stamps a column once, notifies through `notify_workflow_user` (0237), writes an audit row. Notifications reach users as the shared literal message form (1025); a translated template key is later (OD-STC-6).
- Times are the **organisation's local clock** (`organizations.default_timezone`, helper `native_org_today`/`org_current_month` family, 0245); the server converts to instants and stamps the recorded time itself. The client never supplies the recorded time.
- This is **not** attendance (`attendance_days`, 1036) and not timesheet hours; it does not change either.
- Out of scope: GPS or geofence proof, offline capture (native-app ruling #2534), per-contract or per-crew lists (OD-STC-2), payroll effects of lateness, a block on validating the day's report.

## Definitions

- **Checkpoint** (template) = a named point in the day with a local time due, a kind (`arrival`, `pre_work`, `start`, `after_break`, `progress`, `other`), a grace in minutes (default 0) and a photo-required flag (default on). At most one `start` per list. The organisation's list has 0 to 12 checkpoints.
- **Day checkpoint** = a copy of a template item for one (work order, crew, date), with its due instant (`due_at` = local date + due time in the organisation's timezone), its grace, and, once recorded, the server time, the person, an optional note and the photo path.
- **Late** = recorded after `due_at + grace`, or not recorded and `now() > due_at + grace`.
- **Started on time** (crew, day) = the `start` checkpoint is recorded at or before `due_at + grace`. A day with no recorded `start` is **not started** (not "late" until the grace has passed, and never "on time").

## Requirements (EARS)

**The organisation's list**
- FR-STC-001 Admin shall be able to define the organisation's checkpoint list as one whole ordered list, each item with a name (1 to 120 characters), kind, local due time, grace minutes (0 to 120) and photo-required flag. Weekdays are not modelled; a list applies on every day a crew is rostered (OD-STC-3).
- FR-STC-002 The list shall be replaced through one function (as `set_billing_stage_template` does), and editing it shall not change a day checkpoint already created.

**The day**
- FR-STC-010 A scheduled database job shall, for every work order that is `Issued` and has a crew rostered for the day (`work_order_crews`), create that day's checkpoints for each rostered crew from the current list, once; a re-run shall add none. The day is the organisation's local date.
- FR-STC-011 When a crew is placed on a work order after the day's checkpoints were created, the job's next run shall create that crew's checkpoints for the rest of the day, with due instants already past counted late only after the grace (they are not back-dated to be recorded).
- FR-STC-012 A crew with no field controller shall still get checkpoints; its reminders go to the work order's project manager (Admin if none).

**Recording**
- FR-STC-020 When a checkpoint's crew field controller, or Admin, Engineer or the work order's project manager, records a checkpoint, the database shall stamp the server time and the caller, require a photo when the checkpoint requires one, and accept an optional note up to 500 characters. The recorded time shall come only from the server.
- FR-STC-021 A recorded checkpoint shall not change; a mistake is corrected by a note on the day, not by editing the time or photo (OD-STC-5).
- FR-STC-022 A checkpoint shall be recorded only for a work order that is `Issued` and for the organisation's current day or the day before (a controller entering last evening's late record), never a future day.
- FR-STC-023 Photos shall go to a new private bucket `site-checkpoint-photos`, path `<org>/<work order>/<crew>/<date>/<checkpoint>.<ext>`, readable and writable only by active members of that organisation who may record or read that work order's checkpoints, 10 MB, image types as `site-report-photos`.

**Lateness**
- FR-STC-030 When a checkpoint becomes late and is not recorded, a scheduled database job shall remind the crew's field controller once, stamp `late_notified_at`, and write an audit row; a re-run shall not notify twice. Recording a checkpoint after it was reminded clears nothing (the stamp stays).
- FR-STC-031 A work order shall be **flagged** while any of its day checkpoints for today is late. The flag is derived from the rows, shown on the work order's record page and in the daily site report, and is not stored.
- FR-STC-032 The daily site report page shall show the day's checkpoints for its work order, due time, recorded time, person, photo and late state. Validation and revenue shall not depend on them (OD-STC-4).

**Crews on time**
- FR-STC-040 The database shall return, per crew and day in a date range (optionally per work order or project), the `start` checkpoint's due time, recorded time, minutes late and a status `on_time`, `late` or `not_started`, with, per crew, the count of days and the share started on time. The share is a count of days, never an average of minutes.
- FR-STC-041 The view shall list crews ordered by share on time ascending, then name, bounded to 200 crews and 92 days, and shall say when the bound truncates.

**Access and tenancy**
- FR-STC-050 Reads of day checkpoints and the crews view shall be limited to active members of the organisation with the role Admin, Executive or Engineer, the work order's project manager, or the crew's own field controller (their own crew's rows). Finance and Viewer are not given it (OD-STC-7). The database refuses; the screen is gated by `can()` as a convenience only.
- FR-STC-051 No client write grant shall exist on the new tables. Every function is `security definer`, re-asserts active membership, role and organisation, and the jobs run with no caller and write `org_id`-scoped rows only.
- FR-STC-052 The list shall be replaced by Admin only.

## Non-functional requirements
- NFR-STC-001 Additive migration; new tables carry `org_id` stamped by the server, RLS on with `(select helper())` wrappers (`supabase/tests/0646_rls_initplan.test.sql`), indexes on `(work_order_id, work_date)` and a partial index on unrecorded, unreminded rows for the job.
- NFR-STC-002 The jobs scan only today's rows and run every 15 minutes through `cron.schedule`; each row is processed `for update skip locked`; a failure on one row does not stop the rest.
- NFR-STC-003 English and Bahasa Indonesia strings in the existing site-report namespace or a new one; `DESIGN.md` tokens; the record action works at 320 CSS pixels with a camera capture input; late is shown by words, not colour alone.
- NFR-STC-004 Dates are organisation calendar dates and instants computed in the database; the screen shows the organisation timezone label.

## Acceptance criteria and owning layer

| ID | Given / When / Then | Layer |
|---|---|---|
| AC-STC-001 | Given Admin saves a list of four checkpoints, then it is stored in order with kind, time, grace and photo flag; a second `start`, a grace over 120 or a blank name is refused; Finance, Project Manager and Engineer are refused `42501`. | pgTAP |
| AC-STC-002 | Given an Issued work order with two crews rostered today, when the job runs twice, then each crew has the list's checkpoints once; a Draft or Closed work order, or a crew outside its roster dates, has none. | pgTAP |
| AC-STC-003 | Given a list edited after the day's checkpoints exist, then those rows are unchanged; the next day uses the new list. | pgTAP |
| AC-STC-004 | Given the field controller of a crew, when they record `start` with a photo, then the server time and person are stamped and the client cannot set the time; with no photo where one is required it is refused; a controller of another crew, a Finance user or another organisation's user is refused. | pgTAP |
| AC-STC-005 | Given a recorded checkpoint, when anyone edits its time, photo or person, then it is refused; a future day, or a non-Issued work order, is refused. | pgTAP |
| AC-STC-006 | Given a checkpoint due at 07:00 with grace 10 in a timezone ahead of UTC, when the job runs at 07:11 local and nothing is recorded, then the controller is notified once and `late_notified_at` is stamped; at 07:09 nothing; a second run adds none. | pgTAP |
| AC-STC-007 | Given a crew with no field controller, then the reminder goes to the project manager, or the Admins if none; another organisation's users receive nothing. | pgTAP |
| AC-STC-008 | Given a late checkpoint today, then the work order reads as flagged; once every late one is recorded it still reads flagged for that day (late stays late); a work order with none late is not flagged. | pgTAP |
| AC-STC-009 | Given three days for one crew (start on time, start 20 minutes late, start never recorded), when the crews view is read, then it shows 3 days, 1 on time, share one third, statuses `on_time`, `late`, `not_started`. | pgTAP |
| AC-STC-010 | Given more than 200 crews or a range over 92 days, then the read is bounded and reports truncation. | pgTAP |
| AC-STC-011 | Given the pure lateness rule, when due 07:00, grace 10, recorded 07:10 or 07:11, or not recorded at 07:11, then the states are on time, late, late. | Unit (`pmo-portal/src/lib/siteCheckpoints.test.ts`) |
| AC-STC-012 | Given a controller on a phone width, when they open the day's checkpoints, record one with a photo and see it as recorded with its time, then the next due one is current; a late one shows as late in words. | RTL (`SiteCheckpoints.test.tsx`) |
| AC-STC-013 | Given a controller records `start` with a photo, then the crews view lists that crew with the day on time, and the daily report page shows the checkpoint. | E2E (one journey, job invoked by a test hook) |

## Errors
| Condition | Result |
|---|---|
| Record without a required photo | `23514`, detail `checkpoint-photo-missing` |
| Record again, edit, or a future day | `55000`, detail `checkpoint-not-recordable` |
| Not the crew's controller, project manager, Admin or Engineer | `42501` |
| Work order not Issued | `55000`, detail `work-order-not-issued` |
| Photo upload fails | Checkpoint not recorded; photo shows retry |
| One row fails in a job run | Row skipped and retried next run; others proceed |

## Owner decisions (recommended defaults, not rulings)
| ID | Decision and default | If wrong, what breaks |
|---|---|---|
| OD-STC-1 | Checkpoints are per **work order, crew and date**, created by the job from the roster, not hung on the daily report row. | Keyed to the report they would not exist until someone starts the report, so a crew that never arrives would have no late checkpoint and the late reminder could never fire. |
| OD-STC-2 | One organisation-wide list. Per-contract or per-crew lists are deferred. | A contract with different site hours is held to the wrong times; the team uses grace or a longer list until the override ships. |
| OD-STC-3 | The list applies every rostered day; no weekday or holiday calendar. | Rest days with a rostered crew produce late reminders. A day off is handled by ending the crew's placement, as the roster does today. |
| OD-STC-4 | Late checkpoints **do not block** validating the day's report or its revenue. | A block would stall revenue because of a missed photo; the owner may later want lateness to be a validation warning. |
| OD-STC-5 | A recorded checkpoint is immutable; a correction is a note. | An editable time lets a controller move a late record to on time and the view stops being evidence. |
| OD-STC-6 | The reminder uses the shared literal message form (English). A translated template key is added later. | Bahasa Indonesia users read an English reminder until it ships. |
| OD-STC-7 | The crews view is for Admin, Executive, Engineer, the project's manager and the crew's own controller; not Finance or Viewer. | Too wide: a role without a field function reads crew punctuality. Too narrow: a site manager cannot see their crews; widen by one role in one function. |
| OD-STC-8 | Reminders go to the field controller only; no second reminder and no escalation to the manager. | A single missed reminder is the only notice; escalation (as the issue log does) is a small later addition. |
| OQ-STC-1 | Is a "progress every few hours" series entered as separate checkpoints (default) or as a repeating rule? | A repeating rule needs an interval field and a generator; separate rows need one row per slot. |
| OQ-STC-2 | Availability: does this follow the existing daily-site-report entitlement, or its own switch (`org_features`)? Default: follows the daily site report; confirm at build. | The feature appears for an organisation that has not enabled site reports. |

## Delivery checklist
- [ ] Owner signs OD-STC-1..8 and answers OQ-STC-1..2.
- [ ] Owner sketch-glance of the phone checkpoint screen before build.
- [ ] Glossary: Checkpoint, Day checkpoint, Started on time (`docs/glossary.md`).
- [ ] After release: `improve-codebase-architecture` on the changed areas.

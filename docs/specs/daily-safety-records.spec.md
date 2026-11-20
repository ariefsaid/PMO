# Spec: Daily safety records per work order (#2596)

**Status:** proposed; owner decisions below need sign-off before build. Map #2516 (contractor field operations), after the December go-live. Target Q2 2027. IDs `FR-DSF-###`, `NFR-DSF-###`, `AC-DSF-###`. Plan: `docs/plans/2026-11-21-daily-safety-records.md`. Executor: Orca worker. **Not a money path:** no posting, no ERP write, no billing or payroll effect, no change to any separation-of-duties rule. It is a records feature with a read-only monthly summary. Photos are personal data of site workers, so storage access is part of the tested behaviour.

## Job story

When a crew starts work on a work order, I want the safety checks the field runs before work (fitness check, toolbox talk with an attendance photo, pre-work checklist, permit to work) and the safety officer's daily report recorded against that work order and that day, and a monthly summary of safe hours and safety figures, so that we can show the client and our own management that the checks happened, and see at a glance which work orders ran without them.

## Context and boundary (checked against `origin/dev`)

- The unit is **work order and day**, as in the daily site report (`daily_site_reports`, 1040: `work_order_id`, `work_date`, one original per work order and date) and attendance (`attendance_days`, 1036: `worker_id`, `work_order_id`, `work_date`, `status`, `hours`, `overtime_hours`). Safety records are a **separate record per work order and day**, not columns on the site report: they are written by different roles at different times and must stand without a progress report (OD-DSF-1).
- Hours worked per work order and day already exist in `attendance_days` (status `present`, `hours` + `overtime_hours`). The summary **reads** them; it adds no hours table (OD-DSF-3).
- Incidents already exist: `incident_reports` (`incident_date`, `type`, `severity`, `status`, 0001; work order and close fields added by 1026 for the site issue log). It has **no lost-time marker**. The summary needs one to define safe hours (OD-DSF-3).
- Photos follow the private-bucket pattern of `attendance_photos` and the `attendance-photos` bucket (1036: private, 10 MB, image types only).
- Roles: the field-controller and safety-officer roles from #902 do not exist yet. Until then the mapping follows the daily site report (1041): enter = Admin, Engineer, or the project's Project Manager (OD-DSF-4).
- Audit follows `record_history_config` (0260). Soft-archive (ADR-0018).

## Definitions

- **Safety day** = one record for a `(work_order_id, work_date)` with status `draft | submitted | locked`, an author, and up to five parts. The work order must be `Issued`; the project is derived from it by the database.
- **Fitness check** = per worker on that day: `fit | not_fit | not_checked`, a note when `not_fit`. Workers come from the work order's roster (`work_order_roster`, 1036) and may include a named visitor.
- **Toolbox talk** = topic, presenter, held-at time, attendee list (workers from the roster), and one or more attendance photos.
- **Pre-work checklist** = the organisation's active list of pre-work items (OD-DSF-5), each `yes | no | not_applicable` with a note on `no`.
- **Permit to work** = a permit number, type (free text from an org list), valid-from and valid-to timestamps, issued-by, and `open | closed`. A work order and day may have none, one or several.
- **Safety officer's report** = free text of up to 4,000 characters, counts of near misses and observations, and a link to any incident raised that day (`incident_reports`). Not an incident record itself.
- **Complete day** = a locked safety day with a toolbox talk with at least one photo, a pre-work checklist with no unanswered item, and a fitness check for every worker present that day in `attendance_days`.
- **Worked hours** (month, project or work order) = sum of `hours + overtime_hours` over `attendance_days` with status `present`, locked or approved (`locked_at` set) rows only, by organisation-local work date (OD-DSF-3).
- **Safe hours** = worked hours since the end of the last **lost-time** incident's date, within the project, or since the start of attendance records when none. Lost-time is the new marker (`incident_reports.lost_time`, OD-DSF-3).
- **Month** = the calendar month in the organisation's timezone (`default_timezone`, `org_current_month`, 0245), never browser time.

## Requirements (EARS)

**Recording**
- FR-DSF-001 The system shall let an authorised user create at most one original safety day per work order and date, and only for an `Issued` work order.
- FR-DSF-002 The system shall let the author record, on a draft, the fitness check, toolbox talk, pre-work checklist, permits and safety officer's report as separate parts; any part may be empty on a draft.
- FR-DSF-003 When a toolbox talk is saved, the system shall require at least one attendee and shall store the attendance photo as a private file.
- FR-DSF-004 The system shall reject a worker who is not on the work order's roster for the date, except a named visitor.
- FR-DSF-005 When a permit's valid-to is before its valid-from, the system shall refuse it.
- FR-DSF-006 When a safety day is submitted, the system shall lock it; a locked record shall be immutable. A correction shall be a new version that names the one it supersedes and carries a reason, as the daily site report does (1040 `supersedes_id`).
- FR-DSF-007 The system shall let the safety officer's report be added by the safety officer role after the day is locked, as its own signed entry, without changing the locked parts.

**Reading**
- FR-DSF-008 The work-order page shall show per day whether the day is complete, which parts are missing, and a list of days in the last 30 days without a locked record where attendance shows workers present ("worked without a safety record").
- FR-DSF-009 The system shall let a member open any one day and see its parts, photos and the author, with every photo behind a short-lived signed link.
- FR-DSF-010 Lists shall filter by project, work order, date range and status, newest first with a stable tie-breaker, bounded pagination.

**Monthly summary**
- FR-DSF-011 The system shall provide a monthly safety summary per project and organisation: worked hours, safe hours, lost-time incidents, recordable incidents (non-lost-time incidents with severity Medium or above), near misses (sum from the safety officer's reports), toolbox talks held, complete days, and days worked without a safety record.
- FR-DSF-012 The summary shall be one database read, reproducible from the underlying rows (the drill-down lists the days and incidents behind every count).
- FR-DSF-013 When a figure cannot be computed (for example, a work order with attendance but no recorded hours), the summary shall hide it with its reason in one line and never show 0.
- FR-DSF-014 The summary shall be exportable as a read-only page for the client with figures only, no photos and no names.

**Access and tenancy**
- FR-DSF-015 Entry shall be limited by the database to Admin, Engineer, or the project's Project Manager (and the safety-officer role once #902 ships); read to every active member of the organisation except Viewer for photos and names (OD-DSF-6).
- FR-DSF-016 `org_id` is stamped by default and never sent by the client; another organisation's rows and files are never returned (ADR-0017).
- FR-DSF-017 Every create, submit, correction and file upload shall appear in record history with who and when.

## Non-functional requirements
- NFR-DSF-001 Worker photos are personal data: private bucket, signed URLs under 10 minutes, deletion with the record's retention rule (OD-DSF-7); no client name or worker name in any log.
- NFR-DSF-002 English and Bahasa Indonesia strings in a new namespace; `DESIGN.md` tokens; the capture form works at phone width and, where the existing offline capture queue supports a part, reuses it (`docs/specs/pwa-offline-capture.spec.md`) instead of a new queue.
- NFR-DSF-003 Dates and months are organisation-local, computed in the database.
- NFR-DSF-004 RLS policies wrap caller helpers in `(select helper())` (`supabase/tests/0646_rls_initplan.test.sql`); every migration is reversible.

## Acceptance criteria and owning layer

| ID | Given / When / Then | Layer |
|---|---|---|
| AC-DSF-001 | Given an Issued work order, when an Engineer creates a safety day for a date twice, then one original exists; given a Draft or Closed work order, then creation is refused. | pgTAP |
| AC-DSF-002 | Given a toolbox talk with no attendee, or an attendee not on the roster and not a visitor, when saved, then it is refused. | pgTAP |
| AC-DSF-003 | Given a permit valid-to before valid-from, when saved, then it is refused. | pgTAP |
| AC-DSF-004 | Given a submitted safety day, when any part is updated or deleted, then it is refused; a correction creates version 2 with a reason, and version 1 stays readable. | pgTAP (+ mutation check) |
| AC-DSF-005 | Given a locked day, when the safety officer adds a report entry, then it saves as its own signed entry and the locked parts are unchanged. | pgTAP |
| AC-DSF-006 | Given a Viewer, when they try to create or edit a safety day, then it is refused; given another Project Manager, then refused. | pgTAP |
| AC-DSF-007 | Given a photo in organisation A, when a member of B requests it, then it is unreadable; given a disallowed type or over 10 MB, then upload is refused. | pgTAP (storage policy) |
| AC-DSF-008 | Given attendance of workers present, a locked safety day with a photo, a complete checklist and a fitness check for each, when derived, then the day is complete; remove the photo and it reports the missing part. | Unit (pure function) |
| AC-DSF-009 | Given 3 workers present in attendance and no safety day, when the list is derived, then the day shows as worked without a safety record. | pgTAP |
| AC-DSF-010 | Given attendance of 8 + 2 overtime hours on two days, a lost-time incident dated the first day, when the summary runs, then worked hours are 20 and safe hours are the hours after that incident date, reproducible from the listed rows. | pgTAP |
| AC-DSF-011 | Given a month boundary in a timezone ahead of UTC, when the summary runs, then an event at the local month's last day falls in that local month. | pgTAP |
| AC-DSF-012 | Given a work order with attendance rows but no hours, when the summary runs, then worked hours are hidden with a reason, not 0. | Unit + pgTAP |
| AC-DSF-013 | Given two organisations, when the summary runs, then only the caller's rows appear. | pgTAP |
| AC-DSF-014 | Given the client export, when rendered, then it holds figures only, no photo link and no worker name. | Unit |
| AC-DSF-015 | Given a field user, when they record a fitness check, a toolbox talk with a photo and a checklist for a work order, and submit, then the work-order page shows the day complete. | E2E (one journey, owner-sketch-approved layout) |
| AC-DSF-016 | Given the monthly summary screen, when a count is opened, then the days or incidents behind it list and match the count. | E2E (one journey) + Unit (render) |

Mutation check: remove the lock-on-submit trigger and AC-DSF-004 must go red; remove the roster check and AC-DSF-002 must go red; remove the storage policy's organisation test and AC-DSF-007 must go red; restore.

## Errors
| Condition | Result |
|---|---|
| Work order not `Issued` | Refused; shown as "work order is not issued" |
| Worker not on roster | Refused with the worker named in the form |
| Edit after submit | Refused; the form offers "correct" with a reason |
| Photo wrong type or too large | Refused with the shared upload error |
| Summary read fails or returns a malformed figure | Shared error state with retry; never a plausible zero |
| No attendance in the month | One-line empty state; no zero safe hours |

## Owner decisions (recommended defaults, not rulings)
| ID | Decision and default | If wrong, what breaks |
|---|---|---|
| OD-DSF-1 | Safety records are their own record per work order and day, separate from the daily site report. | Folding them into the site report ties safety entry to the report author's and validator's workflow; a day with safety checks and no progress report cannot be recorded, and a report's validation would depend on safety, which is not a billing decision. |
| OD-DSF-2 | v1 records and reports; it does **not** block the site report, attendance or any money step when safety checks are missing. It flags "worked without a safety record". | If the owner needs a hard stop (no permit, no validation), a gate on the validation RPC is a money-adjacent change that must ship alone; recording-only gives no enforcement a client auditor may expect. |
| OD-DSF-3 | Worked hours come from locked or approved attendance rows (`hours + overtime_hours`); safe hours restart after a **lost-time** incident, marked by a new boolean on `incident_reports`. | Using timesheets instead double counts people who are on both; with no lost-time marker, safe hours can only be "hours since the last incident of any severity", which resets on a minor event and understates the figure the client expects. |
| OD-DSF-4 | Roles until #902: enter and submit = Admin, Engineer, the project's Project Manager; the safety officer's entry is allowed to the same set and to a new `safety officer` role when #902 lands. | A field user without these roles cannot record; adding a role later is a policy change, but re-mapping existing rows is not needed because the author is stored. |
| OD-DSF-5 | The pre-work checklist is an organisation list (Admin-edited, like the assessment template of #2595) copied onto each day when it is created. | A fixed list cannot cover different disciplines; a per-day free-form list cannot be summarised. |
| OD-DSF-6 | Photos and worker names are readable by Admin, Executive, the project's Project Manager and Engineer; a Viewer sees counts only. | Too narrow: a client auditor cannot see evidence; too wide: workers' photos are readable by any role in the organisation. |
| OD-DSF-7 | Retention: keep records and photos for the life of the project and 24 months after close, then archive; deletion is a manual Admin action. | Too short loses audit evidence; unlimited retention keeps personal photos with no purpose. |
| OQ-DSF-1 | Is the safety officer's report one per project per day, or one per work order per day? Default per work order and day, with a project roll-up. | A project-level report is duplicated across its work orders. |
| OQ-DSF-2 | Does the permit to work need a second signer (issuer different from the requester)? Default no, recorded only. | A permit approved by the person who needs it, with no evidence of independent issue. |
| OQ-DSF-3 | Bahasa Indonesia wording for the five parts to be confirmed by the owner. | Terms the field team does not use. |

## Delivery checklist
- [ ] Owner signs OD-DSF-1..7 and answers OQ-DSF-1..3.
- [ ] Owner sketch-glance of the layout before build.
- [ ] Glossary entries: safety day, safe hours (with the build).
- [ ] After release: `improve-codebase-architecture` on the changed areas.

# Issue log for site work (SIL)

Issue #2521 (map #2516, blocked by #2517). Status: **Draft, 2026-11-20**. Executor on sign-off: Orca worker
(`docs/orca-dispatch.md`); Opus builder for the RLS/escalation slice, three reviewers, security-auditor. Plan
`docs/plans/2026-11-20-site-issue-log.md`. IDs: `FR-SIL-###`, `AC-SIL-###`. **Not a money path.**

**Job story.** When something goes wrong on site, I want to raise an issue from my phone with a photo, name who must fix
it and by when, be told if it is late, and close it with proof, so site problems do not vanish into messages.

**Decision: extend Incidents, do not add a second record.** The register already has list, detail, analytics, filters
and a feature switch (`incidents`); a parallel "issue" table would split the same concept. The work-order page and
the UI call them **issues**; the existing "incident" label stays for safety events. Open question 1 asks the owner to
confirm the single-record choice.

## 1. AS-IS
- `incident_reports` (0001 + later): `incident_date`, `type`, `severity` (Low..Critical), free-text `location`, `description`,
  `status` (Open / Investigating / Closed), `reported_by` (stamped by trigger, 0017), optional `project_id` (0043).
  RLS: read in org; any member inserts; update by Admin, Executive, Project Manager, Finance (0002).
- UI: `pages/Incidents.tsx`, `pages/IncidentDetail.tsx`; DAL `src/lib/db/incidents.ts`; route behind the `incidents` switch.
- No work order, owner, photo, due time, close time, escalation, or link to a task. Tasks exist (`tasks`, #2531 adds the
  work-order link). In-app notifications go through `notify_workflow_user` (0237); scheduled DB work uses `pg_cron`
  (e.g. 0356).

## 2. Requirements (EARS)

**Record**
- FR-SIL-001 An issue shall additionally carry: `work_order_id` (optional; of the issue's project, #2517 rule; project required to name one),
  `assignee_id` (person in charge, an active member of the org), `action` (what must be done, text <= 1000), `due_at` (timestamptz, optional),
  `closed_at`, `closed_by`, `close_note`.
- FR-SIL-002 `closed_at` and `closed_by` shall be stamped by the database when status becomes Closed, never supplied; reopening clears them and writes an audit row.
- FR-SIL-003 `due_at` may not be in the past when set on creation; later edits may only be made by structure-edit roles.
- FR-SIL-004 Any member may raise an issue (as today). Setting the assignee, due time or work order after creation is a manager edit
  (Admin, Executive, Project Manager, Finance); the assignee may add photos, a note and change status Open → Investigating → Closed.
- FR-SIL-005 Existing issues, the register and analytics keep working with every new column null.

**Photo evidence**
- FR-SIL-010 An issue shall hold up to 10 photo/document attachments (15 MB each, image/PDF), each tagged `at_raise` or `at_close`, readable by anyone who reads the issue, added by the reporter, the assignee and manager roles.
- FR-SIL-011 The raise form shall accept a phone camera capture (`accept="image/*"` + capture) and upload before or with the save, without losing the typed text on failure.
- FR-SIL-012 Where the issue's severity is High or Critical, closing shall require at least one `at_close` attachment, enforced in the database. Lower severities: proof optional. (Open question 2.)

**Escalation**
- FR-SIL-020 When an issue is not Closed and `due_at` has passed, a scheduled job shall mark it escalated once (`escalated_at`), notify the assignee and the project manager of its project (and Admin if none), and write an audit row. A re-run shall not notify twice.
- FR-SIL-021 Extending `due_at` after an escalation shall clear `escalated_at`, so a later miss escalates again; the audit keeps both.
- FR-SIL-022 The register shall show an "Overdue" filter and badge computed from `due_at`, not from the job having run.
- FR-SIL-023 The job shall be org-scoped, idempotent, and a no-op for an org whose `incidents` switch is off.

**Issue to task**
- FR-SIL-030 A manager shall be able to create a task from an issue (name from the issue, assignee, due date, work order, project) through one RPC that links them (`incident_reports.task_id`, unique) in one transaction; a second attempt is refused with a pointer to the existing task.
- FR-SIL-031 Closing the linked task shall not close the issue, and closing the issue shall not close the task (two records, one link); both pages show the link.

**Surfaces**
- FR-SIL-040 The work-order page lists the issues naming it (open first); the project page links to its issues.
- FR-SIL-041 All strings English and Bahasa Indonesia; the form works at 375 px.

## 3. Acceptance criteria

| AC | Given / When / Then | Owning layer |
|---|---|---|
| AC-SIL-001 | Given a project and a work order of it, when an issue names that work order, it saves; of another project, refused. | pgTAP |
| AC-SIL-002 | Given an issue closed, then `closed_at`/`closed_by` are set by the database; a client-supplied value is ignored or refused. | pgTAP |
| AC-SIL-003 | Given an Engineer (reporter, not assignee), when they set the assignee or due time after creation, then refused; the assignee may add a note and set Investigating. | pgTAP |
| AC-SIL-004 | Given a High issue with no close photo, when closing, then refused; with one, it closes. A Low issue closes without. | pgTAP (mutation-check) |
| AC-SIL-005 | Given an attachment on an issue of another org, then add/read denied (row and storage object). | pgTAP |
| AC-SIL-006 | Given an open issue past `due_at`, when the job runs twice, then one notification each to assignee and PM and one audit row. | pgTAP (calls the job function directly) |
| AC-SIL-007 | Given an escalated issue whose `due_at` is moved forward, then `escalated_at` clears and a later pass escalates again. | pgTAP |
| AC-SIL-008 | Given an org with `incidents` off, then the job does nothing. | pgTAP |
| AC-SIL-009 | Given an issue, when a manager makes a task, then a task exists with the same work order, project, assignee, due date, and the issue links to it; a second attempt is refused. | pgTAP + Unit |
| AC-SIL-010 | Given a phone viewport, when I raise an issue with a camera photo, then it is saved with the photo and appears in the register. | E2E (one journey) |
| AC-SIL-011 | Given an issue with due time past, then the register shows Overdue and the filter lists it, with the job not yet run. | Unit |
| AC-SIL-012 | Given a failed upload, then typed text is kept and a retry is offered. | Unit |
| AC-SIL-013 | Given legacy issues with null new columns, then list, detail and analytics render as before. | Unit (existing tests stay green) |
| AC-SIL-014 | Given the journey raised → assigned → late → escalated → closed with proof, then the end state is Closed with `closed_at` and a close photo. | E2E (one journey, job invoked by a test hook) |

## 4. Open questions
1. Confirm "extend Incidents, one record" (vs a separate issue record beside it). Safety incidents and site issues may need different severity scales and visibility.
2. Is close-proof required only for High/Critical (proposed) or always for issues on a work order?
3. Who escalates to: the project's PM only, or also the assignee's line manager (profiles hierarchy exists, 0179)? Proposed PM (+ Admin fallback).
4. Escalation cadence: once at due time (proposed), or repeated daily until closed?
5. Channels: in-app notification only (proposed) or also Telegram/email (0083 vault exists)? Outbound channels are a separate ruling.
6. Should the `incidents` UI switch stay off by default for new orgs? The feature must be reachable for site work: confirm its plan placement.
7. "Location" stays free text; should it also accept a stock location (yard/staging, #2523)? Proposed no in v1.
8. Bucket: new `incident-files` bucket with the issue's read rule.

## 5. Out of scope
Safety-incident regulatory reporting, root-cause workflows, SLA analytics, recurring issues, outbound email/Telegram.

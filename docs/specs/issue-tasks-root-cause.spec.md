# Spec: Several tasks per issue and a root-cause field (#2677)

**Status:** built (phase 2); owner-approved design. IDs `FR-ITR-###`, `AC-ITR-###`. Plan: `docs/plans/2026-11-21-issue-tasks-root-cause.md`. Size S. Extends `docs/specs/site-issue-log.spec.md` (FR-SIL-030/031) and the shipped site issue log (#2521; migrations 1026-1028, 1112). Task creation is a permission rule, so it stays database-enforced (security-definer RPC, pgTAP, mutation check). Not a money path.

## Job story

When an issue needs actions from different departments, I want several tasks on it and the root cause recorded apart from the visible blocker, so closing the blocker does not hide the cause.

## Context and prior art

- Today one issue has at most one task: `incident_reports.task_id uuid unique` (1026), written only by `create_task_from_incident` (1028) under the transaction-local flag `pmo.incident_task_link`; a second call is refused (`23505`, "this issue already has a task"). The existing pgTAP file `supabase/tests/0979_site_issue_log.test.sql` pins that refusal and "exactly one task was made", and the detail page shows one task link.
- Prior art searched (`scripts/prior-art.sh "record-linked" / "task_id" / "create_task_from_incident"`, plus `docs/specs`, `docs/plans`, remote branches). The generic record-to-task link (#2587, spec `record-linked-tasks.spec.md`) exists only on the unmerged branch `feat/2587-record-linked-tasks` (migrations 1070/1071). It is not reusable here: it adds one typed column per record on `tasks` for purchase, claim and material request only (no issue), and it enforces **one open task per record**, the opposite of this ticket. It also rewrites `enforce_assignee_status_only`, so a second change to the same guard would collide. This spec therefore adds its own small link and does not wait for or depend on #2587. If #2587 later wants issues, it can read this link.
- Root cause: no column exists (`root_cause` found nowhere in migrations, app or specs). `close_note` (1026) records how it was closed, `action` what to do; neither is the cause.

## Definitions

- **Issue task**: a task linked to an issue through the issue-task link below. One issue has zero or many; one task belongs to at most one issue.
- **Root cause**: free text on the issue, separate from `description` (the visible problem), `action` (what to do) and `close_note` (how it ended).

## Requirements (EARS)

**Several tasks**
- FR-ITR-001 The system shall store the issue-to-task link in a new table `incident_tasks (incident_id, task_id, org_id, created_by, created_at)`, surrogate `id` primary key, `(incident_id, task_id)` unique, `task_id` unique (a task serves one issue), both foreign keys `on delete cascade`; `org_id` stamped by the existing org-default/trigger, never sent by a client.
- FR-ITR-002 When a manager (Admin, Executive, Project Manager, Finance) in an organisation with the `incidents` entitlement on calls the new RPC `add_task_to_incident(p_incident, p_name, p_assignee, p_due_date)`, the system shall create one task in the issue's project and link it, in one transaction, any number of times per issue (up to 100 per issue: a technical abuse bound with a clear refusal, not a client process limit and not a setting).
- FR-ITR-003 If the caller is not a manager, the issue is not in the caller's organisation (same message as missing), the entitlement is off, the issue has no project, the name is empty, or the assignee is not an active member of the organisation, then the RPC shall refuse and create nothing. Closed issues accept no new task.
- FR-ITR-004 No client role shall hold insert, update or delete on `incident_tasks`; rows are written only by the RPC and the trigger in FR-ITR-005, so a client cannot link or unlink a task.
- FR-ITR-005 Where an issue already has a legacy `incident_reports.task_id`, the system shall keep it readable and unchanged, backfill one `incident_tasks` row per such issue at migration time, and add the same row whenever `create_task_from_incident` sets `task_id` (an after-update trigger on `incident_reports`). `create_task_from_incident` and its "second attempt refused" rule stay exactly as they are; additional tasks go through the new RPC only. What an existing issue shows is unchanged (the one task it had).
- FR-ITR-006 The system shall let a reader of the issue (the existing `incident_reports` read rule: same organisation, active member, `incidents` entitlement on) read its `incident_tasks` rows, and shall list an issue's tasks in creation order. Reading a task's own fields follows the existing `tasks` row security; a task the caller cannot read shows as a plain "task" line with no name.
- FR-ITR-007 Closing an issue shall not close its tasks, and closing a task shall not close the issue (FR-SIL-031 stands for every task).

**Root cause**
- FR-ITR-008 The system shall add `incident_reports.root_cause text` (nullable, max 1000 characters).
- FR-ITR-009 The system shall let a manager, or the issue's assignee, set or change the root cause at any status including Closed; the reporter who is neither, and every other role, shall be refused by the existing issue guard (`guard_incident_issue_fields`, extended in the same migration). The root cause is never required to close an issue and never changes a closing rule.
- FR-ITR-010 When an issue has no root cause, every screen shall render as before (no empty label added to the register or the print).

**Screens**
- FR-ITR-011 The issue detail shall list all tasks of the issue (name, status, assignee, due day, link to the task) with an "Add a task" control shown by `can()` to the manager roles only, and a "Root cause" field next to the description, editable by the manager or assignee. The legacy "Make a task" button shows when the issue has no task and becomes "Add a task" once it has one.
- FR-ITR-012 English and Bahasa Indonesia strings; phone (390 px) and desktop (1440 px) layouts; `DESIGN.md` tokens and shared form primitives.

**Tenancy and history**
- FR-ITR-013 `incident_tasks` carries RLS and an isolation-probe fragment; every new definer function revokes execute from `public` and `anon`, and the RPC is granted to `authenticated` only. Every policy wraps helpers in `(select helper())` (`0646_rls_initplan`).

## Settings
None added. The existing per-organisation `incidents` entitlement and its plan defaults govern availability. The 100-task cap is a technical abuse bound, not client process.

## Acceptance criteria and owning layer

| ID | Given / When / Then | Layer |
|---|---|---|
| AC-ITR-001 | Given an issue with a project, when a manager calls `add_task_to_incident` twice, then two tasks exist in the issue's project, each linked once, with the given names, assignee and due day. | pgTAP |
| AC-ITR-002 | Given an Engineer and a user of another organisation, when they call the RPC, then 42501 and no task; given the entitlement off, a Closed issue, an issue with no project, an empty name, a foreign or inactive assignee, or a 101st task, then refused and nothing created. | pgTAP (mutation: drop the role check, the test goes red) |
| AC-ITR-003 | Given a client role, when it inserts, updates or deletes `incident_tasks` directly, then denied; the link survives. | pgTAP |
| AC-ITR-004 | Given an issue made before this change with a legacy `task_id`, then after migration its task is in `incident_tasks`, `task_id` is unchanged, and `create_task_from_incident` on a new issue adds its row; `supabase/tests/0979_site_issue_log.test.sql` passes untouched. | pgTAP |
| AC-ITR-005 | Given an issue with three tasks, when a reader of the issue lists them, then three rows in creation order; given a user of another organisation, none; given the entitlement off, none. | pgTAP |
| AC-ITR-006 | Given an issue, when a manager and then its assignee set the root cause, then each saves; when the non-assignee reporter (Engineer) or a non-assignee Engineer does, then refused; over 1000 characters refused; a Closed issue still accepts it. | pgTAP (mutation: let any role write it, the test goes red) |
| AC-ITR-007 | Given an issue with tasks, when the issue is closed, or a task is Done, then the other is unchanged. | pgTAP |
| AC-ITR-008 | Given legacy issues with a null root cause and one task, then the detail, register and print render as before (existing tests stay green untouched). | Unit |
| AC-ITR-009 | Given an issue with two tasks, when the detail renders, then both are listed with status and link; given a manager, "Add a task" shows and calls the repository; given an Engineer, it is hidden. | Unit |
| AC-ITR-010 | Given a manager or the assignee, when they edit the root cause and save, then the repository receives it and the value shows; given the reporter-only Engineer, the field is read-only. | Unit |
| AC-ITR-011 | Given the journey: manager opens an issue, adds a second task and records a root cause, closes the blocker, then both tasks and the root cause are still shown. | E2E (one journey) |

## Errors
| Condition | Result |
|---|---|
| Not a manager / foreign issue / entitlement off | 42501, one message, no existence hint |
| Issue has no project | 23514 "name the issue's project before making a task" (as today) |
| Issue Closed | 23514 "a closed issue takes no new task" |
| 101st task | 23514 "this issue has the most tasks it can take" |
| Root cause over 1000 | 23514 (check constraint) |
| Reporter-only writes root cause | 42501 (guard) |

## Owner questions
None. Choices taken (change if wrong): the assignee may write the root cause (they investigate); a Closed issue still takes a root cause (it is often found after); no new tasks on a Closed issue; no unlink in v1 (archive the task instead); legacy `task_id` kept as is, not dropped.

## Out of scope
Unlinking or moving a task between issues; root-cause categories or analytics; closing rules tied to tasks; changing the generic record-linked task design (#2587).

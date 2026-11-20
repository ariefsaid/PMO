# Spec: Tasks that follow a linked record (#2587)

**Status:** proposed; owner decisions below need sign-off before build. IDs `FR-RLT-###`, `NFR-RLT-###`, `AC-RLT-###`, `OD-RLT-#`. Plan: `docs/plans/2026-11-20-record-linked-tasks.md`. Executor: Director-dispatched Orca worker (Opus builder): it adds a trigger path that changes task status and a read that must respect another table's row security, so it gets the three reviewers and the security-auditor. Map #2516; after the 15 Dec go-live (Feb-Mar). No money movement and no change to any record's own lifecycle: the task only reads the record's status.

## Job story

When I hand someone a follow-up on a purchase, a request or a claim, I want the task to show that record's live status and close itself when the record reaches its end, so that nobody keeps chasing something already finished, and nobody opens a second task for the same thing.

## Context and boundary

- `tasks` (0001, 0140 model fields, 0199 project optional, 0206 meeting as second nullable parent) has statuses `To Do / In Progress / Done / Blocked` (`0001_init_schema.sql:23`), `archived_at`, `tombstoned_at`, `completed_at` stamped by trigger. Writers: Admin, Executive, Project Manager, Finance; the creator edits work fields; the assignee changes status only (`enforce_assignee_status_only`, last body in `0206_tasks_meeting_parent.sql`).
- `tasks.meeting_id` (0206) is the precedent for a linked parent: an explicit nullable FK column, a "caller may read the target" check when the link changes, and FK-block on hard delete. This spec follows `DD-TASK-1`: explicit columns, not a free `(type, id)` pair. (The `comments` table, 0249, is the one polymorphic table; it is not the precedent for task parents.)
- A task does not copy the record's status. The status shown is read live from the record. The only stored effect is the close.
- Out of scope: creating tasks automatically when a record is created; a task that follows a *project* or *meeting* (existing parents); changing any record's status from a task; notifications on close (OQ-RLT-2); external-ERP-owned records beyond what their own status already does.

## Definitions

**Linkable record types (v1, an enumerated allow-list).** Adding a type is a migration plus a row here, never a free-text type.

| Type (task column) | Table | Status column | End states (close the task) | Not end (task stays open) | Source |
|---|---|---|---|---|---|
| Purchase (`procurement_id`) | `procurements` | enum `procurement_status` | `Paid`, `Cancelled` | `Draft`, `Requested`, `Approved`, `Rejected` (returned to the requester, can go back to Draft), `Vendor Quoted`, `Quote Selected`, `Ordered`, `Received`, `Vendor Invoiced` | `0001_init_schema.sql:16-18`, `0002_rls.sql:122`; rework path `pmo-portal/src/lib/procurement/mainAction.ts:68`; list model already buckets `Paid/Rejected/Cancelled` as done (`listModel.ts:92`), which is a display grouping, not an end state (OD-RLT-1) |
| Expense claim or advance (`expense_claim_id`) | `expense_claims` | enum `expense_claim_status` | `Paid`, `Cancelled` | `Draft`, `Submitted`, `Approved`, `Rejected` (returns to `Draft`) | `0247_expense_claims.sql:44`, legal moves at `:389-396` (`Paid` and `Cancelled` have none) |
| Material request (`material_request_id`) | `material_requests` | text, check | `fulfilled`, `rejected`, `cancelled` | `draft`, `pending`, `approved` (a cancelled transfer leaves it `approved`) | `1000_material_requests.sql:72-73`; moves in `1001_material_request_rpcs.sql` |

**Deliberately not linkable in v1** (OD-RLT-2): progress claims (`progress_claims`, 0250) have no status column, only `withdrawn_at`; time-and-material claims (`tm_claims`, 0516) have `Draft / SignedOff / Withdrawn`. Both can be added later by the same pattern once the owner wants them.

- **Open task**: `status <> 'Done'` and `archived_at is null` and `tombstoned_at is null`.
- **Link**: at most one of the three record columns set on a task.
- **Readable record**: a record the calling user can select under that table's own row security. Expense claims are readable only by the claimant and spend approvers (`0247_expense_claims.sql:268-270`); purchases and material requests by every active member of the organisation, except that an Engineer's purchase read is narrowed by `procurements_engineer_read_scope` (`0350_engineer_purchasing_scope.sql:27`). The task never widens these.
- **System close**: the status change to `Done` made by the database when a linked record reaches an end state, as opposed to a person's edit.

## Requirements (EARS)

**Linking**
- FR-RLT-001 The system shall let a task carry at most one record link, to a purchase, an expense claim or advance, or a material request, through its own nullable FK column (ownership: same-organisation check as `0206`).
- FR-RLT-002 When a link is set or changed, the system shall require that the caller can read the record, and that the record is in the task's organisation and, when both name a project, the same project. Otherwise refuse with a message that does not say whether the record exists.
- FR-RLT-003 If the record is already in an end state when a link is set, the system shall refuse the link.
- FR-RLT-004 The creator may set the link on their own task; Admin, Executive, Project Manager and Finance may set or clear it on any task; the assignee may not change it. `can()` mirrors this; the database enforces it.
- FR-RLT-005 A link shall FK-block hard delete of the record while any task names it ("in use", `23503`); clearing the link or archiving the task releases it.

**One open task per link**
- FR-RLT-006 The system shall refuse a second open task for the same record link, whoever creates it and through whichever path (form, agent, import). The refusal names the existing task.
- FR-RLT-007 A task that is `Done`, archived or tombstoned shall not count; a new task may then be created for the same record.
- FR-RLT-008 The create-from-record action shall open the existing task when one is open, rather than offering a second.

**Live status**
- FR-RLT-009 The system shall show, wherever a task is listed or opened, its linked record's type, number or label, and current status, read live (never copied onto the task).
- FR-RLT-010 When the caller cannot read the linked record, the system shall show only the record type and "linked record you cannot view": no number, title, amount, status or end-state flag. The task itself stays readable by its own rules.
- FR-RLT-011 The linked status shall be read by a security-invoker read so the record table's own row security decides what is returned; it shall not be a security-definer lookup that reads the record on the caller's behalf.

**Auto-close**
- FR-RLT-012 When a linked record's status changes to an end state, the system shall, in the same transaction, set every open task linked to it to `Done` and stamp `completed_at` as any other Done does.
- FR-RLT-013 The close shall be done by the database (an after-update trigger on each linked table), not by the browser or a scheduled sweep, and shall fire for every writer of the record: a user, a record RPC, or a service-role sync.
- FR-RLT-014 The close shall succeed whoever changed the record, including a user who may not edit the task, and shall not be reproducible by a client setting a session value or calling a function directly.
- FR-RLT-015 The system shall record on the task why it closed (record type and end state) and when, and the close shall appear in the task's record history with no human actor (system). A task closed by a person shows no such reason.
- FR-RLT-016 A status change that is not to an end state shall not touch the task. Moving between end states, or an update that does not change status, shall not re-close or alter a `Done` task.
- FR-RLT-017 A system close shall count as an ordinary `Done` for rollups, My Tasks and reminders. It shall not bypass any rule that still applies to a person closing the task (see FR-RLT-019).

**Reopen**
- FR-RLT-018 If a linked record later leaves an end state, the system shall not reopen the task (OD-RLT-3). A new task for the record is allowed (FR-RLT-007).

**Interaction**
- FR-RLT-019 A task that requires proof before Done (`task-work-order-proof.spec.md`, FR-TWOP-010) shall not also carry a record link, and the reverse; whichever ships second adds the exclusion.

**Access and tenancy**
- FR-RLT-020 The link columns are `org_id`-scoped through the task; no client sends `org_id`. Registering link and close columns for record history (`record_history_config`) is part of the change.
- FR-RLT-021 Link actions are registered in the role matrix and gated by `can()` on the real JWT role; row security and the trigger are the authority.

## Non-functional requirements
- NFR-RLT-001 The live status for a page of tasks is one query for the page (batch read by task ids), indexed on the link columns; no per-row request.
- NFR-RLT-002 The close touches only open tasks of that record through the partial index; a record update that does not change status costs no task read.
- NFR-RLT-003 Phone-usable; `DESIGN.md` tokens; English and Bahasa Indonesia; status labels reuse the record's own translated labels.
- NFR-RLT-004 No new table in v1 and no new client write grant beyond the three columns.

## Acceptance criteria and owning layer

| ID | Given / When / Then | Layer |
|---|---|---|
| AC-RLT-001 | Given an engineer who created a task and can read a purchase, when they link it, then it saves; given a record they cannot read, then refused with the same message as a missing record. | pgTAP |
| AC-RLT-002 | Given an open task linked to a record, when anyone creates another open task for it, then refused naming the first; after the first is `Done`, archived or tombstoned, a new one is accepted. | pgTAP |
| AC-RLT-003 | Given an open task per type, when each record moves to each of its end states in the table above, then the task becomes `Done`, `completed_at` is set, and the reason is stored. | pgTAP |
| AC-RLT-004 | Given tasks linked to an expense claim, when it moves `Submitted`, `Approved`, `Rejected`, a purchase `Rejected`, and a material request `approved`, then no task changes. | pgTAP |
| AC-RLT-005 | Given a Finance user who may not edit the task, when they mark the claim `Paid`, then the task closes; given any client that sets a session value or calls the close function directly, then no task changes. | pgTAP (with mutation check) |
| AC-RLT-006 | Given a record already `Paid`, when a link to it is set, then refused. | pgTAP |
| AC-RLT-007 | Given a user who sees the task but cannot read the claim, when the live-status read runs, then it returns the type and "cannot view" and no number, status or amount; given a claimant, then the full status. | pgTAP (owner: read function); also referenced: Unit (render) |
| AC-RLT-008 | Given a user in another organisation, when they link, read or are closed through a link, then refused, nothing returned, and a record id of another organisation is never accepted. | pgTAP |
| AC-RLT-009 | Given a task with two record columns set, when saved, then refused. | pgTAP |
| AC-RLT-010 | Given a system close, when history is read, then it shows the status change with a system actor and the reason; a person's close shows the person and no reason. | pgTAP |
| AC-RLT-011 | Given a record that leaves an end state (where the machine allows), when read, then the task stays `Done` and a new task for the link is accepted. | pgTAP |
| AC-RLT-012 | Given a proof-required task, when a link is set (and the reverse), then refused. Landed with whichever of #2531 or this ships second. | pgTAP |
| AC-RLT-013 | Given a hard delete of a record with an open or Done linked task, then blocked "in use"; after the link is cleared it succeeds. | pgTAP |
| AC-RLT-014 | Given a task with a readable linked record, when rendered in a list and on its detail, then it shows type, number and status chip; given an unreadable one, only "linked record you cannot view"; given a closed task, the closing reason. | Unit |
| AC-RLT-015 | Given the create-from-record action with an open task already present, when pressed, then it opens that task and offers no second; given none, it prefills the link. | Unit |
| AC-RLT-016 | Given a task-writing role, an engineer and a viewer, when the link control renders, then `can()` shows it to the first two for their own scope only and hides it from the viewer. | Unit |
| AC-RLT-017 | Given an expense claim with a linked task, when Finance pays the claim, then the task shows `Done` with the closing reason in My Tasks for its assignee. | E2E (one journey) |

Hand check for AC-RLT-003: three records and three tasks, one per type; move expense claim `Draft -> Submitted -> Approved -> Paid`; after the third move that task alone is `Done`, the other two stay open.

## Errors
| Condition | Result |
|---|---|
| Second open task for the same link | Refused, names the existing task; UI opens it |
| Record unreadable or missing at link time | Same message for both: "choose a record you can open" |
| Record already in an end state at link time | Refused: "this record is already finished" |
| Two link columns set | Field error |
| Hard delete of a linked record | `23503`, shown as "in use" |
| Record deleted or hidden after linking | Task shows "linked record you cannot view"; never an error |

## Owner decisions (recommended defaults, not rulings)
| ID | Decision and default | If wrong, what breaks |
|---|---|---|
| OD-RLT-1 | Purchase end states are `Paid` and `Cancelled` only; `Rejected` is not an end state because the requester can rework it. | If `Rejected` closes tasks, a returned purchase loses its follow-up while still being worked; if `Paid` alone is wanted, a cancelled purchase leaves a task nobody can finish. |
| OD-RLT-2 | v1 types: purchase, expense claim or advance, material request. Progress claims and time-and-material claims are later. | Teams asking to follow a billing claim must wait for a second migration. |
| OD-RLT-3 | A record leaving an end state does not reopen the task; people create a new one. | Auto-reopen can collide with a new open task for the same link and surprises whoever finished it. |
| OQ-RLT-1 | Should "claim" include progress or time-and-material billing claims at launch (needs a status concept first)? Default no. | The word "claim" in the ticket is read as expense claims only. |
| OQ-RLT-2 | Notify the assignee when the system closes their task? Default no (the close is visible in My Tasks and history). | A silent close is missed by someone who does not open the list. |
| OQ-RLT-3 | Should a closed task keep its link visible forever? Default yes (read-only history). | Losing the link loses why it closed. |

## Delivery checklist
- [ ] Owner signs OD-RLT-1..3, answers OQ-RLT-1..3.
- [ ] Migration and pgTAP first (AC-RLT-001..013), then data access, then screens.
- [ ] Glossary: record-linked task, end state, system close, open task.
- [ ] ADR candidate recorded in the plan; no ADR file until the owner signs.

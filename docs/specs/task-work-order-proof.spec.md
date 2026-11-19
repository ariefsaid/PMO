# Tasks per work order, with proof of completion (TWOP)

Issue #2531 (map #2516, blocked by #2517). Status: **Draft, 2026-11-20**. Executor on sign-off: Orca worker
(`docs/orca-dispatch.md`); because it changes who can mark a task Done through RLS-adjacent triggers, it gets an Opus
builder, the three reviewers and the security-auditor. Plan `docs/plans/2026-11-20-task-work-order-proof.md`.
IDs: `FR-TWOP-###`, `AC-TWOP-###`. **Not a money path.**

**Job story.** When a site task belongs to a work order, I want to see it from that work order and require a photo or
document before it can be closed, so "done" on site means there is evidence.

## 1. AS-IS
- `tasks` (0001, 0140 model fields, 0199 first-class: `project_id` nullable; 0442 reminders). Statuses
  `To Do / In Progress / Done / Blocked`. Writers: Admin, Executive, Project Manager, Finance (`tasks_insert/update`);
  the assignee may change only status through `tasks_update_own_status` + a guard trigger (0146). A project-less task
  is allowed; milestone requires a project (FR-FCT-004).
- Files are stored per parent in typed child tables with a private bucket and storage RLS (0028 procurement files,
  0025/0391 project documents). Tasks have no attachment table.
- `tasks.work_order_id` does not exist. Listing by work order is impossible today.

## 2. Requirements (EARS)

**Link**
- FR-TWOP-001 A task shall carry an optional `work_order_id`. A work order must be of the task's own project and org;
  a project-less task cannot name one. A Cancelled work order takes no new tasks (existing links stay).
- FR-TWOP-002 Setting or clearing the link is a structure edit: same roles as other structure edits; an assignee
  cannot relink their task.
- FR-TWOP-003 The tasks list and project tasks view shall filter by work order (including "none"); the work-order
  page lists its open tasks (status not Done, not archived) with assignee and due date.
- FR-TWOP-004 Moving a task to another project while it names a work order shall be refused with a message naming the way out (clear the work order).

**Proof**
- FR-TWOP-010 A task shall carry `proof_required boolean not null default false`. It is set by the same roles as FR-TWOP-002.
- FR-TWOP-011 A task shall hold zero or more proof attachments (photo or document): file, uploader, time. Attachments are
  readable by anyone who reads the task and addable by the assignee and the structure-edit roles.
- FR-TWOP-012 While `proof_required` is true and the task has no live proof attachment, the system shall refuse any
  change of status to Done **in the database** (trigger covering both the assignee policy and the structure-edit policy)
  with a classifiable error; the UI disables the control and says why.
- FR-TWOP-013 When the last proof attachment of a Done task is removed, the task shall not silently stay Done: removing it
  is refused unless the task is first reopened. Proof attachments of a Done proof-required task are append-only.
- FR-TWOP-014 Turning `proof_required` off or on for an already Done task shall not change its status.
- FR-TWOP-015 Attachments shall be capped at 10 per task, 15 MB each, image/PDF/Office types (reuse the document
  type allowlist); storage reads follow the task's own read rule.
- FR-TWOP-016 Adding and removing proof writes an audit row. Photo capture works from a phone camera input.

**Surfaces**
- FR-TWOP-020 Every new string is English and Bahasa Indonesia; the control states (required, attached, missing) have copy.

## 3. Acceptance criteria

| AC | Given / When / Then | Owning layer |
|---|---|---|
| AC-TWOP-001 | Given a task of project P and a work order of P, when linked, then it saves; of project Q, then refused (23514). | pgTAP |
| AC-TWOP-002 | Given a project-less task, when linking a work order, then refused. | pgTAP |
| AC-TWOP-003 | Given an assignee Engineer, when they set `work_order_id` or `proof_required`, then refused. | pgTAP |
| AC-TWOP-004 | Given proof_required and no attachment, when a PM or the assignee sets Done, then refused; with one attachment, Done succeeds. | pgTAP (mutation-check: remove the trigger check → red) |
| AC-TWOP-005 | Given a Done proof-required task with one attachment, when that attachment is removed, then refused until reopened. | pgTAP |
| AC-TWOP-006 | Given a task of another org, when an attachment is added or read, then denied; storage object likewise. | pgTAP |
| AC-TWOP-007 | Given tasks on three work orders, when filtering by one, then only its tasks list; "none" lists unlinked. | Unit (repository + page) |
| AC-TWOP-008 | Given a proof-required task without proof, when the assignee opens it, then Done is disabled with the reason; after uploading a photo it enables. | Unit (RTL) |
| AC-TWOP-009 | Given a work order with two open and one Done task, when I open its page, then it lists two. | Unit |
| AC-TWOP-010 | Given a phone, when the assignee taps Add photo, then the camera input is offered and the upload completes to Done in one journey. | E2E (one journey) |
| AC-TWOP-011 | Given a task moved to another project while linked, then refused with the "clear the work order" message. | pgTAP |
| AC-TWOP-012 | Given an 11th or oversized or disallowed file, then refused with its reason. | Unit + pgTAP (count) |

## 4. Open questions
1. Is proof *photo or document* only, or may a note count? Assumed attachment only.
2. Should an approver confirm the proof (Done → reviewed), or is the attachment enough? Assumed enough; approval is a separate ticket.
3. Subtasks: does a parent with proof_required need proof of its own, or its children's? Assumed its own.
4. Existing Done tasks stay Done when `proof_required` is turned on later (FR-TWOP-014). Confirm.
5. Org-level default "proof required for tasks on work orders"? Assumed none in v1.
6. Bucket: reuse `project-documents` with a `tasks/` path, or a new `task-proofs` bucket? Proposed new bucket for its own read rule; needs the storage-policy review (0391).

## 5. Out of scope
Meeting action items, recurring tasks, proof for subtasks of ERP-owned projects (`project_domain_externally_owned` keeps blocking writes).

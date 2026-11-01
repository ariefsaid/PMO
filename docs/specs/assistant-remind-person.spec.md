# Spec: Assistant "Remind this person" for overdue work (#1639)

**Spec ID prefix:** RMD
**Issue:** #1639 (from #1594; map #791)
**Owner ruling:** OD-GRILL-20261101, "Assistant reminders (#1594)" (`docs/decisions.md`): *build a confirmed "Remind this
person": the assistant proposes, the user confirms, the recipient gets an in-app notification; same org, active member,
daily cap.* This **supersedes** the "reminders to others are out" clause of DD-AIN-1..9 (#787) for this one action; every
other DD-AIN ruling stands (overdue = DD-AIN-1, visibility by role = DD-AIN-2, server-written overdue list = DD-AIN-7,
eval bar 9 of 10 = DD-AIN-9, re-affirmed for the reel journeys by OD-GRILL-20261101 "Evals (#1596)").
**ADR refs:** ADR-0044 §5 (notifications inbox), ADR-0079 (coarse tools, server-resolved proposals), ADR-0050 (layered
prompt), ADR-0052 (eval harness), ADR-0051 (approval predicate), ADR-0039 (deputy + untrusted-output boundary),
ADR-0016 (`can()` is UX only), ADR-0019 (server-enforced rules via security-definer RPC + pgTAP), ADR-0010 (test pyramid),
ADR-0001 (`org_id` seam).
**Plan:** `docs/plans/2026-11-01-assistant-remind-person.md`
**Status:** Draft, 2026-11-01, reviewed 2026-11-01 (spec + security lens; fixes applied). Author: spec worker for the Director.
**Lane:** auth-adjacent (a new cross-user write path through a SECURITY DEFINER RPC) → Director-dispatched, ships alone.
Not a money path. Migration **0434** (Lane A range for #1639: 0434-0436).

---

## 1. Context and job story

**Job story.** When the assistant shows me overdue work and some of it belongs to other people, I want to send those
people a reminder with one confirmation, so the overdue answer ends in action instead of me chasing each person myself.

**What ships today** (read on `origin/dev` at `6440a961`):

- `whats_overdue` is the one coarse read for "what's overdue?" (`supabase/functions/agent-chat/overdue.ts:1-7`). It
  reads tasks under the caller's JWT, scoped by role (Engineer own tasks; PM managed projects plus own; others the whole
  org; `overdue.ts:78-89`), resolves each task's assignee name (`overdue.ts:94-98`), and renders the list on the server
  (`renderOverdueMarkdown`, `overdue.ts:216-253`, assignee shown as `· <name>`, `overdue.ts:229`). The model-facing
  receipt drops task ids (`buildOverdueModelResult`, `overdue.ts:176-205`, ids stripped at `overdue.ts:202`).
- `notify` writes only to the caller's **own** inbox (`supabase/functions/agent-chat/actions.ts:387-420`; owner pinned by
  the column default, `actions.ts:403-416`; ADR-0044 §5 "v1 has no cross-user notify path").
- The in-app inbox is shipped: `public.notifications` (`supabase/migrations/0048_agent_automations_notifications.sql:67-79`)
  with owner-only RLS (`0048:114-129`) and a mark-read-only column pin (`0048:134-152`); the bell
  (`pmo-portal/src/components/shell/NotificationBell.tsx`) deep-links `metadata.entity`, and an entity of type `task`
  opens **My tasks** (`NotificationBell.tsx:63-68`).
- **Cross-user in-app notifications already exist** through one internal SECURITY DEFINER helper,
  `public.notify_workflow_user(p_org, p_owner, …)` (`supabase/migrations/0237_workflow_notifications.sql:13-25`). It writes
  a `notifications` row for another user only when that user is in the record's org, is an active member
  (`is_active_member(uuid)`, `supabase/migrations/0180_rpc_active_member_gate.sql:133-143`, includes the ban check) and
  is not the acting user; no client role may execute it (`0237:26`). Task assignment and comment mentions use it
  (`0237:95-108`, `supabase/migrations/0249_comments.sql:72-95`). **This feature reuses that helper and the bell; it adds
  no new notification table, channel or UI.**
- Confirmed agent writes follow one pattern: a `confirm: true` action is validated, optionally **prepared on the server**
  (ADR-0079 §2), shown as a needs-approval chip, and the stream ends (`supabase/functions/agent-chat/handler.ts:1035-1088`);
  on approve the handler re-validates the **prepared** value (`validatePrepared`), re-derives the caller's org and role,
  and only then executes under the caller JWT (`handler.ts:1698-1792`). An action with `prepare` always chips
  (`handler.ts:1074`). `draft_invoice` is the reference (`supabase/functions/agent-chat/draftInvoice.ts:563-580`).
- Tasks are readable org-wide by active members (`tasks_select`, `supabase/migrations/0002_rls.sql:91`; active-member
  conjunct noted at `0249_comments.sql:36`), and each task has one `assignee_id`.

So the gap is exactly one thing: a confirmed, server-enforced way for a user to put a reminder in **another** member's
inbox about an overdue task.

## 2. Scope

**In**
- A new assistant write action, `remind_overdue`, proposed by the assistant and executed only after the user confirms the
  chip. One chip may carry up to 10 reminders (one per overdue task) so "remind whoever is late" is one confirmation.
- A SECURITY DEFINER RPC that sends the reminders and enforces every rule (same org, active recipient, not the sender,
  overdue and open, per-task de-duplication, per-sender daily cap), a read-only preview RPC the proposal uses, and a
  sender-readable ledger table.
- The recipient gets one in-app notification per task through `notify_workflow_user`, deep-linking to My tasks.
- Prompt tool-index line + one "Use when…" skill (ADR-0050), a server-written offer line on the overdue answer, and an
  eval suite on the deployed model (ADR-0052).

**Out of scope**
- Reminders about **invoices**. An overdue sales invoice has no single in-org owner to remind (the debtor is outside the
  org). Follow-up only if the owner names a recipient rule.
- Email, chat or push delivery. ADR-0044's channel seam stays as is; in-app only.
- A free-text message from the sender (see OQ-4); the reminder text is server-written.
- Reminding about work that is **not overdue**, about tasks with no assignee, or any non-task record.
- Automations sending reminders to other people on a schedule (ADR-0044 automations stay owner-only recipients).
- A reminder button in the task UI outside the assistant. (Possible later; the RPC is reusable.)
- Recipient preferences (mute, digest). The cap and de-duplication bound volume in v1.

## 3. Terms

- **Sender** — the signed-in user who confirms the chip (real JWT identity; impersonation is view-only, ADR-0008).
- **Recipient** — the task's current `assignee_id`, derived **on the server** from the task row. Never supplied by the
  model or the client.
- **Overdue task** — DD-AIN-1: status To Do / In Progress / Blocked, end date before today in the sender's zone (profile
  zone, else the org's default zone, else UTC), not archived, not tombstoned.
- **Reminder** — one ledger row plus one notification, for one (task, recipient) pair.
- **Window** — the rolling 24 hours before the send (OQ-2).

## 4. Functional requirements (EARS)

### Proposal (assistant)

- **FR-RMD-001** (event) When the user asks the assistant to remind, chase, nudge or follow up the people whose work is
  late, the assistant shall call `remind_overdue` and show one approval chip; it shall not send anything before the user
  approves.
- **FR-RMD-002** (ubiquitous) `remind_overdue` shall take at most one argument, `task` (a task name the user mentioned);
  with no argument it shall cover every overdue task in the sender's `whats_overdue` scope (DD-AIN-2) whose assignee is
  someone other than the sender.
- **FR-RMD-003** (ubiquitous) The proposal shall be resolved on the server under the sender's JWT before the chip
  (ADR-0079 §2): the chip shall list, for each reminder, the recipient's name, the task name and its due date, and the
  approved value shall carry task ids only as the instruction to send (any names it also carries are display copies the
  send never trusts, FR-RMD-013).
- **FR-RMD-004** (conditional) If `task` matches more than one remindable overdue task, then the action shall return the
  candidates (as `draft_invoice` does) so the assistant asks the user to pick; if it matches none, the action shall say
  so and show no chip.
- **FR-RMD-005** (conditional) If no task in scope is remindable (all are the sender's own, unassigned, already reminded
  in the window, or their assignee is not an active member), then the action shall return a plain explanation and show
  no chip.
- **FR-RMD-006** (conditional) If the sender's remaining daily allowance is smaller than the number of remindable tasks,
  then the proposal shall include only as many reminders as remain, oldest due date first, and the chip text shall say
  how many were left out; if none remain, the action shall say the daily limit is reached and show no chip.
- **FR-RMD-007** (ubiquitous) A single proposal shall carry at most 10 reminders.
- **FR-RMD-008** (event) When the user rejects the chip, nothing shall be sent and no allowance shall be used.

### Sending (server-enforced, ADR-0019)

- **FR-RMD-010** (event) When an approved `remind_overdue` executes, the handler shall call the send RPC under the
  sender's JWT with the approved task ids only.
- **FR-RMD-011** (ubiquitous) The send RPC shall refuse a caller who is not an active member of their org (42501), the
  same gate as other definer writers (`assert_is_active_member`, `0180:160-168`).
- **FR-RMD-012** (ubiquitous) For each task id, the send RPC shall derive the recipient from the task row and send only
  when all of these hold: the task is in the sender's org; it is overdue (§3) at the moment of sending; it has an
  assignee; the assignee is not the sender; the assignee is an active member of the same org; no reminder for the same
  task and recipient was sent by anyone in the window; and the sender has allowance left.
- **FR-RMD-013** (ubiquitous) The send RPC shall report a per-task outcome, one of `sent`, `not_found`, `not_overdue`,
  `no_assignee`, `self`, `recipient_inactive`, `already_reminded`, `daily_limit`, and shall not raise for an item-level
  refusal, so one stale item never blocks the rest. Each outcome shall carry the task name and, when sent, the
  recipient's name, read on the server; the assistant's report of what was sent shall use these, never the replayed
  approved value (the client replays it, `handler.ts:1695-1700`).
- **FR-RMD-014** (ubiquitous) The per-sender cap shall be counted on the server from the ledger over the window, under a
  per-sender transaction lock so concurrent sends cannot exceed it. The default cap is 20 reminders per sender per window
  (OQ-1).
- **FR-RMD-015** (ubiquitous) The send RPC shall accept 1 to 10 task ids and the preview RPC 1 to 50 (the overdue list's
  fetch cap, so a proposal can skip tasks already reminded); either shall refuse any other count (22023). Duplicate
  ids are collapsed.
- **FR-RMD-016** (event) When a reminder is sent, the system shall insert one ledger row (org, sender, recipient, task,
  time) and one notification for the recipient, through `notify_workflow_user`, in the same transaction.
- **FR-RMD-017** (ubiquitous) The notification shall be severity `info`, titled "Reminder: a task is overdue", with a
  server-written body naming the sender, the task and its due date, and `metadata.entity = {type: 'task', id, label}` so
  the bell opens My tasks (`NotificationBell.tsx:63-68`).
- **FR-RMD-018** (ubiquitous) The preview RPC shall apply the same checks as the send RPC (one shared internal function)
  without writing anything, and shall return each task's outcome, the recipient's id and name for eligible tasks, and
  the sender's remaining allowance.

### Ledger visibility

- **FR-RMD-020** (ubiquitous) A sender who is an active member shall be able to read their own ledger rows in their own
  org; no other user, and no disabled or banned sender, shall read them, and no client role shall insert, update or
  delete them.

### Prompt and answer

- **FR-RMD-030** (where) Where `remind_overdue` is registered, the tool index shall carry one line for it and the prompt
  shall carry a "remind" skill whose trigger is the user asking to remind, chase, nudge or follow up people; where it is
  not registered, neither shall appear (ADR-0050 §1(b)). The prompt's question-mapping list shall place the remind line
  before the shipped "overdue, late … → `whats_overdue`" line and say it wins, because "remind whoever is late" also
  contains "late" (`prompt.ts:185`).
- **FR-RMD-031** (state) While the overdue answer lists at least one overdue task assigned to someone other than the
  caller, the server-written answer shall end with one line offering reminders (e.g. "Say *remind them* and I'll
  prepare reminders for the 2 people with late tasks."); the assistant shall not open a reminder chip unasked (OQ-3).
- **FR-RMD-032** (ubiquitous) A server-side kill switch shall remove `remind_overdue` from the catalog without a
  redeploy, default on, mirroring the invoice-drafts switch (`handler.ts:121-129`).

## 5. Non-functional requirements

- **NFR-RMD-SEC-001** The recipient is never model- or client-supplied; the only identifiers crossing the approval are
  task ids, and the RPC re-derives everything from them.
- **NFR-RMD-SEC-002** All reads in `prepare` run under the caller JWT (RLS is the row authority); the definer RPCs check
  org and active membership explicitly, because a definer body does not inherit the caller's RLS. The task-visibility
  check in the RPC mirrors `tasks_select` (org-scoped, active member); a change to `tasks_select` must change the RPC
  check too (⚑ MIRRORS comment in the migration, house style of `0237:36-37`).
- **NFR-RMD-SEC-003** The notification body is built on the server from stored fields; no model text reaches another
  user's inbox. Task and sender names are rendered as text by the bell.
- **NFR-RMD-SEC-004** The preview RPC returns information only about tasks in the caller's org, which the caller can
  already read, plus each eligible assignee's id and name (already visible to the caller through the overdue list).
- **NFR-RMD-PERF-001** The cap count uses an index on `(sender_id, created_at)`; de-duplication uses an index on
  `(task_id, recipient_id, created_at)`. One send is at most 10 items.
- **NFR-RMD-QUAL-001** Tool selection on the deployed model is proven by the eval suite at 9 of 10 runs per case
  (DD-AIN-9, OD-GRILL-20261101 "Evals"); prompt-text unit tests do not count as that proof (ADR-0052).
- **NFR-RMD-REV-001** The migration is reversible: a rollback file drops the RPCs, the internal check and the ledger.
- **NFR-RMD-I18N-001** No new UI string, so no locale keys (en/id). The notification title and body are stored
  server-written English, as every shipped workflow notification is (`0237`, shown raw by the bell). Localizing stored
  notification text is a follow-up for all notifications (§9).
- **NFR-RMD-CI-001** The ledger keeps service_role's default DML (pgTAP 0137); it is not an `*_erp_mirror` table (0136
  does not apply); both client RPCs join the 0178 retained set (+2) with anon and PUBLIC revoked, and the internal
  check is executable by no client role.

## 6. Acceptance criteria (Given / When / Then)

Roles below are placeholders ("the project manager", "the site engineer"); fixtures use synthetic ids.

**Server rules (pgTAP)**

- **AC-RMD-001** Given an overdue open task in org A assigned to the site engineer, an active member, When the project
  manager sends a reminder for it, Then the outcome is `sent`, the site engineer has exactly one new notification titled
  "Reminder: a task is overdue" whose `metadata.entity` is that task, and one ledger row records sender, recipient and task.
- **AC-RMD-002** Given an overdue task assigned to the project manager, When the project manager sends a reminder for it,
  Then the outcome is `self` and no notification or ledger row is written.
- **AC-RMD-003** Given an overdue task in org B, When the project manager of org A sends a reminder for its id, Then the
  outcome is `not_found` and org B's assignee receives nothing.
- **AC-RMD-004** Given an overdue task assigned to a disabled member, and another assigned to a banned member, When the
  project manager sends reminders for both, Then both outcomes are `recipient_inactive` and nothing is written.
- **AC-RMD-005** Given the project manager has sent 20 reminders in the last 24 hours, When they send one more, Then its
  outcome is `daily_limit`; and Given those 20 were sent more than 24 hours ago, Then the same send is `sent`.
- **AC-RMD-006** Given someone reminded the site engineer about a task 2 hours ago, When the project manager sends a
  reminder for the same task, Then the outcome is `already_reminded` and no second notification is written.
- **AC-RMD-007** Given the sender's account is disabled, When they call the send RPC, Then it raises 42501.
- **AC-RMD-008** Given a task that is Done, another whose end date is today, and an overdue task with no assignee, When
  the project manager sends reminders for all three, Then the first two are `not_overdue` and the third is `no_assignee`.
- **AC-RMD-009** Given ledger rows sent by the project manager, When the project manager, the recipient and a member of
  org B each read the ledger, Then only the project manager sees them; Given a ledger row sent by a member who is now
  disabled, When that member reads the ledger, Then they see none; and any client insert, update or delete raises 42501.
- **AC-RMD-010** Given the anon role, Then it cannot execute either RPC; Given the authenticated role, Then it can execute
  both and cannot execute the internal check function.
- **AC-RMD-011** Given 11 task ids, or none, When the send RPC is called, Then it raises 22023; Given 51 task ids, When
  the preview RPC is called, Then it raises 22023.
- **AC-RMD-012** Given the same fixture as AC-RMD-001..006, When the preview RPC is called, Then it returns the same
  outcomes, the eligible recipient's name and the remaining allowance, and writes no ledger row and no notification.

**Assistant (Vitest, mocked)**

- **AC-RMD-013** Given an overdue list with one task of the caller's own, one unassigned and two assigned to others, When
  `remind_overdue` is prepared with no argument, Then the proposal carries exactly the two tasks assigned to others.
- **AC-RMD-014** Given `task: "pour"` matches two remindable tasks, Then the action returns both as candidates and no
  chip; given it matches none, Then it returns a plain refusal and no chip.
- **AC-RMD-015** Given the preview reports 1 remaining for 3 eligible tasks, Then the proposal carries the oldest-due one
  and the summary says 2 were left out; given 0 remaining, Then no chip and the reply says the daily limit is reached.
- **AC-RMD-016** Given a replayed approved value with an extra field, a non-uuid id, a duplicate or 11 items, When it is
  re-validated, Then it is rejected.
- **AC-RMD-017** Given an approved proposal whose replayed names were edited, When the action runs, Then it calls the
  send RPC with the task ids only (no recipient field) and reports each outcome with the names the RPC returned.
- **AC-RMD-018** Given the model calls `remind_overdue`, Then the handler emits `needs-approval` and the send RPC is not
  called until an approve decision arrives.
- **AC-RMD-019** Given the kill switch is on, Then the tool index line, the remind skill and the remind mapping line
  (before the overdue line) are present; given it is off, Then none is present. (Registration itself is the same
  module-level ternary as the invoice-drafts switch, `handler.ts:123-129`, read at import, so no unit test toggles it.)
- **AC-RMD-023** Given an overdue answer with two tasks assigned to two other people, Then the server-written answer ends
  with the offer line naming 2 people; given every task is the caller's own, Then there is no offer line.

**Deployed model (eval, ADR-0052; bar 9 of 10 runs each)**

- **AC-RMD-020** Given the eval fixture, When the user says "What's overdue? Remind whoever is late.", Then the run
  proposes `remind_overdue` including the fixture task assigned to another member and not the caller's own task.
- **AC-RMD-021** Given the eval fixture, When the user says "Remind the person on EVAL overdue task for reminder.", Then
  the run proposes `remind_overdue` with exactly that task.
- **AC-RMD-022** Given the eval fixture, When the user says only "What's overdue?", Then the run calls `whats_overdue`
  and proposes no reminder.

**Cross-stack (one curated e2e, ADR-0010)**

- **AC-RMD-024** Given the project manager sends a reminder about an overdue task assigned to the site engineer (the RPC
  call an approved chip makes), When the site engineer signs in, Then the bell shows an unread reminder naming the task,
  and opening it lands on My tasks.

## 7. Traceability (owning layer, ADR-0010)

| AC | Owning layer | File |
|---|---|---|
| AC-RMD-001..012 | pgTAP | `supabase/tests/task_reminders.test.sql` |
| AC-RMD-013..017 | Vitest | `pmo-portal/src/lib/agent/remindOverdue.test.ts` |
| AC-RMD-018 | Vitest | `pmo-portal/src/lib/agent/handlerRemind.test.ts` |
| AC-RMD-019 | Vitest | `pmo-portal/src/lib/agent/agentPrompt.remind.test.ts` |
| AC-RMD-023 | Vitest | `pmo-portal/src/lib/agent/overdue.test.tsx` |
| AC-RMD-020..022 | Eval (deployed) | `pmo-portal/evals/cases/remind-overdue.eval.ts` |
| AC-RMD-024 | E2E | `pmo-portal/e2e/AC-RMD-024-reminder-reaches-assignee.spec.ts` |

## 8. Open questions (each with a recommended default)

- **OQ-1 — Daily cap value.** Default: **20 reminders per sender per rolling 24 hours**, a constant in the RPC (no
  setting UI). 20 covers a project manager chasing a busy week (two full chips) while bounding noise.
- **OQ-2 — What "per day" means.** Default: **rolling 24 hours** (no time-zone edge, one indexed range count). Alternative:
  the sender's calendar day in their zone.
- **OQ-3 — Proactive chip or on request.** Default: **on request**: the overdue answer ends with a server-written offer
  line (FR-RMD-031) and the chip opens only when the user asks. A chip after every "what's overdue?" would end each
  overdue answer with an approval prompt and depend on the weak tool-selector to judge when to offer.
- **OQ-4 — Free-text note from the sender.** Default: **none in v1**; the body is server-written. A note would put
  model-composed text into another person's inbox (NFR-RMD-SEC-003).
- **OQ-5 — Who may send.** Default: **any active member**, limited by what they can see (tasks are org-readable) and by
  the cap. In practice an Engineer's overdue list holds only their own tasks (DD-AIN-2), so the assistant offers them
  nothing. Alternative: restrict to Admin, Executive, Project Manager, Finance (the `tasks_write` roles,
  `0002_rls.sql:93-97`).
- **OQ-6 — De-duplication scope.** Default: **one reminder per task and recipient per window, from anyone**, so two
  managers chasing the same person about the same task send one reminder. Alternative: per sender.
- **OQ-7 — Batch size.** Default: **10 per chip**, matching the overdue list's shown rows (`OVERDUE_LIST_SHOWN`,
  `overdue.ts:150`).

## 9. Follow-ups (not built here)

- A "Remind" button on the task row and My tasks, reusing the same RPC.
- Invoice reminders, once a recipient rule exists (OQ in §2 Out of scope).
- Recipient-side mute or daily digest.
- Localized notification text (stored English today for every notification, NFR-RMD-I18N-001).

# Spec: Material requests reach the approver (inbox entry and in-app notification) (#2685)

**Status:** approved (Director, 2026-11-21); built. IDs `FR-MRI-###`, `AC-MRI-###`. Plan: `docs/plans/2026-11-21-material-request-approver-inbox.md`. Map #2516. Builds on `docs/specs/material-requests.spec.md` (chain, pins, stand-ins, queue FR-MRQ-005..026) and reuses the existing notifications table and the `/approvals` page. Approval-adjacent: the recipient rule is enforced in the database; ships through a Director-dispatched worker.

## Job story

When a material request needs my approval, I want to be told and find it in my approvals inbox, so it does not wait unseen.

## Context and boundary

- Today the "waiting for me" queue lives only on the material-requests screen (`mrq_waiting_for_me`, FR-MRQ-017). The `/approvals` page lists procurement, timesheets, expense claims and customer invoices, and workflow hand-offs already write in-app notifications through `notify_workflow_user` (0237). Material-request steps do neither.
- "Awaiting a person" means the **open step** of a pending request, resolved by the existing chain rules: the step's role holders, or the pinned person where a live pin exists (FR-MRQ-022..026), plus in-window stand-ins (FR-MRQ-009), never the request's author, never someone who already decided another step of it (FR-MRQ-008).
- No decision logic changes. No existing function, policy or table behaviour is altered; the feature adds a setting, two helpers, three triggers and a UI section.

## Requirements (EARS)

**Setting**
- FR-MRI-001 The organisation shall have a setting "material request approvals appear in the approvals inbox and notify the approver", **default off**.
- FR-MRI-002 Only an Admin shall change it, through a server function that refuses every other caller; it is stored on the organisation's existing material-request settings row, written by no client directly.

**Notification (database-derived)**
- FR-MRI-003 While the setting is on, when a material-request step becomes the open step (submission, advance after an approval, resubmission after a return), the system shall write one in-app notification to each person who can decide that step now, and to no one else.
- FR-MRI-004 The recipient set shall be computed in the database from the step, the chain role, the live pin, the stand-in windows, the author and the earlier decisions on the request. No client call carries or influences a recipient; no client-callable function takes one.
- FR-MRI-005 The recipient set shall equal the set of people for whom the existing queue (`mrq_waiting_for_me`) lists that request, so the inbox, the notification and the decision rule never disagree.
- FR-MRI-006 When the step is decided (approved, returned, rejected), superseded, or the request is cancelled, its notifications shall be removed for every recipient.
- FR-MRI-007 When a pin or a stand-in is set, re-pointed or revoked while a step is open, the system shall add the notification for people who newly can decide it and remove it for people who no longer can.
- FR-MRI-008 A notification names the request number and the step label, links to the request, and is in the recipient's organisation only. A person who decides a step is never notified of the next step they cannot decide (earlier-decision rule). Someone who changes the setting, a pin or a stand-in is not excluded as such: they are notified when they are a legitimate approver of an open step.
- FR-MRI-014 When an Admin switches the setting on, the system shall run the same sync for every step open at that moment in that organisation (backfill). When it is switched off, the system shall delete this feature's unread step notifications for that organisation; read ones are kept.

**Approvals inbox**
- FR-MRI-009 While the setting is on, `/approvals` shall show a "Material requests" section and scope listing every open step the viewer can decide (the existing queue), oldest first, each row opening the request; counts, the "All pending" scope and the "caught up" state shall include it.
- FR-MRI-010 A viewer whose only waiting work is a material-request step shall not see "no access to approvals" while the setting is on.
- FR-MRI-011 When the step is decided, the row shall leave the inbox without a page reload.
- FR-MRI-012 The notification bell shall open the request from a material-request notification.
- FR-MRI-013 The Admin toggle shall be on the existing material-request settings screen, in English and Bahasa Indonesia; other roles do not see it.

## Settings

| Setting | Where | Default |
|---|---|---|
| Material request approvals in the approvals inbox and notifications | `material_request_settings.approver_inbox` (per organisation), toggled on the material-request settings screen by an Admin | **off** |

No other setting. The chain, pins and stand-ins stay as they are.

## Default-off statement

While the setting is off: no trigger writes a notification, `/approvals` renders exactly as today (no extra scope, query, count or text; the material-request queue is not even requested), the access check is unchanged, and the bell is unchanged. Existing organisations therefore see no change until an Admin turns it on. Existing tests are not edited; the Approvals page tests run with the setting reading off.

## Non-functional
- NFR-MRI-001 RLS and the `org_id` seam hold; no new table. The two helper functions and the triggers are not executable by `anon` or `authenticated`.
- NFR-MRI-002 The recipient scan is bounded to the organisation's holders of one role plus active stand-ins; no per-row loops over the whole organisation.
- NFR-MRI-003 New screen text in English and Bahasa Indonesia; section works at 390 px and 1440 px; `DESIGN.md` tokens only.

## Acceptance criteria and owning layer

| ID | Given / When / Then | Layer |
|---|---|---|
| AC-MRI-001 | Given a new organisation, then the setting is off; when an Admin turns it on it is stored and audited; when a non-Admin or another organisation's Admin tries, then refused with the Admin-only message. | pgTAP |
| AC-MRI-002 | Given the setting off, when a request is submitted and advanced, then no notification exists for anyone. | pgTAP |
| AC-MRI-003 | Given the setting on and a submitted request, then each active holder of step 1's role except the author has exactly one unread notification linking the request; holders of other roles, deactivated members and other organisations have none. | pgTAP |
| AC-MRI-004 | Given step 1 approved, then step 2's holders are notified and step 1's notifications are gone for all. | pgTAP |
| AC-MRI-005 | Given a live pin, then only the pinned person is notified; given a stuck pin (deactivated or lost role), then the role holders are. | pgTAP |
| AC-MRI-006 | Given an in-window stand-in for a role holder, then they are notified; out of window, revoked, or the author, they are not. | pgTAP |
| AC-MRI-007 | Given a person who decided step 1, when step 2 opens and they also hold its role, then they are not notified (matches the queue). | pgTAP |
| AC-MRI-008 | Given an open step, when it is returned, rejected, or the request cancelled, then its notifications are removed. | pgTAP |
| AC-MRI-009 | Given varied pins, stand-ins and earlier decisions, then the notified set equals the set whose `mrq_waiting_for_me` lists the request. Mutation check: drop the pin test or the earlier-decision test from the recipient helper, the test goes red. | pgTAP |
| AC-MRI-010 | Given an open step, when a pin is set to someone else, then the previous holders lose the notification and the pinned person gains it; same for a stand-in added then revoked. | pgTAP |
| AC-MRI-011 | Given an authenticated client, then it cannot execute the helpers, cannot insert a notification for another user, and no function accepts a recipient. | pgTAP |
| AC-MRI-012 | Given the setting on and open steps for the viewer, then `/approvals` shows "Material requests awaiting you (n)", oldest first, each row linking the request; the "All pending" scope and counts include it. | Unit |
| AC-MRI-013 | Given the setting off, then `/approvals` shows no material-request section or scope and does not request the queue. | Unit |
| AC-MRI-014 | Given a viewer with no procurement, timesheet or invoice access but a waiting step, when the setting is on, then they get the page, not "no access". | Unit |
| AC-MRI-015 | Given a row, when the step is decided, then the queue refreshes and the row is gone. | Unit |
| AC-MRI-016 | Given a material-request notification, when opened from the bell, then it opens that request. | Unit |
| AC-MRI-017 | Given an Admin and a non-Admin on the settings screen, then only the Admin sees the toggle; it calls the server function; labels exist in English and Bahasa Indonesia. | Unit |
| AC-MRI-019 | Given steps already open, when an Admin switches the setting on, then each gets its notifications for exactly the people who can decide it now (backfill). | pgTAP |
| AC-MRI-020 | Given unread step notifications, when an Admin switches the setting off, then they are all deleted for the organisation and later submissions notify no one. | pgTAP |
| AC-MRI-018 | Given the setting on, when a requester submits and an approver opens the approvals inbox, approves, then the entry and the bell notification are gone. | E2E (one journey) |


## Errors
| Condition | Result |
|---|---|
| Non-Admin changes the setting | Refused: Admin only |
| Queue read fails on `/approvals` | Section shows a retry state; other sections unaffected |
| Step has no one who can decide it | No notification; the existing "no approver" state applies |

## Out of scope
- Phone push, email or messaging-app delivery; reminders or escalation of an unattended step; re-notifying on a role change of a profile (the inbox stays correct because it reads the live queue).

## Mutation checks (to run in the wave proof; each must turn `supabase/tests/mrq_approver_inbox.test.sql` red, then be restored)
Each point is tagged `-- mut:` in the migration. Apply by editing the one line, `db reset`, run the file, expect the named failures, restore.

| Tag (file) | Break it by | Expected red |
|---|---|---|
| `recipient_author` (1336) | deleting `and p.id <> r.created_by` | AC-MRI-003, 006 (author stand-in), 019, 004 resubmission |
| `recipient_authority` (1336) | passing `null` instead of `v_pin` to `mrq_step_authority` | AC-MRI-010 pin re-point, 009 pin parity, 005 live pin |
| `recipient_twice` (1336) | prefixing the earlier-decision `if` with `false and` | AC-MRI-007, 009 earlier-decision parity |
| `setting_gate` (1336) | replacing `if public.mrq_approver_inbox_on(s.org_id) then` with `if true then` | AC-MRI-002, 020 |
| `setting_admin` (1335) | replacing the Admin test with `if false then` | AC-MRI-001 |

A first, partial run on the build machine (before the database gate was moved to the wave proof) saw `recipient_author`, `recipient_authority` (pin) and `recipient_twice` go red with the failures above, and the unmutated file pass 33/33; `setting_gate` and `setting_admin` were not run.

## Deliberate deviation (follow-up)
Notification wording is plain English written by the database, the same as every existing 0237 workflow notification. The `message_key` template guard (1025) is not changed, so a Bahasa Indonesia reader sees the English title and body in the bell. Templated, translated wording for workflow notifications is one follow-up for all of them, not for this feature alone.

## Delivery checklist
- [ ] Glossary: approvals inbox (material-request section), approver notification.
- [ ] Screenshots under `docs/evidence/1215/2685/` (phone 390, desktop 1440).

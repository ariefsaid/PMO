# CRM follow-up reminders (#1576)

**Status: UNSIGNED — recommendations only; owner decisions and sketch-glance required before implementation.** The plan is conditional on these decisions. Screen composition belongs to owner-held #806; this document does not approve a layout.

## Job and scope

When I promise to follow up on an opportunity or contact, I want to record when I must do it and see it in my inbox and pipeline, so that an aging opportunity has a concrete next action. #1576 requests a due-dated follow-up on a deal or contact, an inbox notification, and a needs-follow-up pipeline filter. Comparison §3b identifies the missing remedy for pipeline aging. A deal is the existing project/opportunity, not a new CRM entity.

## Owner decisions — recommended defaults, not rulings

1. **Recipient and visibility:** creator is the sole recipient and owner; no delegation or other-recipient sending in v1. Authorized users can see follow-ups on records they can read; only the creator, with current record write permission, can change or complete theirs. This avoids inventing a deal assignee and avoids exposing private reminders in the pipeline: the filter is **my** follow-ups.
2. **Lifecycle:** multiple open follow-ups per record; explicit Complete closes one; editing its due instant reschedules it. No snooze button, recurrence, or automatic completion on activity, stage change, or inbox read. A user can reschedule an open item; completed items remain history. A successful edit after notification makes a new delivery eligible at the new due instant.
3. **Time:** require date and time, interpreted in the browser's local time zone at entry and stored as a UTC instant; show local time with zone/offset. Reject invalid, nonexistent local times and past or current instants; on an ambiguous DST time require an explicit offset choice. Notification occurs on the first successful dispatch at or after the instant, with no delivery-time SLA during outages. One notification per due-date revision; failed transactions retry on later ticks. No email or push.
4. **Filter:** a toggle “Needs follow-up” intersects existing scope, stage, search and classification filters in table, board and mobile. It selects a deal if at least one **own, open, due-or-overdue** follow-up directly attached to that deal exists; contact-only follow-ups do not imply a deal relationship. Table and mobile retain their existing scope behavior; board retains its existing all-stage behavior. The toggle does not silently change scope. Clear all clears it. A future follow-up is not yet needed.

## Existing seams and design

- `pages/ContactDetail.tsx` and the canonical deal record (`pages/project-detail/ProjectDetail.tsx`, whose pipeline band is `pages/sales/DealBand.tsx`, mounted at `ProjectDetail.tsx:250` when the record is a pipeline record) are existing record surfaces; permission affordances use `usePermission`. Projects are the pipeline's deal records. `pages/SalesPipeline.tsx` feeds table/mobile and board through `pipelineListModel.ts`; the latter currently has separate filtering functions and the working-set codec is `src/lib/listWorkingSet.ts`.
- `notifications` is owner-scoped and the shell `NotificationBell.tsx` resolves `metadata.entity` types `contact` and `opportunity` to `/contacts/:id` and `/sales/:id`; the latter redirects to the canonical project route in `App.tsx`. Marking read changes only notification state. The existing paged inbox and polling remain in use.
- `0442_task_reminders.sql` and `agent-chat/remindOverdue.ts` implement an immediate, confirmed, task-assignee reminder; they are neither a future-dated scheduler nor a CRM binding. Do not change their semantics. `notify_workflow_user` intentionally excludes the acting user; it is not the self-reminder writer.
- `agent-dispatch` is already invoked by the minute tick. Its automation schedule is recurring cron, model-driven and feature-gated; do not create one automation or model run per reminder. Add a narrowly scoped service-only transactional CRM delivery RPC invoked independently from automation entitlement within the existing tick. It claims bounded due rows with row locks, validates current recipient and parent eligibility, inserts the inbox row and stamps that revision delivered in the same transaction. Overlapping ticks cannot duplicate; rollback leaves work retryable. No new cron, credential, or parallel scheduler. Bound each invocation to 100 rows ordered by due instant and id; later ticks drain backlog. Report RPC failure in existing dispatcher observability and continue automation processing. Deployment must verify the existing tick reaches this path; a registered cron alone is not delivery proof.
- Proposed `crm_followups`: id, org_id, owner_id, exactly one nullable `project_id` or `contact_id`, due_at, completed_at, revision, delivered_revision, created_at, updated_at. Parent FKs restrict hard deletion; archive suppresses future delivery and removes the row from active record/filter views. Revisions increment on due change only; delivery is eligible when open, due, and delivered_revision differs. Index `(due_at,id)` for open undelivered scans and `(org_id,owner_id,project_id,due_at)` for own open deal lookups. Recheck active same-org owner and parent visibility on delivery; never emit record details when eligibility fails. No client-controlled tenant/owner stamping; enforce current parent read/write scope and role at server for each action, including forged IDs, ownership and update transitions. Follow existing tenant and RLS conventions and validate actual grants and current policies at build time.
- A single caller-scoped query returns due deal IDs for the current user, batched across the pipeline rather than one request per row; query failure is visible and never presented as an empty match set. `due_at <= now` is evaluated server-side. Invalidate on create, edit and complete, and refresh on minute boundaries while the list is mounted so the filter crosses due time without navigation.

## Requirements

- **FR-001** When an authorized user saves a future follow-up on an accessible deal or contact, the system shall persist it for that user and parent.
- **FR-002** While a follow-up is open, its creator with current parent write access shall be able to change its due instant or mark it complete; completion shall remove it from the active set.
- **FR-003** When a due open revision is processed, the system shall atomically create one owner inbox notification with the existing entity binding and record delivery of that revision; processing failure shall leave it retryable.
- **FR-004** While a parent is archived or the recipient is inactive or no longer entitled to read it, the system shall suppress delivery without revealing parent details. Restoring eligibility while still open permits delivery on a subsequent tick.
- **FR-005** When the user enables Needs follow-up, each pipeline presentation shall show only deals satisfying decision 4, intersected with its current filters.
- **FR-006** When a user reads an inbox item, the system shall mark it read and navigate using the existing parent entity route; reading shall not complete the follow-up.
- **FR-007** While saving or loading fails, the interface shall retain user input and present a retryable error; it shall not claim success or show an empty filtered result as authoritative.
- **NFR-001** RLS and server-side checks shall enforce tenant, owner and parent scope, independently of UI gating. Delivery shall use bounded indexed work and no per-row client fetches.
- **NFR-002** The existing reminder, notification, automation and money workflows shall retain their behavior. New UI shall meet project accessibility and localization conventions.

## Acceptance and owning layer

| ID | Given / When / Then | Owner |
|---|---|---|
| AC-001 | Given an authorized creator and accessible deal or contact, when a future follow-up is saved, then it is stored against exactly that parent and creator. | pgTAP `supabase/tests/crm_followups.test.sql` |
| AC-002 | Given another user, another org, an inaccessible parent, or a forged owner, when they read or mutate outside permitted scope, then the operation is denied or yields no row. | pgTAP same file |
| AC-003 | Given an open due revision, when overlapping delivery calls run or a tick retries, then exactly one bound owner notification is committed; a failed transaction is retryable. | pgTAP same file plus concurrent SQL test |
| AC-004 | Given a future, completed, archived-parent, inactive-owner or inaccessible-parent follow-up, when delivery runs, then no notification is created; restored eligible open work can later deliver. | pgTAP same file |
| AC-005 | Given a delivered open follow-up, when its due instant is changed into the future, then it is delivered once again only at the new instant; completion suppresses it. | pgTAP same file |
| AC-006 | Given due and future follow-ups on deals and contacts, when the user enables the filter, then only direct deals with their own open due follow-ups survive all existing filters in every presentation. | Vitest `pmo-portal/pages/sales-pipeline/__tests__/pipelineListModel.test.ts` |
| AC-007 | Given local date/time around DST or an invalid/past time, when submitting, then an unambiguous future instant is saved or a usable validation error is shown. | Vitest `pmo-portal/pages/contact/__tests__/FollowupForm.test.tsx` |
| AC-008 | Given a saved deal follow-up becomes due, when its creator opens the inbox item, then the correct deal opens and the follow-up remains open until completed. | E2E `pmo-portal/e2e/AC-CRM-FU-008-followup.spec.ts` |
| AC-009 | Given an inbox item bound to a contact, when selected, then the contact route opens and the item is marked read. | Vitest `pmo-portal/src/components/shell/__tests__/NotificationBell.test.tsx` |
| AC-010 | Given the due-ID query fails or a mutation fails, when the user filters or saves, then an error and retry are available without treating failure as no matches or discarding input. | Vitest `pmo-portal/pages/SalesPipeline.test.tsx` and form test |
| AC-011 | Given CRM work is due and the assistant automation feature is disabled, when the existing tick runs, then CRM delivery is attempted and automation behavior is unchanged. | Deno `supabase/functions/agent-dispatch/index.test.ts` |

## Exclusions and gates

No screen redesign, new scheduler, external notification, delegation, recurring reminders, activity auto-completion, or relationship inference. Sign-off must resolve all four decisions above; owner sketch-glance and #806 composition remain separate gates. The plan is a proposed implementation, not approval to build.

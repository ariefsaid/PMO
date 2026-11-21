# Plan: Material requests reach the approver (#2685)

**Status:** built. Deviations from the Phase 1 plan: (1) one pgTAP file holds the parity proof; (2) `1336` also carries a trigger on `material_requests` status (a submission opens step 1 before the request turns pending); (3) notifications are inserted directly (not through `notify_workflow_user`) so the actor-skip does not hide an Admin's own steps on backfill, and carry `metadata.mrq_step_id`; (4) backfill on switch-on and unread-delete on switch-off are in `mrq_set_approver_inbox` (AC-MRI-019/020); (5) the e2e journey lives in `e2e/serial/` because it flips an org-wide setting; (6) the toggle component renders nothing outside a query client so the existing settings-page test stays untouched.

Spec: `docs/specs/material-request-approver-inbox.spec.md`. Executor: Director-dispatched worker (approval recipient rule). Migrations 1335..1337 only. No ADR (reuses ADR-0019 and the 0237 notification pattern).

## Design in one paragraph
One flag on the existing `material_request_settings` row. One database helper computes who can decide an open step, by calling the existing `mrq_step_authority` (so role, live pin and stand-in windows are the same code) plus the same earlier-decision rule as `mrq_waiting_for_me`. A sync function inserts missing and deletes stale notifications for one step. Triggers call it when a step opens or closes, and when pins or stand-ins change. The inbox section reuses the existing `useWaitingForMe` queue and is mounted only when the flag reads on. Notifications go through `notify_workflow_user` (0237), which already enforces same org, active member, never the actor.

## Migrations (reversible; rollbacks in `supabase/migrations/rollback/`)
- `1335_mrq_approver_inbox_setting.sql`: `alter table material_request_settings add column approver_inbox boolean not null default false`; `mrq_set_approver_inbox(p boolean)` Admin-only security definer, upsert, `log_audit`; `mrq_approver_inbox_on(p_org uuid)` stable security definer helper (internal). Rollback `1335_mrq_approver_inbox_setting_down.sql`.
- `1336_mrq_step_notifications.sql`: `mrq_step_recipients(p_step_id uuid)` returns user ids (candidates = active org profiles holding the step role, plus active stand-ins, plus the live pin; filtered through `mrq_step_authority(..., mrq_pinned_to(...))`, author excluded, earlier-decision rule copied from `mrq_waiting_for_me`, marked `-- ⚑ MIRRORS mrq_waiting_for_me`); `mrq_sync_step_notifications(p_step_id uuid)` (insert missing via `notify_workflow_user` with `metadata.entity = {type: material_request, id, label}` and `metadata.mrq_step_id`; delete rows of that step no longer wanted; a step that is not open wants nobody); trigger `material_request_steps_notify_trg` after insert or update of status on `material_request_steps`. All revoked from public, anon, authenticated. Rollback `1336_mrq_step_notifications_down.sql`.
- `1337_mrq_notify_resync.sql`: triggers on `approval_step_pins` (insert, update, delete) and `approval_stand_ins` (insert, update of revoked_at) that call the sync for the affected open steps (pins: pending requests of that project at that position; stand-ins: open steps of the org whose role is the delegator's). Rollback `1337_mrq_notify_resync_down.sql`.
- Inventory fragments: none expected (no client-callable definer except `mrq_set_approver_inbox`, which goes in `supabase/tests/inventory/anon-executable-definers/2685-mrq-approver-inbox.txt` per its header); isolation denominator: no new table.
- `database.types.ts`: add the column and the RPC signature by hand in the existing generated shape.

## Tests (write first)
pgTAP `supabase/tests/mrq_approver_inbox.test.sql` (AC-MRI-001..011) and `supabase/tests/mrq_approver_inbox_parity.test.sql` (AC-MRI-009, impersonating each user against `mrq_waiting_for_me`). Mutation checks, each run once red then restored, output lines quoted: remove the author exclusion; ignore the pin; drop the earlier-decision rule; skip the setting test (AC-MRI-002); skip the cleanup on decide. Tag mutation points `-- mut:` like the existing files. Run under `flock /tmp/db.lock` with `0178` and `0646` as the common brief says.

Unit (Vitest):
- `pmo-portal/pages/approvals/MaterialRequestApprovalSection.test.tsx` (AC-MRI-012, 015).
- `pmo-portal/pages/Approvals.materialRequests.test.tsx`, a new file (AC-MRI-013, 014), so `Approvals.test.tsx` stays untouched.
- `pmo-portal/src/components/shell/__tests__/NotificationBell.materialRequest.test.tsx` (AC-MRI-016).
- Setting toggle test in a new file beside `pages/MaterialRequestSettings.test.tsx` (AC-MRI-017).
E2E: `pmo-portal/e2e/AC-MRI-018-material-request-approver-inbox.spec.ts`, one journey, serial lane only if it must flip the setting (tag per `docs/e2e-parallel-conventions.md`).

## Frontend files
- `pmo-portal/src/lib/db/materialRequests.ts` (+ repository): `getApproverInbox()` reads the flag; `setApproverInbox(on)` calls the RPC. Hook `useApproverInboxSetting()` in `src/hooks/useMaterialRequests.ts`; mutation invalidates the setting key.
- `pmo-portal/pages/approvals/MaterialRequestApprovalSection.tsx`: heading "Material requests awaiting you ({{count}})", `Card` of rows (number, work order, step label, waiting since, link), loading/error/empty states like `SalesInvoiceApprovalSection`. Rows link to `/material-requests/:id`; the decision stays on the request screen (same RPC, no new write path).
- `pmo-portal/pages/Approvals.tsx`: a `material` kind added to `availableKinds` only when the flag reads on; counts, "All" scope, caught-up and the access check include it. With the flag off or loading, every existing expression evaluates as before (the new hook is `enabled` only for roles that may see the screen; the queue query is enabled only when the flag is on). `pmo-portal/src/lib/selectors/approvals.ts` gets the new kind in its type.
- `pmo-portal/src/components/shell/NotificationBell.tsx`: `material_request: '/material-requests'` in `ENTITY_ROUTE_BASE`.
- `pmo-portal/pages/MaterialRequestSettings.tsx`: Admin-only toggle with `can()`.
- i18n: `materialRequests` namespace keys in en and id (settings toggle, section heading, row text, scope label); add `materialRequests` to the `/approvals` route namespaces in `App.tsx`.
- Glossary entries in `docs/glossary.md`. Evidence screenshots (390 and 1440 at 2x) of the section and the toggle in `docs/evidence/1215/2685/`.

## Gates (run in Phase 2, quote each line)
`npm run check:guards`; `npm run typecheck`; `npx eslint --max-warnings=0 <changed files>`; `npx vitest related --run <changed sources>` plus the existing `pages/Approvals.test.tsx`, `NotificationBell.test.tsx`, `MaterialRequestSettings.test.tsx` unedited; pgTAP chain from the brief; `scripts/e2e-local.sh AC-MRI-018` and `scripts/ux-proof.sh` on `/approvals`.

## Order of work
1. 1335 + pgTAP red/green (AC-001, 002). 2. 1336 + recipients/sync tests incl. parity (AC-003..009, 011) and mutation checks. 3. 1337 (AC-010). 4. Frontend tests then code (AC-012..017). 5. E2E (AC-018), screenshots, glossary. Push after every commit.

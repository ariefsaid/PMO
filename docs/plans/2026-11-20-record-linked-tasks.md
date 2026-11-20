# Record-Linked Tasks Implementation Plan (#2587)

> Fresh Orca worker per slice; Opus builder, Director-dispatched (it adds a trigger path that changes task status). Spec: `docs/specs/record-linked-tasks.spec.md`. Sign OD-RLT-1..3 first. Read `0206_tasks_meeting_parent.sql` (the link-target pattern and the guard body), `0146_project_task_ownership.sql`, `0247_expense_claims.sql`, `1000_material_requests.sql`, `0260_record_change_history.sql`, and `docs/plans/2026-11-20-task-work-order-proof.md` (the other Done guard) before starting.

## Migration (number assigned by the Director; rollback file `supabase/migrations/rollback/<n>_record_linked_tasks_down.sql`)
1. **Columns on `tasks`**: `procurement_id`, `expense_claim_id`, `material_request_id`, each nullable uuid FK to its table with the default no-action (hard delete of the record is blocked, as with `meeting_id`); `closed_by_record_type text`, `closed_by_record_status text`, `closed_by_record_at timestamptz` (all three set together or none, a check). Check `num_nonnulls(procurement_id, expense_claim_id, material_request_id) <= 1`. `org_id` is already stamped by the existing trigger; no client sends it.
2. **One open task per link**: three partial unique indexes, one per link column, `where status <> 'Done' and archived_at is null and tombstoned_at is null`. These also serve the read.
3. **Link guard** (before insert or update on `tasks`): when a link is set or changes, require the record is in the task's org and, if both have a project, the same project; require the record is not in an end state; require the caller can read the record. Run the guard with the caller's rights (no `security definer`) so its `exists` sees exactly what the caller may read — a missing and an unreadable record are then the same answer, and no second copy of three row-security policies exists. Skip for the service-role external path as `0206` does. Modelled on `check_task_meeting_same_project`, minus its definer posture for the readability step.
4. **Column guard**: extend `enforce_assignee_status_only` allow-lists so the creator may set the three link columns (as `0206` did for `meeting_id`) and the assignee may not; the system close is recognised by the linked record actually being in an end state — server truth the caller cannot fake — not by a session value and not by "the executing role inside the definer function" (the guard is invoker-rights and sees only the caller). **ADR candidate:** how a database-initiated task change is told apart from a user's. Make the same exception in the `task-work-order-proof` Done guard. Also refuse any change to the `closed_by_*` columns outside the close path: `tasks` has table-level INSERT/UPDATE for `authenticated` (0075), so a column revoke cannot subtract.
5. **Close function** `close_tasks_for_record(p_type, p_id, p_status)` `security definer`, `set search_path = public, pg_temp`, no execute for `public`/`anon`/`authenticated`: updates open tasks linked to the record to `Done` and stores the three `closed_by_*` columns; `completed_at` is stamped by the existing trigger.
6. **Triggers** (after update of `status`, `when old.status is distinct from new.status`) on `procurements`, `expense_claims`, `material_requests`; each calls the function only when the new status is in that table's end-state list (a single immutable list per type in one place). A comment on each trigger names the spec table so a status enum change is not made without updating it. **ADR candidate:** end-state lists live in the database; the app reads `is_end_state` from the read function, never its own copy.
7. **Read function** `task_linked_records(p_task_ids uuid[])` `security invoker`, `stable`: left joins each record table under the caller's own row security and returns `(task_id, link_type, label, status, is_end_state, readable)`; unreadable rows return only `task_id`, `link_type`, `readable = false`. Wraps each caller helper in `(select helper())` in any new policy; this function adds none, so `0646_rls_initplan.test.sql` stays green.
8. **Record history**: add the three link columns (`ref`) and `closed_by_record_status` (`text`) to the `task` entry in `record_history_config`. `record_change_capture` (0260) names `auth.uid()` first and falls back to `app.actor_id`, then null; so a close inside a person's write is attributed to that person and only a service-role sync reads as "system" — no change to the capture function is needed, and the closing reason marks the system close.
9. **Rollback**: drop triggers, functions, indexes, then columns (loses links, never tasks).

## Slice 1 — database, pgTAP first (Orca, Opus)
- [ ] `supabase/tests/<n>_record_linked_tasks.test.sql` red first: AC-RLT-001, 002, 006, 008, 009 (link guard, uniqueness, cross-org). Run chained: `scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db supabase/tests/<n>_record_linked_tasks.test.sql'`.
- [ ] Add AC-RLT-003, 004 (all three types, end and non-end moves), 005 (non-editor closes; client cannot spoof), 010, 011, 013. Then the migration until green.
- [ ] **Mutation checks** (security-critical): make the guard test `true`, make the trigger fire on every status, make the read function `security definer`; AC-RLT-005, 004, 007 must each go red; restore.
- [ ] AC-RLT-007 pgTAP for the read function as claimant, as a user who sees the task but not the claim, and as another org. AC-RLT-012 lands with whichever of #2531 or this ships second. AC-RLT-018: a task in an externally-owned domain is skipped and the record's write still succeeds.
- [ ] Final: `npx supabase test db supabase/tests/0646_rls_initplan.test.sql` and `first_class_tasks.test.sql`, `0355_finance_task_scope.test.sql`, `0204_engineer_task_create.test.sql` (the guard body changed).

## Slice 2 — data access and policy (Orca)
- [ ] `pmo-portal/src/lib/db/tasks.ts` (+ `tasks.test.ts`): link fields in reads and the input; `taskLinkedRecords(ids)` calling the read function once per page; map `23505` on the link indexes and the guard messages in `classifyMutationError`. AC-RLT-014/015 logic first.
- [ ] `pmo-portal/src/lib/repositories/tasks` (existing seam): expose `linkedRecords`. Regenerate `database.types.ts` per the repo's type-gen script.
- [ ] `pmo-portal/src/auth/policy.ts`: action `link` on `task`; role-matrix registration; AC-RLT-016.

## Slice 3 — screens (`ui-implementer`; meets the `restructure` skill)
- [ ] Task row and detail: type, number and live status chip, closing reason, unreadable placeholder (`pmo-portal/pages/MyTasks.tsx`, project task views, task detail). Reuse the record's own status label helpers (`src/lib/procurement/`, `pages/expenses`, `pages/materialRequests`).
- [ ] Create-from-record action on `ProcurementDetails.tsx`, `ExpenseClaimDetail.tsx`, `MaterialRequestDetail.tsx`: opens the open task or prefills a new one. AC-RLT-015.
- [ ] Locales: `pmo-portal/public/locales/en/tasks.json` and `.../id/tasks.json` (link labels, "linked record you cannot view", "closed because the claim was paid", errors). Indonesian strings reviewed, not machine-only.
- [ ] E2E `pmo-portal/e2e/AC-RLT-017-claim-paid-closes-task.spec.ts` (one journey; tag per `docs/e2e-parallel-conventions.md`). `scripts/ux-proof.sh` on touched routes.

## Traceability
| AC | Test file | Layer |
|---|---|---|
| AC-RLT-001, 002, 006, 008, 009 | `supabase/tests/<n>_record_linked_tasks.test.sql` | pgTAP |
| AC-RLT-003, 004, 005, 010, 011, 013, 018 | same | pgTAP |
| AC-RLT-007 | pgTAP (owner), same file as above; also referenced: Unit render in `pmo-portal/src/lib/db/tasks.test.ts` | pgTAP |
| AC-RLT-012 | pgTAP, lands with the second of #2531 or #2587 | pgTAP |
| AC-RLT-014, 015, 016 | task row, record-page and policy unit tests | Unit |
| AC-RLT-017 | `pmo-portal/e2e/AC-RLT-017-claim-paid-closes-task.spec.ts` | E2E |

## Glossary (added to `docs/glossary.md` with the spec)
**Record-linked task** (a task tied to one purchase, expense claim or material request, showing its live status); **End state** (a status after which a record cannot continue, per type); **System close** (the database setting a linked task `Done` when the record ends); **Open task** (not Done, archived or tombstoned).

## Final gate
`npm run check:guards`, `npm run typecheck`, `npx eslint --max-warnings=0 <touched>`, touched vitest, pgTAP and e2e files only; `scripts/ux-proof.sh` on touched routes. Review: spec, code-quality, security-auditor (the close path and the read function are the focus). Ships alone, not batched: it changes who can set a task to Done.

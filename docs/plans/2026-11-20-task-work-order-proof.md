# Plan: tasks per work order with proof (#2531)

Spec: `docs/specs/task-work-order-proof.spec.md`. Depends on #2517 (work orders on the cost side are not required, only the
existing `work_orders` table) and benefits #2518 (open-tasks section). Executor: Orca worker, Opus builder (RLS/trigger work).
Migration number: next in the range assigned at dispatch; rollback required. Read `0146_project_task_ownership.sql`,
`0199_first_class_tasks.sql`, `0140_task_model_fields.sql` (the move guard `check_tasks_parent_same_project`) and `0028_procurement_files.sql` first.

## Files
- `supabase/migrations/<n>_task_work_order_proof.sql` + `rollback/<n>_..._down.sql`; `supabase/tests/<n>_task_work_order_proof.test.sql`.
- `pmo-portal/src/lib/db/tasks.ts` (+ `tasks.test.ts`): `work_order_id`, `proof_required` in reads and the input; filter param.
- `pmo-portal/src/lib/repositories/taskProofs.ts`; `pages/project-detail/TaskForm*` (add the two fields), `pages/MyTasks.tsx` (done control), task detail.
- `public/locales/{en,id}/tasks.json`; regenerate `database.types.ts` per the repo's type-gen script.

## Tasks (TDD)
1. pgTAP red: AC-TWOP-001/002/003/011 (columns + same-project trigger, move guard, assignee column limits). Then migration §1.
2. pgTAP red: AC-TWOP-004/005/006/012 (proof table `task_proofs(org_id, task_id, file_path, uploaded_by, created_at, archived_at)`,
   RLS org + task read rule, append-only on Done tasks, count cap) and the Done guard trigger `guard_task_done_needs_proof`
   (before update of status on tasks; fires for every policy path; `security definer` read of proof count). Then migration §2.
3. Storage bucket + policies, modelled on 0391 (read = task read rule; write = assignee or structure-edit role). pgTAP AC-TWOP-006 object case.
4. Mutation check: set the guard to always pass → AC-TWOP-004 must go red; restore.
5. DAL + repository unit tests: AC-TWOP-007/012; classify the new error codes in `classifyMutationError`.
6. UI: fields in the task form (`CanWrite`), proof panel, disabled Done with reason. AC-TWOP-008. Open-tasks list component exported for #2518 (AC-TWOP-009).
7. E2E `e2e/AC-TWOP-010-proof-before-done.spec.ts` (phone viewport, file chooser).
8. Locale strings; glossary entry "Proof of completion".

## Gates
CLAUDE.md local final gate; pgTAP files touched under `scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db <file>'`; `ux-proof.sh` on touched task routes.
Review: spec, code-quality, security-auditor (assignee door vs structure edit; storage read rule). Batch with #2518/#2521 only after review.

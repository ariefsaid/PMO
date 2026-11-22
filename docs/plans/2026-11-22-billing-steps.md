# Plan: a work order's billing checklist from the day it is issued (billing-steps)

> Status: phase 2, awaiting approval. Spec: `docs/specs/billing-steps.spec.md`. Branch `feat/gap-billing-billing-steps`. Migrations
> 1770-1779 only, each with `supabase/migrations/rollback/<n>_<name>_down.sql`. The builder writes pgTAP and e2e; the wave run executes
> them (no reset, pgTAP, e2e or screenshots here). Restated bodies are taken from the latest migration defining each function, named per
> function below; where 1480 rewrote a body dynamically, the restatement carries its `perform public.assert_not_light();` line.

## Migrations
- **1770 `billing_checklists`** — table `billing_checklists (id, org_id, project_id, work_order_id null, claim_id null unique,
  created_at, created_by)`; `org_id` stamped by trigger from the project (never the client); RLS enabled and forced, select policy
  `org_id = (select auth_org_id()) and (select is_active_member())`, restrictive reader scope (FR-WBS-022) via
  `(select public.billing_step_reader())` plus the per-checklist assignee helper, light-account deny policies as 1462; no client write.
  `claim_billing_stages`: add `checklist_id uuid not null` (after backfill), `assignee_id uuid references profiles`, `owner_role_key text
  references built_in_roles(key)`, `status_hidden_from text[] not null default '{}'`; `claim_id` becomes nullable: it is the
  checklist's claim, written only by the attach and release functions (1772), because the gate reads it; unique `(claim_id, position)`
  replaced by `(checklist_id, position) deferrable initially immediate`. `billing_stage_templates`, `billing_step_template_steps`: add
  `owner_role_key`, `status_hidden_from`. `billing_step_templates.is_default boolean not null default false` + partial unique index
  per org. Table `org_billing_step_settings (org_id pk, actor_role_keys text[] not null default '{}', updated_by, updated_at)`.
  **Backfill**: one checklist per claim that has steps (`claim_id`, `work_order_id`, `project_id`, `org_id` from the claim), stamp
  `checklist_id` on its steps. Indexes: waiting partial indexes by `assignee_id` and by `owner_role_key`; checklist by
  `(work_order_id) where claim_id is null`.
  Rollback: drop the pending checklists' steps (stated), restore `not null`, the old unique, drop columns and tables.
- **1771 `billing_step_access_helpers`** — `billing_step_reader()` (four readers, or actor role key in the org setting), 
  `billing_checklist_assigned_to_me(uuid)`, `billing_step_hidden_from_me(text[])`, `billing_step_holders(claim_billing_stages)` (FR-WBS-030),
  `billing_step_may_act(claim_billing_stages)` (FR-WBS-021). Replace the `*_engineer_read_scope` policies on `claim_billing_stages` and
  `claim_billing_stage_documents` (1021) with the new reader scope and add a restrictive hidden-row policy on both. Settings RPCs
  `set_billing_step_settings(p_actor_role_keys text[])` (Admin/Finance; refuses light and unknown keys) and
  `set_default_billing_step_template(p_template uuid)` (Admin/Finance; null clears).
- **1772 `billing_checklist_lifecycle`** — `billing_checklist_source_steps(project)` (project list, else org default);
  `create_billing_checklist(org, project, work_order, claim)` internal; trigger `work_orders_zz_billing_checklist` after update of status
  when Draft->Issued (shape of 1402); restate `instantiate_claim_billing_stages` (head 1365) to attach the open work-order checklist
  (`billing_checklist_open_for_work_order(wo)`) or create one, and copy attached documents into `progress_claim_evidence`; trigger after
  update of `withdrawn_at` on `progress_claims` to release a work-order checklist (FR-WBS-004); RPC `start_billing_round(p_work_order)`.
- **1773 `billing_step_writers`** — restate with the checklist key, the new act rule and the hidden test (not found when hidden):
  `lock_billing_stage_claim` (head 1361), `complete_billing_stage` (1361), `attach_billing_stage_document` (1021; evidence insert only when
  a claim is attached), `note_billing_stage` (1021), `skip_billing_stage` (1362 + 1480 guard), `renumber_claim_steps` (1367, keyed by
  checklist), `lock_claim_for_step_edit` -> `lock_billing_checklist_for_edit(p_checklist, p_structural)` (1367), `update_claim_billing_step`
  (1367 + 1480; new patch keys `assignee_id`, `owner_role_key`, `status_hidden_from`), `remove_claim_billing_step`, `move_claim_billing_step`
  (1367 + 1480); `add_claim_billing_step(p_claim,..)` replaced by `add_billing_step(p_checklist,..)`, `load_billing_step_template_onto_claim`
  by `load_billing_step_template_onto_checklist` (1366 + 1480), both old ones dropped (rollback restores). `save_billing_step_template`,
  `set_billing_stage_template`, `load_billing_step_template_onto_project` (1366 + 1480) read/copy `owner_role_key` and `status_hidden_from`.
  `billing_stages_open` and both gate triggers: NOT touched.
- **1774 `billing_step_notices`** — trigger on `claim_billing_stages` after insert or update of `started_on` (null -> date) calling
  `notify_workflow_user(..., p_email_event => 'billing_step')` for each holder (FR-WBS-033); restate
  `billing_stage_overdue_recipients` (head 1460) over `billing_step_holders`, and `notify_overdue_billing_stages` (head 1368) with a left join
  to the claim (pending checklists included, cancelled work orders excluded).
- **1775 `billing_step_reads`** — restate `my_waiting_billing_steps` (1369 + 1480; return type gains `checklist_id`, `work_order_id`: drop
  and create) and `overdue_billing_steps_by_claim` (1369 + 1480; hidden steps excluded); restate `billing_board` (1370; card per live
  checklist, gains `checklist_id`, `claim_id` nullable; invoker, so the hidden-row policy applies); new
  `billing_checklist_hidden_steps(p_checklist)` (names and positions only) and `billing_checklist_for_work_order(p_work_order)`.
- **1776 `billing_steps_light_guards`** — `assert_not_light()` in each new definer; the 2711 sweep test allowlist untouched (none open).
- Isolation-probe fragment `scripts/isolation-probe-denominator.d/billing-steps.json` (two tables, new definers); remove the dropped
  definer names from `2680-claim-billing-steps.json`.
- `pmo-portal/src/lib/supabase/database.types.ts`: hand-edit to match (tables, columns, RPC args/returns), generated style.
- `pmo-portal/public/locales/{en,id}/refusals.json`: `BCL_ROUND_OPEN`, `BCL_WO_NOT_OPEN`, `BCL_ASSIGNEE_INVALID`, `BCL_ROLE_INVALID`,
  `BCL_OWNER_HIDDEN`, each saying what to do next.

## Slices (test first)
1. pgTAP `supabase/tests/1770_billing_checklists.test.sql` (AC-WBS-001..007, 014), `supabase/tests/1771_billing_step_access.test.sql`
   (AC-WBS-008..011), `supabase/tests/1774_billing_step_notices.test.sql` (AC-WBS-012, 013); update steps in
   `supabase/tests/1365_claim_billing_steps.test.sql`, `1370_billing_board.test.sql` (AC-WBS-004). Fixtures as `1365_claim_billing_steps.test.sql`.
2. Data seam: `pmo-portal/src/lib/db/billingSteps.ts` (+ `billingSteps.test.ts`): checklist read, `startBillingRound`, settings,
   default template, new patch keys, renamed RPCs; `pmo-portal/src/lib/db/billingStages.ts` trace read by checklist with
   `assigneeId`, `ownerRoleKey`, hidden names; `pmo-portal/src/lib/db/billingBoard.ts` new columns; repositories
   `pmo-portal/src/lib/repositories/billingSteps.ts`; hooks `pmo-portal/src/hooks/useBillingSteps.ts`.
3. Needs you: `pmo-portal/src/components/dashboard/restructure/useNeedsYou.ts` lines 213 and 373 drop the Engineer exclusion;
   `pmo-portal/src/lib/waitingSteps.ts` link to the work order when no claim (AC-WBS-015).
4. Screens (read `.claude/skills/restructure/SKILL.md`, `docs/ux/screen-rules.md`): new `pmo-portal/pages/project-detail/tabs/WorkOrderBillingChecklist.tsx`
   in `WorkOrdersDrawers.tsx` reusing `ClaimBillingStages.tsx` rendering by checklist id (AC-WBS-016); `ClaimStepsPanel.tsx` assignee
   (Combobox), owner key (SelectField over `builtInRoles.ts`, only where built-in roles are on), hidden roles (AC-WBS-017);
   `BillingStepTemplatesModal.tsx` default template and actor roles (AC-WBS-018); `pmo-portal/pages/BillingBoard.tsx` pending cards
   (AC-WBS-019). Strings en/id in `project.json`. `can()` additions in `src/auth/policy.ts` (UX only).
5. E2E `pmo-portal/e2e/AC-WBS-020-work-order-billing-checklist.spec.ts` (serial lane; `docs/e2e-parallel-conventions.md`).
6. Docs: `docs/glossary.md` terms (EN/ID); cross-reference in `claim-billing-steps.spec.md` and `billing-board.spec.md`.

## Mutation checks (for the orchestrator's run)
- `billing_step_may_act`: drop the owner-key equality -> AC-WBS-008 "cannot complete a step owned by another key" goes red.
- Hidden-row restrictive policy on `claim_billing_stages`: replace its expression with `true` -> AC-WBS-010 "row absent for quality manager" red.
- `instantiate_claim_billing_stages`: always create instead of attach -> AC-WBS-002 "no new step row" red.
- Withdraw release trigger: remove it -> AC-WBS-005 red.

## Screenshots to capture (docs/evidence/gaps-1215/billing-steps/)
Work order drawer with a pending checklist (Finance; surveyor actor; quality manager with a hidden step) at 390px and 1440px; step editor
with assignee/owner/hidden (Finance, PM); billing settings card; billing board with a "No claim yet" card; needs-you item for a surveyor.

## Traceability
| AC | Layer | File |
|---|---|---|
| AC-WBS-001..007, 014 | pgTAP | `supabase/tests/1770_billing_checklists.test.sql` |
| AC-WBS-008..011 | pgTAP | `supabase/tests/1771_billing_step_access.test.sql` |
| AC-WBS-012, 013 | pgTAP | `supabase/tests/1774_billing_step_notices.test.sql` |
| AC-WBS-015 | Unit | `pmo-portal/src/components/dashboard/restructure/useNeedsYou.waitingSteps.test.ts` |
| AC-WBS-016 | RTL | `pmo-portal/pages/project-detail/tabs/__tests__/WorkOrderBillingChecklist.test.tsx` |
| AC-WBS-017 | RTL | `pmo-portal/pages/project-detail/tabs/__tests__/ClaimStepsPanel.assignee.test.tsx` |
| AC-WBS-018 | RTL | `pmo-portal/pages/project-detail/tabs/BillingStepTemplatesModal.settings.test.tsx` |
| AC-WBS-019 | RTL | `pmo-portal/pages/BillingBoard.test.tsx` |
| AC-WBS-020 | E2E | `pmo-portal/e2e/AC-WBS-020-work-order-billing-checklist.spec.ts` |

# Plan: work-order billing step list (spec `docs/specs/billing-steps.spec.md`)

Migrations (1770-1779, each with `supabase/migrations/rollback/<n>_<name>_down.sql`; restated bodies taken from the latest migration defining them):
- 1770_wo_billing_steps_tables: the two step tables, `org_billing_step_settings`, template-step columns, RLS (org + active member), restrictive light deny, grants select only.
- 1771_billing_steps_capabilities: widen the `built_in_role_capabilities` CHECK, insert default grants (spec 3), gates `actor_may_see_billing_steps()` / `actor_may_run_billing_steps()` (the only readers of the literals), per-step visibility helper, step select policies.
- 1772_wo_billing_step_functions: `set_default_billing_step_template`, `set_billing_step_template_roles` (a new function: no restatement of `save_billing_step_template`), `assign_work_order_step`, `attach_work_order_step_document`, `complete_work_order_step`, `skip_work_order_step` (pattern 1401/1418, all with `assert_not_light()`).
- 1773_wo_billing_step_issue_trigger: Draft->Issued copy (pattern 1402) and the step-opened notice through `notify_workflow_user(..., 'billing_step')`.
- 1774_wo_billing_step_reads: `my_waiting_work_order_steps`, board and claim-side reads (visibility enforced in the definer body).

App: `pmo-portal/src/lib/db/workOrderBillingSteps.ts` (typed DAL, `database.types.ts` by hand), `src/lib/repositories/workOrderBillingSteps.ts`, hook `src/hooks/useWorkOrderBillingSteps.ts`,
`pmo-portal/pages/work-order/WorkOrderBillingSteps.tsx` on `pages/WorkOrderDetail.tsx`, rows on `pages/BillingBoard.tsx`, claim-side link, `useNeedsYou.ts` fact, template editor fields in `pages/project-detail/tabs/BillingStepTemplatesModal.tsx` + default picker, `src/lib/refusals.ts` + locale files, `src/auth/builtInRoles.ts` (+ test) and `policy.ts` affordances.

Tests: pgTAP `supabase/tests/1770_wo_billing_steps.test.sql` (AC-WBS-001..005,007,008,010), update 1200/2716/2709 fixtures, light sweep entries; vitest per AC-WBS-002,006,009,011,012; one e2e `pmo-portal/e2e/AC-WBS-012-wo-billing-steps.spec.ts`.
Gates: check:guards, typecheck, eslint on touched files, `vitest related` on touched files.
Mutation checks (orchestrator runs): make the view gate return true -> AC-WBS-004 red; drop the hidden-from predicate in the step select policy -> AC-WBS-004 red.

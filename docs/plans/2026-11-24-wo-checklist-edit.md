# Plan: edit a work order's billing checklist (spec `docs/specs/wo-checklist-edit.spec.md`)

Branch `feat/1124-billing-checklist-edit` off `origin/dev`. Migration 2180 (range 2180-2189), rollback in `supabase/migrations/rollback/`.
Each task names the AC it satisfies; the build went test first at every layer.

1. **pgTAP, RED by absence** — `supabase/tests/2180_wo_billing_step_add.test.sql`: add after the current step, other work orders untouched,
   stamped organisation and project, audit (AC-WCE-001); refusals write nothing — reader, field account, other project's manager, other
   organisation — and malformed step or place (AC-WCE-003); save as template, roles, the next work order starts from it (AC-WCE-002);
   no claim step, gate untouched (AC-WCE-004); places, empty and finished lists, 20-step cap (AC-WCE-005); grants.
2. **Migration** — `2180_wo_billing_step_add.sql`: `add_work_order_step(uuid, integer, jsonb)` (pattern 1772; `assert_not_light`, membership,
   organisation-scoped lookup under the work-order row lock, the run right, the Project Manager rule, Issued only, validation, descending
   shift, insert, open-on-empty-or-finished, audit). Rollback drops the function. Fragment
   `supabase/tests/inventory/anon-executable-definers/2180-wo-billing-step-add.txt`; denominator
   `scripts/isolation-probe-denominator.d/2180-wo-billing-step-add.json`; refusals en + id.
3. **Seam** — `database.types.ts` (hand entry), `addWorkOrderStep` in `src/lib/db/workOrderBillingSteps.ts`, `billingStages`
   contract + repository, `useWorkOrderStepMutations().add`. Vitest: `workOrderBillingSteps.test.ts` (DAL).
4. **Pure rules** — `mayChangeStepList`, `stepInsertPlaces`, `toTemplateSteps` in `src/lib/workOrderBillingSteps.ts`. Vitest.
5. **Screen** — `pages/work-order-detail/BillingStepsSection.tsx`: "Add step" and "Save as template" in the section's action slot; the add
   form and the save dialog; the summary line trimmed (D4). Strings `billingSteps.json` en + id. Vitest/RTL: `BillingStepsSection.test.tsx`.

Gates run by the builder (`pmo-portal/`): `npm run check:guards`, `npm run typecheck`, `npx eslint --max-warnings=0 <changed files>`,
`npx vitest run` on the touched test files. Not run (no database command in this workspace; CI owns them): `supabase test db
supabase/tests/2180_wo_billing_step_add.test.sql`, the standing sweeps 0178 / 2711 / 2716 at head, and `scripts/ux-proof.sh /work-orders/:id`.

Mutation checks for the integration run (break the rule; the named assertion goes red; restore) are listed at the top of the pgTAP file.

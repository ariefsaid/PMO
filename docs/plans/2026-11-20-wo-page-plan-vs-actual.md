# Plan: plan vs actual on the work-order page (#2570)

Spec: `docs/specs/work-order-plan-vs-actual.spec.md` (FR-WPVA-040, FR-WPVA-041, AC-WPVA-016). No migration; the #2519
repository and `useProjectPlanVsActual` hook are reused, nothing is recomputed in the UI (FR-WPVA-010).

## Tasks (test first)
1. `pmo-portal/pages/work-order-detail/PlanVsActualSection.test.tsx` (red) then
   `pmo-portal/pages/work-order-detail/PlanVsActualSection.tsx`: panel for one work order picked out of the project
   read: planned and actual direct cost, shared cost (the work order's allocated share) against indirect plan, billed
   revenue, direct margin, result after shared cost, discipline rows, other-currency cost apart. States: loading, error
   with retry, restricted, empty, data.
2. `pmo-portal/pages/WorkOrderDetail.tsx`: call `useProjectPlanVsActual(projectId, can('view','workOrderPlan'))`, render the
   section between Costs and Billing when the role may view plans. `WorkOrderDetail.test.tsx` mocks the hook.
3. Strings: one new key `pageEmpty` in `public/locales/{en,id}/workOrderPva.json`; the rest reuse the namespace.
4. `pmo-portal/e2e/AC-WPVA-016-plan-vs-actual-matches.spec.ts`: seed a work order with plan lines, read the project
   tab row, open the work order, assert direct, shared and result figures equal the row's.

## Traceability
| AC / FR | Owning layer | Proof |
|---|---|---|
| FR-WPVA-040 | Unit | `PlanVsActualSection.test.tsx`, `WorkOrderDetail.test.tsx` |
| FR-WPVA-041 | Unit | over-plan wording in `PlanVsActualSection.test.tsx` |
| AC-WPVA-016 | E2E (one journey) | `e2e/AC-WPVA-016-plan-vs-actual-matches.spec.ts` (needs local Supabase; not run in the cloud build) |
| AC-WPVA-009 | Unit | restricted state on the page |

Screen rules: no explanatory sentence, one empty line, money with currency in the org's formatter, overspend in words.

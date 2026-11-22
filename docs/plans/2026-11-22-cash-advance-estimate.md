# Plan: site cash estimate by purpose and work order (cash-advance-estimate)

Spec: `docs/specs/cash-advance-estimate.spec.md`. Migrations 1890-1891 only. Money-adjacent: reads only, no posting, no
routing, no figure that decides an approval; the split is a breakdown of an existing approved line.

## Design in one paragraph
Add `imprest_plan_line_splits` (line, work order, amount) beneath the existing plan line, and one invoker-rights read
`get_imprest_estimate`. The plan, its approval route, `imprest_remaining`, `imprest_drawn`, `transition_imprest_plan` and
`get_imprest_position` are not restated or changed. Splits freeze with the line (same author/status rule).

## Tasks (test first)

1. **1890_imprest_plan_line_splits.sql** (+ `supabase/migrations/rollback/1890_imprest_plan_line_splits_down.sql`).
   Table `public.imprest_plan_line_splits(id, org_id, line_id fk on delete cascade, work_order_id fk, amount numeric(14,2)
   check >0 and < Infinity, unique(line_id, work_order_id))`; org stamped from the line (0422 `stamp_imprest_plan_org`
   idiom, new trigger fn); RLS enabled + forced; select policy mirrors `imprest_plan_lines_select`, write policy mirrors
   `imprest_plan_lines_write`, both with `(select ...)` wrapped helpers and the `org_feature_enabled(..., 'imprest')`
   conjunct as in the live line policies (`0696`); grants: select, delete; insert (id, line_id, work_order_id, amount);
   update (work_order_id, amount). Checks live in the save function (work order on the float's project, not cancelled for a new split, sum <= line
   amount, raising `ICE_*`); a trigger on `imprest_plan_lines` before update of `planned_amount` refusing below the split sum.
   Tests: `supabase/tests/1890_imprest_plan_line_splits.test.sql` owns AC-CAE-001..006 (plus mutation check).
2. **1891_get_imprest_estimate.sql** (+ rollback). `get_imprest_estimate(p_float uuid, p_from date, p_to date)`
   returns rows (month, status, budget_category, work_order_id, planned, drawn, still_to_spend) and a second function
   `get_imprest_estimate_total(...)` returning (planned, drawn, still_to_spend, cash_book, in_flight, advance_needed);
   both `security invoker stable`, period validated (`ICE_PERIOD`), whole months, dates from the org timezone as
   `get_imprest_position` does. Tests: `supabase/tests/1891_imprest_estimate.test.sql` owns AC-CAE-007..010.
3. Regenerate types for the two objects (`database.types.ts`, by hand-merge of the generator's output for these objects;
   no casts). DAL in `pmo-portal/src/lib/db/imprest.ts`, hooks in `src/hooks/useImprest.ts`, repository seam
   `src/lib/repositories` as for floats. Update `scripts/check-unpaged-reads.mjs` entry (bounded: 12 months x lines).
4. **Refusals:** `ICE_SPLIT_OVER_LINE`, `ICE_WO_PROJECT`, `ICE_WO_CANCELLED`, `ICE_PERIOD` in
   `public/locales/{en,id}/refusals.json` (what to do next in each); AC-CAE-014 via the existing catalogue guard
   (`scripts/check-refusal-codes.mjs`).
5. **UI:** `pages/imprest/EstimateSection.tsx` (rendered in `ImprestFloatDetail.tsx`) per `restructure`: period select,
   table by purpose with work-order child rows, advance-needed figure, empty states (AC-CAE-011), Request top-up
   action using the existing request flow; `PlansSection.tsx` gains a per-line split control (AC-CAE-013). Strings in
   `public/locales/{en,id}/imprest.json`; DESIGN.md tokens; 390px and 1440px. Tests: `EstimateSection.test.tsx`
   (AC-CAE-011, 012), `PlansSection.split.test.tsx` (AC-CAE-013).
6. **E2E:** one added step in `e2e/AC-IMP-090-site-imprest-journey.spec.ts` (AC-CAE-012 end to end).
7. **Docs:** `docs/glossary.md` adds **Cash estimate** (EN/ID) and **Split** under Site cash; ADR not needed (no
   architectural choice).
8. Existing-test updates listed in spec section 7: add the new table to the shape-guard, light-account sweep, ACL and
   isolation-probe lists in the same commit as migration 1890.

## Traceability
| AC | Layer | File |
|---|---|---|
| AC-CAE-001..006 | pgTAP | `supabase/tests/1890_imprest_plan_line_splits.test.sql` |
| AC-CAE-007..010 | pgTAP | `supabase/tests/1891_imprest_estimate.test.sql` |
| AC-CAE-011..013 | Vitest | `EstimateSection.test.tsx`, `PlansSection.split.test.tsx` |
| AC-CAE-012 | e2e step | `e2e/AC-IMP-090-site-imprest-journey.spec.ts` |
| AC-CAE-014 | Vitest | existing refusals catalogue test + `check-refusal-codes` |

## Rollback
`rollback/1891_get_imprest_estimate_down.sql` drops both functions; `rollback/1890_imprest_plan_line_splits_down.sql`
drops the triggers, the table and its functions. No existing object is restated, so nothing is re-created.

# Plan: profit per discipline (#2669)

Spec: `docs/specs/discipline-profit.spec.md`. Migrations 1265 and 1266 only (1267-1269 spare). Test first (red, then green).

## Tasks
1. `supabase/tests/1265_discipline_profit.test.sql` (red): AC-DPR-001, 003-008, 015. Seed two disciplines, three BoQ
   items, validated/draft/superseded reports; assert revenue rows, roles, cross-org, setting off, reconciliation.
2. `supabase/migrations/1265_discipline_profit_setting.sql` (+ `rollback/1265_discipline_profit_setting_down.sql`):
   `organizations.discipline_profit_enabled boolean not null default false`; Admin-only write (column grant + existing
   org policy); `boq_items.discipline_id uuid references cost_disciplines(id)`; revoke direct column write on it.
3. `supabase/migrations/1266_discipline_profit_rpcs.sql` (+ rollback): `set_boq_item_discipline(p_item uuid, p_discipline uuid)`
   (definer; role gate = `dsr_may_see_revenue`-style roles incl. own-project PM; same-org active discipline; audit-free,
   touches only that column); `project_discipline_revenue(p_project uuid)` returns `(discipline_id, currency, revenue,
   validated_lines, unrated_lines)`, definer, pinned `search_path`, revoke anon, `(select helper())` wrapping, empty
   when the setting is off, 42501 for a caller who may not see revenue, absent for another org's project.
4. `pmo-portal/src/lib/disciplineProfit.test.ts` (red) then `disciplineProfit.ts`: pure `disciplineProfit(rollup,
   revenueRows)` joining existing `rollupProject().disciplines` (direct, allocated) with revenue; uses `deriveMargin`
   semantics and the existing bigint cent helpers; states: restricted, incomplete, not comparable, loss. AC-DPR-008-012.
5. `pmo-portal/src/lib/db/disciplineProfit.ts`, `src/lib/repositories/disciplineProfit.ts`, hook
   `src/hooks/useDisciplineProfit.ts` (enabled only when setting on and `can('view','workOrderPlan')`).
6. `pmo-portal/pages/project-detail/DisciplineProfit.tsx` (+ test) rendered inside `WorkOrderPlanVsActual.tsx` only when
   the setting is on (AC-DPR-001/002/012/014); shared primitives, DESIGN.md tokens, EN + ID strings in
   `public/locales/{en,id}/workOrderPva.json`; BoQ item form gets an optional discipline picker (`SelectField`), shown only
   when the setting is on; org settings screen gets the Admin toggle.
7. `pmo-portal/e2e/AC-DPR-013-discipline-profit.spec.ts`: Finance opens the tab, sees revenue, cost, margin per
   discipline and the project total (needs local Supabase).
8. Isolation denominator: register the two new RPCs per `scripts/check-isolation-denominator.mjs`; glossary entries
   "Discipline revenue", "Discipline margin"; DD note in `docs/decisions.md`; WPVA spec FR-WPVA-030 pointer.
9. Screenshots (390 and 1440 px, scale 2) to `docs/evidence/1215/2669/`; `scripts/ux-proof.sh` on the project route.

## Traceability
| AC | Owning layer | Proof |
|---|---|---|
| AC-DPR-001, 003-008, 015 | pgTAP | `supabase/tests/1265_discipline_profit.test.sql` |
| AC-DPR-001/002/008-012 | Unit | `src/lib/disciplineProfit.test.ts`, `pages/project-detail/DisciplineProfit.test.tsx` |
| AC-DPR-007 | Layer-1 money test | reconciliation to `work_order_validated_revenue` in the pgTAP file |
| AC-DPR-013 | E2E | `e2e/AC-DPR-013-discipline-profit.spec.ts` |
| AC-DPR-014 | Unit (i18n) | `scripts/check-i18n-completeness.mjs` + screenshots |

## Gates
guards, typecheck, eslint on changed files, `vitest related`; one lock hold: db reset + 1265 test + 0178 x2 + 0646;
isolation-denominator tests; touched e2e; mutation check per spec section 6.

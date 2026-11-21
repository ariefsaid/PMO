# Plan: earned and billed revenue side by side (#2733)

Spec: `docs/specs/earned-billed-revenue.spec.md`. Migrations 1270-1272 only (1273-1274 spare). Stacked on #2669; its
migrations (1265, 1266) are not edited: 1270 replaces `project_discipline_revenue` with `create or replace`. Test first.
Gate change: DB, e2e and screenshots are written but not run; run only guards, typecheck, eslint, touched vitest.

## Tasks
1. `supabase/tests/1270_earned_billed_revenue.test.sql` (red): AC-EBR-001..007. Seed validated/draft/superseded reports,
   invoices (incl. down payment, cancelled), a withdrawn claim, claim lines on two disciplines, a second org, roles.
2. `supabase/migrations/1270_discipline_billed_basis.sql` (+ `rollback/1270_discipline_billed_basis_down.sql` restoring
   1266's body): `create or replace public.project_discipline_revenue` keeping the existing columns and rows, adding
   `billed_claims` rows (live `progress_claim_lines.amount` grouped by BoQ discipline, currency) and `billed_unitemised`
   (project billed work from `work_order_billing` minus itemised). Same gates and setting check, pinned search_path.
3. `supabase/migrations/1271_project_work_order_earned_billed.sql` (+ rollback): `project_work_order_earned_billed(p_project)`
   returns `(work_order_id, currency, earned numeric null, earned_lines int, unrated_lines int, billed numeric,
   billed_complete bool)`; earned null when no validated line; billed from `work_order_billing` (invoiced + pending).
   Definer, `dsr_require_member`, `dsr_may_see_revenue`, setting-off returns nothing, revoke anon.
4. `supabase/migrations/1272_management_pack_earned.sql` (+ rollback): `management_pack_earned()` returns per
   project and currency: earned to date, project cost (open question 1), restricted flag. Setting-off returns nothing;
   `get_management_pack` is untouched. Register the three RPCs in the isolation denominator
   (`scripts/check-isolation-denominator.mjs`, run its tests).
5. `pmo-portal/src/lib/earnedBilledProfit.test.ts` (red) then `earnedBilledProfit.ts`: pure join over `disciplineProfit`
   and `workOrderPlanVsActual` figures producing, per row, earned, billed, gap and margin on each basis with the states
   restricted / not-available / incomplete / not-comparable / cost-unknown; reuse `moneyUnits`, `moneyText`, `figure`
   semantics from `disciplineProfit.ts` (extract shared helper rather than copy). AC-EBR-004, 008-010.
6. DAL + repository + hooks: extend `src/lib/db/disciplineProfit.ts` (`billed_claims` rows already fit the `basis` column;
   `disciplineProfit(rollup, rows, basis)` is called per basis), add `src/lib/db/earnedBilled.ts`,
   `src/lib/repositories/earnedBilled.ts`, `src/hooks/useEarnedBilled.ts`, `src/hooks/useManagementPackEarned.ts`; enabled
   only when the setting is on and the caller may see revenue.
7. UI (read `.claude/skills/restructure/SKILL.md`, DESIGN.md): `pages/project-detail/DisciplineProfit.tsx` and the
   work-order rows of `WorkOrderPlanVsActual.tsx` gain an Earned / Billed / Gap and two-basis margin presentation, only
   while the setting is on (existing render byte-identical when off); `pages/ManagementPack.tsx` gains earned, gap and
   margin columns only while on. EN + ID strings in `public/locales/{en,id}/workOrderPva.json` and `financeHub.json`;
   extend the admin toggle copy in `pages/admin/OrgDisciplineProfit.tsx`.
8. `pmo-portal/e2e/AC-EBR-011-earned-billed.spec.ts` (project tab) and `AC-EBR-012-pack-earned.spec.ts` (written, not run).
9. Docs: glossary ("Earned revenue", "Billed revenue", "Gap between earned and billed"), DD note in `docs/decisions.md`,
   pointer from `discipline-profit.spec.md` §7 ruling 5 and the pack spec. Screenshots to `docs/evidence/1215/2733/`
   (written plan only; not run under the gate change).

## Traceability
| AC | Owning layer | Proof |
|---|---|---|
| AC-EBR-001..003, 005, 007 | pgTAP | `supabase/tests/1270_earned_billed_revenue.test.sql` |
| AC-EBR-004 | pgTAP + Unit | same file; `src/lib/earnedBilledProfit.test.ts` |
| AC-EBR-006 | Layer-1 money test | same file (reconciles to project billed work) |
| AC-EBR-008..010 | Unit | `src/lib/earnedBilledProfit.test.ts`, `pages/project-detail/__tests__/DisciplineProfit.test.tsx` |
| AC-EBR-011, 012 | E2E | `e2e/AC-EBR-011-earned-billed.spec.ts`, `e2e/AC-EBR-012-pack-earned.spec.ts` |
| AC-EBR-013 | Unit (i18n) | `scripts/check-i18n-completeness.mjs` |

## Gates (build phase, per the gate change)
`npm run check:guards`, `npm run typecheck`, `npx eslint --max-warnings=0 <changed>`, `npx vitest related --run <changed>`,
`node --test scripts/check-isolation-denominator.test.mjs`. pgTAP, e2e, screenshots and the mutation run are written or
planned only; the orchestrator runs them on the integration branch.

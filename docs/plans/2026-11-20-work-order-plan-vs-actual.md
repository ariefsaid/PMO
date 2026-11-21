# Plan: plan vs actual and profit per work order (#2519)

Spec: `docs/specs/work-order-plan-vs-actual.spec.md`. Depends on #2517 (merged) and, for the page, #2518.
Executor: Director-dispatched Orca worker (Opus for the allocation/rollup slice). **Ships alone.** Read
`docs/money-path-primer.md`, `docs/specs/cost-attribution.spec.md` §FR-CAT-005/022 and `gross-margin-pnl.spec.md` first.
Migrations: next free numbers in the range the Director assigns at dispatch (after 0951); rollback files required.

## Design
- Pure TS module `pmo-portal/src/lib/workOrderPlanVsActual.ts`: `allocateShared(directByWo, shared, split?)`, `rollup(...)`,
  `margin(...)` delegating to `deriveMargin` for the formula; no I/O. All money figures flow through it, so Layer-1 tests bind to it.
- SQL: tables `work_order_plan_lines(org_id, work_order_id, discipline_id null, kind, amount/quantity, note)` and
  `project_shared_cost_splits(org_id, project_id, work_order_id, percent)` with a definer RPC `set_shared_cost_split(project, jsonb)`
  (sum 100 check, audit) and view/RPC `work_order_cost_amounts` (security_invoker, from #2517 view + each source's money read).
  RLS on both tables, `org_id` stamped by default/trigger, org and project coherence trigger as in 0951.
- Repository `src/lib/repositories/workOrderFinance.ts` (ADR-0017), `can()` gate for plan edit and split edit (ADR-0016).

## Tasks (TDD; money tier)
1. Pure `allocateShared`, with AC-WPVA-004/005/008 as the first failing tests. Mutation-check.
2. Pure `rollup` (WO → discipline → project → contract + "Not assigned"); AC-WPVA-011/012 as Layer-1 tests against fixtures.
3. pgTAP `supabase/tests/<NNNN>_work_order_plan.test.sql`: AC-WPVA-001/002/006/015 (tables + RPC), including a cross-org id and an Engineer.
   Run under `scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db <file>'`.
4. Migration: plan table, split table + RPC, audit rows, rollback.
5. Migration: `work_order_cost_amounts` (money per source, restricted semantics); pgTAP AC-WPVA-009 and project-total equality AC-WPVA-012.
6. Repository + hooks; currency separation AC-WPVA-010; equipment hours AC-WPVA-013.
7. UI: plan editor (shared form primitives), split editor with live sum, plan-vs-actual blocks on the work-order page (#2518) and a project tab. AC-WPVA-007/014. `restructure` skill; `ux-proof.sh`.
8. One E2E `e2e/AC-WPVA-016-plan-vs-actual-matches.spec.ts`.
9. Glossary: Direct cost, Shared cost, Direct margin, Result after shared costs. ADR only if the money seam (open Q1/Q2) forces an irreversible basis choice.

## Gates and review
Standard local final gate (CLAUDE.md), pgTAP files touched, mutation checks quoted. Reviewers: spec, code-quality, security-auditor (RLS on the two tables, role gates). Owner decides the open questions before dispatch.

## Build record (feat/2519-plan-vs-actual, migrations 0997–0999)

The review aligned the cost and billing basis to the decisions recorded in the spec:

| Open question | Taken for v1 | Where |
|---|---|---|
| Q1 money seam | One role-gated `work_order_cost_amounts(project)` read uses the existing project-finance actuals as its cost authority. | 0999 |
| Q2 cost basis | Paid PMO purchases plus the asset-month equipment charge, or the existing ERP ledger basis. Bill-linked payments follow their documents; unmatched amounts remain unassigned. Other billed work is shown separately in project revenue. | 0999 |
| Q3 contract | The contract and project roll-ups are the same under the one-contract-per-project model; Other revenue is stated separately. | pure module |
| Q4 shared pool | An unlinked paid purchase remains unassigned; unlinked ERP actuals use only a valid custom split. Equipment project cost follows the default allocation. | 0999, pure module |
| Q5 indirect budget | Free-standing plan figure, compared to allocated shared cost. | 0997 |
| Q6 crew plan | Hours. | 0997 |
| Q7 currency | Per currency, never blended. A custom split applies only while every work order uses one currency. | pure module |
| Q8 margin readers | Admin, Executive, Finance, PM. | 0997/0999, `can('view','workOrderPlan')` |

Deviations from the plan and spec, for review:
- **Work-order page (FR-WPVA-040, AC-WPVA-016).** #2518's page doesn't exist on this base yet, so the figures sit in the project's contract area for now: each work order has a basis row you can open, and a discipline roll-up follows. The page section and the E2E journey `AC-WPVA-016` landed in #2570 (`docs/plans/2026-11-20-wo-page-plan-vs-actual.md`).
- Plan editing in the UI is per whole work order. Per-discipline plan figures are visible and their editor is a follow-up.

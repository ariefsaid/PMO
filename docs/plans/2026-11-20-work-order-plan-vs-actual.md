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

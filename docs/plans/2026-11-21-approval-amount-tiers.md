# Approval Amount Tiers Implementation Plan (#2695)

> Spec: `docs/specs/approval-amount-tiers.spec.md`. **Ships alone**; money and approval path; Director-dispatched Orca worker, three reviewers. Gate change: write DB/e2e tests, do not run them; the orchestrator runs them once per wave. Base: dev.

## Migrations (numbers 1290-1292 only; 1293-1294 held in reserve)
- **1290_approval_tiers_settings.sql** + rollback: table `spend_approval_settings` (one row per org, `tiers_enabled` default false, RLS Admin-only writes, audit trigger); `spend_approvers.min_amount`; insert grant widened; add-audit carries `min_amount`. No new security-definer client function.
- **1291_spend_approvers_for_amount.sql** + rollback: `spend_approvers_for_amount(p_org uuid, p_project uuid, p_amount numeric, p_currency text) returns setof spend_approvers`, `language sql stable security invoker`, `set search_path = public, pg_temp`. Flag off: all rows of (org, project-or-null). Flag on: `target := case when p_amount is null or p_amount < 0 or p_currency is distinct from org default_currency then max(coalesce(min_amount,0)) else coalesce(max(coalesce(min_amount,0)) filter (where coalesce(min_amount,0) <= p_amount), min(coalesce(min_amount,0))) end` over the scope's rows; return rows whose `coalesce(min_amount,0) = target`. RLS unchanged (invoker); grants as the route function.
- **1292_spend_route_tiers.sql** + rollback: `create or replace function spend_approval_route_from_figures` as in `1016` with exactly the five `from public.spend_approvers sa` reads replaced by `from public.spend_approvers_for_amount(p_org_id, <p_project_id | null>, p_amount, p_currency) sa` (the `where sa.org_id/project_id` predicates stay). Nothing else in the body changes (diff must show only those lines). Rollback restores the 1016 body. `spend_approval_route`, `transition_procurement`, notify and both list reads call it and need no change; verify by grep that no live function other than imprest (0422, 0426, untiered by design) reads `spend_approvers` directly (the 0247 copy is superseded by 1016).
- Isolation denominator: fragment `scripts/isolation-probe-denominator.d/2695-approval-tiers.json` plus a fixture row in `scripts/isolation-fixtures.sql`. No new client-callable definer, so the 0178 allow-list is unchanged.

## Slices (test-first, in this order)
1. pgTAP `supabase/tests/spend_approval_tiers.test.sql` (AC-TIER-001..011); migrations 1290-1292. Existing `spend_approval_*` and `spend_approvers_config` pgTAP files stay untouched and must stay green (the flag-off proof).
2. DAL/repository: `pmo-portal/src/lib/db/spendApprovers.ts` (`min_amount` on rows and insert; `setSpendApprovalTiersEnabled` (insert or update the settings row), `getSpendApprovalTiersEnabled` reading the settings row, upsert on write), `src/lib/repositories/contracts/admin.ts` + `admin.ts` (ADR-0017), `database.types.ts` additions by hand to match (no regen against the shared DB). Vitest: extend `spendApprovers.test.ts`.
3. UI: `pmo-portal/pages/admin/SpendApprovers.tsx` (switch, From-amount via `TextField`, tier label, `can('manage','orgAccounting')`), strings in en and id spend-approver namespace (find with `grep -rn "spendApprovers" pmo-portal/public/locales`). Request page: show line budget/used from `approvalRoute.ts` fields in the existing decision strip (`pmo-portal/pages/ProcurementDetails.tsx`), text only. Read `restructure` and `docs/ux/screen-rules.md`. Vitest AC-TIER-012/013 in the existing test files (new cases only).
4. e2e `pmo-portal/e2e/serial/AC-TIER-014-amount-tier-approval.spec.ts` (written, not run; follow `docs/e2e-parallel-conventions.md`, isolation tag).
5. Glossary: add "approval tier" to `docs/glossary.md`. No ADR (additive filter on an existing rule).

## Owning layer per AC
AC-TIER-001..011 pgTAP (`spend_approval_tiers.test.sql`); 012, 013 Vitest; 014 e2e.

## Mutation-check plan (written as a note; orchestrator runs)
1. `spend_approvers_for_amount`: make the flag-on branch return all rows, so AC-TIER-002/003 must go red.
2. Make the flag check read true always, so AC-TIER-001 must go red.
3. Make the NULL/foreign-currency case choose the lowest tier, so AC-TIER-006 must go red.
4. Drop the Admin check from the `spend_approval_settings` update policy, so AC-TIER-008 must go red.
Restore each; file green.

## Gates (this wave)
`npm run check:guards`, `npm run typecheck`, `npx eslint --max-warnings=0 <changed>`, `npx vitest related --run <changed source>`. No DB, e2e, screenshot or mutation runs (Director gate change).

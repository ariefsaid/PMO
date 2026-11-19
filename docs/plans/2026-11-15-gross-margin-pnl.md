# Gross-margin P&L implementation plan

> **For agentic workers:** Orca worker per `docs/orca-dispatch.md`; red-green TDD. Do not start before the owner signs off the questions at the end.

**Goal:** Gross margin first, company and project, on every plan (D16, #1860).
**Spec:** `docs/specs/gross-margin-pnl.spec.md`.
**Architecture:** One pure derivation in `src/lib/projectFinances.ts` serves project and company. A new read-only RPC returns per-project, per-month revenue and cost. The Statements page gains a core gross-margin block; ERP blocks stay behind `financial_statements`.
**Migration:** `NNNN` — number on request (recheck `git ls-tree origin/dev supabase/migrations`; highest today is `0882`). Rollback `supabase/migrations/rollback/NNNN_company_gross_margin_down.sql`.
**Money path:** read-only, ships as one batch branch; security-auditor reviews the RPC.

## Tasks

1. **PMO-basis project margin (FR-GM-002/003, AC-GM-001/002).**
   Test first in `pmo-portal/src/lib/projectFinances.marginPosition.test.ts`: PMO basis, revenue `1000.00`, spent `400.00` → `{amount:'600.00', reason:null}`; incomplete spend → `actuals-unavailable`. Edit `deriveMargin` (`projectFinances.ts:506`): replace the "PMO never yields a margin" branch with: when `coverage.basis === 'pmo'`, use the PMO spent amount from `deriveActualPosition` if `complete`, else `actuals-unavailable`. Keep the ERP branch byte-identical.
   Verify: `cd pmo-portal && npx vitest run src/lib/projectFinances`.
2. **Company aggregator (FR-GM-001/005/007/011, AC-GM-005/006).**
   Test first `pmo-portal/src/lib/companyGrossMargin.test.ts`; create `src/lib/companyGrossMargin.ts` exporting `buildCompanyGrossMargin(rows)`: calls `deriveMargin` per project row, sums with `moneyUnits`/`moneyText`, groups per currency, returns `{months, byCurrency, projects:[{id, margin|reason}], partial}`. Never adds across currencies.
   Verify: `npx vitest run src/lib/companyGrossMargin`.
3. **RPC `get_company_gross_margin(p_from date, p_to date)` (FR-GM-004/010, AC-GM-003/004/007).**
   pgTAP first `supabase/tests/company_gross_margin.test.sql`: two projects, no ERP, invoices and paid purchases; total equals the sum of per-project results; two months; restricted role and other-org return no rows. Migration: `security invoker`, `set search_path = public, pg_temp`, org from the caller's profile (never a parameter), role guard as in `project_pmo_spent_position` (0700), returns `(project_id, month, currency, work_revenue text, cost text, complete bool, ledger_basis text)`. `revoke all … from public, anon; grant execute … to authenticated`. Reuses `project_pmo_spent_position` and the invoice work-revenue logic behind `get_project_finances` (`0290`); no copy of either.
   Verify: `scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db supabase/tests/company_gross_margin.test.sql'`.
4. **Repository and hook.** Add `getCompanyGrossMargin` in `src/lib/db/companyGrossMargin.ts`, expose on `repositories`, hook `src/hooks/useCompanyGrossMargin.ts` (query key includes org id; enabled on `may('view','financialStatements')`). Test with a mocked supabase client: `npx vitest run src/hooks/useCompanyGrossMargin`.
5. **Gross-margin block (FR-GM-006/008, AC-GM-005/006/009).**
   Test first `src/components/financial-statements/GrossMarginBlock.test.tsx`: monthly table, per-project rows, reason copy from the existing `projectDetail.money.marginOut*` keys (move to a shared helper rather than duplicating), per-currency totals, partial note. Create `GrossMarginBlock.tsx` using DESIGN.md tokens; add strings to `src/locales/*` in the same PR.
6. **Plan gating (FR-GM-009, AC-GM-008).**
   Test first in `pages/FinancialStatements` tests: switch off → block shows, the statement catalogue and report queries are not enabled. In `pages/FinancialStatements.tsx` render `GrossMarginBlock` first and wrap the existing sections in `useFeature('financial_statements')`; pass `enabled:false` to the catalogue and Odoo hooks when off. Remove the `feature: 'financial_statements'` gate from the route entries in `routeMatch.ts:226` and `Rail.tsx:95` (page gates the Pro blocks). Update `Rail.features.test.tsx`.
   Verify: `npx vitest run pages/FinancialStatements src/components/shell`.
7. **e2e journey (AC-GM-010).** `pmo-portal/e2e/AC-GM-010-company-gross-margin.spec.ts` per `docs/e2e-parallel-conventions.md` (isolation tag): Starter org, two projects, assert company margin equals the sum of the two project pages' margins.
   Verify: `scripts/e2e-local.sh AC-GM-010`.
8. **Gates and docs.** `npm run check:guards`, `npm run typecheck`, `npx eslint --max-warnings=0 <touched>`; `scripts/ux-proof.sh` on `/finance/statements`; add terms to `docs/glossary.md` (gross margin, project cost).

## Traceability (ADR-0010)

| AC | Layer | Owning test |
|---|---|---|
| AC-GM-001, 002 | Vitest | `projectFinances.marginPosition.test.ts` |
| AC-GM-003, 004, 007 | pgTAP | `supabase/tests/company_gross_margin.test.sql` |
| AC-GM-005, 006 | Vitest | `companyGrossMargin.test.ts`, `GrossMarginBlock.test.tsx` |
| AC-GM-008, 009 | Vitest | `FinancialStatements` page tests |
| AC-GM-010 | e2e | `e2e/AC-GM-010-company-gross-margin.spec.ts` |

## Owner questions

1. PMO-basis cost = paid spend (the Budget tab's Spent), not spend plus commitments? Recommended: yes, paid spend; open commitments shown beside it, never netted.
2. Month attribution: revenue by invoice date, PMO cost by payment date, and ERP-basis orgs get revenue by month with cost as a to-date total (ERP actuals carry no month)? Recommended: yes.
3. Keep one `/finance/statements` route, un-gated, with Pro blocks gated inside the page? Recommended: yes.

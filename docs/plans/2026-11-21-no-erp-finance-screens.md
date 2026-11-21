# Plan: profit and finance screens with no accounting system (#2734)

Spec: `docs/specs/no-erp-finance-screens.spec.md`. **No migration** (range 1295-1299 unused). No setting. Gate change:
no DB, e2e, screenshot or mutation runs; write them. Run only `npm run check:guards`, `npm run typecheck`, eslint on
changed files, touched vitest files. Test first.

## Tasks
1. Walk (read only): confirm each starred §2 verdict by reading the screen's source and record the result in the spec
   table (Works / Change / Hidden). Report any screen that shows "set up accounting" or an ERP-only empty state to a
   no-ERP org.
2. `pmo-portal/src/hooks/useNoAccountingSystem.test.ts` (red) then `useNoAccountingSystem.ts`: returns `'unknown'` while
   `useExternalDomainOwnership` or `useDomainOwnershipMode().orgBound` is loading or errored, `true` only when ownership
   has no externally-owned row and `orgBound === false`, else `false`. Reuses both hooks, no new query. AC-NEF-004/005.
3. `pmo-portal/src/components/financial-statements/ManagementProfitLossCard.test.tsx` (red) then the component
   (`Card`/`ListState`, `Button`): title, one-line ledger explanation, "Open reports" (`navigate('/finance/reports')`,
   shown only when `useFeature('management_pack')`), secondary "Set up accounting" when passed. AC-NEF-001/003.
4. `pmo-portal/pages/FinancialStatements.tsx`: when `useNoAccountingSystem() === true` and the section state is
   `unavailable`, render the card in place of the empty state (reuse `unavailableAction` for the Admin button). Add a
   page-level unit test file `pages/FinancialStatements.noErp.test.tsx` (do not edit existing tests). AC-NEF-001..005.
5. `pmo-portal/pages/finance/FinanceHub.tsx`: Net profit tile `to` / `unavailableReason` / `hiddenLink` switch on
   `useNoAccountingSystem() === true`; new `pages/finance/FinanceHub.noErp.test.tsx`. AC-NEF-006.
6. i18n: `public/locales/{en,id}/finance.json` keys `statements.managementTitle`, `statements.managementLine`,
   `statements.openReports`; `financeHub.json` key `hub.fix.statements.seeManagement`. i18n parity test stays green.
7. E2E (written, not run), one per screen as a no-ERP org (fresh org seed with no ownership rows and no binding), under
   `pmo-portal/e2e/AC-NEF-0NN-*.spec.ts` following `e2e-parallel-conventions.md` (`@e2e-isolation` tag):
   `AC-NEF-001-statements-leads-to-pack` (001/002), `AC-NEF-010..021` per §2 rows 1-12 (open the route/tab as the
   right role; assert its own records render and no "Set up accounting" text), `AC-NEF-022-erp-purchases-not-linked`.
8. Docs: glossary entry "Management profit and loss" (the Reports screen's earned/cost/margin view; not a ledger
   statement); DD note in `docs/decisions.md`; pointer line in `docs/specs/no-erp-revenue.spec.md` §2.
   Screenshots (phone 390, desktop 1440, scale 2) of the card to `docs/evidence/1215/2734/`: written plan only.

## Traceability
| AC | Owning test |
|---|---|
| AC-NEF-001 | `FinancialStatements.noErp.test.tsx`, `ManagementProfitLossCard.test.tsx`, E2E `AC-NEF-001` |
| AC-NEF-002 | E2E `AC-NEF-001-statements-leads-to-pack` |
| AC-NEF-003 | `ManagementProfitLossCard.test.tsx` |
| AC-NEF-004, 005 | `useNoAccountingSystem.test.ts`, `FinancialStatements.noErp.test.tsx` |
| AC-NEF-006 | `FinanceHub.noErp.test.tsx` |
| AC-NEF-007 | E2E `AC-NEF-010..022` |
| AC-NEF-008 | i18n parity test + screenshots |

## Build notes
E2E is two serial-lane files under `e2e/serial/` (the seed org has an active accounting binding; `noErpOrg.ts` disconnects it for the run, asserts the no-ERP precondition, restores it) (`AC-NEF-001-statements-leads-to-pack`, `AC-NEF-010-no-erp-screens` holding AC-NEF-010..022 as one test each). `FinanceHub` takes an optional `noAccounting` prop from the new `pages/finance/FinanceHubRoute.tsx` (App lazy import), so existing FinanceHub tests are untouched.

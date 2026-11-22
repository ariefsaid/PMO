# Plan: hide prices from requesters (#2699)

Spec: `docs/specs/hide-prices.spec.md`. Branch stacked on `feat/2709-role-set`. Migrations 1215-1219 each with a rollback in `supabase/migrations/rollback/`.

## Test-first order (owning layer per AC in the spec)

1. **pgTAP** `supabase/tests/2699_hide_prices_*.test.sql` (written first, red): AC-001..AC-007. Fixtures: one org, actors of each class (legacy five;
   built-in manager, buyer, finance_officer, billing_officer, storekeeper, foreman); a second org for AC-005. Mutation note in each file header
   naming the assertion that must go red. Written, not run in this lane (shared DB reserved for the Director's wave run).
2. **vitest** `pmo-portal/src/auth/canSeePrices.test.ts` (AC-008), screen tests for Procurement, Stock documents, Stock reports (AC-009),
   Admin toggle (AC-010).
3. **E2E** `pmo-portal/e2e/AC-HP-001-hide-prices.spec.ts` (serial lane, written not run).

## Build

| Step | Files | Notes |
|---|---|---|
| 1215 | `1215_hide_prices_setting.sql` (+ rollback) | column `organizations.hide_prices_from_requesters`; `org_hide_prices_enabled(uuid)`, `get_hide_prices_enabled()`, `set_hide_prices_enabled(boolean)` (Admin), `actor_may_see_prices()` |
| 1216 | `1216_hide_prices_procurement_views.sql` (+ rollback) | `security_invoker` masked views for S1-S4, price columns `case when (select actor_may_see_prices()) then col end`; grants to authenticated |
| 1217 | `1217_hide_prices_stock_views.sql` (+ rollback) | S5, S6 views; stock valuation RPCs and S7 RPCs call the helper |
| 1218 | `1218_hide_prices_derived_amounts.sql` (+ rollback) | S7b masked twins of the derived-amount reads (originals untouched); test `supabase/tests/1218_hide_prices_derived.test.sql` |
| 1219 | spare | left unused |
| inventories | `supabase/tests/inventory/anon-executable-definers/2699-hide-prices.txt`, `scripts/isolation-probe-denominator.d/2699-hide-prices.json` | new definers and views |
| FE seam | `src/auth/priceVisibility.ts` (`canSeePrices`), `src/lib/priceReadPath.ts` (`priceSource`, `maskSelection`), `src/hooks/useHidePrices.ts`, `src/lib/repositories/hidePrices.ts` (new standalone module), `src/lib/db/hidePrices.ts` | no method added to an existing repository |
| FE reads | procurement and stock DAL reads switch to the masked views (`procurements.ts`, `procurementLifecycle.ts`, `procurementCrud.ts` (stock reports follow the RPC seam)) with the same selections | existing DAL tests untouched; new view-read tests added beside them |
| FE screens | `pages/Procurement*`, stock pages: render price columns only when `canSeePrices`; reuse existing column definitions | restructure skill: phone and desktop, no empty column |
| Admin | Administration > Organisation: toggle component beside the built-in roles toggle; `src/lib/i18n` en + id keys | Admin-only affordance, server enforced |
| docs | `docs/glossary.md`: "Requester (price visibility)", "Hide prices setting" | |

## Gates (static only in this lane)

`npm run check:guards`, `npm run typecheck`, `npx eslint --max-warnings=0 <changed>`, `vitest run` on the new files and affected directories.

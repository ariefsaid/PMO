# Vendor stock location Implementation Plan (#2683)

Spec: `docs/specs/stock-vendor-location.spec.md`. Money path (stock ledger): Director-verified; ships as one branch, head of the
#2690 / #2691 / #2693 / #2676 chain. Read first: `supabase/migrations/1029_stock_site_work_locations_tags.sql`,
`0413_stock_posting_engine.sql` (`stock_apply_transfer`), `0418_stock_reorder.sql`, `0415_stock_read_rpcs.sql`.

## Decisions
- One additive migration, number **1300**; rollback `supabase/migrations/rollback/1300_stock_vendor_location_down.sql`.
- Engine untouched (`stock_apply_transfer`, `stock_write_entry`, `stock_validate_payload` not edited). Kind rules sit in small triggers
  and table checks, as in 1029.
- A vendor location has no project (table check) so it falls outside the 1029 work-order rule and the 1031 balances without edits.
- Only two shipped functions are replaced, each with a one-clause change: `get_stock_on_hand` (adds `vendor_name` for vendor rows)
  and `get_reorder_suggestions` (a transfer into a vendor location is not usage). Rollback restores the 0415 / 0418 bodies.

## Migration 1300_stock_vendor_location.sql
1. `alter table stock_warehouses drop constraint stock_warehouses_kind_check; add ... check (kind in ('central','site','yard','staging','vendor'))`.
2. `alter table stock_warehouses add column vendor_company_id uuid references companies(id)`; check `stock_warehouses_vendor_shape`:
   `kind <> 'vendor' or project_id is null`, and `kind = 'vendor' or vendor_company_id is null`.
3. Extend `check_stock_warehouse_parent()` (invoker, caller's RLS): `vendor_company_id` must be a company of `new.org_id` with `type = 'Vendor'`
   else `STK_NOT_FOUND`. Rebuild the trigger list unchanged (`create or replace` only).
4. `grant insert (vendor_company_id)` / `grant update (vendor_company_id)` on `stock_warehouses` to authenticated.
5. Trigger `stock_documents_zz_vendor_kind` (before insert or update of kind, warehouse_id on `stock_documents`, definer):
   kind in (receive, issue, return) and the warehouse is `vendor` -> `STK_VENDOR_LOCATION` (errcode P0001). Marker `-- mut:vendor_kind`.
6. Extend `guard_warehouse_move_with_work_orders()`'s sibling check: a before-update trigger refusing change of `kind` to `vendor`
   while `project_id` is set is already the table check (item 2); no new function. A kind change away from `vendor` clears nothing
   automatically (the check forces `vendor_company_id` null first).
7. `create or replace get_stock_on_hand` with `|| case when w.kind = 'vendor' then jsonb_build_object('vendor_name', c.name) else '{}' end`
   (left join companies c); everything else copied verbatim from 0415.
8. `create or replace get_reorder_suggestions` with `dw.kind in ('central','vendor')` in place of `dw.kind = 'central'` (marker kept `-- mut:central_excl`).
9. No new table, no new client-callable definer: no inventory or denominator fragment. Run `anon-definer-inventory.mjs` anyway in the gate.

## Tests (test-first)
- `supabase/tests/1300_stock_vendor_location.test.sql` (pgTAP): AC-SVL-001..009. Fixtures follow `supabase/tests/stock_site_work.test.sql`
  (second org, Vendor / Client companies, central + site warehouses, an item, roles Admin and storekeeper).
- Mutation checks (report output lines): break `vendor_kind` trigger (AC-SVL-004 red); remove the vendor term in the reorder clause (AC-SVL-008 red);
  drop the `type = 'Vendor'` company check (AC-SVL-001 red). Restore each.
- Unit `pmo-portal/pages/stock/StockSetup.test.tsx` (new cases only, existing untouched): AC-SVL-010.
- Unit `pmo-portal/src/lib/import/__tests__/stockLocationDescriptor.test.ts` (new file if none covers it): AC-SVL-011.
- E2E `pmo-portal/e2e/AC-SVL-012-vendor-location-round-trip.spec.ts` (new; JOB-F20 stays as is): admin creates a vendor location, transfers
  out and back, on-hand shows it at the vendor between. Helper `makeWarehouse` in `e2e/support/stockFixture.ts` gets its `kind` type widened to include `'vendor'`.

## Front end (small)
- `pmo-portal/src/lib/db/stockMaster.ts`: `StockWarehouseInput.kind` adds `'vendor'`, `vendorCompanyId: string | null`; insert/update send it. Same widening of the kind union in `stockReports.ts`, `stockSiteWork.ts`.
- `pmo-portal/pages/stock/StockSetup.tsx`: kind options add `vendor`; for vendor hide the Project field and show a Vendor-company `SelectField` (Vendor companies, optional), via the existing companies repository; the list shows the kind pill (+ vendor name).
- `pmo-portal/pages/stock/StockOnHand.tsx`: show the vendor name beside the location for vendor rows; the `warehouseKind` cast widened.
- `pmo-portal/src/lib/import/stockItemDescriptor.ts`: KINDS adds `vendor`; `validateRow` refuses a project on `vendor`; hint text updated; EN/ID strings in `public/locales/{en,id}/import.json`.
- Strings: `setup.kinds.vendor`, `setup.form.warehouse.vendorCompany` (+ help) in `public/locales/{en,id}/stock.json`.
- Types: regenerate-by-hand the `stock_warehouses` row type in `src/lib/supabase/database.types.ts` (new column, kind union).
- Glossary: add **Vendor location** to `docs/glossary.md`. No ADR (not irreversible, no new pattern).
- Screenshots (Setup form with Vendor kind; On-hand with a vendor row) phone 390 and desktop 1440, deviceScaleFactor 2, under `docs/evidence/1215/2683/`.

## Gate commands
`npm run check:guards`, `npm run typecheck`, eslint on touched files, `npx vitest related --run <touched>`, then under the DB lock:
reset + `node scripts/anon-definer-inventory.mjs` + `supabase test db supabase/tests/1300_stock_vendor_location.test.sql` plus the existing
`stock_site_work`, `1102_*`, `1100_*`, stock reorder and read-RPC tests (untouched) + 0178 + 0646; then e2e fragment `AC-SVL-012` and `JOB-F20`.

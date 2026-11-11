-- Round trip for #1319 (NFR-PFE-011): 0362 -> 0361 -> 0360 down, then up again. Run by
-- scripts/test-procurement-flexible-rollback.sh, which inlines the migration files at the markers.
begin;
select plan(7);
-- @0362_DOWN@
select hasnt_function('public','lock_procurement_for_record', 'down 0362: record lock function gone');
select hasnt_function('public','advance_procurement_on_record', 'down 0362: derivation trigger function gone');
-- @0361_DOWN@
-- @0360_DOWN@
select hasnt_table('public','procurement_erp_links','down: link table gone');
select hasnt_column('public','organizations','procurement_gates','down: gates column gone');
-- @0360_UP@
-- @0361_UP@
-- @0362_UP@
select has_table('public','procurement_erp_links','up again: link table');
select has_function('public','link_erp_purchase_documents', array['jsonb','boolean'], 'up again: link RPC');
select has_trigger('public','purchase_orders','zz_purchase_orders_advance', 'up again: an order derives status');
select * from finish();
rollback;

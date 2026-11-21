-- 1485_stock_warehouse_cover_insert_grant.sql - #2694 x #2683: the New-location form sends cover_value on insert.
-- 1440 granted UPDATE on the column only, so creating a location (the form always sends the field) was refused 42501.
-- RLS (stock_warehouses insert policy) stays the authority; this widens the column grant only.
-- Reversal: supabase/migrations/rollback/1485_stock_warehouse_cover_insert_grant_down.sql.
grant insert (cover_value) on public.stock_warehouses to authenticated;

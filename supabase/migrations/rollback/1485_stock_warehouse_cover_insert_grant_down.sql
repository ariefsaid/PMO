-- rollback/1485_stock_warehouse_cover_insert_grant_down.sql
revoke insert (cover_value) on public.stock_warehouses from authenticated;

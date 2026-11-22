-- 1590_stock_item_consumable_grant_down.sql
revoke insert (consumable), update (consumable) on public.stock_items from authenticated;

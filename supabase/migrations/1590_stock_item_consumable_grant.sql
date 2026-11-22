-- 1590_stock_item_consumable_grant.sql
-- The item form sets `stock_items.consumable`: authenticated may insert and update that one column, as for the sibling item columns
-- (0412, 1029, 1305). Row security is unchanged: who may write an item row is decided by the existing policies.
-- Reversal: rollback/1590_stock_item_consumable_grant_down.sql.
grant insert (consumable) on public.stock_items to authenticated;
grant update (consumable) on public.stock_items to authenticated;

-- rollback/1217_hide_prices_stock_views_down.sql
drop view if exists public.stock_document_lines_masked;
drop view if exists public.stock_ledger_masked;
drop view if exists public.stock_balances_masked;
create or replace function public.stock_can_see_cost() returns boolean
  language sql stable set search_path = public as $$
  select coalesce(public.role_rank(public.auth_role()) >= 20, false)
$$;

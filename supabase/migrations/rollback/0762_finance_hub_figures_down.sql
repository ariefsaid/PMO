-- Rollback of 0762_finance_hub_figures.sql (#1988): drop the Finance hub's narrow figures read.
revoke all on function public.get_finance_hub_figures() from public, anon, authenticated, service_role;
drop function public.get_finance_hub_figures();

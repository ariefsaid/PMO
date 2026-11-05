-- Reverse 0694_budget_distribution_snapshot.sql.
revoke all on function public.get_budget_distribution_snapshot(uuid) from public, anon, authenticated;
drop function public.get_budget_distribution_snapshot(uuid);

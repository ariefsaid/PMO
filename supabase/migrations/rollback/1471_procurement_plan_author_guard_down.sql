-- 1471_procurement_plan_author_guard_down.sql — reverses 1471: removes the plan-author guard.
drop trigger if exists procurements_guard_plan_author on public.procurements;
drop function if exists public.guard_procurement_plan_author();

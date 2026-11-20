-- 1076_consumable_plan_down.sql — reverses 1076. Loses the stored consumable plans and their adjustments.
-- Run after 1077's rollback (1077's mrq_plan_figure reads this table) and before 1075's.
begin;
drop function if exists public.cus_standard_match_counts();
drop function if exists public.cus_get_plan(uuid);
drop function if exists public.cus_adjust_plan_line(uuid, uuid, numeric, text);
drop function if exists public.cus_generate_plan(uuid);
drop function if exists public.cus_assert_planner(uuid, boolean);
drop function if exists public.cus_plan_fingerprint(uuid);
drop function if exists public.cus_plan_matches(uuid);
drop table if exists public.work_order_consumable_plan_lines;
commit;

-- Reverse of 1890_imprest_plan_line_splits.sql. Nothing existing was restated, so nothing is re-created.
drop function if exists public.delete_imprest_plan_line_split(uuid);
drop function if exists public.save_imprest_plan_line_split(uuid, uuid, numeric);
drop trigger if exists imprest_plan_lines_below_splits on public.imprest_plan_lines;
drop function if exists public.refuse_line_below_splits();
drop table if exists public.imprest_plan_line_splits;   -- its policy, trigger and index go with it
drop function if exists public.stamp_imprest_split_org();

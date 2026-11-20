-- Reverses 1098_work_order_section_reads.sql (#2576).
drop function if exists public.work_order_section_progress(uuid);
drop view if exists public.work_order_section_readiness;
drop function if exists public.work_order_section_rollup(uuid);

-- Reverses 1414_safety_summary.sql.
drop function if exists public.get_safety_summary_detail(text, uuid, date);
drop function if exists public.get_safety_summary(uuid, date);

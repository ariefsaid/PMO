-- Reverses 1742_manpower_need_notices.sql.
drop trigger if exists manpower_needs_outcome_notice on public.manpower_needs;
drop function if exists public.notify_manpower_need_outcome();
drop function if exists public.my_manpower_to_fill();

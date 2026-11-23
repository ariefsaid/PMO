-- Reverse of 1831_clearance_target_days.sql.
drop function if exists public.person_clearance_due();
drop table if exists public.person_clearance_overdue_notices;
drop function if exists public.clearance_due_on(timestamptz, timestamptz, smallint, text);
drop trigger if exists clearance_items_z_target_stamp_trg on public.clearance_items;
drop function if exists public.clearance_items_target_stamp();
alter table public.clearance_items drop constraint clearance_items_target_stamp, drop column target_set_at, drop column target_days;

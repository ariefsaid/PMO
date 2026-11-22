-- Reverses 1740_manpower_needs.sql (1741 first).
drop table if exists public.manpower_need_people;
drop table if exists public.manpower_needs;
drop function if exists public.guard_manpower_need_person();
drop function if exists public.guard_manpower_need();
drop function if exists public.manpower_can_manage();

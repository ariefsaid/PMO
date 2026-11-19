-- 0988_crews_roster_down.sql — reverse 0988. Reverse 0990 and 0989 first. btree_gist stays (shared extension).
drop function if exists public.work_order_roster(uuid, date);
drop table if exists public.work_order_crews;
drop table if exists public.crew_members;
drop table if exists public.crew_workers;
drop table if exists public.crew_standard_roles;
drop table if exists public.crews;
drop function if exists public.crew_can_manage();
drop function if exists public.guard_crew_refs();

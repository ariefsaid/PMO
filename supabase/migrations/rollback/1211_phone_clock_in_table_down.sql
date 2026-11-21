-- rollback/1211_phone_clock_in_table_down.sql
drop table if exists public.phone_check_ins;
drop function if exists public.phone_check_in_is_supervisor();

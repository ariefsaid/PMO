-- rollback/1213_phone_clock_in_decide_down.sql
drop function if exists public.phone_check_in_requests();
drop function if exists public.phone_check_in_decide(uuid, boolean, text);
drop function if exists public.phone_check_in_may_decide(uuid);

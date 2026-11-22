-- Reverse of 1710_headcount_days.sql. DATA LOSS: every head-count line is deleted with the table. Reverse 1722 and 1723 first.
drop function if exists public.clear_headcount_day(uuid);
drop function if exists public.approve_headcount_day(uuid);
drop function if exists public.record_headcount_day(uuid, uuid, date, uuid, integer);
drop table if exists public.headcount_days;

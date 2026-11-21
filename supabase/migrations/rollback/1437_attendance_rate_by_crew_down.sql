-- Reverses 1437_attendance_rate_by_crew.sql. The read holds no data of its own; only the function goes.

drop function if exists public.attendance_rate_by_crew(date, date);

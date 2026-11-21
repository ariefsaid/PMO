-- Reverses 1241_leave_rpcs.sql.
drop function if exists public.leave_on_date(date);
drop function if exists public.leave_requests_visible();
drop function if exists public.leave_request_cancel(uuid);
drop function if exists public.leave_request_decide(uuid, text, text);
drop function if exists public.leave_request_submit(uuid, uuid, date, date, text);
drop function if exists public.leave_enabled();

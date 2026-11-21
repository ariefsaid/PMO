-- Reverses 1240_leave_requests.sql (reverse 1242 and 1241 first).
drop table if exists public.leave_requests;
drop table if exists public.leave_types;
drop function if exists public.guard_leave_refs();
drop function if exists public.leave_authority(uuid);
alter table public.organizations drop column if exists leave_approver_role, drop column if exists leave_requests_enabled;

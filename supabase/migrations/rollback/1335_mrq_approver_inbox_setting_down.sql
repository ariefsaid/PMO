-- Reverses 1335_mrq_approver_inbox_setting.sql (run 1337 and 1336 reversals first).
drop function if exists public.mrq_set_approver_inbox(boolean);
drop function if exists public.mrq_approver_inbox_on(uuid);
alter table public.material_request_settings drop column if exists approver_inbox;

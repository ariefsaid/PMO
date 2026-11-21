-- Reverses 1336_mrq_step_notifications.sql (1337 first). Removes the feature's notifications too.
drop trigger if exists material_requests_notify_trg on public.material_requests;
drop function if exists public.mrq_request_notify_trg();
drop trigger if exists material_request_steps_notify_trg on public.material_request_steps;
delete from public.notifications where metadata ? 'mrq_step_id';
drop function if exists public.mrq_step_notify_trg();
drop function if exists public.mrq_sync_step_notifications(uuid);
drop function if exists public.mrq_step_recipients(uuid);

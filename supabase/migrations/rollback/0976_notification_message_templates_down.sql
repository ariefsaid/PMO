drop trigger if exists notifications_message_immutable on public.notifications;
drop trigger if exists notifications_message_template on public.notifications;
drop function if exists public.notifications_message_template_guard();
alter table public.notifications drop column if exists message_params, drop column if exists message_key;

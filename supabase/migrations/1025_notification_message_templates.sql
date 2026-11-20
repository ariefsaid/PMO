-- New notifications retain the origin of their wording; existing rows are not rewritten.
alter table public.notifications
  add column message_key text,
  add column message_params jsonb;

-- This trigger runs as the inserting role. Authenticated clients cannot select an app template;
-- trusted producers may choose a known template, with user content confined to its parameters.
create function public.notifications_message_template_guard()
returns trigger language plpgsql set search_path = public, pg_temp as $$
declare
  v_budget_owner name;
begin
  if tg_op = 'UPDATE' then
    if new.message_key is distinct from old.message_key or new.message_params is distinct from old.message_params then
      raise exception 'notification message is immutable' using errcode = '42501';
    end if;
    return new;
  end if;

  select pg_get_userbyid(p.proowner) into v_budget_owner
    from pg_catalog.pg_proc p
   where p.oid = 'public.archive_budget_version_with_cancel_intent(uuid,boolean,uuid)'::regprocedure;

  if current_user = v_budget_owner
     and new.metadata->>'action_required' = 'budget-archive-live-erp'
     and new.body = 'ERPNext may still be enforcing a budget for this project after this archive. Cancel the listed ERPNext Budget documents, or activate a new PMO budget.' then
    new.message_key := 'budgetArchiveWarning';
    new.message_params := '{}'::jsonb;
  elsif current_user = 'service_role'
     and new.message_key in ('unassignedInvoice', 'budgetCancellationHeld', 'budgetRetryAuthorization', 'budgetPushFailed')
     and jsonb_typeof(new.message_params) = 'object' then
    null;
  else
    new.message_key := 'literal';
    new.message_params := jsonb_build_object('body', new.body);
  end if;
  return new;
end; $$;

create trigger notifications_message_template before insert on public.notifications
  for each row execute function public.notifications_message_template_guard();
create trigger notifications_message_immutable before update on public.notifications
  for each row execute function public.notifications_message_template_guard();

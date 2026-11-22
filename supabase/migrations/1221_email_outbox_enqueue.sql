-- 1221_email_outbox_enqueue.sql — #2711: queue one email per recipient from an in-app notification.
-- 1) notify_workflow_user gets an optional p_email_event (the hook future producers, e.g. billing steps, pass) and a
--    classifier for the producers that exist today, so none of them is edited.
-- 2) AFTER INSERT trigger on notifications -> enqueue_notification_email. The trigger is SECURITY INVOKER so it can see
--    who inserted: a client role (authenticated/anon) can never cause an email by writing metadata itself.
-- Reverse: rollback/1221_email_outbox_enqueue_down.sql

create function public.notification_email_event(p_title text, p_entity_type text) returns text
  language sql immutable set search_path = pg_catalog as $$
  select case
    when p_title like '% awaiting your approval' then 'approval_request'
    when p_title = 'Reminder: a task is overdue' or p_title = 'Issue is overdue' then 'overdue_item'
    when p_entity_type = 'expiry_document' then 'document_expiry'
  end $$;
revoke all on function public.notification_email_event(text, text) from public, anon, authenticated;

drop function public.notify_workflow_user(uuid, uuid, text, text, text, text, uuid, text);
create function public.notify_workflow_user(
  p_org uuid, p_owner uuid, p_title text, p_body text, p_severity text, p_entity_type text, p_entity_id uuid, p_label text,
  p_email_event text default null
) returns void
  language plpgsql security definer set search_path = public, pg_temp as $$
declare v_event text := coalesce(p_email_event, public.notification_email_event(p_title, p_entity_type));
begin
  -- Same org as the record AND an active member; never the acting user.
  if p_owner is null or p_owner is not distinct from auth.uid() then return; end if;
  if not exists (select 1 from public.profiles p where p.id = p_owner and p.org_id = p_org) then return; end if;
  if not public.is_active_member(p_owner) then return; end if;
  insert into public.notifications (org_id, owner_id, severity, title, body, metadata)
  values (p_org, p_owner, p_severity, p_title, nullif(p_body, ''),
          jsonb_build_object('entity', jsonb_build_object('type', p_entity_type, 'id', p_entity_id, 'label', p_label))
          || case when v_event is null then '{}'::jsonb else jsonb_build_object('email_event', v_event) end);
end; $$;
revoke execute on function public.notify_workflow_user(uuid, uuid, text, text, text, text, uuid, text, text) from public, anon, authenticated;

-- Recipients: the addressee plus the org's extra roles for the event; active same-org members with an address, not opted
-- out; the acting user is not copied. One outbox row per (notification, recipient).
create function public.enqueue_notification_email(p_notification uuid) returns integer
  language plpgsql security definer set search_path = public, pg_temp as $$
declare n record; s record; v_rows integer;
begin
  select * into n from public.notifications where id = p_notification;
  if not found or n.metadata->>'email_event' is null then return 0; end if;
  select * into s from public.email_event_settings where org_id = n.org_id and event_key = n.metadata->>'email_event';
  if not found or not s.enabled then return 0; end if;
  insert into public.email_outbox (org_id, notification_id, recipient_id, event_key)
  select n.org_id, n.id, p.id, s.event_key
    from public.profiles p
   where p.org_id = n.org_id
     and (p.id = n.owner_id or (p.role::text = any (s.extra_roles) and p.id is distinct from auth.uid()))
     and nullif(btrim(p.email), '') is not null
     and public.is_active_member(p.id)
     and not exists (select 1 from public.email_user_prefs u where u.user_id = p.id and u.opted_out)
  on conflict (notification_id, recipient_id) do nothing;
  get diagnostics v_rows = row_count;
  return v_rows;
end; $$;
revoke all on function public.enqueue_notification_email(uuid) from public, anon, authenticated;

create function public.notifications_email_enqueue() returns trigger
  language plpgsql set search_path = public, pg_temp as $$
begin
  -- Invoker's role: only trusted writers (the definer producers, service role) may mark an event.
  if new.metadata ? 'email_event' and current_user not in ('authenticated', 'anon') then
    perform public.enqueue_notification_email(new.id);
  end if;
  return new;
end; $$;
revoke all on function public.notifications_email_enqueue() from public, anon, authenticated;
create trigger notifications_email_enqueue_trg after insert on public.notifications
  for each row execute function public.notifications_email_enqueue();

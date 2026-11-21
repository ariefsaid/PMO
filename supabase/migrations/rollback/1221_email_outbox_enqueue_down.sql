drop trigger if exists notifications_email_enqueue_trg on public.notifications;
drop function if exists public.notifications_email_enqueue();
drop function if exists public.enqueue_notification_email(uuid);
drop function if exists public.notify_workflow_user(uuid, uuid, text, text, text, text, uuid, text, text);
drop function if exists public.notification_email_event(text, text);
create function public.notify_workflow_user(
  p_org uuid, p_owner uuid, p_title text, p_body text, p_severity text, p_entity_type text, p_entity_id uuid, p_label text
) returns void
  language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if p_owner is null or p_owner is not distinct from auth.uid() then return; end if;
  if not exists (select 1 from public.profiles p where p.id = p_owner and p.org_id = p_org) then return; end if;
  if not public.is_active_member(p_owner) then return; end if;
  insert into public.notifications (org_id, owner_id, severity, title, body, metadata)
  values (p_org, p_owner, p_severity, p_title, nullif(p_body, ''),
          jsonb_build_object('entity', jsonb_build_object('type', p_entity_type, 'id', p_entity_id, 'label', p_label)));
end; $$;
revoke execute on function public.notify_workflow_user(uuid, uuid, text, text, text, text, uuid, text) from public, anon, authenticated;

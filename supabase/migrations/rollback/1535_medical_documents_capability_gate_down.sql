-- rollback/1535: restore the 0970 expiry_documents_select and the 1466 enqueue_notification_email, then drop the gate.
alter policy expiry_documents_select on public.expiry_documents using (
  org_id = (select public.auth_org_id()) and (select public.is_active_member())
  and ((select public.auth_role()) = 'Admin'
       or (subject_kind = 'equipment' and (select public.auth_role()) = 'Project Manager')
       or (not is_medical and person_id is not null and exists
           (select 1 from public.people p where p.id = person_id and p.manager_id = (select auth.uid())))));

create or replace function public.enqueue_notification_email(p_notification uuid) returns integer
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
     and (p.id = n.owner_id
          or n.metadata->'entity'->>'type' is distinct from 'expiry_document'
          or not exists (select 1 from public.expiry_documents x
                          where x.id::text = n.metadata->'entity'->>'id' and x.org_id = n.org_id and x.is_medical)
          or p.role = 'Admin'
          or exists (select 1 from public.built_in_role_capabilities c
                      where c.role_key = p.built_in_role and c.capability = 'medical_documents_view'))
     and (p.id = n.owner_id
          or n.metadata->'entity'->>'type' is distinct from 'project_document'
          or exists (select 1 from public.project_documents d
                      join public.document_category_roles r
                        on r.category_id = d.category_id and r.org_id = d.org_id and r.role = p.role
                     where d.id::text = n.metadata->'entity'->>'id' and d.org_id = n.org_id))
  on conflict (notification_id, recipient_id) do nothing;
  get diagnostics v_rows = row_count;
  return v_rows;
end; $$;
revoke all on function public.enqueue_notification_email(uuid) from public, anon, authenticated;

drop function if exists public.actor_may_see_medical_documents();
drop function if exists public.may_see_medical_documents(uuid);

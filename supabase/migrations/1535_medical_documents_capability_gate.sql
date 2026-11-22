-- 1535: who may see medical-document status and dates is decided by one rule, read by the in-app policy and the expiry email.
-- drops: enqueue_notification_email replaces its inline medical-document role checks with the shared may_see_medical_documents predicate.
-- Rollback: supabase/migrations/rollback/1535_medical_documents_capability_gate_down.sql
-- may_see_medical_documents(profile) = an active person holding the Admin access level or the medical_documents_view capability
-- (HR Manager, HR Officer, Administrator). It is not executable by signed-in callers (an is-this-person-X oracle, as
-- is_active_member(uuid)); the signed-in adapter below and the email function, a definer, call it.
-- Bodies restated: expiry_documents_select from 0970 (the only migration that defines it);
-- enqueue_notification_email from 1466 (the latest migration that defines it; 1221 is the older one).

create function public.may_see_medical_documents(p_profile uuid) returns boolean
  language sql stable security definer set search_path = pg_catalog, public as $$
  select exists (select 1 from public.profiles p
                  where p.id = p_profile and public.is_active_member(p_profile)
                    and (p.role = 'Admin' or public.role_has_capability(p.built_in_role, 'medical_documents_view')))
$$;
revoke all on function public.may_see_medical_documents(uuid) from public, anon, authenticated;
grant execute on function public.may_see_medical_documents(uuid) to service_role;

create function public.actor_may_see_medical_documents() returns boolean
  language sql stable security definer set search_path = pg_catalog, public as $$
  select public.may_see_medical_documents(auth.uid())
$$;
revoke all on function public.actor_may_see_medical_documents() from public, anon;
grant execute on function public.actor_may_see_medical_documents() to authenticated, service_role;

-- Admin reads all; a PM reads equipment; a manager reads their reports' non-medical documents; a holder of the medical
-- capability reads the medical documents.
alter policy expiry_documents_select on public.expiry_documents using (
  org_id = (select public.auth_org_id()) and (select public.is_active_member())
  and ((select public.auth_role()) = 'Admin'
       or (subject_kind = 'equipment' and (select public.auth_role()) = 'Project Manager')
       or (not is_medical and person_id is not null and exists
           (select 1 from public.people p where p.id = person_id and p.manager_id = (select auth.uid())))
       or (is_medical and (select public.actor_may_see_medical_documents()))));

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
     -- An extra-role copy passes the same visibility test the in-app notice applies to its addressee (1466):
     -- a notice naming a medical expiry document goes only to a recipient who may see medical documents (1535's one rule),
     -- and a notice naming a categorised register document only to a role that may view its category (1168's rule).
     and (p.id = n.owner_id
          or n.metadata->'entity'->>'type' is distinct from 'expiry_document'
          or not exists (select 1 from public.expiry_documents x
                          where x.id::text = n.metadata->'entity'->>'id' and x.org_id = n.org_id and x.is_medical)
          or public.may_see_medical_documents(p.id))
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

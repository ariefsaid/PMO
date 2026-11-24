-- 2047_document_category_hidden_job_roles.sql — a document category can be hidden from named job roles as well as shown to access levels.
-- document_categories.hidden_job_roles lists job-role keys that do not see the category's documents, even when their access level is a
-- viewer: a person holding one of those keys reads, files, changes and removes none of them, and is told of none. An Admin always sees
-- every category (OD-DCV-3). The list is set by an Admin through set_document_category_hidden_job_roles; it starts empty, so nothing
-- changes until an Admin names a job role.
-- The one category rule is extended where it lives: the four restrictive register policies (1166), the helper for definers
-- (document_category_visible) and the two notice checks (notify_workflow_user, enqueue_notification_email).
-- Restated from the live definitions: document_category_visible (1166), notify_workflow_user and enqueue_notification_email (their
-- latest migrations); the register policies as pg_policies holds them.
-- drops: the three category-role tests (each now also refuses a hidden job role).
-- Proven by supabase/tests/2047_document_category_hidden_job_roles.test.sql. Rollback: rollback/2047_document_category_hidden_job_roles_down.sql

alter table public.document_categories add column hidden_job_roles text[] not null default '{}';
comment on column public.document_categories.hidden_job_roles is
  'Job-role keys that do not see this category''s documents whatever their access level; an Admin always sees every category.';

create function public.set_document_category_hidden_job_roles(p_id uuid, p_keys text[]) returns void
  language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_org uuid := public.assert_document_category_admin();
  v_old text[];
  v_new text[] := array(select distinct k from unnest(coalesce(p_keys, '{}')) k order by k);
begin
  perform public.assert_not_light();
  perform public.assert_is_active_member();
  select c.hidden_job_roles into v_old from public.document_categories c where c.id = p_id and c.org_id = v_org for update;
  if not found then raise exception 'category not found' using errcode = 'P0002'; end if;
  if exists (select 1 from unnest(v_new) k where public.built_in_role_base(k) is null) then
    raise exception 'DCV_JOB_ROLE: every hidden-from entry must be a job role' using errcode = '23514', detail = 'category-job-role-invalid';
  end if;
  if 'administrator' = any (v_new) then
    raise exception 'DCV_ADMIN: the Administrator always sees every category' using errcode = '23514', detail = 'category-admin-required';
  end if;
  update public.document_categories set hidden_job_roles = v_new where id = p_id;
  perform public.log_audit('document_category.hidden_job_roles', v_org, auth.uid(), p_id,
    jsonb_build_object('from', to_jsonb(v_old), 'to', to_jsonb(v_new)));
end $$;
comment on function public.set_document_category_hidden_job_roles(uuid, text[]) is
  'Admin only: the job roles a document category is hidden from (replaces the list).';
revoke all on function public.set_document_category_hidden_job_roles(uuid, text[]) from public, anon;
grant execute on function public.set_document_category_hidden_job_roles(uuid, text[]) to authenticated, service_role;

alter policy project_documents_category_visible_select on public.project_documents using ((select public.auth_role()) = 'Admin'
         or (exists (select 1 from public.document_category_roles r
                      where r.category_id = project_documents.category_id and r.org_id = project_documents.org_id
                        and r.role = (select public.auth_role()))
             and not exists (select 1 from public.document_categories c                                    -- mut:rr_category_hidden
                              where c.id = project_documents.category_id
                                and (select public.actor_built_in_role()) = any (c.hidden_job_roles))));
alter policy project_documents_category_visible_delete on public.project_documents using ((select public.auth_role()) = 'Admin'
         or (exists (select 1 from public.document_category_roles r
                      where r.category_id = project_documents.category_id and r.org_id = project_documents.org_id
                        and r.role = (select public.auth_role()))
             and not exists (select 1 from public.document_categories c                                    -- mut:rr_category_hidden
                              where c.id = project_documents.category_id
                                and (select public.actor_built_in_role()) = any (c.hidden_job_roles))));
alter policy project_documents_category_visible_insert on public.project_documents with check ((select public.auth_role()) = 'Admin'
         or (exists (select 1 from public.document_category_roles r
                      where r.category_id = project_documents.category_id and r.org_id = project_documents.org_id
                        and r.role = (select public.auth_role()))
             and not exists (select 1 from public.document_categories c                                    -- mut:rr_category_hidden
                              where c.id = project_documents.category_id
                                and (select public.actor_built_in_role()) = any (c.hidden_job_roles))));
alter policy project_documents_category_visible_update on public.project_documents using ((select public.auth_role()) = 'Admin'
         or (exists (select 1 from public.document_category_roles r
                      where r.category_id = project_documents.category_id and r.org_id = project_documents.org_id
                        and r.role = (select public.auth_role()))
             and not exists (select 1 from public.document_categories c                                    -- mut:rr_category_hidden
                              where c.id = project_documents.category_id
                                and (select public.actor_built_in_role()) = any (c.hidden_job_roles)))) with check ((select public.auth_role()) = 'Admin'
         or (exists (select 1 from public.document_category_roles r
                      where r.category_id = project_documents.category_id and r.org_id = project_documents.org_id
                        and r.role = (select public.auth_role()))
             and not exists (select 1 from public.document_categories c                                    -- mut:rr_category_hidden
                              where c.id = project_documents.category_id
                                and (select public.actor_built_in_role()) = any (c.hidden_job_roles))));

CREATE OR REPLACE FUNCTION public.document_category_visible(p_category_id uuid, p_org_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select (select public.auth_role()) = 'Admin'
      or (exists (select 1 from public.document_category_roles r
                   where r.category_id = p_category_id and r.org_id = p_org_id and r.role = (select public.auth_role()))
          and not exists (select 1 from public.document_categories c
                           where c.id = p_category_id and (select public.actor_built_in_role()) = any (c.hidden_job_roles)));
$function$
;

CREATE OR REPLACE FUNCTION public.notify_workflow_user(p_org uuid, p_owner uuid, p_title text, p_body text, p_severity text, p_entity_type text, p_entity_id uuid, p_label text, p_email_event text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_event text := coalesce(p_email_event, public.notification_email_event(p_title, p_entity_type));
begin
  -- Same org as the record AND an active member; never the acting user.
  if p_owner is null or p_owner is not distinct from auth.uid() then return; end if;
  if not exists (select 1 from public.profiles p where p.id = p_owner and p.org_id = p_org) then return; end if;
  if not public.is_active_member(p_owner) then return; end if;
  -- #2579: a notification that names a register document goes only to a recipient whose role may view its category
  if p_entity_type = 'project_document' and not exists (
       select 1 from public.project_documents d
         join public.profiles pr on pr.id = p_owner
         join public.document_category_roles r on r.category_id = d.category_id and r.org_id = d.org_id and r.role = pr.role
         join public.document_categories c on c.id = d.category_id
        where d.id = p_entity_id and d.org_id = p_org
          and not coalesce(pr.built_in_role = any (c.hidden_job_roles), false)) then return;
  end if;
  insert into public.notifications (org_id, owner_id, severity, title, body, metadata)
  values (p_org, p_owner, p_severity, p_title, nullif(p_body, ''),
          jsonb_build_object('entity', jsonb_build_object('type', p_entity_type, 'id', p_entity_id, 'label', p_label))
          || case when v_event is null then '{}'::jsonb else jsonb_build_object('email_event', v_event) end);
end; $function$
;

CREATE OR REPLACE FUNCTION public.enqueue_notification_email(p_notification uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
                      join public.document_categories c on c.id = d.category_id
                     where d.id::text = n.metadata->'entity'->>'id' and d.org_id = n.org_id
                       and not coalesce(p.built_in_role = any (c.hidden_job_roles), false)))
     -- A work-order billing step notice goes to an extra-role copy only if that recipient may see billing steps (the one gate) and no step
     -- of that work order that is open now is hidden from their role (1775): the notice must not reach a role the step is kept from.
     and (p.id = n.owner_id
          or n.metadata->>'email_event' is distinct from 'billing_step'
          or n.metadata->'entity'->>'type' is distinct from 'work_order'
          or (public.may_see_billing_steps(p.id)
              and not exists (select 1 from public.work_order_billing_steps st
                               where st.work_order_id::text = n.metadata->'entity'->>'id' and st.org_id = n.org_id
                                 and st.started_on is not null and st.done_on is null and st.skipped_on is null
                                 and coalesce(p.built_in_role = any (st.hidden_from_role_keys), false))))
  on conflict (notification_id, recipient_id) do nothing;
  get diagnostics v_rows = row_count;
  return v_rows;
end; $function$
;

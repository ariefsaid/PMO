create or replace function public.notify_wo_step_opened(p_step public.work_order_billing_steps) returns void
  language plpgsql security definer set search_path = public, pg_temp as $$
declare v_who uuid; v_label text; v_found boolean := false; v_body text;
begin
  select coalesce(w.wo_number, w.title) into v_label from public.work_orders w where w.id = p_step.work_order_id;
  v_body := case when cardinality(p_step.hidden_from_role_keys) > 0
                 then format('A billing step of work order %s is now open and waiting for you.', v_label)
                 else format('Billing step "%s" of work order %s is now open and waiting for you.', p_step.name, v_label) end;
  for v_who in
    select distinct x from (
      select p_step.assignee_id as x where p_step.assignee_id is not null
      union all
      select m.id from public.profiles m
       where p_step.assignee_id is null and p_step.owner_role_key is not null and m.org_id = p_step.org_id
         and m.status = 'active' and public.holds_job_role(m.id, p_step.owner_role_key)                      -- mut:notify
         and not coalesce(m.built_in_role = any (p_step.hidden_from_role_keys), false)
         -- a role whose base level is Project Manager is told only on the projects its holder manages (as acting, see wo_step_owner_matches)
         and (public.built_in_role_base(p_step.owner_role_key) is distinct from 'Project Manager'
              or m.id = (select pr.project_manager_id from public.projects pr where pr.id = p_step.project_id))
    ) r
  loop
    v_found := true;
    perform public.notify_workflow_user(p_step.org_id, v_who, 'A billing step is waiting for you', v_body, 'info', 'work_order',
                                        p_step.work_order_id, v_label, 'billing_step');
  end loop;
  if not v_found then
    for v_who in
      select a.id from public.profiles a
       where a.org_id = p_step.org_id and a.role = 'Admin' and a.status = 'active'
         and not coalesce(a.built_in_role = any (p_step.hidden_from_role_keys), false)
    loop
      perform public.notify_workflow_user(p_step.org_id, v_who, 'A billing step is waiting for you', v_body, 'info', 'work_order',
                                          p_step.work_order_id, v_label, 'billing_step');
    end loop;
  end if;
end; $$;
revoke all on function public.notify_wo_step_opened(public.work_order_billing_steps) from public, anon, authenticated;

CREATE OR REPLACE FUNCTION public.enqueue_notification_email(p_notification uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public, pg_temp
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
     -- A notice marked for its addressee alone is never copied to the extra roles (2050).
     and (p.id = n.owner_id or not coalesce((n.metadata->>'email_owner_only')::boolean, false))                 -- mut:rr_owner_only
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

alter table public.email_outbox drop column billing_step_notice_batch_id;

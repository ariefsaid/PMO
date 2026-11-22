-- 1775_wo_billing_step_email_visibility.sql — a billing step's email copy never reaches a role the step is hidden from or one without the see right.
-- Rollback: supabase/migrations/rollback/1775_wo_billing_step_email_visibility_down.sql
-- Body restated from 1535 (the latest migration that defines enqueue_notification_email; verified equal to the database at head), with one
-- added condition before `on conflict`. No existing line is removed.

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
end; $$;
revoke all on function public.enqueue_notification_email(uuid) from public, anon, authenticated;

-- 1224_notify_workflow_user_carry.sql — carries the #2579 category-visibility rule onto the #2711 email-event function.
-- Sources: 1168_document_category_definers.sql (the rule: a notification naming a register document goes only to a
-- recipient whose role may view its category) and 1221_email_outbox_enqueue.sql (the 9-argument function with p_email_event,
-- which re-created the function from its pre-1168 body and so dropped the rule). Body = the 1221 body plus the 1168 hunk.
-- Signature, security definer, search_path and the revoke are the 1221 ones, unchanged.
-- Reverse: rollback/1224_notify_workflow_user_carry_down.sql

create or replace function public.notify_workflow_user(
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
  -- #2579: a notification that names a register document goes only to a recipient whose role may view its category
  if p_entity_type = 'project_document' and not exists (
       select 1 from public.project_documents d
         join public.profiles pr on pr.id = p_owner
         join public.document_category_roles r on r.category_id = d.category_id and r.org_id = d.org_id and r.role = pr.role
        where d.id = p_entity_id and d.org_id = p_org) then return;
  end if;
  insert into public.notifications (org_id, owner_id, severity, title, body, metadata)
  values (p_org, p_owner, p_severity, p_title, nullif(p_body, ''),
          jsonb_build_object('entity', jsonb_build_object('type', p_entity_type, 'id', p_entity_id, 'label', p_label))
          || case when v_event is null then '{}'::jsonb else jsonb_build_object('email_event', v_event) end);
end; $$;
revoke execute on function public.notify_workflow_user(uuid, uuid, text, text, text, text, uuid, text, text) from public, anon, authenticated;

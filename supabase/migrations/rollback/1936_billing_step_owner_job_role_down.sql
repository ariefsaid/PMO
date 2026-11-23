-- Reverse of 1936: the 1771 and 1772 bodies.
create or replace function public.wo_step_readable(p_assignee uuid, p_owner_key text, p_hidden text[]) returns boolean
  language sql stable security definer set search_path = pg_catalog, public as $$
  select coalesce(coalesce(p_assignee = auth.uid(), false)
      or (not coalesce(public.actor_built_in_role() = any (coalesce(p_hidden, '{}')), false)
          and (coalesce(public.actor_may_see_billing_steps(), false)
               or coalesce(p_owner_key is not null and p_owner_key = public.actor_built_in_role(), false))), false)
$$;
revoke all on function public.wo_step_readable(uuid, text, text[]) from public, anon;
grant execute on function public.wo_step_readable(uuid, text, text[]) to authenticated, service_role;

create or replace function public.wo_step_owner_matches(p_owner_key text, p_project uuid) returns boolean
  language sql stable security definer set search_path = pg_catalog, public as $$
  select coalesce(p_owner_key is not null and p_owner_key = public.actor_built_in_role()
                  and (public.built_in_role_base(p_owner_key) is distinct from 'Project Manager'
                       or exists (select 1 from public.projects pr where pr.id = p_project and pr.project_manager_id = auth.uid())), false)
$$;
revoke all on function public.wo_step_owner_matches(text, uuid) from public, anon;
grant execute on function public.wo_step_owner_matches(text, uuid) to authenticated, service_role;

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
         and m.status = 'active' and m.built_in_role = p_step.owner_role_key
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

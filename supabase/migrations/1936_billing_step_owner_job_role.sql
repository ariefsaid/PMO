-- 1936_billing_step_owner_job_role.sql — a billing step's owner is decided by the one job-role function, holds_job_role (1840).
-- A person who holds the owner job role, or holds no job role and has the access level it is built on, owns the step: they read it,
-- act on it and are told when it opens. Restated from the only migrations that define them: wo_step_readable and
-- wo_step_owner_matches from 1771, notify_wo_step_opened from 1772. The project rule for a Project Manager level role, the
-- hidden-from list and the Admin fallback are unchanged.
-- drops: the owner-key equality (owner key = the caller's or the recipient's built-in role) in the three functions, now holds_job_role.
-- Proven by supabase/tests/1770_wo_billing_steps.test.sql. Rollback: rollback/1936_billing_step_owner_job_role_down.sql

create or replace function public.wo_step_readable(p_assignee uuid, p_owner_key text, p_hidden text[]) returns boolean
  language sql stable security definer set search_path = pg_catalog, public as $$
  select coalesce(coalesce(p_assignee = auth.uid(), false)
      or (not coalesce(public.actor_built_in_role() = any (coalesce(p_hidden, '{}')), false)
          and (coalesce(public.actor_may_see_billing_steps(), false)
               or coalesce(p_owner_key is not null and public.holds_job_role(auth.uid(), p_owner_key), false))), false)  -- mut:readable
$$;
revoke all on function public.wo_step_readable(uuid, text, text[]) from public, anon;
grant execute on function public.wo_step_readable(uuid, text, text[]) to authenticated, service_role;

create or replace function public.wo_step_owner_matches(p_owner_key text, p_project uuid) returns boolean
  language sql stable security definer set search_path = pg_catalog, public as $$
  select coalesce(p_owner_key is not null and public.holds_job_role(auth.uid(), p_owner_key)                 -- mut:owner
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

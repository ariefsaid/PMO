-- 1774_wo_billing_step_reads.sql — the viewer's waiting work-order steps (the shared needs-you list). FR-WBS-008.
-- Rollback: supabase/migrations/rollback/1774_wo_billing_step_reads_down.sql
-- SECURITY INVOKER on purpose: the read runs under the step tables' own policies, so hidden-from, the see right and the field-account
-- refusal (1770/1771) apply to it with no second copy of the rule. Derived on read: a step that is finished or skipped stops matching;
-- nothing is stored or cleared. Mine = named to me, or no named person and my built-in role is the step's owner role.
create function public.my_waiting_work_order_steps()
  returns table (step_id uuid, work_order_id uuid, project_id uuid, project_name text, work_order_label text, step_name text,
                 started_on date, target_days smallint)
  language sql stable security invoker set search_path = public as $$
  select s.id, s.work_order_id, s.project_id, p.name, coalesce(w.wo_number, w.title), s.name, s.started_on, s.target_days
    from public.work_order_billing_steps s
    join public.work_orders w on w.id = s.work_order_id and w.status = 'Issued'
    join public.projects p on p.id = s.project_id
   where s.done_on is null and s.skipped_on is null and s.started_on is not null
     and (s.assignee_id = auth.uid()
          or (s.assignee_id is null and s.owner_role_key is not null and s.owner_role_key = public.actor_built_in_role()))
   order by s.started_on, s.position
   limit 200
$$;
revoke all on function public.my_waiting_work_order_steps() from public, anon;
grant execute on function public.my_waiting_work_order_steps() to authenticated, service_role;

-- 1368 down: restore the 1363 bodies.
create or replace function public.billing_stage_due_on(p_stage public.claim_billing_stages) returns date
  language sql immutable set search_path = public as $$
  select case when p_stage.target_days is null or p_stage.started_on is null then null
              else p_stage.started_on + p_stage.target_days end
$$;
revoke all on function public.billing_stage_due_on(public.claim_billing_stages) from public, anon, authenticated;

create or replace function public.billing_stage_overdue_recipients(p_stage public.claim_billing_stages) returns setof uuid
  language sql stable security definer set search_path = public, pg_temp as $$
  with pm as (
    select p.project_manager_id as id from public.projects p
      join public.profiles m on m.id = p.project_manager_id and m.org_id = p_stage.org_id and m.status = 'active'
     where p.id = p_stage.project_id and p.org_id = p_stage.org_id
  )
  select id from pm
  union all
  select a.id from public.profiles a
   where a.org_id = p_stage.org_id and a.role = 'Admin' and a.status = 'active'
     and not exists (select 1 from pm)
$$;
revoke all on function public.billing_stage_overdue_recipients(public.claim_billing_stages) from public, anon, authenticated;

create or replace function public.notify_overdue_billing_stages() returns integer
  language plpgsql security definer set search_path = public, pg_temp as $$
declare r record; v_who uuid; v_n integer := 0; v_today date; v_over integer; v_project text; v_title constant text := 'Billing step is overdue';
begin
  for r in
    select s, pc.id as claim_id, p.name as project_name
      from public.claim_billing_stages s
      join public.progress_claims pc on pc.id = s.claim_id and pc.withdrawn_at is null
      join public.projects p on p.id = s.project_id
     where s.completed_on is null and s.skipped_on is null and s.target_days is not null
       and s.started_on is not null and s.overdue_notified_at is null
       and public.native_org_today(s.org_id) > s.started_on + s.target_days
     order by s.started_on
       -- the stage writers lock the claim row, then the stage row; skip locked never waits, so no deadlock
       for update of pc, s skip locked
  loop
    update public.claim_billing_stages set overdue_notified_at = now() where id = (r.s).id;
    v_today := public.native_org_today((r.s).org_id);
    v_over := v_today - public.billing_stage_due_on(r.s);
    v_project := r.project_name;
    for v_who in select distinct u from public.billing_stage_overdue_recipients(r.s) u loop
      perform public.notify_workflow_user((r.s).org_id, v_who, v_title,
        format('Billing step "%s" of a progress claim on %s is %s %s past its %s-day target.',
               (r.s).name, v_project, v_over, case when v_over = 1 then 'day' else 'days' end, (r.s).target_days),
        'warning', 'project', (r.s).project_id, (r.s).name);
    end loop;
    perform public.log_audit('billing_stage.overdue', (r.s).org_id, null, r.claim_id,
      jsonb_build_object('stage_id', (r.s).id, 'target_days', (r.s).target_days, 'days_over', v_over));
    v_n := v_n + 1;
  end loop;
  return v_n;
end; $$;
revoke all on function public.notify_overdue_billing_stages() from public, anon, authenticated;


-- Reverse of 1832_overdue_runner_checklists.sql: restore the 1368 runner body, drop the two helpers.
create or replace function public.notify_overdue_billing_stages() returns integer
  language plpgsql security definer set search_path = public, pg_temp as $$
declare r record; v_who uuid; v_n integer := 0; v_today date; v_over integer; v_project text; v_title constant text := 'Billing step is overdue';
begin
  for r in
    select s, pc.id as claim_id, p.name as project_name
      from public.claim_billing_stages s
      join public.progress_claims pc on pc.id = s.claim_id and pc.withdrawn_at is null
      join public.projects p on p.id = s.project_id
     where s.completed_on is null and s.skipped_on is null and (s.target_days is not null or s.target_on is not null)
       and s.started_on is not null and s.overdue_notified_at is null
       and public.native_org_today(s.org_id) > public.billing_stage_due_on(s)
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
        case when (r.s).target_on is null
             then format('Billing step "%s" of a progress claim on %s is %s %s past its %s-day target.',
                         (r.s).name, v_project, v_over, case when v_over = 1 then 'day' else 'days' end, (r.s).target_days)
             else format('Billing step "%s" of a progress claim on %s is %s %s past its target date.',
                         (r.s).name, v_project, v_over, case when v_over = 1 then 'day' else 'days' end) end,
        'warning', 'project', (r.s).project_id, (r.s).name);
    end loop;
    perform public.log_audit('billing_stage.overdue', (r.s).org_id, null, r.claim_id,
      jsonb_build_object('stage_id', (r.s).id, 'target_days', (r.s).target_days, 'target_on', (r.s).target_on, 'days_over', v_over));
    v_n := v_n + 1;
  end loop;
  return v_n;
end; $$;

drop function if exists public.notify_overdue_clearance_items();
drop function if exists public.notify_overdue_closeout_items();

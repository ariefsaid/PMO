-- 1832_overdue_runner_checklists.sql — the one daily overdue runner also scans close-out and clearance items (#2800).
-- FR-CTD-006..008; proven by supabase/tests/1832_overdue_runner_checklists.test.sql (and 1360/1365 unchanged for billing).
-- notify_overdue_billing_stages() is restated from the database at head: its body is the latest definition (1368, no later migration
-- restates it) with ONLY the last two lines added. The billing loop is untouched, so every billing result is as before; the cron
-- entry 'billing-stage-overdue' (1363) is kept. The two helpers are private (no grant): they run only from the runner.
-- Notice bodies are the literal English form, as 1363 (OD-BSX-5).
-- ── REVERSE: rollback/1832_overdue_runner_checklists_down.sql ────────────────────────────────────────────────────────

-- Close-out: told is the work order's issuer when an active member of the organisation, else the organisation's active Admins.
create function public.notify_overdue_closeout_items() returns integer
  language plpgsql security definer set search_path = public, pg_temp as $$
declare r record; v_who uuid; v_n integer := 0; v_over integer; v_label text; v_title constant text := 'Close-out item is overdue';
begin
  for r in
    select i, w.wo_number, w.title as wo_title, w.issued_by
      from public.work_order_closeout_items i
      join public.work_orders w on w.id = i.work_order_id and w.org_id = i.org_id and w.status = 'Issued'
     where i.done_on is null and i.due_on is not null and i.overdue_notified_at is null
       and public.native_org_today(i.org_id) > i.due_on
     order by i.due_on, i.id
       for update of i skip locked
  loop
    update public.work_order_closeout_items set overdue_notified_at = now() where id = (r.i).id;
    v_over := public.native_org_today((r.i).org_id) - (r.i).due_on;
    v_label := coalesce(nullif(btrim(r.wo_number), ''), nullif(btrim(r.wo_title), ''), 'the work order');
    for v_who in
      select u from (
        select r.issued_by as u
         where exists (select 1 from public.profiles m where m.id = r.issued_by and m.org_id = (r.i).org_id and m.status = 'active')
        union all
        select a.id from public.profiles a
         where a.org_id = (r.i).org_id and a.role = 'Admin' and a.status = 'active'
           and not exists (select 1 from public.profiles m where m.id = r.issued_by and m.org_id = (r.i).org_id and m.status = 'active')
      ) q
    loop
      perform public.notify_workflow_user((r.i).org_id, v_who, v_title,
        format('Close-out item "%s" on work order %s is %s %s past its %s-day target.',
               (r.i).name, v_label, v_over, case when v_over = 1 then 'day' else 'days' end, (r.i).target_days),
        'warning', 'work_order', (r.i).work_order_id, (r.i).name);
    end loop;
    perform public.log_audit('closeout_item.overdue', (r.i).org_id, null, (r.i).work_order_id,
      jsonb_build_object('item_id', (r.i).id, 'target_days', (r.i).target_days, 'days_over', v_over));
    v_n := v_n + 1;
  end loop;
  return v_n;
end; $$;
revoke all on function public.notify_overdue_closeout_items() from public, anon, authenticated;

-- Clearance: only for an organisation with the checklist on. Told is the person record's creator (people.created_by) when an active
-- member of the organisation, else the active Admins. The once-only mark is a row in person_clearance_overdue_notices.
create function public.notify_overdue_clearance_items() returns integer
  language plpgsql security definer set search_path = public, pg_temp as $$
declare r record; v_who uuid; v_n integer := 0; v_over integer; v_title constant text := 'Clearance item is overdue';
begin
  for r in
    select p.id as person_id, p.name as person_name, p.created_by, p.org_id, i.id as item_id, i.name as item_name, i.target_days, d.due
      from public.clearance_items i
      join public.organizations o on o.id = i.org_id and o.clearance_checklist_enabled
      join public.people p on p.org_id = i.org_id and p.archived_at is null
      cross join lateral (select public.clearance_due_on(p.created_at, i.target_set_at, i.target_days, o.default_timezone) as due) d
     where i.archived_at is null and d.due is not null and public.native_org_today(i.org_id) > d.due
       and not (case when i.document_type_id is null
                     then exists (select 1 from public.person_clearances c where c.person_id = p.id and c.item_id = i.id)
                     else exists (select 1 from public.expiry_documents x
                                   where x.person_id = p.id and x.type_id = i.document_type_id and x.archived_at is null and x.expires_on is not null) end)
       and not exists (select 1 from public.person_clearance_overdue_notices n where n.person_id = p.id and n.item_id = i.id)
     order by d.due, p.id, i.id
  loop
    insert into public.person_clearance_overdue_notices (org_id, person_id, item_id) values (r.org_id, r.person_id, r.item_id)
      on conflict (person_id, item_id) do nothing;
    if not found then continue; end if;   -- a concurrent run already told them
    v_over := public.native_org_today(r.org_id) - r.due;
    for v_who in
      select u from (
        select r.created_by as u
         where exists (select 1 from public.profiles m where m.id = r.created_by and m.org_id = r.org_id and m.status = 'active')
        union all
        select a.id from public.profiles a
         where a.org_id = r.org_id and a.role = 'Admin' and a.status = 'active'
           and not exists (select 1 from public.profiles m where m.id = r.created_by and m.org_id = r.org_id and m.status = 'active')
      ) q
    loop
      perform public.notify_workflow_user(r.org_id, v_who, v_title,
        format('Clearance item "%s" for %s is %s %s past its %s-day target.',
               r.item_name, r.person_name, v_over, case when v_over = 1 then 'day' else 'days' end, r.target_days),
        'warning', 'person_clearance', r.person_id, r.item_name);
    end loop;
    perform public.log_audit('clearance_item.overdue', r.org_id, null, r.person_id,
      jsonb_build_object('item_id', r.item_id, 'target_days', r.target_days, 'days_over', v_over));
    v_n := v_n + 1;
  end loop;
  return v_n;
end; $$;
revoke all on function public.notify_overdue_clearance_items() from public, anon, authenticated;

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
  -- #2800: the same daily run also scans close-out and clearance items (one runner, one schedule).
  v_n := v_n + public.notify_overdue_closeout_items() + public.notify_overdue_clearance_items();
  return v_n;
end; $$;

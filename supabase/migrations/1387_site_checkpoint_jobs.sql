-- 1387_site_checkpoint_jobs.sql — #2594: the two scheduled jobs. Spec: FR-STC-010..012, FR-STC-030, FR-STC-070, NFR-STC-002.
--   materialise_site_checkpoints(p_now): for each organisation WITH a list, today's rows for every rostered crew of every Issued
--     work order, once (on conflict do nothing). An organisation with an empty list gets nothing (FR-STC-070).
--   remind_late_site_checkpoints(p_now): one reminder per late, unrecorded checkpoint, then stamped. Recipient: the crew's active
--     field controller, else the project's active manager, else the organisation's active Admins.
--   p_now exists so the tests can set the clock; both functions are revoked from every client role.
-- ── REVERSE (also rollback/1387_site_checkpoint_jobs_down.sql) ─────────────────────────────────────────

create function public.materialise_site_checkpoints(p_now timestamptz default now()) returns integer
  language plpgsql security definer set search_path = public, pg_temp as $$
declare o record; v_today date; v_tz text; v_n integer; v_total integer := 0;
begin
  for o in select og.id, coalesce(og.default_timezone, 'UTC') as tz from public.organizations og
            where exists (select 1 from public.site_checkpoint_templates t where t.org_id = og.id)
  loop
    begin
      v_tz := o.tz;
      v_today := (p_now at time zone v_tz)::date;
      -- A crew placed after a checkpoint's time already passed gets the row, already counted late, and is not reminded
      -- for it (late_notified_at is set at once): the reminder is for a checkpoint that goes late while the crew is on site.
      insert into public.site_checkpoints (org_id, work_order_id, crew_id, work_date, position, name, marks_work_start,
                                           due_at, grace_minutes, photo_required, late_notified_at)
      select o.id, w.id, wc.crew_id, v_today, t.position, t.name, t.marks_work_start,
             (v_today + t.due_time) at time zone v_tz, t.grace_minutes, t.photo_required,
             case when p_now > ((v_today + t.due_time) at time zone v_tz) + t.grace_minutes * interval '1 minute' then p_now end
        from public.work_orders w
        join public.work_order_crews wc on wc.work_order_id = w.id and wc.org_id = o.id
        join public.crews c on c.id = wc.crew_id and c.archived_at is null
        cross join public.site_checkpoint_templates t
       where w.org_id = o.id and w.status = 'Issued' and t.org_id = o.id
         and wc.valid_from <= v_today and coalesce(wc.valid_to, 'infinity'::date) >= v_today
      on conflict (work_order_id, crew_id, work_date, position) do nothing;
      get diagnostics v_n = row_count;
      v_total := v_total + v_n;
    exception when others then
      raise warning 'materialise_site_checkpoints: organisation % skipped: %', o.id, sqlerrm;
    end;
  end loop;
  return v_total;
end; $$;
revoke all on function public.materialise_site_checkpoints(timestamptz) from public, anon, authenticated;

create function public.remind_late_site_checkpoints(p_now timestamptz default now()) returns integer
  language plpgsql security definer set search_path = public, pg_temp as $$
declare r record; v_pm uuid; v_to uuid[]; v_who uuid; v_n integer := 0; v_label text;
begin
  for r in
    select c.id, c.org_id, c.work_order_id, c.crew_id, c.name, c.due_at, cr.name as crew_name, cr.field_controller_id,
           w.project_id, coalesce(nullif(concat_ws(' · ', w.wo_number, w.title), ''), 'Work order') as wo_label
      from public.site_checkpoints c
      join public.organizations og on og.id = c.org_id
      join public.crews cr on cr.id = c.crew_id
      join public.work_orders w on w.id = c.work_order_id and w.status = 'Issued'
     where c.recorded_at is null and c.late_notified_at is null
       and p_now > c.due_at + c.grace_minutes * interval '1 minute'
       and c.work_date = (p_now at time zone coalesce(og.default_timezone, 'UTC'))::date
       -- an organisation whose list is now empty has switched the feature off
       and exists (select 1 from public.site_checkpoint_templates t where t.org_id = c.org_id)
     order by c.due_at
       for update of c skip locked
  loop
    begin
      update public.site_checkpoints set late_notified_at = p_now where id = r.id;
      v_to := array[]::uuid[];
      if r.field_controller_id is not null and exists (
           select 1 from public.profiles p where p.id = r.field_controller_id and p.org_id = r.org_id and p.status = 'active') then
        v_to := array[r.field_controller_id];
      else
        select p.project_manager_id into v_pm from public.projects p
          join public.profiles m on m.id = p.project_manager_id and m.org_id = r.org_id and m.status = 'active'
         where p.id = r.project_id;
        if v_pm is not null then
          v_to := array[v_pm];
        else
          v_to := coalesce((select array_agg(p.id) from public.profiles p
                             where p.org_id = r.org_id and p.role = 'Admin' and p.status = 'active'), array[]::uuid[]);
        end if;
      end if;
      v_label := r.name || ' · ' || r.crew_name;
      foreach v_who in array v_to loop
        perform public.notify_workflow_user(r.org_id, v_who, 'Checkpoint is late', v_label, 'warning',
                                            'work_order', r.work_order_id, r.wo_label);
      end loop;
      perform public.log_audit('site_checkpoint.late_notified', r.org_id, null, r.id,
        jsonb_build_object('work_order_id', r.work_order_id, 'crew_id', r.crew_id, 'recipients', to_jsonb(v_to)));
      v_n := v_n + 1;
    exception when others then
      raise warning 'remind_late_site_checkpoints: checkpoint % skipped: %', r.id, sqlerrm;
    end;
  end loop;
  return v_n;
end; $$;
revoke all on function public.remind_late_site_checkpoints(timestamptz) from public, anon, authenticated;

-- The late job runs a minute after the materialise job, so a new row is never reminded before it exists.
select cron.schedule('site-checkpoint-materialise', '*/15 * * * *', 'select public.materialise_site_checkpoints()');
select cron.schedule('site-checkpoint-late', '1-59/15 * * * *', 'select public.remind_late_site_checkpoints()');

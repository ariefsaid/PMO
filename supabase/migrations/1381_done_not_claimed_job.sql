-- 1381_done_not_claimed_job.sql — Finance is told once per line that work is done but not claimed (#2675).
-- Spec docs/specs/done-not-claimed-age.spec.md (FR-DNC-012..014, OD-DNC-5); proven by supabase/tests/1381_done_not_claimed_job.test.sql.
-- Same candidate lines as the billing plan (1376): quantity lines from get_project_billing (accepted above claimed) and money-only
-- orders from work_order_billing; the arithmetic is not restated. Age = organisation-local today minus the date of the order's latest
-- confirmed acceptance. The job does nothing for an organisation whose reminder is off or whose limit is null. It writes only the stamp,
-- the notice and an audit event; never a claim or an invoice. Recipients: active Finance users, else the active Admins (as 1363).
-- The notice body is the literal English form (as 1363, OD-BSX-5). One subtransaction per line: if the notice fails the stamp rolls back.
-- ── REVERSE: rollback/1381_done_not_claimed_job_down.sql ───────────────────────────────────────────────────────────────

create function public.notify_done_not_claimed() returns integer
  language plpgsql security definer set search_path = public, pg_temp as $$
declare
  o record; r record; v_who uuid; v_n integer := 0; v_today date; v_stamped integer; v_age integer; v_rows jsonb; v_claims text; v_sub uuid;
  v_title constant text := 'Work is done but not yet claimed';
begin
  for o in
    select s.org_id, s.done_not_claimed_after_days as lim
      from public.org_billing_plan_settings s
     where s.done_not_claimed_reminder_on and s.done_not_claimed_after_days is not null
  loop
    v_today := public.native_org_today(o.org_id);
    -- get_project_billing is security invoker and reads the CALLER's organisation (auth_org_id()); with no session the job has none. So for
    -- the read only, the session carries one member of this organisation, and is restored before any notice is sent (a notice is never
    -- sent to "the acting user"). Candidates are collected first, then the claim is put back.
    select p.id into v_sub from public.profiles p where p.org_id = o.org_id order by p.id limit 1;
    continue when v_sub is null;
    v_claims := current_setting('request.jwt.claims', true);
    perform set_config('request.jwt.claims', jsonb_build_object('sub', v_sub, 'role', 'authenticated')::text, true);
    select coalesce(jsonb_agg(to_jsonb(q)), '[]'::jsonb) into v_rows from (
      with lines as (
        select pr.id as project_id, pr.name as project_name, wo.id as work_order_id, wo.wo_number, b.id as boq_item_id
          from public.projects pr
          cross join lateral (select public.get_project_billing(pr.id) as j) g
          cross join lateral jsonb_array_elements(coalesce(g.j -> 'boq', '[]'::jsonb)) l(x)
          cross join lateral jsonb_array_elements(coalesce(l.x -> 'allocations', '[]'::jsonb)) a(x)
          join public.boq_items b on b.id = (a.x ->> 'boq_item_id')::uuid
          join public.work_orders wo on wo.id = (a.x ->> 'work_order_id')::uuid
         where pr.org_id = o.org_id and pr.archived_at is null
           and exists (select 1 from public.work_order_acceptances ac where ac.project_id = pr.id and ac.status = 'Confirmed')
           and (a.x ->> 'accepted_quantity') is not null
           and (a.x ->> 'accepted_quantity')::numeric > (a.x ->> 'claimed_quantity')::numeric
      ), orders as (
        select pr.id as project_id, pr.name as project_name, w.work_order_id, w.wo_number, null::uuid as boq_item_id
          from public.work_order_billing w
          join public.projects pr on pr.id = w.project_id
         where w.org_id = o.org_id and pr.archived_at is null
           and w.line_count = 0 and w.figures_complete and w.remaining > 0 and w.status in ('Issued', 'Closed')
           and not exists (select 1 from public.work_order_lines wl where wl.work_order_id = w.work_order_id)
      ), pool as (
        select * from lines union all select * from orders
      )
      select pool.*, (select (max(ac.confirmed_at) at time zone coalesce(og.default_timezone, 'UTC'))::date
                        from public.work_order_acceptances ac
                       where ac.work_order_id = pool.work_order_id and ac.status = 'Confirmed') as accepted_on
        from pool
        join public.organizations og on og.id = o.org_id
       where not exists (select 1 from public.done_not_claimed_notices n
                          where n.org_id = o.org_id and n.work_order_id = pool.work_order_id
                            and coalesce(n.boq_item_id, '00000000-0000-0000-0000-000000000000'::uuid) = coalesce(pool.boq_item_id, '00000000-0000-0000-0000-000000000000'::uuid))
    ) q;
    perform set_config('request.jwt.claims', coalesce(v_claims, ''), true);
    for r in select x.* from jsonb_to_recordset(v_rows) as x(project_id uuid, project_name text, work_order_id uuid, wo_number text, boq_item_id uuid, accepted_on date)
    loop
      continue when r.accepted_on is null;
      v_age := v_today - r.accepted_on;
      continue when v_age <= o.lim;
      begin
        insert into public.done_not_claimed_notices (org_id, work_order_id, boq_item_id)
        values (o.org_id, r.work_order_id, r.boq_item_id) on conflict do nothing;
        get diagnostics v_stamped = row_count;
        if v_stamped > 0 then
          for v_who in
            select f.id from public.profiles f where f.org_id = o.org_id and f.role = 'Finance' and f.status = 'active'
            union
            select a.id from public.profiles a where a.org_id = o.org_id and a.role = 'Admin' and a.status = 'active'
               and not exists (select 1 from public.profiles f where f.org_id = o.org_id and f.role = 'Finance' and f.status = 'active')
          loop
            perform public.notify_workflow_user(o.org_id, v_who, v_title,
              format('Work on %s%s was accepted %s days ago and is not in a claim yet (limit %s days).',
                     r.project_name, case when r.wo_number is null then '' else ' (work order ' || r.wo_number || ')' end, v_age, o.lim),
              'warning', 'project', r.project_id, r.project_name);
          end loop;
          perform public.log_audit('done_not_claimed.notified', o.org_id, null, r.work_order_id,
            jsonb_build_object('boq_item_id', r.boq_item_id, 'age_days', v_age, 'limit_days', o.lim));
          v_n := v_n + 1;
        end if;
      exception when others then
        raise warning 'done_not_claimed: line skipped, will retry: %', sqlerrm;
      end;
    end loop;
  end loop;
  return v_n;
end; $$;
revoke all on function public.notify_done_not_claimed() from public, anon, authenticated;

select cron.schedule('done-not-claimed', '23 1 * * *', 'select public.notify_done_not_claimed()');

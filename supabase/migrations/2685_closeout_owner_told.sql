-- 2685_closeout_owner_told.sql — a close-out item tells its owner job role it is their turn (#2907).
-- Two halves. (1) The waiting-on-you pointer: my_waiting_closeout_items() lists the viewer's open close-out items
-- whose owner job role they hold — the same read the work-order billing steps use (1774): SECURITY INVOKER on purpose,
-- so the items' own policies scope it with no second copy of the rule, and derived on read (a done item stops
-- matching; nothing is stored or cleared). A light (field) account is skipped: it cannot open the item (2383 refuses
-- the write; the skip is 2661's). (2) The daily overdue notice also reaches the holder of the item's owner job role:
-- notify_overdue_closeout_items() is restated from the database at head (1832 — no later migration restates it) with
-- ONLY the recipients changed: the issuer (else the active Admins) is untouched, and holders are active members of the
-- item's organisation (holds_job_role, 1840 — the one job-role function), never a light account (2661), told once even
-- when they are the issuer too. The billing and clearance loops are untouched, so every other result is as before.
-- Proven by supabase/tests/2685_closeout_owner_notice.test.sql (and 1832 unchanged for ownerless items).
-- drops: the recipients' plain select (it becomes distinct, so a person who is both issuer and holder is told once);
-- every other line of 1832's body is unchanged.
-- ── REVERSE: rollback/2685_closeout_owner_told_down.sql ──────────────────────────────────────────────────────────────

-- The viewer's waiting close-out items (the shared needs-you list). Mine = the item's owner job role is set and I hold
-- it (the one job-role test: active member holding the key, or holding no key and its base access level — the same
-- shape the work-order billing steps read, 1774/1936); never a light (field) account, which cannot open the item.
-- The read is SECURITY INVOKER, so the role test goes through a definer helper: holds_job_role itself is not granted
-- to authenticated (1840), and the invoker body runs with the caller's grants (as 1774 wraps wo_step_owner_matches).
create function public.actor_holds_owner_job_role(p_key text) returns boolean
  language sql stable security definer set search_path = pg_catalog, public as $$
  select coalesce(p_key is not null and public.holds_job_role(auth.uid(), p_key), false)                     -- mut:closeout_owner_read
$$;
revoke all on function public.actor_holds_owner_job_role(text) from public, anon;
grant execute on function public.actor_holds_owner_job_role(text) to authenticated, service_role;

create function public.my_waiting_closeout_items()
  returns table (item_id uuid, work_order_id uuid, project_id uuid, project_name text, work_order_label text, item_name text, due_on date)
  language sql stable security invoker set search_path = public as $$
  select i.id, i.work_order_id, i.project_id, p.name, coalesce(w.wo_number, w.title), i.name, i.due_on
    from public.work_order_closeout_items i
    join public.work_orders w on w.id = i.work_order_id and w.status = 'Issued'
    join public.projects p on p.id = i.project_id
   where i.done_on is null and i.owner_job_role is not null
     and public.actor_holds_owner_job_role(i.owner_job_role)
     and not public.is_light_role_key(public.actor_built_in_role())
   order by i.due_on nulls last, i.position
   limit 200
$$;
revoke all on function public.my_waiting_closeout_items() from public, anon;
grant execute on function public.my_waiting_closeout_items() to authenticated, service_role;

-- Close-out: told is the work order's issuer when an active member of the organisation, else the organisation's active
-- Admins — as 1832 — and now also every holder of the item's owner job role (#2907): an active member of the item's
-- organisation, never a light (field) account, which cannot open the item (as 2661 skips them). Distinct: a person who
-- is both issuer and holder is told once.
create or replace function public.notify_overdue_closeout_items() returns integer
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
      select distinct u from (
        select r.issued_by as u
         where exists (select 1 from public.profiles m where m.id = r.issued_by and m.org_id = (r.i).org_id and m.status = 'active')
        union all
        select a.id from public.profiles a
         where a.org_id = (r.i).org_id and a.role = 'Admin' and a.status = 'active'
           and not exists (select 1 from public.profiles m where m.id = r.issued_by and m.org_id = (r.i).org_id and m.status = 'active')
        union all
        -- #2907: the holder of the item's owner job role is told it is their turn too: active, inside the item's
        -- organisation, and not a light (field) account, which cannot open the item.
        select m.id
          from public.profiles m
         where (r.i).owner_job_role is not null and m.org_id = (r.i).org_id and m.status = 'active'
           and public.holds_job_role(m.id, (r.i).owner_job_role)
           and not public.is_light_role_key(m.built_in_role)
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

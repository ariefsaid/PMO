-- Reverse of 2685_closeout_owner_told.sql: restore the 1832 close-out recipients, drop the waiting read and its helper.
drop function public.my_waiting_closeout_items();
drop function public.actor_holds_owner_job_role(text);

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

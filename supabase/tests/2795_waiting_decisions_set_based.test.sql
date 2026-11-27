-- 2795_waiting_decisions_set_based.test.sql — my_waiting_decisions() after 2795 returns exactly what the 2765 body returned.
-- The 2765 body is kept below under a temporary name (rolled back with the test); old and new are compared as ordered lists
-- for each calling role, and both ways empty for a second organisation and for a caller with no standing.
begin;
create extension if not exists pgtap;
select plan(13);

insert into organizations (id, name, default_currency, default_timezone) values
  ('27950000-0000-0000-0000-00000000000a', 'Waiting Set Org', 'IDR', 'Asia/Jakarta'),
  ('27950000-0000-0000-0000-00000000000b', 'Waiting Other Org', 'IDR', 'Asia/Jakarta');
insert into auth.users (id, email) values
  ('27950000-0000-0000-0000-0000000000a1', 'ws-a1@example.com'),
  ('27950000-0000-0000-0000-0000000000a2', 'ws-a2@example.com'),
  ('27950000-0000-0000-0000-0000000000a3', 'ws-a3@example.com'),
  ('27950000-0000-0000-0000-0000000000a4', 'ws-a4@example.com'),
  ('27950000-0000-0000-0000-0000000000a5', 'ws-a5@example.com'),
  ('27950000-0000-0000-0000-0000000000a6', 'ws-a6@example.com'),
  ('27950000-0000-0000-0000-0000000000b1', 'ws-b1@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('27950000-0000-0000-0000-0000000000a1', '27950000-0000-0000-0000-00000000000a', 'WS a1', 'ws-a1@example.com', 'Admin', 'active'),
  ('27950000-0000-0000-0000-0000000000a2', '27950000-0000-0000-0000-00000000000a', 'WS a2', 'ws-a2@example.com', 'Executive', 'active'),
  ('27950000-0000-0000-0000-0000000000a3', '27950000-0000-0000-0000-00000000000a', 'WS a3', 'ws-a3@example.com', 'Project Manager', 'active'),
  ('27950000-0000-0000-0000-0000000000a4', '27950000-0000-0000-0000-00000000000a', 'WS a4', 'ws-a4@example.com', 'Finance', 'active'),
  ('27950000-0000-0000-0000-0000000000a5', '27950000-0000-0000-0000-00000000000a', 'WS a5', 'ws-a5@example.com', 'Engineer', 'active'),
  ('27950000-0000-0000-0000-0000000000a6', '27950000-0000-0000-0000-00000000000a', 'WS a6', 'ws-a6@example.com', 'Project Manager', 'active'),
  ('27950000-0000-0000-0000-0000000000b1', '27950000-0000-0000-0000-00000000000b', 'WS b1', 'ws-b1@example.com', 'Admin', 'active');

insert into projects (id, org_id, name, status, currency, contract_value, tax_treatment, tax_amount, project_manager_id) values
  ('27950000-0000-0000-0000-0000000000d1', '27950000-0000-0000-0000-00000000000a', 'WS Site 1', 'Ongoing Project', 'IDR', 5000000, 'exclusive', 0, '27950000-0000-0000-0000-0000000000a3'),
  ('27950000-0000-0000-0000-0000000000d2', '27950000-0000-0000-0000-00000000000a', 'WS Site 2', 'Ongoing Project', 'IDR', 5000000, 'exclusive', 0, '27950000-0000-0000-0000-0000000000a6'),
  ('27950000-0000-0000-0000-0000000000d3', '27950000-0000-0000-0000-00000000000b', 'WS Other Site', 'Ongoing Project', 'IDR', 5000000, 'exclusive', 0, '27950000-0000-0000-0000-0000000000b1');
-- Draft work orders: priced by the Admin, priced by the Engineer, unpriced, priced then unset; plus one in the other organisation.
insert into work_orders (id, org_id, project_id, title, status, order_value, order_value_set_at, order_value_set_by, tax_treatment, tax_amount, wo_number, currency) values
  ('27950000-0000-0000-0000-0000000000e1', '27950000-0000-0000-0000-00000000000a', '27950000-0000-0000-0000-0000000000d1', 'WO priced by admin', 'Draft', 1000, now(), '27950000-0000-0000-0000-0000000000a1', 'exclusive', 0, 'WS-1', 'IDR'),
  ('27950000-0000-0000-0000-0000000000e2', '27950000-0000-0000-0000-00000000000a', '27950000-0000-0000-0000-0000000000d2', 'WO priced by admin 2', 'Draft', 2000, now(), '27950000-0000-0000-0000-0000000000a1', 'exclusive', 0, 'WS-2', 'IDR'),
  ('27950000-0000-0000-0000-0000000000e3', '27950000-0000-0000-0000-00000000000a', '27950000-0000-0000-0000-0000000000d1', 'WO priced by engineer', 'Draft', 3000, now(), '27950000-0000-0000-0000-0000000000a5', 'exclusive', 0, 'WS-3', 'IDR'),
  ('27950000-0000-0000-0000-0000000000e4', '27950000-0000-0000-0000-00000000000a', '27950000-0000-0000-0000-0000000000d1', 'WO unpriced', 'Draft', 0, null, null, 'exclusive', 0, 'WS-4', 'IDR'),
  ('27950000-0000-0000-0000-0000000000e5', '27950000-0000-0000-0000-00000000000a', '27950000-0000-0000-0000-0000000000d2', 'WO priced by pm', 'Draft', 500, now(), '27950000-0000-0000-0000-0000000000a3', 'exclusive', 0, 'WS-5', 'IDR'),
  ('27950000-0000-0000-0000-0000000000e6', '27950000-0000-0000-0000-00000000000a', '27950000-0000-0000-0000-0000000000d1', 'WO issued', 'Issued', 700, now(), '27950000-0000-0000-0000-0000000000a1', 'exclusive', 0, 'WS-6', 'IDR'),
  ('27950000-0000-0000-0000-0000000000e9', '27950000-0000-0000-0000-00000000000b', '27950000-0000-0000-0000-0000000000d3', 'WO other org', 'Draft', 900, now(), '27950000-0000-0000-0000-0000000000b1', 'exclusive', 0, 'WS-9', 'IDR');
-- Submitted site reports: written by the Engineer, by a Project Manager, by the Admin; plus the other organisation.
insert into daily_site_reports (id, org_id, project_id, work_order_id, work_date, author_id, status, submitted_at) values
  ('27950000-0000-0000-0000-0000000000f1', '27950000-0000-0000-0000-00000000000a', '27950000-0000-0000-0000-0000000000d1', '27950000-0000-0000-0000-0000000000e6', current_date - 1, '27950000-0000-0000-0000-0000000000a5', 'submitted', now()),
  ('27950000-0000-0000-0000-0000000000f2', '27950000-0000-0000-0000-00000000000a', '27950000-0000-0000-0000-0000000000d2', '27950000-0000-0000-0000-0000000000e6', current_date - 2, '27950000-0000-0000-0000-0000000000a5', 'submitted', now()),
  ('27950000-0000-0000-0000-0000000000f3', '27950000-0000-0000-0000-00000000000a', '27950000-0000-0000-0000-0000000000d1', '27950000-0000-0000-0000-0000000000e6', current_date - 3, '27950000-0000-0000-0000-0000000000a3', 'submitted', now()),
  ('27950000-0000-0000-0000-0000000000f4', '27950000-0000-0000-0000-00000000000a', '27950000-0000-0000-0000-0000000000d2', '27950000-0000-0000-0000-0000000000e6', current_date - 4, '27950000-0000-0000-0000-0000000000a1', 'submitted', now()),
  ('27950000-0000-0000-0000-0000000000f5', '27950000-0000-0000-0000-00000000000a', '27950000-0000-0000-0000-0000000000d1', '27950000-0000-0000-0000-0000000000e6', current_date - 5, '27950000-0000-0000-0000-0000000000a5', 'draft', now()),
  ('27950000-0000-0000-0000-0000000000f9', '27950000-0000-0000-0000-00000000000b', '27950000-0000-0000-0000-0000000000d3', '27950000-0000-0000-0000-0000000000e9', current_date - 1, '27950000-0000-0000-0000-0000000000b1', 'submitted', now());
-- Ordered purchases: requested by the Engineer, by a Project Manager, by Finance, by nobody; plus the other organisation.
insert into procurements (id, org_id, project_id, title, status, requested_by_id, currency) values
  ('27950000-0000-0000-0000-0000000000c1', '27950000-0000-0000-0000-00000000000a', '27950000-0000-0000-0000-0000000000d1', 'PR by engineer', 'Ordered', '27950000-0000-0000-0000-0000000000a5', 'IDR'),
  ('27950000-0000-0000-0000-0000000000c2', '27950000-0000-0000-0000-00000000000a', '27950000-0000-0000-0000-0000000000d2', 'PR by pm', 'Ordered', '27950000-0000-0000-0000-0000000000a3', 'IDR'),
  ('27950000-0000-0000-0000-0000000000c3', '27950000-0000-0000-0000-00000000000a', '27950000-0000-0000-0000-0000000000d1', 'PR by finance', 'Ordered', '27950000-0000-0000-0000-0000000000a4', 'IDR'),
  ('27950000-0000-0000-0000-0000000000c4', '27950000-0000-0000-0000-00000000000a', null, 'PR by nobody', 'Ordered', null, 'IDR'),
  ('27950000-0000-0000-0000-0000000000c5', '27950000-0000-0000-0000-00000000000a', '27950000-0000-0000-0000-0000000000d2', 'PR requested', 'Requested', '27950000-0000-0000-0000-0000000000a5', 'IDR'),
  ('27950000-0000-0000-0000-0000000000c9', '27950000-0000-0000-0000-00000000000b', '27950000-0000-0000-0000-0000000000d3', 'PR other org', 'Ordered', '27950000-0000-0000-0000-0000000000b1', 'IDR');

-- The 2765 body, kept under a temporary name for the comparison only.
create or replace function public.my_waiting_decisions_old_2795()
  returns table (kind text, record_id uuid, project_id uuid, title text, created_at timestamptz)
  language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_org uuid := public.auth_org_id(); v_uid uuid := auth.uid(); v_role user_role := public.auth_role();
begin
  perform public.assert_is_active_member();
  perform public.assert_not_light();   -- a light account decides nothing and sees no list (1209)
  if v_role is null or v_uid is null then return; end if;
  return query
  select waiting.kind, waiting.record_id, waiting.project_id, waiting.title, waiting.created_at
    from (
  -- daily_report
  select 'daily_report'::text, d.id, d.project_id,
         (coalesce(w.wo_number || ' · ', '') || w.title || ' · ' || to_char(d.work_date, 'YYYY-MM-DD'))::text,
         coalesce(d.submitted_at, d.updated_at)
    from public.daily_site_reports d
    join public.work_orders w on w.id = d.work_order_id
   where d.org_id = v_org and d.status = 'submitted' and public.daily_report_may_decide(d.id)
  union all
  -- work_order_issue: the gate's role set; a Project Manager only for the projects they manage; money rows follow the SoD predicate
  select 'work_order_issue'::text, w.id, w.project_id, (coalesce(w.wo_number || ' · ', '') || w.title)::text, w.created_at
    from public.work_orders w
    join public.projects p on p.id = w.project_id
   where w.org_id = v_org and w.status = 'Draft'
     and public.work_order_issue_may_decide(w.id)
     and (v_role <> 'Project Manager' or p.project_manager_id = v_uid)
     and coalesce(w.order_value, 0) > 0 and w.order_value_set_by is not null and w.order_value_set_by is distinct from v_uid
  union all
  -- delivery_record
  select 'delivery_record'::text, pr.id, pr.project_id, pr.title::text, pr.updated_at
    from public.procurements pr
    left join public.projects p on p.id = pr.project_id
   where pr.org_id = v_org and pr.status = 'Ordered'
     and public.delivery_record_may_decide(pr.id)
     and (v_role <> 'Project Manager' or pr.requested_by_id = v_uid or p.project_manager_id = v_uid)
  union all
  -- quantity_change
  select 'quantity_change'::text, q.id, q.project_id, coalesce(w.wo_number || ' · ', '') || w.title, coalesce(q.submitted_at, q.updated_at)
    from public.quantity_change_requests q
    join public.work_orders w on w.id = q.work_order_id
   where q.org_id = v_org and q.status = 'pending_approval' and public.quantity_change_may_decide(q.id)
  union all
  -- certificate
  select 'certificate'::text, c.id, c.project_id, pr.title::text, coalesce(c.submitted_at, c.created_at)
    from public.subcontract_certificates c
    join public.procurements pr on pr.id = c.procurement_id
   where c.org_id = v_org and c.status = 'submitted' and public.certificate_may_decide(c.id)
  union all
  -- transfer_receipt: narrower than the gate on purpose (a senior role may receive any transfer; only those addressed to the caller or kept by them are waiting for them)
  select 'transfer_receipt'::text, x.id, w.project_id, (x.number || ' · ' || w.name)::text, x.sent_at
    from public.stock_transfers x
    join public.stock_warehouses w on w.id = x.to_warehouse_id
   where x.org_id = v_org and x.status = 'Sent' and x.sent_by is distinct from v_uid
     and public.transfer_receipt_may_decide(x.id)
     and (x.to_user_id = v_uid or exists (select 1 from public.stock_warehouse_keepers k
                                           where k.org_id = x.org_id and k.user_id = v_uid and k.warehouse_id = x.to_warehouse_id))
  union all
  -- equipment_plan
  select 'equipment_plan'::text, e.id, e.project_id, (pj.name || ' · ' || to_char(e.plan_month, 'YYYY-MM'))::text, coalesce(e.submitted_at, e.created_at)
    from public.equipment_plans e
    join public.projects pj on pj.id = e.project_id
   where e.org_id = v_org and e.status = 'Submitted' and public.equipment_plan_approver_ok(e.id)
  union all
  -- stock_writeoff: a Draft adjustment, or a count with a difference, that the caller may post (stock_assert_writeoff_approver, 0416:
  -- never its author, and rank 20 or above). A count with no difference is not listed: its author posts it (FR-STK-062).
  select 'stock_writeoff'::text, sd.id, wh.project_id, (sd.number || ' · ' || wh.name)::text, sd.created_at
    from public.stock_documents sd
    join public.stock_warehouses wh on wh.id = sd.warehouse_id
   where sd.org_id = v_org and sd.status = 'Draft' and sd.kind in ('adjustment', 'count')
     and public.stock_writeoff_may_decide(sd.id)
     and (sd.kind = 'adjustment'
          or exists (select 1 from public.stock_document_lines sl
                       left join public.stock_balances sb on sb.item_id = sl.item_id and sb.warehouse_id = sd.warehouse_id
                      where sl.document_id = sd.id and sl.counted_quantity is distinct from coalesce(sb.qty_on_hand, 0)))
  union all
  -- attendance_decision: a work order's day with a second time record that disagrees with the site report's figure and is not decided,
  -- for the people attendance_second_record_may_decide() names, never one who recorded either figure (attendance_second_record_decide, 1701).
  -- One row per report: the decision is made on the site report of that day, which is where the row opens.
  select 'attendance_decision'::text, dr.id, dr.project_id,
         (coalesce(aw.wo_number || ' · ', '') || aw.title || ' · ' || to_char(dr.work_date, 'YYYY-MM-DD'))::text,
         min(asr.recorded_at)
    from public.daily_site_reports dr
    join public.work_orders aw on aw.id = dr.work_order_id
    join public.attendance_second_records asr on asr.work_order_id = dr.work_order_id and asr.work_date = dr.work_date and asr.org_id = v_org
    join public.attendance_days ad on ad.worker_id = asr.worker_id and ad.work_order_id = asr.work_order_id and ad.work_date = asr.work_date
   where dr.org_id = v_org and dr.supersedes_id is null and dr.archived_at is null
     and asr.decided_at is null and ad.locked_at is null and ad.submitted_at is null
     and public.attendance_decision_may_decide(asr.id)
     and public.attendance_day_undecided(asr.worker_id, asr.work_order_id, asr.work_date)
   group by dr.id, dr.project_id, aw.wo_number, aw.title, dr.work_date
  union all
  -- One decision job per order; the order receiving screen presents every pending count on it.
  select 'order_receiving'::text, po.id, p.project_id, (coalesce(po.po_number, p.title))::text, min(r.created_at)
    from public.order_receiving_requests r
    join public.purchase_orders po on po.id=r.po_id
    join public.procurements p on p.id=po.procurement_id
    join public.order_receiving_settings s on s.org_id=r.org_id and s.enabled
   where r.org_id=v_org and not public.order_receiving_approval_current(r.id) and r.stock_document_id is null and r.receiver_id<>v_uid
     and public.order_receiving_purchaser()
     and not coalesce(public.domain_externally_owned(v_org,'procurement'),false)
     and not coalesce(public.domain_externally_owned(v_org,'inventory'),false)
   group by po.id,p.project_id,po.po_number,p.title
  union all
  -- check_in: an outside-area phone clock-in waiting for the supervisor named to decide it (the same gate the Crews cards use)
  select 'check_in'::text, q.id, w.project_id, (pe.name || ' · ' || w.title)::text, q.checked_in_at
    from public.phone_check_ins q
    join public.work_orders w on w.id = q.work_order_id
    join public.people pe on pe.id = q.worker_id
   where q.org_id = v_org and q.status = 'pending' and public.phone_check_in_may_decide(q.id)
    ) as waiting(kind, record_id, project_id, title, created_at)
   order by waiting.created_at asc nulls last, waiting.kind asc, waiting.record_id asc;
end; $$;
grant execute on function public.my_waiting_decisions_old_2795() to authenticated;

create or replace function pg_temp._as(p_uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', case when p_uid is null then '' else json_build_object('sub', p_uid, 'role', 'authenticated')::text end, true);
$$;

set local role authenticated;
select pg_temp._as('27950000-0000-0000-0000-0000000000a1');
select is((select coalesce(array_agg(x::text), '{}') from public.my_waiting_decisions() x),
          (select coalesce(array_agg(x::text), '{}') from public.my_waiting_decisions_old_2795() x),
          '2795-01 Admin: the new list equals the 2765 list, row for row and in order');
select cmp_ok((select count(*) from public.my_waiting_decisions())::int, '>', 0, '2795-02 Admin: the list is not empty, so the comparison is not vacuous');
select pg_temp._as('27950000-0000-0000-0000-0000000000a2');
select is((select coalesce(array_agg(x::text), '{}') from public.my_waiting_decisions() x),
          (select coalesce(array_agg(x::text), '{}') from public.my_waiting_decisions_old_2795() x),
          '2795-01 Executive: the new list equals the 2765 list, row for row and in order');
select pg_temp._as('27950000-0000-0000-0000-0000000000a3');
select is((select coalesce(array_agg(x::text), '{}') from public.my_waiting_decisions() x),
          (select coalesce(array_agg(x::text), '{}') from public.my_waiting_decisions_old_2795() x),
          '2795-01 a Project Manager: the new list equals the 2765 list, row for row and in order');
select cmp_ok((select count(*) from public.my_waiting_decisions())::int, '>', 0, '2795-02 a Project Manager: the list is not empty, so the comparison is not vacuous');
select pg_temp._as('27950000-0000-0000-0000-0000000000a6');
select is((select coalesce(array_agg(x::text), '{}') from public.my_waiting_decisions() x),
          (select coalesce(array_agg(x::text), '{}') from public.my_waiting_decisions_old_2795() x),
          '2795-01 another Project Manager: the new list equals the 2765 list, row for row and in order');
select pg_temp._as('27950000-0000-0000-0000-0000000000a4');
select is((select coalesce(array_agg(x::text), '{}') from public.my_waiting_decisions() x),
          (select coalesce(array_agg(x::text), '{}') from public.my_waiting_decisions_old_2795() x),
          '2795-01 Finance: the new list equals the 2765 list, row for row and in order');
select cmp_ok((select count(*) from public.my_waiting_decisions())::int, '>', 0, '2795-02 Finance: the list is not empty, so the comparison is not vacuous');
select pg_temp._as('27950000-0000-0000-0000-0000000000a5');
select is((select coalesce(array_agg(x::text), '{}') from public.my_waiting_decisions() x),
          (select coalesce(array_agg(x::text), '{}') from public.my_waiting_decisions_old_2795() x),
          '2795-01 an Engineer: the new list equals the 2765 list, row for row and in order');
select pg_temp._as('27950000-0000-0000-0000-0000000000b1');
select is((select count(*) from (select * from public.my_waiting_decisions() except select * from public.my_waiting_decisions_old_2795()) d)::int
        + (select count(*) from (select * from public.my_waiting_decisions_old_2795() except select * from public.my_waiting_decisions()) d)::int, 0,
  '2795-03 a second organisation: the new list and the 2765 list differ in no row, either way');
select is((select count(*) from public.my_waiting_decisions() where record_id not in ('27950000-0000-0000-0000-0000000000e9', '27950000-0000-0000-0000-0000000000f9', '27950000-0000-0000-0000-0000000000c9'))::int, 0,
  '2795-04 a second-organisation caller is never shown the first organisation''s records');
select pg_temp._as(null);
select throws_ok($$select count(*) from public.my_waiting_decisions()$$, null, null, '2795-05 no caller: the new function refuses as before');
select throws_ok($$select count(*) from public.my_waiting_decisions_old_2795()$$, null, null, '2795-06 no caller: the 2765 function refuses the same way');
select * from finish();
rollback;

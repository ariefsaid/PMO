-- Excess approvals pin the excess quantities reviewed under the purchase lock; a later receipt can require another review.
-- Latest bodies: receipt/approval/read 2220; waiting 2224. Field-account gates retained.
-- drops: the metadata-only approval test becomes the current excess snapshot test; a stale approval may be reviewed again; the reader and inbox use that same test.
create table public.order_receiving_excess_approvals (
 id uuid primary key default gen_random_uuid(),
 seq bigint generated always as identity,
 org_id uuid not null references public.organizations(id),
 request_id uuid not null references public.order_receiving_requests(id),
 receiver_id uuid not null references public.profiles(id),
 approved_by uuid not null references public.profiles(id),
 excess_quantities jsonb not null,
 reason text not null,
 approved_at timestamptz not null default now(),
 constraint order_receiving_excess_distinct check(approved_by<>receiver_id)
);
create index receiving_excess_request_idx on public.order_receiving_excess_approvals(request_id,seq desc);
create index receiving_requests_order_idx on public.order_receiving_requests(po_id,created_at);
alter table public.order_receiving_excess_approvals enable row level security;
alter table public.order_receiving_excess_approvals force row level security;
revoke all on public.order_receiving_excess_approvals from public,anon,authenticated;

create function public.guard_receiving_approval_immutable() returns trigger
language plpgsql set search_path=public,pg_temp as $$
begin
 raise exception 'RGO_APPROVAL_IMMUTABLE: Excess approval snapshots cannot be changed.' using errcode='23514';
end $$;
revoke all on function public.guard_receiving_approval_immutable() from public,anon,authenticated;
create trigger receiving_approval_immutable before update or delete on public.order_receiving_excess_approvals
 for each row execute function public.guard_receiving_approval_immutable();

-- Internal reader: the client readers/writers gate active membership and field accounts; no client EXECUTE grant.
create function public.order_receiving_approval_current(p_request uuid) returns boolean
language sql stable security definer set search_path=public,pg_temp as $$
 with approval as (
   select a.excess_quantities from public.order_receiving_excess_approvals a
    where a.request_id=p_request and a.org_id=public.auth_org_id() order by a.seq desc limit 1
 ), received as (
   select rl.item_id,sum(rl.quantity) q from public.procurement_receipt_lines rl
    join public.procurement_receipts rc on rc.id=rl.receipt_id
    left join public.order_receiving_requests req on req.receipt_id=rc.id
    left join public.order_receiving_reversals rev on rev.request_id=req.id
   where rl.org_id=public.auth_org_id() and coalesce(rc.erp_docstatus,1)<>2 and rc.erp_cancelled_at is null and rev.request_id is null
   group by rl.item_id
 )
 select coalesce((select bool_and(greatest((x->>'quantity')::numeric-greatest(i.quantity-coalesce(rc.q,0),0),0)
            <= coalesce((a.excess_quantities->>i.id::text)::numeric,0))
   from public.order_receiving_requests r cross join approval a
   cross join lateral jsonb_array_elements(r.counted_lines) x
   join public.procurement_items i on i.id=(x->>'item_id')::uuid and i.org_id=r.org_id
   left join received rc on rc.item_id=i.id
   where r.id=p_request and r.org_id=public.auth_org_id() and r.approved_by is not null),false)
$$;
revoke all on function public.order_receiving_approval_current(uuid) from public,anon,authenticated;

create or replace function public.receive_order_goods(p_po uuid, p_warehouse uuid, p_date date, p_lines jsonb, p_request uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_po public.purchase_orders; v_org uuid := public.auth_org_id(); v_uid uuid := auth.uid();
  v_r public.order_receiving_requests; v_doc public.stock_documents; v_proc public.procurements;
  e jsonb; v_item public.procurement_items; v_stock uuid; v_qty numeric; v_received numeric;
  v_excess boolean := false; v_fx numeric; v_fx_date date; v_currency text; v_lines jsonb := '[]'; v_receipt uuid;
begin
  perform public.assert_not_light();
  perform public.assert_is_active_member();
  v_po := public.receiving_lock_order(p_po);
  perform public.stock_assert_keeper(v_org, p_warehouse, v_uid);
  perform public.stock_assert_dates(v_org, p_date);
  if p_request is null or p_date is null or p_lines is null or jsonb_typeof(p_lines) <> 'array'
     or jsonb_array_length(p_lines) not between 1 and 200 then
    raise exception 'RGO_COUNTS: Enter counted quantities for at least one order line.' using errcode = '22023';
  end if;
  select * into v_r from public.order_receiving_requests where id = p_request;
  if found then
    if v_r.org_id <> v_org or v_r.receiver_id <> v_uid or v_r.po_id <> p_po or v_r.warehouse_id <> p_warehouse
       or v_r.receipt_date <> p_date or v_r.counted_lines <> p_lines then
      raise exception 'RGO_REFERENCE: This receipt reference already belongs to another count.' using errcode = '23505';
    end if;
    if v_r.stock_document_id is not null then return jsonb_build_object('id', p_request, 'status', 'posted', 'document_id', v_r.stock_document_id); end if;
  end if;
  select * into v_proc from public.procurements where id = v_po.procurement_id;
  select default_currency into v_currency from public.organizations where id = v_org;
  if v_proc.currency = v_currency then v_fx := 1; v_fx_date := p_date;
  else select rate, rate_date into v_fx, v_fx_date from public.fx_rate_on(v_proc.currency, v_currency, p_date); end if;
  if v_fx is null then
    raise exception 'RGO_FX_MISSING: No exchange rate for %/% on %.', v_proc.currency, v_currency, p_date using errcode = '23514', detail=jsonb_build_object('base',v_proc.currency,'quote',v_currency,'date',p_date::text)::text;
  end if;
  if exists (select 1 from jsonb_array_elements(p_lines) x group by x->>'item_id' having count(*) > 1) then
    raise exception 'RGO_DUPLICATE: Count each order line once.' using errcode = '22023';
  end if;
  for e in select value from jsonb_array_elements(p_lines) loop
    if exists (select 1 from jsonb_object_keys(e) k where k not in ('item_id','quantity')) then
      raise exception 'RGO_FIELDS: Enter only the order line and counted quantity.' using errcode = '22023';
    end if;
    v_qty := (e->>'quantity')::numeric;
    if v_qty is null or v_qty <= 0 or v_qty >= 100000000000 or v_qty <> round(v_qty,3) then
      raise exception 'RGO_QUANTITY: Enter a positive counted quantity with at most three decimals.' using errcode = '22023';
    end if;
    select * into v_item from public.procurement_items i where i.id = (e->>'item_id')::uuid and i.procurement_id = v_proc.id and i.org_id = v_org;
    if not found then raise exception 'RGO_NOT_FOUND: Order line not found.' using errcode = 'P0002'; end if;
    select m.stock_item_id into v_stock from public.order_stock_mappings m where m.item_id = v_item.id and m.org_id = v_org;
    if v_stock is null then raise exception 'RGO_UNMAPPED: This line follows the service or direct-use receiving path.' using errcode = '23514'; end if;
    select coalesce(sum(rl.quantity),0) into v_received from public.procurement_receipt_lines rl
      join public.procurement_receipts r on r.id = rl.receipt_id
      left join public.order_receiving_requests req on req.receipt_id = r.id
      left join public.order_receiving_reversals rev on rev.request_id = req.id
      where rl.item_id = v_item.id and coalesce(r.erp_docstatus,1) <> 2 and r.erp_cancelled_at is null and rev.request_id is null;
    v_excess := v_excess or v_qty > greatest(v_item.quantity - v_received,0); -- mut:rgo_excess
    v_lines := v_lines || jsonb_build_array(jsonb_build_object('item_id',v_stock,'quantity',v_qty,'unit_cost',round(v_item.rate * v_fx,4))); -- mut:rgo_cost
  end loop;
  if v_r.id is null then
    insert into public.order_receiving_requests(id,org_id,po_id,receiver_id,warehouse_id,receipt_date,counted_lines)
      values(p_request,v_org,p_po,v_uid,p_warehouse,p_date,p_lines) returning * into v_r;
  end if;
  if v_excess and not public.order_receiving_approval_current(p_request) then
    return jsonb_build_object('id',p_request,'status','awaiting_approval');
  end if;
  perform public.stock_validate_payload(v_org,'receive',jsonb_build_object('warehouse_id',p_warehouse),v_lines);
  insert into public.stock_documents(org_id,number,kind,warehouse_id,procurement_id,occurred_on,created_by)
    values(v_org,public.next_procurement_doc_number(v_org,'GR'),'receive',p_warehouse,v_proc.id,p_date,v_uid) returning * into v_doc;
  update public.order_receiving_requests set stock_document_id = v_doc.id, fx_rate = v_fx, fx_date = v_fx_date,
    source_currency = v_proc.currency, stock_currency = v_currency where id = p_request;
  perform public.stock_insert_lines(v_doc,v_lines);
  perform public.stock_post_core(v_doc.id);
  insert into public.procurement_receipts(org_id,procurement_id,po_id,gr_number,receipt_date,status)
    values(v_org,v_proc.id,p_po,v_doc.number,p_date,'Partial') returning id into v_receipt;
  insert into public.procurement_receipt_lines(receipt_id,item_id,org_id,quantity,recorded_by)
    select v_receipt,(x->>'item_id')::uuid,v_org,(x->>'quantity')::numeric,v_uid from jsonb_array_elements(p_lines) x;
  update public.order_receiving_requests set receipt_id = v_receipt where id = p_request;
  perform public.log_audit('order.receive',v_org,v_uid,p_request,jsonb_build_object('stock_document_id',v_doc.id,'receipt_id',v_receipt));
  return jsonb_build_object('id',p_request,'status','posted','document_id',v_doc.id);
end $$;

create or replace function public.approve_order_receiving(p_request uuid, p_reason text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare r public.order_receiving_requests; v_excess jsonb;
begin
  perform public.assert_not_light();
  perform public.assert_is_active_member();
  select * into r from public.order_receiving_requests where id = p_request and org_id = public.auth_org_id();
  if not found then raise exception 'RGO_COUNT_MISSING: Receipt count not found.' using errcode = 'P0002'; end if;
  perform public.receiving_lock_order(r.po_id);
  select * into r from public.order_receiving_requests where id=p_request for update;
  if not public.order_receiving_purchaser() or r.receiver_id = auth.uid() then -- mut:rgo_approval
    raise exception 'RGO_APPROVAL: A different purchasing user must approve this excess.' using errcode = '42501';
  end if;
  if r.stock_document_id is not null then raise exception 'RGO_DECIDED: This count is already decided.' using errcode = '23514'; end if;
  if nullif(btrim(p_reason),'') is null or length(p_reason) > 500 then raise exception 'RGO_REASON: Give a reason for accepting the excess.' using errcode = '22023'; end if;
  if public.order_receiving_approval_current(r.id) then return; end if;
  select jsonb_object_agg(i.id::text,greatest((x->>'quantity')::numeric-greatest(i.quantity-coalesce(rc.q,0),0),0)) into v_excess
    from jsonb_array_elements(r.counted_lines) x
    join public.procurement_items i on i.id=(x->>'item_id')::uuid and i.org_id=r.org_id
    left join lateral (
      select sum(rl.quantity) q from public.procurement_receipt_lines rl
       join public.procurement_receipts rc on rc.id=rl.receipt_id
       left join public.order_receiving_requests req on req.receipt_id=rc.id
       left join public.order_receiving_reversals rev on rev.request_id=req.id
      where rl.item_id=i.id and coalesce(rc.erp_docstatus,1)<>2 and rc.erp_cancelled_at is null and rev.request_id is null
    ) rc on true;
  insert into public.order_receiving_excess_approvals(org_id,request_id,receiver_id,approved_by,excess_quantities,reason)
    values(r.org_id,r.id,r.receiver_id,auth.uid(),v_excess,btrim(p_reason));
  update public.order_receiving_requests set approved_by = auth.uid(),approved_at = now(),approval_reason = btrim(p_reason) where id = r.id;
  perform public.log_audit('order.receive_excess',r.org_id,auth.uid(),r.id,jsonb_build_object('reason',p_reason,'excess',v_excess));
end $$;

create or replace function public.read_order_receiving(p_po uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_org uuid := public.auth_org_id(); v_po public.purchase_orders; v_purchaser boolean; v_lines jsonb; v_requests jsonb;
begin
  perform public.assert_not_light();
  perform public.assert_is_active_member();
  select * into v_po from public.purchase_orders where id = p_po and org_id = v_org;
  if not found then raise exception 'RGO_ORDER_MISSING: Order not found.' using errcode = 'P0002'; end if;
  if not exists(select 1 from public.order_receiving_settings where org_id=v_org and enabled) then return null; end if;
  v_purchaser := public.order_receiving_purchaser();
  if not v_purchaser and not public.actor_holds_job_role('storekeeper') and not exists
    (select 1 from public.stock_warehouse_keepers k where k.org_id=v_org and k.user_id=auth.uid()) then
    raise exception 'RGO_READ_ROLE: Receiving is for warehouse keepers and purchasing users.' using errcode='42501';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',i.id,'name',i.name,'stock_item_id',m.stock_item_id,'stock_name',s.name,'unit',u.code)
    || case when v_purchaser then jsonb_build_object('ordered',i.quantity::text,'received',coalesce(rc.q,0)::text,
       'outstanding',greatest(i.quantity-coalesce(rc.q,0),0)::text,
       'status',case when coalesce(rc.q,0)=0 then 'not_received' when rc.q<i.quantity then 'partly_received' else 'fully_received' end) else '{}'::jsonb end order by i.id),'[]') into v_lines
    from public.procurement_items i left join public.order_stock_mappings m on m.item_id=i.id
    left join public.stock_items s on s.id=m.stock_item_id left join public.stock_units u on u.id=s.unit_id
    left join lateral (select sum(rl.quantity) q from public.procurement_receipt_lines rl join public.procurement_receipts r on r.id=rl.receipt_id
      left join public.order_receiving_requests req on req.receipt_id=r.id left join public.order_receiving_reversals rev on rev.request_id=req.id
      where rl.item_id=i.id and coalesce(r.erp_docstatus,1)<>2 and r.erp_cancelled_at is null and rev.request_id is null) rc on true
    where i.procurement_id=v_po.procurement_id and i.org_id=v_org;
  select coalesce(jsonb_agg(jsonb_build_object('id',r.id,'receiver_id',r.receiver_id,'warehouse_id',r.warehouse_id,'date',r.receipt_date,
    'lines',r.counted_lines,'approved',public.order_receiving_approval_current(r.id),'document_id',r.stock_document_id,'reversed',rev.request_id is not null)
    order by r.created_at),'[]') into v_requests from public.order_receiving_requests r
    left join public.order_receiving_reversals rev on rev.request_id=r.id
    where r.po_id=p_po and r.org_id=v_org and (v_purchaser or r.receiver_id=auth.uid());
  return jsonb_build_object('purchaser',v_purchaser,'lines',v_lines,'requests',v_requests);
end $$;

create or replace function public.my_waiting_decisions()
  returns table (kind text, record_id uuid, project_id uuid, title text, created_at timestamptz)
  language plpgsql stable security definer set search_path = public as $$
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
   where d.org_id = v_org and d.status = 'submitted' and d.author_id is distinct from v_uid
     and public.dsr_may_validate(d.project_id)
  union all
  -- work_order_issue: the gate's role set; a Project Manager only for the projects they manage; money rows follow the SoD predicate
  select 'work_order_issue'::text, w.id, w.project_id, (coalesce(w.wo_number || ' · ', '') || w.title)::text, w.created_at
    from public.work_orders w
    join public.projects p on p.id = w.project_id
   where w.org_id = v_org and w.status = 'Draft'
     and v_role in ('Admin', 'Executive', 'Project Manager', 'Finance')
     and (v_role <> 'Project Manager' or p.project_manager_id = v_uid)
     and coalesce(w.order_value, 0) > 0 and w.order_value_set_by is not null and w.order_value_set_by is distinct from v_uid
     and (public.holds_won_value_authority(v_role)
          or (w.order_value_set_at is not null and public.is_active_member(w.order_value_set_by)
              and public.may_approve_work_of(w.order_value_set_by, v_uid)))
  union all
  -- delivery_record
  select 'delivery_record'::text, pr.id, pr.project_id, pr.title::text, pr.updated_at
    from public.procurements pr
    left join public.projects p on p.id = pr.project_id
   where pr.org_id = v_org and pr.status = 'Ordered'
     and (v_role = 'Admin'
          or (pr.requested_by_id = v_uid and v_role in ('Executive', 'Project Manager', 'Finance', 'Engineer'))
          or (v_role = 'Project Manager' and p.project_manager_id = v_uid))
  union all
  -- quantity_change
  select 'quantity_change'::text, q.id, q.project_id, coalesce(w.wo_number || ' · ', '') || w.title, coalesce(q.submitted_at, q.updated_at)
    from public.quantity_change_requests q
    join public.work_orders w on w.id = q.work_order_id
   where q.org_id = v_org and q.status = 'pending_approval' and public.qcr_may_approve_role(v_org)
     and q.author_id is distinct from v_uid and not (v_uid = any (q.editor_ids)) and q.submitted_by is distinct from v_uid
  union all
  -- certificate
  select 'certificate'::text, c.id, c.project_id, pr.title::text, coalesce(c.submitted_at, c.created_at)
    from public.subcontract_certificates c
    join public.procurements pr on pr.id = c.procurement_id
   where c.org_id = v_org and c.status = 'submitted' and v_role in ('Admin', 'Finance', 'Executive')
     and c.prepared_by is distinct from v_uid and c.submitted_by is distinct from v_uid
  union all
  -- transfer_receipt: narrower than the gate on purpose (a senior role may receive any transfer; only those addressed to the caller or kept by them are waiting for them)
  select 'transfer_receipt'::text, x.id, w.project_id, (x.number || ' · ' || w.name)::text, x.sent_at
    from public.stock_transfers x
    join public.stock_warehouses w on w.id = x.to_warehouse_id
   where x.org_id = v_org and x.status = 'Sent' and x.sent_by is distinct from v_uid
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
     and sd.created_by is distinct from v_uid
     and coalesce(public.role_rank(v_role) >= 20, false)
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
     and not (v_uid = any (asr.recorded_by_ids)) and not (v_uid = any (ad.recorded_by_ids))
     and public.attendance_second_record_may_decide()
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
    ) as waiting(kind, record_id, project_id, title, created_at)
   order by waiting.created_at asc nulls last, waiting.kind asc, waiting.record_id asc;
end; $$;

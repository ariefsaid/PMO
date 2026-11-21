-- 1313_stock_wo_transfer_balances_down.sql — reverse 1313: restore the 1031 and 1100 bodies.
create or replace function public.get_work_order_stock_balance(p_work_order_id uuid default null, p_project_id uuid default null)
  returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_org uuid; v_cost boolean; v_project uuid; v_rows jsonb;
begin
  perform public.assert_is_active_member();
  v_org := public.auth_org_id();
  v_cost := public.stock_can_see_cost();
  if p_work_order_id is not null then
    select w.project_id into v_project from public.work_orders w where w.id = p_work_order_id and w.org_id = v_org;
    if v_project is null then raise exception 'STK_NOT_FOUND: the work order is not in your organisation' using errcode = 'P0001'; end if;
    if p_project_id is not null and p_project_id <> v_project then
      raise exception 'STK_INVALID: the work order belongs to another project' using errcode = 'P0001'; end if;
  else
    v_project := p_project_id;
    if v_project is null or not exists (select 1 from public.projects p where p.id = v_project and p.org_id = v_org) then
      raise exception 'STK_NOT_FOUND: name a work order or a project in your organisation' using errcode = 'P0001'; end if;
  end if;

  with mv as (
    select case when wo.project_id = v_project then d.work_order_id else null end as work_order_id,
           l.item_id, l.warehouse_id,
           case when w.project_id = v_project and w.kind in ('site', 'yard', 'staging') and l.kind not in ('issue', 'return') and l.qty_delta > 0 then l.qty_delta else 0 end as q_in,
           case when w.project_id = v_project and w.kind in ('site', 'yard', 'staging') and l.kind not in ('issue', 'return') and l.qty_delta < 0 then -l.qty_delta else 0 end as q_moved,
           case when l.kind in ('issue', 'return') and d.project_id = v_project then -l.qty_delta else 0 end as q_out,
           case when w.project_id = v_project and w.kind in ('site', 'yard', 'staging') and l.kind in ('issue', 'return') then -l.qty_delta else 0 end as q_site_out,
           case when w.project_id = v_project and w.kind in ('site', 'yard', 'staging') and l.kind not in ('issue', 'return') and l.qty_delta > 0 then l.value_delta else 0 end as v_in,
           case when w.project_id = v_project and w.kind in ('site', 'yard', 'staging') and l.kind not in ('issue', 'return') and l.qty_delta < 0 then -l.value_delta else 0 end as v_moved,
           case when l.kind in ('issue', 'return') and d.project_id = v_project then -l.value_delta else 0 end as v_out,
           case when w.project_id = v_project and w.kind in ('site', 'yard', 'staging') and l.kind in ('issue', 'return') then -l.value_delta else 0 end as v_site_out
      from public.stock_ledger l
      join public.stock_documents d on d.id = l.document_id
      join public.stock_warehouses w on w.id = l.warehouse_id
      left join public.work_orders wo on wo.id = d.work_order_id and wo.org_id = v_org
     where l.org_id = v_org
       and ((w.project_id = v_project and w.kind in ('site', 'yard', 'staging'))
            or (d.project_id = v_project and l.kind in ('issue', 'return')))
       and (p_work_order_id is null or d.work_order_id = p_work_order_id)
  ), agg as (
    select work_order_id, item_id, warehouse_id,
           sum(q_in) as q_in, sum(q_moved) as q_moved, sum(q_out) as q_out, sum(q_site_out) as q_site_out,
           sum(v_in) as v_in, sum(v_moved) as v_moved, sum(v_out) as v_out, sum(v_site_out) as v_site_out
      from mv group by work_order_id, item_id, warehouse_id
  )
  select coalesce(jsonb_agg(
           jsonb_build_object('work_order_id', a.work_order_id, 'item_id', i.id, 'item_code', i.code, 'item_name', i.name,
                              'unit_code', u.code, 'warehouse_id', a.warehouse_id, 'warehouse_code', w.code, 'warehouse_kind', w.kind,
                              'tag_id', t.id, 'tag_name', t.name, 'zero_cost', coalesce(t.zero_cost, false),
                              'received_qty', trim_scale(a.q_in)::text, 'moved_out_qty', trim_scale(a.q_moved)::text,
                              'issued_qty', trim_scale(a.q_out)::text, 'on_site_qty', trim_scale(a.q_in - a.q_moved - a.q_site_out)::text)
           || case when v_cost then jsonb_build_object('received_value', a.v_in::text, 'moved_out_value', a.v_moved::text, 'issued_value', a.v_out::text,
                                                       'on_site_value', (a.v_in - a.v_moved - a.v_site_out)::text)
                   else '{}'::jsonb end
           order by a.work_order_id nulls last, i.code, w.code), '[]'::jsonb)
    into v_rows
    from agg a
    join public.stock_items i on i.id = a.item_id join public.stock_units u on u.id = i.unit_id
    join public.stock_warehouses w on w.id = a.warehouse_id
    left join public.stock_tags t on t.id = i.tag_id;
  return v_rows;
end $$;
revoke all on function public.get_work_order_stock_balance(uuid, uuid) from public, anon;
grant execute on function public.get_work_order_stock_balance(uuid, uuid) to authenticated;
create or replace function public.mrq_prior_quantity(p_work_order_id uuid, p_item_id uuid, p_exclude_request uuid) returns numeric
  language sql stable security definer set search_path = public, pg_temp as $$
  -- FR-MRQ-002 (site stock landed): stock already moved to the work order, by posted movements, plus the pending or approved
  -- requests of OTHER people not yet fulfilled. A fulfilled request is represented by its posted transfer, so it is never counted twice.
  select coalesce((
           select sum(l.qty_delta)
             from public.stock_ledger l
             join public.stock_documents d on d.id = l.document_id
             join public.stock_warehouses w on w.id = l.warehouse_id
            where d.work_order_id = p_work_order_id and l.item_id = p_item_id
              and d.kind = 'transfer' and l.qty_delta > 0 and w.kind in ('site', 'yard', 'staging')), 0)
       + coalesce((
           select sum(ml.quantity)
             from public.material_request_lines ml
             join public.material_requests r on r.id = ml.request_id
            where r.work_order_id = p_work_order_id and ml.item_id = p_item_id and r.id <> p_exclude_request
              and r.status in ('pending', 'approved')
              and not exists (
                select 1 from public.stock_documents d
                 where d.id = r.transfer_document_id and d.status = 'Posted'
              )), 0)
$$;

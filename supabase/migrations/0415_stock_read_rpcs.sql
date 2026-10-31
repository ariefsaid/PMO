-- #1512 S3: stock read RPCs (plan S3.2). Definer: ledger and balances have no client grant (D5, D8).
-- Cost keys are OMITTED below rank 20 (AC-STK-020); numerics are returned as text (NFR-STK-007).
create or replace function public.get_stock_on_hand(p_warehouse_id uuid default null, p_item_id uuid default null, p_include_zero boolean default false)
  returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_org uuid; v_cost boolean; v_n integer; v_rows jsonb;
begin
  perform public.assert_is_active_member();
  v_org := public.auth_org_id();
  v_cost := public.stock_can_see_cost();                                                                -- mut:cost
  select count(*) into v_n from public.stock_balances b
   where b.org_id = v_org and (p_warehouse_id is null or b.warehouse_id = p_warehouse_id) and (p_item_id is null or b.item_id = p_item_id)
     and (b.qty_on_hand > 0 or coalesce(p_include_zero, false));
  if v_n > 5000 then raise exception 'STK_TOO_MANY: narrow the filter (more than 5000 rows)' using errcode = 'P0001'; end if;
  select coalesce(jsonb_agg(
           jsonb_build_object('item_id', i.id, 'item_code', i.code, 'item_name', i.name, 'unit_code', u.code, 'whole_only', u.whole_only,
                              'warehouse_id', w.id, 'warehouse_code', w.code, 'warehouse_name', w.name, 'warehouse_kind', w.kind,
                              'qty_on_hand', trim_scale(b.qty_on_hand)::text)
           || case when v_cost then jsonb_build_object('value_on_hand', b.value_on_hand::text,
                                                       'avg_cost', case when b.qty_on_hand > 0 then round(b.value_on_hand / b.qty_on_hand, 4)::text end)
                   else '{}'::jsonb end
           order by w.code, i.code), '[]'::jsonb)
    into v_rows
    from public.stock_balances b
    join public.stock_items i on i.id = b.item_id join public.stock_units u on u.id = i.unit_id join public.stock_warehouses w on w.id = b.warehouse_id
   where b.org_id = v_org and (p_warehouse_id is null or b.warehouse_id = p_warehouse_id) and (p_item_id is null or b.item_id = p_item_id)
     and (b.qty_on_hand > 0 or coalesce(p_include_zero, false));
  return v_rows;
end $$;

create or replace function public.get_stock_ledger(
  p_item_id uuid default null, p_warehouse_id uuid default null, p_project_id uuid default null, p_boq_item_id uuid default null,
  p_document_id uuid default null, p_from date default null, p_to date default null, p_before_seq bigint default null, p_limit integer default 100)
  returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_org uuid; v_cost boolean; v_limit integer := least(greatest(coalesce(p_limit, 100), 1), 200); v_rows jsonb; v_n integer; v_min bigint;
begin
  perform public.assert_is_active_member();
  v_org := public.auth_org_id();
  v_cost := public.stock_can_see_cost();                                                                -- mut:cost_ledger
  with page as (
    select l.* from public.stock_ledger l
     where l.org_id = v_org
       and (p_item_id is null or l.item_id = p_item_id) and (p_warehouse_id is null or l.warehouse_id = p_warehouse_id)
       and (p_project_id is null or l.project_id = p_project_id) and (p_boq_item_id is null or l.boq_item_id = p_boq_item_id)
       and (p_document_id is null or l.document_id = p_document_id)
       and (p_from is null or l.occurred_on >= p_from) and (p_to is null or l.occurred_on <= p_to)
       and (p_before_seq is null or l.seq < p_before_seq)
     order by l.seq desc limit v_limit)
  select coalesce(jsonb_agg(
           jsonb_build_object('seq', g.seq, 'id', g.id, 'document_id', g.document_id, 'document_number', d.number, 'document_status', d.status,
                              'kind', g.kind, 'posted_at', g.posted_at, 'occurred_on', g.occurred_on, 'posted_by', g.posted_by, 'actor_name', pr.full_name,
                              'item_id', g.item_id, 'item_code', i.code, 'item_name', i.name, 'unit_code', u.code,
                              'warehouse_id', g.warehouse_id, 'warehouse_code', w.code,
                              'project_id', g.project_id, 'project_name', p.name, 'boq_item_id', g.boq_item_id, 'boq_item_code', b.item_code,
                              'qty_delta', trim_scale(g.qty_delta)::text, 'qty_after', trim_scale(g.qty_after)::text)
           || case when v_cost then jsonb_build_object('value_delta', g.value_delta::text, 'value_after', g.value_after::text) else '{}'::jsonb end
           order by g.seq desc), '[]'::jsonb),
         count(*), min(g.seq)
    into v_rows, v_n, v_min
    from page g
    join public.stock_documents d on d.id = g.document_id
    join public.stock_items i on i.id = g.item_id join public.stock_units u on u.id = i.unit_id
    join public.stock_warehouses w on w.id = g.warehouse_id
    left join public.profiles pr on pr.id = g.posted_by
    left join public.projects p on p.id = g.project_id
    left join public.boq_items b on b.id = g.boq_item_id;
  return jsonb_build_object('rows', v_rows, 'next_before_seq', case when v_n = v_limit then v_min end);
end $$;
revoke all on function public.get_stock_on_hand(uuid, uuid, boolean), public.get_stock_ledger(uuid, uuid, uuid, uuid, uuid, date, date, bigint, integer) from public, anon;
grant execute on function public.get_stock_on_hand(uuid, uuid, boolean), public.get_stock_ledger(uuid, uuid, uuid, uuid, uuid, date, date, bigint, integer) to authenticated;

-- 0984_work_order_stock_balance.sql — #2523: stock per work order (FR-SSW-030..033), spec docs/specs/stock-site-work.spec.md.
-- Proven by supabase/tests/stock_site_work.test.sql (AC-SSW-009).
-- Derived ONLY from stock_ledger rows joined to their document: nothing is stored per work order (FR-SSW-032).
-- Scope: ledger rows AT the project's site/yard/staging locations, grouped by the document's work order and location:
--   received = transfer in-legs · moved_out = transfer out-legs · issued = issues net of returns
--   on_site  = received - moved_out - issued   (open question 2: "on site for" and "issued to" shown separately)
-- A movement whose document names no work order lands in the NULL bucket ("unassigned"), so
--   sum over work orders + unassigned = the project's locations' transfer/issue/return movement, which the pgTAP file proves.
-- An issue taken from a central warehouse is not at a project location, so it is not in this balance.
-- Value is returned only to roles that read stock value today (stock_can_see_cost, AC-STK-020 omission). Numerics come back as text.
-- Definer: the ledger has no client grant; every read is bounded by auth_org_id().
-- ── REVERSE: drop function public.get_work_order_stock_balance(uuid, uuid);
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
    select d.work_order_id, l.item_id, l.warehouse_id,
           case when l.kind = 'transfer' and l.qty_delta > 0 then l.qty_delta   else 0 end as q_in,
           case when l.kind = 'transfer' and l.qty_delta < 0 then -l.qty_delta  else 0 end as q_moved,
           case when l.kind in ('issue', 'return') then -l.qty_delta            else 0 end as q_out,
           case when l.kind = 'transfer' and l.qty_delta > 0 then l.value_delta  else 0 end as v_in,
           case when l.kind = 'transfer' and l.qty_delta < 0 then -l.value_delta else 0 end as v_moved,
           case when l.kind in ('issue', 'return') then -l.value_delta          else 0 end as v_out
      from public.stock_ledger l
      join public.stock_documents d on d.id = l.document_id
      join public.stock_warehouses w on w.id = l.warehouse_id
     where l.org_id = v_org
       and l.kind in ('transfer', 'issue', 'return')
       and w.project_id = v_project and w.kind in ('site', 'yard', 'staging')
       and (p_work_order_id is null or d.work_order_id = p_work_order_id)
  ), agg as (
    select work_order_id, item_id, warehouse_id,
           sum(q_in) as q_in, sum(q_moved) as q_moved, sum(q_out) as q_out,
           sum(v_in) as v_in, sum(v_moved) as v_moved, sum(v_out) as v_out
      from mv group by work_order_id, item_id, warehouse_id
  )
  select coalesce(jsonb_agg(
           jsonb_build_object('work_order_id', a.work_order_id, 'item_id', i.id, 'item_code', i.code, 'item_name', i.name,
                              'unit_code', u.code, 'warehouse_id', a.warehouse_id, 'warehouse_code', w.code, 'warehouse_kind', w.kind,
                              'tag_id', t.id, 'tag_name', t.name, 'zero_cost', coalesce(t.zero_cost, false),
                              'received_qty', trim_scale(a.q_in)::text, 'moved_out_qty', trim_scale(a.q_moved)::text,
                              'issued_qty', trim_scale(a.q_out)::text, 'on_site_qty', trim_scale(a.q_in - a.q_moved - a.q_out)::text)
           || case when v_cost then jsonb_build_object('received_value', a.v_in::text, 'moved_out_value', a.v_moved::text, 'issued_value', a.v_out::text,
                                                       'on_site_value', (a.v_in - a.v_moved - a.v_out)::text)
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

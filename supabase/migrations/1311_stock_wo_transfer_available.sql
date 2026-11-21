-- 1311_stock_wo_transfer_available.sql — #2691. What a work order can still give back: its posted issue lines less the posted returns citing them.
-- Proven by supabase/tests/1310_stock_wo_transfer.test.sql (AC-WOT-004, 005, 014). Nothing here writes.
-- ── REVERSE: drop function public.get_work_order_returnable(uuid); drop function public.stock_wo_issue_sources(uuid, uuid, uuid);

-- One row per posted issue line of the work order that still has something to give back, oldest first (the allocation order of the move).
create or replace function public.stock_wo_issue_sources(p_org uuid, p_work_order_id uuid, p_item_id uuid default null)
  returns table (item_id uuid, source_line_id uuid, boq_item_id uuid, discipline_id uuid, remaining_qty numeric, remaining_value numeric)
  language sql stable security definer set search_path = public as $$
  select sl.item_id, sl.id, sl.boq_item_id, sd.discipline_id,
         (-e.qty_delta) - coalesce(r.q, 0), (-e.value_delta) - coalesce(r.v, 0)
    from public.stock_documents sd
    join public.stock_document_lines sl on sl.document_id = sd.id
    join public.stock_ledger e on e.line_id = sl.id and e.kind = 'issue'
    left join lateral (select sum(x.qty_delta) as q, sum(x.value_delta) as v from public.stock_ledger x
                        where x.source_line_id = sl.id and x.kind = 'return') r on true
   where sd.org_id = p_org and sd.kind = 'issue' and sd.status = 'Posted' and sd.work_order_id = p_work_order_id
     and (p_item_id is null or sl.item_id = p_item_id)
     and (-e.qty_delta) - coalesce(r.q, 0) > 0
   order by e.seq                                                     -- the ledger identity follows posting order; posted_at ties inside one transaction
$$;
revoke all on function public.stock_wo_issue_sources(uuid, uuid, uuid) from public, anon, authenticated;

create or replace function public.get_work_order_returnable(p_work_order_id uuid) returns jsonb
  language plpgsql stable security definer set search_path = public as $$
declare v_org uuid; v_cost boolean; v_rows jsonb;
begin
  perform public.assert_is_active_member();
  v_org := public.auth_org_id();
  v_cost := public.stock_can_see_cost();
  if not exists (select 1 from public.work_orders w where w.id = p_work_order_id and w.org_id = v_org) then
    raise exception 'STK_NOT_FOUND: the work order is not in your organisation' using errcode = 'P0001'; end if;
  select coalesce(jsonb_agg(
           jsonb_build_object('item_id', i.id, 'item_code', i.code, 'item_name', i.name, 'unit_code', u.code,
                              'quantity', trim_scale(a.q)::text, 'boq_item_id', case when a.boqs = 1 then a.one_boq end)
           || case when v_cost then jsonb_build_object('value', a.v::text) else '{}'::jsonb end
           order by i.code), '[]'::jsonb)
    into v_rows
    from (select s.item_id, sum(s.remaining_qty) as q, sum(s.remaining_value) as v, count(distinct s.boq_item_id) as boqs, min(s.boq_item_id::text)::uuid as one_boq
            from public.stock_wo_issue_sources(v_org, p_work_order_id) s group by s.item_id) a
    join public.stock_items i on i.id = a.item_id join public.stock_units u on u.id = i.unit_id;
  return v_rows;
end $$;
revoke all on function public.get_work_order_returnable(uuid) from public, anon;
grant execute on function public.get_work_order_returnable(uuid) to authenticated;

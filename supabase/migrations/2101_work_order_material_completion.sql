-- 2101_work_order_material_completion.sql — 1124d decision 2 (spec docs/specs/work-order-material-completion.spec.md).
-- Proven by supabase/tests/2101_work_order_material_completion.test.sql.
-- One read for the printable material completion screen of a work order: per material the issued, returned, moved in, moved out, counted
-- difference and balance, plus totals per unit. It writes nothing and adds no table. The movement figures come from the existing
-- get_work_order_stock_balance (the on-site figures the work order already shows); the issued/returned split and the count difference come from
-- the same ledger rows filtered to this work order. Cost figures are included only when stock_can_see_cost().
-- ── REVERSE (rollback/2101_work_order_material_completion_down.sql): drop the function.

create or replace function public.get_work_order_material_completion(p_work_order_id uuid) returns jsonb
  language plpgsql stable security definer set search_path = public, pg_catalog as $$
declare v_org uuid; v_cost boolean; v_out jsonb;
begin
  perform public.assert_is_active_member();
  v_org := public.auth_org_id();
  if not exists (select 1 from public.work_orders w where w.id = p_work_order_id and w.org_id = v_org) then
    raise exception 'STK_NOT_FOUND: the work order is not in your organisation' using errcode = 'P0001';
  end if;
  v_cost := public.stock_can_see_cost();

  with bal as (
    select (e->>'item_id')::uuid as item_id, sum((e->>'received_qty')::numeric) as received, sum((e->>'moved_out_qty')::numeric) as moved,
           sum((e->>'on_site_qty')::numeric) as on_site, sum(coalesce((e->>'on_site_value')::numeric, 0)) as on_site_value
      from jsonb_array_elements(public.get_work_order_stock_balance(p_work_order_id, null)) e group by 1
  ), led as (
    select l.item_id,
           sum(case when l.kind = 'issue'  and d.wo_transfer_id is null then -l.qty_delta else 0 end) as issued,
           sum(case when l.kind = 'return' and d.wo_transfer_id is null then  l.qty_delta else 0 end) as returned,
           sum(case when l.kind = 'issue'  and d.wo_transfer_id is null then -l.value_delta else 0 end) as issued_value,
           sum(case when l.kind = 'return' and d.wo_transfer_id is null then  l.value_delta else 0 end) as returned_value,
           sum(case when l.kind = 'count' then l.qty_delta else 0 end) as counted,
           sum(case when l.kind = 'count' and l.qty_delta > 0 then  l.qty_delta else 0 end) as count_gain,
           sum(case when l.kind = 'count' and l.qty_delta < 0 then -l.qty_delta else 0 end) as count_loss
      from public.stock_ledger l join public.stock_documents d on d.id = l.document_id
     where l.org_id = v_org and d.work_order_id = p_work_order_id group by l.item_id
  ), c as (
    select i.id as item_id, i.code as item_code, i.name as item_name, u.code as unit_code,
           coalesce(le.issued, 0) as issued, coalesce(le.returned, 0) as returned,
           coalesce(b.received, 0) - coalesce(le.count_gain, 0) as moved_in, coalesce(b.moved, 0) - coalesce(le.count_loss, 0) as moved_out,
           coalesce(le.counted, 0) as counted, coalesce(b.on_site, 0) as balance,
           coalesce(le.issued_value, 0) as issued_value, coalesce(le.returned_value, 0) as returned_value, coalesce(b.on_site_value, 0) as balance_value
      from (select item_id from bal union select item_id from led) k
      join public.stock_items i on i.id = k.item_id and i.org_id = v_org
      join public.stock_units u on u.id = i.unit_id
      left join bal b on b.item_id = k.item_id
      left join led le on le.item_id = k.item_id
  )
  select jsonb_build_object(
    'rows', coalesce((select jsonb_agg(jsonb_build_object('item_id', c.item_id, 'item_code', c.item_code, 'item_name', c.item_name, 'unit_code', c.unit_code,
           'issued', trim_scale(c.issued)::text, 'returned', trim_scale(c.returned)::text, 'moved_in', trim_scale(c.moved_in)::text,
           'moved_out', trim_scale(c.moved_out)::text, 'counted_difference', trim_scale(c.counted)::text, 'balance', trim_scale(c.balance)::text)
           || case when v_cost then jsonb_build_object('issued_value', c.issued_value::text, 'returned_value', c.returned_value::text, 'balance_value', c.balance_value::text)
                   else '{}'::jsonb end
           order by c.item_code) from c), '[]'::jsonb),
    'totals', coalesce((select jsonb_agg(jsonb_build_object('unit_code', x.unit_code, 'issued', trim_scale(x.issued)::text, 'returned', trim_scale(x.returned)::text,
           'moved_in', trim_scale(x.moved_in)::text, 'moved_out', trim_scale(x.moved_out)::text, 'counted_difference', trim_scale(x.counted)::text,
           'balance', trim_scale(x.balance)::text) order by x.unit_code)
           from (select unit_code, sum(issued) issued, sum(returned) returned, sum(moved_in) moved_in, sum(moved_out) moved_out, sum(counted) counted, sum(balance) balance
                   from c group by unit_code) x), '[]'::jsonb),
    'value_totals', case when v_cost then (select jsonb_build_object('issued', coalesce(sum(issued_value), 0)::text, 'returned', coalesce(sum(returned_value), 0)::text,
                                                                      'balance', coalesce(sum(balance_value), 0)::text) from c) end)
    into v_out;
  return v_out;
end $$;
revoke all on function public.get_work_order_material_completion(uuid) from public, anon;
grant execute on function public.get_work_order_material_completion(uuid) to authenticated;

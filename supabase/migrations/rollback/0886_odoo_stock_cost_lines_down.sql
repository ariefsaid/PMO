-- Rollback for 0886_odoo_stock_cost_lines.sql (#2282). Restores get_project_consumption to its 0417 body (verbatim, with its grants),
-- drops the stock-cost read, writers, helpers and tables, and deletes the feed cursor so a reapply re-reads every analytic line.
-- Revert the #2282 edge and app code in the same change: the ledger pass reads the table for an org whose inventory Odoo owns. With
-- both reverted, the next pass rebuilds the actuals snapshot from GL only (the refresh is org-wide): the publish marker is deleted below, so
-- a quiet organisation republishes on that pass, and no manual repair is needed.
begin;
create or replace function public.get_project_consumption(p_project_id uuid, p_from date, p_to date) returns jsonb
  language plpgsql stable security definer set search_path = public as $$
declare v_org uuid; v_cost boolean; v_months jsonb; v_allow jsonb; v_unplanned jsonb;
begin
  perform public.assert_is_active_member();
  v_org := public.auth_org_id();
  v_cost := public.stock_can_see_cost();                                                                  -- mut:cost_consumption
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 3660 then
    raise exception 'STK_INVALID: a valid date range is required' using errcode = 'P0001'; end if;
  if not exists (select 1 from public.projects p where p.id = p_project_id and p.org_id = v_org) then   -- mut:consumption_org
    raise exception 'STK_NOT_FOUND: the project is not in your organisation' using errcode = 'P0001'; end if;

  select coalesce(jsonb_agg(m.j order by m.month, m.boq_code, m.item_code), '[]'::jsonb) into v_months from (
    select date_trunc('month', l.occurred_on)::date as month, b.item_code as boq_code, i.code as item_code,
           jsonb_build_object('month', date_trunc('month', l.occurred_on)::date, 'boq_item_id', l.boq_item_id, 'boq_item_code', b.item_code,
                              'boq_description', b.description, 'item_id', l.item_id, 'item_code', i.code, 'item_name', i.name, 'unit_code', u.code,
                              'issued',       trim_scale(coalesce(sum(-l.qty_delta) filter (where l.kind = 'issue'), 0))::text,
                              'returned',     trim_scale(coalesce(sum(l.qty_delta)  filter (where l.kind = 'return'), 0))::text,
                              'net_consumed', trim_scale(sum(-l.qty_delta))::text,
                              'issued_by',    coalesce(jsonb_agg(distinct pr.full_name) filter (where l.kind = 'issue' and pr.full_name is not null), '[]'::jsonb))
           || case when v_cost then jsonb_build_object('net_value', sum(-l.value_delta)::text) else '{}'::jsonb end as j
      from public.stock_ledger l
      join public.boq_items b on b.id = l.boq_item_id
      join public.stock_items i on i.id = l.item_id
      join public.stock_units u on u.id = i.unit_id
      left join public.profiles pr on pr.id = l.posted_by
     where l.org_id = v_org and l.project_id = p_project_id and l.kind in ('issue','return') and l.occurred_on between p_from and p_to
     group by date_trunc('month', l.occurred_on), l.boq_item_id, b.item_code, b.description, l.item_id, i.code, i.name, u.code) m;

  select coalesce(jsonb_agg(a.j order by a.boq_code, a.item_code), '[]'::jsonb) into v_allow from (
    select b.item_code as boq_code, i.code as item_code,
           jsonb_build_object('id', al.id, 'boq_item_id', al.boq_item_id, 'boq_item_code', b.item_code, 'boq_description', b.description,
                              'item_id', al.item_id, 'item_code', i.code, 'item_name', i.name, 'unit_code', u.code,
                              'planned_quantity', trim_scale(al.planned_quantity)::text,
                              'net_to_date', trim_scale(coalesce(c.net, 0))::text,
                              'variance',    trim_scale(coalesce(c.net, 0) - al.planned_quantity)::text,
                              'over_allowance', coalesce(c.net, 0) > al.planned_quantity) as j                                  -- mut:overflag
      from public.boq_material_allowances al
      join public.boq_items b on b.id = al.boq_item_id and b.project_id = p_project_id and b.org_id = v_org
      join public.stock_items i on i.id = al.item_id
      join public.stock_units u on u.id = i.unit_id
      left join lateral (select sum(-l.qty_delta) as net from public.stock_ledger l
                          where l.org_id = v_org and l.project_id = p_project_id and l.boq_item_id = al.boq_item_id and l.item_id = al.item_id
                            and l.kind in ('issue','return') and l.occurred_on <= p_to) c on true) a;

  select coalesce(jsonb_agg(jsonb_build_object('boq_item_id', x.boq_item_id, 'boq_item_code', x.boq_code, 'boq_description', x.boq_description,
                                               'item_id', x.item_id, 'item_code', x.item_code, 'item_name', x.item_name, 'unit_code', x.unit_code,
                                               'net_to_date', trim_scale(x.net)::text) order by x.boq_code, x.item_code), '[]'::jsonb) into v_unplanned from (
    select l.boq_item_id, b.item_code as boq_code, b.description as boq_description, l.item_id, i.code as item_code, i.name as item_name, u.code as unit_code,
           sum(-l.qty_delta) as net
      from public.stock_ledger l
      join public.boq_items b on b.id = l.boq_item_id
      join public.stock_items i on i.id = l.item_id
      join public.stock_units u on u.id = i.unit_id
     where l.org_id = v_org and l.project_id = p_project_id and l.kind in ('issue','return') and l.occurred_on <= p_to
       and not exists (select 1 from public.boq_material_allowances al where al.boq_item_id = l.boq_item_id and al.item_id = l.item_id)
     group by l.boq_item_id, b.item_code, b.description, l.item_id, i.code, i.name, u.code having sum(-l.qty_delta) <> 0) x;

  return jsonb_build_object('project_id', p_project_id, 'from', p_from, 'to', p_to, 'months', v_months, 'allowances', v_allow, 'unplanned', v_unplanned);
end $$;
revoke all on function public.get_project_consumption(uuid, date, date) from public, anon;
grant execute on function public.get_project_consumption(uuid, date, date) to authenticated;
drop function if exists public.project_consumption_moves(uuid,uuid);
drop function if exists public.project_uncategorised_actuals(uuid,text);
drop function if exists public.record_odoo_stock_cost_check(uuid,timestamptz,jsonb,text,text,integer,integer);
drop function if exists public.mark_odoo_stock_cost_double_counts(uuid,bigint[]);
drop function if exists public.finish_odoo_stock_cost_census(uuid,timestamptz,integer);
drop function if exists public.mark_odoo_stock_cost_census_seen(uuid,timestamptz,text[]);
drop function if exists public.apply_odoo_stock_cost_page(uuid,jsonb,text);
drop function if exists public.odoo_stock_cost_tie(uuid,integer,bigint,text,bigint,boolean);
drop function if exists public.odoo_stock_cost_epoch(uuid);
drop table if exists public.odoo_stock_cost_checks;
drop table if exists public.odoo_stock_cost_census_seen;
drop table if exists public.odoo_stock_cost_lines;
delete from public.external_sync_watermarks where external_tier = 'odoo'
   and domain in ('ledger-stock-cost:odoo', 'ledger-stock-unpublished:odoo', 'ledger-stock-held:odoo', 'ledger-published:odoo');
notify pgrst, 'reload schema';
commit;

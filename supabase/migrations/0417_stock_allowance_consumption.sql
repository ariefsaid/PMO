-- #1512 S5: material allowances on BoQ lines and the project consumption report.
-- Plan docs/plans/2026-10-31-inventory-project-consumption.md (S5.3, S5.5). FR-STK-042/043/044/050, AC-STK-020..024.
-- Changes no existing table or function body (NFR-STK-008). Reversible via rollback/0417_stock_allowance_consumption_down.sql.

-- §1 allowances: planned quantity of a stock item for one BoQ line (work item). Not periodised (FR-STK-042).
create table public.boq_material_allowances (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null references public.organizations(id) default '00000000-0000-0000-0000-000000000001',
  boq_item_id      uuid not null references public.boq_items(id) on delete cascade,
  item_id          uuid not null references public.stock_items(id),
  planned_quantity numeric(14,3) not null constraint boq_material_allowances_qty_check check (planned_quantity > 0 and planned_quantity < 'Infinity'::numeric),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (boq_item_id, item_id)
);
create index boq_material_allowances_item_idx on public.boq_material_allowances (item_id);
create trigger boq_material_allowances_stamp_org_id before insert on public.boq_material_allowances for each row execute function public.stamp_org_id();

-- PQ-7: the BoQ line's project is the scope. Reuses 0245's may_record_project_progress (Finance rank and above, or the project's own PM).
-- Invoker + RLS (the 0250 progress_assessment_line_ok precedent): a foreign BoQ line or item is invisible, so it fails closed.
create or replace function public.boq_allowance_ok(p_boq_item_id uuid, p_item_id uuid) returns boolean
  language sql stable set search_path = public as $$
  select exists (select 1 from public.boq_items b join public.stock_items i on i.org_id = b.org_id
                  where b.id = p_boq_item_id and i.id = p_item_id and i.archived_at is null
                    and public.may_record_project_progress(b.project_id))                                -- mut:allowance_scope
$$;
revoke all on function public.boq_allowance_ok(uuid, uuid) from public, anon;
grant execute on function public.boq_allowance_ok(uuid, uuid) to authenticated;

alter table public.boq_material_allowances enable row level security;
alter table public.boq_material_allowances force row level security;
create policy boq_material_allowances_select on public.boq_material_allowances for select
  using (org_id = public.auth_org_id() and public.is_active_member());
create policy boq_material_allowances_insert on public.boq_material_allowances for insert
  with check (org_id = public.auth_org_id() and public.is_active_member() and public.boq_allowance_ok(boq_item_id, item_id));
create policy boq_material_allowances_update on public.boq_material_allowances for update
  using (org_id = public.auth_org_id() and public.is_active_member() and public.boq_allowance_ok(boq_item_id, item_id))
  with check (org_id = public.auth_org_id() and public.is_active_member() and public.boq_allowance_ok(boq_item_id, item_id));
create policy boq_material_allowances_delete on public.boq_material_allowances for delete
  using (org_id = public.auth_org_id() and public.is_active_member() and public.boq_allowance_ok(boq_item_id, item_id));
revoke all on public.boq_material_allowances from authenticated, anon;
grant select on public.boq_material_allowances to authenticated;
grant insert (boq_item_id, item_id, planned_quantity) on public.boq_material_allowances to authenticated;
grant update (planned_quantity) on public.boq_material_allowances to authenticated;
grant delete on public.boq_material_allowances to authenticated;

create or replace function public.touch_boq_material_allowance() returns trigger language plpgsql set search_path = public as $$
begin new.updated_at := now(); return new; end $$;
revoke all on function public.touch_boq_material_allowance() from public, anon, authenticated;
create trigger boq_material_allowances_touch before update on public.boq_material_allowances for each row execute function public.touch_boq_material_allowance();

-- §2 the report. Aggregates in SQL (FR-STK-044); one jsonb value, so no PostgREST row cap. Value keys only at rank >= 20 (FR-STK-063).
-- months:     per month x work item x item: issued, returned, net, who issued (D9: occurred_on is already an org-timezone date).
-- allowances: every allowance of the project, cumulative net to the END of the range, variance, over-allowance flag.
-- unplanned:  items consumed under a work item with no allowance row for that item (FR-STK-043).
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

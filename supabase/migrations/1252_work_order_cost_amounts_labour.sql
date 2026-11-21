-- 1252_work_order_cost_amounts_labour.sql — #2670: priced labour joins the work-order cost read.
-- RENAMES the outer wrapper from 1113 (public.work_order_cost_amounts(uuid)) to work_order_cost_amounts_pre_labour and
-- creates a new work_order_cost_amounts(uuid) with one extra column, labour_class_id. It does NOT redefine
-- work_order_cost_amounts_unpriced or work_order_cost_amounts_unrounded. With the switch off (or no applicable rate)
-- the rows are the old rows, labour_class_id null. A priced Approved timesheet line becomes reason 'counted' with
-- the organisation currency, its amount and class; for Project Manager the person is withheld. Labour is internal
-- costing outside the ledger: the project-actuals remainder row is untouched (computed inside the renamed read).
-- Proven by supabase/tests/1251_labour_cost_amounts.test.sql. Reverse: rollback/1252_work_order_cost_amounts_labour_down.sql.
alter function public.work_order_cost_amounts(uuid) rename to work_order_cost_amounts_pre_labour;
revoke all on function public.work_order_cost_amounts_pre_labour(uuid) from public, anon, authenticated;

create function public.work_order_cost_amounts(p_project_id uuid)
returns table(source text, record_id uuid, project_id uuid, work_order_id uuid, discipline_id uuid, occurred_on date,
              reference text, currency text, amount text, reason text, quantity numeric, quantity_unit text, person_id uuid,
              labour_class_id uuid)
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_org uuid := public.auth_org_id();
  v_cur text;
  v_pm boolean;
begin
  if not public.is_active_member() or public.auth_role() is null
     or public.auth_role() not in ('Admin', 'Executive', 'Finance', 'Project Manager') then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if not exists (select 1 from public.projects p where p.id = p_project_id and p.org_id = v_org) then
    raise exception 'project not found' using errcode = 'P0002';
  end if;
  select o.default_currency into v_cur from public.organizations o where o.id = v_org;
  v_pm := public.auth_role() = 'Project Manager';

  return query
  with priced as (select * from public.labour_cost_priced_lines(p_project_id))
  select b.source, b.record_id, b.project_id, b.work_order_id, b.discipline_id, b.occurred_on, b.reference, b.currency,
         b.amount, b.reason, b.quantity, b.quantity_unit, b.person_id, null::uuid
    from public.work_order_cost_amounts_pre_labour(p_project_id) b
   where not (b.source = 'timesheet_entry' and exists (select 1 from priced x where x.entry_id = b.record_id))
  union all
  select 'timesheet_entry', x.entry_id, p_project_id, x.work_order_id, x.discipline_id, x.entry_date, null::text, v_cur,
         x.amount::text, 'counted', x.hours, 'hours', case when v_pm then null::uuid else x.person_id end, x.class_id
    from priced x;
end $$;
revoke all on function public.work_order_cost_amounts(uuid) from public, anon;
grant execute on function public.work_order_cost_amounts(uuid) to authenticated;

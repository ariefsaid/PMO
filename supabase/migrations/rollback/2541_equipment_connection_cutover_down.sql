-- Restore the preceding hire-charge body and remove the accounting cutover snapshot.
create or replace function public.equipment_hire_charges(p_org_id uuid, p_draft jsonb default null, p_project_id uuid default null)
returns table(setting_id uuid, setting_key uuid, version int, asset_id uuid, project_id uuid, month date,
              category public.budget_category, fiscal_year text, work_units numeric, standby_units numeric,
              work_rate numeric, standby_rate numeric, amount numeric, entry_count int, as_of timestamptz, rate_unit text)
language sql stable set search_path = public, pg_temp as $$
  select v.id, v.setting_key, v.version, v.asset_id, e.project_id, date_trunc('month', e.work_date)::date, v.charge_category,
         to_char(e.work_date, 'YYYY'),                                                              -- PQ-2
         coalesce(sum(e.quantity) filter (where e.kind = 'work'), 0),
         coalesce(sum(e.quantity) filter (where e.kind = 'standby'), 0),
         v.work_rate, v.standby_rate,
         round(coalesce(sum(e.quantity) filter (where e.kind = 'work'), 0) * v.work_rate
             + coalesce(sum(e.quantity) filter (where e.kind = 'standby'), 0) * coalesce(v.standby_rate, 0), 2),  -- once per row
         count(*)::int, max(e.approved_at), v.rate_unit
    from public.equipment_settings_effective(p_org_id, p_draft) v
    join public.equipment_usage_entries e
      on e.org_id = p_org_id and e.asset_id = v.asset_id and e.status = 'Approved' and e.archived_at is null
     and e.work_date between v.window_from and v.window_to
     and e.unit = v.rate_unit                       -- a charge never counts an entry in another unit than its rate
   where v.basis = 'hire_rate' and (p_project_id is null or e.project_id = p_project_id)
   group by v.id, v.setting_key, v.version, v.asset_id, e.project_id, date_trunc('month', e.work_date), v.charge_category,
            to_char(e.work_date, 'YYYY'), v.work_rate, v.standby_rate, v.rate_unit
$$;
drop trigger external_org_bindings_equipment_cutover on public.external_org_bindings;
drop function public.equipment_capture_accounting_cutover();
drop table public.equipment_accounting_cutover;

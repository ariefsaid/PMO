-- Native hire is classified by effective accounting connection intervals, including disconnected days.
-- drops: the unbounded first-date filter becomes a half-open connection-period filter; existing costing checks and formulas remain.
create table public.equipment_accounting_periods (
  org_id uuid not null references public.organizations(id) on delete cascade,
  effective_on date not null,
  effective_until date,
  captured_at timestamptz not null default now(),
  primary key(org_id,effective_on),
  check(effective_until is null or effective_until>=effective_on)
);
create unique index equipment_accounting_period_open on public.equipment_accounting_periods(org_id) where effective_until is null;
alter table public.equipment_accounting_periods enable row level security;
alter table public.equipment_accounting_periods force row level security;
create policy light_account_deny_select on public.equipment_accounting_periods as restrictive for select to authenticated
  using ((select public.actor_is_light()) is not true);
revoke all on public.equipment_accounting_periods from public,anon,authenticated;
grant all on public.equipment_accounting_periods to service_role;

-- Retain the prior captured boundary and close it where a disconnection is already recorded.
insert into public.equipment_accounting_periods(org_id,effective_on,effective_until)
select c.org_id,c.effective_on,
       case when exists(select 1 from public.external_org_bindings b where b.org_id=c.org_id and b.status='active'
                    and (b.external_tier='erpnext' or (b.external_tier='odoo' and b.activated_at is not null
                      and nullif(b.config->>'ledger_basis_at','') is not null))) then null
            else greatest(c.effective_on,(coalesce((select max(b.disconnected_at) from public.external_org_bindings b
                          where b.org_id=c.org_id and b.external_tier in ('erpnext','odoo')),statement_timestamp())
                          at time zone o.default_timezone)::date) end
from public.equipment_accounting_cutover c join public.organizations o on o.id=c.org_id;

create or replace function public.equipment_capture_accounting_cutover() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_category public.budget_category; v_effective timestamptz;
begin
  if new.status <> 'active' or not (new.external_tier='erpnext' or
       (new.external_tier='odoo' and new.activated_at is not null and nullif(new.config->>'ledger_basis_at','') is not null)) then
    if tg_op='UPDATE' then
      if old.status='active' and (old.external_tier='erpnext' or
         (old.external_tier='odoo' and old.activated_at is not null and nullif(old.config->>'ledger_basis_at','') is not null)) then
        perform pg_advisory_xact_lock(hashtextextended('equipment_costing:' || new.org_id::text,0));
        if not exists (select 1 from public.external_org_bindings b where b.org_id=new.org_id and b.status='active'
            and (b.external_tier='erpnext' or (b.external_tier='odoo' and b.activated_at is not null
              and nullif(b.config->>'ledger_basis_at','') is not null))) then
          v_effective := case when new.disconnected_at is distinct from old.disconnected_at
                              then coalesce(new.disconnected_at,statement_timestamp()) else statement_timestamp() end;
          update public.equipment_accounting_periods p
             set effective_until=greatest(p.effective_on,(v_effective at time zone o.default_timezone)::date)
            from public.organizations o
           where p.org_id=new.org_id and o.id=p.org_id and p.effective_until is null;
        end if;
      end if;
    end if;
    return new;
  end if;
  if tg_op='UPDATE' then
    if old.status='active' and old.connected_at is not distinct from new.connected_at and
       (old.external_tier='erpnext' or (old.external_tier='odoo' and old.activated_at is not null
          and nullif(old.config->>'ledger_basis_at','') is not null)) then
      return new;
    end if;
  end if;
  -- Same serialization as equipment_costing_write: rate saves and connection cannot interleave.
  perform pg_advisory_xact_lock(hashtextextended('equipment_costing:' || new.org_id::text,0));
  select s.charge_category into v_category from public.equipment_settings_effective(new.org_id) s
   where s.basis='hire_rate' and not exists (
     select 1 from public.budget_category_account_map m where m.org_id=new.org_id and m.category=s.charge_category)
   order by s.charge_category limit 1;
  if v_category is not null then
    raise exception 'map an account to the % category first',v_category using errcode='P0002';
  end if;
  v_effective := case when new.external_tier='odoo' then (new.config->>'ledger_basis_at')::timestamptz else coalesce(new.connected_at,new.activated_at,new.created_at) end;
  insert into public.equipment_accounting_cutover(org_id,effective_on)
  select new.org_id,(v_effective at time zone o.default_timezone)::date from public.organizations o where o.id=new.org_id
  on conflict(org_id) do nothing;
  -- A retained Odoo basis marker cannot move a renewed connection back across a native interval.
  insert into public.equipment_accounting_periods(org_id,effective_on)
  select new.org_id,((case when new.external_tier='odoo'
                           then greatest(v_effective,new.connected_at,new.activated_at) else v_effective end)
                    at time zone o.default_timezone)::date
    from public.organizations o where o.id=new.org_id
     and not exists (select 1 from public.equipment_accounting_periods p where p.org_id=new.org_id and p.effective_until is null)
  on conflict(org_id,effective_on) do update set effective_until=null;
  return new;
end $$;

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
     and not exists (select 1 from public.equipment_accounting_periods c
                      where c.org_id = p_org_id and e.work_date >= c.effective_on
                        and (c.effective_until is null or e.work_date < c.effective_until))
   group by v.id, v.setting_key, v.version, v.asset_id, e.project_id, date_trunc('month', e.work_date), v.charge_category,
            to_char(e.work_date, 'YYYY'), v.work_rate, v.standby_rate, v.rate_unit
$$;

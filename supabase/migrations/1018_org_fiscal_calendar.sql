-- 1018 (#2329): a fiscal calendar in PMO for an organization with no accounting system.
-- Rollback: supabase/migrations/rollback/1018_org_fiscal_calendar_down.sql
--
-- One setting, derived years (spec D-1): the organization states the month its fiscal year starts and every fiscal
-- year is computed from it, so there is no table of years to keep. Names follow D-2: a January start names a year by
-- its calendar year ('2027'); any other start names it '<start year>-<end year>' ('2026-2027' = 2026-04-01..2027-03-31).
-- A budget-year label maps to a fiscal year only by that exact name; free-text labels are never parsed into dates.
--
-- The accounting system keeps its own calendar (D-3): where the organization reads an accounting-system ledger
-- (org_reads_erp_ledger, 0765) the setter refuses and org_pmo_fiscal_start_month() reads NULL, so a value left over
-- from before a connection is never used.

alter table public.organizations
  add column fiscal_year_start_month smallint
  constraint organizations_fiscal_year_start_month_check check (fiscal_year_start_month between 1 and 12);

comment on column public.organizations.fiscal_year_start_month is
  'The month (1-12) the organization''s fiscal year starts, for an organization with no accounting system (#2329). '
  'NULL = not set. Ignored while the organization reads an accounting-system ledger. Written only through '
  'set_org_fiscal_year_start_month (Admin); fiscal years are derived from it, never stored.';

-- The fiscal year a date falls in: the one starting on the latest first-of-the-start-month on or before the date.
create function public.pmo_fiscal_year_for_date(p_date date, p_start_month integer)
returns table(name text, start_date date, end_date date)
language sql immutable strict parallel safe set search_path = pg_catalog as $$
  with s as (
    select make_date(extract(year from p_date)::int
                     - case when extract(month from p_date)::int < p_start_month then 1 else 0 end,
                     p_start_month, 1) as d
     where p_start_month between 1 and 12
  )
  select case when p_start_month = 1 then to_char(s.d, 'YYYY')
              else to_char(s.d, 'YYYY') || '-' || to_char((s.d + interval '1 year')::date, 'YYYY') end,
         s.d,
         (s.d + interval '1 year' - interval '1 day')::date
    from s
$$;

-- A budget-year label's fiscal year, or no row: the label must be exactly the name pmo_fiscal_year_for_date gives.
create function public.pmo_fiscal_year_by_name(p_name text, p_start_month integer)
returns table(name text, start_date date, end_date date)
language sql immutable strict parallel safe set search_path = public, pg_catalog as $$
  select y.name, y.start_date, y.end_date
    from (select case
                   when p_start_month = 1 and p_name ~ '^[0-9]{4}$' and left(p_name, 4)::int >= 1
                     then make_date(left(p_name, 4)::int, 1, 1)
                   when p_start_month between 2 and 12 and p_name ~ '^[0-9]{4}-[0-9]{4}$' and left(p_name, 4)::int >= 1
                     then make_date(left(p_name, 4)::int, p_start_month, 1)
                 end as d) x
    cross join lateral public.pmo_fiscal_year_for_date(x.d, p_start_month) y
   where y.name = p_name
$$;

revoke all on function public.pmo_fiscal_year_for_date(date, integer) from public, anon;
revoke all on function public.pmo_fiscal_year_by_name(text, integer) from public, anon;
grant execute on function public.pmo_fiscal_year_for_date(date, integer) to authenticated, service_role;
grant execute on function public.pmo_fiscal_year_by_name(text, integer) to authenticated, service_role;

-- The caller's organization's start month, or NULL when unset or when an accounting system keeps the calendar.
create function public.org_pmo_fiscal_start_month()
returns smallint
language sql stable security invoker set search_path = public, pg_temp as $$
  select o.fiscal_year_start_month
    from public.organizations o
   where o.id = public.auth_org_id()
     and public.is_active_member()
     and not public.org_reads_erp_ledger()
$$;
revoke all on function public.org_pmo_fiscal_start_month() from public, anon;
grant execute on function public.org_pmo_fiscal_start_month() to authenticated, service_role;

-- What Administration › Accounting shows: who keeps the calendar, and PMO's start month when PMO keeps it.
create function public.get_org_fiscal_year_setting()
returns table(source text, start_month smallint)
language sql stable security invoker set search_path = public, pg_temp as $$
  select case when public.org_reads_erp_ledger() then 'accounting_system' else 'pmo' end,
         case when public.org_reads_erp_ledger() then null::smallint else o.fiscal_year_start_month end
    from public.organizations o
   where o.id = public.auth_org_id()
     and public.is_active_member()
$$;
revoke all on function public.get_org_fiscal_year_setting() from public, anon;
grant execute on function public.get_org_fiscal_year_setting() to authenticated;

-- The only write path. Admin-only (the same gate as the other org accounting configuration, 0207), refused where an
-- accounting system keeps the calendar, audited like the tax default. NULL clears it. A change re-cuts every past
-- payment at once (spec D-6): years are derived, so nothing else needs rewriting.
create function public.set_org_fiscal_year_start_month(p_month integer)
returns smallint
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_org uuid := public.auth_org_id();
  v_old smallint;
begin
  if v_org is null or not public.is_active_member() or public.auth_role() is distinct from 'Admin' then
    raise exception 'only an Admin can set the fiscal year' using errcode = '42501';
  end if;
  if p_month is not null and p_month not between 1 and 12 then
    raise exception 'the fiscal year start month must be 1 to 12' using errcode = '22023';
  end if;
  if public.org_reads_erp_ledger() then
    raise exception 'the accounting system sets the fiscal year'
      using errcode = 'P0001', hint = 'fiscal_calendar_owned_by_accounting_system';
  end if;
  select o.fiscal_year_start_month into v_old from public.organizations o where o.id = v_org for update;
  if v_old is distinct from p_month then
    update public.organizations set fiscal_year_start_month = p_month where id = v_org;
    perform public.log_audit('org.fiscal_year_start.change', v_org, auth.uid(), v_org,
                             jsonb_build_object('from', v_old, 'to', p_month));
  end if;
  return p_month::smallint;
end $$;
revoke all on function public.set_org_fiscal_year_start_month(integer) from public, anon;
grant execute on function public.set_org_fiscal_year_start_month(integer) to authenticated;

-- A visible project's PMO calendar in the BudgetProjectFiscalCalendar shape the accounting-system read returns
-- (supabase/functions/external-items/projectFiscalCalendar.ts): the consecutive fiscal years covering the project's
-- dates, only the start year for an open-ended project. NULL for a project the caller cannot see.
create function public.get_pmo_fiscal_calendar(p_project_id uuid)
returns jsonb
language plpgsql stable security invoker set search_path = public, pg_temp as $$
declare
  v_start date;
  v_end date;
  v_month smallint;
  v_project jsonb;
  v_years jsonb;
begin
  select p.start_date, p.end_date into v_start, v_end
    from public.projects p
   where p.id = p_project_id and p.org_id = public.auth_org_id() and public.is_active_member();
  if not found then
    return null;
  end if;
  v_project := jsonb_build_object('start', v_start, 'end', v_end);
  if v_start is null or (v_end is not null and v_end < v_start) then
    return jsonb_build_object('status', 'bad-project-dates', 'project', v_project);
  end if;
  if public.org_reads_erp_ledger() then
    return jsonb_build_object('status', 'binding-unavailable', 'project', v_project);
  end if;
  v_month := public.org_pmo_fiscal_start_month();
  if v_month is null or coalesce(v_end, v_start) > v_start + interval '100 years' then
    return jsonb_build_object('status', 'unresolved', 'project', v_project);
  end if;
  select jsonb_agg(jsonb_build_object('name', y.name, 'start', y.start_date, 'end', y.end_date) order by y.start_date)
    into v_years
    from generate_series((select f.start_date from public.pmo_fiscal_year_for_date(v_start, v_month) f),
                         coalesce(v_end, v_start), interval '1 year') g(d)
    cross join lateral public.pmo_fiscal_year_for_date(g.d::date, v_month) y;
  return jsonb_build_object('status', 'resolved', 'project', v_project, 'years', v_years);
end $$;
revoke all on function public.get_pmo_fiscal_calendar(uuid) from public, anon;
grant execute on function public.get_pmo_fiscal_calendar(uuid) to authenticated;

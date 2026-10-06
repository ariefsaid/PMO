-- Reverses 0251: restores 0245's get_management_pack verbatim. Run before 0250's rollback.
create or replace function public.get_management_pack(p_from date default null, p_to date default null)
  returns jsonb language plpgsql stable set search_path = public as $$
declare
  v_org    uuid := public.auth_org_id();
  v_tz     text;
  v_cur    text;
  v_to     date;
  v_from   date;
  v_result jsonb;
begin
  if v_org is null or not public.is_active_member() then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  select coalesce(o.default_timezone, 'UTC'), o.default_currency
    into v_tz, v_cur
    from public.organizations o where o.id = v_org;

  v_to   := coalesce(date_trunc('month', p_to)::date, public.org_current_month(v_tz, now()));
  v_from := coalesce(date_trunc('month', p_from)::date, date_trunc('year', v_to)::date);

  if v_from > v_to or v_from < (v_to - interval '23 months')::date then
    raise exception 'the management pack covers 1 to 24 months: the start month must be on or before the as-at month and at most 23 months before it'
      using errcode = '22023';
  end if;

  with counted as (
    select si.project_id, si.currency,
           date_trunc('month', si.invoice_date)::date as month,
           case when si.tax_treatment = 'inclusive' then si.amount - si.tax_amount else si.amount end as net
      from public.sales_invoices si
     where si.org_id = v_org
       and si.status in ('Submitted', 'Unpaid', 'Paid')
       and si.amount is not null
       and si.invoice_date is not null
       and si.invoice_date < (v_to + interval '1 month')::date
  ),
  in_window as (
    select project_id, currency, month, sum(net) as net, count(*)::int as invoice_count
      from counted where month >= v_from
     group by project_id, currency, month
  ),
  before_window as (
    select project_id, currency, sum(net) as net
      from counted where month < v_from
     group by project_id, currency
  ),
  proj as (
    select p.id, p.name, p.pmo_project_number, p.code, p.status::text as status, p.currency,
           case when p.tax_treatment = 'inclusive' then p.contract_value - coalesce(p.tax_amount, 0)
                else p.contract_value end as contract_net,
           p.start_date, p.end_date, p.project_manager_id, c.name as client_name
      from public.projects p
      left join public.companies c on c.id = p.client_id
     where p.org_id = v_org
       and (   (p.status in ('Won, Pending KoM', 'Ongoing Project', 'On Hold', 'Close Out') and p.archived_at is null)
            or exists (select 1 from in_window w where w.project_id = p.id))
  ),
  progress as (
    select e.project_id, e.month, e.pct_complete, e.entered_at, pr.full_name as entered_by_name
      from public.project_progress_entries e
      join proj on proj.id = e.project_id
      left join public.profiles pr on pr.id = e.entered_by
     where e.month <= v_to
       and (   e.month >= v_from
            or e.month = (select max(e2.month) from public.project_progress_entries e2
                           where e2.project_id = e.project_id and e2.month < v_from))
  )
  select jsonb_build_object(
    'from', v_from,
    'to', v_to,
    'timezone', v_tz,
    'org_currency', v_cur,
    'undated_invoice_count', (select count(*)::int from public.sales_invoices si
                               where si.org_id = v_org and si.status in ('Submitted', 'Unpaid', 'Paid')
                                 and si.amount is not null and si.invoice_date is null),
    'projects', coalesce((select jsonb_agg(to_jsonb(x) order by x.name, x.id) from proj x), '[]'::jsonb),
    'invoiced', coalesce((select jsonb_agg(to_jsonb(w) order by w.month, w.project_id, w.currency)
                            from in_window w
                           where w.project_id is null or w.project_id in (select id from proj)), '[]'::jsonb),
    'invoiced_before', coalesce((select jsonb_agg(to_jsonb(b) order by b.project_id, b.currency)
                                   from before_window b
                                  where b.project_id is null or b.project_id in (select id from proj)), '[]'::jsonb),
    'progress', coalesce((select jsonb_agg(to_jsonb(g) order by g.project_id, g.month) from progress g), '[]'::jsonb)
  ) into v_result;

  return v_result;
end; $$;
revoke all     on function public.get_management_pack(date, date) from public, anon;
grant  execute on function public.get_management_pack(date, date) to authenticated;

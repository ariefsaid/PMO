-- 0762_finance_hub_figures.sql — #1988: the Finance hub's three figures in ONE narrow invoker read.
-- The hub showed the per-currency unbilled figure (earned, not yet invoiced) and its contract-row
-- counts from the whole management pack, and the latest company P&L net profit from a full statement
-- read (catalogue + payload). This function returns exactly those figures:
--   pack.unbilled        — per-currency cents at the as-at month, the same sum the client derives from
--                          get_management_pack (0323's counted grouping, month-group cent rounding,
--                          progress-basis recognition via the pack's own half-up percent math);
--   pack.contract_rows / pack.invoiced_basis_rows — the pack's contract rows and how many have no
--                          progress entry at or before the as-at month;
--   statement.*          — the latest month period at or before today and its company P&L
--                          "profit for the period" value at the first visible non-total currency
--                          column, with the snapshot currency, plus `unpublished` when the org has
--                          no statement rows at all.
-- SECURITY INVOKER like get_management_pack/get_financial_statement: RLS and the explicit org filter
-- stay the tenancy boundary; whenever the full statement read would refuse (0321's consistency
-- contract), this read refuses with the same error, so the hub never shows a figure the full read
-- would not.
-- Reversal: supabase/migrations/rollback/0762_finance_hub_figures_down.sql.

create or replace function public.get_finance_hub_figures()
returns jsonb
language plpgsql
stable
security invoker
set search_path = public, pg_temp
as $$
declare
  v_org  uuid := public.auth_org_id();
  v_role text := public.auth_role()::text;
  v_tz   text;
  v_to   date;
  v_from date;
  v_today date;
  v_bad  boolean;
  v_project_map jsonb;
  v_period_start date;
  v_unpublished boolean;
  v_payload jsonb;
  v_col text;
  v_currency text;
  v_net  numeric;
  v_pack jsonb;
  v_statement jsonb;
begin
  if v_org is null or not public.is_active_member() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if v_role not in ('Admin', 'Finance', 'Executive') then
    raise exception 'not permitted' using errcode = '42501';
  end if;

  select coalesce(o.default_timezone, 'UTC')
    into v_tz
    from public.organizations o where o.id = v_org;

  v_to    := public.org_current_month(v_tz, now());
  v_from  := date_trunc('year', v_to)::date;
  v_today := (now() at time zone v_tz)::date;

  -- ── pack figures ── the client's derivation of the 0323 facts, computed where the data lives ──
  v_pack := (
    with counted as (
      select w.project_id, w.currency,
             date_trunc('month', w.invoice_date)::date as month,
             w.net + w.recovery as net
        from public.sales_invoice_work_billed w
       where w.org_id = v_org
         and w.status in ('Submitted', 'Unpaid', 'Paid')
         and w.net is not null
         and w.invoice_date is not null
         and w.invoice_date < (v_to + interval '1 month')::date
         and not w.is_down_payment
    ),
    proj as (
      select p.id, p.currency,
             (case when p.tax_treatment = 'inclusive'
                   then p.contract_value - coalesce(p.tax_amount, 0)
                   else p.contract_value end) as contract_net
        from public.projects p
       where p.org_id = v_org
         and (   (p.status in ('Won, Pending KoM', 'Ongoing Project', 'On Hold', 'Close Out') and p.archived_at is null)
              or exists (select 1 from counted w where w.project_id = p.id and w.month >= v_from))
    ),
    progress_latest as (
      select distinct on (e.project_id) e.project_id, e.pct_complete
        from public.project_progress_entries e
        join proj on proj.id = e.project_id
       where e.month <= v_to
       order by e.project_id, e.month desc
    ),
    key_cents as (
      -- the client rounds each of the facts' month groups to cents, then sums the groups
      select s.project_id, s.currency, sum(s.cents)::bigint as cents
        from (
          select project_id, currency, round(sum(net) * 100)::bigint as cents
            from counted where month >= v_from
           group by project_id, currency, month
          union all
          select project_id, currency, round(sum(net) * 100)::bigint
            from counted where month < v_from
           group by project_id, currency
        ) s
       where s.project_id is null or s.project_id in (select id from proj)
       group by s.project_id, s.currency
    ),
    project_unbilled as (
      select p.currency,
             (case
                when prog.pct_complete is not null
                  then floor((2 * (round(p.contract_net * 100)::bigint)::numeric
                                  * round(prog.pct_complete * 100)::bigint + 10000) / 20000)::bigint
                else coalesce(kc.cents, 0)
              end - coalesce(kc.cents, 0))::bigint as unbilled_cents
        from proj p
        left join progress_latest prog on prog.project_id = p.id
        left join key_cents kc on kc.project_id = p.id and kc.currency = p.currency
    ),
    figures as (
      -- rows without a contract recognise exactly what they billed, so they contribute their
      -- currency at zero; contract rows contribute recognised − invoiced in their own currency
      select x.currency, sum(x.unbilled_cents)::bigint as unbilled_cents
        from (
          select currency, unbilled_cents from project_unbilled
          union all
          select currency, 0::bigint from key_cents
           where project_id is null or project_id in (select id from proj)
        ) x
       group by x.currency
    )
    select jsonb_build_object(
      'as_at', v_to,
      'unbilled', coalesce((select jsonb_agg(jsonb_build_object('currency', currency, 'cents', unbilled_cents)
                                              order by currency)
                              from figures), '[]'::jsonb),
      'contract_rows', (select count(*)::int from proj),
      'invoiced_basis_rows', (select count(*)::int from proj p
                               where not exists (select 1 from progress_latest pr where pr.project_id = p.id))
    )
  );

  -- ── statement figures ── the 0321 read's own contract, narrowed to the two fields the hub shows ──
  select exists(
    select 1 from public.erp_financial_statement_availability a
    join public.erp_financial_statement_snapshot s on s.snapshot_id = a.snapshot_id and s.org_id = v_org
    where a.snapshot_id is not null and s.scope_kind = 'company' and s.project_id is null
      and (s.source_generation is distinct from a.source_generation or s.as_of is distinct from a.last_success_at
        or s.capture_started_at is distinct from a.capture_started_at
        or s.capture_completed_at is distinct from a.capture_completed_at)
  ) or exists(
    select 1 from public.erp_financial_statement_availability a
    join public.erp_financial_statement_snapshot s on s.snapshot_id = a.snapshot_id and s.org_id = v_org
    where a.snapshot_id is not null and s.scope_kind = 'company' and s.project_id is null
    group by s.snapshot_id
    having count(distinct s.display_precision) > 1 or count(distinct s.display_rounding_method) > 1
      or count(distinct s.capture_started_at) > 1 or count(distinct s.capture_completed_at) > 1
  ) or exists(
    select 1 from public.erp_financial_statement_availability a
    join public.erp_financial_statement_snapshot s on s.snapshot_id = a.snapshot_id and s.org_id = v_org
    where a.snapshot_id is not null and s.scope_kind = 'company' and s.project_id is null
    group by s.period_kind, s.current_start
    having count(distinct (s.current_end, s.prior_start, s.prior_end)) > 1
  ) into v_bad;
  if v_bad then raise exception 'Invalid statement selection' using errcode = '22023'; end if;

  select binding.config->'project_map' into v_project_map
    from public.external_org_bindings binding
   where binding.org_id = v_org and binding.external_tier = 'erpnext' and binding.activated_at is not null
   limit 1;

  -- `unpublished` mirrors the catalogue's empty period list (the hub's integrations pointer).
  select not exists (
    select 1
      from public.erp_financial_statement_availability a
      join public.erp_financial_statement_snapshot s on s.snapshot_id = a.snapshot_id and s.org_id = v_org
     where a.snapshot_id is not null and s.capture_started_at is not null
       and ( (s.scope_kind = 'company' and s.project_id is null)
          or (s.scope_kind = 'project' and s.project_id is not null
              and coalesce(jsonb_typeof(v_project_map) = 'object'
                and v_project_map ? s.project_id::text
                and jsonb_typeof(v_project_map->s.project_id::text) = 'string'
                and btrim(v_project_map->>s.project_id::text) <> '', false)
              and exists (select 1 from public.projects p where p.id = s.project_id and p.org_id = v_org)) )
  ) into v_unpublished;

  -- the latest month period at or before today over the catalogue's candidate set — the same period
  -- the hub picks from the catalogue before reading the statement.
  select s.current_start into v_period_start
    from public.erp_financial_statement_availability a
    join public.erp_financial_statement_snapshot s on s.snapshot_id = a.snapshot_id and s.org_id = v_org
   where a.snapshot_id is not null and s.capture_started_at is not null
     and s.period_kind = 'month' and s.current_start <= v_today
     and ( (s.scope_kind = 'company' and s.project_id is null)
        or (s.scope_kind = 'project' and s.project_id is not null
            and coalesce(jsonb_typeof(v_project_map) = 'object'
              and v_project_map ? s.project_id::text
              and jsonb_typeof(v_project_map->s.project_id::text) = 'string'
              and btrim(v_project_map->>s.project_id::text) <> '', false)
            and exists (select 1 from public.projects p where p.id = s.project_id and p.org_id = v_org)) )
   order by s.current_start desc
   limit 1;

  -- the 0321 read's company-scope selection of the profit-and-loss payload, plus the generation
  -- currency (the same latest-candidate row the read names in its envelope).
  with readable as materialized (
    select s.id, s.snapshot_id, s.as_of, s.capture_completed_at, s.currency,
           s.period_kind, s.current_start, s.payload, s.statement, s.view_kind
      from public.erp_financial_statement_availability a
      join public.erp_financial_statement_snapshot s on s.snapshot_id = a.snapshot_id and s.org_id = v_org
     where a.snapshot_id is not null and s.capture_started_at is not null
       and s.scope_kind = 'company' and s.project_id is null
  ), generation_row as (
    select currency from readable
     order by as_of desc, capture_completed_at desc, snapshot_id desc, id limit 1
  ), selected as (
    select payload from readable
     where period_kind = 'month' and current_start = v_period_start
       and statement = 'profit_and_loss' and view_kind = 'account_breakdown'
     limit 1
  )
  select (select currency from generation_row), (select payload from selected)
    into v_currency, v_payload;

  -- the client's own netProfit extraction: the first row whose label matches /profit for the period/i
  -- after apostrophe removal, at the first visible non-total currency column.
  if v_payload is not null then
    select c.value->>'fieldname' into v_col
      from jsonb_array_elements(v_payload->'current'->'columns') with ordinality c(value, ord)
     where c.value->>'type' = 'currency' and c.value->>'fieldname' <> 'total'
       -- JS `!column.hidden`: absent, null, false, 0 and "" are visible
       and coalesce(c.value->'hidden', 'null'::jsonb) in ('null'::jsonb, 'false'::jsonb, '0'::jsonb, '""'::jsonb)
     order by c.ord
     limit 1;
    if v_col is not null then
      -- Number(value) is null for non-numeric text; a bare cast would abort the whole read
      select case when jsonb_typeof(cell) = 'number'
                    or (jsonb_typeof(cell) = 'string' and (cell #>> '{}') ~ '^\s*-?[0-9]+(\.[0-9]+)?\s*$')
                  then btrim(cell #>> '{}')::numeric end
        into v_net
        from (
          select row_value -> v_col as cell
            from jsonb_array_elements(v_payload->'current'->'rows') with ordinality as t(row_value, ord)
           where (
             case when jsonb_typeof(row_value->'account_name') = 'string' then row_value->>'account_name'
                  when jsonb_typeof(row_value->'account') = 'string' then row_value->>'account' end
           ) is not null
             and position('profit for the period' in
                   lower(regexp_replace(
                     case when jsonb_typeof(row_value->'account_name') = 'string' then row_value->>'account_name'
                          when jsonb_typeof(row_value->'account') = 'string' then row_value->>'account' end,
                     '''', '', 'g'))) > 0
           order by ord
           limit 1
        ) profit_cell;
    end if;
  end if;

  v_statement := jsonb_build_object(
    'unpublished', v_unpublished,
    'period_start', v_period_start,
    'net_profit', v_net,
    'currency', v_currency
  );

  return jsonb_build_object('pack', v_pack, 'statement', v_statement);
end;
$$;

revoke all on function public.get_finance_hub_figures() from public, anon, authenticated, service_role;
grant execute on function public.get_finance_hub_figures() to authenticated;

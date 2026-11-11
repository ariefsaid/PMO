-- Reverse 0385: restore the pre-D1 dashboard RPC definitions from their latest prior migrations.
create or replace function get_win_rate(p_from date default null, p_to date default null)
  returns json
  language sql
  stable
  security invoker
  set search_path = public
as $$
  with decided as (
    select status, contract_value, currency from projects
    where ((p_from is null and p_to is null) or decided_at is not null)
      and (p_from is null or decided_at >= p_from)
      and (p_to   is null or decided_at <  (p_to + 1)::timestamptz)
  ),
  agg as (
    select
      count(*) filter (where status::text = any(on_hand_project_statuses())) as wins_count,
      count(*) filter (where status = 'Loss Tender') as losses_count,
      count(*) filter (where status = 'Declined') as declined_count
    from decided
  ),
  currency_agg as (
    select currency,
      coalesce(sum(contract_value) filter (where status::text = any(on_hand_project_statuses())), 0) as wins_value,
      coalesce(sum(contract_value) filter (where status = 'Loss Tender'), 0) as losses_value
    from decided
    group by currency
  ),
  value_totals as (
    select count(*) as currency_count,
      coalesce(sum(wins_value), 0) as wins_value,
      coalesce(sum(losses_value), 0) as losses_value,
      coalesce(json_agg(json_build_object(
        'currency', currency,
        'wins_value', wins_value,
        'losses_value', losses_value,
        'win_rate_value', case when wins_value + losses_value > 0
          then wins_value / (wins_value + losses_value) else null end
      ) order by currency), '[]'::json) as value_by_currency
    from currency_agg
  )
  select json_build_object(
    'wins_count', agg.wins_count,
    'losses_count', agg.losses_count,
    'declined_count', agg.declined_count,
    'wins_value', case when value_totals.currency_count = 1 then value_totals.wins_value else null end,
    'losses_value', case when value_totals.currency_count = 1 then value_totals.losses_value else null end,
    'win_rate_count', case when agg.wins_count + agg.losses_count > 0
        then agg.wins_count::numeric / (agg.wins_count + agg.losses_count) else 0 end,
    'win_rate_value', case
      when value_totals.currency_count <> 1 then null
      when value_totals.wins_value + value_totals.losses_value > 0
        then value_totals.wins_value / (value_totals.wins_value + value_totals.losses_value)
      else 0 end,
    'value_by_currency', value_totals.value_by_currency
  )
  from agg cross join value_totals;
$$;

create or replace function public.get_sales_pipeline()
  returns json
  language sql
  stable
  security invoker
  set search_path = public
as $$
  with pl as (
    select
      p.id,
      p.name,
      p.short_name,
      p.code,
      p.pmo_project_number,
      p.service_line,p.sector,p.location,p.award_type,p.bidding_entity,
      p.client_id,
      p.end_client_id,
      p.status,
      p.contract_value,
      p.currency,
      p.tax_treatment,
      p.tax_rate, p.tax_base_numerator, p.tax_base_denominator,
      p.last_update,
      p.project_manager_id,
      coalesce(c.win_probability, 0) as win_prob
    from projects p
    left join pipeline_stage_config c on c.status = p.status
    where p.status::text = any(pipeline_project_statuses())
      and p.archived_at is null
  )
  select json_build_object(
    'stages', coalesce((
      select json_agg(
        json_build_object(
          'status',        s.status,
          'count',         s.cnt,
          'total_value',   s.total_value,
          'win_probability', s.win_prob,
          'weighted_value',  s.total_value * s.win_prob
        )
        order by s.status
      )
      from (
        select
          status,
          count(*)::int           as cnt,
          sum(contract_value)     as total_value,
          max(win_prob)           as win_prob
        from pl
        group by status
      ) s
    ), '[]'::json),
    'projects', coalesce((
      select json_agg(
        json_build_object(
          'id',              pl.id,
          'name',            pl.name,
          'short_name',      pl.short_name,
          'code',            pl.code,
          'pmo_project_number', pl.pmo_project_number,
          'service_line', pl.service_line,
          'sector', pl.sector,
          'location', pl.location,
          'award_type', pl.award_type,
          'bidding_entity', pl.bidding_entity,
          'client_name',     coalesce(nullif(btrim(co.short_name), ''), co.name),
          'client_legal_name', co.name,
          'end_client_id',   pl.end_client_id,
          'end_client_name', coalesce(nullif(btrim(ec.short_name), ''), ec.name),
          'end_client_legal_name', ec.name,
          'status',          pl.status,
          'contract_value',  pl.contract_value,
          'currency',        pl.currency,
          'tax_treatment',   pl.tax_treatment,
          'tax_rate', pl.tax_rate,
          'tax_base_numerator', pl.tax_base_numerator,
          'tax_base_denominator', pl.tax_base_denominator,
          'win_probability', pl.win_prob,
          'last_update',     pl.last_update,
          'pm_name',         pm.full_name
        )
        order by pl.contract_value desc
      )
      from pl
      left join companies co on co.id = pl.client_id
      left join companies ec on ec.id = pl.end_client_id
      left join profiles  pm on pm.id = pl.project_manager_id
    ), '[]'::json)
  );
$$;

revoke all on function public.get_sales_pipeline() from public, anon;
grant execute on function public.get_sales_pipeline() to authenticated;
comment on function public.get_win_rate(date, date) is null;
comment on function public.get_sales_pipeline() is
  'Latest definition: 0365. Projects include the PMO Project Number, optional Client Project Code and the five classification fields. To add a projection column, copy this body and reapply AC-CODE-003 JSON-key proof.';
notify pgrst, 'reload schema';

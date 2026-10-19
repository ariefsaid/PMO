-- All-time win-rate includes recorded outcomes even when a close date was never recorded.
-- Bounded ranges still require a decision date so undated outcomes are not assigned to a period.
-- Value metrics are grouped by the project's currency; scalar value fields are intentionally
-- NULL when multiple currencies are present rather than summing unlike amounts.
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

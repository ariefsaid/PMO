-- All-time win-rate includes recorded outcomes even when a close date was never recorded.
-- Bounded ranges still require a decision date so undated outcomes are not assigned to a period.
create or replace function get_win_rate(p_from date default null, p_to date default null)
  returns json
  language sql
  stable
  security invoker
  set search_path = public
as $$
  with decided as (
    select status, contract_value from projects
    where ((p_from is null and p_to is null) or decided_at is not null)
      and (p_from is null or decided_at >= p_from)
      and (p_to   is null or decided_at <  (p_to + 1)::timestamptz)
  ),
  agg as (
    select
      count(*) filter (where status::text = any(on_hand_project_statuses())) as wins_count,
      count(*) filter (where status = 'Loss Tender') as losses_count,
      count(*) filter (where status = 'Declined') as declined_count,
      coalesce(sum(contract_value) filter (where status::text = any(on_hand_project_statuses())), 0) as wins_value,
      coalesce(sum(contract_value) filter (where status = 'Loss Tender'), 0) as losses_value
    from decided
  )
  select json_build_object(
    'wins_count', wins_count,
    'losses_count', losses_count,
    'declined_count', declined_count,
    'wins_value', wins_value,
    'losses_value', losses_value,
    'win_rate_count', case when wins_count + losses_count > 0
        then wins_count::numeric / (wins_count + losses_count) else 0 end,
    'win_rate_value', case when wins_value + losses_value > 0
        then wins_value / (wins_value + losses_value) else 0 end
  ) from agg;
$$;

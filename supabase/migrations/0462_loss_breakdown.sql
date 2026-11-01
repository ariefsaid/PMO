-- 0462_loss_breakdown.sql — #1577: loss counts by reason and by client for the win-rate tile.
-- security invoker (RLS scopes the org, like get_win_rate). Cohort and window = get_win_rate's decided cohort (0385):
-- all-time includes undated outcomes, a bounded window requires decided_at. Counts only, no amounts.
-- Reversal: rollback/0462_loss_breakdown_down.sql.
create or replace function public.get_loss_breakdown(p_from date default null, p_to date default null)
  returns json
  language sql
  stable
  security invoker
  set search_path = public
as $$
  with decided as (
    select p.status, p.client_id, p.lost_reason from projects p
    where ((p_from is null and p_to is null) or p.decided_at is not null)
      and (p_from is null or p.decided_at >= p_from)
      and (p_to   is null or p.decided_at <  (p_to + 1)::timestamptz)
  ),
  reasons as (
    select lost_reason as reason,
           (count(*) filter (where status = 'Loss Tender'))::int as losses_count,
           (count(*) filter (where status = 'Declined'))::int    as declined_count
    from decided where status in ('Loss Tender','Declined') group by lost_reason
  ),
  clients as (
    select d.client_id, c.name as client_name,
           (count(*) filter (where d.status::text = any(on_hand_project_statuses())))::int as wins_count,
           (count(*) filter (where d.status = 'Loss Tender'))::int as losses_count
    from decided d left join companies c on c.id = d.client_id
    where d.status::text = any(on_hand_project_statuses()) or d.status = 'Loss Tender'
    group by d.client_id, c.name
  )
  select json_build_object(
    'by_reason', coalesce((select json_agg(json_build_object('reason', reason, 'losses_count', losses_count,
                    'declined_count', declined_count) order by losses_count + declined_count desc, reason nulls last)
                  from reasons), '[]'::json),
    'by_client', coalesce((select json_agg(json_build_object('client_id', client_id, 'client_name', client_name,
                    'wins_count', wins_count, 'losses_count', losses_count)
                    order by wins_count + losses_count desc, client_name nulls last, client_id)
                  from (select * from clients
                        order by wins_count + losses_count desc, client_name nulls last, client_id limit 10) top), '[]'::json)
  );
$$;
revoke all     on function public.get_loss_breakdown(date, date) from public;
revoke execute on function public.get_loss_breakdown(date, date) from anon;
grant  execute on function public.get_loss_breakdown(date, date) to authenticated;

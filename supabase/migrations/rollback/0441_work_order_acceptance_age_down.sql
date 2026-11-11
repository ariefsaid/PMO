-- Reverses 0441_work_order_acceptance_age.sql: restore 0262 §9 get_unbilled_work_orders, then drop the view.
begin;
create or replace function public.get_unbilled_work_orders(p_limit integer default 8)
  returns jsonb language sql stable security invoker set search_path = public as $$
  with zone as (
    select coalesce((select o.default_timezone from public.organizations o where o.id = public.auth_org_id()), 'UTC') as tz
  ),
  live as (
    select b.work_order_id, b.wo_number, b.title, b.project_id, p.name as project_name, b.status, b.currency,
           b.remaining, b.figures_complete,
           case when b.status = 'Closed' and b.closed_at is not null
                then (now() at time zone zone.tz)::date - (b.closed_at at time zone zone.tz)::date end as days_since_closed
      from public.work_order_billing b
      join public.projects p on p.id = b.project_id
      cross join zone
     where b.status in ('Issued', 'Closed') and p.archived_at is null
  ),
  billable as (
    select * from live where figures_complete and remaining > 0
  )
  select jsonb_build_object(
    'totals', coalesce((select jsonb_agg(jsonb_build_object('currency', t.currency, 'remaining', t.remaining, 'count', t.n)
                                         order by t.currency)
                          from (select currency, sum(remaining) as remaining, count(*)::int as n
                                  from billable group by currency) t), '[]'::jsonb),
    'incomplete_count', (select count(*)::int from live where not figures_complete),
    'rows', coalesce((select jsonb_agg(to_jsonb(r) order by r.remaining desc, r.work_order_id)
                        from (select work_order_id, wo_number, title, project_id, project_name, status, currency,
                                     remaining, days_since_closed
                                from billable
                               order by remaining desc, work_order_id
                               limit greatest(1, least(coalesce(p_limit, 8), 50))) r), '[]'::jsonb))
$$;
comment on function public.get_unbilled_work_orders(integer) is
  'OD-BILL-1 / #786 DD-BWO-10: what is still to invoice on the org''s Issued and Closed work orders on live projects — '
  'totals per currency, the untotallable count, and the work orders with the most left. SECURITY INVOKER on purpose.';
revoke all on function public.get_unbilled_work_orders(integer) from public, anon;
grant execute on function public.get_unbilled_work_orders(integer) to authenticated;
drop view if exists public.work_order_uninvoiced_acceptance;
commit;

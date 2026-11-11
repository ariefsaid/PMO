-- 0441_work_order_acceptance_age.sql — #1640 (OD-GRILL-20261101): days since a work order's acceptance with no
-- invoice yet. Spec: docs/specs/work-order-milestones.spec.md §3, FR-WOMS-020..024. Plan: docs/plans/2026-11-01-work-order-milestones.md.
-- Reversal: rollback/0441_work_order_acceptance_age_down.sql.
-- ⚑ Read-only. No table, no column, no definer. One security_invoker view + get_unbilled_work_orders (0262 §9)
--   re-created with the same signature and one extra row key. RLS on every base relation stays the boundary.
-- ⚑ "Today" is inlined from organizations.default_timezone, NOT native_org_today(): that helper's EXECUTE is revoked
--   from authenticated (0275 §2) and would fail inside an invoker view.

create view public.work_order_uninvoiced_acceptance with (security_invoker = true) as
  select b.work_order_id, b.org_id, b.project_id, a.anchor_date,
         greatest(((now() at time zone coalesce(o.default_timezone, 'UTC'))::date - a.anchor_date), 0) as days
    from public.work_order_billing b
    left join public.organizations o on o.id = b.org_id
    cross join lateral (
      select min(x.acceptance_date) as anchor_date
        from public.work_order_acceptances x
       where x.work_order_id = b.work_order_id and x.org_id = b.org_id and x.status = 'Confirmed'
         and x.acceptance_date > coalesce((
               select max(coalesce(w.invoice_date, 'infinity'::date))
                 from public.sales_invoice_work_billed w
                where w.work_order_id = b.work_order_id and w.org_id = b.org_id
                  and not w.is_down_payment and w.status in ('Submitted', 'Unpaid', 'Paid')),
             '-infinity'::date)
    ) a
   where a.anchor_date is not null
     and b.status in ('Issued', 'Closed')
     and b.figures_complete
     and round((b.remaining + b.pending) * 100) > 0;
comment on view public.work_order_uninvoiced_acceptance is
  '#1640 FR-WOMS-020: per Issued/Closed work order with something not yet submitted-invoiced, the earliest confirmed '
  'BAST dated after its latest submitted (non-down-payment) invoice, and the org-local days since it. Derived, never stored.';
revoke all on public.work_order_uninvoiced_acceptance from public, anon, authenticated;
grant select on public.work_order_uninvoiced_acceptance to authenticated;

-- 0262 §9 verbatim, plus `days_since_acceptance` (left join; null when none). Same signature, still SECURITY INVOKER.
create or replace function public.get_unbilled_work_orders(p_limit integer default 8)
  returns jsonb language sql stable security invoker set search_path = public as $$
  with zone as (
    select coalesce((select o.default_timezone from public.organizations o where o.id = public.auth_org_id()), 'UTC') as tz
  ),
  live as (
    select b.work_order_id, b.wo_number, b.title, b.project_id, p.name as project_name, b.status, b.currency,
           b.remaining, b.figures_complete,
           case when b.status = 'Closed' and b.closed_at is not null
                then (now() at time zone zone.tz)::date - (b.closed_at at time zone zone.tz)::date end as days_since_closed,
           u.days as days_since_acceptance
      from public.work_order_billing b
      join public.projects p on p.id = b.project_id
      left join public.work_order_uninvoiced_acceptance u on u.work_order_id = b.work_order_id
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
                                     remaining, days_since_closed, days_since_acceptance
                                from billable
                               order by remaining desc, work_order_id
                               limit greatest(1, least(coalesce(p_limit, 8), 50))) r), '[]'::jsonb))
$$;
comment on function public.get_unbilled_work_orders(integer) is
  'OD-BILL-1 / #786 DD-BWO-10, #1640: what is still to invoice on the org''s Issued and Closed work orders on live projects — '
  'totals per currency, the untotallable count, and the work orders with the most left, each with days since closed and '
  'days since acceptance not invoiced. SECURITY INVOKER on purpose.';
revoke all on function public.get_unbilled_work_orders(integer) from public, anon;
grant execute on function public.get_unbilled_work_orders(integer) to authenticated;

do $$
begin
  if has_table_privilege('anon', 'public.work_order_uninvoiced_acceptance', 'select') then
    raise exception '0441: anon can read work_order_uninvoiced_acceptance';
  end if;
  if has_function_privilege('anon', 'public.get_unbilled_work_orders(integer)', 'execute') then
    raise exception '0441: anon can execute get_unbilled_work_orders';
  end if;
  if (select prosecdef from pg_proc where oid = 'public.get_unbilled_work_orders(integer)'::regprocedure) then
    raise exception '0441: get_unbilled_work_orders must stay SECURITY INVOKER';
  end if;
end $$;

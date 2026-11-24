-- 2283: expose values only to Finance, Executive and Admin; aggregate them per board column in the client.
-- Individual claim cards still carry no money. SECURITY INVOKER + RLS retain the tenancy boundary.
-- drops: extend the row projection with claim amount and currency and add the three-role organization gate.
-- Reverse: rollback/2283_billing_board_column_totals_down.sql.
begin;
drop function public.billing_board(uuid);
create function public.billing_board(p_project uuid default null)
  returns table (
    claim_id uuid, project_id uuid, project_name text, claim_value text, currency text, work_order_id uuid, wo_number text, claim_created_at timestamptz,
    step_count integer, steps_done integer, current_stage_id uuid, current_position smallint, current_name text,
    owner_role public.user_role, started_on date, last_completed_on date, target_days smallint, target_on date, due_on date,
    all_done boolean, today date)
  language sql stable security invoker set search_path = public as $$
  select pc.id, pc.project_id, p.name, pc.gross_amount::text, pc.currency::text, pc.work_order_id, wo.wo_number, pc.created_at,
         agg.step_count, agg.steps_done, cur.id, cur.position, cur.name,
         cur.owner_role, cur.started_on, agg.last_completed_on, cur.target_days, cur.target_on,
         case when cur.id is null then null
              when cur.target_on is not null then cur.target_on
              when cur.target_days is null or cur.started_on is null then null
              else cur.started_on + cur.target_days end,
         cur.id is null,
         (now() at time zone coalesce((select o.default_timezone from public.organizations o where o.id = pc.org_id), 'UTC'))::date
    from public.progress_claims pc
    join public.projects p on p.id = pc.project_id
    left join public.work_orders wo on wo.id = pc.work_order_id
    cross join lateral (
      select count(*)::integer as step_count,
             count(*) filter (where s.completed_on is not null or s.skipped_on is not null)::integer as steps_done,
             max(s.completed_on) as last_completed_on
        from public.claim_billing_stages s where s.claim_id = pc.id) agg
    left join lateral (
      select s.* from public.claim_billing_stages s
       where s.claim_id = pc.id and s.completed_on is null and s.skipped_on is null
       order by s.position limit 1) cur on true
   where public.is_active_member()
     and public.auth_org_id() is not null
     and public.auth_role() in ('Admin', 'Executive', 'Finance')
     and pc.org_id = public.auth_org_id()
     and pc.withdrawn_at is null
     and agg.step_count > 0
     and (p_project is null or pc.project_id = p_project)
     and not exists (select 1 from public.sales_invoices si where si.id = pc.id)
   order by coalesce(cur.started_on, agg.last_completed_on) nulls last, pc.created_at, pc.id
   limit 501
$$;
revoke all on function public.billing_board(uuid) from public, anon;
grant execute on function public.billing_board(uuid) to authenticated, service_role;
commit;

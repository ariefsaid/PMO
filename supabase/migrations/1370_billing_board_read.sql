-- 1370_billing_board_read.sql — the billing board: every open claim with its current step (#2681).
-- Spec docs/specs/billing-board.spec.md (FR-BBD-001..004); proven by supabase/tests/1370_billing_board.test.sql.
-- A READ over claim_billing_stages: no table, no write, no definer. SECURITY INVOKER, so RLS on claim_billing_stages / progress_claims /
-- projects / sales_invoices decides what a caller sees (Engineers are excluded by the stage tables' restrictive scope).
-- billing_stage_due_on is not executable by authenticated (1368), so the same two-branch rule is written inline; the test pins them together.
-- native_org_today is not executable by authenticated either, so the organisation's calendar day is written inline the same way.
-- Bounded: 501 rows (the caller shows 500 and a "truncated" notice). "Invoiced" = a sales invoice visible to the caller whose id is the claim id.
-- ── REVERSE: rollback/1370_billing_board_read_down.sql ───────────────────────────────────────────────────────────────

create function public.billing_board(p_project uuid default null)
  returns table (
    claim_id uuid, project_id uuid, project_name text, work_order_id uuid, wo_number text, claim_created_at timestamptz,
    step_count integer, steps_done integer, current_stage_id uuid, current_position smallint, current_name text,
    owner_role public.user_role, started_on date, last_completed_on date, target_days smallint, target_on date, due_on date,
    all_done boolean, today date)
  language sql stable security invoker set search_path = public as $$
  select pc.id, pc.project_id, p.name, pc.work_order_id, wo.wo_number, pc.created_at,
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
   where pc.withdrawn_at is null
     and agg.step_count > 0
     and (p_project is null or pc.project_id = p_project)
     and not exists (select 1 from public.sales_invoices si where si.id = pc.id)
   order by coalesce(cur.started_on, agg.last_completed_on) nulls last, pc.created_at, pc.id
   limit 501
$$;
revoke all on function public.billing_board(uuid) from public, anon;
grant execute on function public.billing_board(uuid) to authenticated, service_role;

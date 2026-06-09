-- 0020_sales_pipeline_attention.sql — extend get_sales_pipeline() so OPEN pipeline rows carry the
-- attention signals the FE needs (N14 / AC-IXD-PIPE-W5-C5: Owner + Last touch columns + the
-- "Needs attention" aging filter). Forward-only, additive; reversibility = `supabase db reset`
-- (pre-production, ADR-0006). Mirrors 0009_dashboard_margin.sql discipline.
--
-- BUG (Wave-5 C5): the FE attention columns (Owner / Last touch / aging / "Needs attention" filter)
-- are built, but get_sales_pipeline() projected ONLY { id, name, client_name, status,
-- contract_value, win_probability } for each open-pipeline row — no `last_update`, no owner — so those
-- columns rendered "—" for every open deal and the filter only ever fired on LOST deals (read via a
-- separate RLS path). A hollow feature.
--
-- FIX (minimal, additive, NO row-set or tenancy change): redefine get_sales_pipeline() to ALSO project,
-- per open-pipeline project row:
--   • last_update — projects.last_update (timestamptz; the column the projects table actually has;
--     0001_init_schema.sql §5.5). The aging/last-touch source the FE's daysSince()/isNeedsAttention()
--     already consume on lost rows.
--   • pm_name — the owner: projects.project_manager_id → profiles.full_name, the same join the FE uses
--     for lost deals (pm.full_name) and the project detail surfaces. NULL when the project has no PM.
--
-- SECURITY (NFR-SPD-SEC-001 / ADR-0009): this function STAYS `security invoker` — exactly as 0009
-- defined it. It is NOT a security-definer function (the task brief assumed definer; 0009 is the
-- authority and is invoker). Every base-table read below — projects, companies, pipeline_stage_config,
-- and the NEW profiles join — runs under the CALLER'S RLS policies (… = org_id = auth_org_id()), so all
-- rows stay org-scoped automatically. The profiles read is gated by profiles_select (org_id =
-- auth_org_id(), 0002_rls.sql): a cross-org PM name can never resolve — the join simply yields NULL for
-- any row whose project_manager_id is not visible to the caller, so no cross-org owner can leak. It
-- still takes NO org_id argument. DO NOT switch this to `security definer` without re-adding an explicit
-- `org_id = auth_org_id()` filter on EVERY table read here (projects, companies, AND profiles).
--
-- The row set is UNCHANGED — the same five open pipeline statuses, the same WHERE, the same ordering.
-- Only the SELECT list / projected columns grow (additive). The `stages` aggregate is untouched.
-- ============================================================================
create or replace function get_sales_pipeline()
  returns json
  language sql
  stable
  security invoker
as $$
  with pl as (
    select
      p.id,
      p.name,
      p.client_id,
      p.status,
      p.contract_value,
      p.last_update,
      p.project_manager_id,
      coalesce(c.win_probability, 0) as win_prob
    from projects p
    left join pipeline_stage_config c on c.status = p.status
    where p.status in (
      'Leads', 'PQ Submitted', 'Quotation Submitted', 'Tender Submitted', 'Negotiation'
    )
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
          'id',             pl.id,
          'name',           pl.name,
          'client_name',    co.name,
          'status',         pl.status,
          'contract_value', pl.contract_value,
          'win_probability', pl.win_prob,
          -- N14 attention signals (additive): last touch + owner for open-pipeline rows.
          -- profiles join is RLS-scoped (profiles_select: org_id = auth_org_id()) so a
          -- cross-org PM name cannot resolve — it yields NULL, never a leak.
          'last_update',    pl.last_update,
          'pm_name',        pm.full_name
        )
        order by pl.contract_value desc
      )
      from pl
      left join companies co on co.id = pl.client_id
      left join profiles  pm on pm.id = pl.project_manager_id
    ), '[]'::json)
  );
$$;

revoke all on function get_sales_pipeline() from public;
grant execute on function get_sales_pipeline() to authenticated;
-- Explicitly revoke anon EXECUTE to close unauthenticated surface (ADR-0009 Security LOW-1).
revoke execute on function get_sales_pipeline() from anon;

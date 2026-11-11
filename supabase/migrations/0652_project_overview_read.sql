-- 0652_project_overview_read.sql — one caller-scoped read for the project Overview's above-the-fold summaries.
-- Reversal: rollback/0652_project_overview_read_down.sql.
--
-- Replaces ten separate reads (finances, billing, BoQ, budget versions, committed spend, domain ownership, ledger
-- basis, milestones, comment count, org fx context) with ONE call. It is additive and read-only.
--
-- Security: `security invoker`, no definer. Every section calls the SAME function or reads the SAME table the page
-- reads today, under the caller's own role and RLS; nothing is re-implemented. A caller an inner function refuses is
-- refused with that function's own error, and the whole call fails the same way (the client then falls back to the
-- per-section reads). The `p_include_*` flags only SKIP work the page already skips; they cannot widen access because
-- each inner gate re-checks the caller. `org_id` is never taken from the client.
--
-- Budget: reuses `budget_version_read` (0650) for the first page. A page that overflows (or is full) returns null here,
-- and the client reads the budget itself, so nothing is ever truncated.

create function public.get_project_overview_read(
  p_project_id uuid,
  p_include_money boolean default false,
  p_include_commitments boolean default false,
  p_include_budget boolean default false
)
returns table (
  project_id uuid,
  finances jsonb,
  billing jsonb,
  boq_items jsonb,
  budget_versions jsonb,
  committed_spend jsonb,
  external_domain_ownership jsonb,
  reads_erp_ledger boolean,
  milestones jsonb,
  comment_count integer,
  org_default_currency text,
  org_default_timezone text
)
language plpgsql
stable
security invoker
set search_path = public, pg_temp
as $fn$
declare
  v_money boolean := coalesce(p_include_money, false);
  v_commit boolean := coalesce(p_include_commitments, false);
  v_budget boolean := coalesce(p_include_budget, false);
begin
  if p_project_id is null then
    raise exception 'get_project_overview_read: project is required' using errcode = '22004';
  end if;

  return query
  select
    p_project_id,
    case when v_money then public.get_project_finances(p_project_id) end,
    case when v_money then public.get_project_billing(p_project_id) end,
    case when v_money then (
      select coalesce(jsonb_agg(to_jsonb(b) order by b.line_no nulls last, b.created_at, b.id), '[]'::jsonb)
        from public.boq_items b where b.project_id = p_project_id
    ) end,
    case when v_budget then (
      with r as materialized (select * from public.budget_version_read(p_project_id, 0, 1000))
      select case when exists (select 1 from r where r.overflow) or (select count(*) from r) >= 1000 then null
                  else coalesce((select jsonb_agg(to_jsonb(r) order by r.version_no) from r), '[]'::jsonb) end
    ) end,
    case when v_commit then (
      select coalesce(jsonb_agg(to_jsonb(c) order by c.is_project_currency desc, c.currency), '[]'::jsonb)
        from public.project_committed_spend(p_project_id) c
    ) end,
    case when v_commit then (
      select coalesce(jsonb_agg(jsonb_build_object('id', e.id, 'org_id', e.org_id, 'external_tier', e.external_tier,
                                                   'domain', e.domain) order by e.external_tier, e.id), '[]'::jsonb)
        from public.external_domain_ownership e
    ) end,
    case when v_commit then public.org_reads_erp_ledger() end,
    (select coalesce(jsonb_agg(to_jsonb(m) order by m.sort_order, m.id), '[]'::jsonb)
       from public.get_project_milestones(p_project_id) m),
    (select count(*)::integer from public.comments c
      where c.entity_type = 'project' and c.entity_id = p_project_id and c.archived_at is null),
    o.default_currency,
    o.default_timezone
  from (select 1) one
  left join public.organizations o on o.id = public.auth_org_id();
end
$fn$;

revoke all on function public.get_project_overview_read(uuid, boolean, boolean, boolean) from public, anon;
grant execute on function public.get_project_overview_read(uuid, boolean, boolean, boolean) to authenticated;

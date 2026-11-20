-- 1047_projects_collection_set_based.sql — #2480: the Projects list's two batch reads are one pass each.
-- Rollback: migrations/rollback/1047_projects_collection_set_based_down.sql
--
-- MEASURED DEFECT (local stack, 500-project seed: scripts/perf/large-org-seed.sql, 308 live rows on the
-- active partition). The list page issues one 500-id money collection and one 500-id delivery summary.
-- Both bodies looped over the ids and called a per-project function for every row:
--   get_projects_money_collection   9,941 ms   (500 x get_project_finances / project_pmo_*_position)
--   get_projects_delivery           1,983 ms   (500 x project_pmo_commitment_position)
-- while the list's own row read (3 joins, 308 rows) is 1.6 ms. The rows paint first and the money/progress
-- columns then hold the screen for ~12 s of SQL. The numbers and method live in
-- docs/plans/2026-11-20-large-org-lists.md.
--
-- THE FIX: keep every money rule exactly where it is defined and call the SET-BASED forms that already
-- exist for the same figures:
--   • project_mapped_actuals_all(null)  (0376) — the org-wide form of project_mapped_actuals, proven row
--     for row equal by pgTAP. It is what the executive dashboard has read since 0656 for the same reason.
--   • project_pmo_positions(ids)        (0770) — the set-based form of project_pmo_spent_position +
--     project_pmo_commitment_position, proven row for row equal by supabase/tests/0770_pmo_positions.test.sql.
-- The ERP Actual stays `get_project_finances(...)->'actuals'`'s exact composition (see 0290), rebuilt from the
-- same project_mapped_actuals rows; the PMO Actual stays the 0700 basis (spent + open commitment).
-- The budget columns are the same three rules as the loop: no Active version → NULL; an unreadable Active
-- line → NULL; otherwise the Active sum. `get_projects_delivery`'s committed_spend now comes from one
-- aggregate over the committed purchases (the 0770 `committed` rule, not ERP-gated) instead of one call per id.
--
-- Parity is proved by the two existing oracle suites, unmodified in their figures:
--   supabase/tests/0493_money_collection_single_read.test.sql — new output == the 0700 loop output, all roles,
--     both ledger bases (its own per-project oracle), plus the single-read call-count assertions, now pinned
--     at ZERO per-project calls (the old file pinned exactly one per project — the defect this migration removes).
--   supabase/tests/0700_pmo_spend_split.test.sql — the PMO spent / committed figures.
--   supabase/tests/0069_dashboard_at_risk_boundary.test.sql, 0075, project_commitment_currency.test.sql —
--     get_projects_delivery's committed_spend, budget and withholds.
-- Index decision (#2480): NONE. The explain on the 500-project seed shows a 308-row seq scan + sort doing the
-- picker/list/identity reads in 0.5-1.6 ms and the name search in 0.6 ms. An index cannot improve that; the
-- cost was always the per-project loops, not a scan.

-- ── the Projects collection: one set-based read (was 0299 → 0396 → 0493 → 0700's plpgsql loop) ────────────
create or replace function public.get_projects_money_collection(p_project_ids uuid[])
returns table(project_id uuid, actuals jsonb, ledger_basis text, active_budget_amount text, active_budget_currency text, has_active_budget boolean)
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_role public.user_role := public.auth_role();
  v_org uuid := public.auth_org_id();
  v_erp boolean;
begin
  -- Validation order, messages and SQLSTATEs are byte-for-byte the 0700 body's (0493 asserts them).
  if not public.is_active_member() then
    raise exception 'your account is not an active member of this organisation' using errcode = '42501';
  end if;
  if v_role is null or v_role not in ('Admin','Finance','Executive','Project Manager') then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if p_project_ids is null or cardinality(p_project_ids) = 0 or cardinality(p_project_ids) > 500 then
    raise exception 'project selection is invalid' using errcode = '22023';
  end if;
  v_erp := public.org_reads_erp_ledger();

  return query
  with requested as (
    select distinct requested.id
      from unnest(p_project_ids) requested(id)
      join public.projects p on p.id = requested.id and p.org_id = v_org
  ), proj as (
    select p.id, p.currency, o.default_currency
      from public.projects p
      join public.organizations o on o.id = p.org_id
      join requested r on r.id = p.id
  ), -- the newest Active version's currency (the loop's ORDER BY version DESC, created_at DESC, id DESC)
  active_version as (
    select distinct on (v.project_id) v.project_id, v.currency
      from public.budget_versions v
     where v.org_id = v_org and v.status = 'Active'
       and v.project_id in (select id from requested)
     order by v.project_id, v.version desc, v.created_at desc, v.id desc
  ), -- the loop's budget columns: Active presence, an unreadable line, and the Active-version sum
  active_budget as (
    select v.project_id,
           true as has_active,
           count(li.id) filter (
             where li.budgeted_amount is null
                or li.budgeted_amount::text in ('NaN','Infinity','-Infinity')
           ) > 0 as unreadable,
           sum(li.budgeted_amount) as amount
      from public.budget_versions v
      left join public.budget_line_items li
        on li.budget_version_id = v.id and li.org_id = v.org_id
     where v.org_id = v_org and v.status = 'Active'
       and v.project_id in (select id from requested)
     group by v.project_id
  ), -- ERP Actuals: one org-wide attributed pass, the same rows project_mapped_actuals returns per project.
  -- The lateral's argument reads the gate row, so a PMO-basis org (no gate row) never runs the pass at all.
  pma as materialized (
    select a.*
      from (select null::text as fiscal_year where v_erp) gated
      cross join lateral public.project_mapped_actuals_all(gated.fiscal_year) a
     where a.project_id in (select id from requested)
  ), pma_agg as (
    select pma.project_id,
           -- get_project_finances: max(actuals_as_of) over the project's mapped-actuals rows.
           max(actuals_as_of) as as_of,
           -- get_project_finances: no mapped category, or a mapped one with no reading, leaves the total unstated.
           (count(*) filter (where mapped) = 0
             or count(*) filter (where mapped and actuals_to_date is null) > 0) as incomplete,
           sum(actuals_to_date) filter (where mapped) as total,
           -- 0376/0497: the same rule for the split totals the record header states beside `total`.
           (count(*) filter (where mapped) = 0
             or count(*) filter (where mapped and tagged_to_date is null) > 0) as tagged_incomplete,
           sum(tagged_to_date) filter (where mapped) as tagged_total,
           (count(*) filter (where mapped) = 0
             or count(*) filter (where mapped and attributed_to_date is null) > 0) as attributed_incomplete,
           sum(attributed_to_date) filter (where mapped) as attributed_total,
           (count(*) filter (where mapped) = 0
             or count(*) filter (where mapped and equipment_charge_to_date is null) > 0) as charge_incomplete,
           sum(equipment_charge_to_date) filter (where mapped) as equipment_charge_total,
           -- get_project_finances: every category, mapped flag and amount, ordered by the category enum.
           jsonb_agg(jsonb_build_object('category', category, 'mapped', mapped,
                                        'amount', actuals_to_date::text,
                                        'tagged_amount', tagged_to_date::text,
                                        'attributed_amount', attributed_to_date::text,
                                        'equipment_charge_amount', equipment_charge_to_date::text) order by category) as categories
      from pma
     group by pma.project_id
  ), pma_ok as (
    select distinct pma.project_id, category
      from pma
     where mapped and actuals_to_date is not null
  ), -- the loop's categories-complete rule: every Active-budget line category has a mapped, read actual
  category_coverage as (
    select b.project_id,
           count(distinct li.category) as n,
           count(distinct ok.category) as n_ok
      from public.budget_versions b
      join public.budget_line_items li on li.budget_version_id = b.id
      left join pma_ok ok on ok.project_id = b.project_id and ok.category = li.category
     where b.status = 'Active'
       and b.project_id in (select id from requested)
     group by b.project_id
  ), -- PMO Actuals (0700 basis): the set-based spent/committed positions, proven equal to the per-project pair
  pmp as materialized (
    select * from public.project_pmo_positions(p_project_ids)
  )
  select proj.id,
         case when v_erp then
           jsonb_set(
             jsonb_build_object(
               'currency', proj.default_currency,
               'as_of', pa.as_of,
               'excludes_restricted_rows', not coalesce(public.holds_spend_approval_authority(v_role), false),
               'total', case when pa.incomplete then null else pa.total end::text,
               'tagged_total', case when pa.tagged_incomplete then null else pa.tagged_total end::text,
               'attributed_total', case when pa.attributed_incomplete then null else pa.attributed_total end::text,
               'equipment_charge_total', case when pa.charge_incomplete then null else pa.equipment_charge_total end::text,
               'categories', coalesce(pa.categories, '[]'::jsonb)
             ),
             '{complete}',
             to_jsonb(
               coalesce(cc.n > 0 and cc.n = cc.n_ok, false)
               and coalesce(public.holds_spend_approval_authority(v_role), false)))
         else
           jsonb_build_object(
             'currency', proj.currency,
             'total', pm.spent::text,
             'as_of', null,
             'excludes_restricted_rows', false,
             'complete', pm.spent_complete,
             'committed_total', pm.committed::text,
             'committed_complete', pm.committed_complete,
             'categories', '[]'::jsonb)
         end,
         case when v_erp then 'erp' else 'pmo' end,
         case when ab.project_id is null then null
              when ab.unreadable then null
              else coalesce(ab.amount, 0)::text end,
         av.currency,
         coalesce(ab.has_active, false)
    from proj
    left join active_version av on av.project_id = proj.id
    left join active_budget ab on ab.project_id = proj.id
    left join pma_agg pa on pa.project_id = proj.id
    left join category_coverage cc on cc.project_id = proj.id
    left join pmp pm on pm.project_id = proj.id
   order by proj.id;
end $$;
revoke all on function public.get_projects_money_collection(uuid[]) from public, anon, authenticated;
grant execute on function public.get_projects_money_collection(uuid[]) to authenticated;

-- ── the delivery summary: committed_spend in one aggregate instead of one call per project id ─────────────
create or replace function get_projects_delivery(p_ids uuid[])
  returns table (
    project_id    uuid,
    delivery_pct  numeric,
    committed_spend numeric,
    budget        numeric
  )
  language sql stable security invoker set search_path = public as $$
  with eff as (
    select
      m.project_id,
      m.weight,
      coalesce(
        m.input_pct,
        count(t.id) filter (where t.status = 'Done') * 100.0 / nullif(count(t.id), 0),
        0
      ) as effective_pct,
      (m.input_pct is not null or count(t.id) > 0) as has_signal
    from project_milestones m
    left join tasks t on t.milestone_id = m.id
                     and t.parent_task_id is null   -- OD-INT-9: subtasks never move a percentage.
                     and t.archived_at is null      -- archived tasks never move a percentage.
    where m.project_id = any(p_ids)
    group by m.id
  ),
  -- The 0396 body selected the requested projects without an explicit org filter: under the caller's RLS that
  -- is the caller's org, and under service_role it is the requested set (the commitment figure stays NULL there,
  -- exactly as the per-project function returned). Keep that row set: rows are returned for EVERY requested
  -- project; only the commitment figure needs the four money roles, so that gate sits on its own CTE.
  proj as (
    select p.id, p.currency
      from public.projects p
     where p.id = any(p_ids)
  ),
  -- The per-project commitment position is exactly `sum(procurement_open_commitment)` over the project's
  -- committed-status purchases, in the project currency. 0723 already computes that CASE for many purchases
  -- in one set-based call (proved row for row by supabase/tests/0651_committed_spend_equivalence.test.sql),
  -- so the delivery read reuses it instead of calling the position once per project.
  cprocs as (
    select pr.id, pr.project_id, pr.currency, pr.total_value
      from public.procurements pr
      join proj on proj.id = pr.project_id
     where pr.org_id = public.auth_org_id()
       and pr.status::text = any (public.committed_procurement_statuses())
  ),
  open_commitment as materialized (
    select o.procurement_id, o.amount
      from public.procurement_open_commitments((select array_agg(id) from cprocs)) o
  ),
  commitment as (
    select proj.id as project_id,
           -- project_pmo_commitment_position: the project-currency open commitment, ignoring other currencies.
           coalesce(sum(o.amount) filter (where p.currency = proj.currency), 0) as amount,
           -- ...and complete only while every committed purchase is in the project currency and readable.
           coalesce(bool_and(coalesce(p.currency = proj.currency, false) and p.total_value is not null
                             and p.total_value::text not in ('NaN','Infinity','-Infinity')) filter (where p.id is not null), true) as complete
      from proj
      left join cprocs p on p.project_id = proj.id
      left join open_commitment o on o.procurement_id = p.id
     where public.auth_role() in ('Admin','Executive','Project Manager','Finance')
     group by proj.id
  ),
  committed as (
    select
      proj.id as project_id,
      coalesce((select sum(li.budgeted_amount)
                from budget_versions v join budget_line_items li on li.budget_version_id = v.id
                where v.project_id = proj.id and v.status = 'Active'), 0) as budget,
      case when cm.complete then cm.amount else null end as committed_spend
    from proj
    left join commitment cm on cm.project_id = proj.id

  )
  select
    c.project_id,
    case
      when bool_or(e.has_signal) then sum(e.weight * e.effective_pct) / nullif(sum(e.weight), 0)
      else null
    end as delivery_pct,
    c.committed_spend,
    c.budget
  from committed c
  left join eff e on e.project_id = c.project_id
  group by c.project_id, c.committed_spend, c.budget;
$$;

revoke all     on function get_projects_delivery(uuid[]) from public;
grant  execute on function get_projects_delivery(uuid[]) to   authenticated;
revoke execute on function get_projects_delivery(uuid[]) from anon;

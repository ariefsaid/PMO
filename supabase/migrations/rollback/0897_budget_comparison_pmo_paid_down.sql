-- 0897_budget_comparison_pmo_paid_down.sql: reverse of 0897. Re-creates the 0580 function body, then drops the helper.
create or replace function public.get_budget_comparison(p_project_id uuid, p_fiscal_year text default null)
returns table(
  category       public.budget_category,
  budget_total   numeric,
  recorded       numeric,
  recorded_as_of timestamptz,
  mapped         boolean,
  has_ledger     boolean,
  remaining      numeric,
  percent_used   numeric
)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  with visible_project as (
    -- Tenancy: the caller's own RLS-visible project in their active organization (RLS is the
    -- authority; these filters are defense in depth). No visible project ⇒ no rows at all.
    select p.id, p.start_date, p.end_date
      from public.projects p
     where p.id = p_project_id
       and p.org_id = public.auth_org_id()
       and public.is_active_member()
  ),
  active_version as (
    select v.id, v.budget_mode
      from public.budget_versions v
      join visible_project vp on vp.id = v.project_id
     where v.org_id = public.auth_org_id()
       and v.status = 'Active'
  ),
  -- All years: Σ the Active version's source lines per category, counted once (OD-BUDGET-1).
  all_years_budget as (
    select li.category, sum(li.budgeted_amount) as budget_total, true as has_relevant_budget
      from public.budget_line_items li
      join active_version v on v.id = li.budget_version_id
     where li.org_id = public.auth_org_id()
       and p_fiscal_year is null
     group by li.category
  ),
  -- Selected year, whole_project mode: the saved distribution rows are the approved authority.
  whole_year_budget as (
    select d.category, sum(d.amount) as budget_total, true as has_relevant_budget
      from public.budget_year_distributions d
      join active_version v on v.id = d.budget_version_id
     where d.org_id = public.auth_org_id()
       and v.budget_mode = 'whole_project'
       and p_fiscal_year is not null
       and d.fiscal_year = p_fiscal_year
     group by d.category
  ),
  -- Selected year, per_year mode: 0293 §3a verbatim — on-record is F-C ∨ F-A, never F-B.
  legacy_on_record as (
    select coalesce(p_fiscal_year, '') <> ''
           and (
             exists (
               select 1
                 from public.budget_versions v
                 join public.budget_line_items li on li.budget_version_id = v.id
                where v.project_id = p_project_id and v.status = 'Active'
                  and li.fiscal_year = p_fiscal_year                                     -- F-C
             )
             or exists (
               select 1
                 from public.budget_push_mirror_rows em
                 join public.budget_versions v on v.id = em.budget_version_id
                where v.project_id = p_project_id and v.status = 'Active'
                  and em.fiscal_year = p_fiscal_year
                  and em.push_state = 'pushed'                                           -- F-A
                  and em.budget_intent = 'ensure'
                  and (em.erp_account = '' or em.erp_docstatus is distinct from 2)
             )
           ) as on_record
  ),
  -- May an un-phased line attribute to the year? Only a SUCCEEDED push whose span witness still
  -- matches the project dates (a NULL witness pre-dates the rule and attributes per backward
  -- compat). A span is NEVER invented to fill a NULL witness, and a drifted witness stops the
  -- attribution — it is not moved and not split.
  legacy_attributed_null as (
    select 1
      from public.budget_push_mirror_rows em
      join public.budget_versions vv on vv.id = em.budget_version_id
      join public.projects proj on proj.id = vv.project_id
     where vv.project_id = p_project_id and vv.status = 'Active'
       and em.fiscal_year = p_fiscal_year
       and em.push_state = 'pushed'                                                      -- F-A
       and em.budget_intent = 'ensure'
       and (em.erp_account = '' or em.erp_docstatus is distinct from 2)
       and ( em.pushed_project_start_date is null                                        -- pre-issue push
             or ( em.pushed_project_start_date is not distinct from proj.start_date
                  and em.pushed_project_end_date is not distinct from proj.end_date ) )
  ),
  legacy_year_budget as (
    -- Per category: the year's canonical total plus the F-D suppression conjunction — "something is
    -- attributed here" AND "nothing is suppressed here". One un-placeable line makes the category's
    -- year total unknown (a partial total printed as THE budget is the understatement defect class).
    select li.category,
           sum(li.budgeted_amount) filter (
             where coalesce(li.fiscal_year = p_fiscal_year, false)
                or (li.fiscal_year is null and exists (select 1 from legacy_attributed_null))
           ) as budget_total,
           bool_or(
             coalesce(li.fiscal_year = p_fiscal_year, false)
             or (li.fiscal_year is null and exists (select 1 from legacy_attributed_null))
           )
           and bool_and(
             li.fiscal_year is not null                        -- phased ⇒ knowably in SOME year
             or exists (select 1 from legacy_attributed_null)  -- un-phased ⇒ only if attributable here
           ) as attribution_known,
           -- Presence follows relevant attribution evidence, not the numeric SUM. A phased line for
           -- this year or an un-phased line while a year is on record remains a visible unknown when
           -- F-D suppresses its amount; lines phased only to another year remain out of this scope.
           bool_or(
             coalesce(li.fiscal_year = p_fiscal_year, false)
             or (li.fiscal_year is null and (select r.on_record from legacy_on_record r))
           ) as has_relevant_budget
      from public.budget_line_items li
      join active_version v on v.id = li.budget_version_id and v.budget_mode = 'per_year'
     where li.org_id = public.auth_org_id()
       and p_fiscal_year is not null
     group by li.category
  ),
  budget as (
    -- Exactly one branch produces rows: all-years vs selected year, whole_project vs per_year mode.
    select a.category, a.budget_total, a.has_relevant_budget
      from all_years_budget a
     union all
    select w.category, w.budget_total, w.has_relevant_budget
      from whole_year_budget w
     union all
    select l.category,
           case when (select r.on_record from legacy_on_record r)
                     and coalesce(l.attribution_known, true)
                then l.budget_total end as budget_total,
           l.has_relevant_budget
      from legacy_year_budget l
  )
  select pm.category,
         b.budget_total,
         pm.actuals_to_date  as recorded,
         case when pm.mapped then pm.actuals_as_of end as recorded_as_of,
         pm.mapped,
         pm.has_rows         as has_ledger,
         case when b.budget_total is null or pm.actuals_to_date is null then null
              else b.budget_total - pm.actuals_to_date end as remaining,
         case when b.budget_total is null or b.budget_total = 0 or pm.actuals_to_date is null then null
              else pm.actuals_to_date / b.budget_total end as percent_used
    from visible_project vp
    join public.project_mapped_actuals(p_project_id, p_fiscal_year) pm on true
    left join budget b on b.category = pm.category
   -- A relevant but unknown amount still has a row: presence comes from the canonical ledger or
   -- selected-scope budget evidence, while unrelated legacy phases and silent categories stay absent.
   where b.budget_total is not null or pm.actuals_to_date is not null
      or pm.has_rows
      or coalesce(b.has_relevant_budget, false)
   order by pm.category;
$$;

revoke all on function public.get_budget_comparison(uuid, text) from public, anon, authenticated, service_role;
grant execute on function public.get_budget_comparison(uuid, text) to authenticated;

comment on function public.get_budget_comparison(uuid, text) is
  'Whole-project budget comparison (AC-014): Active budget authority vs ledger-recorded spending per category, all-years or one saved/legacy fiscal year; known zero stays distinct from absent, remaining/percent only on known inputs (percent is recorded/budget as a fraction).';

drop function if exists public.project_pmo_paid_by_category(uuid);

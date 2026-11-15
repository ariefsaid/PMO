-- 0897 (#2325): the Budget tab's comparison for an org with no accounting system.
-- Rollback: supabase/migrations/rollback/0897_budget_comparison_pmo_paid_down.sql
--
-- get_budget_comparison (0580) read recorded only from the accounting-system snapshot, so an org without one showed a blank
-- "no ledger account is mapped" row beside a header that said Spent 1,000. The basis rule every other reader uses
-- (org_reads_erp_ledger, 0307/0765; ADR-0093 §2) now applies here too: a ledger org reads its ledger exactly as before
-- (the 0580 final select, unchanged, as ledger_result); an org without one reads what PMO itself paid, pre-tax, per budget
-- category (pmo_result). Budget side, signature and grants are untouched.
--
-- The source is project_pmo_paid_by_category: the paid-purchase and hire-charge terms of project_pmo_spent_position (0700)
-- grouped by category, NULL (uncategorised) kept as its own group, a group unknown when any member is unreadable or in
-- another currency. "One definition" is held by supabase/tests/0897_budget_comparison_no_ledger.test.sql, which pins
-- Σ helper = project_pmo_spent_position. A fiscal-year scope stays unknown without an accounting system: there is no
-- fiscal calendar, and year labels are never parsed into dates.

create function public.project_pmo_paid_by_category(p_project_id uuid)
returns table(category public.budget_category, amount numeric, n int, as_of timestamptz)
language plpgsql stable security invoker set search_path = public, pg_temp as $$
begin
  -- The same role/org guard as project_pmo_spent_position (0700): a restricted role reads no row.
  if not exists (
    select 1 from public.projects p
     where p.id = p_project_id
       and p.org_id = public.auth_org_id()
       and public.auth_role() in ('Admin','Executive','Project Manager','Finance')
       and public.is_active_member()
  ) then
    return;
  end if;
  return query
  with target_project as (
    select p.id, p.org_id, p.currency, p.currency = o.default_currency as charge_in_project_currency
      from public.projects p join public.organizations o on o.id = p.org_id
     where p.id = p_project_id and p.org_id = public.auth_org_id()
  ), paid_rows as (
    select pr.budget_category as category,
           case when pr.currency = p.currency then public.procurement_paid_pre_tax(pr) end as paid,
           (select max(pay.date)::timestamptz from public.payments pay
             where pay.procurement_id = pr.id and pay.org_id = pr.org_id and pay.status = 'Paid'
               and coalesce(pay.erp_docstatus, 1) <> 2 and pay.erp_cancelled_at is null) as as_of
      from target_project p
      join public.procurements pr on pr.project_id = p.id and pr.org_id = p.org_id
     where pr.origin is distinct from 'erp_link'
       and exists (select 1 from public.payments pay
                    where pay.procurement_id = pr.id and pay.org_id = pr.org_id and pay.status = 'Paid'
                      and coalesce(pay.erp_docstatus, 1) <> 2 and pay.erp_cancelled_at is null)
  ), charges as (
    select q.category, case when (select charge_in_project_currency from target_project) then q.amount end as charged,
           q.as_of
      from public.equipment_charge_project_actuals(p_project_id, null) q
  ), terms as (
    select r.category, r.paid as amount, r.as_of from paid_rows r
    union all
    select c.category, c.charged, c.as_of from charges c
  )
  select t.category,
         case when bool_or(t.amount is null) then null::numeric else sum(t.amount) end,
         count(*)::int,
         max(t.as_of)
    from terms t
   group by t.category;
end $$;
revoke all on function public.project_pmo_paid_by_category(uuid) from public, anon;
grant execute on function public.project_pmo_paid_by_category(uuid) to authenticated, service_role;

-- 0580's function with the final select split by basis. The budget-side CTEs below are 0580's, unchanged.
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
  ),
  ledger_result as (
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
   where public.org_reads_erp_ledger()
     and (b.budget_total is not null or pm.actuals_to_date is not null
          or pm.has_rows
          or coalesce(b.has_relevant_budget, false))
  ),
  -- No accounting system (0560/0700 basis): recorded is what PMO itself paid, pre-tax, per budget category (plus the
  -- internal hire charge). PMO reads its own purchases completely, so a budget category with none is a known 0; a
  -- paid purchase with no category is its own row (budget 0: a budget line cannot be uncategorised), as is a named
  -- category with spend but no budget line. A fiscal-year scope has no fiscal calendar to place a payment in, so
  -- recorded stays unknown there. A role outside the helper's guard reads no recorded figure; that role list is
  -- the same one in project_pmo_spent_position (0700) and project_pmo_paid_by_category: keep the three in step.
  pmo_paid as (
    select h.category, h.amount, h.n, h.as_of
      from public.project_pmo_paid_by_category(p_project_id) h
     where p_fiscal_year is null
       and not public.org_reads_erp_ledger()
  ),
  pmo_base as (
    select coalesce(b.category, h.category) as category,
           -- All years with an Active version is complete: a category with no budget line is budgeted 0, known (never NULL,
           -- which would make the strip's approved total unknown); a paid purchase with no category has no line either.
           case when (b.category is null and h.category is null)
                  or (p_fiscal_year is null and exists (select 1 from active_version))
                then coalesce(b.budget_total, 0::numeric)
                else b.budget_total end as budget_total,
           case when p_fiscal_year is not null
                  or not coalesce(public.auth_role()::text in ('Admin','Executive','Project Manager','Finance'), false) then null::numeric
                when h.n is null then 0::numeric
                else h.amount end as recorded,
           h.as_of as recorded_as_of,
           coalesce(h.n, 0) > 0 as has_ledger,
           b.has_relevant_budget,
           h.n
      from budget b
      full join pmo_paid h on h.category = b.category
  ),
  pmo_result as (
    select x.category,
           x.budget_total,
           x.recorded,
           x.recorded_as_of,
           true as mapped,
           x.has_ledger,
           case when x.budget_total is null or x.recorded is null then null
                else x.budget_total - x.recorded end as remaining,
           case when x.budget_total is null or x.budget_total = 0 or x.recorded is null then null
                else x.recorded / x.budget_total end as percent_used
      from pmo_base x
     where not public.org_reads_erp_ledger()
       and exists (select 1 from visible_project)
       and (x.n is not null or x.budget_total is not null or coalesce(x.has_relevant_budget, false))
  )
  select r.category, r.budget_total, r.recorded, r.recorded_as_of, r.mapped, r.has_ledger, r.remaining, r.percent_used
    from (select * from ledger_result union all select * from pmo_result) r
   order by r.category
$$;

revoke all on function public.get_budget_comparison(uuid, text) from public, anon, authenticated, service_role;
grant execute on function public.get_budget_comparison(uuid, text) to authenticated;

comment on function public.get_budget_comparison(uuid, text) is
  'Whole-project budget comparison (AC-014): Active budget authority vs recorded spending per category, all-years or one saved/legacy fiscal year. Recorded is the accounting-system ledger when the org reads one, else PMO paid purchases pre-tax (0897; unknown in a fiscal-year scope). Known zero stays distinct from absent, remaining/percent only on known inputs (percent is recorded/budget as a fraction).';

-- 1019 (#2329): the Budget tab's comparison cut by the PMO fiscal calendar (1018) for an org with no accounting system.
-- Rollback: supabase/migrations/rollback/1020_budget_comparison_fiscal_year_cut_down.sql
--
-- A payment counts in the fiscal year of its date (spec D-4). A purchase's paid pre-tax amount in a year is its paid
-- amount in that year times the same pre-tax ratio procurement_paid_pre_tax (0560) applies to the whole, so the years
-- add up to the all-years figure (to the cent each year rounds to). A paid payment with no date cannot be placed: its
-- purchase is unknown in every year and still counts in All years. The hire charge is grouped by work month (0460)
-- and a fiscal year starts on the first of a month, so a month sits wholly in one year (D-5).
--
-- One definition: project_pmo_paid_by_category(uuid) (0897) now delegates to the windowed helper with no window, and
-- the windowed pieces reduce exactly to 0560/0794 with no window. supabase/tests/0897_budget_comparison_no_ledger.test.sql
-- still pins Σ helper = project_pmo_spent_position; supabase/tests/1018_fiscal_calendar.test.sql pins the years.

-- procurement_paid_pre_tax (0560) over the payments dated within [p_from, p_to]; either bound NULL is open.
create function public.procurement_paid_pre_tax_between(p public.procurements, p_from date, p_to date) returns numeric
language sql stable security invoker set search_path = public, pg_catalog as $$
  with paid as (
    select count(*) filter (where pay.amount is null or pay.amount::text in ('NaN','Infinity','-Infinity')
                               or pay.currency is distinct from p.currency) as bad,
           count(*) filter (where pay.date is null) as undated,
           coalesce(sum(pay.amount), 0) as amount
      from public.payments pay
     where pay.procurement_id = p.id and pay.org_id = p.org_id
       and pay.status = 'Paid' and coalesce(pay.erp_docstatus, 1) <> 2 and pay.erp_cancelled_at is null
       and (pay.date is null or ((p_from is null or pay.date >= p_from) and (p_to is null or pay.date <= p_to)))
  ), invoiced as (
    select count(*) filter (where i.currency is distinct from p.currency
                               or i.amount::text in ('NaN','Infinity','-Infinity')) as bad,
           sum(case when i.tax_treatment = 'inclusive' then i.amount - coalesce(i.tax_amount, 0) else i.amount end) as pre_tax,
           sum(i.amount + case when i.tax_treatment = 'exclusive' then coalesce(i.tax_amount, 0) else 0 end
               - coalesce(i.withheld_amount, 0)) as payable
      from public.procurement_invoices i
     where i.procurement_id = p.id and i.org_id = p.org_id and i.amount is not null
       and coalesce(i.erp_docstatus, 1) <> 2 and i.erp_cancelled_at is null
  )
  select case when paid.bad > 0 then null::numeric
              when (p_from is not null or p_to is not null) and paid.undated > 0 then null::numeric  -- cannot be placed
              when paid.amount = 0 then 0::numeric
              when invoiced.bad > 0 then null::numeric
              when invoiced.payable > 0 then round(paid.amount * invoiced.pre_tax / invoiced.payable, 2)
              else paid.amount end
    from paid, invoiced
$$;
revoke all on function public.procurement_paid_pre_tax_between(public.procurements, date, date) from public, anon;
grant execute on function public.procurement_paid_pre_tax_between(public.procurements, date, date) to authenticated, service_role;

-- equipment_charge_project_actuals (0794) over the work months within [p_from, p_to]. The guards are 0794's: keep the
-- two in step (the role list is FR-EQU-062's).
create function public.equipment_charge_project_actuals_between(p_project_id uuid, p_from date, p_to date)
returns table(category public.budget_category, n bigint, amount numeric, as_of timestamptz)
language sql stable security definer set search_path = public, pg_temp as $$
  select c.category, count(*), sum(c.amount), max(c.as_of)
    from public.equipment_hire_charges(public.auth_org_id(), null, p_project_id) c
   where public.is_active_member()
     and coalesce(public.auth_role()::text in ('Admin','Finance','Executive','Project Manager'), false)   -- FR-EQU-062
     and exists (select 1 from public.equipment_costing_settings s where s.org_id = public.auth_org_id() and s.basis = 'hire_rate')   -- 0721
     and (p_from is null or c.month >= p_from)
     and (p_to is null or c.month <= p_to)
     and exists (select 1 from public.projects p where p.id = p_project_id and p.org_id = public.auth_org_id())
   group by c.category
$$;
revoke all on function public.equipment_charge_project_actuals_between(uuid, date, date) from public, anon;
grant execute on function public.equipment_charge_project_actuals_between(uuid, date, date) to authenticated, service_role;

-- 0897's helper with a payment-date window; NULL bounds are 0897's figure exactly.
create function public.project_pmo_paid_by_category(p_project_id uuid, p_from date, p_to date)
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
           case when pr.currency = p.currency then public.procurement_paid_pre_tax_between(pr, p_from, p_to) end as paid,
           (select max(pay.date)::timestamptz from public.payments pay
             where pay.procurement_id = pr.id and pay.org_id = pr.org_id and pay.status = 'Paid'
               and coalesce(pay.erp_docstatus, 1) <> 2 and pay.erp_cancelled_at is null
               and (p_from is null or pay.date >= p_from) and (p_to is null or pay.date <= p_to)) as as_of
      from target_project p
      join public.procurements pr on pr.project_id = p.id and pr.org_id = p.org_id
     where pr.origin is distinct from 'erp_link'
       -- A purchase belongs to the window when a paid payment falls in it, or when one has no date to place.
       and exists (select 1 from public.payments pay
                    where pay.procurement_id = pr.id and pay.org_id = pr.org_id and pay.status = 'Paid'
                      and coalesce(pay.erp_docstatus, 1) <> 2 and pay.erp_cancelled_at is null
                      and (pay.date is null
                           or ((p_from is null or pay.date >= p_from) and (p_to is null or pay.date <= p_to))))
  ), charges as (
    select q.category, case when (select charge_in_project_currency from target_project) then q.amount end as charged,
           q.as_of
      from public.equipment_charge_project_actuals_between(p_project_id, p_from, p_to) q
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
revoke all on function public.project_pmo_paid_by_category(uuid, date, date) from public, anon;
grant execute on function public.project_pmo_paid_by_category(uuid, date, date) to authenticated, service_role;

-- 0897's one-argument helper is the windowed one with no window: one definition.
create or replace function public.project_pmo_paid_by_category(p_project_id uuid)
returns table(category public.budget_category, amount numeric, n int, as_of timestamptz)
language sql stable security invoker set search_path = public, pg_temp as $$
  select h.category, h.amount, h.n, h.as_of from public.project_pmo_paid_by_category(p_project_id, null::date, null::date) h
$$;

-- 0897's function; only the PMO branch changes (pmo_year, pmo_paid, pmo_base.recorded). Budget side, ledger branch,
-- signature and grants are 0897's, unchanged.
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
  -- category with spend but no budget line. A fiscal-year scope reads the year of the organization's PMO calendar
  -- (1018) that the label names: payments by their date, hire charges by their work month (1019). A label that names
  -- no such year, or no calendar, keeps recorded unknown. A role outside the helper's guard reads no recorded figure;
  -- that role list is the same one in project_pmo_spent_position (0700) and project_pmo_paid_by_category: keep the
  -- three in step.
  pmo_year as (
    select y.start_date, y.end_date
      from public.pmo_fiscal_year_by_name(p_fiscal_year, public.org_pmo_fiscal_start_month()) y
     where p_fiscal_year is not null
       and not public.org_reads_erp_ledger()
  ),
  pmo_paid as (
    select h.category, h.amount, h.n, h.as_of
      from public.project_pmo_paid_by_category(p_project_id, null::date, null::date) h
     where p_fiscal_year is null
       and not public.org_reads_erp_ledger()
    union all
    select h.category, h.amount, h.n, h.as_of
      from pmo_year y
      cross join lateral public.project_pmo_paid_by_category(p_project_id, y.start_date, y.end_date) h
  ),
  pmo_base as (
    select coalesce(b.category, h.category) as category,
           -- All years with an Active version is complete: a category with no budget line is budgeted 0, known (never NULL,
           -- which would make the strip's approved total unknown); a paid purchase with no category has no line either.
           case when (b.category is null and h.category is null)
                  or (p_fiscal_year is null and exists (select 1 from active_version))
                then coalesce(b.budget_total, 0::numeric)
                else b.budget_total end as budget_total,
           case when (p_fiscal_year is not null and not exists (select 1 from pmo_year))
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
  'Whole-project budget comparison (AC-014): Active budget authority vs recorded spending per category, all-years or one saved/legacy fiscal year. Recorded is the accounting-system ledger when the org reads one, else PMO paid purchases pre-tax (0897), cut by the PMO fiscal calendar in a fiscal-year scope (1019; unknown when the label names no PMO fiscal year). Known zero stays distinct from absent, remaining/percent only on known inputs (percent is recorded/budget as a fraction).';

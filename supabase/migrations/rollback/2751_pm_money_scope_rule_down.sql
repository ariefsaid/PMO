-- Reverses 2751_pm_money_scope_rule.sql: the 2750 rule, the shared reads unguarded, no deputy link.
begin;
CREATE OR REPLACE FUNCTION public.spend_approval_project_figures(p_project_ids uuid[])
 RETURNS TABLE(project_id uuid, figures jsonb)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  with g as materialized (
    select public.is_active_member() and public.holds_spend_approval_authority(public.auth_role()) as ok
  ), pos as materialized (
    select pp.* from public.project_budget_positions(p_project_ids) pp where (select ok from g)
  ), erp_rec as materialized (
    -- With an accounting system the by-category Actual of every project is read once (project_mapped_actuals_all is
    -- project_finance_actuals' ledger branch for every visible project, proven row for row).
    select a.project_id,
           jsonb_object_agg(a.category::text, jsonb_build_object('mapped', a.mapped, 'amount', a.actuals_to_date)) as by_category
      from (select 1 where exists (select 1 from pos where pos.ledger_basis = 'erp')) one
      cross join lateral public.project_mapped_actuals_all(null) a
     where a.project_id in (select pos.project_id from pos where pos.ledger_basis = 'erp')
     group by a.project_id
  )
  select pp.project_id,
         jsonb_build_object(
           'basis', pp.ledger_basis,
           'ledger_currency', pp.currency,
           'budget_currency', pp.budget_currency,
           'proj_budget', pp.active_budget_amount::numeric,
           'proj_spent', pp.spent::numeric + cl.amount,
           'proj_open', case when pp.ledger_basis = 'erp' then cs.open else pp.open_commitment::numeric end,
           'proj_reserved', rs.reserved,
           'proj_foreign', coalesce(cs.foreign_amount, false) or rs.foreign_amount or cl.foreign_amount,
           'recorded', coalesce(er.by_category, rec.by_category, '{}'::jsonb))
    from pos pp
    left join lateral (
      select coalesce(sum(c.amount) filter (where c.currency = pp.budget_currency), 0) as open,
             coalesce(bool_or(c.currency is distinct from pp.budget_currency and c.amount <> 0), false) as foreign_amount
        from public.project_committed_spend(pp.project_id) c
       where pp.ledger_basis = 'erp') cs on true
    cross join lateral (
      select coalesce(sum(greatest(0, pr.total_value,
                    coalesce((select sum(i.amount) from public.procurement_items i where i.procurement_id = pr.id), 0)))
                    filter (where pr.currency = pp.budget_currency), 0) as reserved,
             coalesce(bool_or(pr.currency is distinct from pp.budget_currency), false) as foreign_amount
        from public.procurements pr
       where pr.org_id = public.auth_org_id() and pr.project_id = pp.project_id
         and pr.status in ('Approved','Vendor Quoted','Quote Selected')) rs
    cross join lateral (
      select coalesce(sum(greatest(0, c.amount)) filter (where c.currency = pp.budget_currency), 0) as amount,
             coalesce(bool_or(c.currency is distinct from pp.budget_currency), false) as foreign_amount
        from public.expense_claims c
       where c.org_id = public.auth_org_id() and c.project_id = pp.project_id
         and c.kind = 'claim' and c.status in ('Approved','Paid')
         and not (pp.ledger_basis = 'erp' and exists (
           select 1 from public.expense_posting_erp_mirror m
            where m.claim_id = c.id and m.posting = 'approval' and m.push_state = 'pushed'
              and m.erp_cancelled_at is null and coalesce(m.erp_docstatus, 1) <> 2))) cl
    left join erp_rec er on er.project_id = pp.project_id
    left join lateral (
      select jsonb_object_agg(a.category::text, jsonb_build_object('mapped', a.mapped, 'amount', a.actuals_to_date)) as by_category
        from public.project_finance_actuals(pp.project_id) a
       where pp.ledger_basis = 'pmo' and a.category is not null) rec on true
$function$
;
drop function public.spend_route_project_figures_routed(uuid[]);
drop function public.spend_route_project_figures_core(uuid[]);
CREATE OR REPLACE FUNCTION public.project_mapped_actuals(p_project_id uuid, p_fiscal_year text DEFAULT NULL::text)
 RETURNS TABLE(category budget_category, mapped boolean, has_rows boolean, actuals_to_date numeric, actuals_as_of timestamp with time zone, source_sum numeric, tagged_to_date numeric, attributed_to_date numeric, equipment_charge_to_date numeric)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  with generation as (
    select s.snapshot_id from public.erp_actuals_snapshot s
    where s.org_id = public.auth_org_id()
    order by s.created_at desc,s.id desc limit 1
  ), reading as (
    select s.* from public.erp_actuals_snapshot s
    where s.org_id = public.auth_org_id() and s.project_id = p_project_id
      and s.snapshot_id = (select snapshot_id from generation)
      and (p_fiscal_year is null or s.fiscal_year = p_fiscal_year)
      and exists (select 1 from public.projects p where p.id = p_project_id)
  ), mapped_categories as (
    select distinct m.category from public.budget_category_account_map m
    where m.org_id = public.auth_org_id()
  ), actuals as (
    select m.category,count(*) as n,
      case when count(*) filter(where r.net is null or r.net::text in ('NaN','Infinity','-Infinity')) > 0
           then null else sum(r.net) end as amount,
      sum(r.net) as source_sum
    from reading r join public.budget_category_account_map m
      on m.org_id = r.org_id and m.erp_account = r.account
    group by m.category
  ), attributed as (
    -- #1271: rule-attributed untagged ledger lines, same category map (0376).
    select x.* from public.cost_attribution_project_actuals(p_project_id,p_fiscal_year) x
    where exists (select 1 from public.projects p where p.id = p_project_id)
  ), charged as (                                                                   -- 0497 OQ-3 / FR-EQU-051
    select x.* from public.equipment_charge_project_actuals(p_project_id,p_fiscal_year) x
    where exists (select 1 from public.projects p where p.id = p_project_id)
  ), reading_as_of as (
    select greatest((select max(as_of) from reading),(select max(as_of) from attributed),
                    (select max(as_of) from charged)) as v                           -- 0497
  )
  select c.category,mc.category is not null,coalesce(a.n,0) + coalesce(t.n,0) + coalesce(q.n,0) > 0,     -- 0497 q
    case when mc.category is null or (select v from reading_as_of) is null then null
         when coalesce(a.n,0) + coalesce(t.n,0) + coalesce(q.n,0) = 0 then 0::numeric                       -- 0497 q
         when (a.n > 0 and a.amount is null) or (t.n > 0 and t.amount is null) then null
         else coalesce(a.amount,0) + coalesce(t.amount,0) + coalesce(q.amount,0) end,                       -- 0497 q
    (select v from reading_as_of),
    case when coalesce(a.n,0) + coalesce(t.n,0) = 0                                  -- 0497 budget-vs-actual
         then case when q.n > 0 then q.amount end                                    -- 0497 charge-only (null when none)
         else (case when a.n > 0 and t.n > 0 then a.source_sum + t.source_sum        -- 0376 verbatim
                    when a.n > 0 then a.source_sum
                    when t.n > 0 then t.source_sum end)
              + coalesce(case when q.n > 0 then q.amount end,0) end,                 -- 0497
    case when mc.category is null or (select v from reading_as_of) is null then null
         when a.n > 0 then a.amount else 0::numeric end,
    case when mc.category is null or (select v from reading_as_of) is null then null
         when t.n > 0 then t.amount else 0::numeric end,
    case when mc.category is null or (select v from reading_as_of) is null then null
         when q.n > 0 then q.amount else 0::numeric end                              -- 0497 equipment_charge_to_date
  from unnest(enum_range(null::public.budget_category)) c(category)
  left join mapped_categories mc on mc.category = c.category
  left join actuals a on a.category = c.category
  left join attributed t on t.category = c.category
  left join charged q on q.category = c.category                                     -- 0497
$function$
;
CREATE OR REPLACE FUNCTION public.first_budget_spending_year(p_project_id uuid, p_fiscal_years text[])
 RETURNS text
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  with generation as (
    select s.snapshot_id from public.erp_actuals_snapshot s
     where s.org_id = public.auth_org_id()
     order by s.created_at desc, s.id desc limit 1
  ), reading as materialized (
    select s.* from public.erp_actuals_snapshot s
     where s.org_id = public.auth_org_id() and s.project_id = p_project_id
       and s.snapshot_id = (select snapshot_id from generation)
       and s.fiscal_year = any(p_fiscal_years)
       and exists (select 1 from public.projects p where p.id = p_project_id)
  ), tagged as (
    select r.fiscal_year, m.category, sum(r.net) as source_sum
      from reading r join public.budget_category_account_map m
        on m.org_id = r.org_id and m.erp_account = r.account
     group by r.fiscal_year, m.category
  ), attributed as materialized (
    select * from public.budget_attributed_year_sums(p_project_id, p_fiscal_years)
     where exists (select 1 from public.projects p where p.id = p_project_id)
  ), reading_dates as (
    select fiscal_year, max(as_of) as as_of from (
      select fiscal_year, as_of from reading
      union all select fiscal_year, as_of from attributed
    ) dates group by fiscal_year
  ), categories as (
    select coalesce(t.fiscal_year, a.fiscal_year) as fiscal_year,
      case when t.category is not null and a.category is not null then t.source_sum + a.source_sum
           when t.category is not null then t.source_sum else a.source_sum end as source_sum
      from tagged t full join attributed a on a.fiscal_year = t.fiscal_year and a.category = t.category
  )
  select y.fiscal_year from unnest(p_fiscal_years) with ordinality y(fiscal_year, position)
   where exists (select 1 from categories c join reading_dates d using (fiscal_year)
                  where c.fiscal_year = y.fiscal_year and d.as_of is not null and c.source_sum <> 0)
   order by y.position limit 1
$function$
;
CREATE OR REPLACE FUNCTION public.project_mapped_actuals_all(p_fiscal_year text DEFAULT NULL::text)
 RETURNS TABLE(project_id uuid, category budget_category, mapped boolean, has_rows boolean, actuals_to_date numeric, actuals_as_of timestamp with time zone, source_sum numeric, tagged_to_date numeric, attributed_to_date numeric, equipment_charge_to_date numeric)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  with visible as (
    select p.id from public.projects p
  ), generation as (
    select s.snapshot_id from public.erp_actuals_snapshot s
    where s.org_id = public.auth_org_id()
    order by s.created_at desc,s.id desc limit 1
  ), reading as materialized (
    select s.* from public.erp_actuals_snapshot s
    where s.org_id = public.auth_org_id() and s.project_id in (select id from visible)
      and s.snapshot_id = (select snapshot_id from generation)
      and (p_fiscal_year is null or s.fiscal_year = p_fiscal_year)
  ), mapped_categories as (
    select distinct m.category from public.budget_category_account_map m
    where m.org_id = public.auth_org_id()
  ), actuals as (
    select r.project_id,m.category,count(*) as n,
      case when count(*) filter(where r.net is null or r.net::text in ('NaN','Infinity','-Infinity')) > 0
           then null else sum(r.net) end as amount,
      sum(r.net) as source_sum
    from reading r join public.budget_category_account_map m
      on m.org_id = r.org_id and m.erp_account = r.account
    group by r.project_id,m.category
  ), attributed as materialized (
    select x.* from public.cost_attribution_org_actuals(p_fiscal_year) x
    where x.project_id in (select id from visible)
  ), charged as materialized (                                                       -- 0497
    select x.* from public.equipment_charge_org_actuals(p_fiscal_year) x
    where x.project_id in (select id from visible)
  ), reading_as_of as (
    select v.id as project_id,
      greatest((select max(r.as_of) from reading r where r.project_id = v.id),
               (select max(t.as_of) from attributed t where t.project_id = v.id),
               (select max(q.as_of) from charged q where q.project_id = v.id)) as v   -- 0497
    from visible v
  )
  select v.id,c.category,mc.category is not null,coalesce(a.n,0) + coalesce(t.n,0) + coalesce(q.n,0) > 0,   -- 0497 q
    case when mc.category is null or o.v is null then null
         when coalesce(a.n,0) + coalesce(t.n,0) + coalesce(q.n,0) = 0 then 0::numeric                     -- 0497 q
         when (a.n > 0 and a.amount is null) or (t.n > 0 and t.amount is null) then null
         else coalesce(a.amount,0) + coalesce(t.amount,0) + coalesce(q.amount,0) end,                     -- 0497 q
    o.v,
    case when coalesce(a.n,0) + coalesce(t.n,0) = 0                                  -- 0497 budget-vs-actual
         then case when q.n > 0 then q.amount end                                    -- 0497 charge-only (null when none)
         else (case when a.n > 0 and t.n > 0 then a.source_sum + t.source_sum        -- 0376 verbatim
                    when a.n > 0 then a.source_sum
                    when t.n > 0 then t.source_sum end)
              + coalesce(case when q.n > 0 then q.amount end,0) end,                 -- 0497
    case when mc.category is null or o.v is null then null
         when a.n > 0 then a.amount else 0::numeric end,
    case when mc.category is null or o.v is null then null
         when t.n > 0 then t.amount else 0::numeric end,
    case when mc.category is null or o.v is null then null
         when q.n > 0 then q.amount else 0::numeric end                              -- 0497 equipment_charge_to_date
  from visible v
  join reading_as_of o on o.project_id = v.id
  cross join unnest(enum_range(null::public.budget_category)) c(category)
  left join mapped_categories mc on mc.category = c.category
  left join actuals a on a.project_id = v.id and a.category = c.category
  left join attributed t on t.project_id = v.id and t.category = c.category
  left join charged q on q.project_id = v.id and q.category = c.category            -- 0497
$function$
;
CREATE OR REPLACE FUNCTION public.project_finance_actuals(p_project_id uuid)
 RETURNS TABLE(category budget_category, mapped boolean, has_rows boolean, actuals_to_date numeric, actuals_as_of timestamp with time zone, source_sum numeric, tagged_to_date numeric, attributed_to_date numeric, equipment_charge_to_date numeric)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_role public.user_role := public.auth_role();
begin
  if not public.is_active_member() then
    raise exception 'your account is not an active member of this organisation' using errcode = '42501';
  end if;
  if v_role is null or v_role not in ('Admin','Finance','Executive','Project Manager') then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if not exists(select 1 from public.projects p where p.id = p_project_id and p.org_id = public.auth_org_id()) then
    raise exception 'project not found' using errcode = 'P0002';
  end if;

  -- Ledger readers keep the existing mapped snapshot and attribution calculation row for row.
  if public.org_reads_erp_ledger() then
    return query select * from public.project_mapped_actuals(p_project_id, null);
    return;
  end if;

  -- Without an active binding the ledger basis is not selected (0307): no snapshot or attribution term is read,
  -- even when an old snapshot survives a disconnect, so a ledger-posted purchase that PMO also records as paid
  -- counts once. Actuals = PMO paid purchases (pre-tax) + the internal equipment charge, in the project currency.
  -- Procurement.budget_category is the category link. Paid spend with no category is one extra row of its own
  -- (category NULL, category amount unknown, mapped so every by-category total that would include it reads NULL
  -- rather than a partial sum); every category that was read keeps its figure.
  return query
  with target_project as (
    select p.id, p.org_id, p.currency, p.currency = o.default_currency as charge_in_project_currency
      from public.projects p join public.organizations o on o.id = p.org_id
     where p.id = p_project_id and p.org_id = public.auth_org_id()
  ), paid_procurements as (
    select pay.procurement_id, max(coalesce(pay.date::timestamp at time zone 'UTC', pay.created_at)) as actuals_as_of
      from public.payments pay join target_project p on pay.org_id = p.org_id
     where pay.status = 'Paid' and coalesce(pay.erp_docstatus, 1) <> 2 and pay.erp_cancelled_at is null
     group by pay.procurement_id
  ), paid_rows as (
    select pr.budget_category as category,
           case when pr.currency = p.currency then public.procurement_paid_pre_tax(pr) end as amount,
           pp.actuals_as_of
      from paid_procurements pp
      join public.procurements pr on pr.id = pp.procurement_id
      join target_project p on pr.project_id = p.id and pr.org_id = p.org_id
     where pr.origin is distinct from 'erp_link'
       and not public.purchase_costs_as_stock(pr.id)
    union all
    select 'Materials'::public.budget_category,s.amount,s.occurred_on::timestamp at time zone 'UTC' from public.stock_issue_cost_lines(p_project_id) s
  ), category_totals as (
    select r.category,
           count(*)::int as purchase_count,
           case when count(*) filter (where r.amount is null) > 0 then null::numeric
                else sum(r.amount) end as amount
      from paid_rows r
     where r.category is not null
     group by r.category
  ), uncategorized as (
    select count(*)::int as purchase_count,
           case when count(*) filter (where r.amount is null) > 0 then null::numeric
                else sum(r.amount) end as amount
      from paid_rows r
     where r.category is null
  ), charges as (
    -- The hire charge is priced in the org currency; on a project in another currency it is unknown, never relabelled.
    select q.category, q.n, q.as_of,
           case when (select charge_in_project_currency from target_project) then q.amount end as amount
      from public.equipment_charge_project_actuals(p_project_id, null) q
  ), recency as (
    select greatest((select max(r.actuals_as_of) from paid_rows r),
                    (select max(q.as_of) from charges q)) as actuals_as_of
  )
  select c.category,
         true as mapped,
         coalesce(total.purchase_count, 0) > 0 or coalesce(q.n, 0) > 0 as has_rows,
         case when total.purchase_count is null then 0::numeric else total.amount end
           + case when q.n is null then 0::numeric else q.amount end as actuals_to_date,
         recent.actuals_as_of,
         case when total.purchase_count is null then 0::numeric else total.amount end
           + case when q.n is null then 0::numeric else q.amount end as source_sum,
         case when total.purchase_count is null then 0::numeric else total.amount end as tagged_to_date,
         0::numeric as attributed_to_date,
         case when q.n is null then 0::numeric else q.amount end as equipment_charge_to_date
    from unnest(enum_range(null::public.budget_category)) c(category)
    cross join recency recent
    left join category_totals total on total.category = c.category
    left join charges q on q.category = c.category
  union all
  -- The uncategorized paid spend: what was paid is stated in source_sum; where it belongs is unknown.
  select null::public.budget_category, true, true, null::numeric, recent.actuals_as_of, u.amount,
         null::numeric, 0::numeric, 0::numeric
    from uncategorized u cross join recency recent
   where u.purchase_count > 0;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.project_pmo_spent_position(p_project_id uuid)
 RETURNS TABLE(amount numeric, complete boolean)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_amount numeric;
begin
  if not exists (
    select 1 from public.projects p
     where p.id = p_project_id
       and p.org_id = public.auth_org_id()
       and public.auth_role() in ('Admin','Executive','Project Manager','Finance')
       and public.is_active_member()
  ) then
    return;
  end if;
  with target_project as (
    select p.id, p.org_id, p.currency, p.currency = o.default_currency as charge_in_project_currency
      from public.projects p join public.organizations o on o.id = p.org_id
     where p.id = p_project_id and p.org_id = public.auth_org_id()
  ), paid_rows as (
    select case when pr.currency = p.currency then public.procurement_paid_pre_tax(pr) end as paid
      from target_project p
      join public.procurements pr on pr.project_id = p.id and pr.org_id = p.org_id
     where pr.origin is distinct from 'erp_link'
       and not public.purchase_costs_as_stock(pr.id)
       and exists (select 1 from public.payments pay
                    where pay.procurement_id = pr.id and pay.org_id = pr.org_id and pay.status = 'Paid'
                      and coalesce(pay.erp_docstatus, 1) <> 2 and pay.erp_cancelled_at is null)
    union all select s.amount from public.stock_issue_cost_lines(p_project_id) s
  ), charges as (
    select case when (select charge_in_project_currency from target_project) then q.amount end as charged
      from public.equipment_charge_project_actuals(p_project_id, null) q
  )
  select case when exists (select 1 from paid_rows r where r.paid is null)
                or exists (select 1 from charges c where c.charged is null) then null::numeric
              else coalesce((select sum(r.paid) from paid_rows r), 0) + coalesce((select sum(c.charged) from charges c), 0) end
    into v_amount;
  return query select v_amount, v_amount is not null;
end $function$
;
CREATE OR REPLACE FUNCTION public.project_pmo_paid_by_category(p_project_id uuid, p_from date, p_to date)
 RETURNS TABLE(category budget_category, amount numeric, n integer, as_of timestamp with time zone)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
end $function$
;
CREATE OR REPLACE FUNCTION public.project_pmo_commitment_position(p_project_id uuid)
 RETURNS TABLE(amount numeric, complete boolean)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_catalog'
AS $function$
  with project as (
    select p.id, p.currency
      from public.projects p
     where p.id = p_project_id
       and p.org_id = public.auth_org_id()
       and public.auth_role() in ('Admin','Executive','Project Manager','Finance')
  ), committed as (
    select pr.total_value, pr.currency
      from public.procurements pr
      join project p on p.id = pr.project_id and pr.org_id = public.auth_org_id()
     where pr.status::text = any(public.committed_procurement_statuses())
  ), position as (
    select p.id, p.currency,
           coalesce((select c.amount from public.project_committed_spend(p.id) c where c.is_project_currency), 0) as amount
      from project p
  )
  select pos.amount,
         coalesce((select bool_and(coalesce(c.currency = pos.currency, false)
                                     and c.total_value is not null
                                     and c.total_value::text not in ('NaN','Infinity','-Infinity'))
                     from committed c), true)
    from position pos
$function$
;
CREATE OR REPLACE FUNCTION public.project_pmo_positions(p_project_ids uuid[] DEFAULT NULL::uuid[])
 RETURNS TABLE(project_id uuid, spent numeric, spent_complete boolean, committed numeric, committed_complete boolean)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_catalog'
AS $function$
  with g as materialized (                         -- the guards of both per-project functions, evaluated once
    select public.auth_org_id() as org_id,
           public.is_active_member() as active
     where not public.org_reads_erp_ledger()
       and public.auth_role() in ('Admin','Executive','Project Manager','Finance')
  ), proj as (
    select p.id, p.org_id, p.currency, p.currency = o.default_currency as charge_in_project_currency
      from public.projects p join g on p.org_id = g.org_id
      join public.organizations o on o.id = p.org_id
     where p_project_ids is null or p.id = any (p_project_ids)
  ),
  -- spent (project_pmo_spent_position): pre-tax paid purchases that carry a payment, plus the internal hire charge
  pay as (
    select pay.procurement_id,
           count(*) filter (where pay.amount is null or pay.amount::text in ('NaN','Infinity','-Infinity')
                               or pay.currency is distinct from pr.currency) as bad,
           coalesce(sum(pay.amount), 0) as amount
      from public.procurements pr join public.payments pay on pay.procurement_id = pr.id and pay.org_id = pr.org_id
      join proj on proj.id = pr.project_id and pr.org_id = proj.org_id
     where pay.status = 'Paid' and coalesce(pay.erp_docstatus, 1) <> 2 and pay.erp_cancelled_at is null
     group by pay.procurement_id
  ), inv as (
    select i.procurement_id,
           count(*) filter (where i.currency is distinct from pr.currency
                               or i.amount::text in ('NaN','Infinity','-Infinity')) as bad,
           sum(case when i.tax_treatment = 'inclusive' then i.amount - coalesce(i.tax_amount, 0) else i.amount end) as pre_tax,
           sum(i.amount + case when i.tax_treatment = 'exclusive' then coalesce(i.tax_amount, 0) else 0 end
               - coalesce(i.withheld_amount, 0)) as payable
      from public.procurements pr join public.procurement_invoices i on i.procurement_id = pr.id and i.org_id = pr.org_id
      join proj on proj.id = pr.project_id and pr.org_id = proj.org_id
     where i.amount is not null and coalesce(i.erp_docstatus, 1) <> 2 and i.erp_cancelled_at is null
     group by i.procurement_id
  ), paid_pre_tax as (                             -- procurement_paid_pre_tax(pr), one row per purchase
    select pr.id, pr.project_id, pr.currency,
           case when pa.bad > 0 then null::numeric
                when pa.amount = 0 then 0::numeric
                when iv.bad > 0 then null::numeric
                when iv.payable > 0 then round(pa.amount * iv.pre_tax / iv.payable, 2)
                else pa.amount end as paid
      from public.procurements pr join pay pa on pa.procurement_id = pr.id
      left join inv iv on iv.procurement_id = pr.id
     where pr.origin is distinct from 'erp_link'
       and not public.purchase_costs_as_stock(pr.id)
    union all select s.record_id,proj.id,s.currency,s.amount from proj cross join lateral public.stock_issue_cost_lines(proj.id) s
  ), paid_by_project as (
    select proj.id as project_id,
           bool_or(case when pp.currency = proj.currency then pp.paid end is null) as any_null,
           coalesce(sum(case when pp.currency = proj.currency then pp.paid end), 0) as total
      from proj join paid_pre_tax pp on pp.project_id = proj.id
     group by proj.id
  ), charge_by_project as (
    select c.project_id, bool_or(c.amount is null) as any_null, sum(c.amount) as total
      from public.equipment_charge_org_actuals(null) c
     where c.project_id in (select id from proj)
     group by c.project_id
  ), spent as (
    select proj.id as project_id,
           case when coalesce(pb.any_null, false)
                  or (cb.project_id is not null and (not proj.charge_in_project_currency or cb.any_null)) then null::numeric
                else coalesce(pb.total, 0) + coalesce(cb.total, 0) end as amount
      from proj
      left join paid_by_project pb on pb.project_id = proj.id
      left join charge_by_project cb on cb.project_id = proj.id
  ),
  -- committed (project_pmo_commitment_position over project_committed_spend, PMO basis): the open commitment of the
  -- committed-status purchases, in the project currency
  cprocs as (
    select pr.id, pr.project_id, pr.org_id, pr.currency, pr.status, pr.origin, pr.total_value
      from public.procurements pr join proj on proj.id = pr.project_id and pr.org_id = proj.org_id
     where pr.status::text = any (public.committed_procurement_statuses())
  ), cpaid as (
    select pay.procurement_id,
           count(*) filter (where pay.amount is null or pay.amount::text in ('NaN','Infinity','-Infinity')
                               or pay.currency is distinct from p.currency) as bad,
           coalesce(sum(pay.amount), 0) as amount
      from cprocs p join public.payments pay on pay.procurement_id = p.id and pay.org_id = p.org_id
     where p.origin is distinct from 'erp_link'
       and pay.status = 'Paid' and coalesce(pay.erp_docstatus, 1) <> 2 and pay.erp_cancelled_at is null
     group by pay.procurement_id
  ), cinv as (
    select i.procurement_id,
           count(*) filter (where i.currency is distinct from p.currency
                               or i.amount::text in ('NaN','Infinity','-Infinity')) as bad,
           sum(case when i.tax_treatment = 'inclusive' then i.amount - coalesce(i.tax_amount, 0) else i.amount end) as pre_tax,
           sum(i.amount + case when i.tax_treatment = 'exclusive' then coalesce(i.tax_amount, 0) else 0 end
               - coalesce(i.withheld_amount, 0)) as payable
      from cprocs p join public.procurement_invoices i on i.procurement_id = p.id and i.org_id = p.org_id
     where p.origin is distinct from 'erp_link'
       and i.amount is not null and coalesce(i.erp_docstatus, 1) <> 2 and i.erp_cancelled_at is null
     group by i.procurement_id
  ), committed as (
    select proj.id as project_id,
           coalesce(sum(case
                 when p.currency is distinct from proj.currency then null
                 when p.status::text in ('Cancelled','Rejected') then 0::numeric
                 when p.origin = 'erp_link' then coalesce(p.total_value, 0)::numeric
                 else (select case when x.paid is null then coalesce(p.total_value, 0)::numeric
                                   else greatest(0::numeric, coalesce(p.total_value, 0) - x.paid) end
                         from (select case when pa.bad > 0 then null::numeric
                                           when coalesce(pa.amount, 0) = 0 then 0::numeric
                                           when iv.bad > 0 then null::numeric
                                           when iv.payable > 0 then round(pa.amount * iv.pre_tax / iv.payable, 2)
                                           else pa.amount end as paid) x)
               end), 0) as amount,
           coalesce(bool_and(coalesce(p.currency = proj.currency, false) and p.total_value is not null
                             and p.total_value::text not in ('NaN','Infinity','-Infinity')) filter (where p.id is not null), true) as complete
      from proj
      left join cprocs p on p.project_id = proj.id
      left join cpaid pa on pa.procurement_id = p.id
      left join cinv iv on iv.procurement_id = p.id
     group by proj.id
  )
  select proj.id,
         case when g.active then s.amount end,
         case when g.active then s.amount is not null end,
         c.amount,
         c.complete
    from proj cross join g
    join spent s on s.project_id = proj.id
    join committed c on c.project_id = proj.id
$function$
;
drop function public.stock_issue_cost_lines(uuid);
drop function public.stock_issue_cost_lines_scoped(uuid);
alter function public.stock_issue_cost_lines_core(uuid) rename to stock_issue_cost_lines;
grant execute on function public.stock_issue_cost_lines(uuid) to authenticated, service_role;

drop function public.equipment_charge_project_actuals(uuid, text);
drop function public.equipment_charge_project_actuals_scoped(uuid, text);
alter function public.equipment_charge_project_actuals_core(uuid, text) rename to equipment_charge_project_actuals;
grant execute on function public.equipment_charge_project_actuals(uuid, text) to authenticated, service_role;

drop function public.equipment_charge_project_actuals_between(uuid, date, date);
drop function public.equipment_charge_project_actuals_between_scoped(uuid, date, date);
alter function public.equipment_charge_project_actuals_between_core(uuid, date, date) rename to equipment_charge_project_actuals_between;
grant execute on function public.equipment_charge_project_actuals_between(uuid, date, date) to authenticated, service_role;

drop function public.cost_attribution_project_actuals(uuid, text);
drop function public.cost_attribution_project_actuals_scoped(uuid, text);
alter function public.cost_attribution_project_actuals_core(uuid, text) rename to cost_attribution_project_actuals;
grant execute on function public.cost_attribution_project_actuals(uuid, text) to authenticated, service_role;

drop function public.budget_attributed_year_sums(uuid, text[]);
drop function public.budget_attributed_year_sums_scoped(uuid, text[]);
alter function public.budget_attributed_year_sums_core(uuid, text[]) rename to budget_attributed_year_sums;
grant execute on function public.budget_attributed_year_sums(uuid, text[]) to authenticated, service_role;
drop function public.money_read_is_internal();
create or replace function public.project_money_in_scope(p_project uuid)
  returns boolean language sql stable security invoker set search_path = public, pg_temp as $$
  select p_project is null
      or public.auth_role() is distinct from 'Project Manager'::public.user_role
      or public.actor_holds_job_role('project_control_manager')
      or exists (select 1 from public.projects p
                  where p.id = p_project and p.org_id = public.auth_org_id() and p.project_manager_id = auth.uid())
$$;
drop function public.actor_money_projects();
drop function public.actor_money_scoped();
drop trigger projects_zz_project_manager_same_org on public.projects;
CREATE OR REPLACE FUNCTION public.check_project_manager_same_org()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  if new.project_manager_id is not null
     and not exists (
       select 1 from public.profiles p
       where p.id = new.project_manager_id and p.org_id = new.org_id)
  then
    raise exception 'project manager not in this organization' using errcode = '42501';
  end if;
  return new;
end $function$
;
create trigger projects_zz_project_manager_same_org before insert or update of project_manager_id, org_id
  on public.projects for each row execute function public.check_project_manager_same_org();
update public.record_history_config set captured = captured - 'deputy_manager_id' where table_name = 'projects';
alter table public.projects drop column deputy_manager_id;
commit;

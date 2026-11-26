-- A Project Manager reads money for their own projects (owner rulings 26 Nov 2026, DD-R1125-14 and DD-R1125-15).
-- One rule decides it: actor_money_scoped() says whether the caller's project money is limited to their own projects,
-- actor_money_projects() lists those projects, and project_money_in_scope(project) combines the two.
-- Limited: access level Project Manager with the job role Project Manager, Deputy Project Manager, or no job role.
-- Other job roles at that access level work across projects by function and keep their reads.
-- Own project: the caller manages it, is named its deputy (projects.deputy_manager_id, new), or stands in today for its manager.
-- Reads shared with approval routing and other enforcement: definer code reads the whole project (the internal body);
-- only a client's read is limited. money_read_is_internal() tells the two apart by the executing role.
-- Reverse: rollback/2751_pm_money_scope_rule_down.sql.
-- drops: none; adds projects.deputy_manager_id, restates project_money_in_scope and five shared reads' guards.
begin;

-- No foreign key: a third key from projects to profiles would make every unqualified profiles embed ambiguous
-- (postgrest_embed_ambiguity_guard); the same-organisation trigger below checks the person exists in the organisation.
alter table public.projects add column deputy_manager_id uuid;
create index projects_deputy_manager_idx on public.projects (deputy_manager_id) where deputy_manager_id is not null;
grant insert (deputy_manager_id), update (deputy_manager_id) on public.projects to authenticated;
update public.record_history_config set captured = captured || '{"deputy_manager_id":"ref"}'::jsonb where table_name = 'projects';
comment on column public.projects.deputy_manager_id is
  'The project''s deputy project manager: reads this project''s money as its manager does (DD-R1125-15).';

CREATE OR REPLACE FUNCTION public.check_project_manager_same_org()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public, pg_temp
AS $function$
begin
  if new.project_manager_id is not null
     and not exists (
       select 1 from public.profiles p
       where p.id = new.project_manager_id and p.org_id = new.org_id)
  then
    raise exception 'project manager not in this organization' using errcode = '42501';
  end if;
  if new.deputy_manager_id is not null
     and not exists (
       select 1 from public.profiles p
       where p.id = new.deputy_manager_id and p.org_id = new.org_id)
  then
    raise exception 'deputy project manager not in this organization' using errcode = '42501';
  end if;
  return new;
end $function$
;

drop trigger projects_zz_project_manager_same_org on public.projects;
create trigger projects_zz_project_manager_same_org before insert or update of project_manager_id, deputy_manager_id, org_id
  on public.projects for each row execute function public.check_project_manager_same_org();

-- true when the caller's project money is limited to their own projects
create function public.actor_money_scoped() returns boolean
  language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(public.is_active_member() and public.auth_role() = 'Project Manager'::public.user_role
                  and coalesce(public.actor_built_in_role(), 'project_manager')
                      in ('project_manager', 'deputy_project_manager'), false)                     -- mut:pm_scope_who
$$;
-- the caller's own projects: managed, deputy of, or standing in today for the manager
create function public.actor_money_projects() returns setof uuid
  language sql stable security definer set search_path = public, pg_temp as $$
  select p.id from public.projects p
   where public.assert_not_light() and p.org_id = public.auth_org_id()
     and (p.project_manager_id = auth.uid()                                                         -- mut:pm_scope_own
          or p.deputy_manager_id = auth.uid()                                                       -- mut:pm_scope_deputy
          or p.project_manager_id in (
               select s.delegator_id from public.approval_stand_ins s
                where s.org_id = p.org_id and s.stand_in_id = auth.uid() and s.revoked_at is null
                  and public.native_org_today(p.org_id) between s.starts_on and s.ends_on))          -- mut:pm_scope_standin
$$;
revoke all on function public.actor_money_scoped(), public.actor_money_projects() from public, anon;
grant execute on function public.actor_money_scoped(), public.actor_money_projects() to authenticated, service_role;

create or replace function public.project_money_in_scope(p_project uuid)
  returns boolean language sql stable security invoker set search_path = public, pg_temp as $$
  select p_project is null or not (select public.actor_money_scoped())
      or p_project in (select public.actor_money_projects())
$$;

-- true inside definer code (approval routing, gates, triggers) and for the service role; false for a client's own read.
-- Invoker functions see the executing role, which a security definer frame above them replaces with its owner.
create function public.money_read_is_internal() returns boolean
  language sql stable security invoker set search_path = public, pg_temp as $$
  select current_user not in ('authenticated', 'anon')                                              -- mut:pm_scope_internal
$$;
revoke all on function public.money_read_is_internal() from public, anon;
grant execute on function public.money_read_is_internal() to authenticated, service_role;

-- stock_issue_cost_lines: the old body is now stock_issue_cost_lines_core (internal only); the public name reads the whole project for definer code
-- and the scoped read for a client.
alter function public.stock_issue_cost_lines(uuid) rename to stock_issue_cost_lines_core;
revoke all on function public.stock_issue_cost_lines_core(uuid) from public, anon, authenticated;
grant execute on function public.stock_issue_cost_lines_core(uuid) to service_role;
create function public.stock_issue_cost_lines_scoped(p_project uuid) returns TABLE(record_id uuid, work_order_id uuid, discipline_id uuid, occurred_on date, reference text, currency text, amount numeric)
  language sql stable security definer set search_path = public, pg_temp as $$
  select * from public.stock_issue_cost_lines_core(p_project) where public.assert_not_light() and public.project_money_in_scope(p_project)
$$;
revoke all on function public.stock_issue_cost_lines_scoped(uuid) from public, anon;
grant execute on function public.stock_issue_cost_lines_scoped(uuid) to authenticated, service_role;
create function public.stock_issue_cost_lines(p_project uuid) returns TABLE(record_id uuid, work_order_id uuid, discipline_id uuid, occurred_on date, reference text, currency text, amount numeric)
  language plpgsql stable set search_path = public, pg_temp as $$
begin
  -- A light account is refused on both paths: _core and _scoped each call assert_not_light (definer-only).
  if public.money_read_is_internal() then
    return query select * from public.stock_issue_cost_lines_core(p_project);
  else
    return query select * from public.stock_issue_cost_lines_scoped(p_project);
  end if;
end $$;
revoke all on function public.stock_issue_cost_lines(uuid) from public, anon;
grant execute on function public.stock_issue_cost_lines(uuid) to authenticated, service_role;

-- equipment_charge_project_actuals: the old body is now equipment_charge_project_actuals_core (internal only); the public name reads the whole project for definer code
-- and the scoped read for a client.
alter function public.equipment_charge_project_actuals(uuid, text) rename to equipment_charge_project_actuals_core;
revoke all on function public.equipment_charge_project_actuals_core(uuid, text) from public, anon, authenticated;
grant execute on function public.equipment_charge_project_actuals_core(uuid, text) to service_role;
create function public.equipment_charge_project_actuals_scoped(p_project_id uuid, p_fiscal_year text) returns TABLE(category budget_category, n bigint, amount numeric, as_of timestamp with time zone)
  language sql stable security definer set search_path = public, pg_temp as $$
  select * from public.equipment_charge_project_actuals_core(p_project_id, p_fiscal_year) where public.assert_not_light() and public.project_money_in_scope(p_project_id)
$$;
revoke all on function public.equipment_charge_project_actuals_scoped(uuid, text) from public, anon;
grant execute on function public.equipment_charge_project_actuals_scoped(uuid, text) to authenticated, service_role;
create function public.equipment_charge_project_actuals(p_project_id uuid, p_fiscal_year text DEFAULT NULL::text) returns TABLE(category budget_category, n bigint, amount numeric, as_of timestamp with time zone)
  language plpgsql stable set search_path = public, pg_temp as $$
begin
  -- A light account is refused on both paths: _core and _scoped each call assert_not_light (definer-only).
  if public.money_read_is_internal() then
    return query select * from public.equipment_charge_project_actuals_core(p_project_id, p_fiscal_year);
  else
    return query select * from public.equipment_charge_project_actuals_scoped(p_project_id, p_fiscal_year);
  end if;
end $$;
revoke all on function public.equipment_charge_project_actuals(uuid, text) from public, anon;
grant execute on function public.equipment_charge_project_actuals(uuid, text) to authenticated, service_role;

-- equipment_charge_project_actuals_between: the old body is now equipment_charge_project_actuals_between_core (internal only); the public name reads the whole project for definer code
-- and the scoped read for a client.
alter function public.equipment_charge_project_actuals_between(uuid, date, date) rename to equipment_charge_project_actuals_between_core;
revoke all on function public.equipment_charge_project_actuals_between_core(uuid, date, date) from public, anon, authenticated;
grant execute on function public.equipment_charge_project_actuals_between_core(uuid, date, date) to service_role;
create function public.equipment_charge_project_actuals_between_scoped(p_project_id uuid, p_from date, p_to date) returns TABLE(category budget_category, n bigint, amount numeric, as_of timestamp with time zone)
  language sql stable security definer set search_path = public, pg_temp as $$
  select * from public.equipment_charge_project_actuals_between_core(p_project_id, p_from, p_to) where public.assert_not_light() and public.project_money_in_scope(p_project_id)
$$;
revoke all on function public.equipment_charge_project_actuals_between_scoped(uuid, date, date) from public, anon;
grant execute on function public.equipment_charge_project_actuals_between_scoped(uuid, date, date) to authenticated, service_role;
create function public.equipment_charge_project_actuals_between(p_project_id uuid, p_from date, p_to date) returns TABLE(category budget_category, n bigint, amount numeric, as_of timestamp with time zone)
  language plpgsql stable set search_path = public, pg_temp as $$
begin
  -- A light account is refused on both paths: _core and _scoped each call assert_not_light (definer-only).
  if public.money_read_is_internal() then
    return query select * from public.equipment_charge_project_actuals_between_core(p_project_id, p_from, p_to);
  else
    return query select * from public.equipment_charge_project_actuals_between_scoped(p_project_id, p_from, p_to);
  end if;
end $$;
revoke all on function public.equipment_charge_project_actuals_between(uuid, date, date) from public, anon;
grant execute on function public.equipment_charge_project_actuals_between(uuid, date, date) to authenticated, service_role;

-- cost_attribution_project_actuals: the old body is now cost_attribution_project_actuals_core (internal only); the public name reads the whole project for definer code
-- and the scoped read for a client.
alter function public.cost_attribution_project_actuals(uuid, text) rename to cost_attribution_project_actuals_core;
revoke all on function public.cost_attribution_project_actuals_core(uuid, text) from public, anon, authenticated;
grant execute on function public.cost_attribution_project_actuals_core(uuid, text) to service_role;
create function public.cost_attribution_project_actuals_scoped(p_project_id uuid, p_fiscal_year text) returns TABLE(category budget_category, n bigint, amount numeric, source_sum numeric, as_of timestamp with time zone)
  language sql stable security definer set search_path = public, pg_temp as $$
  select * from public.cost_attribution_project_actuals_core(p_project_id, p_fiscal_year) where public.assert_not_light() and public.project_money_in_scope(p_project_id)
$$;
revoke all on function public.cost_attribution_project_actuals_scoped(uuid, text) from public, anon;
grant execute on function public.cost_attribution_project_actuals_scoped(uuid, text) to authenticated, service_role;
create function public.cost_attribution_project_actuals(p_project_id uuid, p_fiscal_year text DEFAULT NULL::text) returns TABLE(category budget_category, n bigint, amount numeric, source_sum numeric, as_of timestamp with time zone)
  language plpgsql stable set search_path = public, pg_temp as $$
begin
  -- A light account is refused on both paths: _core and _scoped each call assert_not_light (definer-only).
  if public.money_read_is_internal() then
    return query select * from public.cost_attribution_project_actuals_core(p_project_id, p_fiscal_year);
  else
    return query select * from public.cost_attribution_project_actuals_scoped(p_project_id, p_fiscal_year);
  end if;
end $$;
revoke all on function public.cost_attribution_project_actuals(uuid, text) from public, anon;
grant execute on function public.cost_attribution_project_actuals(uuid, text) to authenticated, service_role;

-- budget_attributed_year_sums: the old body is now budget_attributed_year_sums_core (internal only); the public name reads the whole project for definer code
-- and the scoped read for a client.
alter function public.budget_attributed_year_sums(uuid, text[]) rename to budget_attributed_year_sums_core;
revoke all on function public.budget_attributed_year_sums_core(uuid, text[]) from public, anon, authenticated;
grant execute on function public.budget_attributed_year_sums_core(uuid, text[]) to service_role;
create function public.budget_attributed_year_sums_scoped(p_project_id uuid, p_fiscal_years text[]) returns TABLE(fiscal_year text, category budget_category, source_sum numeric, as_of timestamp with time zone)
  language sql stable security definer set search_path = public, pg_temp as $$
  select * from public.budget_attributed_year_sums_core(p_project_id, p_fiscal_years) where public.assert_not_light() and public.project_money_in_scope(p_project_id)
$$;
revoke all on function public.budget_attributed_year_sums_scoped(uuid, text[]) from public, anon;
grant execute on function public.budget_attributed_year_sums_scoped(uuid, text[]) to authenticated, service_role;
create function public.budget_attributed_year_sums(p_project_id uuid, p_fiscal_years text[]) returns TABLE(fiscal_year text, category budget_category, source_sum numeric, as_of timestamp with time zone)
  language plpgsql stable set search_path = public, pg_temp as $$
begin
  -- A light account is refused on both paths: _core and _scoped each call assert_not_light (definer-only).
  if public.money_read_is_internal() then
    return query select * from public.budget_attributed_year_sums_core(p_project_id, p_fiscal_years);
  else
    return query select * from public.budget_attributed_year_sums_scoped(p_project_id, p_fiscal_years);
  end if;
end $$;
revoke all on function public.budget_attributed_year_sums(uuid, text[]) from public, anon;
grant execute on function public.budget_attributed_year_sums(uuid, text[]) to authenticated, service_role;
-- Shared invoker reads: a client reads only projects in scope; definer code (routing, gates) reads every project.
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
  if not exists(select 1 from public.projects p where p.id = p_project_id and p.org_id = public.auth_org_id()
                  and (public.money_read_is_internal() or public.project_money_in_scope(p.id))) then
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
       and (public.money_read_is_internal() or public.project_money_in_scope(p.id))
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
       and (public.money_read_is_internal() or public.project_money_in_scope(p.id))
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
end $function$;

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
       and (public.money_read_is_internal() or public.project_money_in_scope(p.id))
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
     where (p_project_ids is null or p.id = any (p_project_ids))
       and ((select public.money_read_is_internal()) or (select not public.actor_money_scoped())
            or p.id in (select public.actor_money_projects()))
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

-- The mapped (ledger) actuals and their org-wide twin follow the same rule, so per-project and org-wide reads agree.
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
      and exists (select 1 from public.projects p where p.id = p_project_id
                  and (public.money_read_is_internal() or public.project_money_in_scope(p.id)))
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
    where exists (select 1 from public.projects p where p.id = p_project_id
                  and (public.money_read_is_internal() or public.project_money_in_scope(p.id)))
  ), charged as (                                                                   -- 0497 OQ-3 / FR-EQU-051
    select x.* from public.equipment_charge_project_actuals(p_project_id,p_fiscal_year) x
    where exists (select 1 from public.projects p where p.id = p_project_id
                  and (public.money_read_is_internal() or public.project_money_in_scope(p.id)))
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
       and exists (select 1 from public.projects p where p.id = p_project_id
                  and (public.money_read_is_internal() or public.project_money_in_scope(p.id)))
  ), tagged as (
    select r.fiscal_year, m.category, sum(r.net) as source_sum
      from reading r join public.budget_category_account_map m
        on m.org_id = r.org_id and m.erp_account = r.account
     group by r.fiscal_year, m.category
  ), attributed as materialized (
    select * from public.budget_attributed_year_sums(p_project_id, p_fiscal_years)
     where exists (select 1 from public.projects p where p.id = p_project_id
                  and (public.money_read_is_internal() or public.project_money_in_scope(p.id)))
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
  ), in_scope as (                                     -- a client's money reads only projects in scope (2751)
    select v.id from visible v
     where (select public.money_read_is_internal()) or (select not public.actor_money_scoped())
        or v.id in (select public.actor_money_projects())
  ), generation as (
    select s.snapshot_id from public.erp_actuals_snapshot s
    where s.org_id = public.auth_org_id()
    order by s.created_at desc,s.id desc limit 1
  ), reading as materialized (
    select s.* from public.erp_actuals_snapshot s
    where s.org_id = public.auth_org_id() and s.project_id in (select id from in_scope)
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
    where x.project_id in (select id from in_scope)
  ), charged as materialized (                                                       -- 0497
    select x.* from public.equipment_charge_org_actuals(p_fiscal_year) x
    where x.project_id in (select id from in_scope)
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

-- Approval routing's project figures. Definer code (every decision, notification and gate) and roles not limited by the
-- rule read them as before. A limited Project Manager reads them through spend_route_project_figures_routed: the projects
-- in their money scope and those whose spend approval can route to them, computed from the whole project.
CREATE FUNCTION public.spend_route_project_figures_core(p_project_ids uuid[])
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
revoke all on function public.spend_route_project_figures_core(uuid[]) from public, anon;
grant execute on function public.spend_route_project_figures_core(uuid[]) to authenticated, service_role;

create function public.spend_route_project_figures_routed(p_project_ids uuid[]) returns table(project_id uuid, figures jsonb)
  language sql stable security definer set search_path = public, pg_temp as $$
  with me as (                                          -- the caller and the approvers they stand in for today
    select auth.uid() as id
    union
    select s.delegator_id from public.approval_stand_ins s
     where s.org_id = public.auth_org_id() and s.stand_in_id = auth.uid() and s.revoked_at is null
       and public.native_org_today(s.org_id) between s.starts_on and s.ends_on
  ), waiting as (                                       -- requests waiting for a decision, never the caller's own
    select pr.project_id from public.procurements pr
     where pr.org_id = public.auth_org_id() and pr.status = 'Requested' and pr.requested_by_id is distinct from auth.uid()
    union
    select c.project_id from public.expense_claims c
     where c.org_id = public.auth_org_id() and c.status = 'Submitted' and c.claimant_id is distinct from auth.uid()
  )
  select f.* from public.spend_route_project_figures_core(array(
    select p.id from public.projects p
     where public.assert_not_light() and p.org_id = public.auth_org_id() and p.id = any (p_project_ids)                    -- the caller's organisation only
       and public.is_active_member() and (select public.actor_shown_prices())
       and (p.id in (select public.actor_money_projects())
            -- another project: only while a request on it waits for a decision the caller may make
            or (p.id in (select w.project_id from waiting w)                                    -- mut:figures_routed_waiting
                and (exists (select 1 from public.spend_approvers sa                            -- mut:figures_routed_approver
                              where sa.org_id = p.org_id and (sa.project_id = p.id or sa.project_id is null)
                                and sa.profile_id in (select id from me))
                     -- no named project approver: the flat matrix routes to every holder of approval rank (1292)
                     or (public.holds_spend_approval_authority(public.auth_role())
                         and not exists (select 1 from public.spend_approvers sa where sa.org_id = p.org_id and sa.project_id = p.id))))))) f
$$;
revoke all on function public.spend_route_project_figures_routed(uuid[]) from public, anon;
grant execute on function public.spend_route_project_figures_routed(uuid[]) to authenticated, service_role;

create or replace function public.spend_approval_project_figures(p_project_ids uuid[]) returns table(project_id uuid, figures jsonb)
  language sql stable security invoker set search_path = public, pg_temp as $$
  select c.* from public.spend_route_project_figures_core(p_project_ids) c
   where (select public.money_read_is_internal()) or (select not public.actor_money_scoped())
  union all
  select r.* from public.spend_route_project_figures_routed(p_project_ids) r
   where not ((select public.money_read_is_internal()) or (select not public.actor_money_scoped()))
$$;


-- ── The project's billing: claims and their money (DD-R1125-14) ──────────────────────────────────────────────────────────
-- The billing summary reads as no project for a client outside the project's money scope (null, as for an unseen project);
-- the claim rows, their lines and their evidence follow the same scope at the table.
create or replace function public.get_project_billing(p_project_id uuid)
 returns jsonb language sql stable security invoker set search_path=public, pg_temp as $$
with p as (
 select pr.id,pr.org_id,pr.currency,case when pr.tax_treatment='inclusive' then pr.contract_value-coalesce(pr.tax_amount,0) else pr.contract_value end contract_net
 from public.projects pr where pr.id=p_project_id
   and (public.money_read_is_internal() or public.project_money_in_scope(pr.id))   -- mut:pm_scope_billing
), counted as (
 select w.is_down_payment,w.net,w.recovery from public.sales_invoice_work_billed w join p on p.id=w.project_id
 where w.status in ('Submitted','Unpaid','Paid') and w.net is not null and w.currency=p.currency
 union all
 select false,ob.claimed_amount,0 from public.opening_balances ob join public.work_orders wo on wo.id=ob.work_order_id join p on p.id=wo.project_id
 where ob.kind='work_order' and ob.reversed_at is null and ob.currency=p.currency
), claims as (
 select pc.id,pc.kind,pc.gross_amount,pc.dp_recovery_amount,pc.work_order_id,si.status
 from public.progress_claims pc left join public.sales_invoices si on si.id=pc.id and si.org_id=pc.org_id
 where pc.project_id=p_project_id and pc.withdrawn_at is null and si.status is distinct from 'Cancelled'
), opening_claimed as (
 select ob.work_order_id,x.boq_item_id,x.claimed_quantity claimed from public.opening_balance_lines x join public.opening_balances ob on ob.id=x.opening_id
 join public.work_orders wo on wo.id=ob.work_order_id where wo.project_id=p_project_id and ob.reversed_at is null and x.claimed_quantity>0
), claimed_line as (
 select boq_item_id,sum(claimed) claimed from (
  select l.boq_item_id,l.quantity claimed from public.progress_claim_lines l join claims c on c.id=l.claim_id
  union all select boq_item_id,claimed from opening_claimed) u group by boq_item_id
), claimed_alloc as (
 select boq_item_id,work_order_id,sum(claimed) claimed from (
  select l.boq_item_id,c.work_order_id,l.quantity claimed from public.progress_claim_lines l join claims c on c.id=l.claim_id where c.work_order_id is not null
  union all select boq_item_id,work_order_id,claimed from opening_claimed) u group by boq_item_id,work_order_id
), latest as (
 select e.id,e.month,e.pct_complete from public.project_progress_entries e where e.project_id=p_project_id
 and e.month<=public.org_current_month((select o.default_timezone from public.organizations o where o.id=public.auth_org_id()),now()) order by e.month desc limit 1
), assessed as (select q.boq_item_id,q.quantity_to_date from public.progress_assessment_quantities q join latest l on l.id=q.entry_id),
latest_bast as (
 select distinct on (a.work_order_id) a.work_order_id,a.id,a.is_final
 from public.work_order_acceptances a where a.project_id=p_project_id and a.status='Confirmed'
 order by a.work_order_id,a.confirmed_at desc,a.id desc
), allocation as (
 select wl.boq_item_id,wl.work_order_id,wl.quantity,wo.status,
   coalesce(ca.claimed,0) claimed,al.quantity accepted,coalesce(lb.is_final,false) final
 from public.work_order_lines wl join public.work_orders wo on wo.id=wl.work_order_id
 left join claimed_alloc ca on ca.boq_item_id=wl.boq_item_id and ca.work_order_id=wl.work_order_id
 left join latest_bast lb on lb.work_order_id=wl.work_order_id
 left join public.work_order_acceptance_lines al on al.acceptance_id=lb.id and al.boq_item_id=wl.boq_item_id
 where wl.org_id=public.auth_org_id() and wo.project_id=p_project_id and wo.status<>'Cancelled'
), agg as (
 select b.id,b.earning_basis,b.line_no,b.created_at,b.quantity contract_quantity,b.rate,
  coalesce((select sum(a.quantity) from allocation a where a.boq_item_id=b.id and a.status in ('Issued','Closed')),0) ordered_quantity,
  coalesce((select sum(a.quantity) from allocation a where a.boq_item_id=b.id and a.status='Issued'),0) issued_ordered,
  coalesce((select sum(a.accepted) from allocation a where a.boq_item_id=b.id and a.final and a.status='Closed'),0) closed_final,
  coalesce((select sum(a.accepted) from allocation a where a.boq_item_id=b.id and a.accepted is not null),0) accepted_quantity,
  coalesce(cl.claimed,0) claimed_quantity,a.quantity_to_date assessed_quantity,
  coalesce((select jsonb_agg(jsonb_build_object('work_order_id',x.work_order_id,'boq_item_id',x.boq_item_id,'quantity',x.quantity,'claimed_quantity',x.claimed,'accepted_quantity',x.accepted,'final',x.final) order by x.work_order_id)
    from allocation x where x.boq_item_id=b.id),'[]'::jsonb) allocations
 from public.boq_items b left join claimed_line cl on cl.boq_item_id=b.id left join assessed a on a.boq_item_id=b.id where b.project_id=p_project_id
), earned as (select * from public.project_line_earned(p_project_id)), lines as (
 select a.*,coalesce(e.earned_quantity,0) earned_quantity,
  a.contract_quantity-a.issued_ordered-a.closed_final contract_balance
 from agg a left join earned e on e.boq_item_id=a.id
)
select jsonb_build_object(
 'currency',p.currency,'contract_net',p.contract_net,
 'work_billed',coalesce((select sum(net+recovery) from counted where not is_down_payment),0),
 'dp_billed',coalesce((select sum(net) from counted where is_down_payment),0),
 'dp_recovered',coalesce((select sum(recovery) from counted where not is_down_payment),0),
 'not_submitted',coalesce((select sum(gross_amount-dp_recovery_amount) from claims where status is null or status='Draft'),0),
 'assessment',(select jsonb_build_object('month',l.month,'pct_complete',l.pct_complete) from latest l),
 'earned_value',coalesce((select sum(earned_value) from earned),0),
 'boq',coalesce((select jsonb_agg(jsonb_build_object('boq_item_id',id,'claimed_quantity',claimed_quantity,'assessed_quantity',assessed_quantity,
   'earning_basis',earning_basis,'line_no',line_no,'ordered_quantity',ordered_quantity,'accepted_quantity',accepted_quantity,'closed_final',closed_final,
   'earned_quantity',earned_quantity,'contract_balance',contract_balance,'allocations',allocations) order by line_no nulls last,created_at,id)
   from lines),'[]'::jsonb)) from p
$$;

-- Billing per work order (the project's Orders tab): a work order outside the reader's money scope is not listed.
create or replace view public.work_order_billing with (security_invoker = true) as
  select wo.id as work_order_id, wo.org_id, wo.project_id, wo.status, wo.wo_number, wo.title, wo.closed_at, wo.currency,
         coalesce(wo.closing_value,case when wo.tax_treatment='inclusive' then wo.order_value-wo.tax_amount else wo.order_value end) as order_net,
         coalesce(sum(l.billed) filter(where l.submitted),0) as invoiced,
         coalesce(sum(l.billed) filter(where not l.submitted),0) as pending,
         coalesce(sum(l.billed) filter(where l.paid),0) as paid,
         coalesce(wo.closing_value,case when wo.tax_treatment='inclusive' then wo.order_value-wo.tax_amount else wo.order_value end)-coalesce(sum(l.billed),0) as remaining,
         coalesce(bool_and(l.billed is not null and l.currency=wo.currency) filter(where l.record_id is not null),true) as figures_complete,
         count(l.record_id)::int as line_count,(count(l.record_id) filter(where l.submitted and not l.paid))::int as unpaid_count
    from public.work_orders wo left join public.work_order_billing_lines l on l.work_order_id=wo.id and l.org_id=wo.org_id
   where (select public.money_read_is_internal()) or public.project_money_in_scope(wo.project_id)   -- mut:pm_scope_wo_billing
   group by wo.id;

create policy progress_claims_money_scope on public.progress_claims as restrictive for select to authenticated
  using ((select public.money_read_is_internal()) or public.project_money_in_scope(project_id));
create policy progress_claim_lines_money_scope on public.progress_claim_lines as restrictive for select to authenticated
  using ((select public.money_read_is_internal())
         or exists (select 1 from public.progress_claims c where c.id = progress_claim_lines.claim_id));
create policy progress_claim_evidence_money_scope on public.progress_claim_evidence as restrictive for select to authenticated
  using ((select public.money_read_is_internal())
         or exists (select 1 from public.progress_claims c where c.id = progress_claim_evidence.claim_id));

-- ── Who names a project's managers (Director ruling, 26 Nov) ─────────────────────────────────────────────────────────────
-- A limited Project Manager or deputy: may name the deputy only on a project they manage, never changes the manager after
-- the project is created, and so cannot bring another manager's project into their own money scope. Naming themselves
-- manager of a project they create stays allowed. Everyone else is unchanged. It holds the signed-in person's own write
-- (the only path that sets these fields); the table owner and service jobs are not a person and pass.
create function public.guard_project_people_fields() returns trigger
  language plpgsql set search_path = public, pg_temp as $$
begin
  if public.money_read_is_internal() or not public.actor_money_scoped() then return new; end if;  -- mut:people_who
  if tg_op = 'INSERT' then
    if new.deputy_manager_id is not null and new.project_manager_id is distinct from auth.uid() then
      raise exception 'only the project''s manager names its deputy' using errcode = '42501';
    end if;
    return new;
  end if;
  if new.project_manager_id is distinct from old.project_manager_id then                          -- mut:people_manager
    raise exception 'a Project Manager cannot change who manages a project' using errcode = '42501';
  end if;
  if new.deputy_manager_id is distinct from old.deputy_manager_id
     and old.project_manager_id is distinct from auth.uid() then                                  -- mut:people_deputy
    raise exception 'only the project''s manager names its deputy' using errcode = '42501';
  end if;
  return new;
end $$;
revoke all on function public.guard_project_people_fields() from public, anon, authenticated;
create trigger projects_guard_people_fields
  before insert or update of project_manager_id, deputy_manager_id on public.projects
  for each row execute function public.guard_project_people_fields();

commit;

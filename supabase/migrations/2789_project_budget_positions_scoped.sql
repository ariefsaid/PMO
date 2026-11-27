-- 2789: a project page or an approval reads ledger actuals for the projects it asks about, not the whole organisation.
-- Before, the accounting-ledger branch of project_budget_positions ran project_mapped_actuals_all and
-- equipment_charge_org_actuals for every project of the organisation, then kept the asked ones (0.4 to 1 s on a
-- ledger-basis organisation). For up to 10 asked projects it now reads project_mapped_actuals and
-- equipment_charge_project_actuals once per asked project; with no list or a longer one it reads as before.
-- Approval routing's figures (spend_route_project_figures_core, 2769) read the by-category Actual the same way.
-- Rows and figures are unchanged (parity proof: supabase/tests/2789_project_budget_positions_scoped.test.sql).
-- Same signature, security invoker, owner, search_path and grants (create or replace keeps them).
-- Rollback: supabase/migrations/rollback/2789_project_budget_positions_scoped_down.sql (the 0859 and 2769 bodies verbatim).

create or replace function public.project_budget_positions(p_project_ids uuid[] default null)
returns table(
  project_id uuid,
  ledger_basis text,
  currency text,
  budget_currency text,
  active_budget_amount text,
  spent text,
  open_commitment text,
  consumption text,
  complete boolean,
  used_ratio text,
  used_percent text,
  consumption_variance text,
  risk_eligible boolean,
  at_risk boolean
)
language sql stable security invoker set search_path = public, pg_catalog as $$
  with caller as materialized (
    select public.auth_org_id() as org_id,
           public.auth_role()::text as role,
           public.is_active_member() as active_member,
           public.org_reads_erp_ledger() as uses_erp
  ), projects as materialized (
    select p.id, p.org_id, p.status::text as status, p.archived_at, p.currency as project_currency,
           o.default_currency as org_currency,
           case when c.uses_erp then coalesce(
             (select m.attrs->>'currency'
                from public.external_master_records m
               where m.org_id = p.org_id and m.external_tier = 'odoo' and m.kind = 'company'
                 and m.tombstoned_at is null and m.attrs->>'currency' ~ '^[A-Z]{3}$'
               order by m.active desc, m.external_id limit 1),
             o.default_currency)
             else p.currency end as currency,
           c.uses_erp
      from public.projects p
      join caller c on c.org_id = p.org_id
      join public.organizations o on o.id = p.org_id
     where c.active_member
       and c.role = any(array['Admin','Executive','Project Manager','Finance']::text[])
       and (p_project_ids is null or p.id = any(p_project_ids))
  ), active_versions as (
    select distinct on (v.project_id) v.id, v.project_id, v.org_id, v.currency
      from public.budget_versions v
      join projects p on p.id = v.project_id and p.org_id = v.org_id
     where v.status = 'Active'
     order by v.project_id, v.version desc, v.created_at desc, v.id desc
  ), active_budgets as (
    select v.project_id,
           v.currency as budget_currency,
           case when count(li.id) filter (
                        where li.id is not null
                          and (li.budgeted_amount is null
                               or li.budgeted_amount::text in ('NaN','Infinity','-Infinity'))
                      ) > 0 then null::numeric
                else coalesce(sum(li.budgeted_amount) filter (
                               where li.id is not null
                                 and li.budgeted_amount::text not in ('NaN','Infinity','-Infinity')
                             ), 0::numeric)
           end as active_budget_amount
      from active_versions v
      left join public.budget_line_items li
        on li.budget_version_id = v.id and li.org_id = v.org_id
     group by v.project_id, v.currency
  ), pmo_positions as materialized (
    select pp.project_id, pp.spent, pp.spent_complete, pp.committed, pp.committed_complete
      from public.project_pmo_positions(
        (select coalesce(array_agg(p.id), '{}'::uuid[]) from projects p)
      ) pp
  ), erp_enabled as materialized (
    select true as enabled from projects p where p.uses_erp limit 1
  ), erp_per_project as materialized (
    -- 2789: a short list (a project page, an approval) reads each asked project's actuals; no list or a long one reads
    -- the organisation once. Same rows either way (2789_project_budget_positions_scoped.test.sql).
    -- ponytail: cutoff 10 sits below where one organisation pass beats per-project passes; tune from measurements.
    select coalesce(cardinality(p_project_ids) <= 10, false) as yes
  ), erp_actual_rows as materialized (
    select a.project_id, a.mapped, a.actuals_to_date, a.equipment_charge_to_date
      from erp_enabled e
      cross join lateral public.project_mapped_actuals_all(null) a
      join projects p on p.id = a.project_id and p.uses_erp
     where not (select yes from erp_per_project)
    union all
    select p.id, a.mapped, a.actuals_to_date, a.equipment_charge_to_date
      from erp_enabled e
      cross join projects p
      cross join lateral public.project_mapped_actuals(p.id, null) a
     where p.uses_erp and (select yes from erp_per_project)
  ), erp_charge_rows as materialized (
    select c.project_id, c.n, c.amount
      from erp_enabled e
      cross join lateral public.equipment_charge_org_actuals(null) c
      join projects p on p.id = c.project_id and p.uses_erp
     where not (select yes from erp_per_project)
    union all
    select p.id, c.n, c.amount
      from erp_enabled e
      cross join projects p
      cross join lateral public.equipment_charge_project_actuals(p.id, null) c
     where p.uses_erp and (select yes from erp_per_project)
  ), erp_charges as (
    -- Hire charges are priced in organizations.default_currency; preserve an unknown amount rather than coalescing it.
    select c.project_id,
           sum(c.n)::bigint as charge_count,
           case when count(*) filter (where c.amount is null
                       or c.amount::text in ('NaN','Infinity','-Infinity')) > 0 then null::numeric
                else sum(c.amount) end as charge_amount
      from erp_charge_rows c
     group by c.project_id
  ), erp_ledger_readings as materialized (
    -- ERP actual snapshots contain only populated project readings. With no row for the project,
    -- the current model cannot distinguish an authoritative empty ledger from an absent reading;
    -- treat absence as unknown even when an internal charge has an as-of timestamp.
    select distinct s.project_id
      from erp_enabled e
      cross join lateral (
        select latest.snapshot_id
          from public.erp_actuals_snapshot latest
         where latest.org_id = (select org_id from caller)
         order by latest.created_at desc, latest.id desc
         limit 1
      ) generation
      join public.erp_actuals_snapshot s
        on s.org_id = (select org_id from caller) and s.snapshot_id = generation.snapshot_id
      join projects p on p.id = s.project_id and p.uses_erp
  ), erp_actuals as (
    select a.project_id,
           case when count(*) filter (where a.mapped) = 0
                  or count(*) filter (where a.mapped and (
                       a.actuals_to_date is null
                       or a.actuals_to_date::text in ('NaN','Infinity','-Infinity')
                     )) > 0
                  or bool_or(l.project_id is not null) is not true
                  -- Do not relabel an org-currency hire charge as the ERP/company currency.
                  or (coalesce(max(c.charge_count), 0) > 0
                      and (max(c.charge_amount) is null or p.org_currency is distinct from p.currency))
                then null::numeric
                -- project_mapped_actuals_all already includes mapped hire charges. Remove those from its subtotal,
                -- then add all charges once so categories without an ERP account mapping remain in project consumption.
                else sum(a.actuals_to_date) filter (where a.mapped)
                     - coalesce(sum(a.equipment_charge_to_date) filter (where a.mapped), 0::numeric)
                     + coalesce(max(c.charge_amount), 0::numeric)
           end as actual
      from erp_actual_rows a
      join projects p on p.id = a.project_id and p.uses_erp
      left join erp_ledger_readings l on l.project_id = a.project_id
      left join erp_charges c on c.project_id = a.project_id
     group by a.project_id, p.org_currency, p.currency
  ), source_positions as (
    select p.id as project_id,
           case when p.uses_erp then 'erp' else 'pmo' end as ledger_basis,
           p.currency,
           ab.budget_currency,
           ab.active_budget_amount,
           case when p.uses_erp then ea.actual else pp.spent end as spent,
           case when p.uses_erp then null::numeric
                when pp.committed_complete then pp.committed
                else null::numeric end as open_commitment,
           case when p.uses_erp then ea.actual
                when pp.spent_complete and pp.spent is not null
                     and pp.committed_complete and pp.committed is not null
                  then pp.spent + pp.committed
                else null::numeric end as consumption,
           p.status,
           p.archived_at,
           p.project_currency,
           (p.currency is not null and p.currency = p.project_currency
             and ab.budget_currency is not null and ab.budget_currency = p.project_currency) as currencies_match
      from projects p
      left join active_budgets ab on ab.project_id = p.id
      left join pmo_positions pp on pp.project_id = p.id and not p.uses_erp
      left join erp_actuals ea on ea.project_id = p.id and p.uses_erp
  ), ratios as (
    select s.*,
           s.consumption is not null as complete,
           case when s.consumption is not null and s.active_budget_amount > 0 and s.currencies_match
                then s.consumption / s.active_budget_amount end as used_ratio,
           (s.archived_at is null and s.status = any(public.active_delivery_project_statuses())) as risk_eligible
      from source_positions s
  )
  select r.project_id,
         r.ledger_basis,
         r.currency,
         r.budget_currency,
         r.active_budget_amount::text,
         r.spent::text,
         r.open_commitment::text,
         r.consumption::text,
         r.complete,
         r.used_ratio::text,
         case when r.used_ratio is null then null::text else round(r.used_ratio * 100)::text end as used_percent,
         case when r.used_ratio is null then null::text else (r.consumption - r.active_budget_amount)::text end as consumption_variance,
         r.risk_eligible,
         case when not r.risk_eligible then false
              when r.used_ratio is null then null
              else r.used_ratio >= 0.9 end as at_risk
    from ratios r
$$;

CREATE OR REPLACE FUNCTION public.spend_route_project_figures_core(p_project_ids uuid[])
 RETURNS TABLE(project_id uuid, figures jsonb)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  with g as materialized (
    select public.is_active_member() and public.holds_spend_approval_authority(public.auth_role()) as ok
  ), pos as materialized (
    select pp.* from public.project_budget_positions(p_project_ids) pp where (select ok from g)
  ), erp_rows as materialized (
    -- With an accounting system the by-category Actual (project_finance_actuals' ledger branch). 2789: up to 10 ledger
    -- projects read each one's own (project_mapped_actuals); more read the organisation once (project_mapped_actuals_all),
    -- as before. Same rows either way (2789_project_budget_positions_scoped.test.sql).
    select a.project_id, a.category, a.mapped, a.actuals_to_date
      from (select 1 where exists (select 1 from pos where pos.ledger_basis = 'erp')) one
      cross join lateral public.project_mapped_actuals_all(null) a
     where a.project_id in (select pos.project_id from pos where pos.ledger_basis = 'erp')
       and (select count(*) from pos where pos.ledger_basis = 'erp') > 10
    union all
    select pos.project_id, a.category, a.mapped, a.actuals_to_date
      from pos
      cross join lateral public.project_mapped_actuals(pos.project_id, null) a
     where pos.ledger_basis = 'erp' and (select count(*) from pos where pos.ledger_basis = 'erp') <= 10
  ), erp_rec as materialized (
    select r.project_id,
           jsonb_object_agg(r.category::text, jsonb_build_object('mapped', r.mapped, 'amount', r.actuals_to_date)) as by_category
      from erp_rows r
     group by r.project_id
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

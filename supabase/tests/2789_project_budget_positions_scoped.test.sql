-- 2789: project_budget_positions reads ledger actuals only for the projects asked (up to 10), not the whole organisation.
-- Proof that nothing else changed: the 0859 body (the definition live before 2789) is kept below verbatim as _ppb_0859
-- inside this transaction, and old = new (EXCEPT ALL both ways, zero rows) for every active profile of every organisation
-- (seeded and fixture: an accounting-ledger organisation with rules, a group account, an equipment pool, hire charges and a
-- placed invoice; a document-basis organisation), for every project of the caller's organisation and lists of every kind,
-- both as a signed-in client and inside definer code. Then function-call and ledger-row counts show the one-project path no
-- longer runs the organisation-wide readers, and parity holds at production's project count. Note: the attribution engine
-- still reads every ledger line on the accounts the asked project's rules name (a line's project is what the rules decide).
-- Mutation checks (run 27 Nov 2026, each went red): in 2789 pass '2025' instead of null to project_mapped_actuals, or drop
-- the per-project hire-charge branch, and the single, short and 134-project parity rows fail; set the cutoff to "<= 0" and
-- the one-project and ten-project call-count rows fail.
begin;
create extension if not exists pgtap;
select plan(25);

-- the definition before 2789 (0859), verbatim but for its name
create function public._ppb_0859(p_project_ids uuid[] default null)
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
  ), erp_actual_rows as materialized (
    select a.project_id, a.mapped, a.actuals_to_date, a.equipment_charge_to_date
      from erp_enabled e
      cross join lateral public.project_mapped_actuals_all(null) a
      join projects p on p.id = a.project_id and p.uses_erp
  ), erp_charge_rows as materialized (
    select c.project_id, c.n, c.amount
      from erp_enabled e
      cross join lateral public.equipment_charge_org_actuals(null) c
      join projects p on p.id = c.project_id and p.uses_erp
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
grant execute on function public._ppb_0859(uuid[]) to authenticated;

-- ── fixture: Z = accounting-ledger organisation with rules, a group account, an equipment pool, hire charges and a placed
-- invoice; Y = document-basis organisation. 'Z' ids 27890000-…-0000000000xx, 'Y' ids 27890000-…-00000000bbxx.
insert into organizations (id, name, default_currency, default_timezone) values
  ('27890000-0000-0000-0000-00000000000a', '2789 ledger org', 'IDR', 'UTC'),
  ('27890000-0000-0000-0000-00000000000b', '2789 document org', 'USD', 'UTC');
insert into auth.users (id, email)
select ('27890000-0000-0000-0000-0000000000' || k)::uuid, '2789-' || k || '@example.test'
  from unnest(array['a1','a2','a3','a4','a5','a6','a8','b1','b2','b3']) k;
insert into profiles (id, org_id, full_name, email, role, status) values
  ('27890000-0000-0000-0000-0000000000a1', '27890000-0000-0000-0000-00000000000a', 'Z Admin', '2789-a1@example.test', 'Admin', 'active'),
  ('27890000-0000-0000-0000-0000000000a2', '27890000-0000-0000-0000-00000000000a', 'Z Finance', '2789-a2@example.test', 'Finance', 'active'),
  ('27890000-0000-0000-0000-0000000000a3', '27890000-0000-0000-0000-00000000000a', 'Z Executive', '2789-a3@example.test', 'Executive', 'active'),
  ('27890000-0000-0000-0000-0000000000a4', '27890000-0000-0000-0000-00000000000a', 'Z PM own', '2789-a4@example.test', 'Project Manager', 'active'),
  ('27890000-0000-0000-0000-0000000000a5', '27890000-0000-0000-0000-00000000000a', 'Z PM deputy', '2789-a5@example.test', 'Project Manager', 'active'),
  ('27890000-0000-0000-0000-0000000000a6', '27890000-0000-0000-0000-00000000000a', 'Z Engineer', '2789-a6@example.test', 'Engineer', 'active'),
  ('27890000-0000-0000-0000-0000000000a8', '27890000-0000-0000-0000-00000000000a', 'Z PM none', '2789-a8@example.test', 'Project Manager', 'active'),
  ('27890000-0000-0000-0000-0000000000b1', '27890000-0000-0000-0000-00000000000b', 'Y Finance', '2789-b1@example.test', 'Finance', 'active'),
  ('27890000-0000-0000-0000-0000000000b2', '27890000-0000-0000-0000-00000000000b', 'Y PM', '2789-b2@example.test', 'Project Manager', 'active'),
  ('27890000-0000-0000-0000-0000000000b3', '27890000-0000-0000-0000-00000000000b', 'Y Engineer', '2789-b3@example.test', 'Engineer', 'active');
-- twelve ledger projects (more than the short-list cutoff), three document-basis projects
insert into projects (id, org_id, name, status, currency)
select ('27890000-0000-0000-0000-0000000000' || lpad(to_hex(192 + i), 2, '0'))::uuid, '27890000-0000-0000-0000-00000000000a',
       '2789 Z' || i, (case when i = 12 then 'Close Out' else 'Ongoing Project' end)::project_status, 'IDR'
  from generate_series(1, 12) i;
insert into projects (id, org_id, name, status, currency) values
  ('27890000-0000-0000-0000-0000000bb0c1', '27890000-0000-0000-0000-00000000000b', '2789 Y1', 'Ongoing Project', 'USD'),
  ('27890000-0000-0000-0000-0000000bb0c2', '27890000-0000-0000-0000-00000000000b', '2789 Y2', 'Ongoing Project', 'USD'),
  ('27890000-0000-0000-0000-0000000bb0c3', '27890000-0000-0000-0000-00000000000b', '2789 Y3', 'Ongoing Project', 'USD');
-- the own-projects Project Manager manages Z1 and Z2, the deputy stands in on Z3, Y's PM manages Y1
update projects set project_manager_id = '27890000-0000-0000-0000-0000000000a4'
 where id in ('27890000-0000-0000-0000-0000000000c1', '27890000-0000-0000-0000-0000000000c2');
update projects set deputy_manager_id = '27890000-0000-0000-0000-0000000000a5' where id = '27890000-0000-0000-0000-0000000000c3';
update projects set project_manager_id = '27890000-0000-0000-0000-0000000000b2' where id = '27890000-0000-0000-0000-0000000bb0c1';

insert into external_org_bindings (id, org_id, external_tier, site_url, secret_ref, config, activated_at, status) values
  ('27890000-0000-0000-0000-0000000000f5', '27890000-0000-0000-0000-00000000000a', 'erpnext', 'https://example.test', 'test',
   '{"company":"ZC"}', now(), 'active');

-- chart: Payroll group {Salary, Bonus}; Rent; Fuel; Cost; Office group {Utilities}; Travel (unmapped); Creditors (liability)
insert into erp_account_mirror (org_id, company, erp_name, account_name, root_type, report_type, parent_account, is_group, account_currency, lft, rgt, refresh_id) values
  ('27890000-0000-0000-0000-00000000000a','ZC','Payroll - ZC','Payroll','Expense','Profit and Loss',null,true,'IDR',1,6,'27890000-0000-0000-0000-0000000000f0'),
  ('27890000-0000-0000-0000-00000000000a','ZC','Salary - ZC','Salary','Expense','Profit and Loss','Payroll - ZC',false,'IDR',2,3,'27890000-0000-0000-0000-0000000000f0'),
  ('27890000-0000-0000-0000-00000000000a','ZC','Bonus - ZC','Bonus','Expense','Profit and Loss','Payroll - ZC',false,'IDR',4,5,'27890000-0000-0000-0000-0000000000f0'),
  ('27890000-0000-0000-0000-00000000000a','ZC','Rent - ZC','Rent','Expense','Profit and Loss',null,false,'IDR',7,8,'27890000-0000-0000-0000-0000000000f0'),
  ('27890000-0000-0000-0000-00000000000a','ZC','Office - ZC','Office','Expense','Profit and Loss',null,true,'IDR',9,12,'27890000-0000-0000-0000-0000000000f0'),
  ('27890000-0000-0000-0000-00000000000a','ZC','Utilities - ZC','Utilities','Expense','Profit and Loss','Office - ZC',false,'IDR',10,11,'27890000-0000-0000-0000-0000000000f0'),
  ('27890000-0000-0000-0000-00000000000a','ZC','Fuel - ZC','Fuel','Expense','Profit and Loss',null,false,'IDR',13,14,'27890000-0000-0000-0000-0000000000f0'),
  ('27890000-0000-0000-0000-00000000000a','ZC','Cost - ZC','Cost','Expense','Profit and Loss',null,false,'IDR',15,16,'27890000-0000-0000-0000-0000000000f0'),
  ('27890000-0000-0000-0000-00000000000a','ZC','Travel - ZC','Travel','Expense','Profit and Loss',null,false,'IDR',17,18,'27890000-0000-0000-0000-0000000000f0'),
  ('27890000-0000-0000-0000-00000000000a','ZC','Creditors - ZC','Creditors','Liability','Balance Sheet',null,false,'IDR',19,20,'27890000-0000-0000-0000-0000000000f0');
insert into budget_category_account_map (org_id, category, erp_account, is_push_target) values
  ('27890000-0000-0000-0000-00000000000a','Labor','Salary - ZC',true),
  ('27890000-0000-0000-0000-00000000000a','Labor','Bonus - ZC',false),
  ('27890000-0000-0000-0000-00000000000a','Overheads','Rent - ZC',true),
  ('27890000-0000-0000-0000-00000000000a','Overheads','Utilities - ZC',false),
  ('27890000-0000-0000-0000-00000000000a','Equipment','Fuel - ZC',true),
  ('27890000-0000-0000-0000-00000000000a','Materials','Cost - ZC',true);

-- 1,200 ledger lines over two years: untagged, tagged, empty-string tag, cancelled, credits, Employee party lines
insert into erp_gl_entry_mirror (org_id, erp_name, company, account, cost_center, fiscal_year, project, party_type, party,
                                 voucher_type, voucher_no, posting_date, debit, credit, is_cancelled, erp_modified)
select '27890000-0000-0000-0000-00000000000a', 'GL-Z-' || i, 'ZC',
       (array['Salary','Bonus','Rent','Fuel','Cost','Utilities','Travel'])[i % 7 + 1] || ' - ZC',
       (array['Site A','Site B',null])[i % 3 + 1],
       to_char(d, 'YYYY'),
       case when i % 9 = 0 then 'PRJ-T' when i % 19 = 0 then '' end,
       case when i % 11 = 0 then 'Employee' end,
       case when i % 11 = 0 then 'EMP-' || (i % 4) end,
       'Journal Entry', 'JV-' || i, d,
       case when i % 13 = 0 then 0 else round((i * 37 % 997)::numeric * 1.13, 2) end,
       case when i % 13 = 0 then round((i * 11 % 97)::numeric, 2) else 0 end,
       i % 17 = 0, '1'
  from generate_series(1, 1200) i, lateral (select date '2025-01-01' + (i % 600) as d) x;

-- rules: a group account split 60/40, a cost-centre rule, a less specific rule split three ways (rounding), a party rule,
-- a dated rule, and a superseded version that must not count
insert into cost_attribution_rules (id, org_id, rule_key, version, name, match_account, match_account_group, match_cost_center,
                                    match_party_type, match_party, effective_from, effective_to, specificity, is_current) values
  ('27890000-0000-0000-0000-0000000001d1','27890000-0000-0000-0000-00000000000a','27890000-0000-0000-0000-0000000002d1',1,'Payroll split',null,'Payroll - ZC',null,null,null,'2025-01-01',null,1,true),
  ('27890000-0000-0000-0000-0000000001d2','27890000-0000-0000-0000-00000000000a','27890000-0000-0000-0000-0000000002d2',1,'Rent site A','Rent - ZC',null,'Site A',null,null,'2025-01-01',null,3,true),
  ('27890000-0000-0000-0000-0000000001d3','27890000-0000-0000-0000-00000000000a','27890000-0000-0000-0000-0000000002d3',1,'Rent rest','Rent - ZC',null,null,null,null,'2025-01-01',null,2,true),
  ('27890000-0000-0000-0000-0000000001d4','27890000-0000-0000-0000-00000000000a','27890000-0000-0000-0000-0000000002d4',1,'Salary EMP-1','Salary - ZC',null,null,'Employee','EMP-1','2025-01-01',null,5,true),
  ('27890000-0000-0000-0000-0000000001d5','27890000-0000-0000-0000-00000000000a','27890000-0000-0000-0000-0000000002d5',1,'Utilities 2026','Utilities - ZC',null,null,null,null,'2026-01-01','2026-06-30',2,true),
  ('27890000-0000-0000-0000-0000000001d6','27890000-0000-0000-0000-00000000000a','27890000-0000-0000-0000-0000000002d6',1,'Cost old','Cost - ZC',null,null,null,null,'2025-01-01',null,2,false);
insert into cost_attribution_rule_targets (rule_id, org_id, position, project_id, percent) values
  ('27890000-0000-0000-0000-0000000001d1','27890000-0000-0000-0000-00000000000a',0,'27890000-0000-0000-0000-0000000000c1',60),
  ('27890000-0000-0000-0000-0000000001d1','27890000-0000-0000-0000-00000000000a',1,'27890000-0000-0000-0000-0000000000c2',40),
  ('27890000-0000-0000-0000-0000000001d2','27890000-0000-0000-0000-00000000000a',0,'27890000-0000-0000-0000-0000000000c3',100),
  ('27890000-0000-0000-0000-0000000001d3','27890000-0000-0000-0000-00000000000a',0,'27890000-0000-0000-0000-0000000000c4',33.33),
  ('27890000-0000-0000-0000-0000000001d3','27890000-0000-0000-0000-00000000000a',1,'27890000-0000-0000-0000-0000000000c5',33.33),
  ('27890000-0000-0000-0000-0000000001d3','27890000-0000-0000-0000-00000000000a',2,'27890000-0000-0000-0000-0000000000c3',33.34),
  ('27890000-0000-0000-0000-0000000001d4','27890000-0000-0000-0000-00000000000a',0,'27890000-0000-0000-0000-0000000000c6',100),
  ('27890000-0000-0000-0000-0000000001d5','27890000-0000-0000-0000-00000000000a',0,'27890000-0000-0000-0000-0000000000c7',50),
  ('27890000-0000-0000-0000-0000000001d5','27890000-0000-0000-0000-00000000000a',1,'27890000-0000-0000-0000-0000000000c1',50),
  ('27890000-0000-0000-0000-0000000001d6','27890000-0000-0000-0000-00000000000a',0,'27890000-0000-0000-0000-0000000000c9',100);

-- equipment: a Fuel pool split by approved hours over Z1, Z8, Z9 (one entry not approved), and hire charges on Z2 and Z10
insert into equipment_assets (id, org_id, code, name, default_unit) values
  ('27890000-0000-0000-0000-0000000000e1','27890000-0000-0000-0000-00000000000a','Z-TRK','Z truck','hours'),
  ('27890000-0000-0000-0000-0000000000e3','27890000-0000-0000-0000-00000000000a','Z-GEN','Z generator','hours');
insert into equipment_costing_settings (org_id, asset_id, setting_key, version, basis, driver, rate_unit, match_account, specificity, effective_from) values
  ('27890000-0000-0000-0000-00000000000a','27890000-0000-0000-0000-0000000000e1','27890000-0000-0000-0000-0000000000e2',1,'actual_cost','units','hours','Fuel - ZC',12,'2025-01-01');
insert into equipment_costing_settings (org_id, asset_id, setting_key, version, basis, work_rate, rate_unit, charge_category, effective_from) values
  ('27890000-0000-0000-0000-00000000000a','27890000-0000-0000-0000-0000000000e3','27890000-0000-0000-0000-0000000000e4',1,'hire_rate',50,'hours','Equipment','2025-01-01');
insert into equipment_usage_entries (org_id, asset_id, project_id, work_date, quantity, unit, kind, status, author_id, approver_id, approved_at)
select '27890000-0000-0000-0000-00000000000a', a::uuid, p::uuid, d::date, q, 'hours', 'work', s,
       '27890000-0000-0000-0000-0000000000a1', case when s = 'Approved' then '27890000-0000-0000-0000-0000000000a2'::uuid end,
       case when s = 'Approved' then now() end
  from (values
    ('27890000-0000-0000-0000-0000000000e1','27890000-0000-0000-0000-0000000000c1','2025-03-10',8,'Approved'),
    ('27890000-0000-0000-0000-0000000000e1','27890000-0000-0000-0000-0000000000c8','2025-03-15',4,'Approved'),
    ('27890000-0000-0000-0000-0000000000e1','27890000-0000-0000-0000-0000000000c9','2025-04-02',3,'Approved'),
    ('27890000-0000-0000-0000-0000000000e1','27890000-0000-0000-0000-0000000000c9','2025-04-03',5,'Submitted'),
    ('27890000-0000-0000-0000-0000000000e3','27890000-0000-0000-0000-0000000000c2','2025-05-05',5,'Approved'),
    ('27890000-0000-0000-0000-0000000000e3','27890000-0000-0000-0000-0000000000ca','2026-02-01',3,'Approved')) v(a, p, d, q, s);

-- a placed invoice (counted once, on Z11) and one whose ERP tag on another row suppresses the placement (Z12)
insert into erp_purchase_documents (id, org_id, erp_doctype, erp_name, supplier, currency, grand_total, net_total, erp_status, erp_docstatus, erp_modified) values
  ('27890000-1000-0000-0000-000000000001','27890000-0000-0000-0000-00000000000a','Purchase Invoice','PINV-Z1','SUP-1','IDR',250,250,'Unpaid',1,'1'),
  ('27890000-1000-0000-0000-000000000002','27890000-0000-0000-0000-00000000000a','Purchase Invoice','PINV-Z2','SUP-1','IDR',100,100,'Unpaid',1,'1');
insert into erp_gl_entry_mirror (org_id, erp_name, company, account, fiscal_year, project, party_type, party, voucher_type, voucher_no, posting_date, debit, credit, is_cancelled, erp_modified) values
  ('27890000-0000-0000-0000-00000000000a','GL-PZ1-a','ZC','Cost - ZC','2025',null,'Supplier','SUP-1','Purchase Invoice','PINV-Z1','2025-06-01',250,0,false,'1'),
  ('27890000-0000-0000-0000-00000000000a','GL-PZ1-b','ZC','Creditors - ZC','2025',null,'Supplier','SUP-1','Purchase Invoice','PINV-Z1','2025-06-01',0,250,false,'1'),
  ('27890000-0000-0000-0000-00000000000a','GL-PZ2-a','ZC','Cost - ZC','2025',null,'Supplier','SUP-1','Purchase Invoice','PINV-Z2','2025-06-02',80,0,false,'1'),
  ('27890000-0000-0000-0000-00000000000a','GL-PZ2-b','ZC','Cost - ZC','2025','PRJ-T','Supplier','SUP-1','Purchase Invoice','PINV-Z2','2025-06-02',20,0,false,'1');
insert into erp_capture_invoice_assignments (org_id, binding_id, source_document_id, request_id, payload_digest, decision, project_id, actor_id, source_voucher_type, source_voucher_no, source_company) values
  ('27890000-0000-0000-0000-00000000000a','27890000-0000-0000-0000-0000000000f5','27890000-1000-0000-0000-000000000001',gen_random_uuid(),'x','project','27890000-0000-0000-0000-0000000000cb','27890000-0000-0000-0000-0000000000a1','Purchase Invoice','PINV-Z1','ZC'),
  ('27890000-0000-0000-0000-00000000000a','27890000-0000-0000-0000-0000000000f5','27890000-1000-0000-0000-000000000002',gen_random_uuid(),'x','project','27890000-0000-0000-0000-0000000000cc','27890000-0000-0000-0000-0000000000a1','Purchase Invoice','PINV-Z2','ZC');

-- tagged readings: an older generation (ignored) and the latest one for Z1..Z8 and Z11 (Z9, Z10, Z12 have none: unknown)
insert into erp_actuals_snapshot (org_id, project_id, account, fiscal_year, debit, credit, net, as_of, snapshot_id, created_at)
select '27890000-0000-0000-0000-00000000000a', ('27890000-0000-0000-0000-0000000000' || lpad(to_hex(192 + i), 2, '0'))::uuid,
       'Salary - ZC', '2025', 1000 + i, 0, 1000 + i, now() - interval '2 days', '27890000-0000-0000-0000-0000000005a1', now() - interval '2 days'
  from generate_series(1, 12) i;
insert into erp_actuals_snapshot (org_id, project_id, account, fiscal_year, debit, credit, net, as_of, snapshot_id, created_at)
select '27890000-0000-0000-0000-00000000000a', ('27890000-0000-0000-0000-0000000000' || lpad(to_hex(192 + i), 2, '0'))::uuid,
       acct, '2025', 100 * i, 0, 100 * i, now(), '27890000-0000-0000-0000-0000000005a2', now()
  from generate_series(1, 11) i, unnest(array['Salary - ZC', 'Cost - ZC']) acct
 where i not in (9, 10);

-- Active budgets on Z1..Z6 and Y1, Y2 (Z6 in another currency); a document-basis purchase with a payment on Y1
insert into budget_versions (id, org_id, project_id, version, name, status, currency)
select ('27890000-0000-0000-0000-0000000003' || lpad(to_hex(192 + i), 2, '0'))::uuid, '27890000-0000-0000-0000-00000000000a',
       ('27890000-0000-0000-0000-0000000000' || lpad(to_hex(192 + i), 2, '0'))::uuid, 1, '2789 Z budget ' || i, 'Draft',
       case when i = 6 then 'USD' else 'IDR' end
  from generate_series(1, 6) i;
insert into budget_versions (id, org_id, project_id, version, name, status, currency) values
  ('27890000-0000-0000-0000-0000000bb3c1','27890000-0000-0000-0000-00000000000b','27890000-0000-0000-0000-0000000bb0c1',1,'2789 Y1 budget','Draft','USD'),
  ('27890000-0000-0000-0000-0000000bb3c2','27890000-0000-0000-0000-00000000000b','27890000-0000-0000-0000-0000000bb0c2',1,'2789 Y2 budget','Draft','USD');
insert into budget_line_items (org_id, budget_version_id, category, description, budgeted_amount)
select v.org_id, v.id, c, '2789 line', 5000
  from budget_versions v, unnest(array['Labor','Materials']::budget_category[]) c
 where v.name like '2789 %';
update budget_versions set status = 'Active' where name like '2789 %';
insert into procurements (id, org_id, title, status, total_value, project_id, currency, budget_category, origin) values
  ('27890000-0000-0000-0000-0000000bb0f1','27890000-0000-0000-0000-00000000000b','2789 Y1 order','Ordered',1000,'27890000-0000-0000-0000-0000000bb0c1','USD','Labor',null),
  ('27890000-0000-0000-0000-0000000bb0f2','27890000-0000-0000-0000-00000000000b','2789 Y2 order','Ordered',300,'27890000-0000-0000-0000-0000000bb0c2','USD','Materials',null);
insert into payments (id, org_id, procurement_id, status, date, amount, currency) values
  ('27890000-0000-0000-0000-0000000bb0e1','27890000-0000-0000-0000-00000000000b','27890000-0000-0000-0000-0000000bb0f1','Paid','2026-10-10',400,'USD');

-- ── helpers ──────────────────────────────────────────────────────────────────────────────────────────
create function pg_temp.as_user(p_sub uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_sub, 'role', 'authenticated')::text, true) $$;
-- old and new for one list: rows in either and not the other (both ways, duplicates counted), and how much was compared
create function pg_temp.cmp(p_ids uuid[]) returns table(diff bigint, n bigint, erp_spent bigint, pmo_spent bigint) language sql as $$
  with o as materialized (select * from public._ppb_0859(p_ids)),
       x as materialized (select * from public.project_budget_positions(p_ids))
  select (select count(*) from (select * from o except all select * from x) a)
       + (select count(*) from (select * from x except all select * from o) b),
         (select count(*) from o),
         (select count(*) from o where ledger_basis = 'erp' and spent is not null),
         (select count(*) from o where ledger_basis = 'pmo' and spent is not null) $$;
-- every active profile of every organisation (seeded and fixture), each kind of list, as a client or inside definer code
create function pg_temp.parity(p_kind text, p_internal boolean)
returns table(diff bigint, lists bigint, n bigint, erp_spent bigint, pmo_spent bigint, callers bigint) language plpgsql as $$
declare c record; v_ids uuid[]; r record; v_other uuid;
begin
  diff := 0; lists := 0; n := 0; erp_spent := 0; pmo_spent := 0; callers := 0;
  for c in select pr.id, pr.org_id from public.profiles pr where pr.status = 'active' order by pr.id loop
    callers := callers + 1;
    select p.id into v_other from public.projects p where p.org_id <> c.org_id order by p.id limit 1;
    for v_ids in
      select array[p.id] from public.projects p where p_kind = 'single' and (p.org_id = c.org_id or p.id = v_other)
      union all select null::uuid[] where p_kind = 'none'
      union all select '{}'::uuid[] where p_kind = 'empty'
      union all select array_agg(p.id order by p.id) || v_other from public.projects p where p_kind = 'all' and p.org_id = c.org_id
      union all select (array_agg(p.id order by p.id))[1:4] || (array_agg(p.id order by p.id))[1] || v_other || null::uuid
                  from public.projects p where p_kind = 'short' and p.org_id = c.org_id
    loop
      perform pg_temp.as_user(c.id);
      if not p_internal then execute 'set local role authenticated'; end if;
      select * into r from pg_temp.cmp(v_ids);
      execute 'reset role';
      diff := diff + r.diff; lists := lists + 1; n := n + r.n; erp_spent := erp_spent + r.erp_spent; pmo_spent := pmo_spent + r.pmo_spent;
    end loop;
  end loop;
  return next;
end $$;
create function pg_temp.calls(p text) returns bigint language sql as $$
  select coalesce(sum(calls), 0)::bigint from pg_stat_xact_user_functions where schemaname = 'public' and funcname = p $$;
-- runs one read as a signed-in client and returns how often each named function ran during it
create function pg_temp.count_calls(p_sub uuid, p_sql text, p_fns text[]) returns bigint[] language plpgsql as $$
declare before bigint[]; after bigint[];
begin
  select array_agg(pg_temp.calls(f) order by o) into before from unnest(p_fns) with ordinality u(f, o);
  perform pg_temp.as_user(p_sub);
  execute 'set local role authenticated';
  execute p_sql;
  execute 'reset role';
  select array_agg(pg_temp.calls(f) order by o) into after from unnest(p_fns) with ordinality u(f, o);
  return array(select after[i] - before[i] from generate_subscripts(p_fns, 1) i);
end $$;
create function pg_temp.ms(p_sub uuid, p_sql text, p_times int) returns numeric language plpgsql as $$
declare t0 timestamptz;
begin
  perform pg_temp.as_user(p_sub);
  execute 'set local role authenticated';
  t0 := clock_timestamp();
  for i in 1..p_times loop execute p_sql; end loop;
  execute 'reset role';
  return round(extract(epoch from clock_timestamp() - t0) * 1000 / p_times, 1);
end $$;

-- ── the fixture reads what it should (so parity below is not vacuous) ───────────────────────────────
set local role authenticated;
select pg_temp.as_user('27890000-0000-0000-0000-0000000000a2');
select ok(public.org_reads_erp_ledger(), 'fixture: the ledger organisation reads the accounting ledger');
select ok((select count(distinct project_id) >= 7 from public.cost_attribution_org_actuals(null)),
  'fixture: rules, the equipment pool and the placed invoice attribute ledger cost to seven or more projects');
select ok((select count(distinct project_id) = 2 from public.equipment_charge_org_actuals(null)),
  'fixture: hire charges land on two projects');
select ok((select attributed_to_date > 0 from public.project_mapped_actuals_all(null)
            where project_id = '27890000-0000-0000-0000-0000000000cb' and category = 'Materials'),
  'fixture: the placed invoice counts on its project');
select pg_temp.as_user('27890000-0000-0000-0000-0000000000b1');
select ok(not public.org_reads_erp_ledger(), 'fixture: the document organisation does not read a ledger');
reset role;

-- ── parity: old body = new body, every caller, every project, every kind of list ─────────────────────
create temp table _p on commit drop as
select k.kind, m.internal, x.*
  from unnest(array['single','none','empty','all','short']) k(kind)
  cross join unnest(array[false, true]) m(internal)
  cross join lateral pg_temp.parity(k.kind, m.internal) x;
select diag(format('parity %s %s: %s lists, %s rows, %s ledger rows with spent, %s document rows with spent, %s callers, %s differing',
               kind, case when internal then 'definer' else 'client' end, lists, n, erp_spent, pmo_spent, callers, diff))
  from _p order by kind, internal;
select is((select diff from _p where kind = 'single' and not internal), 0::bigint, 'parity: one project at a time, as each caller');
select is((select diff from _p where kind = 'none' and not internal), 0::bigint, 'parity: no list (every project), as each caller');
select is((select diff from _p where kind = 'empty' and not internal), 0::bigint, 'parity: an empty list, as each caller');
select is((select diff from _p where kind = 'all' and not internal), 0::bigint, 'parity: every project of the organisation plus another organisation''s, as each caller');
select is((select diff from _p where kind = 'short' and not internal), 0::bigint, 'parity: a short list with a repeat, another organisation''s project and a null, as each caller');
select is((select diff from _p where kind = 'single' and internal), 0::bigint, 'parity: one project at a time, inside definer code');
select is((select diff from _p where kind = 'none' and internal), 0::bigint, 'parity: no list, inside definer code');
select is((select diff from _p where kind = 'empty' and internal), 0::bigint, 'parity: an empty list, inside definer code');
select is((select diff from _p where kind = 'all' and internal), 0::bigint, 'parity: every project plus another organisation''s, inside definer code');
select is((select diff from _p where kind = 'short' and internal), 0::bigint, 'parity: a short list, inside definer code');
select ok((select callers >= 50 and lists >= 600 from _p where kind = 'single' and not internal),
  'parity covered every active profile (seeded and fixture) and every project of its organisation');
select ok((select erp_spent >= 40 from _p where kind = 'single' and not internal),
  'parity compared ledger-basis rows that carry a spent figure');
select ok((select pmo_spent >= 3 from _p where kind = 'single' and not internal),
  'parity compared document-basis rows that carry a spent figure');
select ok((select bool_and(n > 0) from _p where kind in ('single','none','all','short')),
  'every parity kind compared rows');

-- ── the per-project path reads only the asked project ──────────────────────────────────────────────
set local track_functions = 'all';
select is(pg_temp.count_calls('27890000-0000-0000-0000-0000000000a2',
            'select count(*) from public.project_budget_positions(array[''27890000-0000-0000-0000-0000000000c3''::uuid])',
            array['cost_attribution_org_actuals','equipment_charge_org_actuals','project_mapped_actuals_all','project_mapped_actuals','cost_attribution_engine']),
          array[0, 0, 0, 1, 1]::bigint[],
          'one project: no organisation-wide reader runs, and the attribution engine runs once, for that project');
select is(pg_temp.count_calls('27890000-0000-0000-0000-0000000000a2',
            'select count(*) from public._ppb_0859(array[''27890000-0000-0000-0000-0000000000c3''::uuid])',
            array['cost_attribution_org_actuals','equipment_charge_org_actuals','project_mapped_actuals_all']),
          array[1, 2, 1]::bigint[],
          'one project, before: the organisation-wide actuals ran once and the organisation''s hire charges twice');
select is(pg_temp.count_calls('27890000-0000-0000-0000-0000000000a2',
            'select count(*) from public.project_budget_positions(array(select id from public.projects where org_id = ''27890000-0000-0000-0000-00000000000a'' order by id limit 11))',
            array['cost_attribution_org_actuals','project_mapped_actuals_all','cost_attribution_engine']),
          array[1, 1, 1]::bigint[],
          'eleven projects: one organisation pass, as before');
select is(pg_temp.count_calls('27890000-0000-0000-0000-0000000000a2',
            'select count(*) from public.project_budget_positions(array(select id from public.projects where org_id = ''27890000-0000-0000-0000-00000000000a'' order by id limit 10))',
            array['cost_attribution_org_actuals','project_mapped_actuals_all','cost_attribution_engine']),
          array[0, 0, 10]::bigint[],
          'ten projects: one engine pass per project, no organisation pass');
-- what each path assembles: before, the organisation's actuals for every project; after, the asked project's categories
set local role authenticated;
select pg_temp.as_user('27890000-0000-0000-0000-0000000000a2');
select ok((select count(distinct project_id) >= 12 from public.project_mapped_actuals_all(null))
          and (select count(*) = cardinality(enum_range(null::public.budget_category))
                 from public.project_mapped_actuals('27890000-0000-0000-0000-0000000000c3', null)),
  'rows assembled: the organisation pass builds every project''s categories, the per-project read only the asked project''s');
reset role;

-- ── at production's project count (134 in the organisation): parity and timings ────────────────────
insert into projects (id, org_id, name, status, currency)
select gen_random_uuid(), '27890000-0000-0000-0000-00000000000a', '2789 Z bulk ' || i, 'Ongoing Project', 'IDR' from generate_series(1, 122) i;
insert into erp_actuals_snapshot (org_id, project_id, account, fiscal_year, debit, credit, net, as_of, snapshot_id, created_at)
select org_id, id, 'Cost - ZC', '2025', 10, 0, 10, now(), '27890000-0000-0000-0000-0000000005a2', now()
  from projects where name like '2789 Z bulk%';
create function pg_temp.parity_one(p_sub uuid) returns bigint language plpgsql as $$
declare v_id uuid; d bigint := 0;
begin
  for v_id in select p.id from public.projects p where p.org_id = '27890000-0000-0000-0000-00000000000a' loop
    perform pg_temp.as_user(p_sub);
    execute 'set local role authenticated';
    d := d + (select x.diff from pg_temp.cmp(array[v_id]) x);
    execute 'reset role';
  end loop;
  return d;
end $$;
select is(pg_temp.parity_one('27890000-0000-0000-0000-0000000000a2') + pg_temp.parity_one('27890000-0000-0000-0000-0000000000a4'), 0::bigint,
  'parity at 134 projects: every project one at a time, as Finance and as a Project Manager limited to own projects');
select diag(format('ms per call at 134 projects, one project: before %s, after %s; twelve projects (organisation pass both): before %s, after %s',
  pg_temp.ms('27890000-0000-0000-0000-0000000000a2', 'select count(*) from public._ppb_0859(array[''27890000-0000-0000-0000-0000000000c1''::uuid])', 10),
  pg_temp.ms('27890000-0000-0000-0000-0000000000a2', 'select count(*) from public.project_budget_positions(array[''27890000-0000-0000-0000-0000000000c1''::uuid])', 10),
  pg_temp.ms('27890000-0000-0000-0000-0000000000a2', 'select count(*) from public._ppb_0859(array(select id from public.projects where org_id = ''27890000-0000-0000-0000-00000000000a'' order by id limit 12))', 5),
  pg_temp.ms('27890000-0000-0000-0000-0000000000a2', 'select count(*) from public.project_budget_positions(array(select id from public.projects where org_id = ''27890000-0000-0000-0000-00000000000a'' order by id limit 12))', 5)));

select * from finish();
rollback;

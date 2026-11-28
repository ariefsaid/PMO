-- 2799_pm_home_own_project_actuals.test.sql — the Project Manager home reads the by-category actuals of the caller's own projects
-- (project_mapped_actuals per project) instead of the organisation's (project_mapped_actuals_all). The 0770 body is kept below under a
-- temporary name; both bodies must return the same json for every calling role, every seeded Project Manager, a second organisation and a
-- caller with no projects, and the new body must not call the organisation-wide read.
begin;
create extension if not exists pgtap;
select plan(15);

-- the 0770 body, verbatim, under a temporary name (rolled back with the transaction)
create or replace function public.get_pm_dashboard_projects_0770()
  returns json language plpgsql stable security invoker set search_path = public
as $$
begin
  return (
  with flag as materialized (select public.org_reads_erp_ledger() as erp),  -- 0770: the ledger basis is read once, not once per project and column
  pma as materialized (select * from public.project_mapped_actuals_all(null)),  -- 0376: one org-wide actuals read
  pmo_spent as materialized (                         -- 0770: the spent position of the caller's projects in one pass, not one call per project
    select s.project_id, s.spent, s.spent_complete
      from public.project_pmo_positions(coalesce((select array_agg(x.id) from public.projects x where x.project_manager_id = auth.uid() and x.org_id = public.auth_org_id()), '{}')) s
     where not (select erp from flag)
  ),
  billed_work as (
    select si.project_id,si.currency,sum(w.net+w.recovery) as revenue,
      bool_or(w.net is null or w.recovery is null
        or w.net::text in ('NaN','Infinity','-Infinity')
        or w.recovery::text in ('NaN','Infinity','-Infinity')) as incomplete
    from public.sales_invoice_work_billed w
    join public.sales_invoices si on si.id=w.id and si.org_id=w.org_id
    where si.org_id=public.auth_org_id() and si.status in ('Submitted','Unpaid','Paid') and coalesce(si.erp_docstatus,1)<>2
      and si.erp_cancelled_at is null and not w.is_down_payment
    group by si.project_id,si.currency
  ), rows as materialized (
  select p.id,p.name,p.short_name,coalesce(nullif(btrim(c.short_name),''),c.name) as client_name,
    p.contract_value,p.currency,p.status,
    (select sum(li.budgeted_amount) from public.budget_versions v
      join public.budget_line_items li on li.budget_version_id=v.id where v.project_id=p.id and v.status='Active') as budget,
    (select v.currency from public.budget_versions v where v.project_id=p.id and v.status='Active' order by v.version desc,v.created_at desc,v.id desc limit 1) as budget_currency,
    case when (select erp from flag) then (select o.default_currency from public.organizations o where o.id=p.org_id) else p.currency end as actual_currency,
    case when not (select erp from flag) then pmo_spent.spent_complete
      -- 0381 (#1374): no Active budget → the project header's rule: every cost category mapped and read.
      when not exists (select 1 from public.budget_versions v where v.project_id=p.id and v.status='Active') then
        (select count(*) > 0 and bool_and(x.mapped and x.actuals_to_date is not null) from pma x where x.project_id=p.id)
        and coalesce(public.holds_spend_approval_authority(public.auth_role()),false)
      else
      (select count(distinct li.category) > 0 and count(distinct li.category) = count(distinct li.category) filter
        (where exists (select 1 from (select * from pma where pma.project_id=p.id) x
          where x.category=li.category and x.mapped and x.actuals_to_date is not null))
       from public.budget_versions v join public.budget_line_items li on li.budget_version_id=v.id
       where v.project_id=p.id and v.status='Active') end as actual_complete,
    case when (select erp from flag) then
      case when (select o.default_currency=p.currency from public.organizations o where o.id=p.org_id)
        then (select sum(x.actuals_to_date) from (select * from pma where pma.project_id=p.id) x where x.actuals_to_date is not null)
        else null end
      else pmo_spent.spent end as spent,
    (select erp from flag) as ledger_owned,
    case when (select erp from flag) then
      (select count(*)::int from (select * from pma where pma.project_id=p.id) x where x.mapped and x.actuals_to_date is not null)
      else 1 end as actual_coverage_count,
    case when (select erp from flag) then
      (select count(*)::int from (select * from pma where pma.project_id=p.id) x where x.mapped)
      else 1 end as actual_coverage_total,
    (select bw.revenue from billed_work bw where bw.project_id=p.id and bw.currency=p.currency) as billed_revenue,
    (coalesce((select bw.incomplete from billed_work bw where bw.project_id=p.id and bw.currency=p.currency),false)
      or exists (select 1 from billed_work bw where bw.project_id=p.id and bw.currency<>p.currency)) as billed_incomplete
  from public.projects p left join public.companies c on c.id=p.client_id
  left join pmo_spent on pmo_spent.project_id = p.id
  where p.project_manager_id=auth.uid() and p.org_id=public.auth_org_id()
  )
  select coalesce(json_agg(json_build_object(
    'id',p.id,'name',p.name,'short_name',p.short_name,'client_name',p.client_name,
    'contract_value',p.contract_value,'currency',p.currency,'status',p.status,
    'budget',p.budget,'budget_currency',p.budget_currency,'spent',p.spent,
    'actual_currency',p.actual_currency,'actual_complete',p.actual_complete,
    'actual_coverage_count',p.actual_coverage_count,'actual_coverage_total',p.actual_coverage_total,
    'realized_margin',case when p.spent is null or not p.actual_complete or p.actual_currency<>p.currency or p.billed_incomplete then null else coalesce(p.billed_revenue,0)-p.spent end,
    'realized_margin_pct',case when p.spent is null or not p.actual_complete or p.actual_currency<>p.currency or p.billed_incomplete or coalesce(p.billed_revenue,0)<=0 then null
      else (p.billed_revenue-p.spent)/p.billed_revenue end,
    'contract_remaining',case when p.spent is null or not p.actual_complete or p.actual_currency<>p.currency then null else p.contract_value-p.spent end
  ) order by p.name),'[]'::json) from rows p
  );
end $$;

insert into public.organizations (id, name, default_currency) values
  ('27990000-0000-0000-0000-00000000000a', 'Own actuals org A', 'IDR'),
  ('27990000-0000-0000-0000-00000000000b', 'Own actuals org B', 'IDR'),
  ('27990000-0000-0000-0000-00000000000c', 'Own actuals org C (document basis)', 'IDR');
insert into auth.users (id, email) values
  ('27990000-0000-0000-0000-0000000000a1', 'own-pm1@example.test'),
  ('27990000-0000-0000-0000-0000000000a2', 'own-pm2@example.test'),
  ('27990000-0000-0000-0000-0000000000a3', 'own-exec@example.test'),
  ('27990000-0000-0000-0000-0000000000a4', 'own-fin@example.test'),
  ('27990000-0000-0000-0000-0000000000a5', 'own-pm-none@example.test'),
  ('27990000-0000-0000-0000-0000000000b1', 'own-pm-b@example.test'),
  ('27990000-0000-0000-0000-0000000000c1', 'own-pm-c@example.test');
insert into public.profiles (id, org_id, full_name, email, role, status) values
  ('27990000-0000-0000-0000-0000000000a1', '27990000-0000-0000-0000-00000000000a', 'Own PM 1', 'own-pm1@example.test', 'Project Manager', 'active'),
  ('27990000-0000-0000-0000-0000000000a2', '27990000-0000-0000-0000-00000000000a', 'Own PM 2', 'own-pm2@example.test', 'Project Manager', 'active'),
  ('27990000-0000-0000-0000-0000000000a3', '27990000-0000-0000-0000-00000000000a', 'Own Exec', 'own-exec@example.test', 'Executive', 'active'),
  ('27990000-0000-0000-0000-0000000000a4', '27990000-0000-0000-0000-00000000000a', 'Own Fin', 'own-fin@example.test', 'Finance', 'active'),
  ('27990000-0000-0000-0000-0000000000a5', '27990000-0000-0000-0000-00000000000a', 'Own PM none', 'own-pm-none@example.test', 'Project Manager', 'active'),
  ('27990000-0000-0000-0000-0000000000b1', '27990000-0000-0000-0000-00000000000b', 'Own PM B', 'own-pm-b@example.test', 'Project Manager', 'active'),
  ('27990000-0000-0000-0000-0000000000c1', '27990000-0000-0000-0000-00000000000c', 'Own PM C', 'own-pm-c@example.test', 'Project Manager', 'active');
-- org A and org B read the ledger (accounting-system basis); org C stays on the document basis
insert into public.external_org_bindings (org_id, external_tier, site_url, secret_ref, status, connected_by, connected_at) values
  ('27990000-0000-0000-0000-00000000000a', 'erpnext', 'https://erp-a.example.test', 'test-ref-a', 'active', '27990000-0000-0000-0000-0000000000a3', now()),
  ('27990000-0000-0000-0000-00000000000b', 'erpnext', 'https://erp-b.example.test', 'test-ref-b', 'active', '27990000-0000-0000-0000-0000000000b1', now());
insert into public.projects (id, org_id, name, status, currency, contract_value, tax_treatment, tax_amount,
                             tax_rate, tax_base_numerator, tax_base_denominator, subject_to_vat, project_manager_id) values
  ('27990000-0000-0000-0000-0000000000d1', '27990000-0000-0000-0000-00000000000a', 'Budgeted', 'Ongoing Project', 'IDR', 9000, 'exclusive', 0, 0, 1, 1, false, '27990000-0000-0000-0000-0000000000a1'),
  ('27990000-0000-0000-0000-0000000000d2', '27990000-0000-0000-0000-00000000000a', 'Unbudgeted', 'Ongoing Project', 'IDR', 8000, 'exclusive', 0, 0, 1, 1, false, '27990000-0000-0000-0000-0000000000a1'),
  ('27990000-0000-0000-0000-0000000000d3', '27990000-0000-0000-0000-00000000000a', 'No readings', 'Ongoing Project', 'IDR', 7000, 'exclusive', 0, 0, 1, 1, false, '27990000-0000-0000-0000-0000000000a1'),
  ('27990000-0000-0000-0000-0000000000d4', '27990000-0000-0000-0000-00000000000a', 'Other PM', 'Ongoing Project', 'IDR', 6000, 'exclusive', 0, 0, 1, 1, false, '27990000-0000-0000-0000-0000000000a2'),
  ('27990000-0000-0000-0000-0000000000d5', '27990000-0000-0000-0000-00000000000a', 'Executive owned', 'Ongoing Project', 'IDR', 5000, 'exclusive', 0, 0, 1, 1, false, '27990000-0000-0000-0000-0000000000a3'),
  ('27990000-0000-0000-0000-0000000000d6', '27990000-0000-0000-0000-00000000000a', 'Finance owned', 'Ongoing Project', 'IDR', 4000, 'exclusive', 0, 0, 1, 1, false, '27990000-0000-0000-0000-0000000000a4'),
  ('27990000-0000-0000-0000-0000000000d7', '27990000-0000-0000-0000-00000000000a', 'Unmanaged', 'Ongoing Project', 'IDR', 3000, 'exclusive', 0, 0, 1, 1, false, null),
  ('27990000-0000-0000-0000-0000000000e1', '27990000-0000-0000-0000-00000000000b', 'Org B project', 'Ongoing Project', 'IDR', 2000, 'exclusive', 0, 0, 1, 1, false, '27990000-0000-0000-0000-0000000000b1'),
  ('27990000-0000-0000-0000-0000000000f1', '27990000-0000-0000-0000-00000000000c', 'Org C project', 'Ongoing Project', 'IDR', 1000, 'exclusive', 0, 0, 1, 1, false, '27990000-0000-0000-0000-0000000000c1');
insert into public.budget_versions (id, org_id, project_id, version, name, status, currency) values
  ('27990000-0000-0000-0000-0000000000b1', '27990000-0000-0000-0000-00000000000a', '27990000-0000-0000-0000-0000000000d1', 1, 'Active', 'Draft', 'IDR');
insert into public.budget_line_items (id, org_id, budget_version_id, category, description, budgeted_amount) values
  ('27990000-0000-0000-0000-0000000000c1', '27990000-0000-0000-0000-00000000000a', '27990000-0000-0000-0000-0000000000b1', 'Labor', 'Labor line', 1000);
update public.budget_versions set status = 'Active' where id = '27990000-0000-0000-0000-0000000000b1';
-- every cost category but the last is mapped in org A (so a partial map is covered); org B maps all of them
insert into public.budget_category_account_map (org_id, category, erp_account, is_push_target)
select '27990000-0000-0000-0000-00000000000a', c, '2799-' || c::text, true
  from unnest(enum_range(null::public.budget_category)) with ordinality t(c, n)
 where n < (select count(*) from unnest(enum_range(null::public.budget_category)));
insert into public.budget_category_account_map (org_id, category, erp_account, is_push_target)
select '27990000-0000-0000-0000-00000000000b', c, '2799-' || c::text, true from unnest(enum_range(null::public.budget_category)) c;
insert into public.erp_actuals_snapshot (org_id, project_id, account, fiscal_year, net, as_of, snapshot_id, created_at) values
  ('27990000-0000-0000-0000-00000000000a', '27990000-0000-0000-0000-0000000000d1', '2799-Labor', 'FY-2026', 1200, '2026-10-01', '27990000-0000-0000-0000-0000000000a9', '2026-10-02'),
  ('27990000-0000-0000-0000-00000000000a', '27990000-0000-0000-0000-0000000000d1', '2799-Labor', 'FY-2025', 40, '2026-10-01', '27990000-0000-0000-0000-0000000000a9', '2026-10-02'),
  ('27990000-0000-0000-0000-00000000000a', '27990000-0000-0000-0000-0000000000d2', '2799-Labor', 'FY-2026', 500, '2026-10-03', '27990000-0000-0000-0000-0000000000a9', '2026-10-02'),
  ('27990000-0000-0000-0000-00000000000a', '27990000-0000-0000-0000-0000000000d2', '2799-Materials', 'FY-2026', 'NaN', '2026-10-03', '27990000-0000-0000-0000-0000000000a9', '2026-10-02'),
  ('27990000-0000-0000-0000-00000000000a', '27990000-0000-0000-0000-0000000000d4', '2799-Labor', 'FY-2026', 777, '2026-10-01', '27990000-0000-0000-0000-0000000000a9', '2026-10-02'),
  ('27990000-0000-0000-0000-00000000000a', '27990000-0000-0000-0000-0000000000d5', '2799-Labor', 'FY-2026', 300, '2026-10-01', '27990000-0000-0000-0000-0000000000a9', '2026-10-02'),
  ('27990000-0000-0000-0000-00000000000a', '27990000-0000-0000-0000-0000000000d6', '2799-Labor', 'FY-2026', 200, '2026-10-01', '27990000-0000-0000-0000-0000000000a9', '2026-10-02'),
  ('27990000-0000-0000-0000-00000000000a', '27990000-0000-0000-0000-0000000000d7', '2799-Labor', 'FY-2026', 100, '2026-10-01', '27990000-0000-0000-0000-0000000000a9', '2026-10-02'),
  ('27990000-0000-0000-0000-00000000000b', '27990000-0000-0000-0000-0000000000e1', '2799-Labor', 'FY-2026', 99, '2026-10-01', '27990000-0000-0000-0000-0000000000b9', '2026-10-02');

create or replace function pg_temp.as_user(p_id text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_id, 'role', 'authenticated')::text, true);
end $$;
-- rows present in one body and not in the other, both ways, plus the order of the whole payload
create or replace function pg_temp.parity_diffs() returns bigint language sql as $$
  select (select count(*) from (
            select e from jsonb_array_elements(public.get_pm_dashboard_projects_0770()::jsonb) e
            except select e from jsonb_array_elements(public.get_pm_dashboard_projects()::jsonb) e) a)
       + (select count(*) from (
            select e from jsonb_array_elements(public.get_pm_dashboard_projects()::jsonb) e
            except select e from jsonb_array_elements(public.get_pm_dashboard_projects_0770()::jsonb) e) b)
       + (case when public.get_pm_dashboard_projects_0770()::text = public.get_pm_dashboard_projects()::text then 0 else 1 end) $$;
create temp table results(who text, diffs bigint, n int);
grant all on results to authenticated;
create or replace function pg_temp.record(p_who text, p_id text) returns void language plpgsql as $$
begin
  perform pg_temp.as_user(p_id);
  insert into results select p_who, pg_temp.parity_diffs(), json_array_length(public.get_pm_dashboard_projects());
end $$;

create or replace function pg_temp.seeded_diffs() returns bigint language plpgsql as $$
declare r record; d bigint := 0;
begin
  for r in select pr.id from public.profiles pr where pr.role = 'Project Manager' and pr.id::text not like '27990000%' order by pr.id loop
    perform pg_temp.as_user(r.id::text);
    d := d + pg_temp.parity_diffs();
  end loop;
  return d;
end $$;

-- the ledger read is no longer organisation-wide: measured first, before any parity call, on the in-transaction call counters
set local track_functions = 'all';
create or replace function pg_temp.calls(p_name text) returns bigint language sql as $$
  select coalesce((select calls from pg_stat_xact_user_functions where schemaname = 'public' and funcname = p_name), 0) $$;
select pg_temp.as_user('27990000-0000-0000-0000-0000000000a1');
create temp table counts(step text, wide bigint, per_project bigint);
grant all on counts to authenticated;

set local role authenticated;
select pg_temp.as_user('27990000-0000-0000-0000-0000000000a1');
select count(*) from json_array_elements(public.get_pm_dashboard_projects());
insert into counts select 'new body', pg_temp.calls('project_mapped_actuals_all'), pg_temp.calls('project_mapped_actuals');
select count(*) from json_array_elements(public.get_pm_dashboard_projects_0770());
insert into counts select 'old body added', pg_temp.calls('project_mapped_actuals_all'), pg_temp.calls('project_mapped_actuals');

select pg_temp.record('pm1 (three projects, ledger basis)', '27990000-0000-0000-0000-0000000000a1');
select pg_temp.record('pm2', '27990000-0000-0000-0000-0000000000a2');
select pg_temp.record('executive owning a project', '27990000-0000-0000-0000-0000000000a3');
select pg_temp.record('finance owning a project', '27990000-0000-0000-0000-0000000000a4');
select pg_temp.record('pm without projects', '27990000-0000-0000-0000-0000000000a5');
select pg_temp.record('org B pm', '27990000-0000-0000-0000-0000000000b1');
select pg_temp.record('org C pm (document basis)', '27990000-0000-0000-0000-0000000000c1');

select is((select diffs from results where who like 'pm1%'), 0::bigint, 'pm1: both bodies return the same rows, in the same order');
select is((select n from results where who like 'pm1%'), 3, 'pm1: the home still lists exactly the three own projects');
select is((select diffs from results where who = 'pm2'), 0::bigint, 'pm2: same rows both ways');
select is((select diffs from results where who like 'executive%'), 0::bigint, 'executive owning a project: same rows both ways');
select is((select diffs from results where who like 'finance%'), 0::bigint, 'finance owning a project: same rows both ways');
select is((select n from results where who like 'pm without%'), 0, 'a caller with no projects gets an empty list');
select is((select diffs from results where who like 'pm without%'), 0::bigint, 'a caller with no projects: empty both ways');
select is((select diffs from results where who like 'org B%'), 0::bigint, 'org B pm: same rows both ways');
select is((select diffs from results where who like 'org C%'), 0::bigint, 'org C pm on the document basis: same rows both ways');

-- the figures compared are real: the ledger rows of the budgeted project (1200 + 40) arrive as its spent, the unbudgeted one carries the unreadable category
select pg_temp.as_user('27990000-0000-0000-0000-0000000000a1');
select is((select (e->>'spent')::numeric from json_array_elements(public.get_pm_dashboard_projects()) e where e->>'name' = 'Budgeted'), 1240::numeric,
  'pm1: the budgeted project spent is the ledger total of its mapped accounts');

-- another organisation's caller never receives org A projects
select pg_temp.as_user('27990000-0000-0000-0000-0000000000b1');
select is((select count(*)::int from json_array_elements(public.get_pm_dashboard_projects()) e where e->>'name' <> 'Org B project'), 0,
  'org B pm sees only the org B project');

-- every seeded Project Manager (none when the database has no seed rows)
select is(pg_temp.seeded_diffs(), 0::bigint, 'every seeded project manager: same rows both ways');

select is((select wide from counts where step = 'new body'), 0::bigint, 'the new body never reads the organisation-wide actuals');
select is((select per_project from counts where step = 'new body'), 3::bigint, 'the new body reads the actuals once per own project (3)');
select is((select wide from counts where step = 'old body added'), 1::bigint, 'the 0770 body read the organisation-wide actuals once');

select * from finish();
rollback;

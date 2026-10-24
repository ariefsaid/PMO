-- cost_attribution.test.sql — 0376 (#1271). Owns AC-CAT-001..013 (docs/specs/cost-attribution.spec.md).
-- Mutation checks (each must go red): in cost_attribution_allocations drop `coalesce(l.project,'') = ''`
-- (AC-CAT-007 + AC-CAT-010 rows), or flip `ra.specificity desc` to `asc` (AC-CAT-008 rows); in
-- cost_attribution_assert_no_conflict replace the conflict query with `where false` (AC-CAT-009 rows); in
-- cost_attribution_project_actuals drop the Employee-party condition (AC-CAT-016 Engineer rows).
begin;
create extension if not exists pgtap;
select plan(97);

-- ── fixtures ────────────────────────────────────────────────────────────────────────────────────────
insert into organizations (id, name, default_currency) values
  ('03760000-0000-0000-0000-00000000000a','CA A','IDR'), ('03760000-0000-0000-0000-00000000000b','CA B','IDR');
insert into auth.users (id, email) values
  ('03760000-0000-0000-0000-0000000000a1','ca-fin@example.com'),  ('03760000-0000-0000-0000-0000000000a2','ca-admin@example.com'),
  ('03760000-0000-0000-0000-0000000000a3','ca-pm@example.com'),   ('03760000-0000-0000-0000-0000000000a4','ca-exec@example.com'),
  ('03760000-0000-0000-0000-0000000000a5','ca-eng@example.com'),  ('03760000-0000-0000-0000-0000000000a6','ca-gone@example.com'),
  ('03760000-0000-0000-0000-0000000000b1','ca-b@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('03760000-0000-0000-0000-0000000000a1','03760000-0000-0000-0000-00000000000a','Fin','ca-fin@example.com','Finance','active'),
  ('03760000-0000-0000-0000-0000000000a2','03760000-0000-0000-0000-00000000000a','Admin','ca-admin@example.com','Admin','active'),
  ('03760000-0000-0000-0000-0000000000a3','03760000-0000-0000-0000-00000000000a','PM','ca-pm@example.com','Project Manager','active'),
  ('03760000-0000-0000-0000-0000000000a4','03760000-0000-0000-0000-00000000000a','Exec','ca-exec@example.com','Executive','active'),
  ('03760000-0000-0000-0000-0000000000a5','03760000-0000-0000-0000-00000000000a','Eng','ca-eng@example.com','Engineer','active'),
  ('03760000-0000-0000-0000-0000000000a6','03760000-0000-0000-0000-00000000000a','Gone','ca-gone@example.com','Finance','disabled'),
  ('03760000-0000-0000-0000-0000000000b1','03760000-0000-0000-0000-00000000000b','B Fin','ca-b@example.com','Finance','active');
insert into projects (id, org_id, name, status) values
  ('03760000-0000-0000-0000-0000000000c1','03760000-0000-0000-0000-00000000000a','Anchor','Ongoing Project'),
  ('03760000-0000-0000-0000-0000000000c2','03760000-0000-0000-0000-00000000000a','Second','Ongoing Project'),
  ('03760000-0000-0000-0000-0000000000c3','03760000-0000-0000-0000-00000000000a','Third','Ongoing Project'),
  ('03760000-0000-0000-0000-0000000000cb','03760000-0000-0000-0000-00000000000b','B project','Ongoing Project');

-- chart: Payroll group {Salary, Bonus}; Rent; Office group {Utilities}
insert into erp_account_mirror (org_id, company, erp_name, account_name, root_type, report_type, parent_account, is_group, account_currency, lft, rgt, refresh_id) values
  ('03760000-0000-0000-0000-00000000000a','RIS','Payroll - RIS','Payroll','Expense','Profit and Loss',null,true,'IDR',1,6,'03760000-0000-0000-0000-0000000000f0'),
  ('03760000-0000-0000-0000-00000000000a','RIS','Salary - RIS','Salary','Expense','Profit and Loss','Payroll - RIS',false,'IDR',2,3,'03760000-0000-0000-0000-0000000000f0'),
  ('03760000-0000-0000-0000-00000000000a','RIS','Bonus - RIS','Bonus','Expense','Profit and Loss','Payroll - RIS',false,'IDR',4,5,'03760000-0000-0000-0000-0000000000f0'),
  ('03760000-0000-0000-0000-00000000000a','RIS','Rent - RIS','Rent','Expense','Profit and Loss',null,false,'IDR',7,8,'03760000-0000-0000-0000-0000000000f0'),
  ('03760000-0000-0000-0000-00000000000a','RIS','Office - RIS','Office','Expense','Profit and Loss',null,true,'IDR',9,12,'03760000-0000-0000-0000-0000000000f0'),
  ('03760000-0000-0000-0000-00000000000a','RIS','Utilities - RIS','Utilities','Expense','Profit and Loss','Office - RIS',false,'IDR',10,11,'03760000-0000-0000-0000-0000000000f0');
insert into budget_category_account_map (org_id, category, erp_account, is_push_target) values
  ('03760000-0000-0000-0000-00000000000a','Labor','Salary - RIS',true),
  ('03760000-0000-0000-0000-00000000000a','Labor','Bonus - RIS',false),
  ('03760000-0000-0000-0000-00000000000a','Overheads','Rent - RIS',true),
  ('03760000-0000-0000-0000-00000000000a','Overheads','Utilities - RIS',false);

insert into erp_gl_entry_mirror (id, org_id, erp_name, company, account, cost_center, fiscal_year, project, party_type, party, posting_date, debit, credit, is_cancelled, erp_modified) values
  ('03760000-0000-0000-0000-0000000001a1','03760000-0000-0000-0000-00000000000a','GL-1','RIS','Salary - RIS','Eng - RIS','2025',null,null,null,'2025-01-15',1000,0,false,'1'),
  ('03760000-0000-0000-0000-0000000001a2','03760000-0000-0000-0000-00000000000a','GL-2','RIS','Salary - RIS','Admin - RIS','2025',null,'Employee','EMP-2','2025-02-15',500,0,false,'1'),
  ('03760000-0000-0000-0000-0000000001a3','03760000-0000-0000-0000-00000000000a','GL-3','RIS','Salary - RIS','Eng - RIS','2025','PRJ-1',null,null,'2025-01-20',300,0,false,'1'),
  ('03760000-0000-0000-0000-0000000001a4','03760000-0000-0000-0000-00000000000a','GL-4','RIS','Bonus - RIS',null,'2025',null,null,null,'2025-03-10',200,0,false,'1'),
  ('03760000-0000-0000-0000-0000000001a5','03760000-0000-0000-0000-00000000000a','GL-5','RIS','Rent - RIS',null,'2025',null,null,null,'2025-01-05',400,0,false,'1'),
  ('03760000-0000-0000-0000-0000000001a6','03760000-0000-0000-0000-00000000000a','GL-6','RIS','Salary - RIS','Eng - RIS','2024',null,null,null,'2024-12-31',700,0,false,'1'),
  ('03760000-0000-0000-0000-0000000001a7','03760000-0000-0000-0000-00000000000a','GL-7','RIS','Salary - RIS','Eng - RIS','2025',null,null,null,'2025-01-16',9999,0,true,'1'),
  ('03760000-0000-0000-0000-0000000001a8','03760000-0000-0000-0000-00000000000a','GL-8','RIS','Utilities - RIS',null,'2025',null,null,null,'2025-04-01',100,0,false,'1'),
  ('03760000-0000-0000-0000-0000000001a9','03760000-0000-0000-0000-00000000000a','GL-9','RIS','Salary - RIS','Eng - RIS','2025','',null,null,'2025-05-01',100,0,false,'1'),
  ('03760000-0000-0000-0000-0000000001b1','03760000-0000-0000-0000-00000000000b','GL-1','RIS','Salary - RIS',null,'2025',null,null,null,'2025-01-15',5000,0,false,'1');
-- the tagged line GL-3 is in the snapshot under the anchor project
insert into erp_actuals_snapshot (org_id, project_id, cost_center, account, fiscal_year, debit, credit, net, snapshot_id) values
  ('03760000-0000-0000-0000-00000000000a','03760000-0000-0000-0000-0000000000c1','Eng - RIS','Salary - RIS','2025',300,0,300,'03760000-0000-0000-0000-0000000000e1');

create temp table _ca (k text primary key, v text) on commit drop;
grant all on _ca to authenticated;
insert into _ca values
  ('gl_count', (select count(*)::text from erp_gl_entry_mirror)),
  ('snap_count', (select count(*)::text from erp_actuals_snapshot));

create or replace function pg_temp.as_user(p_sub text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub',p_sub,'role','authenticated')::text, true); $$;
-- attributed / tagged / total for one project+category, read through the public actuals read
create or replace function pg_temp.attr(p_project text, p_cat text) returns numeric language sql as $$
  select attributed_to_date from public.project_mapped_actuals(p_project::uuid, null) where category::text = p_cat $$;
create or replace function pg_temp.tagged(p_project text, p_cat text) returns numeric language sql as $$
  select tagged_to_date from public.project_mapped_actuals(p_project::uuid, null) where category::text = p_cat $$;
create or replace function pg_temp.total(p_project text, p_cat text) returns numeric language sql as $$
  select actuals_to_date from public.project_mapped_actuals(p_project::uuid, null) where category::text = p_cat $$;

-- ── AC-CAT-012 preview, then AC-CAT-001 save (account rule to the anchor) ─────────────────────────────
set local role authenticated;
select pg_temp.as_user('03760000-0000-0000-0000-0000000000a1');
select is((select sum(amount) from preview_cost_attribution('{"name":"Salary to anchor","account":"Salary - RIS","effective_from":"2025-01-01",
  "targets":[{"project_id":"03760000-0000-0000-0000-0000000000c1","percent":100}]}'::jsonb)), 1600::numeric,
  'AC-CAT-012 preview: GL-1 + GL-2 + GL-9 (empty-string project), not the tagged, cancelled or pre-window lines');
select is((select array_agg(month::text || ':' || amount::text order by month) from preview_cost_attribution('{"name":"Salary to anchor","account":"Salary - RIS","effective_from":"2025-01-01",
  "targets":[{"project_id":"03760000-0000-0000-0000-0000000000c1","percent":100}]}'::jsonb)),
  array['2025-01-01:1000.00','2025-02-01:500.00','2025-05-01:100.00'], 'AC-CAT-012 preview is per month');
select is((select array_agg(distinct category::text) from preview_cost_attribution('{"name":"Salary to anchor","account":"Salary - RIS","effective_from":"2025-01-01",
  "targets":[{"project_id":"03760000-0000-0000-0000-0000000000c1","percent":100}]}'::jsonb)), array['Labor'], 'AC-CAT-012 preview names the mapped category');
insert into _ca select 'r1', save_cost_attribution_rule('{"name":"Salary to anchor","account":"Salary - RIS","effective_from":"2025-01-01",
  "targets":[{"project_id":"03760000-0000-0000-0000-0000000000c1","percent":100}]}'::jsonb)::text;
select is((select (v::jsonb)->>'version' from _ca where k='r1'), '1', 'AC-CAT-001 a new rule is version 1');
select is(pg_temp.attr('03760000-0000-0000-0000-0000000000c1','Labor'), 1600::numeric, 'AC-CAT-001 the anchor carries the attributed salary');
select is(pg_temp.tagged('03760000-0000-0000-0000-0000000000c1','Labor'), 300::numeric, 'AC-CAT-006 tagged cost keeps its own figure');
select is(pg_temp.total('03760000-0000-0000-0000-0000000000c1','Labor'), 1900::numeric, 'AC-CAT-006 actuals_to_date = tagged + attributed');
select is((select source_sum from project_mapped_actuals('03760000-0000-0000-0000-0000000000c1', null) where category='Labor'), 1900::numeric,
  'AC-CAT-006 source_sum (the budget-vs-actual figure) includes attributed cost');
select is((select actuals_to_date from get_budget_projection('03760000-0000-0000-0000-0000000000c1','2025') where category='Labor'), 1900::numeric,
  'AC-CAT-006 budget vs actual counts attributed cost');
select is(pg_temp.attr('03760000-0000-0000-0000-0000000000c1','Overheads'), 0::numeric, 'AC-CAT-001 an account with no rule is not attributed (rent)');
select is((get_project_finances('03760000-0000-0000-0000-0000000000c1')->'actuals'->>'attributed_total')::numeric, 1600::numeric,
  'AC-CAT-006 project finances state the attributed total');
select is((get_project_finances('03760000-0000-0000-0000-0000000000c1')->'actuals'->>'tagged_total')::numeric, 300::numeric,
  'AC-CAT-006 project finances state the tagged total');
select is((get_project_finances('03760000-0000-0000-0000-0000000000c1')->'actuals'->>'total')::numeric, 1900::numeric,
  'AC-CAT-006 project finances total = tagged + attributed');
select is((select (c->>'attributed_amount')::numeric from jsonb_array_elements(get_project_finances('03760000-0000-0000-0000-0000000000c1')->'actuals'->'categories') c
  where c->>'category' = 'Labor'), 1600::numeric, 'AC-CAT-006 the category drill-down carries attributed_amount');
select is((select (c->>'tagged_amount')::numeric from jsonb_array_elements(get_project_finances('03760000-0000-0000-0000-0000000000c1')->'actuals'->'categories') c
  where c->>'category' = 'Labor'), 300::numeric, 'AC-CAT-006 the category drill-down carries tagged_amount');
reset role;
select ok(not exists (select 1 from cost_attribution_allocations('03760000-0000-0000-0000-00000000000a', null, null)
  where gl_id = '03760000-0000-0000-0000-0000000001a3'), 'AC-CAT-007 the ERP-project-tagged line is never attributed');
select ok(not exists (select 1 from cost_attribution_allocations('03760000-0000-0000-0000-00000000000a', null, null)
  where gl_id = '03760000-0000-0000-0000-0000000001a7'), 'AC-CAT-001 a cancelled line is never attributed');
select ok(not exists (select 1 from cost_attribution_allocations('03760000-0000-0000-0000-00000000000a', null, null)
  where gl_id = '03760000-0000-0000-0000-0000000001a6'), 'AC-CAT-004 a line before effective_from is not attributed');

-- ── AC-CAT-002/003 group rule split 60/40; AC-CAT-008 account beats group ────────────────────────────
set local role authenticated;
select pg_temp.as_user('03760000-0000-0000-0000-0000000000a1');
insert into _ca select 'r2', save_cost_attribution_rule('{"name":"Payroll split","account_group":"Payroll - RIS","effective_from":"2025-01-01",
  "targets":[{"project_id":"03760000-0000-0000-0000-0000000000c2","percent":60},{"project_id":"03760000-0000-0000-0000-0000000000c3","percent":40}]}'::jsonb)::text;
select is(pg_temp.attr('03760000-0000-0000-0000-0000000000c2','Labor'), 120::numeric, 'AC-CAT-002 a group rule reaches a descendant account (bonus 60%)');
select is(pg_temp.attr('03760000-0000-0000-0000-0000000000c3','Labor'), 80::numeric, 'AC-CAT-003 the split sends 40% to the second target');
select is(pg_temp.attr('03760000-0000-0000-0000-0000000000c1','Labor'), 1600::numeric, 'AC-CAT-008 the account rule beats the group rule for salary');
select is(pg_temp.attr('03760000-0000-0000-0000-0000000000c2','Overheads'), 0::numeric, 'AC-CAT-002 an account outside the group is not reached');

-- ── AC-CAT-008 cost-centre narrowing beats account; preview equals save ──────────────────────────────
create temp table _pv as select * from preview_cost_attribution('{"name":"Admin salary","account":"Salary - RIS","cost_center":"Admin - RIS","effective_from":"2025-01-01",
  "targets":[{"project_id":"03760000-0000-0000-0000-0000000000c2","percent":100}]}'::jsonb);
insert into _ca select 'r3', save_cost_attribution_rule('{"name":"Admin salary","account":"Salary - RIS","cost_center":"Admin - RIS","effective_from":"2025-01-01",
  "targets":[{"project_id":"03760000-0000-0000-0000-0000000000c2","percent":100}]}'::jsonb)::text;
select is(pg_temp.attr('03760000-0000-0000-0000-0000000000c1','Labor'), 1100::numeric, 'AC-CAT-008 the cost-centre rule takes GL-2 away from the account rule');
select is(pg_temp.attr('03760000-0000-0000-0000-0000000000c2','Labor'), 620::numeric, 'AC-CAT-008 the second project gets GL-2 plus its bonus share');
reset role;
select is((select array_agg(project_id::text || '|' || month::text || '|' || amount::text || '|' || line_count::text order by project_id, month) from _pv),
  (select array_agg(project_id::text || '|' || m::text || '|' || s::text || '|' || n::text order by project_id, m) from (
     select project_id, date_trunc('month', posting_date)::date as m, sum(amount) as s, count(*) as n
       from cost_attribution_allocations('03760000-0000-0000-0000-00000000000a', null, null)
      where rule_key = (select ((v::jsonb)->>'rule_key')::uuid from _ca where k='r3') group by 1,2) x),
  'AC-CAT-012 preview equals what the saved rule produces, per project and month');
select is((select count(*)::int from _pv), 1, 'AC-CAT-012 the preview had exactly the one cost-centre line');

-- ── AC-CAT-009 ties refused at save (and preview) ─────────────────────────────────────────────────────
set local role authenticated;
select pg_temp.as_user('03760000-0000-0000-0000-0000000000a1');
select throws_ok($$ select save_cost_attribution_rule('{"name":"Salary again","account":"Salary - RIS","effective_from":"2025-06-01",
  "targets":[{"project_id":"03760000-0000-0000-0000-0000000000c3","percent":100}]}'::jsonb) $$, '23505', null,
  'AC-CAT-009 a second account rule on the same account with an overlapping window is refused');
select throws_ok($$ select save_cost_attribution_rule('{"name":"Employee salary","account":"Salary - RIS","party_type":"Employee","party":"EMP-2","effective_from":"2025-01-01",
  "targets":[{"project_id":"03760000-0000-0000-0000-0000000000c3","percent":100}]}'::jsonb) $$, '23505', null,
  'AC-CAT-009 a party rule tying a cost-centre rule (same score, both could match one line) is refused');
select throws_ok($$ select save_cost_attribution_rule('{"name":"Payroll again","account_group":"Payroll - RIS","effective_from":"2024-01-01","effective_to":"2025-01-31",
  "targets":[{"project_id":"03760000-0000-0000-0000-0000000000c1","percent":100}]}'::jsonb) $$, '23505', null,
  'AC-CAT-009 a second rule on the same group with an overlapping window is refused');
select throws_ok($$ select * from preview_cost_attribution('{"name":"Salary again","account":"Salary - RIS","effective_from":"2025-06-01",
  "targets":[{"project_id":"03760000-0000-0000-0000-0000000000c3","percent":100}]}'::jsonb) $$, '23505', null,
  'AC-CAT-009 preview refuses the same tie as save');
select lives_ok($$ select save_cost_attribution_rule('{"name":"Old salary","account":"Salary - RIS","effective_from":"2020-01-01","effective_to":"2024-12-31",
  "targets":[{"project_id":"03760000-0000-0000-0000-0000000000c3","percent":100}]}'::jsonb) $$,
  'AC-CAT-009 the same account in a non-overlapping window is allowed');
select is(pg_temp.attr('03760000-0000-0000-0000-0000000000c3','Labor'), 780::numeric, 'AC-CAT-004 the old-window rule takes only the 2024 line (700) on top of the bonus share');

-- ── AC-CAT-003 split validation and cent rounding (saved by Admin) ───────────────────────────────────
select throws_ok($$ select save_cost_attribution_rule('{"name":"Bad split","account":"Utilities - RIS","effective_from":"2025-01-01",
  "targets":[{"project_id":"03760000-0000-0000-0000-0000000000c1","percent":60},{"project_id":"03760000-0000-0000-0000-0000000000c2","percent":30}]}'::jsonb) $$,
  '22023', null, 'AC-CAT-003 a split that does not total 100 is refused');
select throws_ok($$ select save_cost_attribution_rule('{"name":"Dup split","account":"Utilities - RIS","effective_from":"2025-01-01",
  "targets":[{"project_id":"03760000-0000-0000-0000-0000000000c1","percent":50},{"project_id":"03760000-0000-0000-0000-0000000000c1","percent":50}]}'::jsonb) $$,
  '22023', null, 'AC-CAT-003 the same project twice is refused');
select throws_ok($$ select save_cost_attribution_rule('{"name":"No match","effective_from":"2025-01-01",
  "targets":[{"project_id":"03760000-0000-0000-0000-0000000000c1","percent":100}]}'::jsonb) $$,
  '22023', null, 'AC-CAT-001 a rule must name an account or an account group');
select throws_ok($$ select save_cost_attribution_rule('{"name":"Both","account":"Rent - RIS","account_group":"Office - RIS","effective_from":"2025-01-01",
  "targets":[{"project_id":"03760000-0000-0000-0000-0000000000c1","percent":100}]}'::jsonb) $$,
  '22023', null, 'AC-CAT-001 a rule cannot name both an account and a group');
select throws_ok($$ select save_cost_attribution_rule('{"name":"Ghost","account":"Nope - RIS","effective_from":"2025-01-01",
  "targets":[{"project_id":"03760000-0000-0000-0000-0000000000c1","percent":100}]}'::jsonb) $$,
  'P0002', null, 'AC-CAT-001 an unknown account is refused');
select throws_ok($$ select save_cost_attribution_rule('{"name":"Leaf as group","account_group":"Rent - RIS","effective_from":"2025-01-01",
  "targets":[{"project_id":"03760000-0000-0000-0000-0000000000c1","percent":100}]}'::jsonb) $$,
  'P0002', null, 'AC-CAT-002 a non-group account is refused as a group');
select throws_ok($$ select save_cost_attribution_rule('{"name":"Backwards","account":"Rent - RIS","effective_from":"2025-01-10","effective_to":"2025-01-01",
  "targets":[{"project_id":"03760000-0000-0000-0000-0000000000c1","percent":100}]}'::jsonb) $$,
  '22023', null, 'AC-CAT-004 an end date more than a day before the start is refused');
select pg_temp.as_user('03760000-0000-0000-0000-0000000000a2');
select lives_ok($$ select save_cost_attribution_rule('{"name":"Office thirds","account_group":"Office - RIS","effective_from":"2025-01-01",
  "targets":[{"project_id":"03760000-0000-0000-0000-0000000000c1","percent":33.3333},{"project_id":"03760000-0000-0000-0000-0000000000c2","percent":33.3333},
             {"project_id":"03760000-0000-0000-0000-0000000000c3","percent":33.3334}]}'::jsonb) $$, 'AC-CAT-011 Admin saves a rule');
select is(array[pg_temp.attr('03760000-0000-0000-0000-0000000000c1','Overheads'), pg_temp.attr('03760000-0000-0000-0000-0000000000c2','Overheads'),
  pg_temp.attr('03760000-0000-0000-0000-0000000000c3','Overheads')], array[33.33, 33.33, 33.34]::numeric[],
  'AC-CAT-003 a three-way split rounds to the cent, the last target takes the remainder');

-- ── AC-CAT-010 company-wide tagged + attributed never exceeds the ledger for the matched accounts ────
select pg_temp.as_user('03760000-0000-0000-0000-0000000000a1');
select ok((select sum(actuals_to_date) from (select x.actuals_to_date from projects p
     cross join lateral project_mapped_actuals(p.id, null) x where x.actuals_to_date is not null) s)
  <= (select sum(debit - credit) from erp_gl_entry_mirror where not is_cancelled
       and account in ('Salary - RIS','Bonus - RIS','Utilities - RIS')),
  'AC-CAT-010 tagged + attributed across all projects never exceeds the ledger total for the matched accounts');
select is((select sum(actuals_to_date) from (select x.actuals_to_date from projects p
     cross join lateral project_mapped_actuals(p.id, null) x where x.actuals_to_date is not null) s),
  (select sum(debit - credit) from erp_gl_entry_mirror where not is_cancelled
       and account in ('Salary - RIS','Bonus - RIS','Utilities - RIS')),
  'AC-CAT-010 here every matched line is placed exactly once, so the two are equal');

-- ── AC-CAT-005 versioning and audit ──────────────────────────────────────────────────────────────────
select is((save_cost_attribution_rule(jsonb_build_object('rule_key', (select (v::jsonb)->>'rule_key' from _ca where k='r1'), 'expected_version', 1,
  'name','Salary to anchor','account','Salary - RIS','effective_from','2025-01-01',
  'targets', jsonb_build_array(jsonb_build_object('project_id','03760000-0000-0000-0000-0000000000c1','percent',50),
                               jsonb_build_object('project_id','03760000-0000-0000-0000-0000000000c3','percent',50)))))->>'version', '2',
  'AC-CAT-005 editing a rule creates version 2');
select is(pg_temp.attr('03760000-0000-0000-0000-0000000000c1','Labor'), 550::numeric, 'AC-CAT-005 the new version applies (anchor 50% of 1100)');
select throws_ok(format($$ select save_cost_attribution_rule('{"rule_key":"%s","expected_version":1,"name":"Salary to anchor","account":"Salary - RIS",
  "effective_from":"2025-01-01","targets":[{"project_id":"03760000-0000-0000-0000-0000000000c1","percent":100}]}'::jsonb) $$,
  (select (v::jsonb)->>'rule_key' from _ca where k='r1')), '40001', null, 'AC-CAT-005 a save from a stale version is refused');
select is((save_cost_attribution_rule(jsonb_build_object('rule_key', (select (v::jsonb)->>'rule_key' from _ca where k='r1'), 'expected_version', 2,
  'name','Salary to anchor','account','Salary - RIS','effective_from','2025-01-01',
  'targets', jsonb_build_array(jsonb_build_object('project_id','03760000-0000-0000-0000-0000000000c1','percent',50),
                               jsonb_build_object('project_id','03760000-0000-0000-0000-0000000000c3','percent',50.0)))))->>'changed', 'false',
  'AC-CAT-005 an identical save makes no new version');
select is((select array_agg(version::text || ':' || is_current::text order by version) from list_cost_attribution_rules(true)
  where rule_key = (select ((v::jsonb)->>'rule_key')::uuid from _ca where k='r1')), array['1:false','2:true'],
  'AC-CAT-005 history keeps version 1 readable and marks version 2 current');
select is((select count(*)::int from list_cost_attribution_rules()), 5, 'AC-CAT-005 the default list shows current versions only');
select is((select (targets->0->>'project_name') from list_cost_attribution_rules() where name = 'Admin salary'), 'Second', 'list names the target project');
-- end the group rule at 2025-02-28: the March bonus leaves the second and third projects
select is((end_cost_attribution_rule((select ((v::jsonb)->>'rule_key')::uuid from _ca where k='r2'), '2025-02-28', 1))->>'version', '2',
  'AC-CAT-005 ending a rule creates a new version');
select is(pg_temp.attr('03760000-0000-0000-0000-0000000000c3','Labor'), 1250::numeric, 'AC-CAT-004 after the end date the bonus is no longer attributed (550 + 700)');
select is((select effective_to::text from list_cost_attribution_rules() where name = 'Payroll split'), '2025-02-28', 'AC-CAT-005 the list shows the end date');
reset role;
select is((select count(*)::int from audit_events where org_id = '03760000-0000-0000-0000-00000000000a' and action like 'cost_attribution.%'), 7,
  'AC-CAT-005 every create, edit and end is audited once (5 creates, 1 edit, 1 end; the no-op is not)');
select is((select detail #>> '{before,targets,0,percent}' from audit_events where action = 'cost_attribution.update'), '100.0000', 'AC-CAT-005 audit keeps the before image');
select is((select detail #>> '{after,targets,0,percent}' from audit_events where action = 'cost_attribution.update'), '50.0000', 'AC-CAT-005 audit keeps the after image');
select is((select actor_id::text from audit_events where action = 'cost_attribution.end'), '03760000-0000-0000-0000-0000000000a1', 'AC-CAT-005 audit names who');

-- ── AC-CAT-011 roles and tenancy ─────────────────────────────────────────────────────────────────────
select set_config('ca.save', $$ select save_cost_attribution_rule('{"name":"Rent","account":"Rent - RIS","effective_from":"2025-01-01",
  "targets":[{"project_id":"03760000-0000-0000-0000-0000000000c1","percent":100}]}'::jsonb) $$, true);
select set_config('ca.preview', $$ select * from preview_cost_attribution('{"name":"Rent","account":"Rent - RIS","effective_from":"2025-01-01",
  "targets":[{"project_id":"03760000-0000-0000-0000-0000000000c1","percent":100}]}'::jsonb) $$, true);
set local role authenticated;
select pg_temp.as_user('03760000-0000-0000-0000-0000000000a3');
select throws_ok(current_setting('ca.save'), '42501', null, 'AC-CAT-011 a Project Manager cannot save');
select throws_ok(current_setting('ca.preview'), '42501', null, 'AC-CAT-011 a Project Manager cannot preview');
select is((select count(*)::int from list_cost_attribution_rules()), 5, 'AC-CAT-011 a Project Manager reads the rules');
select pg_temp.as_user('03760000-0000-0000-0000-0000000000a4');
select throws_ok(current_setting('ca.save'), '42501', null, 'AC-CAT-011 an Executive cannot save');
select is((select count(*)::int from cost_attribution_rules where is_current), 5, 'AC-CAT-011 an Executive reads the rules table');
select pg_temp.as_user('03760000-0000-0000-0000-0000000000a5');
select throws_ok(current_setting('ca.save'), '42501', null, 'AC-CAT-011 an Engineer cannot save');
select throws_ok('select * from list_cost_attribution_rules()', '42501', null, 'AC-CAT-011 an Engineer cannot list');
select is((select count(*)::int from cost_attribution_rules) + (select count(*)::int from cost_attribution_rule_targets), 0, 'AC-CAT-011 an Engineer reads no rule rows');
select pg_temp.as_user('03760000-0000-0000-0000-0000000000a6');
select throws_ok(current_setting('ca.save'), null, null, 'AC-CAT-011 a disabled Finance member cannot save');
select pg_temp.as_user('03760000-0000-0000-0000-0000000000a1');
select throws_ok($$ insert into cost_attribution_rules (rule_key, version, name, match_account, effective_from, specificity)
  values (gen_random_uuid(), 1, 'x', 'Rent - RIS', '2025-01-01', 2) $$, '42501', null, 'AC-CAT-011 no direct insert into the rule table');
select throws_ok($$ update cost_attribution_rule_targets set percent = 1 $$, '42501', null, 'AC-CAT-011 no direct update of the targets table');
select pg_temp.as_user('03760000-0000-0000-0000-0000000000b1');
select is((select count(*)::int from list_cost_attribution_rules(true)), 0, 'AC-CAT-011 another org sees none of the rules');
select throws_ok($$ select save_cost_attribution_rule('{"name":"Steal","account":"Salary - RIS","effective_from":"2025-01-01",
  "targets":[{"project_id":"03760000-0000-0000-0000-0000000000c1","percent":100}]}'::jsonb) $$, 'P0002', null,
  'AC-CAT-011 another org cannot target a foreign project');
select is((select attributed_to_date from project_mapped_actuals('03760000-0000-0000-0000-0000000000c1', null) where category = 'Labor'), null::numeric,
  'AC-CAT-011 another org reads nothing for a foreign project');
reset role;

-- ── AC-CAT-001 read-side only ────────────────────────────────────────────────────────────────────────
select is((select count(*)::text from erp_gl_entry_mirror), (select v from _ca where k='gl_count'), 'AC-CAT-001 no ledger mirror row was written');
select is((select count(*)::text from erp_actuals_snapshot), (select v from _ca where k='snap_count'), 'AC-CAT-001 no snapshot row was written');

-- ── AC-CAT-016 an Employee party's pay is hidden below spend-approval rank (0270 §5b narrowing) ──────────
insert into erp_gl_entry_mirror (id, org_id, erp_name, company, account, cost_center, fiscal_year, project, party_type, party, posting_date, debit, credit, is_cancelled, erp_modified) values
  ('03760000-0000-0000-0000-0000000001c0','03760000-0000-0000-0000-00000000000a','GL-10','RIS','Bonus - RIS',null,'2025',null,'Employee','EMP-9','2025-06-01',300,0,false,'1');
set local role authenticated;
select pg_temp.as_user('03760000-0000-0000-0000-0000000000a1');
select lives_ok($$ select save_cost_attribution_rule('{"name":"EMP-9 bonus","account":"Bonus - RIS","party_type":"Employee","party":"EMP-9","effective_from":"2025-01-01",
  "targets":[{"project_id":"03760000-0000-0000-0000-0000000000c2","percent":100}]}'::jsonb) $$, 'AC-CAT-016 Finance saves an Employee-party rule');
select is(pg_temp.attr('03760000-0000-0000-0000-0000000000c2','Labor'), 800::numeric, 'AC-CAT-016 Finance sees both Employee-party lines (GL-2 500 + GL-10 300)');
select pg_temp.as_user('03760000-0000-0000-0000-0000000000a4');
select is(pg_temp.attr('03760000-0000-0000-0000-0000000000c2','Labor'), 800::numeric, 'AC-CAT-016 an Executive sees them');
select pg_temp.as_user('03760000-0000-0000-0000-0000000000a3');
select is((get_project_finances('03760000-0000-0000-0000-0000000000c2')->'actuals'->>'attributed_total')::numeric, 833.33::numeric,
  'AC-CAT-016 a Project Manager reads attributed cost through project finances (Labor 800 + Overheads 33.33)');
select pg_temp.as_user('03760000-0000-0000-0000-0000000000a5');
select is(pg_temp.attr('03760000-0000-0000-0000-0000000000c2','Labor'), 0::numeric, 'AC-CAT-016 an Engineer reading project actuals gets none of the Employee-party pay');
select is(pg_temp.attr('03760000-0000-0000-0000-0000000000c2','Overheads'), 33.33::numeric, 'AC-CAT-016 an Engineer still sees non-personal attributed cost');
select is((select coalesce(sum(amount), 0) from cost_attribution_project_actuals('03760000-0000-0000-0000-0000000000c2', null) where category = 'Labor'), 0::numeric,
  'AC-CAT-016 an Engineer calling the helper directly gets none of it either');
reset role;

-- ── AC-CAT-017 edge cases of the split, the window and the fiscal year ───────────────────────────────
insert into erp_gl_entry_mirror (id, org_id, erp_name, company, account, cost_center, fiscal_year, project, party_type, party, posting_date, debit, credit, is_cancelled, erp_modified) values
  ('03760000-0000-0000-0000-0000000001c1','03760000-0000-0000-0000-00000000000a','GL-11','RIS','Utilities - RIS',null,'2025',null,null,null,'2025-06-01',0,10,false,'1'),
  ('03760000-0000-0000-0000-0000000001c2','03760000-0000-0000-0000-00000000000a','GL-12','RIS','Utilities - RIS',null,'2025',null,null,null,'2025-06-02',100.005,0,false,'1'),
  ('03760000-0000-0000-0000-0000000001c3','03760000-0000-0000-0000-00000000000a','GL-13','RIS','Utilities - RIS',null,'2025',null,null,null,'2025-06-03',0.01,0,false,'1'),
  ('03760000-0000-0000-0000-0000000001c4','03760000-0000-0000-0000-00000000000a','GL-14','RIS','Salary - RIS','Eng - RIS','2025',null,null,null,'2025-01-01',50,0,false,'1');
create or replace function pg_temp.split(p_gl text) returns numeric[] language sql as $$
  select array_agg(amount order by project_id) from cost_attribution_allocations('03760000-0000-0000-0000-00000000000a', null, null) where gl_id = p_gl::uuid $$;
select is(pg_temp.split('03760000-0000-0000-0000-0000000001c1'), array[-3.33, -3.33, -3.34]::numeric[], 'AC-CAT-017 a credit line splits negative, to the cent, summing to the line');
select is((select sum(x) from unnest(pg_temp.split('03760000-0000-0000-0000-0000000001c2')) x), 100.005::numeric, 'AC-CAT-017 a line with 3 decimals splits and sums exactly');
select is(pg_temp.split('03760000-0000-0000-0000-0000000001c3'), array[0.00, 0.00, 0.01]::numeric[], 'AC-CAT-017 0.01 split three ways sums exactly');
select is((select r.name from cost_attribution_allocations('03760000-0000-0000-0000-00000000000a', null, null) a join cost_attribution_rules r on r.id = a.rule_id
  where a.gl_id = '03760000-0000-0000-0000-0000000001c4' limit 1), 'Salary to anchor', 'AC-CAT-017 a line posted on effective_from is attributed');
set local role authenticated;
select pg_temp.as_user('03760000-0000-0000-0000-0000000000a1');
select is((select attributed_to_date from project_mapped_actuals('03760000-0000-0000-0000-0000000000c3', '2025') where category = 'Labor'), 575::numeric,
  'AC-CAT-017 the 2025 view excludes the fiscal-2024 line GL-6 (50% of 1000 + 100 + 50)');
select is(pg_temp.attr('03760000-0000-0000-0000-0000000000c3','Labor'), 1275::numeric, 'AC-CAT-017 the all-years view includes it (575 + 700)');
select is((save_cost_attribution_rule('{"name":"Void rent","account":"Rent - RIS","effective_from":"2025-01-01","effective_to":"2024-12-31",
  "targets":[{"project_id":"03760000-0000-0000-0000-0000000000c1","percent":100}]}'::jsonb))->>'version', '1', 'AC-CAT-017 a voided rule (ends the day before it starts) saves');
select is(pg_temp.attr('03760000-0000-0000-0000-0000000000c1','Overheads'), 33.33::numeric - 3.33 + 33.33 + 0.00, 'AC-CAT-017 a voided rule contributes nothing (rent stays off the anchor)');
select pg_temp.as_user('03760000-0000-0000-0000-0000000000a4');
select is(pg_temp.attr('03760000-0000-0000-0000-0000000000c1','Labor'), 575::numeric, 'AC-CAT-017 an Executive reads the anchor''s attributed cost through project actuals (50% of 1150)');
reset role;

-- ── NFR-CAT-002 the org-wide read the dashboards use equals the per-project read, row for row ─────────
create or replace function pg_temp.parity_gap(p_fy text) returns int language sql as $$
  select (select count(*)::int from (select * from project_mapped_actuals_all(p_fy)
            except select p.id, x.* from projects p cross join lateral project_mapped_actuals(p.id, p_fy) x) d)
       + (select count(*)::int from (select p.id, x.* from projects p cross join lateral project_mapped_actuals(p.id, p_fy) x
            except select * from project_mapped_actuals_all(p_fy)) d) $$;
set local role authenticated;
select pg_temp.as_user('03760000-0000-0000-0000-0000000000a1');
select is(pg_temp.parity_gap(null), 0, 'NFR-CAT-002 Finance: org-wide actuals equal the per-project actuals (all years)');
select is(pg_temp.parity_gap('2025'), 0, 'NFR-CAT-002 Finance: org-wide actuals equal the per-project actuals (2025)');
select pg_temp.as_user('03760000-0000-0000-0000-0000000000a5');
select is(pg_temp.parity_gap(null), 0, 'NFR-CAT-002 Engineer: the org-wide read applies the same Employee-party narrowing');
reset role;

-- ── AC-CAT-013 OAuth API client tiers ────────────────────────────────────────────────────────────────
create or replace function pg_temp.req(p_sub text, p_path text) returns void language sql as $$
select set_config('request.jwt.claims',json_build_object('sub',p_sub,'role','authenticated','client_id','pmo-cli')::text,true),
set_config('request.method','POST',true),set_config('request.path',p_path,true),set_config('request.headers','{}',true);$$;
set local role authenticated;
select pg_temp.req('03760000-0000-0000-0000-0000000000a1','/rpc/save_cost_attribution_rule');
select lives_ok('select public.api_client_request_guard()', 'AC-CAT-013 a Finance API client may save');
select pg_temp.req('03760000-0000-0000-0000-0000000000a2','/rpc/preview_cost_attribution');
select lives_ok('select public.api_client_request_guard()', 'AC-CAT-013 an Admin API client may preview');
select pg_temp.req('03760000-0000-0000-0000-0000000000a5','/rpc/save_cost_attribution_rule');
select throws_ok('select public.api_client_request_guard()', '42501', null, 'AC-CAT-013 an Engineer API client may not save');
select pg_temp.req('03760000-0000-0000-0000-0000000000a3','/rpc/end_cost_attribution_rule');
select throws_ok('select public.api_client_request_guard()', '42501', null, 'AC-CAT-013 a Project Manager API client may not end a rule');
select pg_temp.req('03760000-0000-0000-0000-0000000000a3','/rpc/list_cost_attribution_rules');
select lives_ok('select public.api_client_request_guard()', 'AC-CAT-013 a Project Manager API client may list');
reset role;

select * from finish();
rollback;

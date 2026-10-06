-- budget_account_map_multi.test.sql (#768) — OWNS AC-BAM-001, AC-BAM-002, AC-BAM-004.
-- A budget category maps to one or more ERP accounts; an account still backs at most one category; at most
-- one account per category is the PUSH account; the forward view sums every account of a category.
-- Namespaced 0768 UUIDs (valid hex, not seed-colliding). begin/rollback + finish().
begin;
select plan(19);

insert into organizations (id, name) values
  ('07680000-0000-0000-0000-000000000001','BAM Org A'),
  ('07680000-0000-0000-0000-000000000002','BAM Org B');
insert into auth.users (id, email) values
  ('07680000-0000-0000-0000-0000000000a1','bam-admin-a@example.com'),
  ('07680000-0000-0000-0000-0000000000a2','bam-finance-a@example.com'),
  ('07680000-0000-0000-0000-0000000000b1','bam-admin-b@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('07680000-0000-0000-0000-0000000000a1','07680000-0000-0000-0000-000000000001','BAM Admin A','bam-admin-a@example.com','Admin','active'),
  ('07680000-0000-0000-0000-0000000000a2','07680000-0000-0000-0000-000000000001','BAM Finance A','bam-finance-a@example.com','Finance','active'),
  ('07680000-0000-0000-0000-0000000000b1','07680000-0000-0000-0000-000000000002','BAM Admin B','bam-admin-b@example.com','Admin','active');

-- ── Structure ───────────────────────────────────────────────────────────────────────────────────
select has_column('public','budget_category_account_map','is_push_target',
  'AC-BAM-001 the push flag exists');
select col_not_null('public','budget_category_account_map','is_push_target',
  'AC-BAM-001 the push flag is never NULL');
select col_default_is('public','budget_category_account_map','is_push_target','true',
  'AC-BAM-001 existing and single-account rows are push accounts by default');
select ok(exists(select 1 from pg_indexes
                  where schemaname='public' and tablename='budget_category_account_map'
                    and indexname='budget_category_account_map_one_push_per_category'
                    and indexdef like '%UNIQUE%(org_id, category) WHERE is_push_target'),
  'AC-BAM-001 at most one push account per (org, category), DB-enforced');
select col_is_unique('public','budget_category_account_map', array['org_id','erp_account'],
  'AC-BAM-001 an ERP account still backs at most one category per org');

-- ── AC-BAM-001: one category, several accounts; one push; account → one category ───────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"07680000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select lives_ok(
  $$insert into public.budget_category_account_map (id, category, erp_account)
      values ('07681111-0000-0000-0000-000000000001','Labor','Salary - BAM')$$,
  'AC-BAM-001 the first Labor account is written as its push account');
select lives_ok(
  $$insert into public.budget_category_account_map (id, category, erp_account, is_push_target) values
      ('07681111-0000-0000-0000-000000000002','Labor','Allowances - BAM', false),
      ('07681111-0000-0000-0000-000000000003','Labor','Social Security - BAM', false)$$,
  'AC-BAM-001 Labor takes two more, read-only accounts');
select is((select count(*)::int from public.budget_category_account_map where category = 'Labor'), 3,
  'AC-BAM-001 Labor maps to three accounts');
select throws_ok(
  $$insert into public.budget_category_account_map (category, erp_account) values ('Labor','Payroll Bonus - BAM')$$,
  '23505', 'duplicate key value violates unique constraint "budget_category_account_map_one_push_per_category"',
  'AC-BAM-001 a second PUSH account for Labor is refused');
select throws_ok(
  $$insert into public.budget_category_account_map (category, erp_account, is_push_target)
      values ('Overheads','Allowances - BAM', false)$$,
  '23505', 'duplicate key value violates unique constraint "budget_category_account_map_org_id_erp_account_key"',
  'AC-BAM-001 an account already under Labor cannot also back Overheads');

-- ── AC-BAM-004: moving the push flag ───────────────────────────────────────────────────────────────
select lives_ok(
  $$select public.set_budget_push_account('07681111-0000-0000-0000-000000000002')$$,
  'AC-BAM-004 Admin makes Allowances the Labor push account');
select results_eq(
  $$select erp_account from public.budget_category_account_map where category = 'Labor' and is_push_target$$,
  $$values ('Allowances - BAM'::text)$$,
  'AC-BAM-004 Labor has exactly one push account, the new one');

set local request.jwt.claims = '{"sub":"07680000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select throws_ok(
  $$select public.set_budget_push_account('07681111-0000-0000-0000-000000000001')$$,
  '42501', 'not authorized to set the budget push account',
  'AC-BAM-004 Finance cannot change the push account (Admin-only)');

set local request.jwt.claims = '{"sub":"07680000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select results_eq(
  $$select erp_account from public.budget_category_account_map where category = 'Labor' and is_push_target$$,
  $$values ('Allowances - BAM'::text)$$,
  'AC-BAM-004 the refused call changed nothing');

set local request.jwt.claims = '{"sub":"07680000-0000-0000-0000-0000000000b1","role":"authenticated"}';
select throws_ok(
  $$select public.set_budget_push_account('07681111-0000-0000-0000-000000000001')$$,
  'P0002', 'budget account mapping not found',
  'AC-BAM-004 another org''s Admin cannot reach org A''s row');

set local role postgres;
select ok(not has_function_privilege('anon', 'public.set_budget_push_account(uuid)', 'execute'),
  'AC-BAM-004 anon cannot execute set_budget_push_account');
select is((select p.prosecdef from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname = 'set_budget_push_account'), false,
  'AC-BAM-004 SECURITY INVOKER — the table''s Admin-only RLS is the gate');

-- ── AC-BAM-002: actuals sum every account of a category ────────────────────────────────────────────
-- Materials has ONLY a read-only account: still "mapped" for actuals (C-1), never pushed.
insert into budget_category_account_map (org_id, category, erp_account, is_push_target) values
  ('07680000-0000-0000-0000-000000000001','Materials','Materials Stock - BAM', false);
insert into projects (id, org_id, name, status) values
  ('07682222-0000-0000-0000-000000000001','07680000-0000-0000-0000-000000000001','BAM Project','Ongoing Project');
insert into budget_versions (id, org_id, project_id, version, name, status) values
  ('07683333-0000-0000-0000-000000000001','07680000-0000-0000-0000-000000000001','07682222-0000-0000-0000-000000000001',1,'BAM Active','Draft');
insert into budget_line_items (org_id, budget_version_id, category, description, budgeted_amount, actual_amount) values
  ('07680000-0000-0000-0000-000000000001','07683333-0000-0000-0000-000000000001','Labor','Crew',1000.00,0);
update budget_versions set status = 'Active' where id = '07683333-0000-0000-0000-000000000001';
insert into budget_version_erp_mirror (org_id, budget_version_id, fiscal_year, push_state) values
  ('07680000-0000-0000-0000-000000000001','07683333-0000-0000-0000-000000000001','2026','pushed');
insert into erp_actuals_snapshot (org_id, project_id, account, fiscal_year, debit, credit, net, as_of, snapshot_id) values
  ('07680000-0000-0000-0000-000000000001','07682222-0000-0000-0000-000000000001','Salary - BAM','2026',100.00,0,100.00,now(),'07684444-0000-0000-0000-000000000001'),
  ('07680000-0000-0000-0000-000000000001','07682222-0000-0000-0000-000000000001','Allowances - BAM','2026',20.00,0,20.00,now(),'07684444-0000-0000-0000-000000000001'),
  ('07680000-0000-0000-0000-000000000001','07682222-0000-0000-0000-000000000001','Social Security - BAM','2026',30.00,0,30.00,now(),'07684444-0000-0000-0000-000000000001'),
  ('07680000-0000-0000-0000-000000000001','07682222-0000-0000-0000-000000000001','Materials Stock - BAM','2026',40.00,0,40.00,now(),'07684444-0000-0000-0000-000000000001'),
  ('07680000-0000-0000-0000-000000000001','07682222-0000-0000-0000-000000000001','Unmapped Office - BAM','2026',999.00,0,999.00,now(),'07684444-0000-0000-0000-000000000001');

set local role authenticated;
set local request.jwt.claims = '{"sub":"07680000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select is(
  (select actuals_to_date from public.get_budget_projection('07682222-0000-0000-0000-000000000001','2026')
    where category = 'Labor'),
  150.00::numeric,
  'AC-BAM-002 Labor actuals sum every Labor account, push and read-only, and nothing unmapped');
select is(
  (select actuals_to_date from public.get_budget_projection('07682222-0000-0000-0000-000000000001','2026')
    where category = 'Materials'),
  40.00::numeric,
  'AC-BAM-002 a category whose only account is read-only still reads its actuals (C-1)');

select finish();
rollback;

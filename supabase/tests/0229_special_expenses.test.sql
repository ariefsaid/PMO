-- #804: fixed eighth category. Existing money, role and org contracts remain intact.
begin;
select plan(15);

insert into organizations (id, name) values
 ('02290000-0000-0000-0000-000000000001','Category fixture A'),
 ('02290000-0000-0000-0000-000000000002','Category fixture B');
insert into auth.users (id, email) values
 ('02290000-0000-0000-0000-0000000000a1','category-admin-a@example.test'),
 ('02290000-0000-0000-0000-0000000000a2','category-finance-a@example.test'),
 ('02290000-0000-0000-0000-0000000000b1','category-admin-b@example.test');
insert into profiles (id, org_id, full_name, email, role, status) values
 ('02290000-0000-0000-0000-0000000000a1','02290000-0000-0000-0000-000000000001','Fixture Admin A','category-admin-a@example.test','Admin','active'),
 ('02290000-0000-0000-0000-0000000000a2','02290000-0000-0000-0000-000000000001','Fixture Finance A','category-finance-a@example.test','Finance','active'),
 ('02290000-0000-0000-0000-0000000000b1','02290000-0000-0000-0000-000000000002','Fixture Admin B','category-admin-b@example.test','Admin','active');
insert into projects (id, org_id, name, status) values
 ('02291111-0000-0000-0000-000000000001','02290000-0000-0000-0000-000000000001','Category fixture project','Ongoing Project');
insert into budget_versions (id, org_id, project_id, version, name, status) values
 ('02292222-0000-0000-0000-000000000001','02290000-0000-0000-0000-000000000001','02291111-0000-0000-0000-000000000001',1,'Category fixture draft','Draft');
insert into budget_line_items (org_id, budget_version_id, category, budgeted_amount) values
 ('02290000-0000-0000-0000-000000000001','02292222-0000-0000-0000-000000000001','Labor',123.45);

select is(enum_range(null::public.budget_category)::text[],
 array['Labor','Materials','Subcontractors','Equipment','Permits & Fees','Overheads','Contingency','Special expenses'],
 'AC-CAT-001 exact eighth category is additive; seven existing values and order retained');
set local role authenticated;
set local request.jwt.claims = '{"sub":"02290000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select lives_ok($$insert into budget_line_items (budget_version_id, category, budgeted_amount)
 values ('02292222-0000-0000-0000-000000000001','Special expenses',25000.30)$$,
 'AC-CAT-001 Admin persists Special expenses through the existing draft-line write');
select is((select budgeted_amount from budget_line_items where category::text = 'Special expenses'),25000.30::numeric,
 'AC-CAT-001 new category preserves exact numeric amount');
select is((select budgeted_amount from budget_line_items where category = 'Labor'),123.45::numeric,
 'AC-CAT-001 existing Labor money is unchanged');
select throws_ok($$insert into budget_line_items (budget_version_id, category, budgeted_amount)
 values ('02292222-0000-0000-0000-000000000001','Other',1)$$,'22P02',null,
 'AC-CAT-001 arbitrary categories remain rejected by the enum');
select lives_ok($$insert into budget_category_account_map (category, erp_account)
 values ('Special expenses','Travel expense fixture')$$,
 'AC-CAT-001 Admin maps the eighth category through the existing account-map write');
select is((select erp_account from budget_category_account_map where category::text = 'Special expenses'),'Travel expense fixture',
 'AC-CAT-001 canonical category and configured account round trip');
select throws_ok($$insert into budget_category_account_map (category, erp_account)
 values ('Labor','Travel expense fixture')$$,'23505',null,
 'AC-CAT-001 account bijection remains enforced for the eighth category');
set local request.jwt.claims = '{"sub":"02290000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select throws_ok($$insert into budget_category_account_map (category, erp_account)
 values ('Special expenses','Forbidden fixture')$$,'42501',null,
 'AC-CAT-001 Finance cannot configure the eighth category account');
select lives_ok($$insert into budget_projections (project_id, fiscal_year, category, pmo_etc)
 values ('02291111-0000-0000-0000-000000000001','2026','Special expenses',42.30)$$,
 'AC-CAT-001 Finance can persist ETC for the eighth category');
select is((select pmo_etc from budget_projections where category::text = 'Special expenses'),42.30::numeric,
 'AC-CAT-001 projection ETC preserves exact numeric amount');
select is((select pmo_etc from public.get_budget_projection('02291111-0000-0000-0000-000000000001','2026')
 where category::text = 'Special expenses'),42.30::numeric,
 'AC-CAT-001 existing projection RPC retains the eighth category and its exact ETC');
set local request.jwt.claims = '{"sub":"02290000-0000-0000-0000-0000000000b1","role":"authenticated"}';
select is((select count(*)::int from budget_line_items),0,'AC-CAT-001 other org cannot read category line items');
select is((select count(*)::int from budget_category_account_map),0,'AC-CAT-001 other org cannot read category account mapping');
select is((select count(*)::int from budget_projections),0,'AC-CAT-001 other org cannot read category ETC');
select finish();
rollback;

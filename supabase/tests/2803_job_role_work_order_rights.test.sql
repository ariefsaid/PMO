begin;
create extension if not exists pgtap;
select no_plan();
insert into organizations (id, name, default_currency, built_in_roles_enabled) values ('28030000-0000-0000-0000-000000000003', 'Work order rights', 'IDR', true);
insert into auth.users (id, email) values
 ('28030000-0000-0000-0000-000000000071', 'rights-engineer@example.com'),
 ('28030000-0000-0000-0000-000000000072', 'rights-planner@example.com'),
 ('28030000-0000-0000-0000-000000000073', 'rights-store@example.com');
insert into profiles (id, org_id, full_name, email, role, status, built_in_role) values
 ('28030000-0000-0000-0000-000000000071', '28030000-0000-0000-0000-000000000003', 'Engineer', 'rights-engineer@example.com', 'Engineer', 'active', 'engineer'),
 ('28030000-0000-0000-0000-000000000072', '28030000-0000-0000-0000-000000000003', 'Planner', 'rights-planner@example.com', 'Engineer', 'active', 'planner'),
 ('28030000-0000-0000-0000-000000000073', '28030000-0000-0000-0000-000000000003', 'Store', 'rights-store@example.com', 'Engineer', 'active', 'storekeeper');
insert into projects (id, org_id, name, status) values ('28030000-0000-0000-0000-000000000081', '28030000-0000-0000-0000-000000000003', 'Site', 'Ongoing Project');
insert into work_orders (id, org_id, project_id, title, status, order_value, tax_treatment, tax_amount) values
 ('28030000-0000-0000-0000-000000000091', '28030000-0000-0000-0000-000000000003', '28030000-0000-0000-0000-000000000081', 'Existing', 'Draft', 0, 'exclusive', 0),
 ('28030000-0000-0000-0000-000000000092', '28030000-0000-0000-0000-000000000003', '28030000-0000-0000-0000-000000000081', 'Locked', 'Issued', 0, 'exclusive', 0);
insert into work_order_areas (id, org_id, code, name) values ('28030000-0000-0000-0000-0000000000a1', '28030000-0000-0000-0000-000000000003', 'A', 'Area');
insert into rate_catalogue_items (id, org_id, project_id, item_code, description, unit) values ('28030000-0000-0000-0000-0000000000b1', '28030000-0000-0000-0000-000000000003', '28030000-0000-0000-0000-000000000081', 'A', 'Pipe', 'm');
insert into rate_catalogue_variants (id, org_id, project_id, name) values ('28030000-0000-0000-0000-0000000000b2', '28030000-0000-0000-0000-000000000003', '28030000-0000-0000-0000-000000000081', 'Default');
insert into rate_catalogue_rates (org_id, item_id, variant_id, rate, effective_from) values ('28030000-0000-0000-0000-000000000003', '28030000-0000-0000-0000-0000000000b1', '28030000-0000-0000-0000-0000000000b2', 25, current_date);
insert into progress_claims (id, org_id, project_id, kind, currency, gross_amount, created_by) values ('28030000-0000-0000-0000-0000000000c1', '28030000-0000-0000-0000-000000000003', '28030000-0000-0000-0000-000000000081', 'progress', 'IDR', 50, '28030000-0000-0000-0000-000000000073');
create function pg_temp.act(p text) returns void language sql as $$ select set_config('request.jwt.claims', json_build_object('sub', '28030000-0000-0000-0000-0000000000' || p, 'role', 'authenticated')::text, true) $$;
set local role authenticated;
select pg_temp.act('71');
select lives_ok($$insert into work_orders (project_id, title, order_value, tax_treatment, tax_amount) values ('28030000-0000-0000-0000-000000000081', 'Captured', 0, 'exclusive', 0)$$, 'AC-RR-001 engineer creates Draft');
select lives_ok($$update work_orders set title = 'Edited' where id = '28030000-0000-0000-0000-000000000091'$$, 'AC-RR-001 engineer edits Draft');
select is((select title from work_orders where id = '28030000-0000-0000-0000-000000000091'), 'Edited', 'Draft edit persists');
select is((with u as (update work_orders set description = 'x' where id = '28030000-0000-0000-0000-000000000092' returning 1) select count(*)::int from u), 0, 'engineer cannot edit an Issued order');
select throws_ok($$select transition_work_order('28030000-0000-0000-0000-000000000091', 'Issued')$$, '42501', null, 'engineer cannot issue');
select is((select count(*)::int from rate_catalogue_rates), 1, 'AC-RR-002 engineer reads catalogue rate');
select lives_ok($$select set_work_order_area_group('28030000-0000-0000-0000-000000000091', '28030000-0000-0000-0000-0000000000a1', null, true, false)$$, 'AC-RR-003 engineer sets area');
select lives_ok($$select set_work_order_check_in_area('28030000-0000-0000-0000-000000000091', -6, 106, 100)$$, 'AC-RR-003 engineer sets check-in point');
select lives_ok($$select set_work_order_plan('28030000-0000-0000-0000-000000000081', '28030000-0000-0000-0000-000000000091', '[{"kind":"direct_budget","value":"100"}]')$$, 'AC-RR-004 engineer saves plan');
select is((select value from work_order_plan_lines where work_order_id = '28030000-0000-0000-0000-000000000091' and kind = 'direct_budget'), 100::numeric, 'AC-RR-004 plan figure is on the order');
select is((select count(*)::int from progress_claims), 1, 'AC-RR-005 engineer reads claims');
select ok(actor_may_see_billing_steps(), 'AC-RR-005 engineer sees billing steps');
select ok(not actor_may_run_billing_steps(), 'engineer does not run billing steps');
select pg_temp.act('73');
select throws_ok($$insert into work_orders (project_id, title, order_value, tax_treatment, tax_amount) values ('28030000-0000-0000-0000-000000000081', 'No', 0, 'exclusive', 0)$$, '42501', null, 'unrelated role cannot capture');
select is((select count(*)::int from rate_catalogue_rates), 0, 'unrelated role cannot read rates');
select throws_ok($$select set_work_order_check_in_area('28030000-0000-0000-0000-000000000091', -6, 106, 100)$$, '42501', null, 'unrelated role cannot set check-in');
select throws_ok($$select set_work_order_plan('28030000-0000-0000-0000-000000000081', '28030000-0000-0000-0000-000000000091', '[{"kind":"direct_budget","value":"100"}]')$$, '42501', null, 'unrelated role cannot plan');
select is((select count(*)::int from progress_claims), 0, 'unrelated role cannot read claims');
select * from finish();
rollback;

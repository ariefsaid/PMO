-- AC-ECX-040 (#1599 ECX-5): the sweep stores its fiscal-year check on the ERPNext binding through
-- merge_external_org_binding_config. On the real schema: the new status replaces the old one whole (no stale refusal words),
-- every sibling key and every other binding is left as it was, and only the service role may call it.
begin;
select plan(9);

insert into organizations (id, name) values
  ('15990000-0000-0000-0000-000000000001', 'Fiscal year status org A'),
  ('15990000-0000-0000-0000-000000000002', 'Fiscal year status org B'),
  ('15990000-0000-0000-0000-000000000003', 'Fiscal year status org C');
insert into external_org_bindings (org_id, external_tier, site_url, secret_ref, config) values
  ('15990000-0000-0000-0000-000000000001', 'erpnext', 'https://erp-a.example', 'ref-a',
   '{"company":"Co A","default_payable_account":"Creditors","fiscal_year":{"state":"refused","checked_on":"2026-11-30","company":"Co A","message":"old words"}}'::jsonb),
  ('15990000-0000-0000-0000-000000000001', 'clickup', 'https://clickup.example', 'ref-c', '{"statusMap":{"open":"To Do"}}'::jsonb),
  ('15990000-0000-0000-0000-000000000002', 'erpnext', 'https://erp-b.example', 'ref-b', '{"company":"Co B"}'::jsonb);

set local role service_role;

select lives_ok($$ select merge_external_org_binding_config('15990000-0000-0000-0000-000000000001', 'erpnext',
  '{"fiscal_year":{"state":"needs-operator","checked_on":"2026-12-01","company":"Co A","reason":"disabled-year","year":"2027"}}'::jsonb) $$,
  'AC-ECX-040 the service role stores a fiscal-year check on the ERPNext binding');
select is((select config from external_org_bindings where org_id = '15990000-0000-0000-0000-000000000001' and external_tier = 'erpnext'),
  '{"company":"Co A","default_payable_account":"Creditors","fiscal_year":{"state":"needs-operator","checked_on":"2026-12-01","company":"Co A","reason":"disabled-year","year":"2027"}}'::jsonb,
  'AC-ECX-040 the new check replaces the old one whole (no stale refusal words) and keeps the company defaults');
select is((select config from external_org_bindings where org_id = '15990000-0000-0000-0000-000000000001' and external_tier = 'clickup'),
  '{"statusMap":{"open":"To Do"}}'::jsonb, 'AC-ECX-040 the same org''s other binding is untouched');
select is((select config from external_org_bindings where org_id = '15990000-0000-0000-0000-000000000002' and external_tier = 'erpnext'),
  '{"company":"Co B"}'::jsonb, 'AC-ECX-040 another org''s ERPNext binding is untouched');

select lives_ok($$ select merge_external_org_binding_config('15990000-0000-0000-0000-000000000003', 'erpnext',
  '{"fiscal_year":{"state":"ready","checked_on":"2026-12-01","company":"Co C","current":"2026","next":"2027"}}'::jsonb) $$,
  'AC-ECX-040 a check for an org with no ERPNext binding is a no-op, not an error');
select is((select count(*)::int from external_org_bindings where org_id = '15990000-0000-0000-0000-000000000003'), 0,
  'AC-ECX-040 ... and creates no binding');
select throws_ok($$ select merge_external_org_binding_config('15990000-0000-0000-0000-000000000001', 'erpnext', '"not an object"'::jsonb) $$,
  '22023', null, 'AC-ECX-040 a patch that is not an object is refused');

reset role;
select ok(not has_function_privilege('authenticated', 'public.merge_external_org_binding_config(uuid,text,jsonb)', 'execute')
      and not has_function_privilege('anon', 'public.merge_external_org_binding_config(uuid,text,jsonb)', 'execute'),
  'AC-ECX-040 no signed-in user or anonymous caller may write a binding''s fiscal-year check');
select ok(has_function_privilege('service_role', 'public.merge_external_org_binding_config(uuid,text,jsonb)', 'execute'),
  'AC-ECX-040 the sweep''s service role may');

select * from finish();
rollback;

-- #1599 ECX-3 (migration 0910): ERP company defaults set from PMO.
-- AC-ECX-021: only an active Admin or Finance of the binding's org can request a defaults change; each account must be a mirrored,
-- enabled leaf of that company and org of the right kind (the ERP itself checks no account type); the cost centre a mirrored leaf
-- of the company; another org's request is refused. The result writer records only what the ERP read back.
begin;
select plan(52);

insert into organizations (id, name) values
 ('09100000-0000-0000-0000-000000000001','Defaults A'),
 ('09100000-0000-0000-0000-000000000002','Defaults B');
insert into auth.users (id, email) values
 ('09100000-0000-0000-0000-0000000000a1','d910-admin@example.com'),
 ('09100000-0000-0000-0000-0000000000a2','d910-finance@example.com'),
 ('09100000-0000-0000-0000-0000000000a3','d910-pm@example.com'),
 ('09100000-0000-0000-0000-0000000000a4','d910-gone@example.com'),
 ('09100000-0000-0000-0000-0000000000b1','d910-badmin@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
 ('09100000-0000-0000-0000-0000000000a1','09100000-0000-0000-0000-000000000001','Admin A','d910-admin@example.com','Admin','active'),
 ('09100000-0000-0000-0000-0000000000a2','09100000-0000-0000-0000-000000000001','Finance A','d910-finance@example.com','Finance','active'),
 ('09100000-0000-0000-0000-0000000000a3','09100000-0000-0000-0000-000000000001','PM A','d910-pm@example.com','Project Manager','active'),
 ('09100000-0000-0000-0000-0000000000a4','09100000-0000-0000-0000-000000000001','Gone A','d910-gone@example.com','Admin','disabled'),
 ('09100000-0000-0000-0000-0000000000b1','09100000-0000-0000-0000-000000000002','Admin B','d910-badmin@example.com','Admin','active');
insert into external_org_bindings (org_id, external_tier, site_url, secret_ref, status, config, activated_at) values
 ('09100000-0000-0000-0000-000000000001','erpnext','https://erp.example.test','d910_a','active','{"company":"Example Co","default_receivable_account":"Debtors"}', now()),
 ('09100000-0000-0000-0000-000000000002','erpnext','https://erp-b.example.test','d910_b','active','{"company":"Example B"}', now());

-- The mirrored chart (what the account sweep writes) and cost centres.
insert into erp_account_mirror (org_id, company, erp_name, account_name, root_type, report_type, is_group, account_currency, lft, rgt, account_type, disabled, refresh_id)
select o, c, n, n, rt, case when rt in ('Income','Expense') then 'Profit and Loss' else 'Balance Sheet' end, g, 'IDR', 1, 2, t, d, gen_random_uuid()
from (values
 ('09100000-0000-0000-0000-000000000001'::uuid,'Example Co','Creditors','Liability',false,'Payable',false),
 ('09100000-0000-0000-0000-000000000001','Example Co','Debtors','Asset',false,'Receivable',false),
 ('09100000-0000-0000-0000-000000000001','Example Co','Cash','Asset',false,'Cash',false),
 ('09100000-0000-0000-0000-000000000001','Example Co','Bank A','Asset',false,'Bank',false),
 ('09100000-0000-0000-0000-000000000001','Example Co','Site Costs','Expense',false,null,false),
 ('09100000-0000-0000-0000-000000000001','Example Co','Service Income','Income',false,null,false),
 ('09100000-0000-0000-0000-000000000001','Example Co','Accounts Payable','Liability',true,null,false),
 ('09100000-0000-0000-0000-000000000001','Example Co','Old Creditors','Liability',false,'Payable',true),
 ('09100000-0000-0000-0000-000000000001','Other Co','Other Creditors','Liability',false,'Payable',false),
 ('09100000-0000-0000-0000-000000000002','Example B','B Creditors','Liability',false,'Payable',false)
) v(o, c, n, rt, g, t, d);

set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select is(public.replace_erp_cost_centre_mirror('09100000-0000-0000-0000-000000000001','Example Co',
  '[{"name":"Main","isGroup":false},{"name":"All Centres","isGroup":true},{"name":"Stale","isGroup":false},{"name":"Off","isGroup":false,"disabled":true}]'::jsonb), 4,
  'replace_erp_cost_centre_mirror stores the company''s cost centres');
select is(public.replace_erp_cost_centre_mirror('09100000-0000-0000-0000-000000000001','Example Co',
  '[{"name":"Main","isGroup":false},{"name":"All Centres","isGroup":true},{"name":"Off","isGroup":false,"disabled":true}]'::jsonb), 3,
  'a second replace keeps only what the ERP listed');
select public.replace_erp_cost_centre_mirror('09100000-0000-0000-0000-000000000001','Other Co','[{"name":"Other Main","isGroup":false}]'::jsonb);
select is((select count(*)::int from erp_cost_centre_mirror where org_id = '09100000-0000-0000-0000-000000000001' and erp_name = 'Stale'), 0,
  'a cost centre the ERP no longer lists is removed');
select throws_ok($$select public.replace_erp_cost_centre_mirror('09100000-0000-0000-0000-000000000001','Example Co','{"name":"x"}'::jsonb)$$,
  '22023', null, 'the mirror refuses a list that is not an array');
reset role;

-- Grants: the definer is the only way in for a person; the writers are service-role only.
select ok(has_function_privilege('authenticated', 'public.request_company_defaults(text, jsonb)', 'execute'), 'request_company_defaults is callable by a signed-in user');
select ok(not has_function_privilege('authenticated', 'public.record_company_defaults_result(uuid, uuid, jsonb, text)', 'execute'), 'record_company_defaults_result is not callable by a signed-in user');
select ok(not has_function_privilege('authenticated', 'public.replace_erp_cost_centre_mirror(uuid, text, jsonb)', 'execute'), 'replace_erp_cost_centre_mirror is not callable by a signed-in user');
select ok(not has_function_privilege('anon', 'public.request_company_defaults(text, jsonb)', 'execute'), 'request_company_defaults is not callable anonymously');
select ok(not has_table_privilege('authenticated', 'public.erp_company_default_requests', 'insert'), 'a signed-in user cannot write a request row directly');
select ok(not has_table_privilege('authenticated', 'public.erp_cost_centre_mirror', 'insert'), 'a signed-in user cannot write the cost-centre mirror');
select ok(not (select prosecdef from pg_proc where oid = 'public.company_default_target_problem(uuid, text, text, text)'::regprocedure),
  'company_default_target_problem runs with its caller''s rights (security invoker)');

-- 1. Role and org.
set local role authenticated;
set local request.jwt.claims = '{"sub":"09100000-0000-0000-0000-0000000000a3","role":"authenticated"}';
select throws_ok($$select public.request_company_defaults('erpnext','{"payable":"Creditors"}')$$, '42501', null,
  'AC-ECX-021 a Project Manager cannot request a defaults change');
set local request.jwt.claims = '{"sub":"09100000-0000-0000-0000-0000000000a4","role":"authenticated"}';
select throws_ok($$select public.request_company_defaults('erpnext','{"payable":"Creditors"}')$$, '42501', null,
  'AC-ECX-021 an inactive Admin cannot request a defaults change');
set local request.jwt.claims = '{"sub":"09100000-0000-0000-0000-0000000000b1","role":"authenticated"}';
select throws_ok($$select public.request_company_defaults('erpnext','{"payable":"Creditors"}')$$, '22023', null,
  'AC-ECX-021 another org''s Admin cannot choose an account of this org''s chart');
select lives_ok($$select public.request_company_defaults('erpnext','{"payable":"B Creditors"}')$$,
  'org B''s Admin may choose an account of org B''s own chart');
select throws_ok($$select public.request_company_defaults('odoo','{"payable":"B Creditors"}')$$, 'P0001', null,
  'a tier the org has not connected is refused');

set local request.jwt.claims = '{"sub":"09100000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select set_config('d910.first', public.request_company_defaults('erpnext','{"payable":"Creditors"}')::text, true);
select is(current_setting('d910.first')::jsonb->>'company', 'Example Co', 'AC-ECX-021 an Admin''s request names the bound company');
select is(current_setting('d910.first')::jsonb->'values', '{"payable":"Creditors"}'::jsonb, 'the request carries the chosen values');
select ok(current_setting('d910.first')::jsonb->>'idempotencyKey' like 'setup:company-defaults:%', 'the request is keyed per binding and values');
set local request.jwt.claims = '{"sub":"09100000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select is(public.request_company_defaults('erpnext','{"payable":" Creditors "}')->>'id', current_setting('d910.first')::jsonb->>'id',
  'AC-ECX-021 Finance may request it too, and the same values are the same request (one row, not two)');
select is((select attempts from erp_company_default_requests where id = (current_setting('d910.first')::jsonb->>'id')::uuid), 2, 'the retry is counted on that row');

-- 2. Kind, leaf, company, enabled: refused before anything is queued.
select throws_like($$select public.request_company_defaults('erpnext','{"payable":"Debtors"}')$$, '%not a payable account%',
  'AC-ECX-021 a Receivable account cannot be the payable default');
select throws_like($$select public.request_company_defaults('erpnext','{"cash":"Bank A"}')$$, '%not a cash account%', 'a Bank account cannot be the cash default');
select throws_like($$select public.request_company_defaults('erpnext','{"bank":"Cash"}')$$, '%not a bank account%', 'a Cash account cannot be the bank default');
select throws_like($$select public.request_company_defaults('erpnext','{"expense":"Service Income"}')$$, '%not an expense account%', 'an Income leaf cannot be the expense default');
select throws_like($$select public.request_company_defaults('erpnext','{"payable":"Accounts Payable"}')$$, '%is a group%', 'a group account is refused');
select throws_like($$select public.request_company_defaults('erpnext','{"payable":"Old Creditors"}')$$, '%disabled%', 'a disabled account is refused');
select throws_like($$select public.request_company_defaults('erpnext','{"payable":"Other Creditors"}')$$, '%another company%', 'another company''s account is refused');
select throws_like($$select public.request_company_defaults('erpnext','{"payable":"No Such"}')$$, '%not in the ERP chart PMO has read%', 'an account PMO has not mirrored is refused');
select throws_like($$select public.request_company_defaults('erpnext','{"cost_centre":"All Centres"}')$$, '%is a group%', 'a group cost centre is refused');
select throws_like($$select public.request_company_defaults('erpnext','{"cost_centre":"Other Main"}')$$, '%another company%', 'another company''s cost centre is refused');
select throws_like($$select public.request_company_defaults('erpnext','{"cost_centre":"Off"}')$$, '%disabled%', 'a disabled cost centre is refused');
select throws_like($$select public.request_company_defaults('erpnext','{"cash":"Cash","payable":"Debtors"}')$$, '%not a payable account%', 'one wrong choice refuses the whole request');
select throws_ok($$select public.request_company_defaults('erpnext','{"receivable":"Debtors"}')$$, '22023', null, 'an unknown default is refused');
select throws_ok($$select public.request_company_defaults('erpnext','{}')$$, '22023', null, 'an empty choice is refused');
select throws_ok($$select public.request_company_defaults('erpnext','{"payable":""}')$$, '22023', null, 'a blank value is refused');
select is((select count(*)::int from erp_company_default_requests where org_id = '09100000-0000-0000-0000-000000000001'), 1, 'refused requests queued nothing');
select lives_ok($$select public.request_company_defaults('erpnext','{"expense":"Site Costs","cash":"Cash","bank":"Bank A","cost_centre":"Main"}')$$,
  'an Expense leaf, a Cash, a Bank account and a leaf cost centre of the company are accepted');

-- 3. RLS on the request rows.
set local request.jwt.claims = '{"sub":"09100000-0000-0000-0000-0000000000b1","role":"authenticated"}';
select is((select count(*)::int from erp_company_default_requests where org_id = '09100000-0000-0000-0000-000000000001'), 0, 'AC-ECX-021 another org sees none of this org''s requests');
set local request.jwt.claims = '{"sub":"09100000-0000-0000-0000-0000000000a3","role":"authenticated"}';
select is((select count(*)::int from erp_company_default_requests), 0, 'a Project Manager sees no requests');
reset role;

-- 4. The result writer records only what the ERP read back.
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select throws_ok(format($$select public.record_company_defaults_result('09100000-0000-0000-0000-000000000002', %L, '{}'::jsonb, null)$$,
  current_setting('d910.first')::jsonb->>'id'), 'P0002', null, 'AC-ECX-021 a result for another org''s request is refused');
select is(public.record_company_defaults_result('09100000-0000-0000-0000-000000000001', (current_setting('d910.first')::jsonb->>'id')::uuid,
  '{"payable":"Debtors","expense":null,"cash":null,"bank":null,"cost_centre":null}'::jsonb, null)->>'state', 'rejected',
  'a read-back that does not hold the chosen value is a refusal');
select is((select config->>'default_payable_account' from external_org_bindings where org_id = '09100000-0000-0000-0000-000000000001'), null,
  'nothing is recorded from a read-back that disagrees');
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"09100000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select public.request_company_defaults('erpnext','{"payable":"Creditors"}');
reset role;
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select is(public.record_company_defaults_result('09100000-0000-0000-0000-000000000001', (current_setting('d910.first')::jsonb->>'id')::uuid,
  '{"payable":"Creditors","expense":"Cost of Goods Sold","cash":null,"bank":null,"cost_centre":"Main"}'::jsonb, null)->>'state', 'applied',
  'a read-back holding the chosen value applies the request');
select is((select config - 'company' - 'default_receivable_account' from external_org_bindings where org_id = '09100000-0000-0000-0000-000000000001'),
  '{"default_payable_account":"Creditors","default_expense_account":"Cost of Goods Sold","default_cash_account":null,"default_bank_account":null,"cost_center":"Main"}'::jsonb,
  'the binding holds what the ERP read back, every default');
select is((select config->>'default_receivable_account' from external_org_bindings where org_id = '09100000-0000-0000-0000-000000000001'), 'Debtors',
  'other settings are kept');
select is(public.record_company_defaults_result('09100000-0000-0000-0000-000000000001', (current_setting('d910.first')::jsonb->>'id')::uuid,
  null, 'late refusal')->>'state', 'applied', 'a repeat result for a settled request changes nothing');
select is((select count(*)::int from audit_events where org_id = '09100000-0000-0000-0000-000000000001' and action = 'integration.company_defaults'), 1,
  'the applied change is audited once');
reset role;

-- 5. Concurrent saves: the newest request for the connection wins. An older request whose read-back arrives last is refused and the
-- binding keeps the newer values.
set local role authenticated;
set local request.jwt.claims = '{"sub":"09100000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select set_config('d910.older', public.request_company_defaults('erpnext','{"bank":"Bank A"}')::text, true);
select set_config('d910.newer', public.request_company_defaults('erpnext','{"cash":"Cash"}')::text, true);
reset role;
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select is(public.record_company_defaults_result('09100000-0000-0000-0000-000000000001', (current_setting('d910.newer')::jsonb->>'id')::uuid,
  '{"payable":"Creditors","expense":"Cost of Goods Sold","cash":"Cash","bank":null,"cost_centre":"Main"}'::jsonb, null)->>'state', 'applied',
  'AC-ECX-021 the newer request for the connection is recorded');
select is(public.record_company_defaults_result('09100000-0000-0000-0000-000000000001', (current_setting('d910.older')::jsonb->>'id')::uuid,
  '{"payable":"Creditors","expense":"Cost of Goods Sold","cash":null,"bank":"Bank A","cost_centre":"Main"}'::jsonb, null)->>'state', 'rejected',
  'AC-ECX-021 an older request whose read-back is recorded last is refused');
select is((select config->>'default_cash_account' || '|' || coalesce(config->>'default_bank_account', '-') from external_org_bindings
            where org_id = '09100000-0000-0000-0000-000000000001'), 'Cash|-',
  'AC-ECX-021 the binding keeps the newer request''s values');
select alike((select reason_text from erp_company_default_requests where id = (current_setting('d910.older')::jsonb->>'id')::uuid),
  '%newer change%', 'the overtaken request says in plain words that a newer change was saved');
reset role;

select * from finish();
rollback;

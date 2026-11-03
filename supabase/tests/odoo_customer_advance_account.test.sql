-- #1506 C4 (migration 0540): customer-advance account selection is an audited, service-only org setting.
-- AC-OCI-018: Admin and Finance select only a live liability account mirrored for the bound Odoo company.
begin;
select plan(25);

insert into organizations (id, name) values
 ('a5400000-0000-0000-0000-000000000001','Advance A'),
 ('a5400000-0000-0000-0000-000000000002','Advance B');
insert into auth.users (id, email) values
 ('a5400000-0000-0000-0000-0000000000a1','a540-admin@example.test'),
 ('a5400000-0000-0000-0000-0000000000f1','a540-finance@example.test'),
 ('a5400000-0000-0000-0000-0000000000e2','a540-exec@example.test'),
 ('a5400000-0000-0000-0000-0000000000a2','a540-pm@example.test'),
 ('a5400000-0000-0000-0000-0000000000e1','a540-engineer@example.test'),
 ('a5400000-0000-0000-0000-0000000000d1','a540-disabled@example.test'),
 ('a5400000-0000-0000-0000-0000000000b1','a540-b-admin@example.test');
insert into profiles (id, org_id, full_name, email, role, status) values
 ('a5400000-0000-0000-0000-0000000000a1','a5400000-0000-0000-0000-000000000001','Admin','a540-admin@example.test','Admin','active'),
 ('a5400000-0000-0000-0000-0000000000f1','a5400000-0000-0000-0000-000000000001','Finance','a540-finance@example.test','Finance','active'),
 ('a5400000-0000-0000-0000-0000000000e2','a5400000-0000-0000-0000-000000000001','Executive','a540-exec@example.test','Executive','active'),
 ('a5400000-0000-0000-0000-0000000000a2','a5400000-0000-0000-0000-000000000001','Project Manager','a540-pm@example.test','Project Manager','active'),
 ('a5400000-0000-0000-0000-0000000000e1','a5400000-0000-0000-0000-000000000001','Engineer','a540-engineer@example.test','Engineer','active'),
 ('a5400000-0000-0000-0000-0000000000d1','a5400000-0000-0000-0000-000000000001','Disabled','a540-disabled@example.test','Admin','disabled'),
 ('a5400000-0000-0000-0000-0000000000b1','a5400000-0000-0000-0000-000000000002','B Admin','a540-b-admin@example.test','Admin','active');
insert into external_org_bindings (org_id, external_tier, site_url, secret_ref, status, config, activated_at) values
 ('a5400000-0000-0000-0000-000000000001','odoo','https://odoo.example.test','a540_a','active','{"database":"db1","odoo_company_id":1}',now()),
 ('a5400000-0000-0000-0000-000000000002','odoo','https://odoo.example.test','a540_b','active','{"database":"db1","odoo_company_id":1}',now());
insert into external_master_records (org_id, external_tier, kind, external_id, name, active, tombstoned_at, attrs, source_write_date) values
 ('a5400000-0000-0000-0000-000000000001','odoo','account','210','Customer Advances',true,null,'{"company_ids":["1"],"account_type":"liability_current"}','2026-11-01 00:00:00'),
 ('a5400000-0000-0000-0000-000000000001','odoo','account','211','Other company advances',true,null,'{"company_ids":["2"],"account_type":"liability_current"}','2026-11-01 00:00:00'),
 ('a5400000-0000-0000-0000-000000000001','odoo','account','212','Income account',true,null,'{"company_ids":["1"],"account_type":"income"}','2026-11-01 00:00:00'),
 ('a5400000-0000-0000-0000-000000000001','odoo','account','216','Payable account',true,null,'{"company_ids":["1"],"account_type":"liability_payable"}','2026-11-01 00:00:00'),
 ('a5400000-0000-0000-0000-000000000001','odoo','account','213','Inactive liability',false,null,'{"company_ids":["1"],"account_type":"liability_current"}','2026-11-01 00:00:00'),
 ('a5400000-0000-0000-0000-000000000001','odoo','account','214','Removed liability',true,now(),'{"company_ids":["1"],"account_type":"liability_current"}','2026-11-01 00:00:00'),
 ('a5400000-0000-0000-0000-000000000002','odoo','account','215','Other org advances',true,null,'{"company_ids":["1"],"account_type":"liability_current"}','2026-11-01 00:00:00');

set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select throws_ok($$select public.set_odoo_customer_advance_account('a5400000-0000-0000-0000-000000000001','a5400000-0000-0000-0000-0000000000e1','account.account:210')$$, '42501', null, 'an Engineer cannot set the customer-advance account');
select throws_ok($$select public.set_odoo_customer_advance_account('a5400000-0000-0000-0000-000000000001','a5400000-0000-0000-0000-0000000000e2','account.account:210')$$, '42501', null, 'an Executive cannot set the customer-advance account');
select throws_ok($$select public.set_odoo_customer_advance_account('a5400000-0000-0000-0000-000000000001','a5400000-0000-0000-0000-0000000000a2','account.account:210')$$, '42501', null, 'a Project Manager cannot set the customer-advance account');
select throws_ok($$select public.set_odoo_customer_advance_account('a5400000-0000-0000-0000-000000000001','a5400000-0000-0000-0000-0000000000d1','account.account:210')$$, '42501', null, 'a disabled Admin cannot set it');
select throws_ok($$select public.set_odoo_customer_advance_account('a5400000-0000-0000-0000-000000000001','a5400000-0000-0000-0000-0000000000b1','account.account:210')$$, '42501', null, 'another organisation''s Admin cannot set it');
select is((select config ? 'customer_advance_account_ref' from external_org_bindings where org_id='a5400000-0000-0000-0000-000000000001' and external_tier='odoo'), false, 'refused setters leave no account selection');

select lives_ok($$select public.set_odoo_customer_advance_account('a5400000-0000-0000-0000-000000000001','a5400000-0000-0000-0000-0000000000a1','account.account:210')$$, 'Admin sets the customer-advance account');
select is((select config->>'customer_advance_account_ref' from external_org_bindings where org_id='a5400000-0000-0000-0000-000000000001' and external_tier='odoo'), 'account.account:210', 'the model-qualified account reference is stored');
select is((select (config->>'customer_advance_account_set_by')::uuid from external_org_bindings where org_id='a5400000-0000-0000-0000-000000000001' and external_tier='odoo'), 'a5400000-0000-0000-0000-0000000000a1'::uuid, 'the setting actor is recorded');
select is((select (config->>'odoo_company_id')::int from external_org_bindings where org_id='a5400000-0000-0000-0000-000000000001' and external_tier='odoo'), 1, 'other Odoo connection settings survive the update');
select is((select count(*)::int from audit_events where action='integration.odoo.customer_advance_account' and org_id='a5400000-0000-0000-0000-000000000001'), 1, 'the change is audited');
select lives_ok($$select public.set_odoo_customer_advance_account('a5400000-0000-0000-0000-000000000001','a5400000-0000-0000-0000-0000000000f1','account.account:210')$$, 'Finance can set the account too');

select throws_ok($$select public.set_odoo_customer_advance_account('a5400000-0000-0000-0000-000000000001','a5400000-0000-0000-0000-0000000000a1','account.account:211')$$, 'P0001', 'customer-advance account is not active in the bound Odoo company', 'an account from another Odoo company is refused');
select throws_ok($$select public.set_odoo_customer_advance_account('a5400000-0000-0000-0000-000000000001','a5400000-0000-0000-0000-0000000000a1','account.account:212')$$, 'P0001', 'customer-advance account is not active in the bound Odoo company', 'an income account is refused');
select throws_ok($$select public.set_odoo_customer_advance_account('a5400000-0000-0000-0000-000000000001','a5400000-0000-0000-0000-0000000000a1','account.account:216')$$, 'P0001', 'customer-advance account is not active in the bound Odoo company', 'a payable account is refused because Odoo cannot post it on a sales invoice line');
select throws_ok($$select public.set_odoo_customer_advance_account('a5400000-0000-0000-0000-000000000001','a5400000-0000-0000-0000-0000000000a1','account.account:213')$$, 'P0001', 'customer-advance account is not active in the bound Odoo company', 'an inactive account is refused');
select throws_ok($$select public.set_odoo_customer_advance_account('a5400000-0000-0000-0000-000000000001','a5400000-0000-0000-0000-0000000000a1','account.account:214')$$, 'P0001', 'customer-advance account is not active in the bound Odoo company', 'a tombstoned account is refused');
select throws_ok($$select public.set_odoo_customer_advance_account('a5400000-0000-0000-0000-000000000001','a5400000-0000-0000-0000-0000000000a1','account.account:999')$$, 'P0001', 'customer-advance account is not active in the bound Odoo company', 'an absent account is refused');
select throws_ok($$select public.set_odoo_customer_advance_account('a5400000-0000-0000-0000-000000000001','a5400000-0000-0000-0000-0000000000a1','210')$$, 'P0001', 'customer-advance account reference is invalid', 'a bare numeric id is refused');
select throws_ok($$select public.set_odoo_customer_advance_account('a5400000-0000-0000-0000-000000000001','a5400000-0000-0000-0000-0000000000a1','account.move:210')$$, 'P0001', 'customer-advance account reference is invalid', 'a different Odoo model is refused');
select throws_ok($$select public.set_odoo_customer_advance_account('a5400000-0000-0000-0000-000000000001','a5400000-0000-0000-0000-0000000000a1','account.account:215')$$, 'P0001', 'customer-advance account is not active in the bound Odoo company', 'an account mirrored only in another org cannot satisfy the lookup');

reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"a5400000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select throws_ok($$select public.set_odoo_customer_advance_account('a5400000-0000-0000-0000-000000000001','a5400000-0000-0000-0000-0000000000a1','account.account:210')$$, '42501', null, 'an authenticated JWT cannot call the setter');
reset role;
select is(has_function_privilege('anon', 'public.set_odoo_customer_advance_account(uuid,uuid,text)', 'execute'), false, 'anon cannot execute the setter');
select is(has_function_privilege('authenticated', 'public.set_odoo_customer_advance_account(uuid,uuid,text)', 'execute'), false, 'authenticated cannot execute the setter');
select is(has_function_privilege('service_role', 'public.set_odoo_customer_advance_account(uuid,uuid,text)', 'execute'), true, 'service_role can execute the setter');

select * from finish();
rollback;

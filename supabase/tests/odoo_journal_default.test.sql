-- #1505 O2 P2 (migration 0509): the `journal` directory kind and the org's default payment journal.
-- AC-OPP-004-adjacent role matrix for FR-OPP-093 / OQ-OPP-6: Admin and Finance set the default, nobody else; a bank or cash
-- journal of this organisation that is live and not tombstoned; the setter is service-role-only and records who set it.
begin;
select plan(22);

insert into organizations (id, name) values
 ('a5090000-0000-0000-0000-000000000001','Journal A'),
 ('a5090000-0000-0000-0000-000000000002','Journal B');
insert into auth.users (id, email) values
 ('a5090000-0000-0000-0000-0000000000a1','a509-admin@example.com'),
 ('a5090000-0000-0000-0000-0000000000f1','a509-finance@example.com'),
 ('a5090000-0000-0000-0000-0000000000e2','a509-exec@example.com'),
 ('a5090000-0000-0000-0000-0000000000a2','a509-pm@example.com'),
 ('a5090000-0000-0000-0000-0000000000e1','a509-eng@example.com'),
 ('a5090000-0000-0000-0000-0000000000b1','a509-b-admin@example.com'),
 ('a5090000-0000-0000-0000-0000000000d9','a509-operator@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
 ('a5090000-0000-0000-0000-0000000000a1','a5090000-0000-0000-0000-000000000001','Admin','a509-admin@example.com','Admin','active'),
 ('a5090000-0000-0000-0000-0000000000f1','a5090000-0000-0000-0000-000000000001','Finance','a509-finance@example.com','Finance','active'),
 ('a5090000-0000-0000-0000-0000000000e2','a5090000-0000-0000-0000-000000000001','Exec','a509-exec@example.com','Executive','active'),
 ('a5090000-0000-0000-0000-0000000000a2','a5090000-0000-0000-0000-000000000001','PM','a509-pm@example.com','Project Manager','active'),
 ('a5090000-0000-0000-0000-0000000000e1','a5090000-0000-0000-0000-000000000001','Eng','a509-eng@example.com','Engineer','active'),
 ('a5090000-0000-0000-0000-0000000000b1','a5090000-0000-0000-0000-000000000002','B Admin','a509-b-admin@example.com','Admin','active'),
 ('a5090000-0000-0000-0000-0000000000d9','a5090000-0000-0000-0000-000000000001','Operator','a509-operator@example.com','Engineer','active');
insert into platform_operators (user_id) values ('a5090000-0000-0000-0000-0000000000d9');
insert into external_org_bindings (org_id, external_tier, site_url, secret_ref, status, config, activated_at) values
 ('a5090000-0000-0000-0000-000000000001','odoo','https://odoo.example.test','a509_a','active','{"database":"db1","odoo_company_id":1}', now()),
 ('a5090000-0000-0000-0000-000000000002','odoo','https://odoo.example.test','a509_b','active','{"database":"db1","odoo_company_id":1}', now());

-- the kind is allowed in the directory mirror
select lives_ok($$insert into external_master_records (org_id, external_tier, kind, external_id, code, name, parent_external_id, active, tombstoned_at, attrs, source_write_date) values
 ('a5090000-0000-0000-0000-000000000001','odoo','journal','11','BNK1','Main bank',null,true,null,'{"type":"bank","company_id":"1"}','2026-11-01 00:00:00'),
 ('a5090000-0000-0000-0000-000000000001','odoo','journal','12','CSH1','Petty cash',null,true,null,'{"type":"cash","company_id":"1"}','2026-11-01 00:00:00'),
 ('a5090000-0000-0000-0000-000000000001','odoo','journal','13','BILL','Vendor bills',null,true,null,'{"type":"purchase","company_id":"1"}','2026-11-01 00:00:00'),
 ('a5090000-0000-0000-0000-000000000001','odoo','journal','14','BNK2','Old bank',null,false,null,'{"type":"bank","company_id":"1"}','2026-11-01 00:00:00'),
 ('a5090000-0000-0000-0000-000000000001','odoo','journal','15','BNK3','Gone bank',null,true,now(),'{"type":"bank","company_id":"1"}','2026-11-01 00:00:00'),
 ('a5090000-0000-0000-0000-000000000002','odoo','journal','21','BNKB','B bank',null,true,null,'{"type":"bank","company_id":"1"}','2026-11-01 00:00:00')$$,
  'FR-OPP-093 external_master_records accepts the journal kind');
select throws_ok($$insert into external_master_records (org_id, external_tier, kind, external_id, name, source_write_date) values
 ('a5090000-0000-0000-0000-000000000001','odoo','nonsense','99','x','2026-11-01 00:00:00')$$, '23514', null, 'the kind list is still closed');

set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select lives_ok($$select public.apply_odoo_master_page('a5090000-0000-0000-0000-000000000001','journal','[]'::jsonb,'{"w":null,"id":0,"scan":null}')$$,
  'apply_odoo_master_page takes the journal kind (assert_odoo_master_kind agrees with the table)');

-- who may set the default
select throws_ok($$select public.set_odoo_payment_journal_default('a5090000-0000-0000-0000-000000000001','a5090000-0000-0000-0000-0000000000e1','11')$$, '42501', null, 'an Engineer cannot set the default journal');
select throws_ok($$select public.set_odoo_payment_journal_default('a5090000-0000-0000-0000-000000000001','a5090000-0000-0000-0000-0000000000a2','11')$$, '42501', null, 'a Project Manager cannot');
select throws_ok($$select public.set_odoo_payment_journal_default('a5090000-0000-0000-0000-000000000001','a5090000-0000-0000-0000-0000000000e2','11')$$, '42501', null, 'an Executive cannot');
select throws_ok($$select public.set_odoo_payment_journal_default('a5090000-0000-0000-0000-000000000001','a5090000-0000-0000-0000-0000000000b1','11')$$, '42501', null, 'another organisation''s Admin cannot');
select is((select config ? 'default_payment_journal_id' from external_org_bindings where org_id='a5090000-0000-0000-0000-000000000001' and external_tier='odoo'), false,
  'no refused call wrote the default');
select lives_ok($$select public.set_odoo_payment_journal_default('a5090000-0000-0000-0000-000000000001','a5090000-0000-0000-0000-0000000000a1','11')$$, 'the Admin sets the default journal');
select is((select (config->>'default_payment_journal_id')::int from external_org_bindings where org_id='a5090000-0000-0000-0000-000000000001' and external_tier='odoo'), 11, 'the journal id is stored as the integer Odoo uses');
select is((select (config->>'default_payment_journal_id_set_by')::uuid from external_org_bindings where org_id='a5090000-0000-0000-0000-000000000001' and external_tier='odoo'), 'a5090000-0000-0000-0000-0000000000a1'::uuid, 'the user who set it is recorded');
select is((select count(*)::int from audit_events where action='integration.odoo.payment_journal' and org_id='a5090000-0000-0000-0000-000000000001'), 1, 'the change is audited');
select lives_ok($$select public.set_odoo_payment_journal_default('a5090000-0000-0000-0000-000000000001','a5090000-0000-0000-0000-0000000000f1','12')$$, 'Finance changes it to a cash journal');
select is((select (config->>'default_payment_journal_id')::int from external_org_bindings where org_id='a5090000-0000-0000-0000-000000000001' and external_tier='odoo'), 12, 'the new default replaced the old');
select is((select (config->>'odoo_company_id')::int from external_org_bindings where org_id='a5090000-0000-0000-0000-000000000001' and external_tier='odoo'), 1, 'sibling config keys survive the merge');
select lives_ok($$select public.set_odoo_payment_journal_default('a5090000-0000-0000-0000-000000000001','a5090000-0000-0000-0000-0000000000d9','11')$$, 'a platform Operator may set it');

-- which journals qualify
select throws_ok($$select public.set_odoo_payment_journal_default('a5090000-0000-0000-0000-000000000001','a5090000-0000-0000-0000-0000000000a1','13')$$, 'P0001', 'not a bank or cash journal of this connection', 'a purchase journal is refused');
select throws_ok($$select public.set_odoo_payment_journal_default('a5090000-0000-0000-0000-000000000001','a5090000-0000-0000-0000-0000000000a1','14')$$, 'P0001', 'not a bank or cash journal of this connection', 'an inactive journal is refused');
select throws_ok($$select public.set_odoo_payment_journal_default('a5090000-0000-0000-0000-000000000001','a5090000-0000-0000-0000-0000000000a1','15')$$, 'P0001', 'not a bank or cash journal of this connection', 'a journal Odoo no longer returns is refused');
select throws_ok($$select public.set_odoo_payment_journal_default('a5090000-0000-0000-0000-000000000001','a5090000-0000-0000-0000-0000000000a1','21')$$, 'P0001', 'not a bank or cash journal of this connection', 'another organisation''s journal is refused');
select throws_ok($$select public.set_odoo_payment_journal_default('a5090000-0000-0000-0000-000000000001','a5090000-0000-0000-0000-0000000000a1','abc')$$, 'P0001', 'not a bank or cash journal of this connection', 'a non-numeric id is refused');

-- service-role only
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"a5090000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select throws_ok($$select public.set_odoo_payment_journal_default('a5090000-0000-0000-0000-000000000001','a5090000-0000-0000-0000-0000000000a1','11')$$, '42501', null, 'a user JWT cannot call the setter');

select * from finish();
rollback;

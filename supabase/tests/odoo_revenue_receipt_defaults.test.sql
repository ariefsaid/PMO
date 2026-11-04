-- AC-OCI-046/052: Odoo receipt configuration and held-command resolution use the verified actor.
begin;
select plan(25);

insert into organizations (id, name) values
 ('a5120000-0000-0000-0000-000000000001','Receipt A'),
 ('a5120000-0000-0000-0000-000000000002','Receipt B');
insert into auth.users (id, email) values
 ('a5120000-0000-0000-0000-0000000000a1','receipt-admin@example.com'),
 ('a5120000-0000-0000-0000-0000000000f1','receipt-finance@example.com'),
 ('a5120000-0000-0000-0000-0000000000e1','receipt-engineer@example.com'),
 ('a5120000-0000-0000-0000-0000000000e2','receipt-operator@example.com'),
 ('a5120000-0000-0000-0000-0000000000b1','receipt-b-admin@example.com'),
 ('a5120000-0000-0000-0000-0000000000c1','receipt-creator@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
 ('a5120000-0000-0000-0000-0000000000a1','a5120000-0000-0000-0000-000000000001','Admin','receipt-admin@example.com','Admin','active'),
 ('a5120000-0000-0000-0000-0000000000f1','a5120000-0000-0000-0000-000000000001','Finance','receipt-finance@example.com','Finance','active'),
 ('a5120000-0000-0000-0000-0000000000e1','a5120000-0000-0000-0000-000000000001','Engineer','receipt-engineer@example.com','Engineer','active'),
 ('a5120000-0000-0000-0000-0000000000e2','a5120000-0000-0000-0000-000000000001','Operator','receipt-operator@example.com','Engineer','active'),
 ('a5120000-0000-0000-0000-0000000000b1','a5120000-0000-0000-0000-000000000002','Other Admin','receipt-b-admin@example.com','Admin','active'),
 ('a5120000-0000-0000-0000-0000000000c1','a5120000-0000-0000-0000-000000000001','Creator','receipt-creator@example.com','Finance','active');
insert into platform_operators (user_id) values ('a5120000-0000-0000-0000-0000000000e2');
insert into external_org_bindings (org_id, external_tier, site_url, secret_ref, status, config, activated_at) values
 ('a5120000-0000-0000-0000-000000000001','odoo','https://odoo.example.test','','active','{"odoo_company_id":1}',now()),
 ('a5120000-0000-0000-0000-000000000002','odoo','https://odoo.example.test','','active','{"odoo_company_id":2}',now());
insert into external_master_records (org_id, external_tier, kind, external_id, code, name, parent_external_id, active, tombstoned_at, attrs, source_write_date) values
 ('a5120000-0000-0000-0000-000000000001','odoo','account','401','1001','Tax Prepaid',null,true,null,'{"account_type":"asset_current","company_ids":["1"]}','2026-11-01 00:00:00'),
 ('a5120000-0000-0000-0000-000000000001','odoo','account','402','2001','Payables',null,true,null,'{"account_type":"liability_payable","company_ids":["1"]}','2026-11-01 00:00:00'),
 ('a5120000-0000-0000-0000-000000000001','odoo','account','403','1002','Inactive tax account',null,false,null,'{"account_type":"asset_current","company_ids":["1"]}','2026-11-01 00:00:00'),
 ('a5120000-0000-0000-0000-000000000002','odoo','account','401','1001','Other org tax account',null,true,null,'{"account_type":"asset_current","company_ids":["2"]}','2026-11-01 00:00:00');

select ok(has_function_privilege('service_role','public.set_odoo_tax_prepaid_account(uuid,uuid,text)','execute'),
  'AC-OCI-046 the tax-prepaid setter is callable by the service role');
select ok(not has_function_privilege('authenticated','public.set_odoo_tax_prepaid_account(uuid,uuid,text)','execute')
          and not has_function_privilege('anon','public.set_odoo_tax_prepaid_account(uuid,uuid,text)','execute'),
  'AC-OCI-046 the tax-prepaid setter is not directly callable by a user JWT');
select ok((select prosecdef and proconfig @> array['search_path=public, pg_temp']
  from pg_proc where oid='public.set_odoo_tax_prepaid_account(uuid,uuid,text)'::regprocedure),
  'AC-OCI-046 the setter is a pinned security definer');

set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select throws_ok($$select public.set_odoo_tax_prepaid_account('a5120000-0000-0000-0000-000000000001','a5120000-0000-0000-0000-0000000000e1','401')$$,
  '42501',null,'AC-OCI-046 an Engineer cannot set the tax-prepaid account');
select throws_ok($$select public.set_odoo_tax_prepaid_account('a5120000-0000-0000-0000-000000000001','a5120000-0000-0000-0000-0000000000e2','401')$$,
  '42501',null,'AC-OCI-046 a platform Operator cannot set the tax-prepaid account');
select throws_ok($$select public.set_odoo_tax_prepaid_account('a5120000-0000-0000-0000-000000000001','a5120000-0000-0000-0000-0000000000b1','401')$$,
  '42501',null,'AC-OCI-046 another organisation Admin cannot set the account');
select is((select config ? 'tax_prepaid_account_id' from external_org_bindings where org_id='a5120000-0000-0000-0000-000000000001' and external_tier='odoo'),false,
  'AC-OCI-046 refused actors leave the binding unchanged');
select throws_ok($$select public.set_odoo_tax_prepaid_account('a5120000-0000-0000-0000-000000000001','a5120000-0000-0000-0000-0000000000a1','402')$$,
  'P0001','not a tax-prepaid account of this connection','AC-OCI-046 a liability account is refused');
select throws_ok($$select public.set_odoo_tax_prepaid_account('a5120000-0000-0000-0000-000000000001','a5120000-0000-0000-0000-0000000000a1','403')$$,
  'P0001','not a tax-prepaid account of this connection','AC-OCI-046 an inactive account is refused');
select throws_ok($$select public.set_odoo_tax_prepaid_account('a5120000-0000-0000-0000-000000000001','a5120000-0000-0000-0000-0000000000a1','401x')$$,
  'P0001','not a tax-prepaid account of this connection','AC-OCI-046 a malformed account id is refused');
select throws_ok($$select public.set_odoo_tax_prepaid_account('a5120000-0000-0000-0000-000000000001','a5120000-0000-0000-0000-0000000000a1','999')$$,
  'P0001','not a tax-prepaid account of this connection','AC-OCI-046 an account outside the directory is refused');
select lives_ok($$select public.set_odoo_tax_prepaid_account('a5120000-0000-0000-0000-000000000001','a5120000-0000-0000-0000-0000000000a1','401')$$,
  'AC-OCI-046 the Admin sets the default tax-prepaid account');
select is((select (config->>'tax_prepaid_account_id')::int from external_org_bindings where org_id='a5120000-0000-0000-0000-000000000001' and external_tier='odoo'),401,
  'AC-OCI-046 the selected account is stored');
select is((select (config->>'tax_prepaid_account_id_set_by')::uuid from external_org_bindings where org_id='a5120000-0000-0000-0000-000000000001' and external_tier='odoo'),
  'a5120000-0000-0000-0000-0000000000a1'::uuid,'AC-OCI-046 the verified actor is recorded');
select is((select count(*)::int from audit_events where action='integration.odoo.tax_prepaid_account'
  and org_id='a5120000-0000-0000-0000-000000000001' and actor_id='a5120000-0000-0000-0000-0000000000a1'),1,
  'AC-OCI-046 the default change is audited');
select lives_ok($$select public.set_odoo_tax_prepaid_account('a5120000-0000-0000-0000-000000000001','a5120000-0000-0000-0000-0000000000f1','401')$$,
  'AC-OCI-046 Finance may set the default account');
select is((select (config->>'odoo_company_id')::int from external_org_bindings where org_id='a5120000-0000-0000-0000-000000000001' and external_tier='odoo'),1,
  'AC-OCI-046 unrelated binding config survives the update');
select is((select config->>'tax_prepaid_account_id' from external_org_bindings where org_id='a5120000-0000-0000-0000-000000000002' and external_tier='odoo'),null,
  'AC-OCI-046 a second org binding is untouched');

insert into external_command_outbox (id,org_id,domain,pmo_record_id,idempotency_key,external_tier,operation,state,actor_user_id,payload)
values
 ('a5120000-0000-0000-0000-0000000000f1','a5120000-0000-0000-0000-000000000001','revenue','a5120000-0000-0000-0000-0000000000d1','receipt-held-1','odoo','create','held','a5120000-0000-0000-0000-0000000000c1','{"erp_doc_kind":"incoming-payment","salesInvoiceId":"a5120000-0000-0000-0000-0000000000d2"}'),
 ('a5120000-0000-0000-0000-0000000000f2','a5120000-0000-0000-0000-000000000001','revenue','a5120000-0000-0000-0000-0000000000d3','receipt-held-2','odoo','create','held','a5120000-0000-0000-0000-0000000000c1','{"erp_doc_kind":"incoming-payment","salesInvoiceId":"a5120000-0000-0000-0000-0000000000d4"}'),
 ('a5120000-0000-0000-0000-0000000000f3','a5120000-0000-0000-0000-000000000001','revenue','a5120000-0000-0000-0000-0000000000d5','receipt-inflight-1','odoo','create','pending','a5120000-0000-0000-0000-0000000000c1','{"erp_doc_kind":"incoming-payment","salesInvoiceId":"a5120000-0000-0000-0000-0000000000d6"}');
select throws_ok($$insert into external_command_outbox (id,org_id,domain,pmo_record_id,idempotency_key,external_tier,operation,state,actor_user_id,payload)
 values ('a5120000-0000-0000-0000-0000000000f4','a5120000-0000-0000-0000-000000000001','revenue','a5120000-0000-0000-0000-0000000000d7','receipt-inflight-2','odoo','create','pending','a5120000-0000-0000-0000-0000000000c1','{"erp_doc_kind":"incoming-payment","salesInvoiceId":"a5120000-0000-0000-0000-0000000000d6"}')$$,
  '23505',null,'AC-OCI-040 only one Odoo receipt may be in flight for an invoice');
update external_command_outbox set state='confirmed' where id='a5120000-0000-0000-0000-0000000000f3';
select lives_ok($$insert into external_command_outbox (id,org_id,domain,pmo_record_id,idempotency_key,external_tier,operation,state,actor_user_id,payload)
 values ('a5120000-0000-0000-0000-0000000000f5','a5120000-0000-0000-0000-000000000001','revenue','a5120000-0000-0000-0000-0000000000d8','receipt-inflight-3','odoo','create','pending','a5120000-0000-0000-0000-0000000000c1','{"erp_doc_kind":"incoming-payment","salesInvoiceId":"a5120000-0000-0000-0000-0000000000d6"}')$$,
  'AC-OCI-040 a confirmed receipt releases the invoice for another partial receipt');

reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"a5120000-0000-0000-0000-0000000000c1","role":"authenticated"}';
select throws_ok($$select public.resolve_held_outbox_command('a5120000-0000-0000-0000-0000000000f1','absent',null,'checked')$$,
  '42501',null,'AC-OCI-052 the creator cannot resolve their own held receipt');
set local request.jwt.claims = '{"sub":"a5120000-0000-0000-0000-0000000000e1","role":"authenticated"}';
select throws_ok($$select public.resolve_held_outbox_command('a5120000-0000-0000-0000-0000000000f1','absent',null,'checked')$$,
  '42501',null,'AC-OCI-052 an Engineer cannot resolve a held receipt');
set local request.jwt.claims = '{"sub":"a5120000-0000-0000-0000-0000000000f1","role":"authenticated"}';
select lives_ok($$select public.resolve_held_outbox_command('a5120000-0000-0000-0000-0000000000f1','absent',null,'verified absent')$$,
  'AC-OCI-052 a different Finance member confirms absence');
set local request.jwt.claims = '{"sub":"a5120000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select lives_ok($$select public.resolve_held_outbox_command('a5120000-0000-0000-0000-0000000000f2','adopt','account.payment:91','receipt located')$$,
  'AC-OCI-052 a different Admin can adopt a named Odoo receipt');
select is((select count(*)::int from audit_events where action='resolve_held_outbox_command'
  and entity_id in ('a5120000-0000-0000-0000-0000000000f1','a5120000-0000-0000-0000-0000000000f2')
  and actor_id in ('a5120000-0000-0000-0000-0000000000f1','a5120000-0000-0000-0000-0000000000a1')),2,
  'AC-OCI-052 receipt decisions record the resolving actor');

select * from finish();
rollback;

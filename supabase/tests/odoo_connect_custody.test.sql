-- Odoo connect custody (#1504 S2, migration 0420): the atomic stage → finalize commit, set-once activation,
-- reconnect/discard, disconnect, and the reference column hidden from every signed-in reader.
begin;
select plan(72);

insert into organizations (id, name) values
 ('a4200000-0000-0000-0000-000000000001','Odoo Org A'),
 ('a4200000-0000-0000-0000-000000000002','Odoo Org B');
insert into auth.users (id, email) values
 ('a4200000-0000-0000-0000-0000000000a1','a420-admin@example.com'),
 ('a4200000-0000-0000-0000-0000000000f1','a420-finance@example.com'),
 ('a4200000-0000-0000-0000-0000000000c1','a420-pm@example.com'),
 ('a4200000-0000-0000-0000-0000000000e1','a420-eng@example.com'),
 ('a4200000-0000-0000-0000-0000000000d1','a420-disabled@example.com'),
 ('a4200000-0000-0000-0000-000000000099','a420-operator@example.com'),
 ('a4200000-0000-0000-0000-0000000000b1','a420-b-admin@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
 ('a4200000-0000-0000-0000-0000000000a1','a4200000-0000-0000-0000-000000000001','Admin','a420-admin@example.com','Admin','active'),
 ('a4200000-0000-0000-0000-0000000000f1','a4200000-0000-0000-0000-000000000001','Finance','a420-finance@example.com','Finance','active'),
 ('a4200000-0000-0000-0000-0000000000c1','a4200000-0000-0000-0000-000000000001','PM','a420-pm@example.com','Project Manager','active'),
 ('a4200000-0000-0000-0000-0000000000e1','a4200000-0000-0000-0000-000000000001','Engineer','a420-eng@example.com','Engineer','active'),
 ('a4200000-0000-0000-0000-0000000000d1','a4200000-0000-0000-0000-000000000001','Disabled','a420-disabled@example.com','Admin','disabled'),
 ('a4200000-0000-0000-0000-000000000099','a4200000-0000-0000-0000-000000000002','Operator','a420-operator@example.com','Engineer','active'),
 ('a4200000-0000-0000-0000-0000000000b1','a4200000-0000-0000-0000-000000000002','B Admin','a420-b-admin@example.com','Admin','active');
insert into platform_operators (user_id) values ('a4200000-0000-0000-0000-000000000099');

-- AC-ODC-009 every new RPC is service-role-only.
select is(has_function_privilege('authenticated','public.finalize_odoo_connect(uuid,text,text,text,date,boolean,boolean,uuid)','execute'), false, 'AC-ODC-009 finalize_odoo_connect is not executable by authenticated');
select is(has_function_privilege('anon','public.finalize_odoo_connect(uuid,text,text,text,date,boolean,boolean,uuid)','execute'), false, 'AC-ODC-009 finalize_odoo_connect is not executable by anon');
select is(has_function_privilege('service_role','public.finalize_odoo_connect(uuid,text,text,text,date,boolean,boolean,uuid)','execute'), true, 'AC-ODC-009 finalize_odoo_connect is executable by service_role');
select is(has_function_privilege('authenticated','public.activate_odoo_binding(uuid,int,int,text,jsonb,uuid)','execute'), false, 'AC-ODC-009 activate_odoo_binding is not executable by authenticated');
select is(has_function_privilege('authenticated','public.assert_odoo_activated(uuid)','execute'), false, 'AC-ODC-009 assert_odoo_activated is not executable by authenticated');
select is(has_function_privilege('service_role','public.discard_odoo_mirror(uuid,uuid)','execute'), false, 'AC-ODC-009 discard_odoo_mirror is callable only from inside finalize');
select throws_ok($$select public.finalize_odoo_connect('a4200000-0000-0000-0000-000000000001','x','https://o.example.test','db',null,false,true,'a4200000-0000-0000-0000-0000000000a1')$$,
  '42501', 'service role required', 'AC-ODC-009 a non-service caller is refused by finalize''s own guard');

-- AC-ODC-004 an active ERPNext binding blocks the Odoo commit; cleanup leaves no Odoo row and no secret.
insert into external_org_bindings (org_id, external_tier, site_url, secret_ref, status)
 values ('a4200000-0000-0000-0000-000000000001','erpnext','https://erp.example.test','a420_erp','active');
set local role service_role;
select public.stage_vault_secret_for_org('a4200000-0000-0000-0000-000000000001','odoo','k1','a420_s1','a4200000-0000-0000-0000-0000000000a1');
select throws_ok($$select public.finalize_odoo_connect('a4200000-0000-0000-0000-000000000001','a420_s1','https://o.example.test','db1',null,false,true,'a4200000-0000-0000-0000-0000000000a1')$$,
  'P0001', 'another ERP tier is active', 'AC-ODC-004 finalize refuses while another ERP tier is active');
select public.cleanup_external_connect_attempt('a4200000-0000-0000-0000-000000000001','odoo','a420_s1','a4200000-0000-0000-0000-0000000000a1');
reset role;
select is((select count(*)::int from external_org_bindings where org_id='a4200000-0000-0000-0000-000000000001' and external_tier='odoo'), 0, 'AC-ODC-004 after cleanup no Odoo binding remains');
select is((select count(*)::int from vault.secrets where name='a420_s1'), 0, 'AC-ODC-004 after cleanup the staged secret is gone');
update external_org_bindings set status='disconnected' where org_id='a4200000-0000-0000-0000-000000000001' and external_tier='erpnext';

-- AC-ODC-004 kill switch off → refused; cleanup leaves no active row, no secret.
set local role service_role;
select public.stage_vault_secret_for_org('a4200000-0000-0000-0000-000000000001','odoo','k2','a420_s2','a4200000-0000-0000-0000-0000000000a1');
select throws_ok($$select public.finalize_odoo_connect('a4200000-0000-0000-0000-000000000001','a420_s2','https://o.example.test','db1',null,false,false,'a4200000-0000-0000-0000-0000000000a1')$$,
  'P0001', 'integration disabled by operator', 'AC-ODC-004 finalize refuses with the kill switch off');
select public.cleanup_external_connect_attempt('a4200000-0000-0000-0000-000000000001','odoo','a420_s2','a4200000-0000-0000-0000-0000000000a1');
reset role;
select is((select count(*)::int from external_org_bindings where org_id='a4200000-0000-0000-0000-000000000001' and external_tier='odoo' and status='active'), 0, 'AC-ODC-004 kill switch: no active Odoo binding remains');
select is((select count(*)::int from vault.secrets where name='a420_s2'), 0, 'AC-ODC-004 kill switch: no staged secret remains');

-- AC-ODC-009 / AC-ODC-005 the actor matrix on a staged attempt, and activation before finalize.
set local role service_role;
select public.stage_vault_secret_for_org('a4200000-0000-0000-0000-000000000001','odoo','k3','a420_s3','a4200000-0000-0000-0000-0000000000a1');
select throws_ok($$select public.activate_odoo_binding('a4200000-0000-0000-0000-000000000001',20,1,'Main Co','{}','a4200000-0000-0000-0000-0000000000a1')$$,
  'P0001', 'binding is not connectable', 'AC-ODC-005 activation before finalize is refused');
select throws_ok($$select public.finalize_odoo_connect('a4200000-0000-0000-0000-000000000001','a420_s3','https://o.example.test','db1',null,false,true,'a4200000-0000-0000-0000-0000000000f1')$$,
  '42501', null, 'AC-ODC-009 a Finance actor cannot finalize');
select throws_ok($$select public.finalize_odoo_connect('a4200000-0000-0000-0000-000000000001','a420_s3','https://o.example.test','db1',null,false,true,'a4200000-0000-0000-0000-0000000000c1')$$,
  '42501', null, 'AC-ODC-009 a Project Manager actor cannot finalize');
select throws_ok($$select public.finalize_odoo_connect('a4200000-0000-0000-0000-000000000001','a420_s3','https://o.example.test','db1',null,false,true,'a4200000-0000-0000-0000-0000000000e1')$$,
  '42501', null, 'AC-ODC-009 an Engineer actor cannot finalize');
select throws_ok($$select public.finalize_odoo_connect('a4200000-0000-0000-0000-000000000001','a420_s3','https://o.example.test','db1',null,false,true,'a4200000-0000-0000-0000-0000000000d1')$$,
  '42501', null, 'AC-ODC-009 a disabled Admin cannot finalize');
select throws_ok($$select public.finalize_odoo_connect('a4200000-0000-0000-0000-000000000001','a420_s3','https://o.example.test','db1',null,false,true,'a4200000-0000-0000-0000-0000000000b1')$$,
  '42501', null, 'AC-ODC-009 another org''s Admin cannot finalize for this org (spoofed org id)');
select throws_ok($$select public.finalize_odoo_connect('a4200000-0000-0000-0000-000000000001','a420_s3','https://o.example.test','db1',null,false,true,null)$$,
  '42501', null, 'AC-ODC-009 finalize with no actor is refused');
select throws_ok($$select public.finalize_odoo_connect('a4200000-0000-0000-0000-000000000001','a420_s3','https://o.example.test',' ',null,false,true,'a4200000-0000-0000-0000-0000000000a1')$$,
  '22023', null, 'FR-ODC-001 finalize refuses a blank database');
select is(public.finalize_odoo_connect('a4200000-0000-0000-0000-000000000001','a420_s3','https://o.example.test','db1','2027-01-31',false,true,'a4200000-0000-0000-0000-000000000099'), 'active', 'AC-ODC-009 the platform operator can finalize');
reset role;
select is((select site_url || '|' || (config->>'database') || '|' || (config->>'key_expires_on') from external_org_bindings where org_id='a4200000-0000-0000-0000-000000000001' and external_tier='odoo'),
  'https://o.example.test|db1|2027-01-31', 'FR-ODC-003 finalize records site, database and declared expiry');
select ok((select not (config ? 'prev_binding') and activated_at is null from external_org_bindings where org_id='a4200000-0000-0000-0000-000000000001' and external_tier='odoo'), 'FR-ODC-005 a fresh connect is not activated and carries no rotation marker');

-- AC-ODC-005 set-once activation.
set local role service_role;
select throws_ok($$select public.assert_odoo_activated('a4200000-0000-0000-0000-000000000001')$$, 'P0001', 'Odoo connection is not activated', 'AC-ODC-005 assert_odoo_activated refuses before activation');
select throws_ok($$select public.activate_odoo_binding('a4200000-0000-0000-0000-000000000001',20,1,'Main Co','{}','a4200000-0000-0000-0000-0000000000f1')$$,
  '42501', null, 'AC-ODC-009 a Finance actor cannot activate');
select throws_ok($$select public.activate_odoo_binding('a4200000-0000-0000-0000-000000000001',20,1,'Main Co','{}','a4200000-0000-0000-0000-0000000000b1')$$,
  '42501', null, 'AC-ODC-009 another org''s Admin cannot activate');
select throws_ok($$select public.activate_odoo_binding('a4200000-0000-0000-0000-000000000001',20,1,'Main Co','{}','a4200000-0000-0000-0000-0000000000d1')$$,
  '42501', null, 'AC-ODC-009 a disabled Admin cannot activate');
select throws_ok($$select public.activate_odoo_binding('a4200000-0000-0000-0000-000000000001',19,1,'Main Co','{}','a4200000-0000-0000-0000-0000000000a1')$$,
  'P0001', null, 'FR-ODC-022 activation refuses an Odoo major below the tested minimum');
select throws_ok($$select public.activate_odoo_binding('a4200000-0000-0000-0000-000000000001',20,null,'Main Co','{}','a4200000-0000-0000-0000-0000000000a1')$$,
  '22023', null, 'AC-ODC-005 activation requires a company');
create temp table a420_stamp as select public.activate_odoo_binding('a4200000-0000-0000-0000-000000000001',20,1,'Main Co','{}','a4200000-0000-0000-0000-0000000000a1') as t;
select ok((select t is not null from a420_stamp), 'AC-ODC-005 activation returns its timestamp');
select is(public.activate_odoo_binding('a4200000-0000-0000-0000-000000000001',20,1,'Main Co','{}','a4200000-0000-0000-0000-0000000000a1'), (select t from a420_stamp), 'AC-ODC-005 re-activating with the same company keeps the first timestamp');
select throws_ok($$select public.activate_odoo_binding('a4200000-0000-0000-0000-000000000001',20,2,'Second Co','{}','a4200000-0000-0000-0000-0000000000a1')$$,
  'P0001', 'company already chosen', 'AC-ODC-005 activation with another company is refused');
select lives_ok($$select public.assert_odoo_activated('a4200000-0000-0000-0000-000000000001')$$, 'AC-ODC-005 assert_odoo_activated passes after activation');

-- FR-ODC-005 the activation patch never overwrites the keys finalize and activation own.
select public.activate_odoo_binding('a4200000-0000-0000-0000-000000000001',20,1,'Main Co','{"database":"other","prev_binding":{"secret_ref":"x"},"odoo_company_name":"Spoof","note":"kept"}','a4200000-0000-0000-0000-0000000000a1');
select throws_ok($$select public.activate_odoo_binding('a4200000-0000-0000-0000-000000000001',20,1,'Main Co','[1]','a4200000-0000-0000-0000-0000000000a1')$$,
  '22023', 'config patch must be a JSON object', 'FR-ODC-005 activation refuses a patch that is not an object');

-- FR-ODC-008 in the database: the old connect RPC cannot connect Odoo, nor a second ERP while Odoo is active.
select throws_ok($$select public.create_vault_secret_for_org('a4200000-0000-0000-0000-000000000001','odoo','k-old','a420_old1','a4200000-0000-0000-0000-0000000000a1')$$,
  'P0001', 'odoo connects through stage and finalize', 'FR-ODC-008 create_vault_secret_for_org refuses tier odoo (service role)');
select throws_ok($$select public.create_vault_secret_for_org('a4200000-0000-0000-0000-000000000001','erpnext','k-erp','a420_old2','a4200000-0000-0000-0000-0000000000a1')$$,
  'P0001', 'another ERP tier is active', 'FR-ODC-008 create_vault_secret_for_org refuses ERPNext while Odoo is active');
select throws_ok($$select public.activate_external_binding('a4200000-0000-0000-0000-000000000001','erpnext',15,'ERP Co','{}','a4200000-0000-0000-0000-0000000000a1')$$,
  'P0001', 'another ERP tier is active', 'FR-ODC-008 activate_external_binding refuses ERPNext while Odoo is active');
reset role;
select ok((select config->>'database' = 'db1' and not (config ? 'prev_binding') and config->>'odoo_company_name' = 'Main Co' and config->>'note' = 'kept'
             from external_org_bindings where org_id='a4200000-0000-0000-0000-000000000001' and external_tier='odoo'),
  'FR-ODC-005 a patch cannot replace the database, the rotation marker or the company name; other keys merge');
set local role authenticated;
set local request.jwt.claims = '{"sub":"a4200000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select throws_ok($$select public.create_vault_secret_for_org('a4200000-0000-0000-0000-000000000001','odoo','k-jwt','a420_old3')$$,
  'P0001', 'odoo connects through stage and finalize', 'FR-ODC-008 an Admin JWT calling the old connect RPC cannot connect Odoo');
reset role;
select is((select count(*)::int from vault.secrets where name in ('a420_old1','a420_old2','a420_old3')), 0, 'FR-ODC-008 the refused old-RPC calls stored no key');
select is((select status from external_org_bindings where org_id='a4200000-0000-0000-0000-000000000001' and external_tier='erpnext'), 'disconnected', 'FR-ODC-008 the ERPNext row stays disconnected');

-- AC-ODC-006 reconnect with a new key keeps the mirror; the old secret goes only at the commit.
insert into projects (id, org_id, name, status) values ('a4200000-0000-0000-0000-000000000098','a4200000-0000-0000-0000-000000000001','Odoo P','Ongoing Project');
insert into external_sync_watermarks (org_id, external_tier, domain, watermark_cursor) values ('a4200000-0000-0000-0000-000000000001','odoo','master:partner','{"w":"2026-01-01 00:00:00","id":3}');
insert into external_project_bindings (org_id, project_id, external_tier, external_container_id) values ('a4200000-0000-0000-0000-000000000001','a4200000-0000-0000-0000-000000000098','odoo','7');
set local role service_role;
select public.stage_vault_secret_for_org('a4200000-0000-0000-0000-000000000001','odoo','k4','a420_s4','a4200000-0000-0000-0000-0000000000a1');
reset role;
select is((select count(*)::int from vault.secrets where name='a420_s3'), 1, 'AC-ODC-006 the previous secret survives while the reconnect is staged');
set local role service_role;
select is(public.finalize_odoo_connect('a4200000-0000-0000-0000-000000000001','a420_s4','https://o.example.test','db1',null,false,true,'a4200000-0000-0000-0000-0000000000a1'), 'active', 'AC-ODC-006 a same-database reconnect commits');
reset role;
select is((select count(*)::int from vault.secrets where name='a420_s3'), 0, 'AC-ODC-006 the previous secret is revoked once the reconnect commits');
select is((select count(*)::int from vault.secrets where name='a420_s4'), 1, 'AC-ODC-006 the new secret is kept');
select is((select count(*)::int from external_sync_watermarks where org_id='a4200000-0000-0000-0000-000000000001' and external_tier='odoo'), 1, 'AC-ODC-006 watermarks are unchanged by a same-database reconnect');
select is((select count(*)::int from external_project_bindings where org_id='a4200000-0000-0000-0000-000000000001' and external_tier='odoo'), 1, 'AC-ODC-006 project links are unchanged by a same-database reconnect');
select is((select activated_at from external_org_bindings where org_id='a4200000-0000-0000-0000-000000000001' and external_tier='odoo'), (select t from a420_stamp), 'AC-ODC-006 a same-database reconnect stays activated');

-- AC-ODC-006 another database: refused without the discard confirmation, refused outright while documents reference it.
set local role service_role;
select public.stage_vault_secret_for_org('a4200000-0000-0000-0000-000000000001','odoo','k5','a420_s5','a4200000-0000-0000-0000-0000000000a1');
select throws_ok($$select public.finalize_odoo_connect('a4200000-0000-0000-0000-000000000001','a420_s5','https://o.example.test','db2',null,false,true,'a4200000-0000-0000-0000-0000000000a1')$$,
  'P0001', 'different Odoo database; confirm discard', 'AC-ODC-006 another database without confirmation is refused');
select public.cleanup_external_connect_attempt('a4200000-0000-0000-0000-000000000001','odoo','a420_s5','a4200000-0000-0000-0000-0000000000a1');
reset role;
select is((select secret_ref from external_org_bindings where org_id='a4200000-0000-0000-0000-000000000001' and external_tier='odoo'), 'a420_s4', 'AC-ODC-006 a refused reconnect restores the prior key');
insert into external_command_outbox (org_id, domain, pmo_record_id, idempotency_key, external_tier, operation, state)
 values ('a4200000-0000-0000-0000-000000000001','companies','a420-co','seed:party:a420-co','odoo','create','pending');
set local role service_role;
select public.stage_vault_secret_for_org('a4200000-0000-0000-0000-000000000001','odoo','k6','a420_s6','a4200000-0000-0000-0000-0000000000a1');
select throws_ok($$select public.finalize_odoo_connect('a4200000-0000-0000-0000-000000000001','a420_s6','https://o.example.test','db2',null,true,true,'a4200000-0000-0000-0000-0000000000a1')$$,
  'P0001', 'Odoo documents already reference this connection', 'AC-ODC-006 a discard is refused while an Odoo document references the connection');
select public.cleanup_external_connect_attempt('a4200000-0000-0000-0000-000000000001','odoo','a420_s6','a4200000-0000-0000-0000-0000000000a1');
reset role;
select is((select count(*)::int from external_sync_watermarks where org_id='a4200000-0000-0000-0000-000000000001' and external_tier='odoo'), 1, 'AC-ODC-006 a refused discard keeps the watermarks');

-- PQ-9 a confirmed discard with only failed documents clears the tier's mirror and mappings.
update external_command_outbox set state='failed' where org_id='a4200000-0000-0000-0000-000000000001' and external_tier='odoo';
insert into external_refs (org_id, domain, pmo_record_id, external_tier, external_record_id) values ('a4200000-0000-0000-0000-000000000001','companies','a420-co','odoo','Vendor:9');
set local role service_role;
select public.stage_vault_secret_for_org('a4200000-0000-0000-0000-000000000001','odoo','k7','a420_s7','a4200000-0000-0000-0000-0000000000a1');
select is(public.finalize_odoo_connect('a4200000-0000-0000-0000-000000000001','a420_s7','https://o.example.test','db2',null,true,true,'a4200000-0000-0000-0000-0000000000a1'), 'active', 'PQ-9 a confirmed discard commits the new database');
reset role;
select is((select (select count(*) from external_sync_watermarks where org_id='a4200000-0000-0000-0000-000000000001' and external_tier='odoo')
          + (select count(*) from external_project_bindings where org_id='a4200000-0000-0000-0000-000000000001' and external_tier='odoo')
          + (select count(*) from external_refs where org_id='a4200000-0000-0000-0000-000000000001' and external_tier='odoo'))::int, 0, 'PQ-9 the discard clears watermarks, project links and references for the tier');
select ok((select activated_at is null and not (config ? 'odoo_company_id') and config->>'database' = 'db2' from external_org_bindings where org_id='a4200000-0000-0000-0000-000000000001' and external_tier='odoo'),
  'PQ-9 the discard clears the company and activation and records the new database');
select is((select count(*)::int from vault.secrets where name='a420_s4'), 0, 'PQ-9 the previous secret is revoked by the discard reconnect');

-- AC-ODC-007 disconnect twice: secret gone, disconnected, ownership released, company kept.
set local role service_role;
select public.activate_odoo_binding('a4200000-0000-0000-0000-000000000001',20,1,'Main Co','{}','a4200000-0000-0000-0000-0000000000a1');
reset role;
insert into external_domain_ownership (org_id, external_tier, domain) values ('a4200000-0000-0000-0000-000000000001','odoo','companies');
set local role service_role;
-- An attempt stranded after stage (finalize never ran): the prior key a420_s7 is named only by the marker.
select public.stage_vault_secret_for_org('a4200000-0000-0000-0000-000000000001','odoo','k8','a420_s8','a4200000-0000-0000-0000-0000000000a1');
select throws_ok($$select public.disconnect_external_integration('a4200000-0000-0000-0000-000000000001','odoo','a4200000-0000-0000-0000-0000000000f1')$$,
  '42501', null, 'AC-ODC-009 a Finance actor cannot disconnect');
select is(public.disconnect_external_integration('a4200000-0000-0000-0000-000000000001','odoo','a4200000-0000-0000-0000-0000000000a1'), 1, 'AC-ODC-007 the first disconnect touches the binding');
select is(public.disconnect_external_integration('a4200000-0000-0000-0000-000000000001','odoo','a4200000-0000-0000-0000-0000000000a1'), 1, 'AC-ODC-007 a second disconnect succeeds');
reset role;
select ok((select status = 'disconnected' and config->>'odoo_company_id' = '1' from external_org_bindings where org_id='a4200000-0000-0000-0000-000000000001' and external_tier='odoo'),
  'AC-ODC-007 the binding is disconnected and keeps its company for a resume');
select is((select count(*)::int from external_domain_ownership where org_id='a4200000-0000-0000-0000-000000000001' and external_tier='odoo'), 0, 'AC-ODC-007 Odoo ownership is released');
select is((select count(*)::int from vault.secrets where name='a420_s7'), 0, 'AC-ODC-007 the secret is deleted');
select is((select count(*)::int from vault.secrets where name='a420_s8'), 0, 'AC-ODC-007 a stranded attempt''s new key is deleted');
select ok((select not (config ? 'prev_binding') from external_org_bindings where org_id='a4200000-0000-0000-0000-000000000001' and external_tier='odoo'), 'AC-ODC-007 disconnect drops the rotation marker');
select is((select count(*)::int from audit_events where org_id='a4200000-0000-0000-0000-000000000001' and action='integration.domain_ownership.release' and detail->>'tier'='odoo'), 1,
  'AC-ODC-007 the second disconnect writes no second ownership-release audit');

-- AC-ODC-009 the reference columns are unreadable by every signed-in role; the rest stays readable.
select is((select array_agg(column_name::text order by column_name) from information_schema.columns c
            where c.table_schema='public' and c.table_name='external_org_bindings'
              and not has_column_privilege('authenticated','public.external_org_bindings', c.column_name, 'SELECT')),
  array['secret_ref','webhook_secret_ref'], 'AC-ODC-009 authenticated can read every binding column except the two secret references');
select is((select count(*)::int from information_schema.columns c where c.table_schema='public' and c.table_name='external_org_bindings'
              and has_column_privilege('anon','public.external_org_bindings', c.column_name, 'SELECT')), 0, 'AC-ODC-009 anon reads no binding column');
set local role authenticated;
set local request.jwt.claims = '{"sub":"a4200000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select throws_ok($$select secret_ref from public.external_org_bindings$$, '42501', null, 'AC-ODC-009 an Admin JWT cannot read secret_ref');
select lives_ok($$select status, config from public.external_org_bindings$$, 'AC-ODC-009 an Admin JWT can read status and config');
set local request.jwt.claims = '{"sub":"a4200000-0000-0000-0000-0000000000e1","role":"authenticated"}';
select throws_ok($$select webhook_secret_ref from public.external_org_bindings$$, '42501', null, 'AC-ODC-009 an Engineer JWT cannot read webhook_secret_ref');
select is((select count(*)::int from public.external_org_bindings where external_tier='odoo'), 1, 'AC-ODC-009 an Engineer JWT still sees the org''s binding rows');
reset role;

select * from finish();
rollback;

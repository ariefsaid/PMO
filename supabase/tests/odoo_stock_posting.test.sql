begin;
create extension if not exists pgtap;

insert into organizations (id, name, default_currency, default_timezone) values
  ('15120000-0000-0000-0000-000000000001', 'STK Org',       'IDR', 'Asia/Jakarta'),
  ('15120000-0000-0000-0000-000000000002', 'STK Other Org', 'IDR', 'UTC');
insert into auth.users (id, email) values
  ('15120000-0000-0000-0000-0000000000a1', 'stk-admin@example.com'),
  ('15120000-0000-0000-0000-0000000000a2', 'stk-fin@example.com'),
  ('15120000-0000-0000-0000-0000000000a3', 'stk-pm@example.com'),
  ('15120000-0000-0000-0000-0000000000a4', 'stk-keep1@example.com'),   -- Engineer, keeps site A
  ('15120000-0000-0000-0000-0000000000a5', 'stk-keep2@example.com'),   -- Engineer, keeps site B
  ('15120000-0000-0000-0000-0000000000a6', 'stk-eng@example.com'),     -- Engineer, keeps nothing
  ('15120000-0000-0000-0000-0000000000b1', 'stk-xorg@example.com');    -- other-org Admin
insert into profiles (id, org_id, full_name, email, role, status) values
  ('15120000-0000-0000-0000-0000000000a1', '15120000-0000-0000-0000-000000000001', 'STK Admin', 'stk-admin@example.com', 'Admin', 'active'),
  ('15120000-0000-0000-0000-0000000000a2', '15120000-0000-0000-0000-000000000001', 'STK Fin',   'stk-fin@example.com',   'Finance', 'active'),
  ('15120000-0000-0000-0000-0000000000a3', '15120000-0000-0000-0000-000000000001', 'STK PM',    'stk-pm@example.com',    'Project Manager', 'active'),
  ('15120000-0000-0000-0000-0000000000a4', '15120000-0000-0000-0000-000000000001', 'STK Keep1', 'stk-keep1@example.com', 'Engineer', 'active'),
  ('15120000-0000-0000-0000-0000000000a5', '15120000-0000-0000-0000-000000000001', 'STK Keep2', 'stk-keep2@example.com', 'Engineer', 'active'),
  ('15120000-0000-0000-0000-0000000000a6', '15120000-0000-0000-0000-000000000001', 'STK Eng',   'stk-eng@example.com',   'Engineer', 'active'),
  ('15120000-0000-0000-0000-0000000000b1', '15120000-0000-0000-0000-000000000002', 'STK XOrg',  'stk-xorg@example.com',  'Admin', 'active');
insert into companies (id, org_id, name, type) values
  ('15120000-0000-0000-0000-0000000000f1', '15120000-0000-0000-0000-000000000001', 'STK Client', 'Client');
insert into projects (id, org_id, name, status, contract_value, tax_treatment, tax_amount, client_id, project_manager_id) values
  ('15120000-0000-0000-0000-0000000000c1', '15120000-0000-0000-0000-000000000001', 'STK Ongoing',  'Ongoing Project', 1000000, 'exclusive', 0, '15120000-0000-0000-0000-0000000000f1', '15120000-0000-0000-0000-0000000000a3'),
  ('15120000-0000-0000-0000-0000000000c2', '15120000-0000-0000-0000-000000000001', 'STK On Hold',  'On Hold',         1000000, 'exclusive', 0, '15120000-0000-0000-0000-0000000000f1', '15120000-0000-0000-0000-0000000000a3');
insert into boq_items (id, org_id, project_id, item_code, description, unit, quantity, rate) values
  ('15120000-0000-0000-0000-0000000000e1', '15120000-0000-0000-0000-000000000001', '15120000-0000-0000-0000-0000000000c1', 'W-1', 'Slab pour',   'm3', 50, 1000),
  ('15120000-0000-0000-0000-0000000000e2', '15120000-0000-0000-0000-000000000001', '15120000-0000-0000-0000-0000000000c2', 'W-2', 'Other pour',  'm3', 50, 1000);

-- S1 adds below (master data, as superuser so the fixture does not depend on the RLS under test):
insert into stock_units (id, org_id, code, name, whole_only) values
  ('15120000-0000-0000-0000-0000000000d1', '15120000-0000-0000-0000-000000000001', 'bag', 'Bag',   true),
  ('15120000-0000-0000-0000-0000000000d2', '15120000-0000-0000-0000-000000000001', 'm',   'Metre', false);
insert into stock_items (id, org_id, code, name, unit_id) values
  ('15120000-0000-0000-0000-000000001001', '15120000-0000-0000-0000-000000000001', 'CEM', 'Cement 50kg', '15120000-0000-0000-0000-0000000000d1'),
  ('15120000-0000-0000-0000-000000001002', '15120000-0000-0000-0000-000000000001', 'CAB', 'Cable 4mm',   '15120000-0000-0000-0000-0000000000d2');
insert into stock_warehouses (id, org_id, code, name, kind) values
  ('15120000-0000-0000-0000-000000002001', '15120000-0000-0000-0000-000000000001', 'CEN',    'Central',  'central'),
  ('15120000-0000-0000-0000-000000002002', '15120000-0000-0000-0000-000000000001', 'SITE-A', 'Site A',   'site'),
  ('15120000-0000-0000-0000-000000002003', '15120000-0000-0000-0000-000000000001', 'SITE-B', 'Site B',   'site'),
  ('15120000-0000-0000-0000-000000002009', '15120000-0000-0000-0000-000000000002', 'XCEN',   'X Central','central');
insert into stock_warehouse_keepers (org_id, warehouse_id, user_id) values
  ('15120000-0000-0000-0000-000000000001', '15120000-0000-0000-0000-000000002002', '15120000-0000-0000-0000-0000000000a4'),
  ('15120000-0000-0000-0000-000000000001', '15120000-0000-0000-0000-000000002003', '15120000-0000-0000-0000-0000000000a5');

create function public.stk_t_as_user(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;
-- usage: select public.stk_t_as_user('15120000-0000-0000-0000-0000000000a4'); ... reset role;

select no_plan();
select public.stk_t_as_user('15120000-0000-0000-0000-0000000000a1');
select public.create_stock_document(jsonb_build_object('kind','receive','warehouse_id','15120000-0000-0000-0000-000000002001'), jsonb_build_array(jsonb_build_object('item_id','15120000-0000-0000-0000-000000001001','quantity',5,'unit_cost',10)), true);
select set_config('stk.draft', public.create_stock_document(jsonb_build_object('kind','receive','warehouse_id','15120000-0000-0000-0000-000000002001'), jsonb_build_array(jsonb_build_object('item_id','15120000-0000-0000-0000-000000001001','quantity',1,'unit_cost',10)))::text, true);
select throws_like($$select public.admin_change_domain_ownership('15120000-0000-0000-0000-000000000001','odoo','inventory','employ')$$, 'STK_DRAFTS_EXIST%', 'AC-OSP-005 draft prevents employment');
reset role;
select is((select count(*)::int from public.external_domain_ownership where org_id='15120000-0000-0000-0000-000000000001' and domain='inventory'), 0, 'AC-OSP-005 no ownership change on refusal');
select public.stk_t_as_user('15120000-0000-0000-0000-0000000000a1');
select public.cancel_stock_document(current_setting('stk.draft')::uuid);
select lives_ok($$select public.admin_change_domain_ownership('15120000-0000-0000-0000-000000000001','odoo','inventory','employ')$$, 'AC-OSP-005 employment succeeds without drafts');
select is(jsonb_array_length(public.get_stock_ledger()->'rows'), 1, 'AC-OSP-005 historical standalone ledger remains readable');
reset role;
insert into public.external_org_bindings (org_id, external_tier, site_url, secret_ref, status, config, activated_at) values ('15120000-0000-0000-0000-000000000001','odoo','fixture','fixture','active','{"odoo_company_id":42}',now());
insert into public.stock_documents (id,org_id,number,kind,warehouse_id,to_warehouse_id,project_id,occurred_on,created_by) values
('15120000-0000-0000-0000-000000003001','15120000-0000-0000-0000-000000000001','T1','transfer','15120000-0000-0000-0000-000000002002','15120000-0000-0000-0000-000000002001',null,current_date,'15120000-0000-0000-0000-0000000000a4'),
('15120000-0000-0000-0000-000000003002','15120000-0000-0000-0000-000000000001','I1','issue','15120000-0000-0000-0000-000000002002',null,'15120000-0000-0000-0000-0000000000c1',current_date,'15120000-0000-0000-0000-0000000000a4'),
('15120000-0000-0000-0000-000000003003','15120000-0000-0000-0000-000000000001','T2','transfer','15120000-0000-0000-0000-000000002002','15120000-0000-0000-0000-000000002001',null,public.stock_org_today('15120000-0000-0000-0000-000000000001') + 1,'15120000-0000-0000-0000-0000000000a4'),
('15120000-0000-0000-0000-000000003004','15120000-0000-0000-0000-000000000001','R1','receive','15120000-0000-0000-0000-000000002002',null,null,current_date,'15120000-0000-0000-0000-0000000000a4');
insert into public.stock_document_lines (org_id,document_id,line_no,item_id,quantity,boq_item_id) values
('15120000-0000-0000-0000-000000000001','15120000-0000-0000-0000-000000003001',1,'15120000-0000-0000-0000-000000001001',1,null),
('15120000-0000-0000-0000-000000000001','15120000-0000-0000-0000-000000003002',1,'15120000-0000-0000-0000-000000001001',1,'15120000-0000-0000-0000-0000000000e2');
insert into public.external_domain_ownership (org_id,external_tier,domain) values ('15120000-0000-0000-0000-000000000002','odoo','inventory');
insert into public.external_org_bindings (org_id,external_tier,site_url,secret_ref,status,config,activated_at) values ('15120000-0000-0000-0000-000000000002','odoo','fixture','fixture','active','{"odoo_company_id":42}',now());
create function public.stk_test_command(p_doc text, p_org uuid, p_actor uuid, p_tier text default 'odoo', p_key text default null, p_payload jsonb default null) returns void language sql as $$
 insert into public.external_command_outbox (org_id,domain,pmo_record_id,idempotency_key,external_tier,operation,state,actor_user_id,payload)
 values (p_org,'inventory',p_doc,coalesce(p_key,'stock:'||p_doc),p_tier,'create','pending',p_actor,coalesce(p_payload,jsonb_build_object('stockDocumentId',p_doc,'documentRevision',1,'odooCompanyId',42))) $$;
set local role service_role;
set local request.jwt.claims = '{"role":"service_role","sub":"15120000-0000-0000-0000-0000000000a1"}';
select throws_like($$select public.stk_test_command('15120000-0000-0000-0000-000000003001','15120000-0000-0000-0000-000000000001','15120000-0000-0000-0000-0000000000a6')$$, 'STK_NOT_KEEPER%', 'AC-OSP-006 non keeper with admin session refused');
select is((select count(*)::int from public.external_command_outbox where domain='inventory'), 0, 'AC-OSP-006 non keeper with admin session writes no command');
select throws_like($$select public.stk_test_command('15120000-0000-0000-0000-000000003001','15120000-0000-0000-0000-000000000001','15120000-0000-0000-0000-0000000000b1')$$, '%', 'AC-OSP-006 foreign actor refused');
select is((select count(*)::int from public.external_command_outbox where domain='inventory'), 0, 'AC-OSP-006 foreign actor writes no command');
select throws_like($$select public.stk_test_command('15120000-0000-0000-0000-000000003001','15120000-0000-0000-0000-000000000002','15120000-0000-0000-0000-0000000000b1')$$, 'STK_NOT_FOUND%', 'AC-OSP-006 foreign document organization refused');
select is((select count(*)::int from public.external_command_outbox where domain='inventory'), 0, 'AC-OSP-006 foreign document organization writes no command');
select throws_like($$select public.stk_test_command('15120000-0000-0000-0000-000000003001','15120000-0000-0000-0000-000000000001','15120000-0000-0000-0000-0000000000a4','odoo',null,jsonb_build_object('stockDocumentId','15120000-0000-0000-0000-000000003001','documentRevision',1,'odooCompanyId',43))$$, 'STK_COMPANY%', 'AC-OSP-006 wrong company refused');
select is((select count(*)::int from public.external_command_outbox where domain='inventory'), 0, 'AC-OSP-006 wrong company writes no command');
select throws_like($$select public.stk_test_command('15120000-0000-0000-0000-000000003001','15120000-0000-0000-0000-000000000001','15120000-0000-0000-0000-0000000000a4','odoo',null,jsonb_build_object('stockDocumentId','15120000-0000-0000-0000-000000003001','documentRevision',1))$$, 'STK_COMPANY%', 'AC-OSP-006 missing company refused');
select is((select count(*)::int from public.external_command_outbox where domain='inventory'), 0, 'AC-OSP-006 missing company writes no command');
select throws_like($$select public.stk_test_command('15120000-0000-0000-0000-000000003001','15120000-0000-0000-0000-000000000001','15120000-0000-0000-0000-0000000000a4','erpnext')$$, 'STK_%', 'AC-OSP-006 wrong tier refused');
select is((select count(*)::int from public.external_command_outbox where domain='inventory'), 0, 'AC-OSP-006 wrong tier writes no command');
select throws_like($$select public.stk_test_command('15120000-0000-0000-0000-000000003001','15120000-0000-0000-0000-000000000001','15120000-0000-0000-0000-0000000000a4','odoo','wrong')$$, 'STK_%', 'AC-OSP-006 wrong key refused');
select is((select count(*)::int from public.external_command_outbox where domain='inventory'), 0, 'AC-OSP-006 wrong key writes no command');
select throws_like($$select public.stk_test_command('15120000-0000-0000-0000-000000003001','15120000-0000-0000-0000-000000000001',null)$$, '%', 'AC-OSP-006 null actor refused');
select is((select count(*)::int from public.external_command_outbox where domain='inventory'), 0, 'AC-OSP-006 null actor writes no command');
select throws_like($$select public.stk_test_command('15120000-0000-0000-0000-000000003001','15120000-0000-0000-0000-000000000001','15120000-0000-0000-0000-0000000000a4','odoo',null,jsonb_build_object('stockDocumentId','15120000-0000-0000-0000-000000003001','documentRevision','1','odooCompanyId',42))$$,'STK_COMMAND%','AC-OSP-006 revision must be a JSON integer');
select is((select count(*)::int from public.external_command_outbox where domain='inventory'),0,'AC-OSP-006 invalid revision type writes no command');
select throws_like($$select public.stk_test_command('15120000-0000-0000-0000-000000003001','15120000-0000-0000-0000-000000000001','15120000-0000-0000-0000-0000000000a4','odoo',null,jsonb_build_object('stockDocumentId','15120000-0000-0000-0000-000000003001','documentRevision',1,'odooCompanyId','42'))$$,'STK_COMPANY%','AC-OSP-006 company must be a JSON integer');
select is((select count(*)::int from public.external_command_outbox where domain='inventory'),0,'AC-OSP-006 invalid company type writes no command');
select throws_like($$select public.stk_test_command('15120000-0000-0000-0000-000000003001','15120000-0000-0000-0000-000000000001','15120000-0000-0000-0000-0000000000a4','odoo',null,jsonb_build_object('stockDocumentId','15120000-0000-0000-0000-000000003001','documentRevision',999,'odooCompanyId',42))$$, 'STK_%', 'AC-OSP-006 stale revision refused');
select is((select count(*)::int from public.external_command_outbox where domain='inventory'), 0, 'AC-OSP-006 stale revision writes no command');
select throws_like($$select public.stk_test_command('15120000-0000-0000-0000-000000003003','15120000-0000-0000-0000-000000000001','15120000-0000-0000-0000-0000000000a4')$$, 'STK_BACKDATE%', 'AC-OSP-006 future date refused');
select is((select count(*)::int from public.external_command_outbox where domain='inventory'), 0, 'AC-OSP-006 future date writes no command');
select throws_like($$select public.stk_test_command('15120000-0000-0000-0000-000000003004','15120000-0000-0000-0000-000000000001','15120000-0000-0000-0000-0000000000a4')$$, 'STK_%', 'AC-OSP-006 receive kind refused');
select is((select count(*)::int from public.external_command_outbox where domain='inventory'), 0, 'AC-OSP-006 receive kind writes no command');
select throws_like($$select public.stk_test_command('15120000-0000-0000-0000-000000003002','15120000-0000-0000-0000-000000000001','15120000-0000-0000-0000-0000000000a4')$$, 'STK_BOQ_MISMATCH%', 'AC-OSP-006 wrong work item refused');
select is((select count(*)::int from public.external_command_outbox where domain='inventory'), 0, 'AC-OSP-006 wrong work item writes no command');
reset role;
update public.stock_document_lines set boq_item_id=null where document_id='15120000-0000-0000-0000-000000003002';
set local role service_role;
select throws_like($$select public.stk_test_command('15120000-0000-0000-0000-000000003002','15120000-0000-0000-0000-000000000001','15120000-0000-0000-0000-0000000000a4')$$, 'STK_BOQ_MISMATCH%', 'AC-OSP-006 missing work item refused');
select is((select count(*)::int from public.external_command_outbox where domain='inventory'), 0, 'AC-OSP-006 missing work item writes no command');
reset role;
update auth.users set banned_until=now()+interval '1 day' where id='15120000-0000-0000-0000-0000000000a4';
set local role service_role;
select throws_ok($$select public.stk_test_command('15120000-0000-0000-0000-000000003001','15120000-0000-0000-0000-000000000001','15120000-0000-0000-0000-0000000000a4')$$, '42501', null, 'AC-OSP-006 banned actor is not an active member');
select is((select count(*)::int from public.external_command_outbox where domain='inventory'),0,'AC-OSP-006 banned actor writes no command');
reset role;
update auth.users set banned_until=null where id='15120000-0000-0000-0000-0000000000a4';
set local role service_role;
reset role;
update public.external_org_bindings set activated_at=null where org_id='15120000-0000-0000-0000-000000000001' and external_tier='odoo';
set local role service_role;
select throws_like($$select public.stk_test_command('15120000-0000-0000-0000-000000003001','15120000-0000-0000-0000-000000000001','15120000-0000-0000-0000-0000000000a4')$$, 'STK_COMPANY%', 'AC-OSP-006 missing active binding refuses command');
select is((select count(*)::int from public.external_command_outbox where domain='inventory'),0,'AC-OSP-006 missing binding writes no command');
select throws_like($$select public.stk_test_command(current_setting('stk.draft'),'15120000-0000-0000-0000-000000000001','15120000-0000-0000-0000-0000000000a4')$$, 'STK_COMPANY%', 'AC-OSP-006 missing binding checked before document state');
reset role;
update public.external_org_bindings set activated_at=now() where org_id='15120000-0000-0000-0000-000000000001' and external_tier='odoo';
set local role service_role;
select throws_like($$select public.stk_test_command(current_setting('stk.draft'),'15120000-0000-0000-0000-000000000001','15120000-0000-0000-0000-0000000000a4')$$, 'STK_COMMAND%', 'AC-OSP-006 cancelled document refuses command');
select is((select count(*)::int from public.external_command_outbox where domain='inventory'),0,'AC-OSP-006 cancelled document writes no command');
select lives_ok($$select public.stk_test_command('15120000-0000-0000-0000-000000003001','15120000-0000-0000-0000-000000000001','15120000-0000-0000-0000-0000000000a4')$$, 'AC-OSP-006 assigned keeper can submit');
reset role;
-- The release guard refuses this delete while the command is live; the fixture steps past it so the claim-time ownership check is still proven.
alter table public.external_domain_ownership disable trigger external_domain_ownership_stock_release;
delete from public.external_domain_ownership where org_id='15120000-0000-0000-0000-000000000001' and domain='inventory';
alter table public.external_domain_ownership enable trigger external_domain_ownership_stock_release;
select throws_like($$update public.external_command_outbox set state='committing', claim_generation=claim_generation+1 where domain='inventory'$$, 'STK_OWNERSHIP%', 'AC-OSP-006 claim refuses released ownership');
-- Restore ownership directly for the claim fixture; the employment gate correctly sees the existing drafts.
alter table public.external_domain_ownership disable trigger external_domain_ownership_stock_drafts;
insert into public.external_domain_ownership (org_id, external_tier, domain) values ('15120000-0000-0000-0000-000000000001','odoo','inventory');
alter table public.external_domain_ownership enable trigger external_domain_ownership_stock_drafts;
update public.external_org_bindings set config='{"odoo_company_id":43}' where org_id='15120000-0000-0000-0000-000000000001' and external_tier='odoo';
select throws_like($$update public.external_command_outbox set state='committing', claim_generation=claim_generation+1 where domain='inventory'$$, 'STK_COMPANY%', 'AC-OSP-006 claim refuses changed company');
update public.external_org_bindings set config='{"odoo_company_id":42}' where org_id='15120000-0000-0000-0000-000000000001' and external_tier='odoo';
select lives_ok($$update public.external_command_outbox set state='committing', claim_generation=claim_generation+1 where domain='inventory'$$, 'AC-OSP-006 claim accepts matching ownership and company');
reset role;
select throws_like($$update public.stock_documents set note='edit' where id='15120000-0000-0000-0000-000000003001'$$, 'STK_PENDING%', 'AC-OSP-006 live command freezes document');
select throws_like($$update public.stock_document_lines set quantity=2 where document_id='15120000-0000-0000-0000-000000003001'$$, 'STK_PENDING%', 'AC-OSP-006 live command freezes lines');
select throws_like($$update public.stock_document_lines set document_id='15120000-0000-0000-0000-000000003001',line_no=2 where document_id='15120000-0000-0000-0000-000000003002'$$, 'STK_PENDING%', 'AC-OSP-006 live command prevents moving a line into its document');
select throws_like($$update public.stock_document_lines set document_id='15120000-0000-0000-0000-000000003001',org_id='15120000-0000-0000-0000-000000000002',line_no=3 where document_id='15120000-0000-0000-0000-000000003002'$$, 'STK_PENDING%', 'AC-OSP-006 foreign line organization cannot bypass document freeze');
select throws_like($$insert into public.stock_document_lines(org_id,document_id,line_no,item_id,quantity) values ('15120000-0000-0000-0000-000000000002','15120000-0000-0000-0000-000000003001',4,'15120000-0000-0000-0000-000000001001',1)$$, 'STK_PENDING%', 'AC-OSP-006 line insertion cannot bypass document freeze with a foreign organization');
select public.stk_t_as_user('15120000-0000-0000-0000-0000000000a4');
select throws_like($$select public.save_stock_draft('15120000-0000-0000-0000-000000003001',jsonb_build_object('warehouse_id','15120000-0000-0000-0000-000000002002','to_warehouse_id','15120000-0000-0000-0000-000000002001'),jsonb_build_array(jsonb_build_object('item_id','15120000-0000-0000-0000-000000001001','quantity',2)))$$, 'STK_PENDING%', 'AC-OSP-006 live command prevents save');
select throws_like($$select public.cancel_stock_document('15120000-0000-0000-0000-000000003001')$$, 'STK_PENDING%', 'AC-OSP-006 live command prevents cancel');
reset role;
select throws_like($$update public.stock_documents set status='Posted',posted_by='15120000-0000-0000-0000-0000000000a4',posted_at=now() where id='15120000-0000-0000-0000-000000003001'$$, 'STK_PENDING%', 'AC-OSP-006 pending command cannot finalize');
update public.external_command_outbox set state='committing' where domain='inventory';
select throws_like($$update public.stock_documents set status='Posted',posted_by='15120000-0000-0000-0000-0000000000a4',posted_at=now() where id='15120000-0000-0000-0000-000000003001'$$, 'STK_PENDING%', 'AC-OSP-006 committing cannot finalize');
update public.external_command_outbox set state='committed' where domain='inventory';
select throws_like($$update public.stock_documents set status='Posted',posted_by='15120000-0000-0000-0000-0000000000a4',posted_at=now() where id='15120000-0000-0000-0000-000000003001'$$, 'STK_PENDING%', 'AC-OSP-007 committed command without confirmed mirror cannot finalize');
update public.external_command_outbox set state='held' where domain='inventory';
select throws_like($$update public.stock_documents set status='Posted',posted_by='15120000-0000-0000-0000-0000000000a4',posted_at=now() where id='15120000-0000-0000-0000-000000003001'$$, 'STK_PENDING%', 'AC-OSP-006 held cannot finalize');
update public.external_command_outbox set state='quarantined' where domain='inventory';
select throws_like($$update public.stock_documents set status='Posted',posted_by='15120000-0000-0000-0000-0000000000a4',posted_at=now() where id='15120000-0000-0000-0000-000000003001'$$, 'STK_PENDING%', 'AC-OSP-006 quarantined cannot finalize');
update public.external_command_outbox set state='confirmed' where domain='inventory';
select throws_like($$update public.stock_documents set status='Posted',posted_by='15120000-0000-0000-0000-0000000000a1',posted_at=now() where id='15120000-0000-0000-0000-000000003001'$$, 'STK_PENDING%', 'AC-OSP-006 only command actor finalizes');
select throws_like($$update public.stock_documents set status='Posted',posted_by='15120000-0000-0000-0000-0000000000a4',posted_at=now() where id='15120000-0000-0000-0000-000000003001'$$, 'STK_PENDING%', 'AC-OSP-007 confirmed command without confirmed mirror cannot finalize');
create function public.stk_test_mirror(p_org uuid,p_doc uuid,p_company integer,p_generation integer,p_state text,
 p_model text default null,p_ref text default null,p_quantity numeric default null,p_value numeric default null,
 p_written timestamptz default null,p_exception text default null,p_reference text default null) returns void language sql as $$
 select public.write_stock_erp_mirror(p_org,p_doc,p_company,p_generation,p_state,p_model,p_ref,p_reference,p_quantity,p_value,null,p_written,now(),p_exception) $$;
insert into public.stock_warehouses(id,org_id,code,name,kind) values ('15120000-0000-0000-0000-000000002010','15120000-0000-0000-0000-000000000002','X-SITE','Other site','site');
insert into public.stock_units(id,org_id,code,name,whole_only) values ('15120000-0000-0000-0000-0000000000d9','15120000-0000-0000-0000-000000000002','EA','Each',true);
insert into public.stock_items(id,org_id,code,name,unit_id) values ('15120000-0000-0000-0000-000000001019','15120000-0000-0000-0000-000000000002','XI','Other item','15120000-0000-0000-0000-0000000000d9');
insert into public.stock_documents(id,org_id,number,kind,warehouse_id,to_warehouse_id,occurred_on,created_by) values ('15120000-0000-0000-0000-000000003009','15120000-0000-0000-0000-000000000002','XT1','transfer','15120000-0000-0000-0000-000000002010','15120000-0000-0000-0000-000000002009',public.stock_org_today('15120000-0000-0000-0000-000000000002'),'15120000-0000-0000-0000-0000000000b1');
insert into public.stock_document_lines(org_id,document_id,line_no,item_id,quantity) values ('15120000-0000-0000-0000-000000000002','15120000-0000-0000-0000-000000003009',1,'15120000-0000-0000-0000-000000001019',1);
set local role service_role;
select public.stk_test_command('15120000-0000-0000-0000-000000003009','15120000-0000-0000-0000-000000000002','15120000-0000-0000-0000-0000000000b1');
select throws_like($$select public.stk_test_mirror('15120000-0000-0000-0000-000000000002','15120000-0000-0000-0000-000000003001',42,1,'pending')$$,'STK_MIRROR_FENCE%','AC-OSP-007 wrong organization refused');
select throws_like($$select public.stk_test_mirror('15120000-0000-0000-0000-000000000001','15120000-0000-0000-0000-000000003001',43,1,'pending')$$,'STK_MIRROR_COMPANY%','AC-OSP-007 wrong company refused');
select throws_like($$select public.stk_test_mirror('15120000-0000-0000-0000-000000000001','15120000-0000-0000-0000-000000003001',42,0,'pending')$$,'STK_MIRROR_FENCE%','AC-OSP-007 stale generation refused');
select throws_like($$select public.stk_test_mirror('15120000-0000-0000-0000-000000000001','15120000-0000-0000-0000-000000003009',42,0,'pending')$$,'STK_MIRROR_FENCE%','AC-OSP-007 foreign document refused');
reset role;
update public.external_org_bindings set config='{"odoo_company_id":43}' where org_id='15120000-0000-0000-0000-000000000001' and external_tier='odoo';
set local role service_role;
select throws_like($$select public.stk_test_mirror('15120000-0000-0000-0000-000000000001','15120000-0000-0000-0000-000000003001',42,1,'pending')$$,'STK_MIRROR_COMPANY%','AC-OSP-007 changed binding company refused');
reset role;
update public.external_org_bindings set config='{"odoo_company_id":42}' where org_id='15120000-0000-0000-0000-000000000001' and external_tier='odoo';
-- A live row's payload cannot be edited through the guard; the fixture steps past it to prove the mirror writer's own company check.
alter table public.external_command_outbox disable trigger external_command_outbox_zz_stock_command;
update public.external_command_outbox set payload=jsonb_set(payload,'{odooCompanyId}','43'::jsonb) where pmo_record_id='15120000-0000-0000-0000-000000003001';
alter table public.external_command_outbox enable trigger external_command_outbox_zz_stock_command;
set local role service_role;
select throws_like($$select public.stk_test_mirror('15120000-0000-0000-0000-000000000001','15120000-0000-0000-0000-000000003001',42,1,'pending')$$,'STK_MIRROR_COMPANY%','AC-OSP-007 changed command company refused');
reset role;
alter table public.external_command_outbox disable trigger external_command_outbox_zz_stock_command;
update public.external_command_outbox set payload=jsonb_set(payload,'{odooCompanyId}','42'::jsonb) where pmo_record_id='15120000-0000-0000-0000-000000003001';
alter table public.external_command_outbox enable trigger external_command_outbox_zz_stock_command;
set local role service_role;
select lives_ok($$select public.stk_test_mirror('15120000-0000-0000-0000-000000000001','15120000-0000-0000-0000-000000003001',42,1,'pending')$$,'AC-OSP-007 pending evidence stored');
select ok((select completed_quantity is null and completed_value is null and currency is null from public.stock_erp_mirror where stock_document_id='15120000-0000-0000-0000-000000003001'),'AC-OSP-007 pending evidence leaves unknown values null');
select throws_ok($$insert into public.stock_erp_mirror(org_id,stock_document_id,company_id,state,fetched_at,command_generation) values ('15120000-0000-0000-0000-000000000001','15120000-0000-0000-0000-000000003001',42,'pending',now(),1)$$,'42501',null,'AC-OSP-007 service role cannot write table directly');
reset role;
select throws_like($$update public.stock_documents set status='Posted',posted_by='15120000-0000-0000-0000-0000000000a4',posted_at=now() where id='15120000-0000-0000-0000-000000003001'$$,'STK_PENDING%','AC-OSP-007 pending mirror cannot finalize');
set local role service_role;
select lives_ok($$select public.stk_test_mirror('15120000-0000-0000-0000-000000000001','15120000-0000-0000-0000-000000003001',42,1,'held')$$,'AC-OSP-007 held evidence stored');
reset role;
select throws_like($$update public.stock_documents set status='Posted',posted_by='15120000-0000-0000-0000-0000000000a4',posted_at=now() where id='15120000-0000-0000-0000-000000003001'$$,'STK_PENDING%','AC-OSP-007 held mirror cannot finalize');
set local role service_role;
select lives_ok($$select public.stk_test_mirror('15120000-0000-0000-0000-000000000001','15120000-0000-0000-0000-000000003001',42,1,'failed')$$,'AC-OSP-007 failed evidence stored');
reset role;
select throws_like($$update public.stock_documents set status='Posted',posted_by='15120000-0000-0000-0000-0000000000a4',posted_at=now() where id='15120000-0000-0000-0000-000000003001'$$,'STK_PENDING%','AC-OSP-007 failed mirror cannot finalize');
set local role service_role;
select lives_ok($$select public.stk_test_mirror('15120000-0000-0000-0000-000000000001','15120000-0000-0000-0000-000000003001',42,1,'stale')$$,'AC-OSP-007 stale evidence stored');
reset role;
select throws_like($$update public.stock_documents set status='Posted',posted_by='15120000-0000-0000-0000-0000000000a4',posted_at=now() where id='15120000-0000-0000-0000-000000003001'$$,'STK_PENDING%','AC-OSP-007 stale mirror cannot finalize');
set local role service_role;
select throws_like($$select public.stk_test_mirror('15120000-0000-0000-0000-000000000001','15120000-0000-0000-0000-000000003001',42,1,'confirmed','stock.picking','77',null,10,now())$$,'STK_MIRROR_EVIDENCE%','AC-OSP-007 confirmed missing quantity refused');
select throws_like($$select public.stk_test_mirror('15120000-0000-0000-0000-000000000001','15120000-0000-0000-0000-000000003001',42,1,'confirmed','stock.picking','77',1,null,now())$$,'STK_MIRROR_EVIDENCE%','AC-OSP-007 confirmed missing value refused');
select throws_like($$select public.stk_test_mirror('15120000-0000-0000-0000-000000000001','15120000-0000-0000-0000-000000003001',42,1,'confirmed','stock.picking','77',1,10,null)$$,'STK_MIRROR_EVIDENCE%','AC-OSP-007 confirmed missing source time refused');
select throws_like($$select public.stk_test_mirror('15120000-0000-0000-0000-000000000001','15120000-0000-0000-0000-000000003001',42,1,'confirmed',null,null,1,10,now())$$,'STK_MIRROR_EVIDENCE%','AC-OSP-007 confirmed missing reference refused');
select throws_like($$select public.stk_test_mirror('15120000-0000-0000-0000-000000000001','15120000-0000-0000-0000-000000003001',42,1,'confirmed',null,'77',1,10,now())$$,'STK_MIRROR_EVIDENCE%','AC-OSP-007 confirmed missing model refused');
select throws_like($$select public.stk_test_mirror('15120000-0000-0000-0000-000000000001','15120000-0000-0000-0000-000000003001',42,1,'confirmed','stock.picking','77',1,10,now(),'WAIT: pending')$$,'STK_MIRROR_EVIDENCE%','AC-OSP-007 confirmed exception present refused');
select lives_ok($$select public.stk_test_mirror('15120000-0000-0000-0000-000000000001','15120000-0000-0000-0000-000000003001',42,1,'confirmed','stock.picking','77',1,10,now(),null,'WH/INT/00077')$$,'AC-OSP-007 complete evidence confirms');
select is((select external_reference from public.stock_erp_mirror where stock_document_id='15120000-0000-0000-0000-000000003001'),'WH/INT/00077','AC-OSP-007 the mirror stores the transfer reference');
select throws_like($$select public.stk_test_mirror('15120000-0000-0000-0000-000000000001','15120000-0000-0000-0000-000000003001',42,1,'pending')$$,'STK_MIRROR_CONFIRMED%','AC-OSP-007 confirmed evidence cannot be downgraded');
reset role;
select throws_ok($$insert into public.stock_erp_mirror select * from public.stock_erp_mirror where stock_document_id='15120000-0000-0000-0000-000000003001'$$,'23505',null,'AC-OSP-007 only one mirror per document');
select throws_ok($$insert into public.stock_erp_mirror(org_id,stock_document_id,company_id,state,fetched_at,command_generation) values ('15120000-0000-0000-0000-000000000002','15120000-0000-0000-0000-000000003001',42,'pending',now(),1)$$,'23503',null,'AC-OSP-007 mirror organization must match its document');
select public.stk_t_as_user('15120000-0000-0000-0000-0000000000b1');
select is((select count(*)::int from public.stock_erp_mirror),0,'AC-OSP-007 foreign member cannot read mirror');
select is(public.get_stock_erp_value('15120000-0000-0000-0000-000000003001'),null,'AC-OSP-007 a foreign member reads no value');
select throws_ok($$insert into public.stock_erp_mirror(org_id,stock_document_id,company_id,state,fetched_at,command_generation) values ('15120000-0000-0000-0000-000000000001','15120000-0000-0000-0000-000000003001',42,'pending',now(),1)$$,'42501',null,'AC-OSP-007 foreign member cannot directly write mirror');
select throws_ok($$select public.stk_test_mirror('15120000-0000-0000-0000-000000000001','15120000-0000-0000-0000-000000003001',42,1,'pending')$$,'42501',null,'AC-OSP-007 foreign member cannot call writer');
reset role;
select public.stk_t_as_user('15120000-0000-0000-0000-0000000000a1');
select is((select count(*)::int from public.stock_erp_mirror),1,'AC-OSP-007 same-organization member reads mirror');
select throws_ok($$select completed_value from public.stock_erp_mirror$$,'42501',null,'AC-OSP-007 the value column is not readable from the table');
select is(public.get_stock_erp_value('15120000-0000-0000-0000-000000003001'),10::numeric,'AC-OSP-007 an Admin reads the value');
reset role;
select public.stk_t_as_user('15120000-0000-0000-0000-0000000000a2');
select is(public.get_stock_erp_value('15120000-0000-0000-0000-000000003001'),10::numeric,'AC-OSP-007 Finance reads the value');
reset role;
select public.stk_t_as_user('15120000-0000-0000-0000-0000000000a3');
select is(public.get_stock_erp_value('15120000-0000-0000-0000-000000003001'),10::numeric,'AC-OSP-007 a Project Manager reads the value');
reset role;
select public.stk_t_as_user('15120000-0000-0000-0000-0000000000a6');
select is(public.get_stock_erp_value('15120000-0000-0000-0000-000000003001'),null,'AC-OSP-007 an Engineer gets no value');
select is((select state from public.stock_erp_mirror where stock_document_id='15120000-0000-0000-0000-000000003001'),'confirmed','AC-OSP-007 an Engineer still reads the state');
reset role;
select public.stk_t_as_user('15120000-0000-0000-0000-0000000000a1');
select throws_ok($$update public.stock_erp_mirror set state='pending'$$,'42501',null,'AC-OSP-007 member cannot update mirror');
select throws_ok($$delete from public.stock_erp_mirror$$,'42501',null,'AC-OSP-007 member cannot delete mirror');
select throws_ok($$insert into public.stock_erp_mirror(org_id,stock_document_id,company_id,state,fetched_at,command_generation) values ('15120000-0000-0000-0000-000000000001','15120000-0000-0000-0000-000000003001',42,'pending',now(),1)$$,'42501',null,'AC-OSP-007 member cannot insert mirror');
reset role;

select lives_ok($$update public.stock_documents set status='Posted',posted_by='15120000-0000-0000-0000-0000000000a4',posted_at=now() where id='15120000-0000-0000-0000-000000003001'$$, 'AC-OSP-006 confirmed command actor can finalize');
select is((select count(*)::int from public.stock_ledger where document_id='15120000-0000-0000-0000-000000003001'),0,'AC-OSP-006 connected posting creates no standalone ledger');
insert into public.stock_documents (id,org_id,number,kind,warehouse_id,to_warehouse_id,occurred_on,created_by)
values ('15120000-0000-0000-0000-000000003006','15120000-0000-0000-0000-000000000001','T6','transfer','15120000-0000-0000-0000-000000002002','15120000-0000-0000-0000-000000002001',public.stock_org_today('15120000-0000-0000-0000-000000000001'),'15120000-0000-0000-0000-0000000000a4');
insert into public.stock_document_lines (org_id,document_id,line_no,item_id,quantity) values ('15120000-0000-0000-0000-000000000001','15120000-0000-0000-0000-000000003006',1,'15120000-0000-0000-0000-000000001001',1);
set local role service_role;
select public.stk_test_command('15120000-0000-0000-0000-000000003006','15120000-0000-0000-0000-000000000001','15120000-0000-0000-0000-0000000000a4');
select throws_like($$select public.stk_test_mirror('15120000-0000-0000-0000-000000000001','15120000-0000-0000-0000-000000003006',42,0,'confirmed','stock.picking','77',1,10,now())$$,'STK_MIRROR_STATE%','AC-OSP-007 confirmed evidence is refused while the command is pending');
reset role;
update public.external_command_outbox set state='committed' where pmo_record_id='15120000-0000-0000-0000-000000003006';
set local role service_role;
select throws_ok($$select public.stk_test_mirror('15120000-0000-0000-0000-000000000001','15120000-0000-0000-0000-000000003006',42,0,'confirmed','stock.picking','77',1,10,now())$$,'23505',null,'AC-OSP-007 ERP movement cannot belong to two documents');
reset role;

-- Round 3: committed or confirmed command with a confirmed mirror finalizes, only for its own actor.
insert into public.stock_documents (id,org_id,number,kind,warehouse_id,to_warehouse_id,occurred_on,created_by)
values ('15120000-0000-0000-0000-000000003007','15120000-0000-0000-0000-000000000001','T7','transfer','15120000-0000-0000-0000-000000002002','15120000-0000-0000-0000-000000002001',public.stock_org_today('15120000-0000-0000-0000-000000000001'),'15120000-0000-0000-0000-0000000000a4');
insert into public.stock_document_lines (org_id,document_id,line_no,item_id,quantity) values ('15120000-0000-0000-0000-000000000001','15120000-0000-0000-0000-000000003007',1,'15120000-0000-0000-0000-000000001001',1);
set local role service_role;
select public.stk_test_command('15120000-0000-0000-0000-000000003007','15120000-0000-0000-0000-000000000001','15120000-0000-0000-0000-0000000000a4');
reset role;
update public.external_command_outbox set state='committed' where pmo_record_id='15120000-0000-0000-0000-000000003007';
select throws_like($$update public.stock_documents set status='Posted',posted_by='15120000-0000-0000-0000-0000000000a4',posted_at=now() where id='15120000-0000-0000-0000-000000003007'$$,'STK_PENDING%','AC-OSP-007 committed command without confirmed mirror cannot finalize (own document)');
set local role service_role;
select lives_ok($$select public.stk_test_mirror('15120000-0000-0000-0000-000000000001','15120000-0000-0000-0000-000000003007',42,0,'confirmed','stock.picking','78',1,10,now())$$,'AC-OSP-007 mirror confirmed while the command is committed');
reset role;
select throws_like($$update public.stock_documents set status='Posted',posted_by='15120000-0000-0000-0000-0000000000a1',posted_at=now() where id='15120000-0000-0000-0000-000000003007'$$,'STK_PENDING%','AC-OSP-007 committed command finalizes only for its own actor');
select lives_ok($$update public.stock_documents set status='Posted',posted_by='15120000-0000-0000-0000-0000000000a4',posted_at=now() where id='15120000-0000-0000-0000-000000003007'$$,'AC-OSP-007 committed command with confirmed mirror finalizes to Posted');
select is((select status from public.stock_documents where id='15120000-0000-0000-0000-000000003007'),'Posted','AC-OSP-007 the document is Posted after a committed finalize');

-- Round 3: a failed command is refreshed by a person pressing Post again (revision and actor only, full guard).
insert into public.stock_documents (id,org_id,number,kind,warehouse_id,to_warehouse_id,occurred_on,created_by)
values ('15120000-0000-0000-0000-000000003011','15120000-0000-0000-0000-000000000001','T11','transfer','15120000-0000-0000-0000-000000002003','15120000-0000-0000-0000-000000002001',public.stock_org_today('15120000-0000-0000-0000-000000000001'),'15120000-0000-0000-0000-0000000000a5');
insert into public.stock_document_lines (org_id,document_id,line_no,item_id,quantity) values ('15120000-0000-0000-0000-000000000001','15120000-0000-0000-0000-000000003011',1,'15120000-0000-0000-0000-000000001001',1);
set local role service_role;
select public.stk_test_command('15120000-0000-0000-0000-000000003011','15120000-0000-0000-0000-000000000001','15120000-0000-0000-0000-0000000000a5');
update public.external_command_outbox set state='failed' where pmo_record_id='15120000-0000-0000-0000-000000003011';
reset role;
select public.stk_t_as_user('15120000-0000-0000-0000-0000000000a5');
select public.save_stock_draft('15120000-0000-0000-0000-000000003011'::uuid,jsonb_build_object('warehouse_id','15120000-0000-0000-0000-000000002003','to_warehouse_id','15120000-0000-0000-0000-000000002001'),jsonb_build_array(jsonb_build_object('item_id','15120000-0000-0000-0000-000000001001','quantity',2)));
reset role;
set local role service_role;
select throws_like($$update public.external_command_outbox set payload=jsonb_set(payload,'{documentRevision}',to_jsonb(5)) where pmo_record_id='15120000-0000-0000-0000-000000003011'$$,'STK_COMMAND%','AC-OSP-006 refresh to a stale revision refused');
select throws_like($$update public.external_command_outbox set actor_user_id='15120000-0000-0000-0000-0000000000a6',payload=jsonb_set(payload,'{documentRevision}',to_jsonb((select revision from public.stock_documents where id='15120000-0000-0000-0000-000000003011'))) where pmo_record_id='15120000-0000-0000-0000-000000003011'$$,'STK_NOT_KEEPER%','AC-OSP-006 refresh by a non-keeper refused');
select throws_like($$update public.external_command_outbox set payload=jsonb_set(payload,'{stockDocumentId}',to_jsonb('15120000-0000-0000-0000-000000003001'::text)) where pmo_record_id='15120000-0000-0000-0000-000000003011'$$,'STK_COMMAND%','AC-OSP-006 refresh changing stockDocumentId refused');
select throws_like($$update public.external_command_outbox set payload=jsonb_set(payload,'{odooCompanyId}',to_jsonb(43)) where pmo_record_id='15120000-0000-0000-0000-000000003011'$$,'STK_COMMAND%','AC-OSP-006 refresh changing odooCompanyId refused');
select throws_like($$update public.external_command_outbox set payload=payload||'{"extra":1}' where pmo_record_id='15120000-0000-0000-0000-000000003011'$$,'STK_COMMAND%','AC-OSP-006 refresh adding a payload key refused');
select lives_ok($$update public.external_command_outbox set payload=jsonb_set(payload,'{documentRevision}',to_jsonb((select revision from public.stock_documents where id='15120000-0000-0000-0000-000000003011'))) where pmo_record_id='15120000-0000-0000-0000-000000003011'$$,'AC-OSP-006 refresh of a failed row to the current revision is accepted');
select lives_ok($$update public.external_command_outbox set actor_user_id='15120000-0000-0000-0000-0000000000a1' where pmo_record_id='15120000-0000-0000-0000-000000003011'$$,'AC-OSP-006 refresh may hand the row to another authorised actor');
select is((select payload->>'documentRevision' from public.external_command_outbox where pmo_record_id='15120000-0000-0000-0000-000000003011'),'2','AC-OSP-006 the refreshed row carries the current revision');
reset role;
select is((select count(*)::int from public.audit_events where action='stock.admin_post' and entity_id='15120000-0000-0000-0000-000000003011' and actor_id='15120000-0000-0000-0000-0000000000a1'),1,'AC-OSP-006 an Admin override through a refresh is audited');
reset role;
update public.external_command_outbox set state='pending' where pmo_record_id='15120000-0000-0000-0000-000000003011';
select throws_like($$update public.external_command_outbox set actor_user_id='15120000-0000-0000-0000-0000000000a5' where pmo_record_id='15120000-0000-0000-0000-000000003011'$$,'STK_COMMAND%','AC-OSP-006 refresh on a pending row refused');
update public.external_command_outbox set state='committing' where pmo_record_id='15120000-0000-0000-0000-000000003011';
select throws_like($$update public.external_command_outbox set actor_user_id='15120000-0000-0000-0000-0000000000a5' where pmo_record_id='15120000-0000-0000-0000-000000003011'$$,'STK_COMMAND%','AC-OSP-006 refresh on a committing row refused');
update public.external_command_outbox set state='held' where pmo_record_id='15120000-0000-0000-0000-000000003011';
select throws_like($$update public.external_command_outbox set actor_user_id='15120000-0000-0000-0000-0000000000a5' where pmo_record_id='15120000-0000-0000-0000-000000003011'$$,'STK_COMMAND%','AC-OSP-006 refresh on a held row refused');
update public.external_command_outbox set state='failed' where pmo_record_id='15120000-0000-0000-0000-000000003011';

-- Round 3: inventory ownership cannot be released while any inventory command of the organisation is live.
select throws_like($$delete from public.external_domain_ownership where org_id='15120000-0000-0000-0000-000000000002' and domain='inventory'$$,'STK_COMMANDS_LIVE%','AC-OSP-006 inventory ownership release refused while a command is live');
update public.external_command_outbox set state='held' where org_id='15120000-0000-0000-0000-000000000002' and domain='inventory';
select throws_like($$delete from public.external_domain_ownership where org_id='15120000-0000-0000-0000-000000000002' and domain='inventory'$$,'STK_COMMANDS_LIVE%','AC-OSP-006 inventory ownership release refused while a command is held');
update public.external_command_outbox set state='failed' where org_id='15120000-0000-0000-0000-000000000002' and domain='inventory';
select lives_ok($$delete from public.external_domain_ownership where org_id='15120000-0000-0000-0000-000000000002' and domain='inventory'$$,'AC-OSP-006 inventory ownership release accepted once every command is failed or confirmed');
alter table public.external_domain_ownership disable trigger external_domain_ownership_stock_drafts;
insert into public.external_domain_ownership (org_id,external_tier,domain) values ('15120000-0000-0000-0000-000000000002','odoo','inventory');
alter table public.external_domain_ownership enable trigger external_domain_ownership_stock_drafts;
update public.external_command_outbox set state='confirmed' where org_id='15120000-0000-0000-0000-000000000002' and domain='inventory';
select lives_ok($$delete from public.external_domain_ownership where org_id='15120000-0000-0000-0000-000000000002' and domain='inventory'$$,'AC-OSP-006 inventory ownership release accepted with confirmed commands');

-- Recovery steps never re-judge the actor, the items or the date: the transfer may already be in Odoo and must stay adoptable.
insert into public.stock_documents (id,org_id,number,kind,warehouse_id,to_warehouse_id,occurred_on,created_by) values ('15120000-0000-0000-0000-000000003020','15120000-0000-0000-0000-000000000001','T20','transfer','15120000-0000-0000-0000-000000002003','15120000-0000-0000-0000-000000002001',public.stock_org_today('15120000-0000-0000-0000-000000000001'),'15120000-0000-0000-0000-0000000000a5');
insert into public.stock_document_lines (org_id,document_id,line_no,item_id,quantity) values ('15120000-0000-0000-0000-000000000001','15120000-0000-0000-0000-000000003020',1,'15120000-0000-0000-0000-000000001001',1);
set local role service_role;
select public.stk_test_command('15120000-0000-0000-0000-000000003020','15120000-0000-0000-0000-000000000001','15120000-0000-0000-0000-0000000000a5');
select lives_ok($$update public.external_command_outbox set state='committing',claim_generation=claim_generation+1 where pmo_record_id='15120000-0000-0000-0000-000000003020'$$,'AC-OSP-006 the first claim of a pending command is judged and accepted');
reset role;
delete from public.stock_warehouse_keepers where user_id='15120000-0000-0000-0000-0000000000a5' and warehouse_id='15120000-0000-0000-0000-000000002003';
set local role service_role;
select lives_ok($$update public.external_command_outbox set state='quarantined',claim_generation=claim_generation+1 where pmo_record_id='15120000-0000-0000-0000-000000003020'$$,'AC-OSP-006 quarantine is not refused after the keeper is unassigned');
select lives_ok($$update public.external_command_outbox set state='committing',claim_generation=claim_generation+1 where pmo_record_id='15120000-0000-0000-0000-000000003020'$$,'AC-OSP-006 the recovery claim of a quarantined row is not refused after the keeper is unassigned');
update public.external_command_outbox set state='held' where pmo_record_id='15120000-0000-0000-0000-000000003020';
reset role;
update auth.users set banned_until=now()+interval '1 day' where id='15120000-0000-0000-0000-0000000000a5';
set local role service_role;
select lives_ok($$update public.external_command_outbox set state='failed',claim_generation=claim_generation+1,last_error='hold released by operator test: checked in Odoo' where pmo_record_id='15120000-0000-0000-0000-000000003020'$$,'AC-OSP-006 releasing a hold is not refused after the keeper is deactivated');
select throws_ok($$update public.external_command_outbox set state='committing',claim_generation=claim_generation+1 where pmo_record_id='15120000-0000-0000-0000-000000003020'$$,'42501',null,'AC-OSP-006 a re-post by the deactivated keeper is still refused');
reset role;
update auth.users set banned_until=null where id='15120000-0000-0000-0000-0000000000a5';
insert into public.stock_warehouse_keepers (org_id,warehouse_id,user_id) values ('15120000-0000-0000-0000-000000000001','15120000-0000-0000-0000-000000002003','15120000-0000-0000-0000-0000000000a5');
insert into public.stock_documents (id,org_id,number,kind,warehouse_id,to_warehouse_id,occurred_on,created_by) values ('15120000-0000-0000-0000-000000003021','15120000-0000-0000-0000-000000000001','T21','transfer','15120000-0000-0000-0000-000000002002','15120000-0000-0000-0000-000000002001',public.stock_org_today('15120000-0000-0000-0000-000000000001'),'15120000-0000-0000-0000-0000000000a4');
insert into public.stock_document_lines (org_id,document_id,line_no,item_id,quantity) values ('15120000-0000-0000-0000-000000000001','15120000-0000-0000-0000-000000003021',1,'15120000-0000-0000-0000-000000001001',1);
set local role service_role;
select public.stk_test_command('15120000-0000-0000-0000-000000003021','15120000-0000-0000-0000-000000000001','15120000-0000-0000-0000-0000000000a4');
update public.external_command_outbox set state='committing',claim_generation=claim_generation+1 where pmo_record_id='15120000-0000-0000-0000-000000003021';
update public.external_command_outbox set state='held' where pmo_record_id='15120000-0000-0000-0000-000000003021';
reset role;
alter table public.stock_documents disable trigger stock_documents_command_guard;
update public.stock_documents set occurred_on=public.stock_org_today('15120000-0000-0000-0000-000000000001')-40 where id='15120000-0000-0000-0000-000000003021';
alter table public.stock_documents enable trigger stock_documents_command_guard;
set local role service_role;
select lives_ok($$update public.external_command_outbox set state='failed',claim_generation=claim_generation+1,last_error='hold released by operator test: checked in Odoo' where pmo_record_id='15120000-0000-0000-0000-000000003021'$$,'AC-OSP-006 releasing a hold is not refused after the document passed the 31-day line');
select throws_like($$update public.external_command_outbox set state='committing',claim_generation=claim_generation+1 where pmo_record_id='15120000-0000-0000-0000-000000003021'$$,'STK_BACKDATE%','AC-OSP-006 a re-post by a keeper after the 31-day line is still refused');
reset role;

-- A released hold, or a document whose transfer Odoo names, is still live: the transfer may exist in Odoo.
insert into public.stock_documents (id,org_id,number,kind,warehouse_id,to_warehouse_id,occurred_on,created_by) values ('15120000-0000-0000-0000-000000003022','15120000-0000-0000-0000-000000000001','T22','transfer','15120000-0000-0000-0000-000000002002','15120000-0000-0000-0000-000000002001',public.stock_org_today('15120000-0000-0000-0000-000000000001'),'15120000-0000-0000-0000-0000000000a4');
insert into public.stock_document_lines (org_id,document_id,line_no,item_id,quantity) values ('15120000-0000-0000-0000-000000000001','15120000-0000-0000-0000-000000003022',1,'15120000-0000-0000-0000-000000001001',1);
set local role service_role;
select public.stk_test_command('15120000-0000-0000-0000-000000003022','15120000-0000-0000-0000-000000000001','15120000-0000-0000-0000-0000000000a4');
update public.external_command_outbox set state='failed',last_error='hold released by operator test: checked in Odoo' where pmo_record_id='15120000-0000-0000-0000-000000003022';
reset role;
select public.stk_t_as_user('15120000-0000-0000-0000-0000000000a4');
select throws_like($$select public.cancel_stock_document('15120000-0000-0000-0000-000000003022')$$,'STK_PENDING%','AC-OSP-006 a released hold prevents cancel');
reset role;
select throws_like($$update public.stock_document_lines set quantity=2 where document_id='15120000-0000-0000-0000-000000003022'$$,'STK_PENDING%','AC-OSP-006 a released hold prevents line edits');
update public.external_command_outbox set last_error='Odoo refused' where pmo_record_id='15120000-0000-0000-0000-000000003022';
select lives_ok($$update public.stock_document_lines set quantity=2 where document_id='15120000-0000-0000-0000-000000003022'$$,'AC-OSP-006 a plain failed command allows line edits');
set local role service_role;
select lives_ok($$select public.stk_test_mirror('15120000-0000-0000-0000-000000000001','15120000-0000-0000-0000-000000003022',42,(select claim_generation from public.external_command_outbox where pmo_record_id='15120000-0000-0000-0000-000000003022'),'held','stock.picking','88',null,null,null,'held',  'WH/INT/00088')$$,'AC-OSP-007 a held mirror row that names the transfer is stored');
reset role;
select throws_like($$update public.stock_document_lines set quantity=3 where document_id='15120000-0000-0000-0000-000000003022'$$,'STK_PENDING%','AC-OSP-006 a mirror row that names the transfer prevents line edits');
set local role service_role;
select throws_like($$select public.stk_test_mirror('15120000-0000-0000-0000-000000000001','15120000-0000-0000-0000-000000003022',42,(select claim_generation from public.external_command_outbox where pmo_record_id='15120000-0000-0000-0000-000000003022'),'failed',null,null,null,null,null,'x')$$,'STK_MIRROR_TRANSFER%','AC-OSP-007 evidence that names a transfer cannot lose it');
select lives_ok($$select public.stk_test_mirror('15120000-0000-0000-0000-000000000001','15120000-0000-0000-0000-000000003022',42,(select claim_generation from public.external_command_outbox where pmo_record_id='15120000-0000-0000-0000-000000003022'),'held','stock.picking','88',null,null,null,'held again','WH/INT/00088')$$,'AC-OSP-007 the same transfer may be written again');
reset role;

select public.stk_t_as_user('15120000-0000-0000-0000-0000000000a4');
select throws_like($$select public.cancel_stock_document('15120000-0000-0000-0000-000000003022')$$,'STK_PENDING%','AC-OSP-006 a mirror row that names the transfer prevents cancel');
reset role;
insert into public.stock_documents (id,org_id,number,kind,warehouse_id,to_warehouse_id,occurred_on,created_by) values ('15120000-0000-0000-0000-000000003023','15120000-0000-0000-0000-000000000001','T23','transfer','15120000-0000-0000-0000-000000002002','15120000-0000-0000-0000-000000002001',public.stock_org_today('15120000-0000-0000-0000-000000000001'),'15120000-0000-0000-0000-0000000000a4');
insert into public.stock_document_lines (org_id,document_id,line_no,item_id,quantity) values ('15120000-0000-0000-0000-000000000001','15120000-0000-0000-0000-000000003023',1,'15120000-0000-0000-0000-000000001001',1);
set local role service_role;
select public.stk_test_command('15120000-0000-0000-0000-000000003023','15120000-0000-0000-0000-000000000001','15120000-0000-0000-0000-0000000000a4');
update public.external_command_outbox set state='failed' where pmo_record_id='15120000-0000-0000-0000-000000003023';
select lives_ok($$select public.stk_test_mirror('15120000-0000-0000-0000-000000000001','15120000-0000-0000-0000-000000003023',42,(select claim_generation from public.external_command_outbox where pmo_record_id='15120000-0000-0000-0000-000000003023'),'failed',null,null,null,null,null,'The transfer operation type is not set')$$,'AC-OSP-007 a failed mirror row without a transfer is stored');
reset role;
select public.stk_t_as_user('15120000-0000-0000-0000-0000000000a4');
select lives_ok($$select public.cancel_stock_document('15120000-0000-0000-0000-000000003023')$$,'AC-OSP-006 a failed mirror row without a transfer does not prevent cancel');
reset role;

-- An ERP-owned organisation posts only through a committed command with a confirmed mirror, whatever the command state.
insert into public.stock_documents (id,org_id,number,kind,warehouse_id,to_warehouse_id,occurred_on,created_by) values ('15120000-0000-0000-0000-000000003024','15120000-0000-0000-0000-000000000001','T24','transfer','15120000-0000-0000-0000-000000002002','15120000-0000-0000-0000-000000002001',public.stock_org_today('15120000-0000-0000-0000-000000000001'),'15120000-0000-0000-0000-0000000000a4');
insert into public.stock_document_lines (org_id,document_id,line_no,item_id,quantity) values ('15120000-0000-0000-0000-000000000001','15120000-0000-0000-0000-000000003024',1,'15120000-0000-0000-0000-000000001001',1);
select throws_like($$update public.stock_documents set status='Posted',posted_by='15120000-0000-0000-0000-0000000000a4',posted_at=now() where id='15120000-0000-0000-0000-000000003024'$$,'STK_PENDING%','AC-OSP-006 no command cannot finalize in an ERP-owned organisation');
select throws_like($$update public.stock_documents set status='Posted',posted_by='15120000-0000-0000-0000-0000000000a1',posted_at=now() where id='15120000-0000-0000-0000-000000003011'$$,'STK_PENDING%','AC-OSP-006 a failed command cannot finalize in an ERP-owned organisation');

-- A separate draft proves the stored Admin override and failed-command unlock.
insert into public.stock_documents (id,org_id,number,kind,warehouse_id,to_warehouse_id,occurred_on,created_by)
values ('15120000-0000-0000-0000-000000003005','15120000-0000-0000-0000-000000000001','T3','transfer','15120000-0000-0000-0000-000000002002','15120000-0000-0000-0000-000000002001',public.stock_org_today('15120000-0000-0000-0000-000000000001'),'15120000-0000-0000-0000-0000000000a1');
insert into public.stock_document_lines (org_id,document_id,line_no,item_id,quantity) values ('15120000-0000-0000-0000-000000000001','15120000-0000-0000-0000-000000003005',1,'15120000-0000-0000-0000-000000001001',1);
set local role service_role;
select lives_ok($$select public.stk_test_command('15120000-0000-0000-0000-000000003005','15120000-0000-0000-0000-000000000001','15120000-0000-0000-0000-0000000000a1')$$, 'AC-OSP-006 stored Admin can submit without keeper assignment');
reset role;
select is((select count(*)::int from public.audit_events where action='stock.admin_post' and entity_id='15120000-0000-0000-0000-000000003005' and actor_id='15120000-0000-0000-0000-0000000000a1'),1,'AC-OSP-006 Admin override is audited');
select throws_like($$update public.stock_documents set status='Posted',posted_by='15120000-0000-0000-0000-0000000000a1',posted_at=now(),note='changed' where id='15120000-0000-0000-0000-000000003005'$$,'STK_PENDING%','AC-OSP-006 pending cannot finalize or change intent');
update public.external_command_outbox set state='failed' where pmo_record_id='15120000-0000-0000-0000-000000003005';
select lives_ok($$update public.stock_document_lines set quantity=2 where document_id='15120000-0000-0000-0000-000000003005'$$, 'AC-OSP-006 failed command allows line edits');
select public.stk_t_as_user('15120000-0000-0000-0000-0000000000a1');
select lives_ok($$select public.cancel_stock_document('15120000-0000-0000-0000-000000003005')$$, 'AC-OSP-006 failed command allows cancel');
reset role;
-- A failed command is claimable only while its recorded intent and actor still pass.
select public.stk_t_as_user('15120000-0000-0000-0000-0000000000a4');
select set_config('stk.retry',public.create_stock_document(jsonb_build_object('kind','transfer','warehouse_id','15120000-0000-0000-0000-000000002002','to_warehouse_id','15120000-0000-0000-0000-000000002001'),jsonb_build_array(jsonb_build_object('item_id','15120000-0000-0000-0000-000000001001','quantity',1)))::text,true);
reset role;
set local role service_role;
select public.stk_test_command(current_setting('stk.retry'),'15120000-0000-0000-0000-000000000001','15120000-0000-0000-0000-0000000000a4');
update public.external_command_outbox set state='failed' where pmo_record_id=current_setting('stk.retry');
select lives_ok($$update public.external_command_outbox set state='committing',claim_generation=claim_generation+1 where pmo_record_id=current_setting('stk.retry')$$,'AC-OSP-006 unchanged failed command can be claimed');
update public.external_command_outbox set state='failed' where pmo_record_id=current_setting('stk.retry');
reset role;
select public.stk_t_as_user('15120000-0000-0000-0000-0000000000a4');
select public.save_stock_draft(current_setting('stk.retry')::uuid,jsonb_build_object('warehouse_id','15120000-0000-0000-0000-000000002002','to_warehouse_id','15120000-0000-0000-0000-000000002001'),jsonb_build_array(jsonb_build_object('item_id','15120000-0000-0000-0000-000000001001','quantity',2)));
reset role;
set local role service_role;
select throws_like($$update public.external_command_outbox set state='committing' where pmo_record_id=current_setting('stk.retry')$$,'STK_COMMAND%','AC-OSP-006 state-only claim cannot bypass stale revision');
select throws_like($$update public.external_command_outbox set state='committing',claim_generation=claim_generation+1 where pmo_record_id=current_setting('stk.retry')$$,'STK_COMMAND%','AC-OSP-006 changed draft cannot be claimed with stale revision');
select is((select state from public.external_command_outbox where pmo_record_id=current_setting('stk.retry')),'failed','AC-OSP-006 stale claim preserves failed state');
reset role;
update public.external_command_outbox set payload=jsonb_set(payload,'{documentRevision}',to_jsonb((select revision from public.stock_documents where id=current_setting('stk.retry')::uuid))) where pmo_record_id=current_setting('stk.retry');
delete from public.stock_warehouse_keepers where user_id='15120000-0000-0000-0000-0000000000a4' and warehouse_id='15120000-0000-0000-0000-000000002002';
set local role service_role;
select throws_like($$update public.external_command_outbox set state='committing',claim_generation=claim_generation+1 where pmo_record_id=current_setting('stk.retry')$$,'STK_NOT_KEEPER%','AC-OSP-006 removed keeper cannot claim a failed command');
select is((select state from public.external_command_outbox where pmo_record_id=current_setting('stk.retry')),'failed','AC-OSP-006 keeper refusal preserves failed state');
reset role;
select ok(has_column_privilege('service_role','public.stock_documents','status','UPDATE') and has_column_privilege('service_role','public.stock_documents','posted_by','UPDATE') and has_column_privilege('service_role','public.stock_documents','posted_at','UPDATE'), 'AC-OSP-006 the handler can write the three Posted columns');
select ok(not has_column_privilege('service_role','public.stock_documents','note','UPDATE') and not has_column_privilege('service_role','public.stock_documents','revision','UPDATE'), 'AC-OSP-006 and no other column of the document');
select * from finish();
rollback;

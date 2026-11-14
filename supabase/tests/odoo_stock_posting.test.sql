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
delete from public.external_domain_ownership where org_id='15120000-0000-0000-0000-000000000001' and domain='inventory';
select throws_like($$update public.external_command_outbox set claim_generation=claim_generation+1 where domain='inventory'$$, 'STK_OWNERSHIP%', 'AC-OSP-006 claim refuses released ownership');
-- Restore ownership directly for the claim fixture; the employment gate correctly sees the existing drafts.
alter table public.external_domain_ownership disable trigger external_domain_ownership_stock_drafts;
insert into public.external_domain_ownership (org_id, external_tier, domain) values ('15120000-0000-0000-0000-000000000001','odoo','inventory');
alter table public.external_domain_ownership enable trigger external_domain_ownership_stock_drafts;
update public.external_org_bindings set config='{"odoo_company_id":43}' where org_id='15120000-0000-0000-0000-000000000001' and external_tier='odoo';
select throws_like($$update public.external_command_outbox set claim_generation=claim_generation+1 where domain='inventory'$$, 'STK_COMPANY%', 'AC-OSP-006 claim refuses changed company');
update public.external_org_bindings set config='{"odoo_company_id":42}' where org_id='15120000-0000-0000-0000-000000000001' and external_tier='odoo';
select lives_ok($$update public.external_command_outbox set claim_generation=claim_generation+1 where domain='inventory'$$, 'AC-OSP-006 claim accepts matching ownership and company');
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
select throws_like($$update public.stock_documents set status='Posted',posted_by='15120000-0000-0000-0000-0000000000a4',posted_at=now() where id='15120000-0000-0000-0000-000000003001'$$, 'STK_PENDING%', 'AC-OSP-006 committed cannot finalize');
update public.external_command_outbox set state='held' where domain='inventory';
select throws_like($$update public.stock_documents set status='Posted',posted_by='15120000-0000-0000-0000-0000000000a4',posted_at=now() where id='15120000-0000-0000-0000-000000003001'$$, 'STK_PENDING%', 'AC-OSP-006 held cannot finalize');
update public.external_command_outbox set state='quarantined' where domain='inventory';
select throws_like($$update public.stock_documents set status='Posted',posted_by='15120000-0000-0000-0000-0000000000a4',posted_at=now() where id='15120000-0000-0000-0000-000000003001'$$, 'STK_PENDING%', 'AC-OSP-006 quarantined cannot finalize');
update public.external_command_outbox set state='confirmed' where domain='inventory';
select throws_like($$update public.stock_documents set status='Posted',posted_by='15120000-0000-0000-0000-0000000000a1',posted_at=now() where id='15120000-0000-0000-0000-000000003001'$$, 'STK_PENDING%', 'AC-OSP-006 only command actor finalizes');
select lives_ok($$update public.stock_documents set status='Posted',posted_by='15120000-0000-0000-0000-0000000000a4',posted_at=now() where id='15120000-0000-0000-0000-000000003001'$$, 'AC-OSP-006 confirmed command actor can finalize');
select is((select count(*)::int from public.stock_ledger where document_id='15120000-0000-0000-0000-000000003001'),0,'AC-OSP-006 connected posting creates no standalone ledger');
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
select * from finish();
rollback;

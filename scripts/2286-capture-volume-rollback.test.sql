-- #2286 PR A: the down for 0904 restores the 3-argument ledger page and the 0873 source page and drops the purchase_orders
-- index; the restored functions answer exactly what 0904's answered ('all' scope for the ledger); the up then applies again.
-- scripts/test-2286-capture-rollback.sh inlines the down and the up. One transaction; nothing is left behind.
begin;
select plan(11);
insert into organizations (id, name, default_currency) values ('22860800-0000-0000-0000-000000000001','Rollback 2286','USD');
insert into auth.users (id, email) values ('22860800-0000-0000-0000-000000000002','rollback-2286@example.test');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('22860800-0000-0000-0000-000000000002','22860800-0000-0000-0000-000000000001','Admin','rollback-2286@example.test','Admin','active');
insert into projects (id, org_id, name, status) values
  ('22860800-0000-0000-0000-000000000004','22860800-0000-0000-0000-000000000001','Project','Ongoing Project');
insert into companies (id, org_id, name, type) values
  ('22860800-0000-0000-0000-000000000005','22860800-0000-0000-0000-000000000001','Supplier','Vendor');
insert into external_refs (org_id, domain, pmo_record_id, external_tier, external_record_id) values
  ('22860800-0000-0000-0000-000000000001','companies','22860800-0000-0000-0000-000000000005','erpnext','Supplier:SUP-1');
insert into external_org_bindings (org_id, external_tier, site_url, secret_ref, config, activated_at, status) values
  ('22860800-0000-0000-0000-000000000001','erpnext','https://example.test','test-ref',
   '{"company":"Example","project_map":{"22860800-0000-0000-0000-000000000004":"PROJECT"}}',now(),'active');
-- Two documents: an order and its invoice, on the project.
insert into erp_purchase_documents(id,org_id,erp_doctype,erp_name,supplier,supplier_name,currency,net_total,grand_total,erp_docstatus,erp_status,erp_project,project_ids,purchase_orders,erp_modified) values
 ('22860800-0000-0000-0000-000000000101','22860800-0000-0000-0000-000000000001','Purchase Order','PO-1','SUP-1','Supplier','USD',10,10,1,'To Bill','PROJECT',array['22860800-0000-0000-0000-000000000004'::uuid],'{}','2026-02-01'),
 ('22860800-0000-0000-0000-000000000102','22860800-0000-0000-0000-000000000001','Purchase Invoice','PI-1','SUP-1','Supplier','USD',10,10,1,'Unpaid','PROJECT',array['22860800-0000-0000-0000-000000000004'::uuid],array['PO-1'],'2026-02-01');
insert into erp_gl_entry_mirror(id,org_id,erp_name,company,account,project,voucher_type,voucher_no,posting_date,debit,credit,is_cancelled,erp_modified) values
 ('22860800-0000-0000-0000-000000000201','22860800-0000-0000-0000-000000000001','GL-1','Example','Cost','PROJECT','Purchase Invoice','PI-1','2026-02-01',10,0,false,'2026-02-01'),
 ('22860800-0000-0000-0000-000000000202','22860800-0000-0000-0000-000000000001','GL-2','Example','Cost',null,'Journal Entry','JV-1','2026-02-01',3,1,false,'2026-02-01'),
 ('22860800-0000-0000-0000-000000000203','22860800-0000-0000-0000-000000000001','GL-3','Other','Cost','PROJECT','Payment Entry','PAY-1','2026-02-01',null,2,false,'2026-02-01');
create temp table answers(name text primary key, value jsonb);
grant all on answers to authenticated;
create function pg_temp.answer(p_name text, p_sql text) returns void language plpgsql as $$
declare v jsonb; begin
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims','{"sub":"22860800-0000-0000-0000-000000000002","role":"authenticated"}',true);
  execute p_sql into v;
  execute 'reset role';
  insert into answers values (p_name, v) on conflict (name) do update set value = excluded.value;
end $$;
select pg_temp.answer('source', 'select public.purchase_capture_source_page(null,null,500)');
select pg_temp.answer('source_project', 'select public.purchase_capture_source_page(null,''22860800-0000-0000-0000-000000000004'',500)');
select pg_temp.answer('ledger', 'select public.purchase_capture_ledger_page(null,500,null,''all'')');
select pg_temp.answer('ledger_project', 'select public.purchase_capture_ledger_page(null,500,''22860800-0000-0000-0000-000000000004'',''all'')');

select lives_ok($down$
-- @0904_DOWN@
$down$,'#2286 the down for 0904 runs');
select ok(to_regprocedure('public.purchase_capture_ledger_page(uuid,integer,uuid)') is not null
  and to_regprocedure('public.purchase_capture_ledger_page(uuid,integer,uuid,text)') is null,'#2286 the 3-argument ledger page is back and the scoped one is gone');
select ok(has_function_privilege('authenticated','public.purchase_capture_ledger_page(uuid,integer,uuid)','execute')
  and not has_function_privilege('anon','public.purchase_capture_ledger_page(uuid,integer,uuid)','execute'),'#2286 the restored ledger page keeps its grants');
select is(to_regclass('public.erp_purchase_documents_purchase_orders_idx'),null,'#2286 the purchase_orders index is gone');
select pg_temp.answer('source_down', 'select public.purchase_capture_source_page(null,null,500)');
select pg_temp.answer('source_project_down', 'select public.purchase_capture_source_page(null,''22860800-0000-0000-0000-000000000004'',500)');
select pg_temp.answer('ledger_down', 'select public.purchase_capture_ledger_page(null,500,null)');
select pg_temp.answer('ledger_project_down', 'select public.purchase_capture_ledger_page(null,500,''22860800-0000-0000-0000-000000000004'')');
select is((select value from answers where name='source_down'),(select value from answers where name='source'),'#2286 the 0873 source page answers what 0904''s did');
select is((select value from answers where name='source_project_down'),(select value from answers where name='source_project'),'#2286 and in a project scope');
select is((select value from answers where name='ledger_down'),(select value from answers where name='ledger'),'#2286 the 0866 ledger page answers what 0904''s all scope did');
select is((select value from answers where name='ledger_project_down'),(select value from answers where name='ledger_project'),'#2286 and in a project scope');

select lives_ok($up$
-- @0904_UP@
$up$,'#2286 the up applies again after the down');
select ok(to_regprocedure('public.purchase_capture_ledger_page(uuid,integer,uuid,text)') is not null
  and to_regprocedure('public.purchase_capture_ledger_page(uuid,integer,uuid)') is null,'#2286 the re-applied up leaves only the scoped ledger page');
select isnt(to_regclass('public.erp_purchase_documents_purchase_orders_idx'),null,'#2286 the re-applied up recreates the index');
select * from finish();
rollback;

begin;
create extension if not exists pgtap;
select plan(17);
insert into organizations (id,name,default_currency,default_timezone) values
 ('27620000-0000-0000-0000-000000000001','Files A','IDR','Asia/Jakarta'),
 ('27620000-0000-0000-0000-000000000002','Files B','IDR','Asia/Jakarta');
insert into auth.users (id,email) values
 ('27620000-0000-0000-0000-000000000011','files-a@example.test'),
 ('27620000-0000-0000-0000-000000000012','files-b@example.test');
insert into profiles (id,org_id,full_name,email,role,status) values
 ('27620000-0000-0000-0000-000000000011','27620000-0000-0000-0000-000000000001','Files A','files-a@example.test','Admin','active'),
 ('27620000-0000-0000-0000-000000000012','27620000-0000-0000-0000-000000000002','Files B','files-b@example.test','Admin','active');
insert into projects (id,org_id,name,status) values
 ('27620000-0000-0000-0000-000000000021','27620000-0000-0000-0000-000000000001','Files A','Ongoing Project'),
 ('27620000-0000-0000-0000-000000000022','27620000-0000-0000-0000-000000000002','Files B','Ongoing Project');
insert into work_orders (id,org_id,project_id,title,status,order_value,tax_treatment,tax_amount) values
 ('27620000-0000-0000-0000-000000000031','27620000-0000-0000-0000-000000000001','27620000-0000-0000-0000-000000000021','Files A','Issued',1000,'exclusive',0),
 ('27620000-0000-0000-0000-000000000032','27620000-0000-0000-0000-000000000002','27620000-0000-0000-0000-000000000022','Files B','Issued',1000,'exclusive',0);
insert into quantity_change_requests (id,org_id,project_id,work_order_id,author_id,editor_ids) values
 ('27620000-0000-0000-0000-000000000041','27620000-0000-0000-0000-000000000001','27620000-0000-0000-0000-000000000021','27620000-0000-0000-0000-000000000031','27620000-0000-0000-0000-000000000011',array['27620000-0000-0000-0000-000000000011'::uuid]),
 ('27620000-0000-0000-0000-000000000042','27620000-0000-0000-0000-000000000002','27620000-0000-0000-0000-000000000022','27620000-0000-0000-0000-000000000032','27620000-0000-0000-0000-000000000012',array['27620000-0000-0000-0000-000000000012'::uuid]);
insert into procurements (id,org_id,title,status,requested_by_id) values
 ('27620000-0000-0000-0000-000000000051','27620000-0000-0000-0000-000000000001','Files A','Draft','27620000-0000-0000-0000-000000000011'),
 ('27620000-0000-0000-0000-000000000052','27620000-0000-0000-0000-000000000002','Files B','Draft','27620000-0000-0000-0000-000000000012');
insert into storage.objects (id,bucket_id,name,owner) values
 ('27620000-0000-0000-0000-000000000061','quantity-change-files','27620000-0000-0000-0000-000000000001/27620000-0000-0000-0000-000000000041/27620000-0000-0000-0000-000000000071/file.pdf','27620000-0000-0000-0000-000000000011'),
 ('27620000-0000-0000-0000-000000000062','quantity-change-files','27620000-0000-0000-0000-000000000002/27620000-0000-0000-0000-000000000042/27620000-0000-0000-0000-000000000072/file.pdf','27620000-0000-0000-0000-000000000012'),
 ('27620000-0000-0000-0000-000000000063','procurement-files','27620000-0000-0000-0000-000000000001/27620000-0000-0000-0000-000000000051/quotation/27620000-0000-0000-0000-000000000073/file.pdf','27620000-0000-0000-0000-000000000011'),
 ('27620000-0000-0000-0000-000000000064','procurement-files','27620000-0000-0000-0000-000000000002/27620000-0000-0000-0000-000000000052/quotation/27620000-0000-0000-0000-000000000074/file.pdf','27620000-0000-0000-0000-000000000012');
select ok(not has_function_privilege('anon','public.actor_may_order_purchases()','EXECUTE'),'anonymous cannot execute ordering helper');
select ok(not has_function_privilege('anon','public.qcr_file_object_access(text)','EXECUTE'),'anonymous cannot execute file helper');
select is((select roles from pg_policies where schemaname='storage' and tablename='objects' and policyname='storage_objects_qcr_file_read'),array['authenticated']::name[],'file read policy is scoped');
select is((select roles from pg_policies where schemaname='storage' and tablename='objects' and policyname='storage_objects_qcr_file_write'),array['authenticated']::name[],'file write policy is scoped');
select is((select roles from pg_policies where schemaname='storage' and tablename='objects' and policyname='storage_objects_proc_file_read'),array['authenticated']::name[],'procurement file read policy is scoped');
set local role anon;
select throws_ok($$select public.actor_may_order_purchases()$$,'42501','permission denied for function actor_may_order_purchases','anonymous ordering helper call is denied');
select throws_ok($$select public.qcr_file_object_access('a/b/c/d')$$,'42501','permission denied for function qcr_file_object_access','anonymous file helper call is denied');
select lives_ok($$select count(*) from storage.objects$$,'anonymous storage listing remains usable');
select lives_ok($$select count(*) from public.purchase_orders$$,'anonymous purchase order read remains usable');
select throws_ok($$insert into storage.objects (id,bucket_id,name) values ('27620000-0000-0000-0000-000000000065','quantity-change-files','27620000-0000-0000-0000-000000000001/27620000-0000-0000-0000-000000000041/27620000-0000-0000-0000-000000000075/file.pdf')$$,'42501',null,'anonymous cannot write a quantity-change file');
select is((select count(*)::int from storage.objects where id in ('27620000-0000-0000-0000-000000000061','27620000-0000-0000-0000-000000000062')),0,'anonymous cannot read either organisation quantity-change file');
select is((select count(*)::int from storage.objects where id in ('27620000-0000-0000-0000-000000000063','27620000-0000-0000-0000-000000000064')),0,'anonymous cannot read either organisation procurement file');
reset role;
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"27620000-0000-0000-0000-000000000011","role":"authenticated"}',true);
select lives_ok($$insert into storage.objects (id,bucket_id,name) values ('27620000-0000-0000-0000-000000000066','quantity-change-files','27620000-0000-0000-0000-000000000001/27620000-0000-0000-0000-000000000041/27620000-0000-0000-0000-000000000076/file.pdf')$$,'organisation A can write a quantity-change file');
select results_eq($$select id from storage.objects where id in ('27620000-0000-0000-0000-000000000061','27620000-0000-0000-0000-000000000062')$$,$$values ('27620000-0000-0000-0000-000000000061'::uuid)$$,'organisation A reads its quantity-change file');
select results_eq($$select id from storage.objects where id in ('27620000-0000-0000-0000-000000000063','27620000-0000-0000-0000-000000000064')$$,$$values ('27620000-0000-0000-0000-000000000063'::uuid)$$,'organisation A reads its procurement file');
select set_config('request.jwt.claims','{"sub":"27620000-0000-0000-0000-000000000012","role":"authenticated"}',true);
select results_eq($$select id from storage.objects where id in ('27620000-0000-0000-0000-000000000061','27620000-0000-0000-0000-000000000062')$$,$$values ('27620000-0000-0000-0000-000000000062'::uuid)$$,'organisation B reads its quantity-change file');
select results_eq($$select id from storage.objects where id in ('27620000-0000-0000-0000-000000000063','27620000-0000-0000-0000-000000000064')$$,$$values ('27620000-0000-0000-0000-000000000064'::uuid)$$,'organisation B reads its procurement file');
select * from finish();
rollback;

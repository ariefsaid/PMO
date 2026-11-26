begin;
create extension if not exists pgtap;
select plan(14);
insert into organizations (id,name,default_currency,default_timezone,hide_prices_from_requesters) values
 ('27610000-0000-0000-0000-000000000001','Scope A','IDR','Asia/Jakarta',true),
 ('27610000-0000-0000-0000-000000000002','Scope B','IDR','Asia/Jakarta',true);
insert into org_plans (org_id,plan_id) values ('27610000-0000-0000-0000-000000000001','enterprise'),('27610000-0000-0000-0000-000000000002','enterprise');
insert into org_features (org_id,feature_key,enabled) values ('27610000-0000-0000-0000-000000000001','procurement',true),('27610000-0000-0000-0000-000000000002','procurement',true) on conflict do nothing;
insert into auth.users (id,email) values
 ('27610000-0000-0000-0000-000000000011','scope11@example.com'),
 ('27610000-0000-0000-0000-000000000012','scope12@example.com'),
 ('27610000-0000-0000-0000-000000000013','scope13@example.com');
insert into profiles (id,org_id,full_name,email,role,status) values
 ('27610000-0000-0000-0000-000000000011','27610000-0000-0000-0000-000000000001','Engineer A','scope11@example.com','Engineer','active'),
 ('27610000-0000-0000-0000-000000000012','27610000-0000-0000-0000-000000000001','Engineer B','scope12@example.com','Engineer','active'),
 ('27610000-0000-0000-0000-000000000013','27610000-0000-0000-0000-000000000002','Admin B','scope13@example.com','Admin','active');
insert into org_purchase_type_settings (org_id,enabled) values ('27610000-0000-0000-0000-000000000001',true),('27610000-0000-0000-0000-000000000002',true) on conflict (org_id) do update set enabled=true;
insert into purchase_types (id,org_id,name,is_rental,position) values
 ('27610000-0000-0000-0000-000000000021','27610000-0000-0000-0000-000000000001','Scope Hire A',true,90),
 ('27610000-0000-0000-0000-000000000022','27610000-0000-0000-0000-000000000002','Scope Hire B',true,90);
insert into procurements (id,org_id,title,status,purchase_type_id,rental_from,rental_to,requested_by_id) values
 ('27610000-0000-0000-0000-000000000031','27610000-0000-0000-0000-000000000001','Own hire','Draft','27610000-0000-0000-0000-000000000021','2026-01-01','2026-01-31','27610000-0000-0000-0000-000000000011'),
 ('27610000-0000-0000-0000-000000000032','27610000-0000-0000-0000-000000000001','Other hire','Draft','27610000-0000-0000-0000-000000000021','2026-01-01','2026-01-31','27610000-0000-0000-0000-000000000012'),
 ('27610000-0000-0000-0000-000000000033','27610000-0000-0000-0000-000000000002','B hire','Draft','27610000-0000-0000-0000-000000000022','2026-01-01','2026-01-31','27610000-0000-0000-0000-000000000013');
insert into procurement_items (id,org_id,procurement_id,name,quantity,rate) values
 ('27610000-0000-0000-0000-000000000041','27610000-0000-0000-0000-000000000001','27610000-0000-0000-0000-000000000031','Hire',1,75),
 ('27610000-0000-0000-0000-000000000042','27610000-0000-0000-0000-000000000001','27610000-0000-0000-0000-000000000032','Hire',1,75),
 ('27610000-0000-0000-0000-000000000043','27610000-0000-0000-0000-000000000002','27610000-0000-0000-0000-000000000033','Hire',1,75);
create function pg_temp.as_user(p_uid uuid) returns void language sql as $$ select set_config('request.jwt.claims',json_build_object('sub',p_uid,'role','authenticated')::text,true) $$;
grant execute on function pg_temp.as_user(uuid) to authenticated;
set local role authenticated;
select pg_temp.as_user('27610000-0000-0000-0000-000000000011');
select is(public.actor_shown_prices(),false,'requester has hidden prices');
select throws_ok($$select public.extend_rental_procurement('27610000-0000-0000-0000-000000000051','27610000-0000-0000-0000-000000000032','2026-02-01','2026-02-28')$$,'23503','PTYPE_EXT_NOT_FOUND: the rental to extend is not available','unreadable rental cannot be extended');
select throws_ok($$select public.extend_rental_procurement('27610000-0000-0000-0000-000000000051','27610000-0000-0000-0000-000000000033','2026-02-01','2026-02-28')$$,'23503','PTYPE_EXT_NOT_FOUND: the rental to extend is not available','another organisation rental is unavailable');
select lives_ok($$select public.extend_rental_procurement('27610000-0000-0000-0000-000000000052','27610000-0000-0000-0000-000000000031','2026-02-01','2026-02-28')$$,'requester extends their own rental');
select lives_ok($$select public.create_procurement_with_items('27610000-0000-0000-0000-000000000061','{"title":"Scope draft"}'::jsonb,'[{"id":"27610000-0000-0000-0000-000000000071","name":"Hire","quantity":1,"rate":75}]'::jsonb)$$,'requester creates a draft');
select lives_ok($$select public.create_procurement_with_items('27610000-0000-0000-0000-000000000061','{"title":"Scope draft"}'::jsonb,'[{"id":"27610000-0000-0000-0000-000000000071","name":"Hire","quantity":1,"rate":3}]'::jsonb)$$,'retry with a different hidden price succeeds');
reset role;
update public.procurement_create_intents set items = jsonb_set(items,'{0,rate}','3'::jsonb) where procurement_id='27610000-0000-0000-0000-000000000061';
set local role authenticated;
select lives_ok($$select public.create_procurement_with_items('27610000-0000-0000-0000-000000000061','{"title":"Scope draft"}'::jsonb,'[{"id":"27610000-0000-0000-0000-000000000071","name":"Hire","quantity":1,"rate":3}]'::jsonb)$$,'retry also ignores the saved line rate');
select throws_ok($$select public.create_procurement_with_items('27610000-0000-0000-0000-000000000061','{"title":"Scope draft"}'::jsonb,'[{"id":"27610000-0000-0000-0000-000000000071","name":"Different","quantity":1,"rate":3}]'::jsonb)$$,'23505','Saved procurement differs from request','retry still checks other fields');
reset role;
select is((select rate from procurement_items where id='27610000-0000-0000-0000-000000000071'),75::numeric,'retry keeps the saved rate');
set local role authenticated;
select pg_temp.as_user('27610000-0000-0000-0000-000000000013');
select lives_ok($$select public.extend_rental_procurement('27610000-0000-0000-0000-000000000053','27610000-0000-0000-0000-000000000033','2026-02-01','2026-02-28')$$,'other organisation can extend its rental');
select is(public.actor_shown_prices(),true,'admin sees prices');
select lives_ok($$select public.create_procurement_with_items('27610000-0000-0000-0000-000000000062','{"title":"Scope B draft"}'::jsonb,'[{"id":"27610000-0000-0000-0000-000000000072","name":"Hire","quantity":1,"rate":75}]'::jsonb)$$,'admin creates a draft');
select throws_ok($$select public.create_procurement_with_items('27610000-0000-0000-0000-000000000062','{"title":"Scope B draft"}'::jsonb,'[{"id":"27610000-0000-0000-0000-000000000072","name":"Hire","quantity":1,"rate":3}]'::jsonb)$$,'23505','Saved procurement differs from request','visible prices remain part of retry comparison');
select lives_ok($$select public.create_procurement_with_items('27610000-0000-0000-0000-000000000062','{"title":"Scope B draft"}'::jsonb,'[{"id":"27610000-0000-0000-0000-000000000072","name":"Hire","quantity":1,"rate":75}]'::jsonb)$$,'identical visible price retry succeeds');
select * from finish();
rollback;

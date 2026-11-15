-- #2259: a purchase can hold more than one capture row; undo reads the kind of the FIRST capture (captured_at, then request_id).
-- A supplier-side purchase with a later payment refuses undo (has_later_pmo_steps); a journal purchase does not check, so the two kinds
-- give different answers and the order is observable. Each mixed case inserts the row that must NOT win first, so heap order would pick it.
begin;
select plan(7);
insert into organizations(id,name,default_currency) values ('22590000-0000-0000-0000-000000000001','Kind order proof','USD');
insert into auth.users(id,email) values ('22590000-0000-0000-0000-000000000002','kind-order@example.test');
insert into profiles(id,org_id,full_name,email,role,status) values ('22590000-0000-0000-0000-000000000002','22590000-0000-0000-0000-000000000001','Admin','kind-order@example.test','Admin','active');
insert into external_org_bindings(id,org_id,external_tier,site_url,secret_ref,config,activated_at,status) values ('22590000-0000-0000-0000-000000000003','22590000-0000-0000-0000-000000000001','erpnext','https://example.test','test-ref','{}',now(),'active');
-- 1 mixed, supplier first; 2 mixed, journal first; 3 mixed, same instant (request_id decides, smaller first); 4 one supplier row; 5 one journal row
insert into procurements(id,org_id,title,requested_by_id,currency,total_value,status,origin,record_only)
select ('22590000-1000-0000-0000-'||lpad(g::text,12,'0'))::uuid,'22590000-0000-0000-0000-000000000001','Purchase '||g,'22590000-0000-0000-0000-000000000002','USD',100,'Vendor Invoiced','erp_link',false from generate_series(1,5) g;
insert into payments(id,org_id,procurement_id,status,amount,erp_docstatus)
select ('22590000-5000-0000-0000-'||lpad(g::text,12,'0'))::uuid,'22590000-0000-0000-0000-000000000001',('22590000-1000-0000-0000-'||lpad(g::text,12,'0'))::uuid,'Paid',25,1 from generate_series(1,5) g;
update procurements set record_only=true where org_id='22590000-0000-0000-0000-000000000001';
create function pg_temp.cap(p int, r int, k text, at timestamptz) returns void language sql as $$
  insert into erp_purchase_captures(org_id,procurement_id,binding_id,request_id,payload,kind,stage,captured_by,captured_at)
  values ('22590000-0000-0000-0000-000000000001',('22590000-1000-0000-0000-'||lpad(p::text,12,'0'))::uuid,'22590000-0000-0000-0000-000000000003',
          ('22590000-3000-0000-0000-'||lpad(r::text,12,'0'))::uuid,'{"source_ids":[]}'::jsonb,k,'invoiced','22590000-0000-0000-0000-000000000002',at) $$;
select pg_temp.cap(1,12,'journal','2026-02-01'), pg_temp.cap(1,11,'supplier_invoice','2026-01-01');
select pg_temp.cap(2,22,'supplier_invoice','2026-02-01'), pg_temp.cap(2,21,'journal','2026-01-01');
select pg_temp.cap(3,32,'journal','2026-01-01'), pg_temp.cap(3,31,'supplier_invoice','2026-01-01');
select pg_temp.cap(4,41,'supplier_invoice','2026-01-01');
select pg_temp.cap(5,51,'journal','2026-01-01');
set local role authenticated;
set local request.jwt.claims='{"role":"authenticated","sub":"22590000-0000-0000-0000-000000000002"}';
select throws_ok($q$select public.undo_captured_purchase('22590000-1000-0000-0000-000000000001','reviewed',true)$q$,'55000','has_later_pmo_steps',
  'AC-ROP-009 two captures: the earlier supplier invoice decides, though the journal row was stored first');
select is(public.undo_captured_purchase('22590000-1000-0000-0000-000000000002','reviewed',true)->>'outcome','undo',
  'AC-ROP-009 two captures: the earlier journal decides, though the supplier row was stored first');
select throws_ok($q$select public.undo_captured_purchase('22590000-1000-0000-0000-000000000003','reviewed',true)$q$,'55000','has_later_pmo_steps',
  'AC-ROP-009 two captures at one instant: the smaller request_id decides');
select throws_ok($q$select public.undo_captured_purchase('22590000-1000-0000-0000-000000000004','reviewed',true)$q$,'55000','has_later_pmo_steps',
  'AC-ROP-009 one supplier capture is unchanged');
select is(public.undo_captured_purchase('22590000-1000-0000-0000-000000000005','reviewed',true)->>'outcome','undo',
  'AC-ROP-009 one journal capture is unchanged');
select is(public.undo_captured_purchase('22590000-1000-0000-0000-000000000002','reviewed',false)->>'outcome','undo','AC-ROP-009 the mixed purchase undoes by its first kind');
reset role;
select is((select count(*)::int from erp_purchase_captures where procurement_id='22590000-1000-0000-0000-000000000002' and undone_at is not null),2,
  'AC-ROP-009 undo marks every capture row of the purchase');
select * from finish();
rollback;

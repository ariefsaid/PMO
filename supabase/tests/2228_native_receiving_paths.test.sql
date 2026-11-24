begin;
create extension if not exists pgtap;
select * from no_plan();
create function pg_temp.nid(n int) returns uuid language sql immutable as $$select ('22280000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid$$;
insert into organizations(id,name,default_currency,default_timezone,built_in_roles_enabled) values(pg_temp.nid(1),'Native receipt test','IDR','UTC',true);
insert into auth.users(id,email) select pg_temp.nid(n),'native-receive-'||n||'@example.com' from generate_series(10,13)n;
insert into profiles(id,org_id,full_name,email,role,status,built_in_role) values
 (pg_temp.nid(10),pg_temp.nid(1),'Admin','native-receive-10@example.com','Admin','active',null),
 (pg_temp.nid(11),pg_temp.nid(1),'Foreman','native-receive-11@example.com','Engineer','active','foreman'),
 (pg_temp.nid(12),pg_temp.nid(1),'Field user','native-receive-12@example.com','Engineer','active','field_user'),
 (pg_temp.nid(13),pg_temp.nid(1),'Full keeper','native-receive-13@example.com','Engineer','active',null);
insert into projects(id,org_id,name,status) values(pg_temp.nid(20),pg_temp.nid(1),'Native site','Ongoing Project');
insert into work_orders(id,org_id,project_id,title,status,order_value,tax_treatment,tax_amount)
 values(pg_temp.nid(21),pg_temp.nid(1),pg_temp.nid(20),'Native work','Issued',1000,'exclusive',0);
insert into stock_units(id,org_id,code,name) values(pg_temp.nid(30),pg_temp.nid(1),'pc','Piece');
insert into stock_tags(id,org_id,name,zero_cost) values(pg_temp.nid(31),pg_temp.nid(1),'Client supplied',true);
insert into stock_items(id,org_id,code,name,unit_id,tag_id) values
 (pg_temp.nid(40),pg_temp.nid(1),'OWN','Purchased goods',pg_temp.nid(30),null),
 (pg_temp.nid(41),pg_temp.nid(1),'CLIENT','Client goods',pg_temp.nid(30),pg_temp.nid(31));
insert into stock_warehouses(id,org_id,code,name,kind,project_id) values
 (pg_temp.nid(50),pg_temp.nid(1),'SITE','Site warehouse','site',pg_temp.nid(20)),
 (pg_temp.nid(51),pg_temp.nid(1),'DEST','Destination warehouse','site',pg_temp.nid(20));
insert into stock_warehouse_keepers(org_id,warehouse_id,user_id)
 values(pg_temp.nid(1),pg_temp.nid(50),pg_temp.nid(13));
create function pg_temp.actor(n int) returns void language sql as $$select set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.nid(n),'role','authenticated')::text,true)$$;
create function pg_temp.make_receipt(post boolean,item int default 40,cost numeric default 10) returns uuid language sql as $$
 select create_stock_document(jsonb_build_object('kind','receive','warehouse_id',pg_temp.nid(50)),
  jsonb_build_array(jsonb_build_object('item_id',pg_temp.nid(item),'quantity',1,'unit_cost',cost)),post,null)
$$;
create function pg_temp.make_transfer(post boolean) returns uuid language sql as $$
 select create_stock_document(jsonb_build_object('kind','transfer','warehouse_id',pg_temp.nid(50),'to_warehouse_id',pg_temp.nid(51)),
  jsonb_build_array(jsonb_build_object('item_id',pg_temp.nid(40),'quantity',1)),post,null)
$$;
create function pg_temp.err(n int,stmt text) returns text language plpgsql as $$
begin
 perform pg_temp.actor(n); execute 'set local role authenticated'; execute stmt; execute 'reset role'; return 'ok';
exception when others then execute 'reset role'; return sqlstate||':'||split_part(sqlerrm,':',1);
end $$;
select is(pg_temp.err(10,'select set_stock_warehouse_keeper(pg_temp.nid(50),pg_temp.nid(11),true)'),'ok','AC-NRP-001 Admin assigns the Foreman as a keeper');
select is(pg_temp.err(10,'select set_stock_warehouse_keeper(pg_temp.nid(50),pg_temp.nid(12),true)'),'ok','AC-NRP-001 Admin assigns the Field user as a keeper');
select pg_temp.actor(13);
set local role authenticated;
select create_stock_document(jsonb_build_object('kind','receive','warehouse_id',pg_temp.nid(50)),
 jsonb_build_array(jsonb_build_object('item_id',pg_temp.nid(40),'quantity',20,'unit_cost',10)),true,null);
select set_config('nrp.draft',pg_temp.make_receipt(false)::text,true);
select set_config('nrp.req',csr_create(jsonb_build_object('work_order_id',pg_temp.nid(21)),
 jsonb_build_array(jsonb_build_object('stock_item_id',pg_temp.nid(41),'takeoff_quantity',10,'requested_quantity',10)))::text,true);
select csr_send(current_setting('nrp.req')::uuid);
reset role;
select set_config('nrp.line',(select id::text from client_requisition_lines where requisition_id=current_setting('nrp.req')::uuid),true);
select pg_temp.actor(10);
set local role authenticated;
select csr_record_reservation(current_setting('nrp.line')::uuid,8,'Reservation');
reset role;

-- Mode off retains the full-account-only stock creator for every movement and both creation modes.
select is(get_order_receiving_enabled(),false,'AC-NRP-001 order receiving starts off');
select is(pg_temp.err(n,format('select pg_temp.make_%s(%L)',kind,post)), '42501:LIGHT_ACCOUNT',
 format('AC-NRP-001 field keeper %s cannot create %s with post=%s',n,kind,post))
 from unnest(array[11,12]) n cross join unnest(array['receipt','transfer']) kind cross join unnest(array[false,true]) post;

select pg_temp.actor(10);
set local role authenticated;
select set_order_receiving_enabled(true);
reset role;
select is(pg_temp.err(13,$q$select set_config('nrp.pickup',csr_record_pickup(current_setting('nrp.line')::uuid,3,pg_temp.nid(50),current_date,null,'Paper',pg_temp.nid(80))::text,true)$q$),'ok',
 'AC-NRP-002 reserved client goods are collected while order receiving is enabled');
select is((select qty_on_hand from stock_balances where item_id=pg_temp.nid(41) and warehouse_id=pg_temp.nid(50)),3::numeric,'AC-NRP-002 collected client quantity enters stock');
select is((select value_on_hand from stock_balances where item_id=pg_temp.nid(41) and warehouse_id=pg_temp.nid(50)),0::numeric,'AC-NRP-002 client stock keeps zero value');
select is((select count(*)::int from client_requisition_pickups where line_id=current_setting('nrp.line')::uuid),1,'AC-NRP-002 one pickup witness is recorded');
select is((select reserved::text||'/'||collected::text||'/'||(reserved-collected)::text from csr_line_figures(current_setting('nrp.line')::uuid)),
 '8.000/3.000/5.000','AC-NRP-002 reservation, collected and remaining quantities agree');
select is((select d.kind||'/'||d.status||'/'||(d.work_order_id=pg_temp.nid(21))::text||'/'||(d.procurement_id is null)::text
 from client_requisition_pickups p join stock_documents d on d.id=p.stock_document_id where p.line_id=current_setting('nrp.line')::uuid),
 'receive/Posted/true/true','AC-NRP-002 the posted movement names the work order without a purchase');
select is((select sum(l.value_delta) from stock_ledger l join client_requisition_pickups p on p.stock_document_id=l.document_id where p.line_id=current_setting('nrp.line')::uuid),0::numeric,
 'AC-NRP-002 the collection ledger carries zero value');
select is(pg_temp.err(13,$q$select csr_record_pickup(current_setting('nrp.line')::uuid,3,pg_temp.nid(50),current_date,null,'Paper',pg_temp.nid(80))$q$),'ok','AC-NRP-002 pickup retry retains its witness');
select is((select count(*)::int from client_requisition_pickups where line_id=current_setting('nrp.line')::uuid),1,'AC-NRP-002 retry adds no second collection');
select is(pg_temp.err(13,'select pg_temp.make_receipt(true,40,99)'), '23514:RGO_USE_ORDER','AC-NRP-003 purchased goods retain the order-cost path');
select is(pg_temp.err(13,'select pg_temp.make_receipt(false,41,0)'), '23514:RGO_USE_ORDER','AC-NRP-003 the generic creator requires an order even for a caller-selected zero cost');
select is(pg_temp.err(13,$q$select post_stock_document(current_setting('nrp.draft')::uuid)$q$),'23514:RGO_USE_ORDER','AC-NRP-003 an earlier purchased-goods draft still requires its order');
select is(has_table_privilege('authenticated','public.client_requisition_pickups','INSERT'),false,'AC-NRP-003 pickup witnesses are not client-writable');
create function pg_temp.probe(stmt text) returns boolean language plpgsql as $$
declare result boolean;
begin
 begin execute stmt into result; raise exception using errcode='Z0001';
 exception when sqlstate 'Z0001' then null; end;
 return result;
end $$;
create function pg_temp.kill(change_sql text,oracle_sql text) returns boolean language plpgsql as $$
declare changed boolean;
begin
 if pg_temp.probe(oracle_sql) is not true then raise exception 'Mutation baseline failed: %',oracle_sql; end if;
 begin execute change_sql; changed:=pg_temp.probe(oracle_sql); raise exception using errcode='Z0001';
 exception when sqlstate 'Z0001' then null; end;
 return changed is false;
end $$;
create function pg_temp.mutation(sig text,old_text text,new_text text,oracle_sql text) returns boolean language plpgsql as $$
declare original text; changed text;
begin
 select pg_get_functiondef(sig::regprocedure) into original; changed:=replace(original,old_text,new_text);
 if changed=original then raise exception 'Mutation target absent: %',sig; end if;
 return pg_temp.kill(changed,oracle_sql);
end $$;
select is(pg_temp.err(10,'select set_order_receiving_enabled(false)'),'ok','AC-NRP-001 field keeper checks also cover the disabled mode');
select ok(pg_temp.mutation('public.create_stock_document(jsonb,jsonb,boolean,uuid)',
 '  perform public.assert_not_light();','',
 format('select pg_temp.err(%s,%L)=%L',n,format('select pg_temp.make_%s(%L)',kind,post),'42501:LIGHT_ACCOUNT')),
 format('AC-NRP-001 mutation: field keeper %s refusal binds %s post=%s',n,kind,post))
 from unnest(array[11,12]) n cross join unnest(array['receipt','transfer']) kind cross join unnest(array[false,true]) post;
select is(pg_temp.err(10,'select set_order_receiving_enabled(true)'),'ok','AC-NRP-002 pickup coexistence checks use enabled order receiving');
create function pg_temp.pickup_ok() returns boolean language plpgsql as $$
declare before_collected numeric; before_stock numeric; result boolean;
begin
 select collected into before_collected from public.csr_line_figures(current_setting('nrp.line')::uuid);
 select qty_on_hand into before_stock from public.stock_balances where item_id=pg_temp.nid(41) and warehouse_id=pg_temp.nid(50);
 if pg_temp.err(13,$q$select csr_record_pickup(current_setting('nrp.line')::uuid,1,pg_temp.nid(50),current_date,null,'Paper',pg_temp.nid(81))$q$)<>'ok' then return false; end if;
 select count(*)=1 and bool_and(d.status='Posted' and d.work_order_id=pg_temp.nid(21) and l.quantity=1 and l.unit_cost=0 and p.quantity=1)
 into result from public.client_requisition_pickups p join public.stock_documents d on d.id=p.stock_document_id
 join public.stock_document_lines l on l.document_id=d.id where p.client_request_id=pg_temp.nid(81);
 return result and (select collected=before_collected+1 and reserved=8 from public.csr_line_figures(current_setting('nrp.line')::uuid))
   and (select qty_on_hand=before_stock+1 and value_on_hand=0 from public.stock_balances where item_id=pg_temp.nid(41) and warehouse_id=pg_temp.nid(50));
end $$;
select ok(pg_temp.mutation('public.stock_apply_receive(stock_documents,boolean)',
 'p.stock_document_id = p_doc.id','false and p.stock_document_id = p_doc.id',
 $$select pg_temp.pickup_ok()$$),'AC-NRP-002 mutation: the pickup stock/witness oracle requires its trusted posting path');
select ok(pg_temp.mutation('public.csr_record_pickup(uuid,numeric,uuid,date,text,text,uuid)',
 $q$'unit_cost', 0$q$,$q$'unit_cost', 1$q$,
 $$select pg_temp.pickup_ok()$$),'AC-NRP-002 mutation: the pickup oracle requires the server-owned zero cost');
select ok(pg_temp.mutation('public.stock_apply_receive(stock_documents,boolean)',
 'if exists(select 1 from public.order_receiving_settings','if false and exists(select 1 from public.order_receiving_settings',
 $$select pg_temp.err(13,$q$select post_stock_document(current_setting('nrp.draft')::uuid)$q$)='23514:RGO_USE_ORDER'$$),
 'AC-NRP-003 mutation: the purchase-cost oracle still requires order provenance');
select * from finish();
rollback;

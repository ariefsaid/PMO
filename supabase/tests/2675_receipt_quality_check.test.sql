begin;
create extension if not exists pgtap;
select * from no_plan();
-- D4: receiving an item flagged for a quality check. Only the passed part enters stock; the rejected part stays on the receipt.
create function pg_temp.q(n int) returns uuid language sql immutable as $$select ('26750000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid$$;
insert into organizations(id,name,default_currency,default_timezone,built_in_roles_enabled) values
 (pg_temp.q(1),'Quality receipt test','IDR','UTC',true),(pg_temp.q(2),'Quality receipt other','IDR','UTC',true);
insert into auth.users(id,email) select pg_temp.q(n),'quality-receipt-'||n||'@example.com' from generate_series(10,14)n;
insert into profiles(id,org_id,full_name,email,role,status,built_in_role) values
 (pg_temp.q(10),pg_temp.q(1),'Admin','quality-receipt-10@example.com','Admin','active',null),
 (pg_temp.q(11),pg_temp.q(1),'Storekeeper','quality-receipt-11@example.com','Engineer','active','storekeeper'),
 (pg_temp.q(12),pg_temp.q(1),'Second purchaser','quality-receipt-12@example.com','Finance','active',null),
 (pg_temp.q(14),pg_temp.q(2),'Other keeper','quality-receipt-14@example.com','Admin','active',null);
insert into stock_units(id,org_id,code,name) values(pg_temp.q(30),pg_temp.q(1),'pc','Piece'),(pg_temp.q(31),pg_temp.q(2),'pc','Piece');
insert into stock_tags(id,org_id,name,zero_cost) values(pg_temp.q(32),pg_temp.q(1),'Client supplied',true);
insert into stock_items(id,org_id,code,name,unit_id,tag_id,needs_quality_check) values
 (pg_temp.q(40),pg_temp.q(1),'PLAIN','Unflagged goods',pg_temp.q(30),null,false),
 (pg_temp.q(41),pg_temp.q(1),'FLAG','Flagged goods',pg_temp.q(30),null,true),
 (pg_temp.q(42),pg_temp.q(1),'CLIENT','Flagged client goods',pg_temp.q(30),pg_temp.q(32),true),
 (pg_temp.q(43),pg_temp.q(2),'OTHER','Other organisation goods',pg_temp.q(31),null,true),
 (pg_temp.q(44),pg_temp.q(1),'NOTE','Goods for the note rules',pg_temp.q(30),null,false);
insert into stock_warehouses(id,org_id,code,name,kind) values
 (pg_temp.q(50),pg_temp.q(1),'WH','Warehouse','central'),(pg_temp.q(51),pg_temp.q(2),'WH2','Other warehouse','central');
insert into stock_warehouse_keepers(org_id,warehouse_id,user_id) values
 (pg_temp.q(1),pg_temp.q(50),pg_temp.q(11)),(pg_temp.q(2),pg_temp.q(51),pg_temp.q(14));
create function pg_temp.actor(n int) returns void language sql as $$select set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.q(n),'role','authenticated')::text,true)$$;
create function pg_temp.err(n int,stmt text) returns text language plpgsql as $$
begin
 perform pg_temp.actor(n); execute 'set local role authenticated'; execute stmt; execute 'reset role'; return 'ok';
exception when others then execute 'reset role'; return sqlstate||':'||split_part(sqlerrm,':',1);
end $$;
-- one receipt line: item, received quantity, and the check (null rejected = no check on the line)
create function pg_temp.receipt(item int,qty numeric,rej numeric,note text default null,wh int default 50) returns uuid language sql as $$
 select create_stock_document(jsonb_build_object('kind','receive','warehouse_id',pg_temp.q(wh)),
  jsonb_build_array(jsonb_build_object('item_id',pg_temp.q(item),'quantity',qty,'unit_cost',5)
    || case when rej is null then '{}'::jsonb else jsonb_build_object('rejected',rej,'reject_note',note) end),true,null)
$$;
create function pg_temp.on_hand(item int) returns numeric language sql as $$select coalesce((select qty_on_hand from stock_balances where item_id=pg_temp.q(item) and warehouse_id=pg_temp.q(50)),0)$$;

-- A. the Receive stock form (create_stock_document) -------------------------------------------------------
select is(pg_temp.err(11,$$select pg_temp.receipt(41,10,null)$$),'P0001:STK_QUALITY_RECEIPT','D4 a flagged item with no check is refused');
select is(pg_temp.on_hand(41),0::numeric,'D4 the refused receipt put nothing on hand');
select is(pg_temp.err(11,$$select pg_temp.receipt(41,10,11,'too many')$$),'P0001:STK_QUALITY_FIGURES','D4 rejecting more than was received is refused');
select is(pg_temp.err(11,$$select pg_temp.receipt(41,10,2,null)$$),'P0001:STK_QUALITY_FIGURES','D4 a rejection with no note is refused');
select is(pg_temp.err(11,$$select pg_temp.receipt(41,10,2,repeat('x',501))$$),'P0001:STK_QUALITY_FIGURES','D4 a rejection note of 501 characters is refused');
select is(pg_temp.err(11,$$select pg_temp.receipt(44,3,1,repeat('x',500))$$),'ok','D4 a rejection note of 500 characters is accepted');
-- shipped rule: a note given with nothing rejected is accepted and not kept (the note belongs to a rejection)
select is(pg_temp.err(11,$$select pg_temp.receipt(44,2,0,'nothing was rejected')$$),'ok','D4 a note given with nothing rejected is accepted');
select is((select count(*)::int from stock_document_lines where item_id=pg_temp.q(44) and qty_rejected=0 and reject_note is not null),0,'D4 a note given with nothing rejected is not stored');
select pg_temp.actor(11);
set local role authenticated;
select set_config('q.doc',pg_temp.receipt(41,10,2,'cracked')::text,true);
reset role;
select is(pg_temp.on_hand(41),8::numeric,'D4 with a check only the passed part (10 received, 2 rejected) is on hand');
select is((select value_on_hand from stock_balances where item_id=pg_temp.q(41) and warehouse_id=pg_temp.q(50)),40::numeric,'D4 the stock value is the passed part at cost');
select is((select quantity from stock_document_lines where document_id=current_setting('q.doc')::uuid),10::numeric,'D4 the receipt line keeps the received quantity');
select is((select qty_rejected||'/'||reject_note from stock_document_lines where document_id=current_setting('q.doc')::uuid),'2.000/cracked','D4 the receipt records the rejected quantity and the note');
select is((select sum(qty_delta) from stock_ledger where document_id=current_setting('q.doc')::uuid),8::numeric,'D4 the ledger holds the passed quantity only');
select is(pg_temp.err(11,$$select pg_temp.receipt(41,4,0)$$),'ok','D4 all passed (0 rejected) is a valid check');
select is(pg_temp.on_hand(41),12::numeric,'D4 all passed enters stock in full');
select is(pg_temp.err(11,$$select pg_temp.receipt(41,3,3,'all damaged')$$),'ok','D4 all rejected is recorded');
select is(pg_temp.on_hand(41),12::numeric,'D4 all rejected adds nothing to stock');
-- unflagged item: exactly as today
select is(pg_temp.err(11,$$select pg_temp.receipt(40,20,null)$$),'ok','D4 an unflagged item needs no check');
select is(pg_temp.on_hand(40),20::numeric,'D4 an unflagged item enters stock in full');
select is((select qty_rejected from stock_document_lines l join stock_documents d on d.id=l.document_id where l.item_id=pg_temp.q(40) and d.kind='receive' limit 1),null::numeric,'D4 an unflagged line carries no check');
-- only a receipt carries a check
select is(pg_temp.err(11,$$select create_stock_document(jsonb_build_object('kind','transfer','warehouse_id',pg_temp.q(50),'to_warehouse_id',pg_temp.q(50)),jsonb_build_array(jsonb_build_object('item_id',pg_temp.q(40),'quantity',1,'rejected',0)),false,null)$$),'P0001:STK_INVALID','D4 a transfer line cannot carry a receipt check');
-- another organisation cannot receive into this one
select is(pg_temp.err(14,$$select pg_temp.receipt(41,5,0,null,50)$$),'P0001:STK_NOT_FOUND','D4 another organisation cannot receive into this warehouse');
select is(pg_temp.err(14,$$select pg_temp.receipt(41,5,0,null,51)$$),'P0001:STK_NOT_FOUND','D4 another organisation cannot receive this organisation item');
select is((select count(*)::int from stock_document_lines where item_id=pg_temp.q(43)),0,'D4 nothing was received for the other organisation');

-- B. order receiving -------------------------------------------------------------------------------------------
select set_config('request.jwt.claims','{}',true);   -- the fixture is written by the system, not by a person
insert into procurements(id,org_id,title,status,currency,requested_by_id,total_value,approved_total_value,approved_by_id) values
 (pg_temp.q(20),pg_temp.q(1),'Goods','Ordered','IDR',pg_temp.q(11),100,100,pg_temp.q(10));
insert into procurement_items(id,org_id,procurement_id,name,quantity,rate) values
 (pg_temp.q(60),pg_temp.q(1),pg_temp.q(20),'Flagged line',20,5),(pg_temp.q(61),pg_temp.q(1),pg_temp.q(20),'Plain line',20,5);
insert into purchase_orders(id,org_id,procurement_id,po_number,status,currency) values(pg_temp.q(70),pg_temp.q(1),pg_temp.q(20),'PO-Q','Issued','IDR');
select pg_temp.actor(10);
set local role authenticated;
select set_order_receiving_enabled(true);
select map_order_stock(pg_temp.q(60),pg_temp.q(41));
select map_order_stock(pg_temp.q(61),pg_temp.q(40));
reset role;
create function pg_temp.rgo(lines jsonb,k int) returns jsonb language sql as $$select receive_order_goods(pg_temp.q(70),pg_temp.q(50),current_date,lines,pg_temp.q(80+k))$$;
select pg_temp.actor(11);
set local role authenticated;
select is((select (l->>'needs_quality_check')::boolean from jsonb_array_elements(read_order_receiving(pg_temp.q(70))->'lines') l where l->>'id'=pg_temp.q(60)::text),true,'D4 the receiving read says a flagged line needs a check');
select is((select (l->>'needs_quality_check')::boolean from jsonb_array_elements(read_order_receiving(pg_temp.q(70))->'lines') l where l->>'id'=pg_temp.q(61)::text),false,'D4 the receiving read says an unflagged line needs none');
reset role;
select is(pg_temp.err(11,$$select pg_temp.rgo(jsonb_build_array(jsonb_build_object('item_id',pg_temp.q(60),'quantity',6)),1)$$),'P0001:STK_QUALITY_RECEIPT','D4 order receiving refuses a flagged line with no check');
select is(pg_temp.err(11,$$select pg_temp.rgo(jsonb_build_array(jsonb_build_object('item_id',pg_temp.q(60),'quantity',6,'rejected',1,'reject_note','wet')),2)$$),'ok','D4 order receiving accepts the check');
select is(pg_temp.on_hand(41),17::numeric,'D4 order receiving puts only the passed part (6 counted, 1 rejected) on hand');
select is((select sum(quantity) from procurement_receipt_lines where item_id=pg_temp.q(60)),5::numeric,'D4 only the passed part counts as received against the order');
select is((select qty_rejected from stock_document_lines l join order_receiving_requests r on r.stock_document_id=l.document_id where r.id=pg_temp.q(82)),1::numeric,'D4 the order receipt records what was rejected');
select is(pg_temp.err(11,$$select pg_temp.rgo(jsonb_build_array(jsonb_build_object('item_id',pg_temp.q(61),'quantity',3)),3)$$),'ok','D4 an unflagged order line needs no check');
select is(pg_temp.on_hand(40),23::numeric,'D4 an unflagged order line enters stock in full');
select is(pg_temp.err(12,$$select reverse_order_receiving(pg_temp.q(82),'Wrong count')$$),'ok','D4 a flagged receipt can be reversed');
select is(pg_temp.on_hand(41),12::numeric,'D4 the reversal takes back only the passed part');

-- C. client-material pickup: no check screen there, so a flagged item is refused with a stable code -----------------
insert into projects(id,org_id,name,status) values(pg_temp.q(21),pg_temp.q(1),'Site','Ongoing Project');
insert into work_orders(id,org_id,project_id,title,status,order_value,tax_treatment,tax_amount) values(pg_temp.q(22),pg_temp.q(1),pg_temp.q(21),'Work','Issued',1000,'exclusive',0);
insert into stock_warehouses(id,org_id,code,name,kind,project_id) values(pg_temp.q(52),pg_temp.q(1),'SITE','Site warehouse','site',pg_temp.q(21));
insert into stock_warehouse_keepers(org_id,warehouse_id,user_id) values(pg_temp.q(1),pg_temp.q(52),pg_temp.q(11));
select pg_temp.actor(10);
set local role authenticated;
select set_config('q.req',csr_create(jsonb_build_object('work_order_id',pg_temp.q(22)),
 jsonb_build_array(jsonb_build_object('stock_item_id',pg_temp.q(42),'takeoff_quantity',10,'requested_quantity',10)))::text,true);
select csr_send(current_setting('q.req')::uuid);
reset role;
select set_config('q.line',(select id::text from client_requisition_lines where requisition_id=current_setting('q.req')::uuid),true);
select pg_temp.actor(10);
set local role authenticated;
select csr_record_reservation(current_setting('q.line')::uuid,8,'Reservation');
reset role;
select is(pg_temp.err(11,$$select csr_record_pickup(current_setting('q.line')::uuid,3,pg_temp.q(52),current_date,null,'Paper',pg_temp.q(90))$$),'P0001:STK_QUALITY_RECEIPT','D4 a client-material pickup of a flagged item is refused');
select is((select count(*)::int from stock_ledger where item_id=pg_temp.q(42)),0,'D4 the refused pickup wrote nothing to the ledger');
select is((select count(*)::int from client_requisition_pickups where line_id=current_setting('q.line')::uuid),0,'D4 the refused pickup left no witness');
select * from finish();
rollback;

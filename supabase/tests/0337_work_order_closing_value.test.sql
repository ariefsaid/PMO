begin;
create extension if not exists pgtap;
select plan(29);
insert into organizations(id,name) values ('33530000-0000-0000-0000-000000000001','CQ Org');
insert into auth.users(id,email) values ('33530000-0000-0000-0000-000000000011','cq-finance@example.invalid');
insert into profiles(id,org_id,full_name,email,role,status) values ('33530000-0000-0000-0000-000000000011','33530000-0000-0000-0000-000000000001','CQ Finance','cq-finance@example.invalid','Finance','active');
insert into projects(id,org_id,name,status,contract_value,tax_treatment,tax_amount) values ('33530000-0000-0000-0000-000000000021','33530000-0000-0000-0000-000000000001','CQ Project','Ongoing Project',10000,'exclusive',0);
insert into work_orders(id,org_id,project_id,title,status,order_value,tax_treatment,tax_amount) values ('33530000-0000-0000-0000-000000000031','33530000-0000-0000-0000-000000000001','33530000-0000-0000-0000-000000000021','CQ WO','Issued',10000,'exclusive',0);

-- Extended fixtures (AC-CQ-006/007): PM, a managed project with a rate-10 line, three issued orders.
insert into auth.users(id,email) values ('33530000-0000-0000-0000-000000000012','cq-pm@example.invalid');
insert into profiles(id,org_id,full_name,email,role,status) values ('33530000-0000-0000-0000-000000000012','33530000-0000-0000-0000-000000000001','CQ PM','cq-pm@example.invalid','Project Manager','active');
insert into projects(id,org_id,name,status,contract_value,tax_treatment,tax_amount,project_manager_id,currency) values
 ('33530000-0000-0000-0000-000000000022','33530000-0000-0000-0000-000000000001','CQ Managed','Ongoing Project',1000000,'exclusive',0,'33530000-0000-0000-0000-000000000012','USD');
insert into boq_items(id,org_id,project_id,item_code,description,unit,quantity,rate) values
 ('33530000-0000-0000-0000-000000000042','33530000-0000-0000-0000-000000000001','33530000-0000-0000-0000-000000000022','L','Rate ten line','m',5000,10);
insert into work_orders(id,org_id,project_id,title,status,order_value,tax_treatment,tax_amount) values
 ('33530000-0000-0000-0000-000000000032','33530000-0000-0000-0000-000000000001','33530000-0000-0000-0000-000000000022','Boundary WO','Issued',10000,'exclusive',0),
 ('33530000-0000-0000-0000-000000000033','33530000-0000-0000-0000-000000000001','33530000-0000-0000-0000-000000000022','Billed WO','Issued',10000,'exclusive',0),
 ('33530000-0000-0000-0000-000000000034','33530000-0000-0000-0000-000000000001','33530000-0000-0000-0000-000000000022','Open WO','Issued',10000,'exclusive',0);
insert into work_order_lines(org_id,work_order_id,boq_item_id,quantity) values
 ('33530000-0000-0000-0000-000000000001','33530000-0000-0000-0000-000000000032','33530000-0000-0000-0000-000000000042',1001),('33530000-0000-0000-0000-000000000001','33530000-0000-0000-0000-000000000033','33530000-0000-0000-0000-000000000042',1001),('33530000-0000-0000-0000-000000000001','33530000-0000-0000-0000-000000000034','33530000-0000-0000-0000-000000000042',1001);
insert into project_documents(id,org_id,project_id,category,title,status,file_path) values
 ('33530000-0000-0000-0000-000000000051','33530000-0000-0000-0000-000000000001','33530000-0000-0000-0000-000000000022','Acceptance','BAST evidence','Issued','bast.pdf');
create function public.cq_t_probe(p_wo uuid, p_acc uuid, p_forge boolean) returns void language plpgsql security definer set search_path=public as $f$
begin
  if p_forge then perform set_config('pmo.confirming_work_order_acceptance','on',true); end if;
  update work_orders set closing_value=1,closing_acceptance_id=p_acc,status='Closed' where id=p_wo;
end $f$;
select ok(exists(select 1 from information_schema.columns where table_schema='public' and table_name='work_orders' and column_name='closing_value'),'AC-CQ-006 closing value is a first-class net money field');
select ok(exists(select 1 from information_schema.columns where table_schema='public' and table_name='work_orders' and column_name='closing_acceptance_id'),'AC-CQ-006 closing value retains its acceptance identity');
select throws_ok($$update work_orders set closing_value=1,closing_acceptance_id='33530000-0000-0000-0000-000000000041' where id='33530000-0000-0000-0000-000000000031'$$,'42501','closing value may only be written by final acceptance confirmation','AC-CQ-006 only final confirmation can stamp closing money');
select ok(exists(select 1 from pg_constraint where conrelid='public.work_orders'::regclass and conname='work_orders_closing_pair'),'AC-CQ-006 closing value and acceptance form a required pair');
select is((select closing_value from work_orders where id='33530000-0000-0000-0000-000000000031'),null::numeric,'AC-CQ-006 failed writes leave original closing state absent');
set local role authenticated;
set local request.jwt.claims='{"sub":"33530000-0000-0000-0000-000000000012","role":"authenticated"}';
select lives_ok($$select set_config('cq.over',public.prepare_work_order_acceptance('33530000-0000-0000-0000-000000000032',current_date,true,'[{"boq_item_id":"33530000-0000-0000-0000-000000000042","quantity":1000.001}]'::jsonb,'33530000-0000-0000-0000-000000000051')::text,true)$$,'AC-CQ-007 PM prepares over at quantity 1000.001');
select lives_ok($$select set_config('cq.open',public.prepare_work_order_acceptance('33530000-0000-0000-0000-000000000034',current_date,false,'[{"boq_item_id":"33530000-0000-0000-0000-000000000042","quantity":100}]'::jsonb,'33530000-0000-0000-0000-000000000051')::text,true)$$,'AC-CQ-007 PM prepares open at quantity 100');
set local request.jwt.claims='{"sub":"33530000-0000-0000-0000-000000000011","role":"authenticated"}';
select throws_ok($$select public.confirm_work_order_acceptance(current_setting('cq.over')::uuid)$$,'BW001',null,'AC-CQ-007 one cent over the order net is refused');
select throws_like($$select public.confirm_work_order_acceptance(current_setting('cq.over')::uuid)$$,'closing value 10000.01 exceeds work-order net 10000.00','AC-CQ-007 the refusal names both the closing value and the net');
select is((select status::text from work_orders where id='33530000-0000-0000-0000-000000000032'),'Issued','AC-CQ-007 refused over-net close leaves the order Issued');
select is((select status from work_order_acceptances where id=current_setting('cq.over')::uuid),'Draft','AC-CQ-007 refused confirmation leaves the BAST a Draft');
set local request.jwt.claims='{"sub":"33530000-0000-0000-0000-000000000012","role":"authenticated"}';
select lives_ok($$select set_config('cq.exact',public.prepare_work_order_acceptance('33530000-0000-0000-0000-000000000032',current_date,true,'[{"boq_item_id":"33530000-0000-0000-0000-000000000042","quantity":1000}]'::jsonb,'33530000-0000-0000-0000-000000000051')::text,true)$$,'AC-CQ-007 PM prepares exactly the order net');
set local request.jwt.claims='{"sub":"33530000-0000-0000-0000-000000000011","role":"authenticated"}';
select lives_ok($$select public.confirm_work_order_acceptance(current_setting('cq.exact')::uuid)$$,'AC-CQ-007 a closing value exactly equal to the order net is accepted');
select is((select closing_value from work_orders where id='33530000-0000-0000-0000-000000000032'),10000.00::numeric,'AC-CQ-006 exact-net close stores 10000.00');
reset role;
insert into sales_invoices(id,org_id,project_id,work_order_id,amount,tax_treatment,tax_amount,currency,status) values ('33530000-0000-0000-0000-000000000061','33530000-0000-0000-0000-000000000001','33530000-0000-0000-0000-000000000022','33530000-0000-0000-0000-000000000033',4500,'exclusive',0,'USD','Unpaid'),('33530000-0000-0000-0000-000000000062','33530000-0000-0000-0000-000000000001','33530000-0000-0000-0000-000000000022','33530000-0000-0000-0000-000000000033',5000,'exclusive',0,'USD','Draft');
set local role authenticated;
set local request.jwt.claims='{"sub":"33530000-0000-0000-0000-000000000012","role":"authenticated"}';
select lives_ok($$select set_config('cq.low',public.prepare_work_order_acceptance('33530000-0000-0000-0000-000000000033',current_date,true,'[{"boq_item_id":"33530000-0000-0000-0000-000000000042","quantity":900}]'::jsonb,'33530000-0000-0000-0000-000000000051')::text,true)$$,'AC-CQ-007 PM prepares low at quantity 900');
set local request.jwt.claims='{"sub":"33530000-0000-0000-0000-000000000011","role":"authenticated"}';
select throws_ok($$select public.confirm_work_order_acceptance(current_setting('cq.low')::uuid)$$,'BW001',null,'AC-CQ-007 a closing value below billed plus pending is refused');
select throws_like($$select public.confirm_work_order_acceptance(current_setting('cq.low')::uuid)$$,'closing value 9000.00 cannot close: billed and pending work exceeds%9500.00%','AC-CQ-007 the refusal names the closing value and what is already billed or pending');
select is((select status::text from work_orders where id='33530000-0000-0000-0000-000000000033'),'Issued','AC-CQ-007 refused lower-bound close leaves the order Issued');
set local request.jwt.claims='{"sub":"33530000-0000-0000-0000-000000000012","role":"authenticated"}';
select lives_ok($$select set_config('cq.edge',public.prepare_work_order_acceptance('33530000-0000-0000-0000-000000000033',current_date,true,'[{"boq_item_id":"33530000-0000-0000-0000-000000000042","quantity":950}]'::jsonb,'33530000-0000-0000-0000-000000000051')::text,true)$$,'AC-CQ-007 PM prepares exactly billed plus pending');
set local request.jwt.claims='{"sub":"33530000-0000-0000-0000-000000000011","role":"authenticated"}';
select lives_ok($$select public.confirm_work_order_acceptance(current_setting('cq.edge')::uuid)$$,'AC-CQ-007 a closing value exactly equal to billed plus pending is accepted');
select is((select closing_value from work_orders where id='33530000-0000-0000-0000-000000000033'),9500.00::numeric,'AC-CQ-006 billed-boundary close stores 9500.00');
select throws_ok($$update work_orders set closing_value=1,closing_acceptance_id=current_setting('cq.open')::uuid where id='33530000-0000-0000-0000-000000000034'$$,'42501',null,'AC-CQ-006 authenticated cannot set closing value by direct UPDATE');
select throws_ok($$update work_orders set closing_value=1 where id='33530000-0000-0000-0000-000000000032'$$,'42501',null,'AC-CQ-006 authenticated cannot change a closing value by direct UPDATE');
reset role;
set local role service_role;
select throws_ok($$update work_orders set closing_value=1,closing_acceptance_id=current_setting('cq.open')::uuid,status='Closed' where id='33530000-0000-0000-0000-000000000034'$$,'42501','closing value may only be written by final acceptance confirmation','AC-CQ-006 service role cannot stamp a closing value outside confirmation');
select throws_ok($$update work_orders set closing_value=9999 where id='33530000-0000-0000-0000-000000000032'$$,'42501','work-order closing value is immutable','AC-CQ-006 service role cannot rewrite a stamped closing value');
reset role;
select throws_ok($$select public.cq_t_probe('33530000-0000-0000-0000-000000000034',current_setting('cq.open')::uuid,false)$$,'42501','closing value may only be written by final acceptance confirmation','AC-CQ-006 another definer path cannot stamp closing money');
select throws_ok($$select public.cq_t_probe('33530000-0000-0000-0000-000000000034',current_setting('cq.open')::uuid,true)$$,'42501','closing value may only be written by final acceptance confirmation','AC-CQ-006 a definer path that forges the confirming flag still needs a confirmed final BAST');
select is((select closing_value from work_orders where id='33530000-0000-0000-0000-000000000034'),null::numeric,'AC-CQ-006 every refused write left the open order without a closing value');
select is((select closing_value from work_orders where id='33530000-0000-0000-0000-000000000032'),10000.00::numeric,'AC-CQ-006 refused rewrites left the stamped value intact');
select * from finish();
rollback;

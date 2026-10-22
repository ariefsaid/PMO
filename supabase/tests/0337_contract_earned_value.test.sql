begin;
create extension if not exists pgtap;
select plan(46);
insert into organizations(id,name) values ('33550000-0000-0000-0000-000000000001','CQ Org');
insert into auth.users(id,email) values ('33550000-0000-0000-0000-000000000011','cq-pm@example.invalid');
insert into profiles(id,org_id,full_name,email,role,status) values ('33550000-0000-0000-0000-000000000011','33550000-0000-0000-0000-000000000001','CQ PM','cq-pm@example.invalid','Project Manager','active');
insert into projects(id,org_id,name,status,contract_value,tax_treatment,tax_amount,project_manager_id,currency) values
 ('33550000-0000-0000-0000-000000000021','33550000-0000-0000-0000-000000000001','CQ Project','Ongoing Project',100000,'exclusive',0,'33550000-0000-0000-0000-000000000011','USD');
insert into boq_items(id,org_id,project_id,item_code,description,unit,quantity,rate) values
 ('33550000-0000-0000-0000-000000000041','33550000-0000-0000-0000-000000000001','33550000-0000-0000-0000-000000000021','LINE','Contract line','unit',10,1000);

-- Extended fixtures (AC-CQ-009/010): finance confirmer, generic / multi-WO / lump-sum projects.
create function public.cq_t_line(p uuid, i uuid) returns jsonb language sql stable as $f$
  select e from jsonb_array_elements(public.get_project_billing(p)->'boq') e where e->>'boq_item_id'=i::text $f$;
insert into auth.users(id,email) values ('33550000-0000-0000-0000-000000000012','cq-fin@example.invalid');
insert into profiles(id,org_id,full_name,email,role,status) values ('33550000-0000-0000-0000-000000000012','33550000-0000-0000-0000-000000000001','CQ Fin','cq-fin@example.invalid','Finance','active');
insert into projects(id,org_id,name,status,contract_value,tax_treatment,tax_amount,project_manager_id,currency) values
 ('33550000-0000-0000-0000-000000000022','33550000-0000-0000-0000-000000000001','CQ Generic','Ongoing Project',200000000,'exclusive',0,'33550000-0000-0000-0000-000000000011','USD'),
 ('33550000-0000-0000-0000-000000000023','33550000-0000-0000-0000-000000000001','CQ Multi WO','Ongoing Project',1000000,'exclusive',0,'33550000-0000-0000-0000-000000000011','USD'),
 ('33550000-0000-0000-0000-000000000024','33550000-0000-0000-0000-000000000001','CQ Lump','Ongoing Project',2000000,'exclusive',0,'33550000-0000-0000-0000-000000000011','USD');
insert into boq_items(id,org_id,project_id,item_code,description,unit,quantity,rate,earning_basis) values
 ('33550000-0000-0000-0000-000000000042','33550000-0000-0000-0000-000000000001','33550000-0000-0000-0000-000000000022','A1','Generic km','km',1900,50000,'unit_rate'),
 ('33550000-0000-0000-0000-000000000043','33550000-0000-0000-0000-000000000001','33550000-0000-0000-0000-000000000022','A2','Never assessed','m',5,100,'unit_rate'),
 ('33550000-0000-0000-0000-000000000044','33550000-0000-0000-0000-000000000001','33550000-0000-0000-0000-000000000023','B1','Shared line','m',100,10,'unit_rate'),
 ('33550000-0000-0000-0000-000000000045','33550000-0000-0000-0000-000000000001','33550000-0000-0000-0000-000000000024','C1','Lump sum','ls',1,1000000,'lump_sum');
insert into work_orders(id,org_id,project_id,title,status,order_value,tax_treatment,tax_amount) values
 ('33550000-0000-0000-0000-000000000031','33550000-0000-0000-0000-000000000001','33550000-0000-0000-0000-000000000022','WO1','Issued',50000000,'exclusive',0),
 ('33550000-0000-0000-0000-000000000032','33550000-0000-0000-0000-000000000001','33550000-0000-0000-0000-000000000023','WO2','Issued',100,'exclusive',0),
 ('33550000-0000-0000-0000-000000000033','33550000-0000-0000-0000-000000000001','33550000-0000-0000-0000-000000000023','WO3','Issued',200,'exclusive',0),
 ('33550000-0000-0000-0000-000000000034','33550000-0000-0000-0000-000000000001','33550000-0000-0000-0000-000000000023','WO4 to cancel','Issued',400,'exclusive',0),
 ('33550000-0000-0000-0000-000000000035','33550000-0000-0000-0000-000000000001','33550000-0000-0000-0000-000000000023','WO5 no lines','Issued',50,'exclusive',0);
insert into work_order_lines(org_id,work_order_id,boq_item_id,quantity) values
 ('33550000-0000-0000-0000-000000000001','33550000-0000-0000-0000-000000000031','33550000-0000-0000-0000-000000000042',1000),
 ('33550000-0000-0000-0000-000000000001','33550000-0000-0000-0000-000000000032','33550000-0000-0000-0000-000000000044',10),('33550000-0000-0000-0000-000000000001','33550000-0000-0000-0000-000000000033','33550000-0000-0000-0000-000000000044',20),('33550000-0000-0000-0000-000000000001','33550000-0000-0000-0000-000000000034','33550000-0000-0000-0000-000000000044',40);
insert into project_documents(id,org_id,project_id,category,title,status,file_path) values
 ('33550000-0000-0000-0000-000000000051','33550000-0000-0000-0000-000000000001','33550000-0000-0000-0000-000000000022','Acceptance','BAST evidence','Issued','33550000-0000-0000-0000-000000000001/33550000-0000-0000-0000-000000000022/33550000-0000-0000-0000-000000000051/bast.pdf');
set local role authenticated;
set local request.jwt.claims='{"sub":"33550000-0000-0000-0000-000000000011","role":"authenticated"}';
select is((public.get_project_billing('33550000-0000-0000-0000-000000000021')->>'earned_value')::numeric,0::numeric,'AC-CQ-009 no quantity assessment yields zero earned value');
select lives_ok($$select public.record_progress_assessment('33550000-0000-0000-0000-000000000021',date '2026-10-01','[{"boq_item_id":"33550000-0000-0000-0000-000000000041","quantity_to_date":4}]'::jsonb)$$,'AC-CQ-009 quantity progress records a weighted assessment');
select is((public.get_project_billing('33550000-0000-0000-0000-000000000021')->>'earned_value')::numeric,4000::numeric,'AC-CQ-009 earned value is SQL quantity times rate');
select is((public.get_project_billing('33550000-0000-0000-0000-000000000021')->'boq'->0->>'contract_balance'),'10.000','AC-CQ-009 contract balance is reported per line');
select throws_ok($$select public.record_progress_assessment('33550000-0000-0000-0000-000000000021',date '2026-11-01','[{"boq_item_id":"33550000-0000-0000-0000-000000000041","quantity_to_date":1.2345}]'::jsonb)$$,'23514',null,'AC-CQ-009 assessment precision remains capped at three decimals');
select is((public.cq_t_line('33550000-0000-0000-0000-000000000022','33550000-0000-0000-0000-000000000042')->>'earned_quantity')::numeric,0::numeric,'AC-CQ-009 Issued order without assessment earns nothing');
select is(public.cq_t_line('33550000-0000-0000-0000-000000000022','33550000-0000-0000-0000-000000000042')->>'assessed_quantity',null::text,'AC-CQ-009 a line without assessment reports NULL assessed quantity, not 0');
select lives_ok($$select public.record_progress_assessment('33550000-0000-0000-0000-000000000022',date '2026-01-01','[{"boq_item_id":"33550000-0000-0000-0000-000000000042","quantity_to_date":1000}]'::jsonb)$$,'AC-CQ-009 assessment of 1000 km recorded for 2026-01-01');
select is((public.cq_t_line('33550000-0000-0000-0000-000000000022','33550000-0000-0000-0000-000000000042')->>'earned_quantity')::numeric,1000::numeric,'AC-CQ-009 assessment of 1000 earns 1000 on a 1900 line');
select is((public.cq_t_line('33550000-0000-0000-0000-000000000022','33550000-0000-0000-0000-000000000042')->>'contract_balance')::numeric,900::numeric,'AC-CQ-009 balance is contract 1900 less issued allocation 1000');
select is((public.get_project_billing('33550000-0000-0000-0000-000000000022')->>'earned_value')::numeric,50000000::numeric,'AC-CQ-009 earned value = 1000 x 50,000');
set local request.jwt.claims='{"sub":"33550000-0000-0000-0000-000000000011","role":"authenticated"}';
select lives_ok($$select set_config('cq.stage',public.prepare_work_order_acceptance('33550000-0000-0000-0000-000000000031',current_date,false,'[{"boq_item_id":"33550000-0000-0000-0000-000000000042","quantity":600}]'::jsonb,'33550000-0000-0000-0000-000000000051')::text,true)$$,'AC-CQ-010 PM prepares the stage BAST of 600');
set local request.jwt.claims='{"sub":"33550000-0000-0000-0000-000000000012","role":"authenticated"}';
select lives_ok($$select public.confirm_work_order_acceptance(current_setting('cq.stage')::uuid)$$,'AC-CQ-010 Finance confirms the stage BAST');
-- Both confirmations share one transaction clock (now()); production confirms in separate transactions.
-- Back-date the stage BAST so "latest confirmed" is unambiguous, as it is in real use.
reset role;
alter table work_order_acceptances disable trigger work_order_acceptances_immutable;
update work_order_acceptances set confirmed_at=confirmed_at-interval '1 day' where id=current_setting('cq.stage')::uuid;
alter table work_order_acceptances enable trigger work_order_acceptances_immutable;
set local role authenticated;
set local request.jwt.claims='{"sub":"33550000-0000-0000-0000-000000000011","role":"authenticated"}';

select is((public.cq_t_line('33550000-0000-0000-0000-000000000022','33550000-0000-0000-0000-000000000042')->>'earned_quantity')::numeric,1000::numeric,'AC-CQ-010 a stage BAST does not change earned quantity');
select is((public.cq_t_line('33550000-0000-0000-0000-000000000022','33550000-0000-0000-0000-000000000042')->>'accepted_quantity')::numeric,600::numeric,'AC-CQ-010 stage BAST is reported as accepted quantity');
select is((public.cq_t_line('33550000-0000-0000-0000-000000000022','33550000-0000-0000-0000-000000000042')->>'closed_final')::numeric,0::numeric,'AC-CQ-010 nothing is closed-final after a stage BAST');
set local request.jwt.claims='{"sub":"33550000-0000-0000-0000-000000000011","role":"authenticated"}';
select lives_ok($$select set_config('cq.final',public.prepare_work_order_acceptance('33550000-0000-0000-0000-000000000031',current_date,true,'[{"boq_item_id":"33550000-0000-0000-0000-000000000042","quantity":997}]'::jsonb,'33550000-0000-0000-0000-000000000051')::text,true)$$,'AC-CQ-010 PM prepares the final BAST of 997');
set local request.jwt.claims='{"sub":"33550000-0000-0000-0000-000000000012","role":"authenticated"}';
select lives_ok($$select public.confirm_work_order_acceptance(current_setting('cq.final')::uuid)$$,'AC-CQ-010 Finance confirms the final BAST');
set local request.jwt.claims='{"sub":"33550000-0000-0000-0000-000000000011","role":"authenticated"}';

select is((select status::text from work_orders where id='33550000-0000-0000-0000-000000000031'),'Closed','AC-CQ-010 final BAST closes the order');
select is((public.cq_t_line('33550000-0000-0000-0000-000000000022','33550000-0000-0000-0000-000000000042')->>'earned_quantity')::numeric,997::numeric,'AC-CQ-010 closed order earns its accepted 997, not the assessed 1000');
select is((public.get_project_billing('33550000-0000-0000-0000-000000000022')->>'earned_value')::numeric,49850000::numeric,'AC-CQ-010 earned value = 997 x 50,000');
select is((public.cq_t_line('33550000-0000-0000-0000-000000000022','33550000-0000-0000-0000-000000000042')->>'contract_balance')::numeric,903::numeric,'AC-CQ-010 balance releases the unaccepted 3 km');
select is((public.cq_t_line('33550000-0000-0000-0000-000000000022','33550000-0000-0000-0000-000000000042')->>'closed_final')::numeric,997::numeric,'AC-CQ-010 closed_final reports the final accepted quantity');
select lives_ok($$select public.record_progress_assessment('33550000-0000-0000-0000-000000000022',date '2026-02-01','[{"boq_item_id":"33550000-0000-0000-0000-000000000042","quantity_to_date":1050}]'::jsonb)$$,'AC-CQ-009 assessment of 1050 km recorded for 2026-02-01');
select is((public.cq_t_line('33550000-0000-0000-0000-000000000022','33550000-0000-0000-0000-000000000042')->>'earned_quantity')::numeric,1047::numeric,'AC-CQ-010 assessment 1050 earns 997 + 50 beyond the closed order');
select lives_ok($$select public.record_progress_assessment('33550000-0000-0000-0000-000000000022',date '2026-03-01','[{"boq_item_id":"33550000-0000-0000-0000-000000000042","quantity_to_date":2000}]'::jsonb)$$,'AC-CQ-009 assessment of 2000 km recorded for 2026-03-01');
select is((public.cq_t_line('33550000-0000-0000-0000-000000000022','33550000-0000-0000-0000-000000000042')->>'earned_quantity')::numeric,1900::numeric,'AC-CQ-010 earned quantity is capped at the contract quantity');
select is((public.get_project_billing('33550000-0000-0000-0000-000000000022')->>'earned_value')::numeric,95000000::numeric,'AC-CQ-010 capped earned value = 1900 x 50,000');
select is(public.cq_t_line('33550000-0000-0000-0000-000000000022','33550000-0000-0000-0000-000000000043')->>'assessed_quantity',null::text,'AC-CQ-009 an unassessed line stays NULL when other lines are assessed');
select is((public.cq_t_line('33550000-0000-0000-0000-000000000022','33550000-0000-0000-0000-000000000043')->>'earned_quantity')::numeric,0::numeric,'AC-CQ-009 an unassessed line earns nothing');
select ok((public.cq_t_line('33550000-0000-0000-0000-000000000022','33550000-0000-0000-0000-000000000042')->'allocations'->0) ?& array['work_order_id','boq_item_id','quantity','claimed_quantity','accepted_quantity','final'],'AC-CQ-010 allocation objects carry snake_case keys');
select is((public.cq_t_line('33550000-0000-0000-0000-000000000022','33550000-0000-0000-0000-000000000042')->'allocations'->0)->>'work_order_id','33550000-0000-0000-0000-000000000031','AC-CQ-010 allocation names its work order');
select is(((public.cq_t_line('33550000-0000-0000-0000-000000000022','33550000-0000-0000-0000-000000000042')->'allocations'->0)->>'accepted_quantity')::numeric,997::numeric,'AC-CQ-010 allocation reports accepted quantity of the latest BAST');
select is(((public.cq_t_line('33550000-0000-0000-0000-000000000022','33550000-0000-0000-0000-000000000042')->'allocations'->0)->>'final')::boolean,true,'AC-CQ-010 allocation reports the final flag');
select lives_ok($$select public.transition_work_order('33550000-0000-0000-0000-000000000034','Cancelled')$$,'AC-CQ-009 PM cancels an order with an allocation');
select is((public.cq_t_line('33550000-0000-0000-0000-000000000023','33550000-0000-0000-0000-000000000044')->>'ordered_quantity')::numeric,30::numeric,'AC-CQ-009 two orders on one line total 10+20; the cancelled 40 counts nowhere');
select is((public.cq_t_line('33550000-0000-0000-0000-000000000023','33550000-0000-0000-0000-000000000044')->>'contract_balance')::numeric,70::numeric,'AC-CQ-009 cancelled allocation does not consume the contract balance');
select is(jsonb_array_length(public.cq_t_line('33550000-0000-0000-0000-000000000023','33550000-0000-0000-0000-000000000044')->'allocations'),2,'AC-CQ-009 only live orders are listed as allocations');
select ok(not exists(select 1 from jsonb_array_elements(public.cq_t_line('33550000-0000-0000-0000-000000000023','33550000-0000-0000-0000-000000000044')->'allocations') x where x->>'work_order_id'='33550000-0000-0000-0000-000000000034'),'AC-CQ-009 the cancelled order is not an allocation');
select lives_ok($$select public.record_progress_assessment('33550000-0000-0000-0000-000000000024',date '2026-01-01','[{"boq_item_id":"33550000-0000-0000-0000-000000000045","quantity_to_date":0.4}]'::jsonb)$$,'AC-CQ-009 lump-sum fraction assessed');
select is((public.cq_t_line('33550000-0000-0000-0000-000000000024','33550000-0000-0000-0000-000000000045')->>'earned_quantity')::numeric,0.4::numeric,'AC-CQ-009 lump-sum earned quantity is the assessed fraction');
select is((public.get_project_billing('33550000-0000-0000-0000-000000000024')->>'earned_value')::numeric,400000::numeric,'AC-CQ-009 lump-sum earned value = 0.4 x 1,000,000');
select throws_ok($$select public.transition_work_order('33550000-0000-0000-0000-000000000032','Closed')$$,'42501','this work order has contract lines: close it by confirming its final BAST','AC-CQ-010 DD-CQ-9 manual close of an order with allocations is refused');
select is((select status::text from work_orders where id='33550000-0000-0000-0000-000000000032'),'Issued','AC-CQ-010 refused manual close leaves the order Issued');
select lives_ok($$select public.transition_work_order('33550000-0000-0000-0000-000000000035','Closed')$$,'AC-CQ-010 an order without allocations still closes manually');
select is((select status::text from work_orders where id='33550000-0000-0000-0000-000000000035'),'Closed','AC-CQ-010 allocation-free order is Closed');
reset role;
select * from finish();
rollback;

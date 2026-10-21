begin;
create extension if not exists pgtap;
select plan(5);
insert into organizations(id,name) values ('33550000-0000-0000-0000-000000000001','CQ Org');
insert into auth.users(id,email) values ('33550000-0000-0000-0000-000000000011','cq-pm@example.invalid');
insert into profiles(id,org_id,full_name,email,role,status) values ('33550000-0000-0000-0000-000000000011','33550000-0000-0000-0000-000000000001','CQ PM','cq-pm@example.invalid','Project Manager','active');
insert into projects(id,org_id,name,status,contract_value,tax_treatment,tax_amount,project_manager_id,currency) values
 ('33550000-0000-0000-0000-000000000021','33550000-0000-0000-0000-000000000001','CQ Project','Ongoing Project',100000,'exclusive',0,'33550000-0000-0000-0000-000000000011','USD');
insert into boq_items(id,org_id,project_id,item_code,description,unit,quantity,rate) values
 ('33550000-0000-0000-0000-000000000041','33550000-0000-0000-0000-000000000001','33550000-0000-0000-0000-000000000021','LINE','Contract line','unit',10,1000);
set local role authenticated;
set local request.jwt.claims='{"sub":"33550000-0000-0000-0000-000000000011","role":"authenticated"}';
select is((public.get_project_billing('33550000-0000-0000-0000-000000000021')->>'earned_value')::numeric,0::numeric,'AC-CQ-009 no quantity assessment yields zero earned value');
select lives_ok($$select public.record_progress_assessment('33550000-0000-0000-0000-000000000021',date '2026-10-01','[{"boq_item_id":"33550000-0000-0000-0000-000000000041","quantity_to_date":4}]'::jsonb)$$,'AC-CQ-009 quantity progress records a weighted assessment');
select is((public.get_project_billing('33550000-0000-0000-0000-000000000021')->>'earned_value')::numeric,4000::numeric,'AC-CQ-009 earned value is SQL quantity times rate');
select is((public.get_project_billing('33550000-0000-0000-0000-000000000021')->'boq'->0->>'contract_balance'),'10.000','AC-CQ-009 contract balance is reported per line');
select throws_ok($$select public.record_progress_assessment('33550000-0000-0000-0000-000000000021',date '2026-11-01','[{"boq_item_id":"33550000-0000-0000-0000-000000000041","quantity_to_date":1.2345}]'::jsonb)$$,'23514',null,'AC-CQ-009 assessment precision remains capped at three decimals');
reset role;
select * from finish();
rollback;

-- Disposable synthetic 3,000-line material rollup proof. Run inside the database proof lock.
begin;
insert into public.organizations(id,name,default_currency,default_timezone)
values('30120000-0000-0000-0000-000000000001','Synthetic material performance','IDR','UTC');
insert into auth.users(id,email) values('30120000-0000-0000-0000-000000000002','om-perf@example.com');
insert into public.profiles(id,org_id,full_name,email,role,status)
values('30120000-0000-0000-0000-000000000002','30120000-0000-0000-0000-000000000001','Synthetic operator','om-perf@example.com','Admin','active');
insert into public.projects(id,org_id,name,status)
values('30120000-0000-0000-0000-000000000003','30120000-0000-0000-0000-000000000001','Synthetic project','Ongoing Project');
insert into public.stock_units(id,org_id,code,name)
values('30120000-0000-0000-0000-000000000004','30120000-0000-0000-0000-000000000001','ea','Each');
insert into public.boq_items(id,org_id,project_id,item_code,description,unit,quantity,rate)
values('30120000-0000-0000-0000-000000000005','30120000-0000-0000-0000-000000000001','30120000-0000-0000-0000-000000000003','SYNTHETIC','Synthetic work item','ea',100,1);
insert into public.stock_items(org_id,code,name,unit_id)
select '30120000-0000-0000-0000-000000000001','SYN-'||n,'Synthetic material '||n,'30120000-0000-0000-0000-000000000004' from generate_series(1,30) n;
insert into public.boq_material_allowances(org_id,boq_item_id,item_id,planned_quantity)
select i.org_id,'30120000-0000-0000-0000-000000000005',i.id,100 from public.stock_items i where i.org_id='30120000-0000-0000-0000-000000000001';
insert into public.work_orders(org_id,project_id,title,client_po_number,status,order_value,tax_treatment,tax_amount)
select '30120000-0000-0000-0000-000000000001','30120000-0000-0000-0000-000000000003','Synthetic order '||n,'SYN-'||n,'Draft',10000,'exclusive',0 from generate_series(1,100) n;
insert into public.work_order_lines(org_id,work_order_id,boq_item_id,quantity)
select w.org_id,w.id,'30120000-0000-0000-0000-000000000005',1 from public.work_orders w where w.org_id='30120000-0000-0000-0000-000000000001';
insert into public.work_order_sections(org_id,project_id,work_order_id,code,name)
select w.org_id,w.project_id,w.id,'S','Synthetic location' from public.work_orders w where w.org_id='30120000-0000-0000-0000-000000000001';
insert into public.work_order_section_material_plan(org_id,work_order_id,section_id,item_id,quantity)
select s.org_id,s.work_order_id,s.id,i.id,1 from public.work_order_sections s join public.stock_items i on i.org_id=s.org_id where s.org_id='30120000-0000-0000-0000-000000000001';
insert into public.owner_material_import_batches(id,org_id,source_key,schema_version,created_by)
values('30120000-0000-0000-0000-000000000006','30120000-0000-0000-0000-000000000001','synthetic-performance',2,'30120000-0000-0000-0000-000000000002');
insert into public.owner_material_openings(org_id,section_material_plan_id,as_of,received,import_batch_id,created_by)
select p.org_id,p.id,'2026-11-01',1,'30120000-0000-0000-0000-000000000006','30120000-0000-0000-0000-000000000002'
from public.work_order_section_material_plan p where p.org_id='30120000-0000-0000-0000-000000000001';
analyze public.work_order_section_material_plan;
analyze public.owner_material_openings;
analyze public.work_orders;
analyze public.work_order_sections;
analyze public.stock_items;
analyze public.stock_units;
analyze public.projects;
select set_config('request.jwt.claims','{"sub":"30120000-0000-0000-0000-000000000002","role":"authenticated"}',true);
set local role authenticated;
explain(analyze,buffers) select * from public.om_material_rollup('30120000-0000-0000-0000-000000000003');
explain(analyze,buffers) select work_order_id,avg(received_pct),avg(issued_pct) from public.owner_material_stage_totals
where project_id='30120000-0000-0000-0000-000000000003' group by work_order_id;
rollback;

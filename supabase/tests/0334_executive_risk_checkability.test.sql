-- Executive risk checkability uses the full active-delivery population, not top_projects.
begin;
select plan(4);
insert into organizations (id,name) values ('03330000-0000-0000-0000-000000000001','Risk checkability org');
insert into auth.users (id,email) values ('03330000-0000-0000-0000-0000000000a1','risk-check@invalid.example');
insert into profiles (id,org_id,full_name,email,role) values
 ('03330000-0000-0000-0000-0000000000a1','03330000-0000-0000-0000-000000000001','Risk Check','risk-check@invalid.example','Executive');
insert into projects (id,org_id,code,name,status,currency,contract_value,tax_treatment,tax_amount) values
 ('03330000-0000-0000-0000-000000000020','03330000-0000-0000-0000-000000000001','R1','Delivery 1','Ongoing Project','IDR',100,'exclusive',0),
 ('03330000-0000-0000-0000-000000000021','03330000-0000-0000-0000-000000000001','R2','Delivery 2','Ongoing Project','IDR',100,'exclusive',0),
 ('03330000-0000-0000-0000-000000000022','03330000-0000-0000-0000-000000000001','R3','Delivery 3','Ongoing Project','IDR',100,'exclusive',0),
 ('03330000-0000-0000-0000-000000000023','03330000-0000-0000-0000-000000000001','R4','Delivery 4','Ongoing Project','IDR',100,'exclusive',0),
 ('03330000-0000-0000-0000-000000000024','03330000-0000-0000-0000-000000000001','R5','Delivery 5','Ongoing Project','IDR',100,'exclusive',0),
 ('03330000-0000-0000-0000-000000000025','03330000-0000-0000-0000-000000000001','R6','Delivery 6','Ongoing Project','IDR',100,'exclusive',0),
 ('03330000-0000-0000-0000-000000000026','03330000-0000-0000-0000-000000000001','H1','On hold','On Hold','IDR',100,'exclusive',0);
set local role authenticated;
set local request.jwt.claims = '{"sub":"03330000-0000-0000-0000-0000000000a1","role":"authenticated"}';
set local request.jwt.claim.sub = '03330000-0000-0000-0000-0000000000a1';
select is((get_executive_dashboard()->>'active_delivery_projects')::int,7,'AC-RD-RISK-001: six ongoing plus On Hold are in the risk denominator');
select is((get_executive_dashboard()->>'risk_unchecked_projects')::int,7,'AC-RD-RISK-001: every budgetless delivery project is unchecked');
reset role;
delete from projects where id between '03330000-0000-0000-0000-000000000020'::uuid and '03330000-0000-0000-0000-000000000025'::uuid;
set local role authenticated;
select is((get_executive_dashboard()->>'active_delivery_projects')::int,1,'AC-RD-RISK-001: On-Hold-only org has one delivery project');
select is((get_executive_dashboard()->>'risk_unchecked_projects')::int,1,'AC-RD-RISK-001: On-Hold-only project is not falsely reported checkable');
reset role;
select * from finish();
rollback;

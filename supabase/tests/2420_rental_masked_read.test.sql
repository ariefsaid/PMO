-- Mutation: inject rollback/2420_rental_masked_read_down.sql after BEGIN; rental value assertions must fail.
begin;
select plan(13);
insert into organizations (id,name,built_in_roles_enabled,hide_prices_from_requesters) values
 ('24200000-0000-0000-0000-000000000001','Rental reader A',true,true),
 ('24200000-0000-0000-0000-000000000002','Rental reader B',true,true);
insert into auth.users (id,email) select ('24200000-0000-0000-0000-0000000000'||n)::uuid, 'rental-'||n||'@example.test' from unnest(array['a1','a2','a3','b1']) n;
insert into profiles (id,org_id,full_name,email,role,status,built_in_role) values
 ('24200000-0000-0000-0000-0000000000a1','24200000-0000-0000-0000-000000000001','Admin','rental-a1@example.test','Admin','active',null),
 ('24200000-0000-0000-0000-0000000000a2','24200000-0000-0000-0000-000000000001','Requester','rental-a2@example.test','Engineer','active',null),
 ('24200000-0000-0000-0000-0000000000a3','24200000-0000-0000-0000-000000000001','Buyer','rental-a3@example.test','Engineer','active','buyer'),
 ('24200000-0000-0000-0000-0000000000b1','24200000-0000-0000-0000-000000000002','Other admin','rental-b1@example.test','Admin','active',null);
insert into org_purchase_type_settings (org_id,enabled) values ('24200000-0000-0000-0000-000000000001',true) on conflict(org_id) do update set enabled=true;
insert into purchase_types(id,org_id,name,is_rental) values ('24200000-0000-0000-0000-000000000010','24200000-0000-0000-0000-000000000001','Test rental',true);
insert into procurements(id,org_id,title,requested_by_id,status,purchase_type_id,rental_from,rental_to,total_value,approved_total_value) values
 ('24200000-0000-0000-0000-000000000011','24200000-0000-0000-0000-000000000001','Original rental','24200000-0000-0000-0000-0000000000a2','Draft','24200000-0000-0000-0000-000000000010','2026-01-01','2026-01-31',120,100);
insert into procurements(id,org_id,title,requested_by_id,status,purchase_type_id,rental_from,rental_to,extends_procurement_id,total_value,approved_total_value) values
 ('24200000-0000-0000-0000-000000000012','24200000-0000-0000-0000-000000000001','Extension rental','24200000-0000-0000-0000-0000000000a2','Draft','24200000-0000-0000-0000-000000000010','2026-02-01','2026-02-28','24200000-0000-0000-0000-000000000011',120,100);
set local role authenticated;
set local request.jwt.claims='{"sub":"24200000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select po_set_order_job_roles(array['buyer']);
set local request.jwt.claims='{"sub":"24200000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select is((select purchase_type_id from procurements_masked where id='24200000-0000-0000-0000-000000000012'),'24200000-0000-0000-0000-000000000010'::uuid,'Hidden-price requester: rental type');
select is((select rental_from from procurements_masked where id='24200000-0000-0000-0000-000000000012'),'2026-02-01'::date,'Hidden-price requester: rental start');
select is((select rental_to from procurements_masked where id='24200000-0000-0000-0000-000000000012'),'2026-02-28'::date,'Hidden-price requester: rental end');
select is((select extends_procurement_id from procurements_masked where id='24200000-0000-0000-0000-000000000012'),'24200000-0000-0000-0000-000000000011'::uuid,'Hidden-price requester: rental predecessor');
select is((select total_value from procurements_masked where id='24200000-0000-0000-0000-000000000012'),null::numeric,'Hidden-price requester: price remains masked');
select is((select approved_total_value from procurements_masked where id='24200000-0000-0000-0000-000000000012'),null::numeric,'Hidden-price requester: approved price remains masked');
set local request.jwt.claims='{"sub":"24200000-0000-0000-0000-0000000000a3","role":"authenticated"}';
select is((select purchase_type_id from procurements_masked where id='24200000-0000-0000-0000-000000000012'),'24200000-0000-0000-0000-000000000010'::uuid,'Configured buyer: rental type');
select is((select rental_from from procurements_masked where id='24200000-0000-0000-0000-000000000012'),'2026-02-01'::date,'Configured buyer: rental start');
select is((select rental_to from procurements_masked where id='24200000-0000-0000-0000-000000000012'),'2026-02-28'::date,'Configured buyer: rental end');
select is((select extends_procurement_id from procurements_masked where id='24200000-0000-0000-0000-000000000012'),'24200000-0000-0000-0000-000000000011'::uuid,'Configured buyer: rental predecessor');
select is((select total_value from procurements_masked where id='24200000-0000-0000-0000-000000000012'),120::numeric,'Configured buyer: price remains visible');
select is((select approved_total_value from procurements_masked where id='24200000-0000-0000-0000-000000000012'),100::numeric,'Configured buyer: approved price remains visible');
set local request.jwt.claims='{"sub":"24200000-0000-0000-0000-0000000000b1","role":"authenticated"}';
select is((select count(*) from procurements_masked where id='24200000-0000-0000-0000-000000000012'),0::bigint,'Foreign organization cannot read the rental');
reset role;
select * from finish();
rollback;

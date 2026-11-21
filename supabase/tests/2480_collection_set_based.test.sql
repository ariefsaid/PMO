-- 2480_collection_set_based.test.sql — #2480: the set-based Projects collection reads keep every figure.
--
-- 1047 replaced the per-project loops in get_projects_money_collection and get_projects_delivery with one
-- set-based pass each (project_mapped_actuals_all + project_pmo_positions, and an aggregate commitment
-- respectively). 0493_money_collection_single_read.test.sql proves the money collection row for row against
-- its per-project oracle, on both ledger bases. This file adds the delivery rows' committed_spend on the one
-- basis the oracle suites do not cover together: an ERP-ledger org (where the commitment figure is still the
-- procurement figure, not the ledger Actual) beside a PMO org, plus the restricted role that receives rows
-- with no commitment figure rather than no rows.
begin;
create extension if not exists pgtap;
select plan(13);

insert into public.organizations (id,name,default_currency) values
 ('24800000-0000-0000-0000-000000000001','Set-based collection ERP org','USD'),
 ('24800000-0000-0000-0000-000000000002','Set-based collection PMO org','USD');
insert into auth.users (id,email) values
 ('24800000-0000-0000-0000-0000000000a1','set-based-admin@example.test'),
 ('24800000-0000-0000-0000-0000000000a2','set-based-engineer@example.test'),
 ('24800000-0000-0000-0000-0000000000a3','set-based-pmo-admin@example.test');
insert into public.profiles (id,org_id,full_name,email,role,status) values
 ('24800000-0000-0000-0000-0000000000a1','24800000-0000-0000-0000-000000000001','Admin','set-based-admin@example.test','Admin','active'),
 ('24800000-0000-0000-0000-0000000000a2','24800000-0000-0000-0000-000000000001','Engineer','set-based-engineer@example.test','Engineer','active'),
 ('24800000-0000-0000-0000-0000000000a3','24800000-0000-0000-0000-000000000002','Admin','set-based-pmo-admin@example.test','Admin','active');
insert into public.projects (id,org_id,name,status,currency,contract_value,tax_treatment,tax_amount,tax_rate,
                             tax_base_numerator,tax_base_denominator,subject_to_vat,project_manager_id) values
 ('24800000-0000-0000-0000-0000000000d1','24800000-0000-0000-0000-000000000001','Part-paid project','Ongoing Project','USD',1000,'exclusive',0,0,1,1,false,'24800000-0000-0000-0000-0000000000a1'),
 ('24800000-0000-0000-0000-0000000000d2','24800000-0000-0000-0000-000000000001','No purchase project','Ongoing Project','USD',1000,'exclusive',0,0,1,1,false,'24800000-0000-0000-0000-0000000000a1'),
 ('24800000-0000-0000-0000-0000000000d3','24800000-0000-0000-0000-000000000001','Foreign purchase project','Ongoing Project','USD',1000,'exclusive',0,0,1,1,false,'24800000-0000-0000-0000-0000000000a1'),
 ('24800000-0000-0000-0000-0000000000d4','24800000-0000-0000-0000-000000000002','PMO project','Ongoing Project','USD',1000,'exclusive',0,0,1,1,false,'24800000-0000-0000-0000-0000000000a3');
insert into public.procurements (id,org_id,title,status,total_value,currency,project_id,requested_by_id) values
 ('24800000-0000-0000-0000-0000000000f1','24800000-0000-0000-0000-000000000001','Part-paid purchase','Ordered',45,'USD','24800000-0000-0000-0000-0000000000d1','24800000-0000-0000-0000-0000000000a1'),
 ('24800000-0000-0000-0000-0000000000f2','24800000-0000-0000-0000-000000000001','Foreign purchase','Ordered',300,'IDR','24800000-0000-0000-0000-0000000000d3','24800000-0000-0000-0000-0000000000a1'),
 ('24800000-0000-0000-0000-0000000000f3','24800000-0000-0000-0000-000000000002','PMO ordered purchase','Ordered',100,'USD','24800000-0000-0000-0000-0000000000d4','24800000-0000-0000-0000-0000000000a3');
-- ERP-ledger org: a payment is not the ledger basis, so the open commitment stays the full 45.
-- PMO org: the same shape of payment leaves 60 of the 100 ordered open.
insert into public.payments (id,org_id,procurement_id,status,date,amount,currency) values
 ('24800000-0000-0000-0000-0000000000fa','24800000-0000-0000-0000-000000000001','24800000-0000-0000-0000-0000000000f1','Paid','2026-10-10',20,'USD'),
 ('24800000-0000-0000-0000-0000000000fb','24800000-0000-0000-0000-000000000002','24800000-0000-0000-0000-0000000000f3','Paid','2026-10-10',40,'USD');
insert into public.external_org_bindings (org_id,external_tier,site_url,secret_ref,status,connected_by,connected_at) values
 ('24800000-0000-0000-0000-000000000001','erpnext','https://erp.example.test','test-ref','active','24800000-0000-0000-0000-0000000000a1',now());

-- ERP-ledger org, Admin: the delivery row's commitment is the same figure the per-project position returns,
-- for every project of the batch (a part-paid purchase, none, and a foreign-currency one that withholds).
set local role authenticated;
set local request.jwt.claims='{"sub":"24800000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select is(
  (select committed_spend from get_projects_delivery(array[
     '24800000-0000-0000-0000-0000000000d1','24800000-0000-0000-0000-0000000000d2',
     '24800000-0000-0000-0000-0000000000d3']::uuid[]) where project_id='24800000-0000-0000-0000-0000000000d1'),
  (select case when p.complete then p.amount end from project_pmo_commitment_position('24800000-0000-0000-0000-0000000000d1') p),
  'AC-MONEY-01: ERP delivery commitment equals the per-project position for a part-paid purchase');
select is(
  (select committed_spend from get_projects_delivery(array[
     '24800000-0000-0000-0000-0000000000d1','24800000-0000-0000-0000-0000000000d2',
     '24800000-0000-0000-0000-0000000000d3']::uuid[]) where project_id='24800000-0000-0000-0000-0000000000d1'),
  45::numeric,
  'AC-MONEY-02: ERP delivery commitment follows the ledger basis (payments do not reduce it)');
select is(
  (select committed_spend from get_projects_delivery(array[
     '24800000-0000-0000-0000-0000000000d1','24800000-0000-0000-0000-0000000000d2',
     '24800000-0000-0000-0000-0000000000d3']::uuid[]) where project_id='24800000-0000-0000-0000-0000000000d2'),
  0::numeric,
  'AC-MONEY-03: a project with no committed purchase reads zero, not NULL');
select is(
  (select committed_spend from get_projects_delivery(array[
     '24800000-0000-0000-0000-0000000000d1','24800000-0000-0000-0000-0000000000d2',
     '24800000-0000-0000-0000-0000000000d3']::uuid[]) where project_id='24800000-0000-0000-0000-0000000000d3'),
  null::numeric,
  'AC-MONEY-04: a foreign-currency commitment is withheld in the set-based batch too');
select is((select count(*)::int from get_projects_delivery(array[
     '24800000-0000-0000-0000-0000000000d1','24800000-0000-0000-0000-0000000000d2',
     '24800000-0000-0000-0000-0000000000d3']::uuid[])),3,
  'AC-MONEY-05: the batch returns one row per requested project');
select is(
  (select ledger_basis from get_projects_money_collection(array['24800000-0000-0000-0000-0000000000d1'::uuid])),
  'erp','AC-MONEY-06: an ERP-bound org still reads the ledger basis');
select is(
  (select count(*)::int from get_projects_money_collection(array[
     '24800000-0000-0000-0000-0000000000d1','24800000-0000-0000-0000-0000000000d2',
     '24800000-0000-0000-0000-0000000000d3']::uuid[])),3,
  'AC-MONEY-07: the collection returns one row per requested project');

-- Restricted role: rows are still returned (the pre-1047 contract), with no commitment figure.
set local request.jwt.claims='{"sub":"24800000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select is((select count(*)::int from get_projects_delivery(array['24800000-0000-0000-0000-0000000000d1'::uuid])),1,
  'AC-MONEY-08: a restricted role still receives the delivery row');
select is((select committed_spend from get_projects_delivery(array['24800000-0000-0000-0000-0000000000d1'::uuid])),
  null::numeric,'AC-MONEY-09: a restricted role receives no commitment figure');

-- PMO org: the same commitment rule over its own purchases, with no ledger binding.
set local request.jwt.claims='{"sub":"24800000-0000-0000-0000-0000000000a3","role":"authenticated"}';
select is((select ledger_basis from get_projects_money_collection(array['24800000-0000-0000-0000-0000000000d4'::uuid])),
  'pmo','AC-MONEY-10: an unbound org reads the PMO basis');
select is((select committed_spend from get_projects_delivery(array['24800000-0000-0000-0000-0000000000d4'::uuid])),
  (select case when p.complete then p.amount end from project_pmo_commitment_position('24800000-0000-0000-0000-0000000000d4') p),
  'AC-MONEY-11: PMO delivery commitment equals the per-project position');
select is((select (actuals->>'committed_total')::numeric from get_projects_money_collection(array['24800000-0000-0000-0000-0000000000d4'::uuid])),
  60::numeric,'AC-MONEY-12: PMO collection carries the paid-basis open commitment beside the spent figure');
select is((select committed_spend from get_projects_delivery(array['24800000-0000-0000-0000-0000000000d4'::uuid])),
  60::numeric,'AC-MONEY-13: PMO delivery commitment is the open remainder of the purchase');
reset role;
select * from finish();
rollback;

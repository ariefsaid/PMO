-- procurement_first_document_one_step.test.sql — #1465. The first document on a new purchase captures AND advances in one
-- server step, and exactly one order exists whichever path (capture, transition, both, retried) got there.
begin;
select plan(21);

insert into organizations (id, name, default_currency) values ('14650000-0000-0000-0000-0000000000f0','FD1','IDR');
insert into auth.users (id, email) values
  ('14650000-0000-0000-0000-0000000000f1','fd-pm@example.com'), ('14650000-0000-0000-0000-0000000000f2','fd-fin@example.com'),
  ('14650000-0000-0000-0000-0000000000f3','fd-eng@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('14650000-0000-0000-0000-0000000000f1','14650000-0000-0000-0000-0000000000f0','PM','fd-pm@example.com','Project Manager','active'),
  ('14650000-0000-0000-0000-0000000000f2','14650000-0000-0000-0000-0000000000f0','Fin','fd-fin@example.com','Finance','active'),
  ('14650000-0000-0000-0000-0000000000f3','14650000-0000-0000-0000-0000000000f0','Eng','fd-eng@example.com','Engineer','active');
insert into procurements (id, org_id, title, requested_by_id, currency, total_value, status) values
  ('14650000-0000-0000-0000-000000000a01','14650000-0000-0000-0000-0000000000f0','capture','14650000-0000-0000-0000-0000000000f1','IDR',100,'Draft'),
  ('14650000-0000-0000-0000-000000000a02','14650000-0000-0000-0000-0000000000f0','transition','14650000-0000-0000-0000-0000000000f1','IDR',100,'Draft'),
  ('14650000-0000-0000-0000-000000000a03','14650000-0000-0000-0000-0000000000f0','transition-then-capture','14650000-0000-0000-0000-0000000000f1','IDR',100,'Draft'),
  ('14650000-0000-0000-0000-000000000a04','14650000-0000-0000-0000-0000000000f0','denied','14650000-0000-0000-0000-0000000000f3','IDR',100,'Draft'),
  ('14650000-0000-0000-0000-000000000a05','14650000-0000-0000-0000-0000000000f0','real-then-second','14650000-0000-0000-0000-0000000000f1','IDR',100,'Draft'),
  ('14650000-0000-0000-0000-000000000a06','14650000-0000-0000-0000-0000000000f0','other','14650000-0000-0000-0000-0000000000f1','IDR',100,'Draft');

set local role authenticated;
set local request.jwt.claims = '{"sub":"14650000-0000-0000-0000-0000000000f2","role":"authenticated"}';

-- (a) direct capture
select lives_ok($$ select create_purchase_order('14650000-0000-0000-0000-000000000a01','REF-A','Issued',current_date,100) $$, '#1465 (a) capture the first order');
select is((select status::text from procurements where id = '14650000-0000-0000-0000-000000000a01'), 'Ordered', '#1465 (a) the purchase advanced to Ordered');
select is((select count(*) from purchase_orders where procurement_id = '14650000-0000-0000-0000-000000000a01'), 1::bigint, '#1465 (a) exactly one order');
-- (c) then the transition is asked for as well
select lives_ok($$ select transition_procurement('14650000-0000-0000-0000-000000000a01','Ordered') $$, '#1465 (c) the transition after a capture is a no-op');
select is((select count(*) from purchase_orders where procurement_id = '14650000-0000-0000-0000-000000000a01'), 1::bigint, '#1465 (c) still exactly one order');

-- (b) transition path
select lives_ok($$ select transition_procurement('14650000-0000-0000-0000-000000000a02','Ordered') $$, '#1465 (b) transition to Ordered');
select is((select count(*) from purchase_orders where procurement_id = '14650000-0000-0000-0000-000000000a02'), 1::bigint, '#1465 (b) exactly one order');
select lives_ok($$ select transition_procurement('14650000-0000-0000-0000-000000000a02','Ordered') $$, '#1465 (b) a retried transition is a no-op');
select is((select count(*) from purchase_orders where procurement_id = '14650000-0000-0000-0000-000000000a02'), 1::bigint, '#1465 (b) retried: still one order');

-- (c) transition first, then the user captures the order document: it completes the order the transition minted
select lives_ok($$ select transition_procurement('14650000-0000-0000-0000-000000000a03','Ordered') $$, '#1465 (c) transition first');
select lives_ok($$ select create_purchase_order('14650000-0000-0000-0000-000000000a03','REF-C','Issued',current_date,100) $$, '#1465 (c) then capture');
select is((select count(*) from purchase_orders where procurement_id = '14650000-0000-0000-0000-000000000a03'), 1::bigint, '#1465 (c) transition then capture: exactly one order');
select is((select reference_number || '/' || amount::text from purchase_orders where procurement_id = '14650000-0000-0000-0000-000000000a03'), 'REF-C/100.00', '#1465 (c) the captured details are on that order');

-- a captured order with only a date and an external ref is a real order: a second capture adds one, never overwrites
select lives_ok($$ select transition_procurement('14650000-0000-0000-0000-000000000a05','Ordered') $$, '#1465 (d) transition first');
select lives_ok($$ select transition_procurement('14650000-0000-0000-0000-000000000a06','Ordered') $$, '#1465 (d) another purchase also holds a placeholder');
select lives_ok($$ select create_purchase_order('14650000-0000-0000-0000-000000000a05',null,'Issued',current_date - 3,null,null,null,null,'EXT-1') $$, '#1465 (d) capture with a date and an external ref only');
select lives_ok($$ select create_purchase_order('14650000-0000-0000-0000-000000000a05','REF-2','Issued',current_date,200) $$, '#1465 (d) a second capture');
select is((select count(*) from purchase_orders where procurement_id = '14650000-0000-0000-0000-000000000a05'), 2::bigint, '#1465 (d) two orders recorded, two orders held');
select is((select count(*) from purchase_orders where procurement_id = '14650000-0000-0000-0000-000000000a05' and external_ref = 'EXT-1' and date = current_date - 3 and reference_number is null), 1::bigint, '#1465 (d) the first captured order is unchanged');
select is((select reference_number from purchase_orders where procurement_id = '14650000-0000-0000-0000-000000000a06'), null, '#1465 (d) another purchase placeholder untouched');

-- a role that cannot order cannot capture-and-advance
set local request.jwt.claims = '{"sub":"14650000-0000-0000-0000-0000000000f3","role":"authenticated"}';
select throws_ok($$ select create_purchase_order('14650000-0000-0000-0000-000000000a04','REF-D','Issued',current_date,100) $$, '42501', null, '#1465 an Engineer cannot capture-and-advance');

select * from finish();
rollback;

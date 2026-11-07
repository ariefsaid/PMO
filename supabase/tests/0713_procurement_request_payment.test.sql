-- 0713 — one purchase request per procurement (capture and the Draft→Requested transition adopt each other's
-- row), and a payment on a purchase with no vendor bills cannot take the paid total past the purchase's value.
begin;
select plan(18);

insert into organizations(id,name,default_currency) values ('07130000-0000-0000-0000-000000000001','Request Payment Org','IDR');
insert into auth.users(id,email) values
 ('07130000-0000-0000-0000-000000000011','rp-pm@example.com'),
 ('07130000-0000-0000-0000-000000000012','rp-finance@example.com');
insert into profiles(id,org_id,full_name,email,role,status) values
 ('07130000-0000-0000-0000-000000000011','07130000-0000-0000-0000-000000000001','PM','rp-pm@example.com','Project Manager','active'),
 ('07130000-0000-0000-0000-000000000012','07130000-0000-0000-0000-000000000001','Finance','rp-finance@example.com','Finance','active');
insert into procurements(id,org_id,title,requested_by_id,status,total_value,currency)
select ('07130000-0000-0000-0000-0000000001' || lpad(n::text,2,'0'))::uuid,'07130000-0000-0000-0000-000000000001','Case '||n,
       '07130000-0000-0000-0000-000000000011','Draft', case when n = 8 then 0 else 1000 end,'IDR'
  from generate_series(1,8) n;

update procurements set approved_total_value = 1000 where id = '07130000-0000-0000-0000-000000000106';

set local role authenticated;
set local request.jwt.claims='{"sub":"07130000-0000-0000-0000-000000000011","role":"authenticated"}';

-- ── capture, then transition → one request ─────────────────────────────────────────────────────────
select create_purchase_request('07130000-0000-0000-0000-000000000101','REF-1','Draft',current_date,500);
select transition_procurement('07130000-0000-0000-0000-000000000101','Requested');
select is((select count(*)::int from purchase_requests where procurement_id='07130000-0000-0000-0000-000000000101'),1,
  'capture then transition: exactly one purchase request');
select is((select r.pr_number from purchase_requests r where r.procurement_id='07130000-0000-0000-0000-000000000101'),
  (select p.pr_number from procurements p where p.id='07130000-0000-0000-0000-000000000101'),
  'capture then transition: the purchase carries the captured request''s number');
select is((select r.reference_number from purchase_requests r where r.procurement_id='07130000-0000-0000-0000-000000000101'),'REF-1',
  'capture then transition: the captured request is untouched');
select throws_ok($$select transition_procurement('07130000-0000-0000-0000-000000000101','Requested')$$,'P0001',null,
  'a repeated transition is refused');
select is((select count(*)::int from purchase_requests where procurement_id='07130000-0000-0000-0000-000000000101'),1,
  'retry: still one purchase request');

-- ── transition, then capture → one request ─────────────────────────────────────────────────────────
select transition_procurement('07130000-0000-0000-0000-000000000102','Requested');
select create_purchase_request('07130000-0000-0000-0000-000000000102','REF-2','Draft',current_date,700);
select is((select count(*)::int from purchase_requests where procurement_id='07130000-0000-0000-0000-000000000102'),1,
  'transition then capture: exactly one purchase request');
select is((select r.reference_number||'/'||r.amount from purchase_requests r where r.procurement_id='07130000-0000-0000-0000-000000000102'),'REF-2/700.00',
  'transition then capture: the request carries the captured details');
select is((select r.pr_number from purchase_requests r where r.procurement_id='07130000-0000-0000-0000-000000000102'),
  (select p.pr_number from procurements p where p.id='07130000-0000-0000-0000-000000000102'),
  'transition then capture: the request keeps the purchase''s number');
-- a completed capture is not adopted again
select create_purchase_request('07130000-0000-0000-0000-000000000102','REF-3','Draft',current_date,100);
select is((select count(*)::int from purchase_requests where procurement_id='07130000-0000-0000-0000-000000000102'),2,
  'a second capture on the same purchase is a second request');
select is((select r.reference_number from purchase_requests r where r.procurement_id='07130000-0000-0000-0000-000000000102' and r.reference_number='REF-2'),'REF-2',
  'the first captured request is unchanged by the second');

-- ── another purchase's request is never adopted ────────────────────────────────────────────────────
select create_purchase_request('07130000-0000-0000-0000-000000000103','REF-4','Draft',current_date,1);
select transition_procurement('07130000-0000-0000-0000-000000000104','Requested');
select is((select count(*)::int from purchase_requests where procurement_id='07130000-0000-0000-0000-000000000104'),1,
  'a purchase with no request of its own gets its own');
select is((select count(*)::int from purchase_requests where procurement_id='07130000-0000-0000-0000-000000000103'),1,
  'the other purchase''s request is untouched');

-- ── payments with no vendor bills ──────────────────────────────────────────────────────────────────
set local request.jwt.claims='{"sub":"07130000-0000-0000-0000-000000000012","role":"authenticated"}';
select transition_procurement('07130000-0000-0000-0000-000000000105','Paid');
select throws_ok($$select create_payment('07130000-0000-0000-0000-000000000105',null,null,'Scheduled',current_date,1)$$,'23514',null,
  'a payment on top of the paid-in-full amount is refused when there are no vendor bills');
select lives_ok($$select create_payment('07130000-0000-0000-0000-000000000106',null,null,'Scheduled',current_date,600)$$,
  'a payment within the approved amount passes when there are no vendor bills');
select throws_ok($$select create_payment('07130000-0000-0000-0000-000000000106',null,null,'Scheduled',current_date,600)$$,'23514',null,
  'payments taking the total past the approved amount are refused');
select lives_ok($$select create_payment('07130000-0000-0000-0000-000000000106',null,null,'Scheduled',current_date,400)$$,
  'payments up to exactly the approved amount pass');
select lives_ok($$select create_payment('07130000-0000-0000-0000-000000000108',null,null,'Scheduled',current_date,5000)$$,
  'an unapproved purchase has no approved amount to cap against');
select lives_ok($$select create_payment('07130000-0000-0000-0000-000000000108',null,null,'Scheduled',current_date,5000)$$,
  'a second payment on an unapproved purchase still passes');

select * from finish();
rollback;

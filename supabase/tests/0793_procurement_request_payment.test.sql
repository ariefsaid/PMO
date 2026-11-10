-- 0793 — transition-then-capture leaves one purchase request (capture completes the bare request the Draft -> Requested
-- transition wrote; capture-then-transition is 0766), and a payment on a purchase with no vendor bills cannot take the paid
-- total past the purchase's approved amount, nor add to a Paid purchase.
begin;
select plan(27);

insert into organizations(id,name,default_currency) values ('07930000-0000-0000-0000-000000000001','Request Payment Org','IDR');
insert into auth.users(id,email) values
 ('07930000-0000-0000-0000-000000000011','rp-pm@example.com'),
 ('07930000-0000-0000-0000-000000000012','rp-finance@example.com');
insert into profiles(id,org_id,full_name,email,role,status) values
 ('07930000-0000-0000-0000-000000000011','07930000-0000-0000-0000-000000000001','PM','rp-pm@example.com','Project Manager','active'),
 ('07930000-0000-0000-0000-000000000012','07930000-0000-0000-0000-000000000001','Finance','rp-finance@example.com','Finance','active');
insert into procurements(id,org_id,title,requested_by_id,status,total_value,currency,approved_total_value)
select ('07930000-0000-0000-0000-000000000' || n::text)::uuid,'07930000-0000-0000-0000-000000000001','Case '||n,
       '07930000-0000-0000-0000-000000000011',
       (case when n in (201,207) then 'Paid' when n in (202,204,205,206) then 'Approved' else 'Draft' end)::procurement_status,
       1000,'IDR', case when n in (201,202,204,206,207) then 1000 when n = 205 then 0 end
  from unnest(array[101,102,103,104,105,106,107,201,202,203,204,205,206,207]) n;
-- 201: paid in full with no vendor bills (what the Paid transition's own payment looks like)
-- 207: paid 600 of a 1,000 approval with no vendor bills
insert into payments(org_id,procurement_id,status,amount,currency,date) values
 ('07930000-0000-0000-0000-000000000001','07930000-0000-0000-0000-000000000201','Paid',1000,'IDR',current_date),
 ('07930000-0000-0000-0000-000000000001','07930000-0000-0000-0000-000000000207','Paid',600,'IDR',current_date);
-- 204: a live vendor bill larger than the approved amount; the billed ceiling, not the approved amount, governs
insert into procurement_invoices(id,org_id,procurement_id,status,amount,tax_treatment,tax_amount,currency) values
 ('07930000-0000-0000-0000-000000001204','07930000-0000-0000-0000-000000000001','07930000-0000-0000-0000-000000000204','Received',5000,'exclusive',0,'IDR');

set local role authenticated;
set local request.jwt.claims='{"sub":"07930000-0000-0000-0000-000000000011","role":"authenticated"}';

-- ── transition, then capture → one request ─────────────────────────────────────────────────────────
select lives_ok($$select transition_procurement('07930000-0000-0000-0000-000000000101','Requested')$$,
  'transition then capture: Draft -> Requested writes the purchase''s request');
select create_purchase_request('07930000-0000-0000-0000-000000000101','REF-2','Draft',current_date,700);
select is((select count(*)::int from purchase_requests where procurement_id='07930000-0000-0000-0000-000000000101'),1,
  'transition then capture: exactly one purchase request');
select is((select r.reference_number||'/'||r.amount from purchase_requests r where r.procurement_id='07930000-0000-0000-0000-000000000101'),'REF-2/700.00',
  'transition then capture: the request carries the captured details');
select is((select r.pr_number from purchase_requests r where r.procurement_id='07930000-0000-0000-0000-000000000101'),
  (select p.pr_number from procurements p where p.id='07930000-0000-0000-0000-000000000101'),
  'transition then capture: the request keeps the purchase''s number');
-- a completed request is not completed again
select create_purchase_request('07930000-0000-0000-0000-000000000101','REF-3','Draft',current_date,100);
select is((select count(*)::int from purchase_requests where procurement_id='07930000-0000-0000-0000-000000000101'),2,
  'a second capture on the same purchase is a second request');
select is((select count(*)::int from purchase_requests where procurement_id='07930000-0000-0000-0000-000000000101' and reference_number='REF-2' and amount=700),1,
  'the first captured request is unchanged by the second');

-- an imported capture is never folded into the bare request
select transition_procurement('07930000-0000-0000-0000-000000000102','Requested');
select create_purchase_request('07930000-0000-0000-0000-000000000102','REF-I','Draft',current_date,50,'import-key-0793');
select is((select count(*)::int from purchase_requests where procurement_id='07930000-0000-0000-0000-000000000102'),2,
  'an imported capture adds its own request');
select is((select count(*)::int from purchase_requests where procurement_id='07930000-0000-0000-0000-000000000102' and reference_number is null and amount is null),1,
  'the bare request the transition wrote is left as it was');

-- ── a purchase with no request yet, and another purchase's request, are untouched ───────────────────
select create_purchase_request('07930000-0000-0000-0000-000000000103','REF-4','Draft',current_date,1);
select is((select count(*)::int from purchase_requests where procurement_id='07930000-0000-0000-0000-000000000103'),1,
  'capture on a Draft purchase with no request adds the one request');
select transition_procurement('07930000-0000-0000-0000-000000000104','Requested');
select is((select count(*)::int from purchase_requests where procurement_id='07930000-0000-0000-0000-000000000104'),1,
  'a purchase with no request of its own gets its own');
select is((select count(*)::int from purchase_requests where procurement_id='07930000-0000-0000-0000-000000000101'),2,
  'the other purchase''s requests are untouched');

-- ── the bare request is completed only when it is untouched: each of these differs in one conjunct ────
select transition_procurement(('07930000-0000-0000-0000-000000000' || n::text)::uuid,'Requested') from unnest(array[105,106,107]) n;
reset role;
update purchase_requests set external_ref = 'EXT-1' where procurement_id='07930000-0000-0000-0000-000000000105';
update purchase_requests set status = 'Draft' where procurement_id='07930000-0000-0000-0000-000000000106';
update purchase_requests set date = current_date - 1 where procurement_id='07930000-0000-0000-0000-000000000107';
set local role authenticated;
select create_purchase_request(('07930000-0000-0000-0000-000000000' || n::text)::uuid,'REF-X','Draft',current_date,9) from unnest(array[105,106,107]) n;
select is((select count(*)::int from purchase_requests where procurement_id='07930000-0000-0000-0000-000000000105' and reference_number is null),1,
  'a bare request with an external reference is not completed by a capture');
select is((select count(*)::int from purchase_requests where procurement_id='07930000-0000-0000-0000-000000000105'),2,
  'the capture beside a bare request with an external reference is its own request');
select is((select count(*)::int from purchase_requests where procurement_id='07930000-0000-0000-0000-000000000106' and reference_number is null),1,
  'a bare request that is no longer Submitted is not completed by a capture');
select is((select count(*)::int from purchase_requests where procurement_id='07930000-0000-0000-0000-000000000106'),2,
  'the capture beside a bare request that is no longer Submitted is its own request');
select is((select count(*)::int from purchase_requests where procurement_id='07930000-0000-0000-0000-000000000107' and reference_number is null),1,
  'a bare request dated away from its creation day is not completed by a capture');
select is((select count(*)::int from purchase_requests where procurement_id='07930000-0000-0000-0000-000000000107'),2,
  'the capture beside a bare request dated away from its creation day is its own request');

-- ── payments with no vendor bills ──────────────────────────────────────────────────────────────────
set local request.jwt.claims='{"sub":"07930000-0000-0000-0000-000000000012","role":"authenticated"}';
select throws_ok($$select create_payment('07930000-0000-0000-0000-000000000201',null,null,'Scheduled',current_date,1)$$,'23514',
  'payments cannot be added to a paid purchase','a payment on top of the paid-in-full amount is refused when there are no vendor bills');
select throws_ok($$select create_payment('07930000-0000-0000-0000-000000000207',null,null,'Scheduled',current_date,1)$$,'23514',
  'payments cannot be added to a paid purchase','a Paid purchase paid 600 of a 1,000 approval takes nothing more (the paid amount, not the approval, is the cap)');
select lives_ok($$select create_payment('07930000-0000-0000-0000-000000000202',null,null,'Scheduled',current_date,600)$$,
  'a payment within the approved amount passes when there are no vendor bills');
select throws_ok($$select create_payment('07930000-0000-0000-0000-000000000202',null,null,'Scheduled',current_date,600)$$,'23514',
  'payments cannot exceed the approved amount until the vendor bill is recorded','payments taking the total past the approved amount are refused');
select lives_ok($$select create_payment('07930000-0000-0000-0000-000000000202',null,null,'Scheduled',current_date,400)$$,
  'payments up to exactly the approved amount pass');
select lives_ok($$select create_payment('07930000-0000-0000-0000-000000000203',null,null,'Scheduled',current_date,5000)$$,
  'an unapproved purchase has no approved amount to cap against');
select lives_ok($$select create_payment('07930000-0000-0000-0000-000000000203',null,null,'Scheduled',current_date,5000)$$,
  'a second payment on an unapproved purchase still passes');
select lives_ok($$select create_payment('07930000-0000-0000-0000-000000000204',null,null,'Scheduled',current_date,3000)$$,
  'with a live vendor bill the billed ceiling governs, not the approved amount');

select throws_ok($$select create_payment('07930000-0000-0000-0000-000000000205',null,null,'Scheduled',current_date,1)$$,'23514',
  'payments cannot exceed the approved amount until the vendor bill is recorded','an approval of 0 allows no payment when there are no vendor bills');
select throws_ok($$select create_payment('07930000-0000-0000-0000-000000000206',null,null,'Scheduled',current_date,1110)$$,'23514',
  'payments cannot exceed the approved amount until the vendor bill is recorded','the approved amount is pre-tax: a tax-inclusive payment waits for its vendor bill');

select * from finish();
rollback;

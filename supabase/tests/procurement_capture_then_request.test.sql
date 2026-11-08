-- procurement_capture_then_request.test.sql — #1986. Capturing a purchase request first, then moving Draft -> Requested,
-- leaves exactly one request: the transition adopts the captured one (same id, same number). Mirror of #1465.
begin;
select plan(31);

insert into organizations (id, name, default_currency) values ('19860000-0000-0000-0000-0000000000f0','CR1','IDR');
insert into auth.users (id, email) values ('19860000-0000-0000-0000-0000000000f1','cr-pm@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('19860000-0000-0000-0000-0000000000f1','19860000-0000-0000-0000-0000000000f0','PM','cr-pm@example.com','Project Manager','active');
insert into procurements (id, org_id, title, requested_by_id, currency, total_value, status) values
  ('19860000-0000-0000-0000-000000000a01','19860000-0000-0000-0000-0000000000f0','capture-then-request','19860000-0000-0000-0000-0000000000f1','IDR',100,'Draft'),
  ('19860000-0000-0000-0000-000000000a02','19860000-0000-0000-0000-0000000000f0','request-only','19860000-0000-0000-0000-0000000000f1','IDR',100,'Draft'),
  ('19860000-0000-0000-0000-000000000a03','19860000-0000-0000-0000-0000000000f0','already-submitted','19860000-0000-0000-0000-0000000000f1','IDR',100,'Draft'),
  ('19860000-0000-0000-0000-000000000a04','19860000-0000-0000-0000-0000000000f0','no-capture','19860000-0000-0000-0000-0000000000f1','IDR',100,'Draft'),
  ('19860000-0000-0000-0000-000000000a05','19860000-0000-0000-0000-0000000000f0','other-purchase-holds-draft','19860000-0000-0000-0000-0000000000f1','IDR',100,'Draft'),
  ('19860000-0000-0000-0000-000000000a06','19860000-0000-0000-0000-0000000000f0','imported-draft','19860000-0000-0000-0000-0000000000f1','IDR',100,'Draft'),
  ('19860000-0000-0000-0000-000000000a08','19860000-0000-0000-0000-0000000000f0','two-drafts','19860000-0000-0000-0000-0000000000f1','IDR',100,'Draft');
insert into procurements (id, org_id, title, requested_by_id, currency, total_value, status, pr_number) values
  ('19860000-0000-0000-0000-000000000a07','19860000-0000-0000-0000-0000000000f0','already-numbered','19860000-0000-0000-0000-0000000000f1','IDR',100,'Draft','PR-1986-F');

set local role authenticated;
set local request.jwt.claims = '{"sub":"19860000-0000-0000-0000-0000000000f1","role":"authenticated"}';

-- (a) capture first, then the transition
create temp table cap on commit drop as
  select (create_purchase_request('19860000-0000-0000-0000-000000000a01','REF-1','Draft',current_date,100)).id as id;
grant all on cap to authenticated;
select lives_ok($$ select transition_procurement('19860000-0000-0000-0000-000000000a01','Requested') $$, '#1986 (a) Draft -> Requested after a capture');
select is((select count(*) from purchase_requests where procurement_id = '19860000-0000-0000-0000-000000000a01'), 1::bigint, '#1986 (a) exactly one purchase request');
select is((select id from purchase_requests where procurement_id = '19860000-0000-0000-0000-000000000a01'), (select id from cap), '#1986 (a) the transition reuses the captured request (same id)');
select is((select r.pr_number from purchase_requests r where r.procurement_id = '19860000-0000-0000-0000-000000000a01'),
          (select p.pr_number from procurements p where p.id = '19860000-0000-0000-0000-000000000a01'), '#1986 (a) the purchase carries the captured request number');
select is((select status from purchase_requests where procurement_id = '19860000-0000-0000-0000-000000000a01'), 'Submitted', '#1986 (a) the reused request is Submitted');
select is((select reference_number || '/' || amount::text from purchase_requests where procurement_id = '19860000-0000-0000-0000-000000000a01'), 'REF-1/100.00', '#1986 (a) captured details kept');
select is((select status::text from procurements where id = '19860000-0000-0000-0000-000000000a01'), 'Requested', '#1986 (a) the purchase is Requested');

-- (b) transition alone: unchanged, one Submitted request
select lives_ok($$ select transition_procurement('19860000-0000-0000-0000-000000000a02','Requested') $$, '#1986 (b) plain transition');
select is((select count(*) from purchase_requests where procurement_id = '19860000-0000-0000-0000-000000000a02' and status = 'Submitted'), 1::bigint, '#1986 (b) one Submitted request');

-- (c) a captured request already moved on (Approved) is not touched: the transition adds its own
select lives_ok($$ select create_purchase_request('19860000-0000-0000-0000-000000000a03','REF-3','Approved',current_date,50) $$, '#1986 (c) capture an already-approved request');
select lives_ok($$ select transition_procurement('19860000-0000-0000-0000-000000000a03','Requested') $$, '#1986 (c) transition');
select is((select count(*) from purchase_requests where procurement_id = '19860000-0000-0000-0000-000000000a03'), 2::bigint, '#1986 (c) the Approved one is left alone; a Submitted one is added');
select is((select status from purchase_requests where procurement_id = '19860000-0000-0000-0000-000000000a03' and reference_number = 'REF-3'), 'Approved', '#1986 (c) the captured request is unchanged');

-- (d) a Draft request on ANOTHER purchase is never adopted
select lives_ok($$ select create_purchase_request('19860000-0000-0000-0000-000000000a05','REF-5','Draft',current_date,100) $$, '#1986 (d) capture on the other purchase');
select lives_ok($$ select transition_procurement('19860000-0000-0000-0000-000000000a04','Requested') $$, '#1986 (d) transition the purchase with no capture');
select is((select status from purchase_requests where procurement_id = '19860000-0000-0000-0000-000000000a05'), 'Draft', '#1986 (d) the other purchase''s Draft request is untouched');
select is((select count(*) from purchase_requests where procurement_id = '19860000-0000-0000-0000-000000000a04' and status = 'Submitted'), 1::bigint, '#1986 (d) the transitioned purchase gets its own Submitted request');
select is((select pr_number from procurements where id = '19860000-0000-0000-0000-000000000a04') = (select pr_number from purchase_requests where procurement_id = '19860000-0000-0000-0000-000000000a05'), false, '#1986 (d) it does not carry the other purchase''s request number');

-- (e) an imported Draft request (import_key set) is never adopted
select lives_ok($$ select create_purchase_request('19860000-0000-0000-0000-000000000a06','REF-6','Draft',current_date,100,'imp-1986-e') $$, '#1986 (e) capture an imported Draft request');
select lives_ok($$ select transition_procurement('19860000-0000-0000-0000-000000000a06','Requested') $$, '#1986 (e) transition');
select is((select status from purchase_requests where procurement_id = '19860000-0000-0000-0000-000000000a06' and import_key = 'imp-1986-e'), 'Draft', '#1986 (e) the imported request stays Draft');
select is((select count(*) from purchase_requests where procurement_id = '19860000-0000-0000-0000-000000000a06' and status = 'Submitted'), 1::bigint, '#1986 (e) the transition adds its own Submitted request');

-- (f) a purchase that already has a number (e.g. re-requested after Reject) adopts nothing; a stray Draft stays Draft
select lives_ok($$ select create_purchase_request('19860000-0000-0000-0000-000000000a07','REF-7','Draft',current_date,100) $$, '#1986 (f) stray captured Draft on an already-numbered purchase');
select lives_ok($$ select transition_procurement('19860000-0000-0000-0000-000000000a07','Requested') $$, '#1986 (f) transition');
select is((select status from purchase_requests where procurement_id = '19860000-0000-0000-0000-000000000a07' and reference_number = 'REF-7'), 'Draft', '#1986 (f) the stray Draft is not adopted');
select is((select count(*) from purchase_requests r where r.procurement_id = '19860000-0000-0000-0000-000000000a07' and r.status = 'Submitted'
             and r.pr_number is distinct from (select p.pr_number from procurements p where p.id = r.procurement_id)), 0::bigint, '#1986 (f) no Submitted request carries a number other than the purchase''s');

-- (g) several captured Drafts: the earliest is adopted, the others are left as they are
select lives_ok($$ select create_purchase_request('19860000-0000-0000-0000-000000000a08','REF-8A','Draft',current_date,100) $$, '#1986 (g) first capture');
select lives_ok($$ select create_purchase_request('19860000-0000-0000-0000-000000000a08','REF-8B','Draft',current_date,100) $$, '#1986 (g) second capture');
reset role;
update purchase_requests set created_at = now() + interval '1 minute' where procurement_id = '19860000-0000-0000-0000-000000000a08' and reference_number = 'REF-8B';
set local role authenticated;
set local request.jwt.claims = '{"sub":"19860000-0000-0000-0000-0000000000f1","role":"authenticated"}';
select lives_ok($$ select transition_procurement('19860000-0000-0000-0000-000000000a08','Requested') $$, '#1986 (g) transition');
select is((select status from purchase_requests where procurement_id = '19860000-0000-0000-0000-000000000a08' and reference_number = 'REF-8A'), 'Submitted', '#1986 (g) the earliest captured request is adopted');
select is((select status from purchase_requests where procurement_id = '19860000-0000-0000-0000-000000000a08' and reference_number = 'REF-8B'), 'Draft', '#1986 (g) the later one is left as it was');

select * from finish();
rollback;

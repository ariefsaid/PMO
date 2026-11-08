-- procurement_capture_then_request.test.sql — #1986. Capturing a purchase request first, then moving Draft -> Requested,
-- leaves exactly one request: the transition adopts the captured one (same id, same number). Mirror of #1465.
begin;
select plan(13);

insert into organizations (id, name, default_currency) values ('19860000-0000-0000-0000-0000000000f0','CR1','IDR');
insert into auth.users (id, email) values ('19860000-0000-0000-0000-0000000000f1','cr-pm@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('19860000-0000-0000-0000-0000000000f1','19860000-0000-0000-0000-0000000000f0','PM','cr-pm@example.com','Project Manager','active');
insert into procurements (id, org_id, title, requested_by_id, currency, total_value, status) values
  ('19860000-0000-0000-0000-000000000a01','19860000-0000-0000-0000-0000000000f0','capture-then-request','19860000-0000-0000-0000-0000000000f1','IDR',100,'Draft'),
  ('19860000-0000-0000-0000-000000000a02','19860000-0000-0000-0000-0000000000f0','request-only','19860000-0000-0000-0000-0000000000f1','IDR',100,'Draft'),
  ('19860000-0000-0000-0000-000000000a03','19860000-0000-0000-0000-0000000000f0','already-submitted','19860000-0000-0000-0000-0000000000f1','IDR',100,'Draft');

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

select * from finish();
rollback;

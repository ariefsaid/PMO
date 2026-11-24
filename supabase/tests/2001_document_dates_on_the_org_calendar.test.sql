-- 2001_document_dates_on_the_org_calendar.test.sql
-- The purchase request and purchase order dates written by transition_procurement are the organisation's own day, not the
-- database's UTC day (a Jakarta user between midnight and 07:00 saw yesterday). The zone is chosen so that its day differs from UTC's
-- right now (UTC+14 in the second half of the UTC day, UTC-12 in the first), so the test cannot pass by the two days agreeing.
begin;
select plan(5);

insert into organizations (id, name, default_timezone)
  values ('20010000-0000-0000-0000-000000000001', 'OD Org',
          case when extract(hour from now() at time zone 'UTC') >= 10 then 'Pacific/Kiritimati' else 'Etc/GMT+12' end);
insert into auth.users (id, email) values
  ('20010000-0000-0000-0000-0000000000a1', 'od-pm@example.com'), ('20010000-0000-0000-0000-0000000000a2', 'od-fin@example.com');
insert into profiles (id, org_id, full_name, email, role) values
  ('20010000-0000-0000-0000-0000000000a1', '20010000-0000-0000-0000-000000000001', 'OD PM', 'od-pm@example.com', 'Project Manager'),
  ('20010000-0000-0000-0000-0000000000a2', '20010000-0000-0000-0000-000000000001', 'OD Fin', 'od-fin@example.com', 'Finance');
insert into procurements (id, org_id, title, status, requested_by_id) values
  ('20010000-0000-0000-0000-000000000010', '20010000-0000-0000-0000-000000000001', 'OD Proc', 'Draft', '20010000-0000-0000-0000-0000000000a1');
insert into companies (id, org_id, name, type) values ('20010000-0000-0000-0000-0000000000c1', '20010000-0000-0000-0000-000000000001', 'OD supplier', 'Vendor');
update procurements set vendor_id = '20010000-0000-0000-0000-0000000000c1' where id = '20010000-0000-0000-0000-000000000010';

select isnt((select (now() at time zone 'UTC')::date), public.native_org_today('20010000-0000-0000-0000-000000000001'),
  'the fixture zone is on a different calendar day from UTC right now');

set local role authenticated;
set local request.jwt.claims to '{"sub":"20010000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select lives_ok($$ select transition_procurement('20010000-0000-0000-0000-000000000010', 'Requested') $$, 'the purchase is requested');
reset role;
set local role authenticated;
set local request.jwt.claims to '{"sub":"20010000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select lives_ok($$ select transition_procurement('20010000-0000-0000-0000-000000000010', 'Approved') $$, 'it is approved by someone else');
reset role;
set local role authenticated;
set local request.jwt.claims to '{"sub":"20010000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select lives_ok($$ select transition_procurement('20010000-0000-0000-0000-000000000010', 'Ordered') $$, 'and ordered');
reset role;

select is(
  (select pr.date from purchase_requests pr where pr.procurement_id = '20010000-0000-0000-0000-000000000010')
  || ' / ' || (select po.date from purchase_orders po where po.procurement_id = '20010000-0000-0000-0000-000000000010'),
  public.native_org_today('20010000-0000-0000-0000-000000000001') || ' / ' || public.native_org_today('20010000-0000-0000-0000-000000000001'),
  'the purchase request and the purchase order carry the organisation''s day');

select * from finish();
rollback;

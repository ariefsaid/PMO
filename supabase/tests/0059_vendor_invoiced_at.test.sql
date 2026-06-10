-- 0059_vendor_invoiced_at.test.sql
-- AC-FIN-DEBT-001: →'Vendor Invoiced' stamps vendor_invoiced_at ≈ now().
-- AC-FIN-DEBT-002: a not-yet-VI procurement has vendor_invoiced_at = null.
-- AC-FIN-DEBT-003: a later →'Paid' does NOT change vendor_invoiced_at (entry-only stamp).
-- AC-FIN-DEBT-004: a cross-org caller cannot read another org's vendor_invoiced_at (RLS read scoping).
begin;
select plan(11);

insert into organizations (id, name) values
  ('00590000-0000-0000-0000-000000000001','VI Org A'),
  ('00590000-0000-0000-0000-000000000002','VI Org B');

insert into auth.users (id, email) values
  ('00590000-0000-0000-0000-0000000000a1','pm-a@example.com'),
  ('00590000-0000-0000-0000-0000000000a2','fin-a@example.com'),
  ('00590000-0000-0000-0000-0000000000a3','fin2-a@example.com'),
  ('00590000-0000-0000-0000-0000000000b1','fin-b@example.com');

insert into profiles (id, org_id, full_name, email, role) values
  ('00590000-0000-0000-0000-0000000000a1','00590000-0000-0000-0000-000000000001','PM A','pm-a@example.com','Project Manager'),
  ('00590000-0000-0000-0000-0000000000a2','00590000-0000-0000-0000-000000000001','Fin A','fin-a@example.com','Finance'),
  ('00590000-0000-0000-0000-0000000000a3','00590000-0000-0000-0000-000000000001','Fin2 A','fin2-a@example.com','Finance'),
  ('00590000-0000-0000-0000-0000000000b1','00590000-0000-0000-0000-000000000002','Fin B','fin-b@example.com','Finance');

-- Proc to be driven Draft→Requested→Approved→Ordered→Received→Vendor Invoiced→Paid.
-- requester=a1(pm), approver=a2(fin); a3(fin) pays so SoD-b (payer≠approver) passes.
insert into procurements (id, org_id, title, status, requested_by_id) values
  ('00590000-0000-0000-0000-000000000010','00590000-0000-0000-0000-000000000001','VI Proc','Draft','00590000-0000-0000-0000-0000000000a1');
-- A second proc left in Draft → AC-FIN-DEBT-002 (never VI ⇒ null).
insert into procurements (id, org_id, title, status, requested_by_id) values
  ('00590000-0000-0000-0000-000000000011','00590000-0000-0000-0000-000000000001','Never VI','Draft','00590000-0000-0000-0000-0000000000a1');

-- Drive to Received. PM does Draft→Requested→...→Received (PM is in every required set incl. Ordered→Received).
set local role authenticated;
set local request.jwt.claims to '{"sub":"00590000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select lives_ok($$ select transition_procurement('00590000-0000-0000-0000-000000000010','Requested') $$, 'setup Requested');
reset role;
-- Approve as Finance a2 (≠ requester ⇒ SoD-a ok).
set local role authenticated;
set local request.jwt.claims to '{"sub":"00590000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select lives_ok($$ select transition_procurement('00590000-0000-0000-0000-000000000010','Approved') $$, 'setup Approved');
reset role;
-- Ordered + Received as PM a1.
set local role authenticated;
set local request.jwt.claims to '{"sub":"00590000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select lives_ok($$ select transition_procurement('00590000-0000-0000-0000-000000000010','Ordered') $$, 'setup Ordered');
select lives_ok($$ select transition_procurement('00590000-0000-0000-0000-000000000010','Received') $$, 'setup Received');
reset role;
-- Received→Vendor Invoiced as Finance a2.
set local role authenticated;
set local request.jwt.claims to '{"sub":"00590000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select lives_ok($$ select transition_procurement('00590000-0000-0000-0000-000000000010','Vendor Invoiced') $$, 'drive to Vendor Invoiced');
reset role;

-- AC-FIN-DEBT-001: the VI transition stamped vendor_invoiced_at non-null and ≈ now().
select isnt((select vendor_invoiced_at from procurements where id='00590000-0000-0000-0000-000000000010'), null,
  'AC-FIN-DEBT-001: →Vendor Invoiced stamps vendor_invoiced_at non-null');
select ok((select vendor_invoiced_at from procurements where id='00590000-0000-0000-0000-000000000010') > now() - interval '1 minute',
  'AC-FIN-DEBT-001: vendor_invoiced_at is approximately now()');
-- AC-FIN-DEBT-002: the Draft proc never reached VI ⇒ null.
select is((select vendor_invoiced_at from procurements where id='00590000-0000-0000-0000-000000000011'), null,
  'AC-FIN-DEBT-002: a not-yet-Vendor-Invoiced procurement has vendor_invoiced_at = null');

-- AC-FIN-DEBT-003: a later →Paid (by Finance a3 ≠ approver a2) does NOT change vendor_invoiced_at.
-- Capture the stamp into a temp, transition, re-read, compare for equality.
create temporary table _vi_capture on commit drop as
  select vendor_invoiced_at as ts from procurements where id='00590000-0000-0000-0000-000000000010';

set local role authenticated;
set local request.jwt.claims to '{"sub":"00590000-0000-0000-0000-0000000000a3","role":"authenticated"}';
select lives_ok($$ select transition_procurement('00590000-0000-0000-0000-000000000010','Paid') $$, 'drive to Paid');
reset role;
select is(
  (select vendor_invoiced_at from procurements where id='00590000-0000-0000-0000-000000000010'),
  (select ts from _vi_capture),
  'AC-FIN-DEBT-003: vendor_invoiced_at unchanged by the →Paid transition (entry-only stamp, not re-stamped)');

-- AC-FIN-DEBT-004: org-B caller cannot read org-A's procurement (vendor_invoiced_at not leaked, RLS read scoping).
set local role authenticated;
set local request.jwt.claims to '{"sub":"00590000-0000-0000-0000-0000000000b1","role":"authenticated"}';
select is(
  (select count(*)::int from procurements where id='00590000-0000-0000-0000-000000000010'),
  0,
  'AC-FIN-DEBT-004: org-B caller cannot read org-A procurement (vendor_invoiced_at not leaked, RLS read scoping)');
reset role;

select * from finish();
rollback;

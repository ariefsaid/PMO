-- 0080_transition_records.test.sql
-- Migration under test: 0038_transition_writes_records.sql
--
-- AC-PR-011  minted PR#/PO# lands on the purchase_requests / purchase_orders record row.
-- AC-PR-012  SoD-a re-proof: requester (incl. Admin requester) cannot Approve own procurement → 42501.
-- AC-PR-013  SoD-b re-proof: approver cannot Pay own approved procurement → 42501.
-- AC-PR-033  status-event log: correct rows appended + direct-write denied (append-only, RPC-only).
begin;
select plan(7);

-- ── Fixtures (inserted as table owner — bypasses RLS) ─────────────────────────

insert into organizations (id, name) values
  ('00800000-0000-0000-0000-000000000001', 'TR Org A');

insert into auth.users (id, email) values
  ('00800000-0000-0000-0000-0000000000a1', 'pm-tr@example.com'),
  ('00800000-0000-0000-0000-0000000000a2', 'fin-tr-y@example.com'),
  ('00800000-0000-0000-0000-0000000000a3', 'fin-tr-z@example.com'),
  ('00800000-0000-0000-0000-0000000000a4', 'admin-tr@example.com');

insert into profiles (id, org_id, full_name, email, role) values
  ('00800000-0000-0000-0000-0000000000a1','00800000-0000-0000-0000-000000000001','PM TR','pm-tr@example.com','Project Manager'),
  ('00800000-0000-0000-0000-0000000000a2','00800000-0000-0000-0000-000000000001','Finance Y TR','fin-tr-y@example.com','Finance'),
  ('00800000-0000-0000-0000-0000000000a3','00800000-0000-0000-0000-000000000001','Finance Z TR','fin-tr-z@example.com','Finance'),
  ('00800000-0000-0000-0000-0000000000a4','00800000-0000-0000-0000-000000000001','Admin TR','admin-tr@example.com','Admin');

-- Procurement #1: Draft — for AC-PR-011 + AC-PR-033 (will be driven Draft→Requested→Approved→Ordered).
-- PM-A is the requester; Finance-Y will approve (non-requester).
insert into procurements (id, org_id, title, status, requested_by_id, total_value) values
  ('00800000-0000-0000-0000-000000000010','00800000-0000-0000-0000-000000000001',
   'TR Main Case','Draft','00800000-0000-0000-0000-0000000000a1', 50000.00);

-- Procurement #2: Requested, requested_by = PM-A — for AC-PR-012 SoD-a (regular requester cannot Approve).
insert into procurements (id, org_id, title, status, requested_by_id) values
  ('00800000-0000-0000-0000-000000000011','00800000-0000-0000-0000-000000000001',
   'TR SoD-a Regular','Requested','00800000-0000-0000-0000-0000000000a1');

-- Procurement #3: Requested, requested_by = Admin-A — for AC-PR-012 SoD-a (Admin requester also blocked).
-- SoD-a runs OUTSIDE the Admin-skip block (0018 hardening, OD-PROC-8): Admin cannot self-approve.
insert into procurements (id, org_id, title, status, requested_by_id) values
  ('00800000-0000-0000-0000-000000000012','00800000-0000-0000-0000-000000000001',
   'TR SoD-a Admin','Requested','00800000-0000-0000-0000-0000000000a4');

-- Procurement #4: Vendor Invoiced, approved_by = Finance-Y — for AC-PR-013 SoD-b.
insert into procurements (id, org_id, title, status, requested_by_id, approved_by_id) values
  ('00800000-0000-0000-0000-000000000013','00800000-0000-0000-0000-000000000001',
   'TR SoD-b','Vendor Invoiced',
   '00800000-0000-0000-0000-0000000000a1',
   '00800000-0000-0000-0000-0000000000a2');

-- ── AC-PR-011: drive Procurement #1 through Draft→Requested→Approved→Ordered ──
-- PM-A submits (Draft→Requested).
-- 1580: an order needs a supplier, so every fixture purchase that is not yet ordered is given one.
insert into companies (id, org_id, name, type)
  select md5('1580-supplier-' || o.org_id::text)::uuid, o.org_id, 'Fixture supplier', 'Vendor' from (select distinct org_id from procurements) o
  on conflict (id) do nothing;
update procurements p set vendor_id = md5('1580-supplier-' || p.org_id::text)::uuid
 where p.vendor_id is null and p.status in ('Draft','Requested','Approved','Vendor Quoted','Quote Selected');
set local role authenticated;
set local request.jwt.claims = '{"sub":"00800000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select transition_procurement('00800000-0000-0000-0000-000000000010', 'Requested');
reset role;

-- Assert: purchase_requests row exists for this case carrying the case's pr_number.
select is(
  (select pr.pr_number from public.purchase_requests pr
    join public.procurements p on p.id = pr.procurement_id
   where pr.procurement_id = '00800000-0000-0000-0000-000000000010'
     and pr.pr_number = p.pr_number
   limit 1),
  (select pr_number from public.procurements where id = '00800000-0000-0000-0000-000000000010'),
  'AC-PR-011: after →Requested, purchase_requests row carries the case pr_number');

-- Finance-Y approves (Requested→Approved; non-requester so SoD-a passes).
-- Finance-Y orders (Approved→Ordered; SoD-b only blocks Paid, not Ordered).
set local role authenticated;
set local request.jwt.claims = '{"sub":"00800000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select transition_procurement('00800000-0000-0000-0000-000000000010', 'Approved');
select transition_procurement('00800000-0000-0000-0000-000000000010', 'Ordered');
reset role;

-- Assert: purchase_orders row exists for this case carrying the case's po_number.
select is(
  (select po.po_number from public.purchase_orders po
    join public.procurements p on p.id = po.procurement_id
   where po.procurement_id = '00800000-0000-0000-0000-000000000010'
     and po.po_number = p.po_number
   limit 1),
  (select po_number from public.procurements where id = '00800000-0000-0000-0000-000000000010'),
  'AC-PR-011: after →Ordered, purchase_orders row carries the case po_number');

-- ── AC-PR-012: SoD-a — requester cannot Approve own procurement → 42501 ────────

-- Regular requester (PM-A) on Procurement #2.
set local role authenticated;
set local request.jwt.claims = '{"sub":"00800000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select throws_ok(
  $$ select transition_procurement('00800000-0000-0000-0000-000000000011','Approved') $$,
  '42501', null,
  'AC-PR-012: SoD-a — PM requester cannot Approve own procurement (42501)');
reset role;

-- Admin requester (Admin-A) on Procurement #3: SoD-a is outside the Admin-skip (0018, OD-PROC-8).
set local role authenticated;
set local request.jwt.claims = '{"sub":"00800000-0000-0000-0000-0000000000a4","role":"authenticated"}';
select throws_ok(
  $$ select transition_procurement('00800000-0000-0000-0000-000000000012','Approved') $$,
  '42501', null,
  'AC-PR-012: SoD-a — Admin requester also cannot Approve own procurement (SoD outside Admin-skip, 42501)');
reset role;

-- ── AC-PR-013: SoD-b — approver cannot Pay own approved procurement → 42501 ────

set local role authenticated;
set local request.jwt.claims = '{"sub":"00800000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select throws_ok(
  $$ select transition_procurement('00800000-0000-0000-0000-000000000013','Paid') $$,
  '42501', null,
  'AC-PR-013: SoD-b — approver (Finance-Y) cannot Pay own approved procurement (42501)');
reset role;

-- ── AC-PR-033: status-event log ──────────────────────────────────────────────
-- Procurement #1 has been driven through 3 transitions (Draft→Requested→Approved→Ordered).
-- Verify the event rows are correct (as table owner, no RLS interference).

select results_eq(
  $$ select from_status::text, to_status::text
       from public.procurement_status_events
      where procurement_id = '00800000-0000-0000-0000-000000000010'
      order by created_at $$,
  $$ values
       ('Draft'::text,     'Requested'),
       ('Requested'::text, 'Approved'),
       ('Approved'::text,  'Ordered') $$,
  'AC-PR-033: procurement_status_events has one row per transition in order (Draft→Requested→Approved→Ordered)');

-- Direct client insert into procurement_status_events is denied (no write policy → append-only RPC-only).
set local role authenticated;
set local request.jwt.claims = '{"sub":"00800000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select throws_ok(
  $$ insert into public.procurement_status_events
       (procurement_id, org_id, from_status, to_status, actor_id)
     values (
       '00800000-0000-0000-0000-000000000010',
       '00800000-0000-0000-0000-000000000001',
       'Draft', 'Requested',
       '00800000-0000-0000-0000-0000000000a1'
     ) $$,
  '42501', null,
  'AC-PR-033: direct client insert into procurement_status_events is denied (no write policy, append-only)');
reset role;

select * from finish();
rollback;

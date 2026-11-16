-- #1671: an organisation with no ERP voids a mistyped subcontract bill (AC-SCV-001..007, FR-SCV-001..007).
-- Plan docs/plans/2026-11-15-void-subcontract-bill.md. Migration 0885_void_subcontract_bill.sql.
-- Orgs: A multi-member (no ERP), B another tenant, S a sole member. Bills are captured through the RPC so the
-- create audit carries the real author.
begin;
create extension if not exists pgtap;
select plan(55);

insert into organizations (id, name, default_currency) values
  ('16710000-0000-0000-0000-00000000000a', 'SCV Org',       'IDR'),
  ('16710000-0000-0000-0000-00000000000b', 'SCV Other Org', 'IDR'),
  ('16710000-0000-0000-0000-00000000000c', 'SCV Solo Org',  'IDR');
insert into auth.users (id, email) values
  ('16710000-0000-0000-0000-0000000000a1', 'scv-admin@example.com'),
  ('16710000-0000-0000-0000-0000000000a2', 'scv-fin1@example.com'),
  ('16710000-0000-0000-0000-0000000000a3', 'scv-fin2@example.com'),
  ('16710000-0000-0000-0000-0000000000a4', 'scv-pm@example.com'),
  ('16710000-0000-0000-0000-0000000000a5', 'scv-eng@example.com'),
  ('16710000-0000-0000-0000-0000000000a6', 'scv-exec@example.com'),
  ('16710000-0000-0000-0000-0000000000a8', 'scv-fin-off@example.com'),
  ('16710000-0000-0000-0000-0000000000a9', 'scv-fin3@example.com'),
  ('16710000-0000-0000-0000-0000000000b1', 'scv-xorg@example.com'),
  ('16710000-0000-0000-0000-0000000000c1', 'scv-solo@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('16710000-0000-0000-0000-0000000000a1', '16710000-0000-0000-0000-00000000000a', 'SCV Admin', 'scv-admin@example.com', 'Admin', 'active'),
  ('16710000-0000-0000-0000-0000000000a2', '16710000-0000-0000-0000-00000000000a', 'SCV Fin1',  'scv-fin1@example.com',  'Finance', 'active'),
  ('16710000-0000-0000-0000-0000000000a3', '16710000-0000-0000-0000-00000000000a', 'SCV Fin2',  'scv-fin2@example.com',  'Finance', 'active'),
  ('16710000-0000-0000-0000-0000000000a4', '16710000-0000-0000-0000-00000000000a', 'SCV PM',    'scv-pm@example.com',    'Project Manager', 'active'),
  ('16710000-0000-0000-0000-0000000000a5', '16710000-0000-0000-0000-00000000000a', 'SCV Eng',   'scv-eng@example.com',   'Engineer', 'active'),
  ('16710000-0000-0000-0000-0000000000a6', '16710000-0000-0000-0000-00000000000a', 'SCV Exec',  'scv-exec@example.com',  'Executive', 'active'),
  ('16710000-0000-0000-0000-0000000000a8', '16710000-0000-0000-0000-00000000000a', 'SCV Fin Off', 'scv-fin-off@example.com', 'Finance', 'disabled'),
  ('16710000-0000-0000-0000-0000000000a9', '16710000-0000-0000-0000-00000000000a', 'SCV Fin3',  'scv-fin3@example.com',  'Finance', 'active'),
  ('16710000-0000-0000-0000-0000000000b1', '16710000-0000-0000-0000-00000000000b', 'SCV XOrg',  'scv-xorg@example.com',  'Finance', 'active'),
  ('16710000-0000-0000-0000-0000000000c1', '16710000-0000-0000-0000-00000000000c', 'SCV Solo',  'scv-solo@example.com',  'Finance', 'active');
insert into projects (id, org_id, name, status, project_manager_id) values
  ('16710000-0000-0000-0000-0000000000d1', '16710000-0000-0000-0000-00000000000a', 'SCV Site', 'Ongoing Project', '16710000-0000-0000-0000-0000000000a4'),
  ('16710000-0000-0000-0000-0000000000d9', '16710000-0000-0000-0000-00000000000c', 'SCV Solo Site', 'Ongoing Project', null);
insert into boq_items (id, org_id, project_id, item_code, description, unit, quantity, rate) values
  ('16710000-0000-0000-0000-0000000000e1', '16710000-0000-0000-0000-00000000000a', '16710000-0000-0000-0000-0000000000d1', 'L1', 'Excavation', 'm3', 100, 150000),
  ('16710000-0000-0000-0000-0000000000e9', '16710000-0000-0000-0000-00000000000c', '16710000-0000-0000-0000-0000000000d9', 'L9', 'Solo work', 'ls', 10, 10000);
-- f1: approved subcontract purchase in org A. f9: the sole member's unapproved subcontract purchase (its recorded total
-- follows its documents). f2: a plain (non-subcontract) purchase in org A.
insert into procurements (id, org_id, title, project_id, requested_by_id, status, total_value, approved_total_value,
                          approved_by_id, budget_category, currency, is_subcontract) values
  ('16710000-0000-0000-0000-0000000000f1', '16710000-0000-0000-0000-00000000000a', 'SCV earthworks', '16710000-0000-0000-0000-0000000000d1',
   '16710000-0000-0000-0000-0000000000a4', 'Ordered', 10000000, 10000000, '16710000-0000-0000-0000-0000000000a6', 'Subcontractors', 'IDR', true),
  ('16710000-0000-0000-0000-0000000000f9', '16710000-0000-0000-0000-00000000000c', 'SCV solo', '16710000-0000-0000-0000-0000000000d9',
   '16710000-0000-0000-0000-0000000000c1', 'Ordered', 100000, null, null, 'Subcontractors', 'IDR', true),
  ('16710000-0000-0000-0000-0000000000f2', '16710000-0000-0000-0000-00000000000a', 'SCV plain buy', '16710000-0000-0000-0000-0000000000d1',
   '16710000-0000-0000-0000-0000000000a4', 'Ordered', 5000, 5000, '16710000-0000-0000-0000-0000000000a6', 'Materials', 'IDR', false);
insert into purchase_orders (id, org_id, procurement_id, po_number, status, date, currency) values
  ('16710000-0000-0000-0000-000000000101', '16710000-0000-0000-0000-00000000000a', '16710000-0000-0000-0000-0000000000f1', 'PO-SCV-1', 'Issued', current_date, 'IDR'),
  ('16710000-0000-0000-0000-000000000109', '16710000-0000-0000-0000-00000000000c', '16710000-0000-0000-0000-0000000000f9', 'PO-SCV-9', 'Issued', current_date, 'IDR');
insert into project_documents (id, org_id, project_id, category, title, status, file_path) values
  ('16710000-0000-0000-0000-000000000201', '16710000-0000-0000-0000-00000000000a', '16710000-0000-0000-0000-0000000000d1', 'Acceptance', 'BA 1', 'Issued',
   '16710000-0000-0000-0000-00000000000a/16710000-0000-0000-0000-0000000000d1/16710000-0000-0000-0000-000000000201/ba1.pdf'),
  ('16710000-0000-0000-0000-000000000209', '16710000-0000-0000-0000-00000000000c', '16710000-0000-0000-0000-0000000000d9', 'Acceptance', 'BA solo', 'Issued',
   '16710000-0000-0000-0000-00000000000c/16710000-0000-0000-0000-0000000000d9/16710000-0000-0000-0000-000000000209/ba9.pdf');
insert into purchase_order_lines (po_id, revision, boq_item_id, quantity, rate, unit) values
  ('16710000-0000-0000-0000-000000000101', 1, '16710000-0000-0000-0000-0000000000e1', 100, 100000, 'm3'),
  ('16710000-0000-0000-0000-000000000109', 1, '16710000-0000-0000-0000-0000000000e9',  10,  10000, 'ls');
insert into purchase_order_revisions (po_id, procurement_id, revision, status, total, issued_by, issue_basis) values
  ('16710000-0000-0000-0000-000000000101', '16710000-0000-0000-0000-0000000000f1', 1, 'Issued', 10000000, '16710000-0000-0000-0000-0000000000a4', 'standard'),
  ('16710000-0000-0000-0000-000000000109', '16710000-0000-0000-0000-0000000000f9', 1, 'Issued',   100000, '16710000-0000-0000-0000-0000000000c1', 'standard');
-- Confirmed acceptances: L1 100 verified (org A), L9 10 verified (org S). Appended as superuser.
insert into subcontract_acceptances (id, org_id, project_id, po_id, acceptance_date, status, prepared_by, confirmed_by, confirmed_at, confirm_basis, document_id) values
  ('16710000-0000-0000-0000-000000000301', '16710000-0000-0000-0000-00000000000a', '16710000-0000-0000-0000-0000000000d1', '16710000-0000-0000-0000-000000000101',
   current_date, 'Confirmed', '16710000-0000-0000-0000-0000000000a4', '16710000-0000-0000-0000-0000000000a2', clock_timestamp(), 'standard', '16710000-0000-0000-0000-000000000201'),
  ('16710000-0000-0000-0000-000000000309', '16710000-0000-0000-0000-00000000000c', '16710000-0000-0000-0000-0000000000d9', '16710000-0000-0000-0000-000000000109',
   current_date, 'Confirmed', '16710000-0000-0000-0000-0000000000c1', '16710000-0000-0000-0000-0000000000c1', clock_timestamp(), 'sole_operator', '16710000-0000-0000-0000-000000000209');
insert into subcontract_acceptance_lines values
  ('16710000-0000-0000-0000-000000000301', '16710000-0000-0000-0000-0000000000e1', 100),
  ('16710000-0000-0000-0000-000000000309', '16710000-0000-0000-0000-0000000000e9', 10);

create or replace function pg_temp.act_as(p_uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
$$;
create or replace function pg_temp.as_super() returns void language sql as $$
  select set_config('request.jwt.claims', '', true);
$$;
-- A bill on f1 for p_q m3 of L1 at 100,000 (tax exclusive, zero tax), captured by whoever is acting.
create or replace function pg_temp.bill(p_q numeric) returns uuid language sql as $$
  select (capture_subcontract_vendor_invoice(
    p_procurement_id => '16710000-0000-0000-0000-0000000000f1', p_status => 'Received', p_invoice_date => current_date,
    p_amount => round(p_q * 100000, 2), p_tax_treatment => 'exclusive', p_tax_amount => 0,
    p_lines => jsonb_build_array(jsonb_build_object('boq_item_id', '16710000-0000-0000-0000-0000000000e1', 'quantity', p_q, 'rate', 100000)))).id
$$;
create or replace function pg_temp.id(k text) returns uuid language sql as $$ select current_setting('scv.' || k)::uuid $$;
create or replace function pg_temp.voided(k text) returns boolean language sql security definer as $$
  select voided_at is not null from public.procurement_invoices where id = current_setting('scv.' || k)::uuid
$$;
create or replace function pg_temp.l1_payable() returns numeric language sql as $$
  select payable from subcontract_po_position('16710000-0000-0000-0000-000000000101') where item_code = 'L1'
$$;

-- ── Grants ─────────────────────────────────────────────────────────────────────────────────────────────────
select is(has_function_privilege('anon', 'public.void_subcontract_bill(uuid,text)', 'EXECUTE'), false,
  'AC-SCV-004 anon cannot execute the void');
select is(has_function_privilege('authenticated', 'public.guard_procurement_invoice_void()', 'EXECUTE')
       or has_function_privilege('authenticated', 'public.guard_payment_voided_bill()', 'EXECUTE'), false,
  'AC-SCV-007 the void guards are not client-executable');

-- ── Fin1 captures bill1 using the whole of L1 ──────────────────────────────────────────────────────────────
set local role authenticated; select pg_temp.act_as('16710000-0000-0000-0000-0000000000a2');
select set_config('scv.bill1', pg_temp.bill(100)::text, true);
select is(pg_temp.l1_payable(), 0::numeric, 'AC-SCV-001 setup: bill1 uses up L1''s headroom');
select throws_ok($$ select pg_temp.bill(2) $$, 'SC001', null, 'AC-SCV-001 setup: no corrected bill fits while bill1 is live');

-- ── AC-SCV-003: the author may not void their own bill ─────────────────────────────────────────────────────
select throws_ok($$ select void_subcontract_bill(pg_temp.id('bill1'), 'mistyped') $$, '42501',
  'separation of duties: the person who captured this bill cannot void it', 'AC-SCV-003 the author cannot void their own bill');
select is(pg_temp.voided('bill1'), false, 'AC-SCV-003 the refused self-void changes nothing');

-- ── AC-SCV-004: role, membership, tenancy ──────────────────────────────────────────────────────────────────
select pg_temp.act_as('16710000-0000-0000-0000-0000000000a4');
select throws_ok($$ select void_subcontract_bill(pg_temp.id('bill1'), 'mistyped') $$, '42501', 'not authorized', 'AC-SCV-004 a Project Manager cannot void');
select pg_temp.act_as('16710000-0000-0000-0000-0000000000a6');
select throws_ok($$ select void_subcontract_bill(pg_temp.id('bill1'), 'mistyped') $$, '42501', 'not authorized', 'AC-SCV-004 an Executive cannot void');
select pg_temp.act_as('16710000-0000-0000-0000-0000000000a5');
select throws_ok($$ select void_subcontract_bill(pg_temp.id('bill1'), 'mistyped') $$, '42501', 'not authorized', 'AC-SCV-004 an Engineer cannot void');
select pg_temp.act_as('16710000-0000-0000-0000-0000000000a8');
select throws_ok($$ select void_subcontract_bill(pg_temp.id('bill1'), 'mistyped') $$, '42501',
  'your account is not an active member of this organisation, so it cannot write — an offboarded or suspended account is refused even while its session token is still valid',
  'AC-SCV-004 a disabled Finance member cannot void');
select pg_temp.act_as('16710000-0000-0000-0000-0000000000b1');
select throws_ok($$ select void_subcontract_bill(pg_temp.id('bill1'), 'mistyped') $$, 'P0002', 'invoice not found', 'AC-SCV-004 another organisation''s Finance cannot void');
select is(pg_temp.voided('bill1'), false, 'AC-SCV-004 the refused voids change nothing');

-- ── AC-SCV-007: the reason ─────────────────────────────────────────────────────────────────────────────────
select pg_temp.act_as('16710000-0000-0000-0000-0000000000a3');
select throws_ok($$ select void_subcontract_bill(pg_temp.id('bill1'), '') $$, '22023', 'a void needs a reason of 1 to 1000 characters', 'AC-SCV-007 an empty reason is refused');
select throws_ok($$ select void_subcontract_bill(pg_temp.id('bill1'), '   ') $$, '22023', 'a void needs a reason of 1 to 1000 characters', 'AC-SCV-007 a blank reason is refused');
select throws_ok($$ select void_subcontract_bill(pg_temp.id('bill1'), null) $$, '22023', 'a void needs a reason of 1 to 1000 characters', 'AC-SCV-007 a null reason is refused');
select throws_ok($$ select void_subcontract_bill(pg_temp.id('bill1'), repeat('x', 1001)) $$, '22023', 'a void needs a reason of 1 to 1000 characters', 'AC-SCV-007 a 1001-character reason is refused');

-- ── AC-SCV-001: Fin2 voids Fin1's bill ─────────────────────────────────────────────────────────────────────
select lives_ok($$ select void_subcontract_bill(pg_temp.id('bill1'), '  typed 100 instead of 10  ') $$, 'AC-SCV-001 Finance voids another author''s bill');
reset role; select pg_temp.as_super();
select results_eq($$ select voided_by, void_reason, erp_cancelled_at = voided_at from procurement_invoices where id = pg_temp.id('bill1') $$,
  $$ values ('16710000-0000-0000-0000-0000000000a3'::uuid, 'typed 100 instead of 10', true) $$,
  'AC-SCV-001 the void stamps who, the trimmed reason and the shared cancel tombstone');
select is((select count(*)::int from audit_events where action = 'procurement_invoice.void' and entity_id = pg_temp.id('bill1')
            and actor_id = '16710000-0000-0000-0000-0000000000a3' and detail->>'reason' = 'typed 100 instead of 10'
            and detail->>'basis' = 'standard' and detail->>'captured_by' = '16710000-0000-0000-0000-0000000000a2'), 1,
  'AC-SCV-001 one audit event records the voider, the author, the reason and the standard basis');
select is((select count(*)::int from procurement_invoice_lines where invoice_id = pg_temp.id('bill1')), 1,
  'AC-SCV-001 the voided bill and its lines stay (soft void)');

-- ── AC-SCV-002: headroom is freed in every read ────────────────────────────────────────────────────────────
set local role authenticated; select pg_temp.act_as('16710000-0000-0000-0000-0000000000a3');
select is(pg_temp.l1_payable(), 100::numeric, 'AC-SCV-002 the position shows L1 payable again');
select is((select billed from subcontract_po_position('16710000-0000-0000-0000-000000000101') where item_code = 'L1'), 0::numeric,
  'AC-SCV-002 the position no longer counts the voided bill as billed');
select is((select count(*)::int from subcontract_cap_exceptions('16710000-0000-0000-0000-0000000000f1')), 0,
  'AC-SCV-002 the voided bill is not a cap exception');
select throws_ok($$ select attribute_subcontract_bill_lines(pg_temp.id('bill1'), '[]'::jsonb) $$, '23514', 'this bill is cancelled',
  'AC-SCV-002 lines cannot be attributed to a voided bill');
select throws_ok($$ select set_procurement_invoice_efaktur(pg_temp.id('bill1'), null, null) $$, '23514',
  'cannot record e-Faktur facts on a cancelled vendor bill', 'AC-SCV-002 e-Faktur facts cannot be recorded on a voided bill');
select throws_ok($$ select void_subcontract_bill(pg_temp.id('bill1'), 'again') $$, '23514', 'this bill is already voided',
  'AC-SCV-007 a second void is refused');
select pg_temp.act_as('16710000-0000-0000-0000-0000000000a2');
select lives_ok($$ select set_config('scv.bill2', pg_temp.bill(10)::text, true) $$, 'AC-SCV-001 the corrected bill fits the freed headroom');
select is(pg_temp.l1_payable(), 90::numeric, 'AC-SCV-001 only the corrected bill counts against L1');

-- ── AC-SCV-006: a voided bill is never paid; the payment sum ignores it ────────────────────────────────────
select throws_ok($$ select create_payment('16710000-0000-0000-0000-0000000000f1', pg_temp.id('bill1'), null, 'Scheduled', current_date, 1000) $$,
  '23514', 'this bill is voided; it cannot be paid', 'AC-SCV-006 a payment naming a voided bill is refused');
select throws_ok($$ select create_payment('16710000-0000-0000-0000-0000000000f1', null, null, 'Scheduled', current_date, 1000000.01) $$,
  '23514', 'scheduled payments cannot exceed the billed gross amount', 'AC-SCV-002 the payment cap counts only the corrected bill''s gross');
select lives_ok($$ select create_payment('16710000-0000-0000-0000-0000000000f1', null, null, 'Scheduled', current_date, 1000000) $$,
  'AC-SCV-002 a payment up to the corrected bill''s gross is accepted');
select pg_temp.act_as('16710000-0000-0000-0000-0000000000a3');
select throws_ok($$ select void_subcontract_bill(pg_temp.id('bill2'), 'wrong again') $$, '23514',
  'payments on this purchase would exceed its remaining bills; cancel a payment first', 'AC-SCV-006 a void that would leave payments above the remaining bills is refused');
select pg_temp.act_as('16710000-0000-0000-0000-0000000000a2');
select lives_ok($$ select create_payment('16710000-0000-0000-0000-0000000000f1', pg_temp.id('bill2'), null, 'Scheduled', current_date, null) $$,
  'AC-SCV-006 setup: a payment names bill2');
select pg_temp.act_as('16710000-0000-0000-0000-0000000000a3');
select throws_ok($$ select void_subcontract_bill(pg_temp.id('bill2'), 'wrong again') $$, '23514',
  'this bill has a payment; cancel the payment first', 'AC-SCV-006 a bill with a live payment cannot be voided');
reset role; select pg_temp.as_super();
select is(pg_temp.voided('bill2'), false, 'AC-SCV-006 the refused voids change nothing');

-- ── AC-SCV-007: immutability, for every role ───────────────────────────────────────────────────────────────
select throws_ok($$ update procurement_invoices set void_reason = 'x' where id = pg_temp.id('bill1') $$, '42501',
  'a voided bill stays voided', 'AC-SCV-007 the reason of a voided bill cannot be changed');
select throws_ok($$ update procurement_invoices set erp_cancelled_at = null where id = pg_temp.id('bill1') $$, '42501',
  'a voided bill stays voided', 'AC-SCV-007 a voided bill cannot be revived by clearing its tombstone');
select throws_ok($$ update procurement_invoices set voided_at = null, voided_by = null, void_reason = null, erp_cancelled_at = null where id = pg_temp.id('bill1') $$, '42501',
  'a voided bill stays voided', 'AC-SCV-007 a void cannot be undone');
select throws_ok($$ update procurement_invoices set voided_at = now(), voided_by = '16710000-0000-0000-0000-0000000000a3', void_reason = 'x', erp_cancelled_at = now() where id = pg_temp.id('bill2') $$, '42501',
  'a bill is voided only through void_subcontract_bill', 'AC-SCV-007 a bill cannot be voided by a direct write');
select throws_ok($$ delete from procurement_invoice_lines where invoice_id = pg_temp.id('bill1') $$, '42501',
  'bill lines are immutable', 'AC-SCV-007 a voided bill''s lines cannot be deleted');
set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select throws_ok($$ update procurement_invoices set erp_cancelled_at = null where id = pg_temp.id('bill1') $$, '42501',
  'a voided bill stays voided', 'AC-SCV-007 the service role cannot revive a voided bill either');
select throws_ok($$ update procurement_invoices set void_reason = 'x' where id = pg_temp.id('bill2') $$, '42501',
  'a bill is voided only through void_subcontract_bill', 'AC-SCV-007 the service role cannot write void facts directly');
reset role; select pg_temp.as_super();

-- ── AC-SCV-005: the ERP boundary ───────────────────────────────────────────────────────────────────────────
-- bill3 (2 m3, no payment) is the void target; each case runs in its own savepoint.
set local role authenticated; select pg_temp.act_as('16710000-0000-0000-0000-0000000000a2');
select set_config('scv.bill3', pg_temp.bill(2)::text, true);
reset role; select pg_temp.as_super();
savepoint erp1;
update procurement_invoices set external_ref = 'EXT-SCV-1' where id = pg_temp.id('bill3');
set local role authenticated; select pg_temp.act_as('16710000-0000-0000-0000-0000000000a3');
select throws_ok($$ select void_subcontract_bill(pg_temp.id('bill3'), 'mistyped') $$, '42501',
  'this bill came from an ERP record; it cannot be voided in PMO', 'AC-SCV-005 a bill tied to an ERP record cannot be voided');
reset role; rollback to savepoint erp1;
savepoint erp2;
select pg_temp.as_super();
insert into external_org_bindings (org_id, external_tier, site_url, secret_ref, status)
  values ('16710000-0000-0000-0000-00000000000a', 'erpnext', 'https://erp.example.com', 'scv-test-ref', 'active');
set local role authenticated; select pg_temp.act_as('16710000-0000-0000-0000-0000000000a3');
select throws_ok($$ select void_subcontract_bill(pg_temp.id('bill3'), 'mistyped') $$, '42501',
  'this organisation records bills in its ERP; cancel the bill there', 'AC-SCV-005 an organisation with an ERP cannot void in PMO');
reset role; rollback to savepoint erp2;
-- A plain (non-subcontract) bill, and a subcontract bill with no recorded author (written by the system).
select pg_temp.as_super();
insert into procurement_invoices (id, org_id, procurement_id, vi_number, invoice_date, status, amount, currency, tax_treatment, tax_amount)
values ('16710000-0000-0000-0000-000000000401', '16710000-0000-0000-0000-00000000000a', '16710000-0000-0000-0000-0000000000f2', 'VI-SCV-PLAIN',
        current_date, 'Received', 5000, 'IDR', 'exclusive', 0);
select set_config('pmo.subcontract_capture', 'on', true);
insert into procurement_invoices (id, org_id, procurement_id, po_id, vi_number, invoice_date, status, amount, currency, tax_treatment, tax_amount)
values ('16710000-0000-0000-0000-000000000402', '16710000-0000-0000-0000-00000000000a', '16710000-0000-0000-0000-0000000000f1',
        '16710000-0000-0000-0000-000000000101', 'VI-SCV-SYS', current_date, 'Received', 100000, 'IDR', 'exclusive', 0);
insert into procurement_invoice_lines (invoice_id, boq_item_id, quantity, rate)
values ('16710000-0000-0000-0000-000000000402', '16710000-0000-0000-0000-0000000000e1', 1, 100000);
select set_config('pmo.subcontract_capture', '', true);
set local role authenticated; select pg_temp.act_as('16710000-0000-0000-0000-0000000000a3');
select throws_ok($$ select void_subcontract_bill('16710000-0000-0000-0000-000000000401', 'mistyped') $$, 'SC002',
  'only a subcontract bill with BoQ lines can be voided here', 'AC-SCV-005 a non-subcontract bill cannot be voided here');
select throws_ok($$ select void_subcontract_bill('16710000-0000-0000-0000-000000000402', 'mistyped') $$, '42501',
  'the author of this bill is not recorded; it cannot be voided', 'AC-SCV-003 a bill with no recorded author is refused');

-- ── AC-SCV-007: a 1000-character reason is accepted; the voider's profile can be removed ────────────────────
select pg_temp.act_as('16710000-0000-0000-0000-0000000000a9');
select lives_ok($$ select void_subcontract_bill(pg_temp.id('bill3'), repeat('x', 1000)) $$, 'AC-SCV-007 a 1000-character reason is accepted');
select is(pg_temp.l1_payable(), 89::numeric, 'AC-SCV-002 voiding bill3 returns its 2 m3 (system bill 1 m3 still counts)');
reset role; select pg_temp.as_super();
select lives_ok($$ delete from profiles where id = '16710000-0000-0000-0000-0000000000a9' $$, 'AC-SCV-007 the voider''s profile can be removed');
select results_eq($$ select voided_by is null, voided_at is not null, length(void_reason) from procurement_invoices where id = pg_temp.id('bill3') $$,
  $$ values (true, true, 1000) $$, 'AC-SCV-007 removing the voider keeps the void and clears only who');

-- ── AC-SCV-003: the sole member of an organisation voids their own bill ────────────────────────────────────
set local role authenticated; select pg_temp.act_as('16710000-0000-0000-0000-0000000000c1');
select set_config('scv.solo', (capture_subcontract_vendor_invoice(
  p_procurement_id => '16710000-0000-0000-0000-0000000000f9', p_status => 'Received', p_invoice_date => current_date,
  p_amount => 50000, p_tax_treatment => 'exclusive', p_tax_amount => 0,
  p_lines => '[{"boq_item_id":"16710000-0000-0000-0000-0000000000e9","quantity":5,"rate":10000}]'::jsonb)).id::text, true);
select is((select total_value from procurements where id = '16710000-0000-0000-0000-0000000000f9'), 50000::numeric,
  'AC-SCV-002 setup: the solo purchase''s recorded total follows its bill');
select lives_ok($$ select void_subcontract_bill(pg_temp.id('solo'), 'duplicate entry') $$, 'AC-SCV-003 the sole member voids their own bill');
select is((select total_value from procurements where id = '16710000-0000-0000-0000-0000000000f9'), 0::numeric,
  'AC-SCV-002 the recorded total drops when the bill is voided');
select is((select status::text from procurements where id = '16710000-0000-0000-0000-0000000000f9'), 'Vendor Invoiced',
  'AC-SCV-001 the purchase stays Vendor Invoiced after the void');
reset role; select pg_temp.as_super();
select is((select detail->>'basis' from audit_events where action = 'procurement_invoice.void' and entity_id = pg_temp.id('solo')), 'sole_operator',
  'AC-SCV-003 the sole member''s void is audited with the sole_operator basis');

select * from finish();
rollback;

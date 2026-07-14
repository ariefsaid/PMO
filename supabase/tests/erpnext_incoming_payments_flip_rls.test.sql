-- erpnext_incoming_payments_flip_rls.test.sql (Slice 0, task 0.3) — OWNS AC-SAR-061 PE-receive side.
-- Models erpnext_money_flip_rls.test.sql exactly. Namespaced UUIDs (005a-prefix, valid hex).
-- begin/rollback + finish() — NOT finish_testing().
begin;
select plan(18);

-- Org A (flipped revenue) + Org B (not flipped)
insert into organizations (id, name) values
  ('005a0000-0000-0000-0000-000000000001','AC-SAR PE-receive Org A (flipped)'),
  ('005a0000-0000-0000-0000-000000000002','AC-SAR PE-receive Org B (not flipped)');
insert into auth.users (id, email) values
  ('005a0000-0000-0000-0000-0000000000a1','pe-a@example.com'),
  ('005a0000-0000-0000-0000-0000000000b1','pe-b@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('005a0000-0000-0000-0000-0000000000a1','005a0000-0000-0000-0000-000000000001','A Admin','pe-a@example.com','Admin','active'),
  ('005a0000-0000-0000-0000-0000000000b1','005a0000-0000-0000-0000-000000000002','B Admin','pe-b@example.com','Admin','active');

-- Seed: customer + SI (parent) + incoming_payment in Org A (owner insert pre-flip)
insert into companies (id, org_id, name, type) values
  ('005a0000-0000-0000-0000-0000000000f1','005a0000-0000-0000-0000-000000000001','PE Customer','Client');
insert into sales_invoices (id, org_id, customer_id, si_number, invoice_date, amount, erp_outstanding_amount, status, erp_docstatus, erp_modified, erp_amended_from, erp_cancelled_at, created_at)
values ('005a0000-0000-0000-0000-0000000000e1','005a0000-0000-0000-0000-000000000001',
  '005a0000-0000-0000-0000-0000000000f1','SI-PE-001','2026-07-14',500.00,500.00,'Unpaid',0,'2026-07-14 09:00:00',null,null,'2026-07-14 09:00:00');
insert into incoming_payments (id, org_id, customer_id, sales_invoice_id, ip_number, reference_number,
  date, amount, status, erp_docstatus, erp_modified, erp_amended_from, erp_cancelled_at, created_at)
values ('005a0000-0000-0000-0000-0000000000d1','005a0000-0000-0000-0000-000000000001',
  '005a0000-0000-0000-0000-0000000000f1','005a0000-0000-0000-0000-0000000000e1',
  'IP-001','REF-IP-001','2026-07-14',500.00,'Scheduled',0,'2026-07-14 09:00:00',null,null,'2026-07-14 09:00:00');

-- Flip Org A to revenue→erpnext (AFTER seed so fixture models pre-flip state)
insert into external_domain_ownership (org_id, external_tier, domain) values
  ('005a0000-0000-0000-0000-000000000001','erpnext','revenue');

-- ── AC-SAR-061 PE-receive: user-JWT native write DENIED while flipped ───────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"005a0000-0000-0000-0000-0000000000a1","role":"authenticated"}';

select throws_ok(
  $$ update incoming_payments set amount = 600 where id = '005a0000-0000-0000-0000-0000000000d1' $$,
  '42501', null,
  'AC-SAR-061 PE-receive: user-JWT native-field UPDATE (amount) denied while revenue is externally-owned');

select throws_ok(
  $$ insert into incoming_payments (org_id, customer_id, ip_number, reference_number, date, amount, status)
       values ('005a0000-0000-0000-0000-000000000001','005a0000-0000-0000-0000-0000000000f1','IP-002','REF-002','2026-07-15',250.00,'Scheduled') $$,
  '42501', null,
  'AC-SAR-061 PE-receive: user-JWT raw INSERT denied while flipped');

-- reference_number (anchor carrier) is machine-only — user UPDATE denied while flipped
select throws_ok(
  $$ update incoming_payments set reference_number = 'HACKED' where id = '005a0000-0000-0000-0000-0000000000d1' $$,
  '42501', null,
  'AC-SAR-061 PE-receive: user-JWT UPDATE of reference_number (machine-only anchor) denied while flipped');

-- sales_invoice_id FK is machine-only — user UPDATE denied while flipped
select throws_ok(
  $$ update incoming_payments set sales_invoice_id = '00000000-0000-0000-0000-000000000000' where id = '005a0000-0000-0000-0000-0000000000d1' $$,
  '42501', null,
  'AC-SAR-061 PE-receive: user-JWT UPDATE of sales_invoice_id (machine-only FK) denied while flipped');

-- service-role UPDATE of native + ALL erp_* mirror columns succeeds
reset role;
set local request.jwt.claims = '{"role":"service_role"}';
select lives_ok(
  $$ update incoming_payments set amount = 750, status = 'Paid', erp_docstatus = 1, erp_modified = '2026-07-14 10:00:00',
       erp_amended_from = 'IP-001-amended', erp_cancelled_at = null where id = '005a0000-0000-0000-0000-0000000000d1' $$,
  'AC-SAR-061 PE-receive: service-role UPDATE of native + ALL erp_* mirror cols succeeds');
select is(
  (select amount from incoming_payments where id = '005a0000-0000-0000-0000-0000000000d1'), 750::numeric,
  'AC-SAR-061 PE-receive: amount preserved by service-role mirror write');
select is(
  (select sales_invoice_id from incoming_payments where id = '005a0000-0000-0000-0000-0000000000d1'),
  '005a0000-0000-0000-0000-0000000000e1'::uuid,
  'AC-SAR-061 PE-receive: sales_invoice_id FK + AR same-case invariant preserved under flip (FR-SAR-161)');

-- confirms the four day-one erp_* cols exist
select is(
  (select count(*)::int from information_schema.columns
    where table_name = 'incoming_payments' and column_name in
      ('erp_docstatus','erp_modified','erp_amended_from','erp_cancelled_at')),
  4,
  'AC-SAR-061 PE-receive: day-one erp_* feed cols (docstatus,modified,amended_from,cancelled_at) all present');

-- ── AC-SAR-003 cross-domain: org isolation ──────────────────────────────────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"005a0000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select is((select count(*)::int from incoming_payments where id = '005a0000-0000-0000-0000-0000000000d1'), 1,
  'AC-SAR-003 PE-receive: org-A member reads own flipped row');

set local request.jwt.claims = '{"sub":"005a0000-0000-0000-0000-0000000000b1","role":"authenticated"}';
select is((select count(*)::int from incoming_payments where id = '005a0000-0000-0000-0000-0000000000d1'), 0,
  'AC-SAR-003 PE-receive: org-B member reads 0 rows of org-A flipped row (org isolation)');

-- revenue flip does NOT leak to procurement/companies domains
select ok(not public.domain_externally_owned('005a0000-0000-0000-0000-000000000002'::uuid, 'revenue'),
  'AC-SAR-003 PE-receive cross-domain: org-B NOT flipped on revenue');
select ok(not public.domain_externally_owned('005a0000-0000-0000-0000-000000000001'::uuid, 'procurement'),
  'AC-SAR-003 PE-receive cross-domain: org-A flipped revenue does NOT auto-flip procurement');

select finish();
rollback;
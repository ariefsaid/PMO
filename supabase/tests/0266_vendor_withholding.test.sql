-- 0266_vendor_withholding.test.sql — 0266_vendor_invoice_withholding.sql (#876, ADR-0082).
-- Owns AC-VWH-008 (shape + bounds) and AC-VWH-009 (not client-writable, native = 0, mirror guard).
begin;
select plan(19);

insert into organizations (id, name, default_currency) values
  ('08760000-0000-0000-0000-000000000001','#876 VWH Org','IDR');
insert into auth.users (id, email) values
  ('08760000-0000-0000-0000-0000000000a1','vwh-fin@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('08760000-0000-0000-0000-0000000000a1','08760000-0000-0000-0000-000000000001',
   'VWH Finance','vwh-fin@example.com','Finance','active');
insert into companies (id, org_id, name, type) values
  ('08760000-0000-0000-0000-0000000000c1','08760000-0000-0000-0000-000000000001','#876 Vendor','Vendor');
insert into procurements (id, org_id, title, status, requested_by_id, vendor_id) values
  ('08760000-0000-0000-0000-0000000000d1','08760000-0000-0000-0000-000000000001','#876 case','Vendor Quoted',
   '08760000-0000-0000-0000-0000000000a1','08760000-0000-0000-0000-0000000000c1');

-- §A — shape (DD-VWH-1, DD-VWH-7). The default is proven by behaviour, not by how the catalog prints it.
select col_type_is('public','procurement_invoices','withheld_amount','numeric(14,2)',
  'AC-VWH-008 withheld_amount is numeric(14,2)');
select col_not_null('public','procurement_invoices','withheld_amount',
  'AC-VWH-008 withheld_amount is NOT NULL — 0 means nothing withheld, never unknown');
insert into procurement_invoices (id, org_id, procurement_id, status, invoice_date, amount, tax_treatment, tax_amount)
values ('08760000-0000-0000-0000-00000000e000','08760000-0000-0000-0000-000000000001',
        '08760000-0000-0000-0000-0000000000d1','Received','2026-10-07', 500, 'exclusive', 0);
select is((select withheld_amount from procurement_invoices where id='08760000-0000-0000-0000-00000000e000'),
  0.00::numeric, 'AC-VWH-008 a bill that does not state withheld_amount records 0 (PMO-native bills withhold nothing, DD-VWH-7)');

-- §B — round-trip and bounds
insert into procurement_invoices (id, org_id, procurement_id, status, invoice_date, amount, tax_treatment, tax_amount, withheld_amount)
values ('08760000-0000-0000-0000-00000000e001','08760000-0000-0000-0000-000000000001',
        '08760000-0000-0000-0000-0000000000d1','Received','2026-10-07', 1110000, 'inclusive', 110000, 20000);
select is((select withheld_amount from procurement_invoices where id='08760000-0000-0000-0000-00000000e001'),
  20000.00::numeric, 'AC-VWH-008 a withheld amount round-trips exactly');
select is((select amount - withheld_amount from procurement_invoices where id='08760000-0000-0000-0000-00000000e001'),
  1090000.00::numeric, 'AC-VWH-008 gross minus withheld is the net payable');
select throws_ok($$ update procurement_invoices set withheld_amount = 'NaN'::numeric
                    where id='08760000-0000-0000-0000-00000000e001' $$, '23514',
  'new row for relation "procurement_invoices" violates check constraint "procurement_invoices_withheld_amount_bounds"',
  'AC-VWH-008 NaN withholding is refused (the upper bound is what rejects it)');
select throws_ok($$ update procurement_invoices set withheld_amount = -1
                    where id='08760000-0000-0000-0000-00000000e001' $$, '23514',
  'new row for relation "procurement_invoices" violates check constraint "procurement_invoices_withheld_amount_bounds"',
  'AC-VWH-008 a negative withholding on a positive bill is refused');
select throws_ok($$ update procurement_invoices set withheld_amount = 1110000.01
                    where id='08760000-0000-0000-0000-00000000e001' $$, '23514',
  'new row for relation "procurement_invoices" violates check constraint "procurement_invoices_withheld_amount_bounds"',
  'AC-VWH-008 withholding above the gross bill is refused');
select throws_ok($$ insert into procurement_invoices (org_id, procurement_id, status, invoice_date, amount, tax_treatment, tax_amount, withheld_amount)
                    values ('08760000-0000-0000-0000-000000000001','08760000-0000-0000-0000-0000000000d1',
                            'Received','2026-10-07', null, 'inclusive', 0, 5) $$, '23514',
  'new row for relation "procurement_invoices" violates check constraint "procurement_invoices_withheld_amount_bounds"',
  'AC-VWH-008 withholding on a bill with no amount is refused');
select lives_ok($$ insert into procurement_invoices (org_id, procurement_id, status, invoice_date, amount, tax_treatment, tax_amount, withheld_amount)
                   values ('08760000-0000-0000-0000-000000000001','08760000-0000-0000-0000-0000000000d1',
                           'Received','2026-10-07', -1110000, 'inclusive', -110000, -20000) $$,
  'AC-VWH-008 a return (debit note) carries a negative withholding with its negative amount');
select throws_ok($$ insert into procurement_invoices (org_id, procurement_id, status, invoice_date, amount, tax_treatment, tax_amount, withheld_amount)
                    values ('08760000-0000-0000-0000-000000000001','08760000-0000-0000-0000-0000000000d1',
                            'Received','2026-10-07', -1110000, 'inclusive', -110000, 20000) $$, '23514',
  'new row for relation "procurement_invoices" violates check constraint "procurement_invoices_withheld_amount_bounds"',
  'AC-VWH-008 a positive withholding on a negative bill is refused (sign parity)');

-- §C — not client-writable; readable exactly where amount is (FR-VWH-008)
select ok(not has_column_privilege('authenticated','public.procurement_invoices','withheld_amount','INSERT'),
  'AC-VWH-009 authenticated cannot INSERT withheld_amount');
select ok(not has_column_privilege('authenticated','public.procurement_invoices','withheld_amount','UPDATE'),
  'AC-VWH-009 authenticated cannot UPDATE withheld_amount');
select ok(not has_column_privilege('anon','public.procurement_invoices','withheld_amount','INSERT')
          and not has_column_privilege('anon','public.procurement_invoices','withheld_amount','UPDATE'),
  'AC-VWH-009 anon can neither INSERT nor UPDATE withheld_amount');
select is(has_column_privilege('authenticated','public.procurement_invoices','withheld_amount','SELECT'),
          has_column_privilege('authenticated','public.procurement_invoices','amount','SELECT'),
  'AC-VWH-009 withheld_amount is readable exactly where amount is');

-- §D — a PMO-native bill records zero (procurement still PMO-owned here)
set local role authenticated;
set local request.jwt.claims = '{"sub":"08760000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select lives_ok($$ select create_procurement_invoice('08760000-0000-0000-0000-0000000000d1'::uuid,
                     'Received'::procurement_invoice_status, '2026-10-07'::date, 'VI-876-NATIVE', 1000::numeric,
                     p_tax_treatment => 'exclusive', p_tax_amount => 110) $$,
  'AC-VWH-009 CONTROL a PMO-native vendor invoice records through the RPC');
reset role;
select is((select withheld_amount from procurement_invoices where reference_number='VI-876-NATIVE'),
  0.00::numeric, 'AC-VWH-009 a PMO-native vendor invoice records zero withholding');

-- §E — the mirror guard pins withheld_amount while procurement is externally owned. Run as the TABLE OWNER with an
-- authenticated JWT claim (the 0196 §E construction): a role-switched UPDATE would 42501 on privileges instead, for
-- the wrong reason.
insert into external_domain_ownership (org_id, external_tier, domain) values
  ('08760000-0000-0000-0000-000000000001','erpnext','procurement');
set local request.jwt.claims = '{"sub":"08760000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select throws_ok($$ update procurement_invoices set withheld_amount = 0
                    where id='08760000-0000-0000-0000-00000000e001' $$, '42501',
  'procurement_invoices native fields are read-only while procurement is externally-owned',
  'AC-VWH-009 the mirror guard pins withheld_amount while procurement is externally owned');
set local request.jwt.claims = '{"role":"service_role"}';
select lives_ok($$ update procurement_invoices set withheld_amount = 10000
                   where id='08760000-0000-0000-0000-00000000e001' $$,
  'AC-VWH-009 CONTROL the service-role mirror writer still writes withheld_amount');

select * from finish();
rollback;

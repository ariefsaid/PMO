-- 0272_vendor_tax_accounts_native_withholding.test.sql — 0272 §4–§6 (#876 slice 2; DD-VWH-10, DD-VWH-12).
-- Owns AC-VWH-023 (org vendor-bill tax accounts: shape, Admin-only, audited, grants) and AC-VWH-024 (a standalone
-- vendor invoice records a stated withholding AND its PPh type through both create functions — OQ-VWH-6, Director
-- 2026-10-07: the type is stored on every bill that withholds; the create audit records them).
begin;
select plan(34);

insert into organizations (id, name, default_currency) values
  ('08760000-0000-0000-0000-000000000301','#876 S2B Org','IDR');
insert into auth.users (id, email) values
  ('08760000-0000-0000-0000-0000000003a1','s2b-admin@example.com'),
  ('08760000-0000-0000-0000-0000000003a2','s2b-fin@example.com'),
  ('08760000-0000-0000-0000-0000000003a3','s2b-req@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('08760000-0000-0000-0000-0000000003a1','08760000-0000-0000-0000-000000000301','S2B Admin','s2b-admin@example.com','Admin','active'),
  ('08760000-0000-0000-0000-0000000003a2','08760000-0000-0000-0000-000000000301','S2B Finance','s2b-fin@example.com','Finance','active'),
  ('08760000-0000-0000-0000-0000000003a3','08760000-0000-0000-0000-000000000301','S2B Requester','s2b-req@example.com','Engineer','active');
insert into companies (id, org_id, name, type) values
  ('08760000-0000-0000-0000-0000000003c1','08760000-0000-0000-0000-000000000301','#876 S2B Vendor','Vendor');
insert into procurements (id, org_id, title, status, requested_by_id, vendor_id) values
  ('08760000-0000-0000-0000-0000000003d1','08760000-0000-0000-0000-000000000301','#876 S2B quoted','Vendor Quoted',
   '08760000-0000-0000-0000-0000000003a3','08760000-0000-0000-0000-0000000003c1'),
  ('08760000-0000-0000-0000-0000000003d2','08760000-0000-0000-0000-000000000301','#876 S2B received','Received',
   '08760000-0000-0000-0000-0000000003a3','08760000-0000-0000-0000-0000000003c1');

-- §A org vendor-bill tax accounts (AC-VWH-023)
select has_column('public','organizations','input_vat_account','AC-VWH-023 organizations.input_vat_account exists');
select has_column('public','organizations','pph23_payable_account','AC-VWH-023 organizations.pph23_payable_account exists');
select has_column('public','organizations','pph4_2_payable_account','AC-VWH-023 organizations.pph4_2_payable_account exists');
select throws_ok($$ update organizations set input_vat_account = '   ' where id = '08760000-0000-0000-0000-000000000301' $$,
  '23514', null, 'AC-VWH-023 a blank account name is refused');
select throws_ok($$ update organizations set pph23_payable_account = repeat('x', 141) where id = '08760000-0000-0000-0000-000000000301' $$,
  '23514', null, 'AC-VWH-023 an account name longer than the ERPNext link limit is refused');
select ok(has_column_privilege('authenticated','public.organizations','input_vat_account','UPDATE')
      and has_column_privilege('authenticated','public.organizations','pph23_payable_account','UPDATE')
      and has_column_privilege('authenticated','public.organizations','pph4_2_payable_account','UPDATE'),
  'AC-VWH-023 authenticated holds the three column UPDATE grants (the Admin-only policy decides the row)');
select ok(not (has_column_privilege('anon','public.organizations','input_vat_account','UPDATE')
            or has_column_privilege('anon','public.organizations','pph23_payable_account','UPDATE')
            or has_column_privilege('anon','public.organizations','pph4_2_payable_account','UPDATE')
            or has_column_privilege('authenticated','public.organizations','input_vat_account','INSERT')
            or has_column_privilege('anon','public.organizations','input_vat_account','INSERT')),
  'AC-VWH-023 no other client write privilege on the three columns');

set local request.jwt.claims = '{"sub":"08760000-0000-0000-0000-0000000003a1","role":"authenticated"}';
set local role authenticated;
select lives_ok($$ update organizations set input_vat_account = 'Input VAT - S2', pph23_payable_account = 'PPh 23 Payable - S2'
                   where id = '08760000-0000-0000-0000-000000000301' $$,
  'AC-VWH-023 an Admin sets the vendor-bill tax accounts');
reset role;
select is((select input_vat_account || '|' || pph23_payable_account from organizations where id = '08760000-0000-0000-0000-000000000301'),
  'Input VAT - S2|PPh 23 Payable - S2', 'AC-VWH-023 the Admin''s accounts are stored');
select is((select count(*)::int from audit_events where action = 'org.vendor_tax_accounts.change'
            and org_id = '08760000-0000-0000-0000-000000000301' and actor_id = '08760000-0000-0000-0000-0000000003a1'),
  1, 'AC-VWH-023 the change is audited with its actor');
select is((select detail->'to'->>'pph23' from audit_events where action = 'org.vendor_tax_accounts.change'
            and org_id = '08760000-0000-0000-0000-000000000301'),
  'PPh 23 Payable - S2', 'AC-VWH-023 the audit states the new value');

set local request.jwt.claims = '{"sub":"08760000-0000-0000-0000-0000000003a2","role":"authenticated"}';
set local role authenticated;
select lives_ok($$ update organizations set pph23_payable_account = 'Hijack - S2' where id = '08760000-0000-0000-0000-000000000301' $$,
  'AC-VWH-023 CONTROL a Finance UPDATE is not an error — it reaches no row');
reset role;
select is((select pph23_payable_account from organizations where id = '08760000-0000-0000-0000-000000000301'),
  'PPh 23 Payable - S2', 'AC-VWH-023 a Finance user cannot change the accounts (Admin-only policy)');
select is((select count(*)::int from audit_events where action = 'org.vendor_tax_accounts.change'
            and org_id = '08760000-0000-0000-0000-000000000301'),
  1, 'AC-VWH-023 and nothing more was audited');

-- §B standalone withholding (AC-VWH-024), procurement PMO-owned
set local request.jwt.claims = '{"sub":"08760000-0000-0000-0000-0000000003a2","role":"authenticated"}';
set local role authenticated;
select lives_ok($$ select create_procurement_invoice('08760000-0000-0000-0000-0000000003d1'::uuid,
                     'Received'::procurement_invoice_status, '2026-10-07'::date, 'VI-S2-WH', 1000000::numeric,
                     p_tax_treatment => 'exclusive', p_tax_amount => 110000, p_withheld_amount => 20000,
                     p_withheld_pph_type => 'pph23') $$,
  'AC-VWH-024 Finance records a standalone bill with PPh 23 withheld');
select lives_ok($$ select create_procurement_invoice('08760000-0000-0000-0000-0000000003d1'::uuid,
                     'Received'::procurement_invoice_status, '2026-10-07'::date, 'VI-S2-NONE', 500000::numeric,
                     p_tax_treatment => 'exclusive', p_tax_amount => 55000) $$,
  'AC-VWH-024 CONTROL a bill that states no withholding still records');
select throws_ok($$ select create_procurement_invoice('08760000-0000-0000-0000-0000000003d1'::uuid,
                      'Received'::procurement_invoice_status, '2026-10-07'::date, 'VI-S2-NOAMT', null::numeric,
                      p_tax_treatment => 'exclusive', p_tax_amount => 0, p_withheld_amount => 5, p_withheld_pph_type => 'pph23') $$,
  '23514', null, 'AC-VWH-024 a withholding on a bill with no amount is refused');
select throws_ok($$ select create_procurement_invoice('08760000-0000-0000-0000-0000000003d1'::uuid,
                      'Received'::procurement_invoice_status, '2026-10-07'::date, 'VI-S2-NEG', 1000::numeric,
                      p_tax_treatment => 'exclusive', p_tax_amount => 0, p_withheld_amount => -1, p_withheld_pph_type => 'pph23') $$,
  '23514', null, 'AC-VWH-024 a negative withholding on a positive bill is refused');
select throws_ok($$ select create_procurement_invoice('08760000-0000-0000-0000-0000000003d1'::uuid,
                      'Received'::procurement_invoice_status, '2026-10-07'::date, 'VI-S2-BIG', 1000::numeric,
                      p_tax_treatment => 'exclusive', p_tax_amount => 0, p_withheld_amount => 1000.01, p_withheld_pph_type => 'pph23') $$,
  '23514', null, 'AC-VWH-024 a withholding above the bill amount is refused');
select lives_ok($$ select capture_vendor_invoice('08760000-0000-0000-0000-0000000003d2'::uuid,
                     'Received'::procurement_invoice_status, '2026-10-07'::date, 'VI-S2-CAP', 2000000::numeric, null,
                     p_tax_treatment => 'exclusive', p_tax_amount => 220000, p_withheld_amount => 40000,
                     p_withheld_pph_type => 'pph4_2') $$,
  'AC-VWH-024 Mark Vendor Invoiced (the atomic capture) records PPh 4(2) withheld');
select throws_ok($$ select create_procurement_invoice('08760000-0000-0000-0000-0000000003d1'::uuid,
                      'Received'::procurement_invoice_status, '2026-10-07'::date, 'VI-S2-NOTYPE', 1000::numeric,
                      p_tax_treatment => 'exclusive', p_tax_amount => 0, p_withheld_amount => 20) $$,
  'P0001', 'a vendor invoice that withholds tax must state the withholding type: pph23 or pph4_2',
  'AC-VWH-024 (OQ-VWH-6) a withholding without its PPh type is refused');
select throws_ok($$ select create_procurement_invoice('08760000-0000-0000-0000-0000000003d1'::uuid,
                      'Received'::procurement_invoice_status, '2026-10-07'::date, 'VI-S2-PPH21', 1000::numeric,
                      p_tax_treatment => 'exclusive', p_tax_amount => 0, p_withheld_amount => 20, p_withheld_pph_type => 'pph21') $$,
  'P0001', 'a vendor invoice that withholds tax must state the withholding type: pph23 or pph4_2',
  'AC-VWH-024 (OQ-VWH-6) an unknown PPh type is refused');
select lives_ok($$ select create_procurement_invoice('08760000-0000-0000-0000-0000000003d1'::uuid,
                     'Received'::procurement_invoice_status, '2026-10-07'::date, 'VI-S2-TYPEONLY', 1000::numeric,
                     p_tax_treatment => 'exclusive', p_tax_amount => 0, p_withheld_amount => 0, p_withheld_pph_type => 'pph23') $$,
  'AC-VWH-024 (OQ-VWH-6) CONTROL a type with nothing withheld records (the type is not kept)');
reset role;
select is((select withheld_amount from procurement_invoices where reference_number = 'VI-S2-WH'),
  20000.00::numeric, 'AC-VWH-024 the stated withholding is stored on the bill');
select is((select withheld_amount from procurement_invoices where reference_number = 'VI-S2-NONE'),
  0.00::numeric, 'AC-VWH-024 a bill that states none records 0');
select is((select withheld_amount from procurement_invoices where reference_number = 'VI-S2-CAP'),
  40000.00::numeric, 'AC-VWH-024 the capture path forwards the withholding');
select is((select (detail->>'withheld_amount') || '|' || (detail->>'tax_amount') || '|' || (detail->>'withheld_pph_type')
            from audit_events
            where action = 'procurement_invoice.create'
              and entity_id = (select id from procurement_invoices where reference_number = 'VI-S2-WH')),
  '20000.00|110000.00|pph23', 'AC-VWH-024 the create audit records the VAT, the tax withheld and its type');

-- §C the PPh type on the bill (OQ-VWH-6): stored with every withholding, null without one, never client-writable.
select has_column('public','procurement_invoices','withheld_pph_type','AC-VWH-024 procurement_invoices.withheld_pph_type exists');
select is((select withheld_pph_type from procurement_invoices where reference_number = 'VI-S2-WH'),
  'pph23', 'AC-VWH-024 (OQ-VWH-6) the PPh 23 type is stored on the standalone bill');
select is((select withheld_pph_type from procurement_invoices where reference_number = 'VI-S2-CAP'),
  'pph4_2', 'AC-VWH-024 (OQ-VWH-6) the capture path stores the PPh 4(2) type');
select is((select count(*)::int from procurement_invoices
            where reference_number in ('VI-S2-NONE','VI-S2-TYPEONLY') and withheld_pph_type is null),
  2, 'AC-VWH-024 (OQ-VWH-6) a bill that withholds nothing stores no type');
select throws_ok($$ update procurement_invoices set withheld_pph_type = 'pph21' where reference_number = 'VI-S2-WH' $$,
  '23514', null, 'AC-VWH-024 (OQ-VWH-6) the column refuses an unknown type');
select ok(not (has_column_privilege('authenticated','public.procurement_invoices','withheld_pph_type','INSERT')
            or has_column_privilege('authenticated','public.procurement_invoices','withheld_pph_type','UPDATE')
            or has_column_privilege('anon','public.procurement_invoices','withheld_pph_type','INSERT')
            or has_column_privilege('anon','public.procurement_invoices','withheld_pph_type','UPDATE')),
  'AC-VWH-024 (OQ-VWH-6) withheld_pph_type is not client-writable');
-- The mirror guard pins it while procurement is externally owned (table owner + authenticated claim, the 0196 §E
-- construction; a role-switched UPDATE would 42501 on privileges instead, for the wrong reason).
insert into external_domain_ownership (org_id, external_tier, domain) values
  ('08760000-0000-0000-0000-000000000301','erpnext','procurement');
set local request.jwt.claims = '{"sub":"08760000-0000-0000-0000-0000000003a2","role":"authenticated"}';
select throws_ok($$ update procurement_invoices set withheld_pph_type = 'pph4_2' where reference_number = 'VI-S2-WH' $$,
  '42501', 'procurement_invoices native fields are read-only while procurement is externally-owned',
  'AC-VWH-024 (OQ-VWH-6) the mirror guard pins withheld_pph_type while procurement is externally owned');

select * from finish();
rollback;

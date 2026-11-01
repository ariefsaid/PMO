-- #1513 S3: subcontract bill lines, the cap and the position read
-- (AC-SCA-001/004/008/009, FR-SCA-020..024, NFR-SCA-001/003/004/005, PQ-4, PQ-12).
-- Fixture F1 + F2 + F3 of docs/plans/2026-11-01-subcontract-acceptance.md, plus S3 extras.
begin;
create extension if not exists pgtap;
select plan(53);

-- F1: org A (multi-member), org B (other tenant), org S (sole member). Inserted as superuser, before `set local role`.
insert into organizations (id, name, default_currency) values
  ('15130000-0000-0000-0000-00000000000a', 'SCA Org',       'IDR'),
  ('15130000-0000-0000-0000-00000000000b', 'SCA Other Org', 'IDR'),
  ('15130000-0000-0000-0000-00000000000c', 'SCA Solo Org',  'IDR');
insert into auth.users (id, email) values
  ('15130000-0000-0000-0000-0000000000a1', 'sca-admin@example.com'),
  ('15130000-0000-0000-0000-0000000000a2', 'sca-fin1@example.com'),
  ('15130000-0000-0000-0000-0000000000a3', 'sca-fin2@example.com'),
  ('15130000-0000-0000-0000-0000000000a4', 'sca-pm@example.com'),
  ('15130000-0000-0000-0000-0000000000a5', 'sca-eng@example.com'),
  ('15130000-0000-0000-0000-0000000000a6', 'sca-exec@example.com'),
  ('15130000-0000-0000-0000-0000000000a7', 'sca-pm-off@example.com'),
  ('15130000-0000-0000-0000-0000000000a8', 'sca-fin-off@example.com'),
  ('15130000-0000-0000-0000-0000000000b1', 'sca-xorg@example.com'),
  ('15130000-0000-0000-0000-0000000000c1', 'sca-solo@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('15130000-0000-0000-0000-0000000000a1', '15130000-0000-0000-0000-00000000000a', 'SCA Admin', 'sca-admin@example.com', 'Admin', 'active'),
  ('15130000-0000-0000-0000-0000000000a2', '15130000-0000-0000-0000-00000000000a', 'SCA Fin1',  'sca-fin1@example.com',  'Finance', 'active'),
  ('15130000-0000-0000-0000-0000000000a3', '15130000-0000-0000-0000-00000000000a', 'SCA Fin2',  'sca-fin2@example.com',  'Finance', 'active'),
  ('15130000-0000-0000-0000-0000000000a4', '15130000-0000-0000-0000-00000000000a', 'SCA PM',    'sca-pm@example.com',    'Project Manager', 'active'),
  ('15130000-0000-0000-0000-0000000000a5', '15130000-0000-0000-0000-00000000000a', 'SCA Eng',   'sca-eng@example.com',   'Engineer', 'active'),
  ('15130000-0000-0000-0000-0000000000a6', '15130000-0000-0000-0000-00000000000a', 'SCA Exec',  'sca-exec@example.com',  'Executive', 'active'),
  ('15130000-0000-0000-0000-0000000000a7', '15130000-0000-0000-0000-00000000000a', 'SCA PM Off', 'sca-pm-off@example.com', 'Project Manager', 'disabled'),
  ('15130000-0000-0000-0000-0000000000a8', '15130000-0000-0000-0000-00000000000a', 'SCA Fin Off', 'sca-fin-off@example.com', 'Finance', 'disabled'),
  ('15130000-0000-0000-0000-0000000000b1', '15130000-0000-0000-0000-00000000000b', 'SCA XOrg',  'sca-xorg@example.com',  'Admin', 'active'),
  ('15130000-0000-0000-0000-0000000000c1', '15130000-0000-0000-0000-00000000000c', 'SCA Solo',  'sca-solo@example.com',  'Finance', 'active');
insert into projects (id, org_id, name, status, project_manager_id) values
  ('15130000-0000-0000-0000-0000000000d1', '15130000-0000-0000-0000-00000000000a', 'SCA Site',  'Ongoing Project', '15130000-0000-0000-0000-0000000000a4'),
  ('15130000-0000-0000-0000-0000000000d2', '15130000-0000-0000-0000-00000000000a', 'SCA Site Two', 'Ongoing Project', '15130000-0000-0000-0000-0000000000a4'),
  ('15130000-0000-0000-0000-0000000000d9', '15130000-0000-0000-0000-00000000000c', 'SCA Solo Site', 'Ongoing Project', null);
-- Client BoQ items: L1 (100 m3), L2 (50 m) on project d1; L9 on the solo project.
insert into boq_items (id, org_id, project_id, item_code, description, unit, quantity, rate) values
  ('15130000-0000-0000-0000-0000000000e1', '15130000-0000-0000-0000-00000000000a', '15130000-0000-0000-0000-0000000000d1', 'L1', 'Excavation', 'm3', 100, 150000),
  ('15130000-0000-0000-0000-0000000000e2', '15130000-0000-0000-0000-00000000000a', '15130000-0000-0000-0000-0000000000d1', 'L2', 'Piping',     'm',  50,  90000),
  ('15130000-0000-0000-0000-0000000000e9', '15130000-0000-0000-0000-00000000000c', '15130000-0000-0000-0000-0000000000d9', 'L9', 'Solo work',  'ls', 10,  10000);
-- Subcontract purchase SP (Ordered, approved 12,000,000, Subcontractors line) and its PO.
insert into procurements (id, org_id, title, project_id, requested_by_id, status, total_value, approved_total_value,
                          approved_by_id, budget_category, currency, is_subcontract) values
  ('15130000-0000-0000-0000-0000000000f1', '15130000-0000-0000-0000-00000000000a', 'SCA earthworks subcontract',
   '15130000-0000-0000-0000-0000000000d1', '15130000-0000-0000-0000-0000000000a4', 'Ordered', 12000000, 12000000,
   '15130000-0000-0000-0000-0000000000a6', 'Subcontractors', 'IDR', true),
  ('15130000-0000-0000-0000-0000000000f9', '15130000-0000-0000-0000-00000000000c', 'SCA solo subcontract',
   '15130000-0000-0000-0000-0000000000d9', '15130000-0000-0000-0000-0000000000c1', 'Ordered', 100000, null,
   null, 'Subcontractors', 'IDR', true);
insert into purchase_orders (id, org_id, procurement_id, po_number, status, date, currency) values
  ('15130000-0000-0000-0000-000000000101', '15130000-0000-0000-0000-00000000000a', '15130000-0000-0000-0000-0000000000f1', 'PO-SCA-1', 'Issued', current_date, 'IDR'),
  ('15130000-0000-0000-0000-000000000109', '15130000-0000-0000-0000-00000000000c', '15130000-0000-0000-0000-0000000000f9', 'PO-SCA-9', 'Issued', current_date, 'IDR');
-- Signed Berita Acara documents (Issued, with a file) on each project.
insert into project_documents (id, org_id, project_id, category, title, status, file_path) values
  ('15130000-0000-0000-0000-000000000201', '15130000-0000-0000-0000-00000000000a', '15130000-0000-0000-0000-0000000000d1', 'Acceptance', 'BA period 1', 'Issued',
   '15130000-0000-0000-0000-00000000000a/15130000-0000-0000-0000-0000000000d1/15130000-0000-0000-0000-000000000201/ba1.pdf'),
  ('15130000-0000-0000-0000-000000000202', '15130000-0000-0000-0000-00000000000a', '15130000-0000-0000-0000-0000000000d2', 'Acceptance', 'BA other project', 'Issued',
   '15130000-0000-0000-0000-00000000000a/15130000-0000-0000-0000-0000000000d2/15130000-0000-0000-0000-000000000202/ba2.pdf'),
  ('15130000-0000-0000-0000-000000000209', '15130000-0000-0000-0000-00000000000c', '15130000-0000-0000-0000-0000000000d9', 'Acceptance', 'BA solo', 'Issued',
   '15130000-0000-0000-0000-00000000000c/15130000-0000-0000-0000-0000000000d9/15130000-0000-0000-0000-000000000209/ba9.pdf');

create or replace function pg_temp.act_as(p_uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
$$;

-- F2: revision 1 of PO …101 (L1 100 m3 @ 100,000 + L2 50 m @ 40,000 = 12,000,000) and of PO …109 (L9 10 ls @ 10,000).
insert into purchase_order_lines (po_id, revision, boq_item_id, quantity, rate, unit) values
  ('15130000-0000-0000-0000-000000000101', 1, '15130000-0000-0000-0000-0000000000e1', 100, 100000, 'm3'),
  ('15130000-0000-0000-0000-000000000101', 1, '15130000-0000-0000-0000-0000000000e2',  50,  40000, 'm'),
  ('15130000-0000-0000-0000-000000000109', 1, '15130000-0000-0000-0000-0000000000e9',  10,  10000, 'ls');
insert into purchase_order_revisions (po_id, procurement_id, revision, status, total, issued_by, issue_basis) values
  ('15130000-0000-0000-0000-000000000101', '15130000-0000-0000-0000-0000000000f1', 1, 'Issued', 12000000, '15130000-0000-0000-0000-0000000000a4', 'standard'),
  ('15130000-0000-0000-0000-000000000109', '15130000-0000-0000-0000-0000000000f9', 1, 'Issued',   100000, '15130000-0000-0000-0000-0000000000c1', 'standard');

-- F3: append a Confirmed acceptance as superuser (immutability triggers fire on UPDATE/DELETE only).
create or replace function pg_temp.confirmed_acceptance(p_po uuid, p_l1 numeric, p_l2 numeric) returns uuid
language plpgsql as $$
declare v uuid := gen_random_uuid();
begin
  insert into subcontract_acceptances (id, org_id, project_id, po_id, acceptance_date, status, prepared_by, confirmed_by,
                                       confirmed_at, confirm_basis, document_id)
  values (v, '15130000-0000-0000-0000-00000000000a', '15130000-0000-0000-0000-0000000000d1', p_po, current_date, 'Confirmed',
          '15130000-0000-0000-0000-0000000000a4', '15130000-0000-0000-0000-0000000000a2', clock_timestamp(), 'standard',
          '15130000-0000-0000-0000-000000000201');
  insert into subcontract_acceptance_lines values (v, '15130000-0000-0000-0000-0000000000e1', p_l1);
  if p_l2 is not null then insert into subcontract_acceptance_lines values (v, '15130000-0000-0000-0000-0000000000e2', p_l2); end if;
  return v;
end $$;

-- Bills in tests are captured through the RPC with tax exclusive, zero tax.
create or replace function pg_temp.bill(p_l1 numeric, p_l2 numeric default null) returns uuid language sql as $$
  select (capture_subcontract_vendor_invoice(
    p_procurement_id => '15130000-0000-0000-0000-0000000000f1', p_status => 'Received', p_invoice_date => current_date,
    p_amount => round(coalesce(p_l1,0) * 100000, 2) + round(coalesce(p_l2,0) * 40000, 2),
    p_tax_treatment => 'exclusive', p_tax_amount => 0,
    p_lines => (select jsonb_agg(x) from (
      select jsonb_build_object('boq_item_id','15130000-0000-0000-0000-0000000000e1','quantity',p_l1,'rate',100000) x where p_l1 is not null
      union all
      select jsonb_build_object('boq_item_id','15130000-0000-0000-0000-0000000000e2','quantity',p_l2,'rate',40000) where p_l2 is not null) s))).id
$$;

-- S3 extras: PO …104 with DRAFT lines only (no issued revision), on its own subcontract purchase (PQ-4);
-- a Cancelled subcontract purchase with an issued revision (PQ-12).
insert into procurements (id, org_id, title, project_id, requested_by_id, status, total_value, approved_total_value,
                          approved_by_id, budget_category, currency, is_subcontract) values
  ('15130000-0000-0000-0000-0000000000f4', '15130000-0000-0000-0000-00000000000a', 'SCA draft-lines sub', '15130000-0000-0000-0000-0000000000d1',
   '15130000-0000-0000-0000-0000000000a4', 'Ordered', 1000, 1000, '15130000-0000-0000-0000-0000000000a6', 'Subcontractors', 'IDR', true),
  ('15130000-0000-0000-0000-0000000000fb', '15130000-0000-0000-0000-00000000000a', 'SCA cancelled sub', '15130000-0000-0000-0000-0000000000d1',
   '15130000-0000-0000-0000-0000000000a4', 'Ordered', 1000, 1000, '15130000-0000-0000-0000-0000000000a6', 'Subcontractors', 'IDR', true);
insert into purchase_orders (id, org_id, procurement_id, po_number, status, date, currency) values
  ('15130000-0000-0000-0000-000000000104', '15130000-0000-0000-0000-00000000000a', '15130000-0000-0000-0000-0000000000f4', 'PO-SCA-4', 'Issued', current_date, 'IDR'),
  ('15130000-0000-0000-0000-00000000010b', '15130000-0000-0000-0000-00000000000a', '15130000-0000-0000-0000-0000000000fb', 'PO-SCA-11', 'Issued', current_date, 'IDR');
insert into purchase_order_lines (po_id, revision, boq_item_id, quantity, rate, unit) values
  ('15130000-0000-0000-0000-000000000104', 1, '15130000-0000-0000-0000-0000000000e1', 1, 1000, 'm3'),
  ('15130000-0000-0000-0000-00000000010b', 1, '15130000-0000-0000-0000-0000000000e1', 1, 1000, 'm3');
insert into purchase_order_revisions (po_id, procurement_id, revision, status, total, issued_by, issue_basis) values
  ('15130000-0000-0000-0000-00000000010b', '15130000-0000-0000-0000-0000000000fb', 1, 'Issued', 1000, '15130000-0000-0000-0000-0000000000a4', 'standard');
update procurements set status = 'Cancelled' where id = '15130000-0000-0000-0000-0000000000fb';

-- ── Grants, RLS, direct writes ──────────────────────────────────────────────────────────────────────────────
select is(has_table_privilege('authenticated', 'public.procurement_invoice_lines', 'INSERT')
       or has_table_privilege('authenticated', 'public.procurement_invoice_lines', 'UPDATE')
       or has_table_privilege('authenticated', 'public.procurement_invoice_lines', 'DELETE'), false,
  'FR-SCA-020 clients hold no insert, update or delete on bill lines');
select is((select relforcerowsecurity from pg_class where oid = 'public.procurement_invoice_lines'::regclass), true,
  'FR-SCA-020 bill lines are FORCE RLS');
select is(has_function_privilege('authenticated', 'public.subcontract_bill_cap_violation(uuid,jsonb,uuid)', 'EXECUTE')
       or has_function_privilege('authenticated', 'public.subcontract_billed(uuid,uuid)', 'EXECUTE')
       or has_function_privilege('authenticated', 'public.guard_subcontract_invoice_capture()', 'EXECUTE')
       or has_function_privilege('authenticated', 'public.guard_procurement_invoice_line()', 'EXECUTE'), false,
  'NFR-SCA-004 the cap, the billed read and both guards are not client-executable');
select is(has_function_privilege('anon', 'public.capture_subcontract_vendor_invoice(uuid,procurement_invoice_status,date,jsonb,text,numeric,text,text,numeric,numeric,text,integer,integer,text,numeric,text)', 'EXECUTE')
       or has_function_privilege('anon', 'public.subcontract_po_position(uuid)', 'EXECUTE'), false,
  'NFR-SCA-003 anon cannot execute the capture or the position read');

-- ── AC-SCA-004: verified 80, PO 100 ─────────────────────────────────────────────────────────────────────────
savepoint s4;
select pg_temp.confirmed_acceptance('15130000-0000-0000-0000-000000000101', 80, null);
set local role authenticated; select pg_temp.act_as('15130000-0000-0000-0000-0000000000a2');
select throws_ok($$ select pg_temp.bill(90) $$, 'SC001', null, 'AC-SCA-004 a bill for 90 against verified 80 is refused (verified cap)');
select lives_ok($$ select pg_temp.bill(80) $$, 'AC-SCA-004 a bill for 80 is accepted');
reset role; rollback to savepoint s4;

-- ── AC-SCA-001: PO 100, verified 120 ────────────────────────────────────────────────────────────────────────
savepoint s1;
select pg_temp.confirmed_acceptance('15130000-0000-0000-0000-000000000101', 120, null);
set local role authenticated; select pg_temp.act_as('15130000-0000-0000-0000-0000000000a2');
select throws_like($$ select pg_temp.bill(120) $$, '%L1%verified 120%PO 100%billed 0%',
  'AC-SCA-001 a bill for 120 is refused with SC001 naming verified 120, PO 100, billed 0');
select throws_ok($$ select pg_temp.bill(120) $$, 'SC001', null, 'AC-SCA-001 the refusal code is SC001');
select lives_ok($$ select pg_temp.bill(100) $$, 'AC-SCA-001 a bill for 100 is accepted');
select is((select payable from subcontract_po_position('15130000-0000-0000-0000-000000000101') where item_code = 'L1'),
  0::numeric, 'AC-SCA-001 payable now is 0 after it');
select is((select verified_not_on_po from subcontract_po_position('15130000-0000-0000-0000-000000000101') where item_code = 'L1'),
  20::numeric, 'AC-SCA-001 verified, not on PO = 20 remains visible');
select is((select billed from subcontract_po_position('15130000-0000-0000-0000-000000000101') where item_code = 'L1'),
  100::numeric, 'AC-SCA-001 billed shows the 100 captured');
select is((select count(*)::int from procurement_invoice_lines), 1, 'FR-SCA-020 the bill''s line is recorded and readable by Finance');
select is((select po_id from procurement_invoices where procurement_id = '15130000-0000-0000-0000-0000000000f1'),
  '15130000-0000-0000-0000-000000000101'::uuid, 'FR-SCA-020 the bill is tied to the PO');
reset role; rollback to savepoint s1;

-- ── AC-SCA-008: a cancelled bill releases its quantity ──────────────────────────────────────────────────────
savepoint s8;
select pg_temp.confirmed_acceptance('15130000-0000-0000-0000-000000000101', 60, null);
set local role authenticated; select pg_temp.act_as('15130000-0000-0000-0000-0000000000a2');
select pg_temp.bill(60);
reset role;
update procurement_invoices set erp_docstatus = 2, erp_cancelled_at = now()   -- the mirrored ERP cancel (shipped predicate)
 where procurement_id = '15130000-0000-0000-0000-0000000000f1';
set local role authenticated; select pg_temp.act_as('15130000-0000-0000-0000-0000000000a2');
select is((select payable from subcontract_po_position('15130000-0000-0000-0000-000000000101') where item_code = 'L1'),
  60::numeric, 'AC-SCA-008 a cancelled bill''s quantity returns to payable');
select lives_ok($$ select pg_temp.bill(60) $$, 'AC-SCA-008 and can be billed again');
reset role; rollback to savepoint s8;

-- ── AC-SCA-009: Draft and Withdrawn acceptance quantities never raise payable ───────────────────────────────
savepoint s9;
select pg_temp.confirmed_acceptance('15130000-0000-0000-0000-000000000101', 10, null);
insert into subcontract_acceptances (id, org_id, project_id, po_id, acceptance_date, status, prepared_by, withdrawn_at)
values ('15130000-0000-0000-0000-000000000301', '15130000-0000-0000-0000-00000000000a', '15130000-0000-0000-0000-0000000000d1',
        '15130000-0000-0000-0000-000000000101', current_date, 'Withdrawn', '15130000-0000-0000-0000-0000000000a4', now()),
       ('15130000-0000-0000-0000-000000000302', '15130000-0000-0000-0000-00000000000a', '15130000-0000-0000-0000-0000000000d1',
        '15130000-0000-0000-0000-000000000101', current_date, 'Draft', '15130000-0000-0000-0000-0000000000a4', null);
insert into subcontract_acceptance_lines values
  ('15130000-0000-0000-0000-000000000301', '15130000-0000-0000-0000-0000000000e1', 90),
  ('15130000-0000-0000-0000-000000000302', '15130000-0000-0000-0000-0000000000e1', 95);
set local role authenticated; select pg_temp.act_as('15130000-0000-0000-0000-0000000000a2');
select is((select payable from subcontract_po_position('15130000-0000-0000-0000-000000000101') where item_code = 'L1'),
  10::numeric, 'AC-SCA-009 only the latest Confirmed acceptance counts (Draft 95 and Withdrawn 90 do not)');
select throws_ok($$ select pg_temp.bill(11) $$, 'SC001', null, 'AC-SCA-009 a bill above the confirmed 10 is refused');
reset role; rollback to savepoint s9;

-- ── Roles and gates: the cap binds every role; the wrapped path's role gate is unchanged ─────────────────────
savepoint sr;
select pg_temp.confirmed_acceptance('15130000-0000-0000-0000-000000000101', 50, null);
set local role authenticated;
select pg_temp.act_as('15130000-0000-0000-0000-0000000000a1');
select throws_ok($$ select pg_temp.bill(60) $$, 'SC001', null, 'NFR-SCA-004 the cap binds an Admin too (cap enforced regardless of role)');
select pg_temp.act_as('15130000-0000-0000-0000-0000000000a4');
select throws_ok($$ select pg_temp.bill(60) $$, 'SC001', null, 'NFR-SCA-004 the cap binds a Project Manager too');
select pg_temp.act_as('15130000-0000-0000-0000-0000000000a5');
select throws_ok($$ select pg_temp.bill(10) $$, '42501', null, 'FR-SCA-020 an Engineer cannot capture a subcontract bill');
select throws_ok($$ select pg_temp.bill(60) $$, '42501', null, 'NFR-SCA-005 an over-cap request from an Engineer is refused on role (42501), never answered with the PO''s verified and billed numbers');
select pg_temp.act_as('15130000-0000-0000-0000-0000000000a8');
select throws_ok($$ select pg_temp.bill(10) $$, '42501', null, 'FR-SCA-020 a disabled Finance user cannot capture a subcontract bill');
select pg_temp.act_as('15130000-0000-0000-0000-0000000000b1');
select throws_ok($$ select pg_temp.bill(10) $$, 'P0002', null, 'NFR-SCA-003 another organisation cannot capture against this purchase');
reset role; rollback to savepoint sr;

-- ── FR-SCA-020: every other bill path on a lined subcontract purchase is refused ──────────────────────────────
set local role authenticated; select pg_temp.act_as('15130000-0000-0000-0000-0000000000a2');
select throws_ok($$ select capture_vendor_invoice('15130000-0000-0000-0000-0000000000f1', 'Received', current_date, null, 100000, p_tax_treatment => 'exclusive', p_tax_amount => 0) $$,
  'SC002', null, 'FR-SCA-020 a plain capture_vendor_invoice on a lined subcontract purchase is refused (SC002)');
select throws_ok($$ select create_procurement_invoice('15130000-0000-0000-0000-0000000000f1', 'Received', current_date, null, 100000, p_tax_treatment => 'exclusive', p_tax_amount => 0) $$,
  'SC002', null, 'FR-SCA-020 a plain create_procurement_invoice on a lined subcontract purchase is refused (SC002)');
reset role;

-- ── PQ-4: draft lines, no issued revision ───────────────────────────────────────────────────────────────────
set local role authenticated; select pg_temp.act_as('15130000-0000-0000-0000-0000000000a2');
select throws_ok($$ select capture_subcontract_vendor_invoice('15130000-0000-0000-0000-0000000000f4', 'Received', current_date,
  '[{"boq_item_id":"15130000-0000-0000-0000-0000000000e1","quantity":1,"rate":1000}]'::jsonb, p_amount => 1000,
  p_tax_treatment => 'exclusive', p_tax_amount => 0) $$, 'SC002', null, 'PQ-4 the subcontract capture is refused while the PO has draft lines and no issued revision');
select throws_ok($$ select capture_vendor_invoice('15130000-0000-0000-0000-0000000000f4', 'Received', current_date, null, 1000, p_tax_treatment => 'exclusive', p_tax_amount => 0) $$,
  'SC002', null, 'PQ-4 and a plain capture is refused too');
-- PQ-12: a cancelled purchase refuses a bill.
select throws_ok($$ select capture_subcontract_vendor_invoice('15130000-0000-0000-0000-0000000000fb', 'Received', current_date,
  '[{"boq_item_id":"15130000-0000-0000-0000-0000000000e1","quantity":1,"rate":1000}]'::jsonb, p_amount => 1000,
  p_tax_treatment => 'exclusive', p_tax_amount => 0) $$, '42501', null, 'PQ-12 a Cancelled purchase refuses a subcontract bill');
-- A purchase that is not a subcontract has nothing to cap.
select throws_ok($$ select capture_subcontract_vendor_invoice('15130000-0000-0000-0000-0000000000f9', 'Received', current_date,
  '[{"boq_item_id":"15130000-0000-0000-0000-0000000000e9","quantity":1,"rate":10000}]'::jsonb, p_amount => 10000,
  p_tax_treatment => 'exclusive', p_tax_amount => 0) $$, 'P0002', null, 'NFR-SCA-003 the solo org''s purchase is not visible to this org''s Finance');
reset role;

-- ── FR-SCA-023: rate, amount, tax ───────────────────────────────────────────────────────────────────────────
savepoint s23;
select pg_temp.confirmed_acceptance('15130000-0000-0000-0000-000000000101', 100, null);
set local role authenticated; select pg_temp.act_as('15130000-0000-0000-0000-0000000000a2');
select throws_ok($$ select capture_subcontract_vendor_invoice('15130000-0000-0000-0000-0000000000f1', 'Received', current_date,
  '[{"boq_item_id":"15130000-0000-0000-0000-0000000000e1","quantity":1,"rate":100001}]'::jsonb, p_amount => 100001,
  p_tax_treatment => 'exclusive', p_tax_amount => 0) $$, '23514', null, 'FR-SCA-023 a line rate above the PO rate (100,001 > 100,000) is refused');
select throws_ok($$ select capture_subcontract_vendor_invoice('15130000-0000-0000-0000-0000000000f1', 'Received', current_date,
  '[{"boq_item_id":"15130000-0000-0000-0000-0000000000e1","quantity":2,"rate":100000}]'::jsonb, p_amount => 100000,
  p_tax_treatment => 'exclusive', p_tax_amount => 0) $$, '23514', null, 'FR-SCA-023 a bill amount that is not the sum of its lines is refused');
select lives_ok($$ select capture_subcontract_vendor_invoice('15130000-0000-0000-0000-0000000000f1', 'Received', current_date,
  '[{"boq_item_id":"15130000-0000-0000-0000-0000000000e1","quantity":2,"rate":100000}]'::jsonb, p_amount => 222000,
  p_tax_treatment => 'inclusive', p_tax_amount => 22000, p_tax_rate => 11) $$,
  'FR-SCA-023 an inclusive-tax bill whose amount minus tax equals the lines is accepted (OQ-8: the cap is on pre-tax lines)');
select throws_ok($$ select capture_subcontract_vendor_invoice('15130000-0000-0000-0000-0000000000f1', 'Received', current_date,
  '[{"boq_item_id":"15130000-0000-0000-0000-0000000000e1","quantity":1,"rate":100000},{"boq_item_id":"15130000-0000-0000-0000-0000000000e1","quantity":1,"rate":100000}]'::jsonb,
  p_amount => 200000, p_tax_treatment => 'exclusive', p_tax_amount => 0) $$, '23514', null,
  'FR-SCA-021 a bill naming the same BoQ line twice is refused (23514)');
select throws_ok($$ select capture_subcontract_vendor_invoice('15130000-0000-0000-0000-0000000000f1', 'Received', current_date,
  '[{"boq_item_id":"15130000-0000-0000-0000-0000000000e9","quantity":1,"rate":10000}]'::jsonb, p_amount => 10000,
  p_tax_treatment => 'exclusive', p_tax_amount => 0) $$, 'SC001', null, 'FR-SCA-020 a line that is not on this PO is refused (SC001, fail closed)');
reset role; rollback to savepoint s23;

-- ── FR-SCA-021 D3: the cap sums and validates its own input ─────────────────────────────────────────────────
savepoint sd3;
select pg_temp.confirmed_acceptance('15130000-0000-0000-0000-000000000101', 100, null);
select is(subcontract_bill_cap_violation('15130000-0000-0000-0000-000000000101',
  '[{"boq_item_id":"15130000-0000-0000-0000-0000000000e1","quantity":60},{"boq_item_id":"15130000-0000-0000-0000-0000000000e1","quantity":60}]'::jsonb, null)->>'reason',
  'over_cap', 'FR-SCA-021 a line named twice is summed (60 + 60 > 100), not checked row by row');
select is(subcontract_bill_cap_violation('15130000-0000-0000-0000-000000000101',
  '[{"boq_item_id":"15130000-0000-0000-0000-0000000000e1","quantity":0}]'::jsonb, null)->>'reason',
  'unreadable_input', 'NFR-SCA-004 a zero quantity is unreadable input');
select is(subcontract_bill_cap_violation('15130000-0000-0000-0000-000000000101',
  '[{"boq_item_id":"15130000-0000-0000-0000-0000000000e1","quantity":-1}]'::jsonb, null)->>'reason',
  'unreadable_input', 'NFR-SCA-004 a negative quantity is unreadable input');
select is(subcontract_bill_cap_violation('15130000-0000-0000-0000-000000000101',
  '[{"boq_item_id":"15130000-0000-0000-0000-0000000000e1"}]'::jsonb, null)->>'reason',
  'unreadable_input', 'NFR-SCA-004 a missing quantity is unreadable input');
select is(subcontract_bill_cap_violation('15130000-0000-0000-0000-000000000101', null, null)->>'reason',
  'unreadable_input', 'NFR-SCA-004 null lines are unreadable input');
select is(subcontract_bill_cap_violation('15130000-0000-0000-0000-000000000101',
  '[{"boq_item_id":"15130000-0000-0000-0000-0000000000e1","quantity":100}]'::jsonb, null) is null, true,
  'FR-SCA-021 exactly the verified-and-PO quantity (100) passes the cap');
select is(subcontract_bill_cap_violation('15130000-0000-0000-0000-000000000104',
  '[{"boq_item_id":"15130000-0000-0000-0000-0000000000e1","quantity":1}]'::jsonb, null)->>'reason',
  'no_issued_lines', 'NFR-SCA-004 a PO without an issued revision cannot be billed against');
rollback to savepoint sd3;

-- ── FR-SCA-022 / NFR-SCA-004: unreadable PO lines fail closed ─────────────────────────────────────────────────
savepoint sfc;
select pg_temp.confirmed_acceptance('15130000-0000-0000-0000-000000000101', 100, null);
alter table purchase_order_lines disable trigger purchase_order_lines_guard;
delete from purchase_order_lines where po_id = '15130000-0000-0000-0000-000000000101';
select is(subcontract_bill_cap_violation('15130000-0000-0000-0000-000000000101',
  '[{"boq_item_id":"15130000-0000-0000-0000-0000000000e1","quantity":1}]'::jsonb, null)->>'reason',
  'unreadable_po_lines', 'NFR-SCA-004 a revision whose lines cannot be read fails closed');
set local role authenticated; select pg_temp.act_as('15130000-0000-0000-0000-0000000000a2');
select throws_ok($$ select pg_temp.bill(1) $$, 'SC001', null, 'NFR-SCA-004 and the capture refuses (SC001) rather than pass');
reset role; rollback to savepoint sfc;

-- ── Direct writes to bill lines are refused for every actor (guard binds the owner too) ──────────────────────
savepoint sdw;
select pg_temp.confirmed_acceptance('15130000-0000-0000-0000-000000000101', 10, null);
set local role authenticated; select pg_temp.act_as('15130000-0000-0000-0000-0000000000a2');
select pg_temp.bill(5);
reset role;
select throws_ok($$ insert into procurement_invoice_lines (invoice_id, boq_item_id, quantity, rate)
  select id, '15130000-0000-0000-0000-0000000000e2', 1, 1 from procurement_invoices limit 1 $$, '42501', null,
  'FR-SCA-020 a bill line cannot be inserted outside the capture RPC, even by the owner');
select throws_ok($$ update procurement_invoice_lines set quantity = 1 $$, '42501', null, 'FR-SCA-020 a bill line is immutable (update)');
select throws_ok($$ delete from procurement_invoice_lines $$, '42501', null, 'FR-SCA-020 a bill line is immutable (delete)');
rollback to savepoint sdw;

-- ── NFR-SCA-005: honest numbers ─────────────────────────────────────────────────────────────────────────────
savepoint s5;
select pg_temp.confirmed_acceptance('15130000-0000-0000-0000-000000000101', 60, null);
set local role authenticated; select pg_temp.act_as('15130000-0000-0000-0000-0000000000a2');
select pg_temp.bill(60);
select pg_temp.act_as('15130000-0000-0000-0000-0000000000a5');
select is((select count(*)::int from subcontract_po_position('15130000-0000-0000-0000-000000000101')), 0,
  'NFR-SCA-005 a caller who cannot see the PO gets no rows, not a zero line');
reset role;
update procurements set requested_by_id = '15130000-0000-0000-0000-0000000000a5' where id = '15130000-0000-0000-0000-0000000000f1';
set local role authenticated; select pg_temp.act_as('15130000-0000-0000-0000-0000000000a5');
select is((select po_qty from subcontract_po_position('15130000-0000-0000-0000-000000000101') where item_code = 'L1'), 100::numeric,
  'NFR-SCA-005 the Engineer who raised the purchase sees the PO quantity');
select is((select verified from subcontract_po_position('15130000-0000-0000-0000-000000000101') where item_code = 'L1'), 60::numeric,
  'NFR-SCA-005 and the verified quantity');
select ok((select billed is null and payable is null from subcontract_po_position('15130000-0000-0000-0000-000000000101') where item_code = 'L1'),
  'NFR-SCA-005 but billed and payable are null (no bill money for Engineers), never a 0 from hidden rows');
reset role; rollback to savepoint s5;

-- ── NFR-SCA-001: property — billed <= min(verified, PO) over random sequences ───────────────────────────────
create temp table prop (ok boolean not null, ev text not null);
grant all on prop to public;
select setseed(0.1513);
do $$
declare
  po constant uuid := '15130000-0000-0000-0000-000000000101';
  l1 constant uuid := '15130000-0000-0000-0000-0000000000e1';
  v_ver numeric := 0; i integer; r double precision; v_inv uuid; q numeric;
begin
  for i in 1..200 loop
    r := random();
    if r < 0.25 then                                                 -- a (monotone) confirm
      v_ver := v_ver + floor(random() * 30);
      perform pg_temp.confirmed_acceptance(po, v_ver, null);
      insert into prop values (true, 'confirm');
    elsif r < 0.85 then                                              -- a bill attempt
      q := 1 + floor(random() * 40);
      begin
        execute 'set local role authenticated';
        perform pg_temp.act_as('15130000-0000-0000-0000-0000000000a2');
        perform pg_temp.bill(q);
        insert into prop values (true, 'bill_ok');
      exception when sqlstate 'SC001' then
        insert into prop values (true, 'bill_refused');
      end;
      execute 'reset role';
    else                                                              -- a mirrored ERP cancel of a random live bill
      select id into v_inv from procurement_invoices where procurement_id = '15130000-0000-0000-0000-0000000000f1'
         and coalesce(erp_docstatus, 1) <> 2 and erp_cancelled_at is null order by random() limit 1;
      if v_inv is not null then
        update procurement_invoices set erp_docstatus = 2, erp_cancelled_at = now() where id = v_inv;
        insert into prop values (true, 'cancel');
      end if;
    end if;
    insert into prop values (not exists (
      select 1 from (select l.boq_item_id, sum(l.quantity) q from procurement_invoice_lines l
                       join procurement_invoices x on x.id = l.invoice_id
                      where x.po_id = po and coalesce(x.erp_docstatus, 1) <> 2 and x.erp_cancelled_at is null group by 1) b
        left join subcontract_verified(po) v on v.boq_item_id = b.boq_item_id
        join purchase_order_lines pl on pl.po_id = po and pl.revision = 1 and pl.boq_item_id = b.boq_item_id
       where b.q > least(coalesce(v.quantity, 0), pl.quantity)), 'invariant');
  end loop;
end $$;
select ok((select bool_and(ok) from prop where ev = 'invariant') and (select count(*) from prop where ev = 'invariant') = 200,
  'NFR-SCA-001 over 200 random confirm/bill/cancel steps, billed never exceeds min(verified, PO) on any line');
select ok((select count(*) from prop where ev = 'bill_ok') > 10 and (select count(*) from prop where ev = 'bill_refused') > 10,
  'NFR-SCA-001 the property run exercised both accepted and refused bills (not vacuous)');

select * from finish();
rollback;

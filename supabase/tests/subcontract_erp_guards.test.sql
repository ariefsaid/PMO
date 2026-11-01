-- #1513 S5: ERP guards for subcontract purchases — the queued bill refuses without lines (FR-SCA-022, PQ-9), OQ-10
-- reconciliation exceptions block payment (PQ-10), the purchase-order.revise push refusal (AC-SCA-012 DB half).
-- Fixture F1 + F2 + F3 of docs/plans/2026-11-01-subcontract-acceptance.md, plus S4 extras for the PQ-5 payer check.
begin;
create extension if not exists pgtap;
select plan(63);

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
  ('15130000-0000-0000-0000-0000000000e3', '15130000-0000-0000-0000-00000000000a', '15130000-0000-0000-0000-0000000000d1', 'L3', 'Not on PO', 'ls', 5,   10000),
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

-- S4 extras (superuser): an Active budget on d1 with a Subcontractors line of 13,000,000 (the purchase already commits
-- 12,000,000, so 1,000,000 of headroom remains) and the senior set = Executive + Fin2 (Fin2 is there so the issuer ≠ approver
-- refusal is reached by a user who holds the issuing role).
insert into budget_versions (id, org_id, project_id, name, version, status, created_by) values
  ('15130000-0000-0000-0000-000000000301', '15130000-0000-0000-0000-00000000000a', '15130000-0000-0000-0000-0000000000d1', 'v1', 1, 'Draft', null);
insert into budget_line_items (org_id, budget_version_id, category, budgeted_amount) values
  ('15130000-0000-0000-0000-00000000000a', '15130000-0000-0000-0000-000000000301', 'Subcontractors', 13000000);
update budget_versions set status = 'Active' where id = '15130000-0000-0000-0000-000000000301';
insert into spend_approvers (org_id, project_id, profile_id) values
  ('15130000-0000-0000-0000-00000000000a', null, '15130000-0000-0000-0000-0000000000a6'),
  ('15130000-0000-0000-0000-00000000000a', null, '15130000-0000-0000-0000-0000000000a3');
-- Client work orders: 401 on project d1, 402 on project d2.
insert into work_orders (id, org_id, project_id, title, status, order_value, tax_treatment, tax_amount) values
  ('15130000-0000-0000-0000-000000000401', '15130000-0000-0000-0000-00000000000a', '15130000-0000-0000-0000-0000000000d1', 'SCA WO one', 'Issued', 10000, 'exclusive', 0),
  ('15130000-0000-0000-0000-000000000402', '15130000-0000-0000-0000-00000000000a', '15130000-0000-0000-0000-0000000000d2', 'SCA WO two', 'Issued', 10000, 'exclusive', 0);

-- F3 verified quantity: L1 = 60 (PO 100), L2 none.
select pg_temp.confirmed_acceptance('15130000-0000-0000-0000-000000000101', 60, null);

-- S5 extras (superuser): a plain (non-subcontract) purchase, a subcontract purchase whose PO has no issued revision,
-- a Cancelled subcontract purchase with an issued revision (PQ-12).
insert into procurements (id, org_id, title, project_id, requested_by_id, status, total_value, approved_total_value,
                          approved_by_id, budget_category, currency, is_subcontract) values
  ('15130000-0000-0000-0000-0000000000fa', '15130000-0000-0000-0000-00000000000a', 'SCA plain goods', '15130000-0000-0000-0000-0000000000d1',
   '15130000-0000-0000-0000-0000000000a4', 'Ordered', 1000, 1000, '15130000-0000-0000-0000-0000000000a6', 'Materials', 'IDR', false),
  ('15130000-0000-0000-0000-0000000000f4', '15130000-0000-0000-0000-00000000000a', 'SCA no-revision sub', '15130000-0000-0000-0000-0000000000d1',
   '15130000-0000-0000-0000-0000000000a4', 'Ordered', 1000, 1000, '15130000-0000-0000-0000-0000000000a6', 'Subcontractors', 'IDR', true),
  ('15130000-0000-0000-0000-0000000000fb', '15130000-0000-0000-0000-00000000000a', 'SCA cancelled sub', '15130000-0000-0000-0000-0000000000d1',
   '15130000-0000-0000-0000-0000000000a4', 'Ordered', 1000, 1000, '15130000-0000-0000-0000-0000000000a6', 'Subcontractors', 'IDR', true);
insert into purchase_orders (id, org_id, procurement_id, po_number, status, date, currency) values
  ('15130000-0000-0000-0000-000000000104', '15130000-0000-0000-0000-00000000000a', '15130000-0000-0000-0000-0000000000f4', 'PO-SCA-4', 'Issued', current_date, 'IDR'),
  ('15130000-0000-0000-0000-00000000010b', '15130000-0000-0000-0000-00000000000a', '15130000-0000-0000-0000-0000000000fb', 'PO-SCA-11', 'Issued', current_date, 'IDR');
insert into purchase_order_lines (po_id, revision, boq_item_id, quantity, rate, unit) values
  ('15130000-0000-0000-0000-00000000010b', 1, '15130000-0000-0000-0000-0000000000e1', 1, 1000, 'm3');
insert into purchase_order_revisions (po_id, procurement_id, revision, status, total, issued_by, issue_basis) values
  ('15130000-0000-0000-0000-00000000010b', '15130000-0000-0000-0000-0000000000fb', 1, 'Issued', 1000, '15130000-0000-0000-0000-0000000000a4', 'standard');
update procurements set status = 'Cancelled' where id = '15130000-0000-0000-0000-0000000000fb';

-- Revision 2 of PO …101 is issued (superuser insert, as F2): L1 120 m3 @ 100,000 + L2 50 m @ 40,000.
insert into purchase_order_lines (po_id, revision, boq_item_id, quantity, rate, unit) values
  ('15130000-0000-0000-0000-000000000101', 2, '15130000-0000-0000-0000-0000000000e1', 120, 100000, 'm3'),
  ('15130000-0000-0000-0000-000000000101', 2, '15130000-0000-0000-0000-0000000000e2',  50,  40000, 'm');
insert into purchase_order_revisions (po_id, procurement_id, revision, status, total, issued_by, issue_basis) values
  ('15130000-0000-0000-0000-000000000101', '15130000-0000-0000-0000-0000000000f1', 2, 'Issued', 14000000, '15130000-0000-0000-0000-0000000000a4', 'standard');

-- An ERP-origin bill (service-role mirror semantics: no JWT user), fixed ids per test below.
create or replace function pg_temp.erp_bill(p_id uuid, p_proc uuid, p_amount numeric) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  insert into procurement_invoices (id, org_id, procurement_id, vi_number, invoice_date, status, amount, currency,
                                    tax_treatment, tax_amount, erp_docstatus)
  values (p_id, '15130000-0000-0000-0000-00000000000a', p_proc, 'VI-' || left(p_id::text, 8), current_date, 'Received',
          p_amount, 'IDR', 'exclusive', 0, 1);
end $$;

-- ── Grants ──────────────────────────────────────────────────────────────────────────────────────────────────
select is(has_function_privilege('anon', 'public.attribute_subcontract_bill_lines(uuid,jsonb)', 'EXECUTE')
       or has_function_privilege('anon', 'public.subcontract_cap_exceptions(uuid)', 'EXECUTE')
       or has_function_privilege('anon', 'public.po_revision_push_refusal(uuid,uuid,integer,boolean)', 'EXECUTE'), false,
  'NFR-SCA-003 anon cannot execute the attribution, the exceptions read or the push refusal');
select is(has_function_privilege('authenticated', 'public.po_revision_push_refusal(uuid,uuid,integer,boolean)', 'EXECUTE'), false,
  'NFR-SCA-004 the push refusal is service-role only');
select is(has_function_privilege('service_role', 'public.po_revision_push_refusal(uuid,uuid,integer,boolean)', 'EXECUTE'), true,
  'NFR-SCA-004 the edge function (service role) can ask the push refusal');

-- ── FR-SCA-022 / PQ-9: the queued bill refuses without lines (fail closed) ─────────────────────────────────────
select is(procurement_create_refusal('15130000-0000-0000-0000-00000000000a', '15130000-0000-0000-0000-0000000000f1',
  'purchase-invoice', '15130000-0000-0000-0000-0000000000a2'), 'subcontract_bill_lines_required',
  'FR-SCA-022 PQ-9 a queued subcontract bill that carries no lines is refused at claim time (fail closed)');
select isnt(procurement_create_refusal('15130000-0000-0000-0000-00000000000a', '15130000-0000-0000-0000-0000000000fa',
  'purchase-invoice', '15130000-0000-0000-0000-0000000000a2'), 'subcontract_bill_lines_required',
  'OQ-2 a goods purchase is not held by the subcontract rule');
select isnt(procurement_create_refusal('15130000-0000-0000-0000-00000000000a', '15130000-0000-0000-0000-0000000000f4',
  'purchase-invoice', '15130000-0000-0000-0000-0000000000a2'), 'subcontract_bill_lines_required',
  'OQ-1 a subcontract purchase with no issued revision bills as today');
select isnt(procurement_create_refusal('15130000-0000-0000-0000-00000000000a', '15130000-0000-0000-0000-0000000000f1',
  'purchase-order', '15130000-0000-0000-0000-0000000000a2'), 'subcontract_bill_lines_required',
  'FR-SCA-022 only the purchase-invoice kind is held');

-- ── PQ-5 (kept by the re-created refusal): a variation approver is refused as payer on the queued payment ──────
savepoint ssod;
set local role authenticated;
select pg_temp.act_as('15130000-0000-0000-0000-0000000000a4');
select request_po_variation('15130000-0000-0000-0000-000000000101', 'pre_work',
  '[{"boq_item_id":"15130000-0000-0000-0000-0000000000e1","additional_quantity":5}]', 'Payer check');
select pg_temp.act_as('15130000-0000-0000-0000-0000000000a3');
select decide_po_variation((select id from po_variations where reason = 'Payer check'), true, null);
reset role;
select is(procurement_create_refusal('15130000-0000-0000-0000-00000000000a', '15130000-0000-0000-0000-0000000000f1', 'payment',
            '15130000-0000-0000-0000-0000000000a3'), 'separation_of_duties',
  'PQ-5 the re-created refusal still refuses a variation approver as payer');
select isnt(procurement_create_refusal('15130000-0000-0000-0000-00000000000a', '15130000-0000-0000-0000-0000000000f1', 'payment',
            '15130000-0000-0000-0000-0000000000a2'), 'separation_of_duties',
  'PQ-5 a payer who approved nothing is not refused on SoD');
rollback to savepoint ssod;

-- ── OQ-10: an ERP-origin bill with no attributed lines is a reconciliation exception ──────────────────────────
select pg_temp.erp_bill('15130000-0000-0000-0000-0000000e0b01', '15130000-0000-0000-0000-0000000000f1', 8000000);
select is((select count(*)::int from subcontract_cap_exceptions('15130000-0000-0000-0000-0000000000f1')), 1,
  'OQ-10 the ERP-origin bill with no attributed lines is a reconciliation exception');
select is((select reason from subcontract_cap_exceptions('15130000-0000-0000-0000-0000000000f1')), 'no_lines',
  'OQ-10 the exception names its reason');
select is((select count(*)::int from subcontract_cap_exceptions('15130000-0000-0000-0000-0000000000fa')), 0,
  'OQ-2 a goods purchase has no exceptions');
select is(procurement_payment_allowed('15130000-0000-0000-0000-0000000000f1'), 'subcontract_cap_exception',
  'OQ-10 payment from PMO is refused while the exception stands');
select is(procurement_create_refusal('15130000-0000-0000-0000-00000000000a', '15130000-0000-0000-0000-0000000000f1', 'payment',
            '15130000-0000-0000-0000-0000000000a2'), 'subcontract_cap_exception',
  'OQ-10 the queued payment (outbox claim) is refused too');
set local role authenticated;
select pg_temp.act_as('15130000-0000-0000-0000-0000000000a2');
select throws_ok($$ select transition_procurement('15130000-0000-0000-0000-0000000000f1', 'Paid') $$,
  '23514', 'A subcontract bill is not attributed to BoQ lines; attribute its lines or have it cancelled in the ERP before payment.',
  'OQ-10 the Paid transition names the unattributed bill and the remedy');
select is((select count(*)::int from subcontract_cap_exceptions('15130000-0000-0000-0000-0000000000f1')), 1,
  'OQ-10 Finance sees the exception');
select pg_temp.act_as('15130000-0000-0000-0000-0000000000a4');
select is((select count(*)::int from subcontract_cap_exceptions('15130000-0000-0000-0000-0000000000f1')), 1,
  'OQ-10 the project manager sees the exception');
select pg_temp.act_as('15130000-0000-0000-0000-0000000000a5');
select is((select count(*)::int from subcontract_cap_exceptions('15130000-0000-0000-0000-0000000000f1')), 0,
  'OQ-10 D6 an Engineer sees no bill rows, so no exception');
select pg_temp.act_as('15130000-0000-0000-0000-0000000000b1');
select is((select count(*)::int from subcontract_cap_exceptions('15130000-0000-0000-0000-0000000000f1')), 0,
  'OQ-10 AC-SCA-013 another org sees nothing');

-- ── PQ-10 (a): attribute_subcontract_bill_lines runs the same cap ──────────────────────────────────────────────
select pg_temp.act_as('15130000-0000-0000-0000-0000000000a2');
select throws_ok($$ select attribute_subcontract_bill_lines('15130000-0000-0000-0000-0000000e0b01',
  '[{"boq_item_id":"15130000-0000-0000-0000-0000000000e1","quantity":80,"rate":100000}]') $$,
  'SC001', null, 'OQ-10 attributing 80 against verified 60 is refused by the same cap');
select throws_ok($$ select attribute_subcontract_bill_lines('15130000-0000-0000-0000-0000000e0b01',
  '[{"boq_item_id":"15130000-0000-0000-0000-0000000000e1","quantity":60,"rate":100000}]') $$,
  '23514', null, 'OQ-10 lines that do not add up to the bill''s pre-tax amount are refused');
select throws_ok($$ select attribute_subcontract_bill_lines('15130000-0000-0000-0000-0000000e0b01',
  '[{"boq_item_id":"15130000-0000-0000-0000-0000000000e1","quantity":0,"rate":100000}]') $$,
  'SC001', null, 'NFR-SCA-004 an unreadable quantity is refused (fail closed)');
select throws_ok($$ select attribute_subcontract_bill_lines('15130000-0000-0000-0000-0000000e0b01', null) $$,
  'SC001', null, 'NFR-SCA-004 a missing line set is refused (fail closed)');
select throws_ok($$ select attribute_subcontract_bill_lines('15130000-0000-0000-0000-0000000e0b01',
  '[{"boq_item_id":"15130000-0000-0000-0000-0000000000e9","quantity":1,"rate":1}]') $$,
  'SC001', null, 'FR-SCA-020 a line that is not on the PO is refused');
select pg_temp.act_as('15130000-0000-0000-0000-0000000000a4');
select throws_ok($$ select attribute_subcontract_bill_lines('15130000-0000-0000-0000-0000000e0b01',
  '[{"boq_item_id":"15130000-0000-0000-0000-0000000000e1","quantity":60,"rate":100000}]') $$,
  '42501', null, 'OQ-10 a project manager cannot attribute (Admin / Finance only)');
select pg_temp.act_as('15130000-0000-0000-0000-0000000000a5');
select throws_ok($$ select attribute_subcontract_bill_lines('15130000-0000-0000-0000-0000000e0b01',
  '[{"boq_item_id":"15130000-0000-0000-0000-0000000000e1","quantity":60,"rate":100000}]') $$,
  '42501', null, 'OQ-10 an Engineer cannot attribute');
select pg_temp.act_as('15130000-0000-0000-0000-0000000000b1');
select throws_ok($$ select attribute_subcontract_bill_lines('15130000-0000-0000-0000-0000000e0b01',
  '[{"boq_item_id":"15130000-0000-0000-0000-0000000000e1","quantity":60,"rate":100000}]') $$,
  'P0002', null, 'AC-SCA-013 another org''s admin cannot attribute (the bill is not found)');
select pg_temp.act_as('15130000-0000-0000-0000-0000000000a6');
select throws_ok($$ select attribute_subcontract_bill_lines('15130000-0000-0000-0000-0000000e0b01',
  '[{"boq_item_id":"15130000-0000-0000-0000-0000000000e1","quantity":60,"rate":100000}]') $$,
  '42501', null, 'OQ-10 an Executive cannot attribute');
select pg_temp.act_as('15130000-0000-0000-0000-0000000000a8');
select throws_ok($$ select attribute_subcontract_bill_lines('15130000-0000-0000-0000-0000000e0b01',
  '[{"boq_item_id":"15130000-0000-0000-0000-0000000000e1","quantity":60,"rate":100000}]') $$,
  '42501', null, 'OQ-10 an inactive Finance member cannot attribute');
reset role;

-- a second ERP-origin bill for exactly 60 is attributed and then counts as billed
select pg_temp.erp_bill('15130000-0000-0000-0000-0000000e0b02', '15130000-0000-0000-0000-0000000000f1', 6000000);
set local role authenticated;
savepoint sadmin;
select pg_temp.act_as('15130000-0000-0000-0000-0000000000a1');
select lives_ok($$ select attribute_subcontract_bill_lines('15130000-0000-0000-0000-0000000e0b02',
  '[{"boq_item_id":"15130000-0000-0000-0000-0000000000e1","quantity":60,"rate":100000}]') $$,
  'OQ-10 an Admin attributes 60 against verified 60');
select is((select count(*)::int from procurement_invoice_lines where invoice_id = '15130000-0000-0000-0000-0000000e0b02'), 1,
  'OQ-10 the Admin attribution wrote the bill line');
rollback to savepoint sadmin;
select pg_temp.act_as('15130000-0000-0000-0000-0000000000a2');
select throws_ok($$ select attribute_subcontract_bill_lines('15130000-0000-0000-0000-0000000e0b02',
  '[{"boq_item_id":"15130000-0000-0000-0000-0000000000e1","quantity":60,"rate":100001}]') $$,
  '23514', null, 'FR-SCA-023 a rate above the PO rate is refused');
select throws_ok($$ select attribute_subcontract_bill_lines('15130000-0000-0000-0000-0000000e0b02',
  '[{"boq_item_id":"15130000-0000-0000-0000-0000000000e1","quantity":30,"rate":100000},{"boq_item_id":"15130000-0000-0000-0000-0000000000e1","quantity":30,"rate":100000}]') $$,
  '23514', null, 'FR-SCA-023 a line named twice is refused');
select lives_ok($$ select attribute_subcontract_bill_lines('15130000-0000-0000-0000-0000000e0b02',
  '[{"boq_item_id":"15130000-0000-0000-0000-0000000000e1","quantity":60,"rate":100000}]') $$,
  'OQ-10 Finance attributes 60 against verified 60');
select throws_ok($$ select attribute_subcontract_bill_lines('15130000-0000-0000-0000-0000000e0b02',
  '[{"boq_item_id":"15130000-0000-0000-0000-0000000000e1","quantity":60,"rate":100000}]') $$,
  '23514', null, 'OQ-10 a bill that already has lines cannot be attributed again');
select is((select billed from subcontract_po_position('15130000-0000-0000-0000-000000000101') where item_code = 'L1'), 60::numeric,
  'OQ-10 the attributed bill now counts as billed on the position read');
select throws_ok($$ select pg_temp.bill(1) $$, 'SC001', null,
  'OQ-10 the attributed quantity consumes the headroom: a further bill of 1 is over the cap');
reset role;
select is((select po_id from procurement_invoices where id = '15130000-0000-0000-0000-0000000e0b02'),
  '15130000-0000-0000-0000-000000000101'::uuid, 'OQ-10 the attributed bill is linked to its PO');
select is((select attributed_by from procurement_invoice_lines where invoice_id = '15130000-0000-0000-0000-0000000e0b02'),
  '15130000-0000-0000-0000-0000000000a2'::uuid, 'OQ-10 the attributing user is stamped on the line');
select is((select count(*)::int from audit_events where action = 'procurement_invoice.attribute_lines'
             and entity_id = '15130000-0000-0000-0000-0000000e0b02'), 1, 'NFR-SCA-006 the attribution wrote an audit event');
select is((select count(*)::int from subcontract_cap_exceptions('15130000-0000-0000-0000-0000000000f1')), 1,
  'OQ-10 only the still-unattributed bill remains an exception');
select is(procurement_payment_allowed('15130000-0000-0000-0000-0000000000f1'), 'subcontract_cap_exception',
  'OQ-10 payment stays refused while any exception remains');

-- the ERP credit note / cancel clears it (PQ-10 b)
select is(po_revision_push_refusal('15130000-0000-0000-0000-00000000000a', '15130000-0000-0000-0000-000000000101', 2, true),
  'po_has_submitted_bill', 'AC-SCA-012 a live bill on the purchase refuses a cancel-style revise');
select is(po_revision_push_refusal('15130000-0000-0000-0000-00000000000a', '15130000-0000-0000-0000-000000000101', 2, false), null,
  'AC-SCA-012 an edit-style revise cancels nothing and is allowed');
update procurement_invoices set erp_docstatus = 2, erp_cancelled_at = now() where id = '15130000-0000-0000-0000-0000000e0b01';
select is(procurement_payment_allowed('15130000-0000-0000-0000-0000000000f1'), null, 'OQ-10 a cancelled ERP bill clears the exception');
update procurement_invoices set erp_docstatus = 2, erp_cancelled_at = now() where id = '15130000-0000-0000-0000-0000000e0b02';
select is(po_revision_push_refusal('15130000-0000-0000-0000-00000000000a', '15130000-0000-0000-0000-000000000101', 2, true), null,
  'AC-SCA-012 (DB half) no live bill: a cancel-style revise is allowed');

-- attribution refuses a cancelled bill, a closed purchase and a purchase with no lines
select pg_temp.erp_bill('15130000-0000-0000-0000-0000000e0b03', '15130000-0000-0000-0000-0000000000fb', 1000);
select pg_temp.erp_bill('15130000-0000-0000-0000-0000000e0b04', '15130000-0000-0000-0000-0000000000f4', 1000);
select pg_temp.erp_bill('15130000-0000-0000-0000-0000000e0b05', '15130000-0000-0000-0000-0000000000fa', 1000);
select pg_temp.erp_bill('15130000-0000-0000-0000-0000000e0b06', '15130000-0000-0000-0000-0000000000f1', 6000000);
update procurement_invoices set erp_docstatus = 2, erp_cancelled_at = now() where id = '15130000-0000-0000-0000-0000000e0b06';
set local role authenticated;
select pg_temp.act_as('15130000-0000-0000-0000-0000000000a2');
select throws_ok($$ select attribute_subcontract_bill_lines('15130000-0000-0000-0000-0000000e0b06',
  '[{"boq_item_id":"15130000-0000-0000-0000-0000000000e1","quantity":60,"rate":100000}]') $$,
  '23514', 'this bill is cancelled', 'OQ-10 a cancelled bill is not attributed');
select throws_ok($$ select attribute_subcontract_bill_lines('15130000-0000-0000-0000-0000000e0b03',
  '[{"boq_item_id":"15130000-0000-0000-0000-0000000000e1","quantity":1,"rate":1000}]') $$,
  '42501', null, 'PQ-12 a closed purchase refuses attribution');
select throws_ok($$ select attribute_subcontract_bill_lines('15130000-0000-0000-0000-0000000e0b04',
  '[{"boq_item_id":"15130000-0000-0000-0000-0000000000e1","quantity":1,"rate":1000}]') $$,
  'SC002', null, 'PQ-4 a subcontract purchase with no issued lines has nothing to attribute against');
select throws_ok($$ select attribute_subcontract_bill_lines('15130000-0000-0000-0000-0000000e0b05',
  '[{"boq_item_id":"15130000-0000-0000-0000-0000000000e1","quantity":1,"rate":1000}]') $$,
  'SC002', null, 'OQ-2 a goods purchase''s bill is not attributed');
reset role;

-- ── PQ-10: a linked ERP Purchase Invoice (no PMO bill row, cannot carry lines) ──────────────────────────────
savepoint slink;
insert into erp_purchase_documents (id, org_id, erp_doctype, erp_name, grand_total, erp_docstatus, pmo_owned, currency, erp_modified) values
  ('15130000-0000-0000-0000-0000000e0d01', '15130000-0000-0000-0000-00000000000a', 'Purchase Invoice', 'PINV-SCA-1', 5000000, 1, false, 'IDR', 'm1'),
  ('15130000-0000-0000-0000-0000000e0d02', '15130000-0000-0000-0000-00000000000a', 'Purchase Order',   'PO-SCA-ERP', 5000000, 1, false, 'IDR', 'm1'),
  ('15130000-0000-0000-0000-0000000e0d03', '15130000-0000-0000-0000-00000000000a', 'Purchase Invoice', 'PINV-SCA-3', 5000000, 1, true,  'IDR', 'm1');
insert into procurement_erp_links (org_id, procurement_id, erp_purchase_document_id) values
  ('15130000-0000-0000-0000-00000000000a', '15130000-0000-0000-0000-0000000000f1', '15130000-0000-0000-0000-0000000e0d02'),
  ('15130000-0000-0000-0000-00000000000a', '15130000-0000-0000-0000-0000000000f1', '15130000-0000-0000-0000-0000000e0d03');
select is((select count(*)::int from subcontract_cap_exceptions('15130000-0000-0000-0000-0000000000f1')), 0,
  'OQ-10 a linked ERP Purchase Order, or a PMO-owned Purchase Invoice, is not an exception');
insert into procurement_erp_links (org_id, procurement_id, erp_purchase_document_id) values
  ('15130000-0000-0000-0000-00000000000a', '15130000-0000-0000-0000-0000000000f1', '15130000-0000-0000-0000-0000000e0d01');
select is((select reason from subcontract_cap_exceptions('15130000-0000-0000-0000-0000000000f1')), 'erp_linked_unattributed',
  'OQ-10 a linked ERP Purchase Invoice is an exception (it cannot carry lines)');
select is(procurement_payment_allowed('15130000-0000-0000-0000-0000000000f1'), 'subcontract_cap_exception',
  'OQ-10 a linked ERP Purchase Invoice blocks PMO payment');
select pg_temp.act_as('15130000-0000-0000-0000-0000000000a2');
set local role authenticated;
select throws_ok($$ select transition_procurement('15130000-0000-0000-0000-0000000000f1', 'Paid') $$,
  '23514', 'A linked ERP Purchase Invoice cannot be attributed to BoQ lines; cancel or unlink it in the ERP before payment.',
  'OQ-10 the Paid transition names the linked ERP Purchase Invoice and its remedy');
reset role;
select is(po_revision_push_refusal('15130000-0000-0000-0000-00000000000a', '15130000-0000-0000-0000-000000000101', 2, true),
  'po_has_submitted_bill', 'AC-SCA-012 a linked submitted ERP Purchase Invoice also refuses a cancel-style revise');
select is(po_revision_push_refusal('15130000-0000-0000-0000-00000000000a', '15130000-0000-0000-0000-000000000101', 2, null),
  'po_has_submitted_bill', 'AC-SCA-012 an unknown revise kind is treated as cancelling (fail closed)');
update erp_purchase_documents set erp_docstatus = 2 where id = '15130000-0000-0000-0000-0000000e0d01';
select is(procurement_payment_allowed('15130000-0000-0000-0000-0000000000f1'), null, 'OQ-10 the ERP cancelling the linked invoice clears it');
update erp_purchase_documents set erp_docstatus = 1 where id = '15130000-0000-0000-0000-0000000e0d01';
delete from procurement_erp_links where erp_purchase_document_id = '15130000-0000-0000-0000-0000000e0d01';
select is(procurement_payment_allowed('15130000-0000-0000-0000-0000000000f1'), null, 'OQ-10 unlinking the invoice clears it');
rollback to savepoint slink;

-- ── AC-SCA-012 (DB half): the push refusal fails closed ───────────────────────────────────────────────────────
select is(po_revision_push_refusal('15130000-0000-0000-0000-00000000000a', '15130000-0000-0000-0000-0000000000ff', 2, true), 'po_not_found',
  'AC-SCA-012 an unknown PO is refused (fail closed)');
select is(po_revision_push_refusal('15130000-0000-0000-0000-00000000000b', '15130000-0000-0000-0000-000000000101', 2, true), 'po_not_found',
  'AC-SCA-013 a PO of another org is not found');
select is(po_revision_push_refusal('15130000-0000-0000-0000-00000000000a', '15130000-0000-0000-0000-000000000101', 9, true), 'revision_not_issued',
  'AC-SCA-012 a revision that was never issued is refused');
select is(po_revision_push_refusal('15130000-0000-0000-0000-00000000000a', '15130000-0000-0000-0000-000000000101', null, true), 'revision_not_issued',
  'AC-SCA-012 an unreadable revision is refused');
select is(po_revision_push_refusal(null, null, 2, true), 'po_not_found', 'AC-SCA-012 null inputs are refused');

select * from finish();
rollback;

-- #1855 AC-CLIPH-001..009: an Admin imports PMO-native purchase history; nobody else can; reruns skip; nothing goes to an ERP.
begin;
select plan(27);
insert into organizations (id, name, default_currency) values
  ('18550000-0000-0000-0000-00000000000a','PH A','IDR'), ('18550000-0000-0000-0000-00000000000b','PH B','IDR');
insert into auth.users (id, email) values
  ('18550000-0000-0000-0000-0000000000a1','ph-admin@example.com'), ('18550000-0000-0000-0000-0000000000a2','ph-fin@example.com'),
  ('18550000-0000-0000-0000-0000000000a3','ph-pm@example.com'), ('18550000-0000-0000-0000-0000000000b1','ph-badmin@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('18550000-0000-0000-0000-0000000000a1','18550000-0000-0000-0000-00000000000a','Admin','ph-admin@example.com','Admin','active'),
  ('18550000-0000-0000-0000-0000000000a2','18550000-0000-0000-0000-00000000000a','Fin','ph-fin@example.com','Finance','active'),
  ('18550000-0000-0000-0000-0000000000a3','18550000-0000-0000-0000-00000000000a','PM','ph-pm@example.com','Project Manager','active'),
  ('18550000-0000-0000-0000-0000000000b1','18550000-0000-0000-0000-00000000000b','B Admin','ph-badmin@example.com','Admin','active');
insert into projects (id, org_id, name, status) values
  ('18550000-0000-0000-0000-0000000000d1','18550000-0000-0000-0000-00000000000a','PH A1','Ongoing Project'),
  ('18550000-0000-0000-0000-0000000000d3','18550000-0000-0000-0000-00000000000b','PH B1','Ongoing Project');
insert into companies (id, org_id, name, type) values
  ('18550000-0000-0000-0000-0000000000c1','18550000-0000-0000-0000-00000000000a','Vendor One','Vendor'),
  ('18550000-0000-0000-0000-0000000000c2','18550000-0000-0000-0000-00000000000a','Client One','Client'),
  ('18550000-0000-0000-0000-0000000000c3','18550000-0000-0000-0000-00000000000b','Vendor B','Vendor');

create temp table rows_t(label text primary key, r jsonb);
grant all on rows_t to authenticated;
insert into rows_t values
 ('unpaid', '{"import_key":"H-1","title":"Pump spares","project_id":"18550000-0000-0000-0000-0000000000d1","vendor_id":"18550000-0000-0000-0000-0000000000c1","approved_outside_pmo_by":"Owner, 2025-03-01","invoice":{"number":"INV-1","date":"2025-03-02","amount":1000,"tax_treatment":"exclusive","tax_amount":110}}'),
 ('paid', '{"import_key":"H-2","title":"Valves","project_id":"18550000-0000-0000-0000-0000000000d1","vendor_id":"18550000-0000-0000-0000-0000000000c1","approved_outside_pmo_by":"Owner, 2025-03-01","lines":[{"name":"Valve","quantity":2,"rate":500}],"order":{"number":"PO-9","date":"2025-02-01","amount":1000},"invoice":{"number":"INV-2","date":"2025-02-20","amount":1000,"tax_treatment":"exclusive","tax_amount":0},"payment":{"date":"2025-03-01","amount":1000}}'),
 ('novendor', '{"import_key":"H-3","title":"X","project_id":"18550000-0000-0000-0000-0000000000d1","vendor_id":"18550000-0000-0000-0000-0000000000ff","approved_outside_pmo_by":"Owner, 2025-03-01","order":{"date":"2025-02-01","amount":5}}'),
 ('clientvendor', '{"import_key":"H-4","title":"X","project_id":"18550000-0000-0000-0000-0000000000d1","vendor_id":"18550000-0000-0000-0000-0000000000c2","approved_outside_pmo_by":"Owner, 2025-03-01","order":{"date":"2025-02-01","amount":5}}'),
 ('otherorgproject', '{"import_key":"H-5","title":"X","project_id":"18550000-0000-0000-0000-0000000000d3","vendor_id":"18550000-0000-0000-0000-0000000000c1","approved_outside_pmo_by":"Owner, 2025-03-01","order":{"date":"2025-02-01","amount":5}}'),
 ('nonote', '{"import_key":"H-6","title":"X","project_id":"18550000-0000-0000-0000-0000000000d1","vendor_id":"18550000-0000-0000-0000-0000000000c1","order":{"date":"2025-02-01","amount":5}}'),
 ('nodocs', '{"import_key":"H-7","title":"X","project_id":"18550000-0000-0000-0000-0000000000d1","vendor_id":"18550000-0000-0000-0000-0000000000c1","approved_outside_pmo_by":"Owner, 2025-03-01"}'),
 ('overpay', '{"import_key":"H-8","title":"X","project_id":"18550000-0000-0000-0000-0000000000d1","vendor_id":"18550000-0000-0000-0000-0000000000c1","approved_outside_pmo_by":"Owner, 2025-03-01","invoice":{"date":"2025-02-20","amount":10,"tax_treatment":"exclusive","tax_amount":0},"payment":{"date":"2025-03-01","amount":11}}');

-- Finance (not Admin) is refused outright.
set local role authenticated;
set local request.jwt.claims = '{"sub":"18550000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select throws_ok($$select public.import_purchase_history((select jsonb_build_array(r) from rows_t where label='unpaid'), true)$$, '42501', null, 'AC-CLIPH-001 a Finance user cannot import');
set local request.jwt.claims = '{"sub":"18550000-0000-0000-0000-0000000000a3","role":"authenticated"}';
select throws_ok($$select public.import_purchase_history((select jsonb_build_array(r) from rows_t where label='unpaid'), false)$$, '42501', null, 'AC-CLIPH-001 a Project Manager cannot import (apply)');

-- Admin preview.
set local request.jwt.claims = '{"sub":"18550000-0000-0000-0000-0000000000a1","role":"authenticated"}';
create temp table out_t(label text primary key, j jsonb);
grant all on out_t to authenticated;
insert into out_t select 'dry', public.import_purchase_history((select jsonb_agg(r order by label) from rows_t), true);
select is((select j->'counts'->>'create' from out_t where label='dry'), '2', 'AC-CLIPH-002 preview: two rows would be created');
select is((select j->'counts'->>'refused' from out_t where label='dry'), '6', 'AC-CLIPH-002 preview: six rows refused');
select is((select count(*)::int from public.procurements where org_id='18550000-0000-0000-0000-00000000000a'), 0, 'AC-CLIPH-002 preview writes nothing');
select is((select count(*)::int from public.purchase_history_imports), 0, 'AC-CLIPH-002 preview stores no import record');
select is((select r->>'reason' from out_t, jsonb_array_elements(j->'results') r where label='dry' and r->>'import_key'='H-3'), 'vendor_not_found', 'AC-CLIPH-003 unknown vendor refused, not created');
select is((select r->>'reason' from out_t, jsonb_array_elements(j->'results') r where label='dry' and r->>'import_key'='H-4'), 'vendor_not_found', 'AC-CLIPH-003 a client is not a vendor');
select is((select r->>'reason' from out_t, jsonb_array_elements(j->'results') r where label='dry' and r->>'import_key'='H-5'), 'project_not_found', 'AC-CLIPH-003 another organisation''s project refused');
select is((select r->>'reason' from out_t, jsonb_array_elements(j->'results') r where label='dry' and r->>'import_key'='H-6'), 'required_field_missing', 'AC-CLIPH-004 the approved-outside note is mandatory');
select is((select r->>'reason' from out_t, jsonb_array_elements(j->'results') r where label='dry' and r->>'import_key'='H-7'), 'no_documents', 'AC-CLIPH-003 a row with no document is refused');
select is((select r->>'reason' from out_t, jsonb_array_elements(j->'results') r where label='dry' and r->>'import_key'='H-8'), 'payment_must_match_invoice', 'AC-CLIPH-003 a payment that is not the invoice total is refused');
select is((select r->>'status' from out_t, jsonb_array_elements(j->'results') r where label='dry' and r->>'import_key'='H-1'), 'Vendor Invoiced', 'AC-CLIPH-005 preview reports the derived status');

-- Apply.
insert into out_t select 'apply', public.import_purchase_history((select jsonb_agg(r order by label) from rows_t where label in ('unpaid','paid')), false);
select is((select count(*)::int from public.procurements where org_id='18550000-0000-0000-0000-00000000000a'), 2, 'AC-CLIPH-005 apply creates the two purchases');
select is((select status::text from public.procurements p join public.purchase_history_imports i on i.procurement_id=p.id where i.import_key='H-1'), 'Vendor Invoiced', 'AC-CLIPH-005 an unpaid invoice lands at Vendor Invoiced');
select is((select status::text from public.procurements p join public.purchase_history_imports i on i.procurement_id=p.id where i.import_key='H-2'), 'Paid', 'AC-CLIPH-005 a paid row lands at Paid');
select ok((select p.requested_by_id = '18550000-0000-0000-0000-0000000000a1' and p.approved_by_id is null and p.approved_total_value is null and p.amount_approved_by_id is null
             from public.procurements p join public.purchase_history_imports i on i.procurement_id=p.id where i.import_key='H-1'),
          'AC-CLIPH-004 requester is the importing Admin; no approver or approved amount is invented');
select is((select count(*)::int from public.audit_events where org_id='18550000-0000-0000-0000-00000000000a' and action='procurement.history_import' and detail->>'approved_outside_pmo_by'='Owner, 2025-03-01'), 2, 'AC-CLIPH-004 the outside approval note is in the audit trail');
select is((select count(*)::int from public.external_command_outbox where org_id='18550000-0000-0000-0000-00000000000a'), 0, 'AC-CLIPH-006 nothing is queued for an accounting system');
select is((select count(*)::int from public.procurement_items i join public.purchase_history_imports h on h.procurement_id=i.procurement_id where h.import_key='H-2'), 1, 'AC-CLIPH-005 lines are recorded');

-- Rerun: same file skips; a changed row is refused.
select is((select public.import_purchase_history((select jsonb_agg(r order by label) from rows_t where label in ('unpaid','paid')), false)->'counts'->>'skip'), '2', 'AC-CLIPH-007 the same file again skips every row');
select is((select count(*)::int from public.procurements where org_id='18550000-0000-0000-0000-00000000000a'), 2, 'AC-CLIPH-007 rerun creates nothing');
select is((select public.import_purchase_history(jsonb_build_array((select jsonb_set(r,'{title}','"Changed"') from rows_t where label='unpaid')), false)->'results'->0->>'reason'), 'import_key_payload_changed', 'AC-CLIPH-007 a changed row under the same key is refused');

-- An unpaid import is payable by Finance, and the preview flags it when the org requires approval before payment.
select is((select public.import_purchase_history(jsonb_build_array((select jsonb_set(jsonb_set(r,'{import_key}','"H-9"'),'{invoice,number}','"INV-9"') from rows_t where label='unpaid')), true)->'results'->0->>'payable'), 'true', 'AC-CLIPH-008 payable while the approval-before-payment setting is off');
set local request.jwt.claims = '{"sub":"18550000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select lives_ok($$select public.transition_procurement((select procurement_id from public.purchase_history_imports where import_key='H-1'), 'Paid'::procurement_status)$$, 'AC-CLIPH-008 Finance can pay an imported unpaid purchase through the app transition');
set local request.jwt.claims = '{"sub":"18550000-0000-0000-0000-0000000000a1","role":"authenticated"}';
reset role;
update organizations set procurement_gates = '{"approval_before_payment":true}'::jsonb where id='18550000-0000-0000-0000-00000000000a';
set local role authenticated;
set local request.jwt.claims = '{"sub":"18550000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select is((select public.import_purchase_history(jsonb_build_array((select jsonb_set(r,'{import_key}','"H-10"') from rows_t where label='unpaid')), true)->'results'->0->'warnings'->>0), 'not_payable:gate_approval_before_payment', 'AC-CLIPH-008 the preview warns when approval is required before payment');
select is((select public.import_purchase_history(jsonb_build_array((select jsonb_set(r,'{import_key}','"H-10"') from rows_t where label='unpaid')), true)->'counts'->>'not_payable'), '1', 'AC-CLIPH-008 the report counts rows that will not be payable');

select * from finish();
rollback;

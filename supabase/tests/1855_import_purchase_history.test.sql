-- #1855 AC-CLIPH-001..009: an Admin imports PMO-native purchase history; nobody else can; reruns skip; nothing goes to an ERP.
begin;
select plan(63);
insert into organizations (id, name, default_currency) values
  ('18550000-0000-0000-0000-00000000000a','PH A','IDR'), ('18550000-0000-0000-0000-00000000000b','PH B','IDR'),
  ('18550000-0000-0000-0000-00000000000c','PH C connected','IDR'), ('18550000-0000-0000-0000-00000000000d','PH D erp-owned','IDR');
insert into auth.users (id, email) values
  ('18550000-0000-0000-0000-0000000000a1','ph-admin@example.com'), ('18550000-0000-0000-0000-0000000000a2','ph-fin@example.com'),
  ('18550000-0000-0000-0000-0000000000a3','ph-pm@example.com'), ('18550000-0000-0000-0000-0000000000b1','ph-badmin@example.com'),
  ('18550000-0000-0000-0000-0000000000a5','ph-off@example.com'), ('18550000-0000-0000-0000-0000000000a6','ph-banned@example.com'),
  ('18550000-0000-0000-0000-0000000000c1','ph-cadmin@example.com'), ('18550000-0000-0000-0000-0000000000d1','ph-dadmin@example.com');
update auth.users set banned_until = now() + interval '1 day' where id = '18550000-0000-0000-0000-0000000000a6';
insert into profiles (id, org_id, full_name, email, role, status) values
  ('18550000-0000-0000-0000-0000000000a1','18550000-0000-0000-0000-00000000000a','Admin','ph-admin@example.com','Admin','active'),
  ('18550000-0000-0000-0000-0000000000a2','18550000-0000-0000-0000-00000000000a','Fin','ph-fin@example.com','Finance','active'),
  ('18550000-0000-0000-0000-0000000000a3','18550000-0000-0000-0000-00000000000a','PM','ph-pm@example.com','Project Manager','active'),
  ('18550000-0000-0000-0000-0000000000b1','18550000-0000-0000-0000-00000000000b','B Admin','ph-badmin@example.com','Admin','active'),
  ('18550000-0000-0000-0000-0000000000a5','18550000-0000-0000-0000-00000000000a','Off','ph-off@example.com','Admin','disabled'),
  ('18550000-0000-0000-0000-0000000000a6','18550000-0000-0000-0000-00000000000a','Banned','ph-banned@example.com','Admin','active'),
  ('18550000-0000-0000-0000-0000000000c1','18550000-0000-0000-0000-00000000000c','C Admin','ph-cadmin@example.com','Admin','active'),
  ('18550000-0000-0000-0000-0000000000d1','18550000-0000-0000-0000-00000000000d','D Admin','ph-dadmin@example.com','Admin','active');
insert into projects (id, org_id, name, status) values
  ('18550000-0000-0000-0000-0000000000d1','18550000-0000-0000-0000-00000000000a','PH A1','Ongoing Project'),
  ('18550000-0000-0000-0000-0000000000d3','18550000-0000-0000-0000-00000000000b','PH B1','Ongoing Project'),
  ('18550000-0000-0000-0000-0000000000d6','18550000-0000-0000-0000-00000000000a','PH A spend','Ongoing Project'),
  ('18550000-0000-0000-0000-0000000000d4','18550000-0000-0000-0000-00000000000c','PH C1','Ongoing Project'),
  ('18550000-0000-0000-0000-0000000000d5','18550000-0000-0000-0000-00000000000d','PH D1','Ongoing Project');
insert into companies (id, org_id, name, type) values
  ('18550000-0000-0000-0000-0000000000c1','18550000-0000-0000-0000-00000000000a','Vendor One','Vendor'),
  ('18550000-0000-0000-0000-0000000000c2','18550000-0000-0000-0000-00000000000a','Client One','Client'),
  ('18550000-0000-0000-0000-0000000000c3','18550000-0000-0000-0000-00000000000b','Vendor B','Vendor'),
  ('18550000-0000-0000-0000-0000000000c4','18550000-0000-0000-0000-00000000000a','Vendor Old','Vendor'),
  ('18550000-0000-0000-0000-0000000000c5','18550000-0000-0000-0000-00000000000c','Vendor C','Vendor'),
  ('18550000-0000-0000-0000-0000000000c6','18550000-0000-0000-0000-00000000000d','Vendor D','Vendor');
update companies set archived_at = now() where id = '18550000-0000-0000-0000-0000000000c4';
insert into external_org_bindings (org_id, external_tier, site_url, secret_ref, config, activated_at, status) values
  ('18550000-0000-0000-0000-00000000000c','erpnext','https://erp.example.test','test-ref','{"company":"Example Co"}'::jsonb, now(), 'active');
insert into external_domain_ownership (org_id, external_tier, domain) values ('18550000-0000-0000-0000-00000000000d','erpnext','procurement');

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
create temp table rows2_t(label text primary key, r jsonb);
grant all on rows2_t to authenticated;
insert into rows2_t values
 ('archived', '{"import_key":"H-9a","title":"X","project_id":"18550000-0000-0000-0000-0000000000d1","vendor_id":"18550000-0000-0000-0000-0000000000c4","approved_outside_pmo_by":"Owner","order":{"date":"2025-02-01","amount":5}}'),
 ('othervendor', '{"import_key":"H-9b","title":"X","project_id":"18550000-0000-0000-0000-0000000000d1","vendor_id":"18550000-0000-0000-0000-0000000000c3","approved_outside_pmo_by":"Owner","order":{"date":"2025-02-01","amount":5}}'),
 ('payonly', '{"import_key":"H-9c","title":"X","project_id":"18550000-0000-0000-0000-0000000000d1","vendor_id":"18550000-0000-0000-0000-0000000000c1","approved_outside_pmo_by":"Owner","payment":{"date":"2025-03-01","amount":5}}'),
 ('badproject', '{"import_key":"H-9d","title":"X","project_id":"not-a-uuid","vendor_id":"18550000-0000-0000-0000-0000000000c1","approved_outside_pmo_by":"Owner","order":{"date":"2025-02-01","amount":5}}'),
 ('baddate', '{"import_key":"H-9e","title":"X","project_id":"18550000-0000-0000-0000-0000000000d1","vendor_id":"18550000-0000-0000-0000-0000000000c1","approved_outside_pmo_by":"Owner","order":{"date":"bad","amount":5}}'),
 ('badnumber', '{"import_key":"H-9f","title":"X","project_id":"18550000-0000-0000-0000-0000000000d1","vendor_id":"18550000-0000-0000-0000-0000000000c1","approved_outside_pmo_by":"Owner","order":{"date":"2025-02-01","amount":"abc"}}'),
 ('badlines', '{"import_key":"H-9g","title":"X","project_id":"18550000-0000-0000-0000-0000000000d1","vendor_id":"18550000-0000-0000-0000-0000000000c1","approved_outside_pmo_by":"Owner","lines":{"a":1},"order":{"date":"2025-02-01","amount":5}}'),
 ('paidtax', '{"import_key":"H-11","title":"Paid with tax","project_id":"18550000-0000-0000-0000-0000000000d1","vendor_id":"18550000-0000-0000-0000-0000000000c1","approved_outside_pmo_by":"Owner","invoice":{"number":"INV-11","date":"2025-02-20","amount":1000,"tax_treatment":"exclusive","tax_amount":110},"payment":{"date":"2025-03-01","amount":1110}}'),
 ('paidincl', '{"import_key":"H-12","title":"Paid inclusive","project_id":"18550000-0000-0000-0000-0000000000d1","vendor_id":"18550000-0000-0000-0000-0000000000c1","approved_outside_pmo_by":"Owner","invoice":{"number":"INV-12","date":"2025-02-20","amount":1000,"tax_treatment":"inclusive","tax_amount":110},"payment":{"date":"2025-03-01","amount":1000}}'),
 ('orderonly', '{"import_key":"H-13","title":"Order only","project_id":"18550000-0000-0000-0000-0000000000d6","vendor_id":"18550000-0000-0000-0000-0000000000c1","approved_outside_pmo_by":"Owner","order":{"number":"PO-13","date":"2025-02-01","amount":300}}'),
 ('receiptonly', '{"import_key":"H-14","title":"Receipt only","project_id":"18550000-0000-0000-0000-0000000000d6","vendor_id":"18550000-0000-0000-0000-0000000000c1","approved_outside_pmo_by":"Owner","lines":[{"name":"Bolt","quantity":4,"rate":25}],"receipt":{"number":"GR-14","date":"2025-02-10","status":"Complete"}}');

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
select is((select count(*)::int from public.procurement_items i join public.purchase_history_imports h on h.procurement_id=i.procurement_id where h.import_key='H-2'), 1, 'AC-CLIPH-005 lines are recorded');

-- Rerun: same file skips; a changed row is refused.
select is((select public.import_purchase_history((select jsonb_agg(r order by label) from rows_t where label in ('unpaid','paid')), false)->'counts'->>'skip'), '2', 'AC-CLIPH-007 the same file again skips every row');
select is((select count(*)::int from public.procurements where org_id='18550000-0000-0000-0000-00000000000a'), 2, 'AC-CLIPH-007 rerun creates nothing');
select is((select public.import_purchase_history(jsonb_build_array((select jsonb_set(r,'{title}','"Changed"') from rows_t where label='unpaid')), false)->'results'->0->>'reason'), 'import_key_payload_changed', 'AC-CLIPH-007 a changed row under the same key is refused');

-- An unpaid import is payable by Finance, and the preview flags it when the org requires approval before payment.
select is((select public.import_purchase_history(jsonb_build_array((select jsonb_set(jsonb_set(r,'{import_key}','"H-9"'),'{invoice,number}','"INV-9"') from rows_t where label='unpaid')), true)->'results'->0->>'payable'), 'true', 'AC-CLIPH-008 payable while the approval-before-payment setting is off');
set local request.jwt.claims = '{"sub":"18550000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select lives_ok($$select public.transition_procurement((select procurement_id from public.purchase_history_imports where import_key='H-1'), 'Paid'::procurement_status)$$, 'AC-CLIPH-008 Finance pays an imported unpaid purchase through the app transition');
select is((select status::text from public.procurements where id=(select procurement_id from public.purchase_history_imports where import_key='H-1')), 'Paid', 'AC-CLIPH-008 the imported purchase is Paid afterwards');
select ok(exists (select 1 from public.payments where procurement_id=(select procurement_id from public.purchase_history_imports where import_key='H-1') and status='Paid'), 'AC-CLIPH-008 a Paid payment row exists for it');
set local request.jwt.claims = '{"sub":"18550000-0000-0000-0000-0000000000a1","role":"authenticated"}';

-- ===== review fixes =====
set local request.jwt.claims = '{"sub":"18550000-0000-0000-0000-0000000000a1","role":"authenticated"}';
-- Outer function: shape and member refusals.
set local request.jwt.claims = '{"sub":"18550000-0000-0000-0000-0000000000a5","role":"authenticated"}';
select throws_ok($$select public.import_purchase_history((select jsonb_build_array(r) from rows_t where label='unpaid'), true)$$, '42501', null, 'AC-CLIPH-001 an inactive Admin cannot import');
set local request.jwt.claims = '{"sub":"18550000-0000-0000-0000-0000000000a6","role":"authenticated"}';
select throws_ok($$select public.import_purchase_history((select jsonb_build_array(r) from rows_t where label='unpaid'), true)$$, '42501', null, 'AC-CLIPH-001 a banned Admin cannot import');
set local request.jwt.claims = '{"sub":"18550000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select throws_ok($$select public.import_purchase_history('{}'::jsonb, true)$$, '22023', 'invalid_history_rows', 'AC-CLIPH-009 a payload that is not an array is refused');
select throws_ok($$select public.import_purchase_history('[]'::jsonb, true)$$, '22023', 'invalid_history_rows', 'AC-CLIPH-009 an empty payload is refused');
select throws_ok($$select public.import_purchase_history((select jsonb_agg(jsonb_set(r,'{import_key}',to_jsonb('N-'||g::text))) from rows_t, generate_series(1,201) g where label='unpaid'), true)$$, '22023', 'invalid_history_rows', 'AC-CLIPH-009 more than 200 rows are refused');
select throws_ok($$select public.import_purchase_history((select jsonb_build_array(r || '{"surprise":1}'::jsonb) from rows_t where label='unpaid'), true)$$, '22023', 'invalid_history_rows', 'AC-CLIPH-009 an unknown field is refused');
select throws_ok($$select public.import_purchase_history((select jsonb_build_array(r, r) from rows_t where label='unpaid'), true)$$, '22023', 'duplicate_import_key', 'AC-CLIPH-009 a repeated import key in one file is refused');
select throws_ok($$select public.import_purchase_history((select jsonb_build_array(r) from rows_t where label='unpaid'), null)$$, '22023', 'invalid_history_rows', 'AC-CLIPH-009 a missing preview flag is refused');

-- Tenant isolation.
insert into out_t select 'x', public.import_purchase_history((select jsonb_build_array(r) from rows2_t where label='othervendor'), true);
select is((select j->'results'->0->>'reason' from out_t where label='x'), 'vendor_not_found', 'AC-CLIPH-010 another organisation''s vendor is refused');
delete from out_t where label='x';
insert into out_t select 'x', public.import_purchase_history((select jsonb_build_array(r) from rows2_t where label='archived'), true);
select is((select j->'results'->0->>'reason' from out_t where label='x'), 'vendor_not_found', 'AC-CLIPH-003 an archived vendor is refused');
delete from out_t where label='x';
set local request.jwt.claims = '{"sub":"18550000-0000-0000-0000-0000000000b1","role":"authenticated"}';
select is((select public.import_purchase_history(jsonb_build_array(jsonb_build_object('import_key','H-1','title','B purchase','project_id','18550000-0000-0000-0000-0000000000d3','vendor_id','18550000-0000-0000-0000-0000000000c3','approved_outside_pmo_by','B Owner','order',jsonb_build_object('date','2025-01-01','amount',7))), false)->'results'->0->>'outcome'), 'create', 'AC-CLIPH-010 the same import key in another organisation creates its own purchase');
select is((select count(*)::int from public.purchase_history_imports where import_key='H-1'), 1, 'AC-CLIPH-010 an organisation reads only its own import records');
reset role;
select is((select count(distinct org_id)::int from public.purchase_history_imports where import_key='H-1'), 2, 'AC-CLIPH-010 both organisations hold their own H-1');
set local role authenticated;
set local request.jwt.claims = '{"sub":"18550000-0000-0000-0000-0000000000a1","role":"authenticated"}';

-- Refusal reasons in plain terms.
insert into out_t select 'two', public.import_purchase_history((select jsonb_agg(r order by label) from rows2_t where label in ('payonly','badproject','baddate','badnumber','badlines')), true);
select is((select r->>'reason' from out_t, jsonb_array_elements(j->'results') r where label='two' and r->>'import_key'='H-9c'), 'payment_needs_invoice', 'AC-CLIPH-003 a payment without its invoice is refused');
select is((select r->>'message' from out_t, jsonb_array_elements(j->'results') r where label='two' and r->>'import_key'='H-9c'), 'a payment needs its invoice: add the invoice to this row', 'AC-CLIPH-003 and says why in plain words');
select is((select r->>'reason' from out_t, jsonb_array_elements(j->'results') r where label='two' and r->>'import_key'='H-9d'), 'invalid_value', 'AC-CLIPH-003 a malformed id is a plain reason');
select is((select r->>'reason' from out_t, jsonb_array_elements(j->'results') r where label='two' and r->>'import_key'='H-9e'), 'invalid_date', 'AC-CLIPH-003 a malformed date is a plain reason');
select is((select r->>'reason' from out_t, jsonb_array_elements(j->'results') r where label='two' and r->>'import_key'='H-9f'), 'invalid_value', 'AC-CLIPH-003 a non-numeric amount is a plain reason');
select is((select r->>'reason' from out_t, jsonb_array_elements(j->'results') r where label='two' and r->>'import_key'='H-9g'), 'invalid_shape', 'AC-CLIPH-003 lines that are not a list are a plain reason');

-- Every step lands where its furthest document says, and counts toward spend.
insert into out_t select 'steps', public.import_purchase_history((select jsonb_agg(r order by label) from rows2_t where label in ('paidtax','paidincl','orderonly','receiptonly')), false);
select is((select string_agg(r->>'import_key'||':'||(r->>'outcome'), ',' order by r->>'import_key') from out_t, jsonb_array_elements(j->'results') r where label='steps'), 'H-11:create,H-12:create,H-13:create,H-14:create', 'AC-CLIPH-005 all four step rows are created');
select is((select status::text from public.procurements p join public.purchase_history_imports i on i.procurement_id=p.id where i.import_key='H-13'), 'Ordered', 'AC-CLIPH-005 an order-only row lands at Ordered');
select is((select status::text from public.procurements p join public.purchase_history_imports i on i.procurement_id=p.id where i.import_key='H-14'), 'Received', 'AC-CLIPH-005 a receipt-only row lands at Received');
select is((select status::text from public.procurements p join public.purchase_history_imports i on i.procurement_id=p.id where i.import_key='H-11'), 'Paid', 'AC-CLIPH-005 a paid row with exclusive tax lands at Paid');
select is((select i.status::text||':'||i.amount::text||':'||i.tax_amount::text from public.procurement_invoices i join public.purchase_history_imports h on h.procurement_id=i.procurement_id where h.import_key='H-11'), 'Paid:1000.00:110.00', 'AC-CLIPH-005 its invoice is Paid at amount 1000 plus tax 110');
select is((select y.amount::text from public.payments y join public.purchase_history_imports h on h.procurement_id=y.procurement_id where h.import_key='H-11'), '1110.00', 'AC-CLIPH-005 its payment is the gross 1110');
select is((select i.status::text from public.procurement_invoices i join public.purchase_history_imports h on h.procurement_id=i.procurement_id where h.import_key='H-12'), 'Paid', 'AC-CLIPH-005 a paid inclusive-tax invoice is Paid at its amount');
select is((select sum(c.amount)::numeric from public.project_committed_spend('18550000-0000-0000-0000-0000000000d6') c where c.is_project_currency), 400::numeric, 'AC-CLIPH-005 imported order and receipt rows count toward the project''s spend (300 + 4 x 25)');

-- No accounting system involved, even where an enqueue could happen (a connected organisation).
set local request.jwt.claims = '{"sub":"18550000-0000-0000-0000-0000000000c1","role":"authenticated"}';
select is((select public.import_purchase_history(jsonb_build_array(jsonb_build_object('import_key','C-1','title','C','project_id','18550000-0000-0000-0000-0000000000d4','vendor_id','18550000-0000-0000-0000-0000000000c5','approved_outside_pmo_by','Owner','invoice',jsonb_build_object('date','2025-01-01','amount',9,'tax_treatment','exclusive','tax_amount',0),'payment',jsonb_build_object('date','2025-01-02','amount',9))), false)->'results'->0->>'erp_write'), 'false', 'AC-CLIPH-006 a connected organisation that owns its purchasing imports with erp_write false');
reset role;
select is((select count(*)::int from public.external_command_outbox where org_id='18550000-0000-0000-0000-00000000000c'), 0, 'AC-CLIPH-006 and nothing is queued for the accounting system');
set local role authenticated;

-- Procurement owned by an accounting system: the import is refused outright.
set local request.jwt.claims = '{"sub":"18550000-0000-0000-0000-0000000000d1","role":"authenticated"}';
select throws_ok($$select public.import_purchase_history(jsonb_build_array(jsonb_build_object('import_key','D-1','title','D','project_id','18550000-0000-0000-0000-0000000000d5','vendor_id','18550000-0000-0000-0000-0000000000c6','approved_outside_pmo_by','Owner','order',jsonb_build_object('date','2025-01-01','amount',9))), true)$$, '42501', 'procurement_externally_owned', 'AC-CLIPH-011 preview is refused where an accounting system owns purchasing');
select throws_ok($$select public.import_purchase_history(jsonb_build_array(jsonb_build_object('import_key','D-1','title','D','project_id','18550000-0000-0000-0000-0000000000d5','vendor_id','18550000-0000-0000-0000-0000000000c6','approved_outside_pmo_by','Owner','order',jsonb_build_object('date','2025-01-01','amount',9))), false)$$, '42501', 'procurement_externally_owned', 'AC-CLIPH-011 apply is refused too');
reset role;
select is((select count(*)::int from public.procurements where org_id='18550000-0000-0000-0000-00000000000d'), 0, 'AC-CLIPH-011 nothing was created there');
set local role authenticated;
set local request.jwt.claims = '{"sub":"18550000-0000-0000-0000-0000000000a1","role":"authenticated"}';

reset role;
update organizations set procurement_gates = '{"approval_before_payment":true}'::jsonb where id='18550000-0000-0000-0000-00000000000a';
set local role authenticated;
set local request.jwt.claims = '{"sub":"18550000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select is((select public.import_purchase_history(jsonb_build_array((select jsonb_set(r,'{import_key}','"H-10"') from rows_t where label='unpaid')), true)->'results'->0->'warnings'->>0), 'not_payable:gate_approval_before_payment', 'AC-CLIPH-008 the preview warns when approval is required before payment');
select is((select public.import_purchase_history(jsonb_build_array((select jsonb_set(r,'{import_key}','"H-10"') from rows_t where label='unpaid')), true)->'counts'->>'not_payable'), '1', 'AC-CLIPH-008 the report counts rows that will not be payable');

insert into out_t select 'gate', public.import_purchase_history((select jsonb_build_array(jsonb_set(r,'{import_key}','"G-1"')) from rows2_t where label='paidtax'), true);
select is((select j->'results'->0->>'reason' from out_t where label='gate'), 'approval_before_payment_on', 'AC-CLIPH-012 a paid row is refused while approval before payment is on');
select is((select j->'results'->0->>'message' from out_t where label='gate'), 'approval before payment is on: record an approved amount or turn it off for the import', 'AC-CLIPH-012 with a plain reason');
select is((select count(*)::int from public.purchase_history_imports where import_key='G-1'), 0, 'AC-CLIPH-012 and the preview wrote nothing');

select * from finish();
rollback;

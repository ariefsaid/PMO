-- #2321 AC-CLUI-005..016: an Admin takes back a purchase brought in by import_purchase_history, by its import key.
--   AC-CLUI-005 only an active Admin may call it (preview and apply); anon cannot execute it; a reason and a key are required.
--   AC-CLUI-006 preview is the default and writes nothing; it reports what would be removed.
--   AC-CLUI-007 apply removes only that import's rows; every other import and every purchase entered by hand is unchanged.
--   AC-CLUI-008 apply frees the import key: a corrected row under the same key imports; an unknown or other-organisation key is not found.
--   AC-CLUI-009 apply writes an audit event that keeps the reason and the imported row.
--   AC-CLUI-010 refused once a payment, receipt or invoice was recorded after the import (and any other later row: an added item,
--               a manual status change, a row in another table that references the purchase); a refusal deletes nothing and audits nothing.
--   AC-CLUI-011 an import that included its own payment is not "later work": it can be undone.
-- NOT EXECUTED when written (no Docker in the authoring session): CI's pgtap job is the proof.
-- MUTATION CHECKS to run (each must turn the named assertions red, then restore): drop the Admin test in the function -> AC-CLUI-005;
--   make p_dry_run ignored (always apply) -> AC-CLUI-006; delete the purchase_history_imports row only, not the procurement -> AC-CLUI-007/008;
--   delete without the org filter on the import lookup -> AC-CLUI-008 (other organisation); remove the payments count check -> the
--   later-payment refusal; remove the catalog scan -> the purchase_requests refusal; remove the log_audit call -> AC-CLUI-009.
begin;
select plan(43);
insert into organizations (id, name, default_currency) values
  ('23210000-0000-0000-0000-00000000000a','UI A','IDR'), ('23210000-0000-0000-0000-00000000000b','UI B','IDR');
insert into auth.users (id, email) values
  ('23210000-0000-0000-0000-0000000000a1','ui-admin@example.com'), ('23210000-0000-0000-0000-0000000000a2','ui-fin@example.com'),
  ('23210000-0000-0000-0000-0000000000a3','ui-pm@example.com'), ('23210000-0000-0000-0000-0000000000a5','ui-off@example.com'),
  ('23210000-0000-0000-0000-0000000000b1','ui-badmin@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('23210000-0000-0000-0000-0000000000a1','23210000-0000-0000-0000-00000000000a','Admin','ui-admin@example.com','Admin','active'),
  ('23210000-0000-0000-0000-0000000000a2','23210000-0000-0000-0000-00000000000a','Fin','ui-fin@example.com','Finance','active'),
  ('23210000-0000-0000-0000-0000000000a3','23210000-0000-0000-0000-00000000000a','PM','ui-pm@example.com','Project Manager','active'),
  ('23210000-0000-0000-0000-0000000000a5','23210000-0000-0000-0000-00000000000a','Off','ui-off@example.com','Admin','disabled'),
  ('23210000-0000-0000-0000-0000000000b1','23210000-0000-0000-0000-00000000000b','B Admin','ui-badmin@example.com','Admin','active');
insert into projects (id, org_id, name, status) values
  ('23210000-0000-0000-0000-0000000000d1','23210000-0000-0000-0000-00000000000a','UI A1','Ongoing Project'),
  ('23210000-0000-0000-0000-0000000000d2','23210000-0000-0000-0000-00000000000b','UI B1','Ongoing Project');
insert into companies (id, org_id, name, type) values
  ('23210000-0000-0000-0000-0000000000c1','23210000-0000-0000-0000-00000000000a','Vendor One','Vendor'),
  ('23210000-0000-0000-0000-0000000000c2','23210000-0000-0000-0000-00000000000a','Vendor Two','Vendor'),
  ('23210000-0000-0000-0000-0000000000c3','23210000-0000-0000-0000-00000000000b','Vendor B','Vendor');

create temp table rows_t(label text primary key, r jsonb);
grant all on rows_t to authenticated;
insert into rows_t
select k, jsonb_build_object('import_key', k, 'title', 'Purchase ' || k, 'project_id', '23210000-0000-0000-0000-0000000000d1',
  'vendor_id', '23210000-0000-0000-0000-0000000000c1', 'approved_outside_pmo_by', 'Owner, 2025-03-01') || extra
from (values
  ('U-1', '{"lines":[{"name":"Pump","quantity":2,"rate":500}],"order":{"number":"PO-1","date":"2025-02-01","amount":1000},"invoice":{"number":"INV-1","date":"2025-02-20","amount":1000,"tax_treatment":"exclusive","tax_amount":0}}'::jsonb),
  ('U-2', '{"order":{"number":"PO-2","date":"2025-02-01","amount":1000},"invoice":{"number":"INV-2","date":"2025-02-20","amount":1000,"tax_treatment":"exclusive","tax_amount":0},"payment":{"date":"2025-03-01","amount":1000}}'::jsonb),
  ('U-3', '{"lines":[{"name":"Bolt","quantity":4,"rate":25}],"receipt":{"number":"GR-3","date":"2025-02-10","status":"Complete"}}'::jsonb),
  ('U-4', '{"order":{"number":"PO-4","date":"2025-02-01","amount":300}}'::jsonb),
  ('U-5', '{"invoice":{"number":"INV-5","date":"2025-02-20","amount":500,"tax_treatment":"exclusive","tax_amount":0}}'::jsonb),
  ('U-6', '{"order":{"number":"PO-6","date":"2025-02-01","amount":60}}'::jsonb),
  ('U-7', '{"order":{"number":"PO-7","date":"2025-02-01","amount":70}}'::jsonb),
  ('U-8', '{"order":{"number":"PO-8","date":"2025-02-01","amount":80}}'::jsonb),
  ('U-9', '{"lines":[{"name":"Valve","quantity":3,"rate":10}],"receipt":{"number":"GR-9","date":"2025-02-10","status":"Complete"}}'::jsonb),
  ('U-10', '{"lines":[{"name":"Gasket","quantity":2,"rate":5}],"invoice":{"number":"INV-10","date":"2025-02-20","amount":10,"tax_treatment":"exclusive","tax_amount":0}}'::jsonb)
) v(k, extra);
create temp table out_t(label text primary key, j jsonb);
grant all on out_t to authenticated;
create temp table seed_t(label text primary key, j jsonb);
grant all on seed_t to authenticated;

-- Import as the Admin of organisation A, and one row in organisation B under the same key U-1.
set local role authenticated;
set local request.jwt.claims = '{"sub":"23210000-0000-0000-0000-0000000000a1","role":"authenticated"}';
insert into seed_t select 'a', public.import_purchase_history((select jsonb_agg(r order by label) from rows_t), false);
set local request.jwt.claims = '{"sub":"23210000-0000-0000-0000-0000000000b1","role":"authenticated"}';
insert into seed_t select 'b', public.import_purchase_history(jsonb_build_array(
  jsonb_build_object('import_key','U-1','title','B purchase','project_id','23210000-0000-0000-0000-0000000000d2','vendor_id','23210000-0000-0000-0000-0000000000c3',
    'approved_outside_pmo_by','B Owner','order',jsonb_build_object('date','2025-01-01','amount',7)),
  jsonb_build_object('import_key','B-ONLY','title','B only','project_id','23210000-0000-0000-0000-0000000000d2','vendor_id','23210000-0000-0000-0000-0000000000c3',
    'approved_outside_pmo_by','B Owner','order',jsonb_build_object('date','2025-01-01','amount',9))), false);
reset role;
-- A purchase entered by hand in organisation A, with an order and an item (not an import).
do $$ begin perform set_config('request.jwt.claims', '', true); end $$;
insert into procurements (id, org_id, code, title, requested_by_id, project_id, vendor_id) values
  ('23210000-0000-0000-0000-0000000000f1','23210000-0000-0000-0000-00000000000a','HAND-1','Entered by hand','23210000-0000-0000-0000-0000000000a1',
   '23210000-0000-0000-0000-0000000000d1','23210000-0000-0000-0000-0000000000c1');
insert into procurement_items (org_id, procurement_id, name, quantity, rate) values
  ('23210000-0000-0000-0000-00000000000a','23210000-0000-0000-0000-0000000000f1','Hand item',1,10);
insert into purchase_orders (org_id, procurement_id, po_number, status, date, amount) values
  ('23210000-0000-0000-0000-00000000000a','23210000-0000-0000-0000-0000000000f1','PO-HAND','Issued','2025-01-05',10);
create temp table ids_t(k text primary key, id uuid);
grant all on ids_t to authenticated;
insert into ids_t select import_key, procurement_id from purchase_history_imports where org_id = '23210000-0000-0000-0000-00000000000a';

-- AC-CLUI-005 who may call it.
set local role authenticated;
set local request.jwt.claims = '{"sub":"23210000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select throws_ok($$select public.undo_imported_purchase('U-1','Wrong vendor',true)$$, '42501', null, 'AC-CLUI-005 a Finance user cannot undo an import (preview)');
set local request.jwt.claims = '{"sub":"23210000-0000-0000-0000-0000000000a3","role":"authenticated"}';
select throws_ok($$select public.undo_imported_purchase('U-1','Wrong vendor',false)$$, '42501', null, 'AC-CLUI-005 a Project Manager cannot undo an import (apply)');
set local request.jwt.claims = '{"sub":"23210000-0000-0000-0000-0000000000a5","role":"authenticated"}';
select throws_ok($$select public.undo_imported_purchase('U-1','Wrong vendor',false)$$, '42501', null, 'AC-CLUI-005 a disabled Admin cannot undo an import');
reset role;
select ok(not has_function_privilege('anon', 'public.undo_imported_purchase(text,text,boolean)', 'execute'), 'AC-CLUI-005 anon holds no execute grant on the undo');
set local role anon;
select throws_ok($$select public.undo_imported_purchase('U-1','Wrong vendor',false)$$, '42501', null, 'AC-CLUI-005 anon cannot call the undo');
set local role authenticated;
set local request.jwt.claims = '{"sub":"23210000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select throws_ok($$select public.undo_imported_purchase('U-1','  ',false)$$, '22023', 'reason_required', 'AC-CLUI-005 a reason is required');
select throws_ok($$select public.undo_imported_purchase('  ','Wrong vendor',false)$$, '22023', 'import_key_required', 'AC-CLUI-005 an import key is required');
select is(public.undo_imported_purchase('NO-SUCH','Wrong vendor',false)->>'reason', 'import_not_found', 'AC-CLUI-008 an unknown key is not found');
select is(public.undo_imported_purchase('B-ONLY','Wrong vendor',false)->>'reason', 'import_not_found', 'AC-CLUI-008 another organisation''s key is not found');

-- AC-CLUI-006 preview.
insert into out_t select 'prev', public.undo_imported_purchase('U-1','Wrong vendor',true);
select ok((select j->>'outcome' = 'undo' and (j->>'dry_run')::boolean from out_t where label='prev'), 'AC-CLUI-006 preview says it would undo');
select is((select j->'would_remove'->>'items' from out_t where label='prev'), '1', 'AC-CLUI-006 preview counts the import''s item');
select ok((select (j->'would_remove'->>'purchase_orders')::int = 1 and (j->'would_remove'->>'invoices')::int = 1 and (j->'would_remove'->>'payments')::int = 0
             and (j->'would_remove'->>'receipts')::int = 0 from out_t where label='prev'), 'AC-CLUI-006 preview counts the import''s documents');
select ok(exists (select 1 from public.procurements where id=(select id from ids_t where k='U-1'))
          and exists (select 1 from public.purchase_history_imports where import_key='U-1' and org_id='23210000-0000-0000-0000-00000000000a'), 'AC-CLUI-006 preview deletes nothing');
reset role;
select is((select count(*)::int from public.audit_events where action='procurement.history_import_undo'), 0, 'AC-CLUI-006 preview writes no audit event');
set local role authenticated;
select ok((select (public.undo_imported_purchase('U-1','Wrong vendor')->>'dry_run')::boolean), 'AC-CLUI-006 the default is a preview');

-- AC-CLUI-007/008/009 apply U-1.
insert into out_t select 'apply', public.undo_imported_purchase('U-1','Wrong vendor',false);
select ok((select j->>'outcome' = 'undo' and not (j->>'dry_run')::boolean from out_t where label='apply'), 'AC-CLUI-007 apply undoes the import');
select ok(not exists (select 1 from public.procurements where id=(select id from ids_t where k='U-1')), 'AC-CLUI-007 the purchase is gone');
select ok(not exists (select 1 from public.purchase_history_imports where import_key='U-1' and org_id='23210000-0000-0000-0000-00000000000a'), 'AC-CLUI-008 the import key is free');
select is((select (select count(*) from public.procurement_items where procurement_id=(select id from ids_t where k='U-1'))
               + (select count(*) from public.purchase_orders where procurement_id=(select id from ids_t where k='U-1'))
               + (select count(*) from public.procurement_invoices where procurement_id=(select id from ids_t where k='U-1'))
               + (select count(*) from public.procurement_status_events where procurement_id=(select id from ids_t where k='U-1')))::int, 0, 'AC-CLUI-007 its items, order, invoice and status events are gone');
select is((select count(*)::int from public.purchase_history_imports where org_id='23210000-0000-0000-0000-00000000000a'), 9, 'AC-CLUI-007 the other nine imports of the organisation remain');
select is((select count(*)::int from public.procurements where org_id='23210000-0000-0000-0000-00000000000a'), 10, 'AC-CLUI-007 the other imported purchases and the hand-entered one remain');
select ok(exists (select 1 from public.procurements where id='23210000-0000-0000-0000-0000000000f1')
          and (select count(*) from public.procurement_items where procurement_id='23210000-0000-0000-0000-0000000000f1') = 1
          and (select count(*) from public.purchase_orders where procurement_id='23210000-0000-0000-0000-0000000000f1') = 1, 'AC-CLUI-007 the purchase entered by hand is unchanged');
reset role;
select ok(exists (select 1 from public.purchase_history_imports where org_id='23210000-0000-0000-0000-00000000000b' and import_key='U-1')
          and exists (select 1 from public.procurements where org_id='23210000-0000-0000-0000-00000000000b' and title='B purchase'), 'AC-CLUI-007 the other organisation''s import under the same key is unchanged');
select ok(exists (select 1 from public.audit_events where org_id='23210000-0000-0000-0000-00000000000a' and action='procurement.history_import_undo'
                    and detail->>'reason'='Wrong vendor' and detail->>'import_key'='U-1' and detail->'payload'->>'title'='Purchase U-1'), 'AC-CLUI-009 the audit event keeps the reason and the imported row');
set local role authenticated;
set local request.jwt.claims = '{"sub":"23210000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select is(public.undo_imported_purchase('U-1','Wrong vendor',false)->>'reason', 'import_not_found', 'AC-CLUI-008 a second undo of the same key finds nothing');

-- AC-CLUI-008 a corrected row imports under the freed key.
select is((select public.import_purchase_history((select jsonb_build_array(jsonb_set(r, '{vendor_id}', '"23210000-0000-0000-0000-0000000000c2"')) from rows_t where label='U-1'), false)->'counts'->>'create'), '1', 'AC-CLUI-008 the corrected row under the freed key is created');
select is((select vendor_id::text from public.procurements p join public.purchase_history_imports i on i.procurement_id=p.id where i.import_key='U-1' and i.org_id='23210000-0000-0000-0000-00000000000a'),
          '23210000-0000-0000-0000-0000000000c2', 'AC-CLUI-008 the re-imported purchase has the corrected vendor');

-- AC-CLUI-011 an import that carried its own payment can be undone.
select ok((select (public.undo_imported_purchase('U-2','Duplicate of U-1',true)->'would_remove'->>'payments')::int = 1), 'AC-CLUI-011 preview of an import with its own payment says it would undo');
insert into out_t select 'u2', public.undo_imported_purchase('U-2','Duplicate of U-1',false);
select ok(not exists (select 1 from public.payments where procurement_id=(select id from ids_t where k='U-2'))
          and not exists (select 1 from public.procurements where id=(select id from ids_t where k='U-2')), 'AC-CLUI-011 apply removes the import''s payment and purchase');

-- AC-CLUI-010 later records (entered after the import, as a person would: no JWT, so no gates run).
reset role;
do $$ begin perform set_config('request.jwt.claims', '', true); end $$;
insert into payments (org_id, procurement_id, invoice_id, pay_number, status, date, amount) values
  ('23210000-0000-0000-0000-00000000000a', (select id from ids_t where k='U-5'),
   (select id from procurement_invoices where procurement_id=(select id from ids_t where k='U-5')), 'PAY-LATE', 'Paid', '2025-04-01', 500);
insert into procurement_receipts (org_id, procurement_id, gr_number, receipt_date, status) values
  ('23210000-0000-0000-0000-00000000000a', (select id from ids_t where k='U-4'), 'GR-LATE', '2025-04-01', 'Complete');
insert into procurement_invoices (org_id, procurement_id, vi_number, invoice_date, status, amount, tax_treatment, tax_amount) values
  ('23210000-0000-0000-0000-00000000000a', (select id from ids_t where k='U-3'), 'INV-LATE', '2025-04-01', 'Received', 25, 'exclusive', 0);
insert into procurement_status_events (procurement_id, org_id, from_status, to_status, notes) values
  ((select id from ids_t where k='U-6'), '23210000-0000-0000-0000-00000000000a', 'Ordered', 'Cancelled', 'Manual: cancelled by a person');
insert into procurement_items (org_id, procurement_id, name, quantity, rate) values
  ('23210000-0000-0000-0000-00000000000a', (select id from ids_t where k='U-7'), 'Added later', 1, 5);
insert into purchase_requests (org_id, procurement_id, pr_number, status) values
  ('23210000-0000-0000-0000-00000000000a', (select id from ids_t where k='U-8'), 'PR-LATE', 'Draft');
insert into procurement_receipt_lines (receipt_id, item_id, org_id, quantity, recorded_by) values
  ((select id from procurement_receipts where procurement_id=(select id from ids_t where k='U-9')),
   (select id from procurement_items where procurement_id=(select id from ids_t where k='U-9')),
   '23210000-0000-0000-0000-00000000000a', 3, '23210000-0000-0000-0000-0000000000a1');
insert into procurement_bill_matches (invoice_id, org_id, recorded_by) values
  ((select id from procurement_invoices where procurement_id=(select id from ids_t where k='U-10')),
   '23210000-0000-0000-0000-00000000000a', '23210000-0000-0000-0000-0000000000a1');
set local role authenticated;
set local request.jwt.claims = '{"sub":"23210000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select is(public.undo_imported_purchase('U-5','Wrong project',true)->>'reason', 'has_later_records', 'AC-CLUI-010 a later payment refuses the undo (preview)');
select ok((public.undo_imported_purchase('U-5','Wrong project',false)->'blocked_by') @> '["payments"]'::jsonb, 'AC-CLUI-010 apply is refused too, naming the payment');
select ok(exists (select 1 from public.procurements where id=(select id from ids_t where k='U-5'))
          and exists (select 1 from public.payments where pay_number='PAY-LATE') and exists (select 1 from public.purchase_history_imports where import_key='U-5'), 'AC-CLUI-010 a refusal deletes nothing');
select is((public.undo_imported_purchase('U-4','Wrong vendor',false)->'blocked_by')::text, '["procurement_receipts"]', 'AC-CLUI-010 a later receipt refuses the undo');
select is((public.undo_imported_purchase('U-3','Wrong vendor',false)->'blocked_by')::text, '["procurement_invoices"]', 'AC-CLUI-010 a later invoice refuses the undo');
select is((public.undo_imported_purchase('U-6','Wrong vendor',false)->'blocked_by')::text, '["procurement_status_events"]', 'AC-CLUI-010 a later status change refuses the undo');
select is((public.undo_imported_purchase('U-7','Wrong vendor',false)->'blocked_by')::text, '["procurement_items"]', 'AC-CLUI-010 an item added later refuses the undo');
select is((public.undo_imported_purchase('U-8','Wrong vendor',false)->'blocked_by')::text, '["purchase_requests"]', 'AC-CLUI-010 a row in another table that references the purchase refuses the undo');
select ok((public.undo_imported_purchase('U-9','Wrong vendor',false)->'blocked_by') @> '["procurement_receipt_lines"]'::jsonb, 'AC-CLUI-010 a receipt line recorded on the imported receipt refuses the undo (a cascading child)');
select ok((public.undo_imported_purchase('U-10','Wrong vendor',false)->'blocked_by') @> '["procurement_bill_matches"]'::jsonb, 'AC-CLUI-010 a bill match recorded on the imported invoice refuses the undo (a cascading child)');
reset role;
select ok(exists (select 1 from public.procurement_receipt_lines where receipt_id=(select id from procurement_receipts where procurement_id=(select id from ids_t where k='U-9')))
          and exists (select 1 from public.procurement_receipts where procurement_id=(select id from ids_t where k='U-9'))
          and exists (select 1 from public.procurement_items where procurement_id=(select id from ids_t where k='U-9'))
          and exists (select 1 from public.purchase_history_imports where import_key='U-9' and org_id='23210000-0000-0000-0000-00000000000a'), 'AC-CLUI-010 the refused receipt-line case deleted nothing');
select ok(exists (select 1 from public.procurement_bill_matches where invoice_id=(select id from procurement_invoices where procurement_id=(select id from ids_t where k='U-10')))
          and exists (select 1 from public.procurement_invoices where procurement_id=(select id from ids_t where k='U-10'))
          and exists (select 1 from public.purchase_history_imports where import_key='U-10' and org_id='23210000-0000-0000-0000-00000000000a'), 'AC-CLUI-010 the refused bill-match case deleted nothing');
select is((select count(*)::int from public.audit_events where action='procurement.history_import_undo'), 2, 'AC-CLUI-010 refusals write no audit event (only the two undone imports are audited)');
select is((select count(*)::int from public.purchase_history_imports where org_id='23210000-0000-0000-0000-00000000000a' and import_key in ('U-3','U-4','U-5','U-6','U-7','U-8','U-9','U-10')), 8, 'AC-CLUI-010 the refused imports keep their records');

select * from finish();
rollback;

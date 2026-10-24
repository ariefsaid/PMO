-- Round trip for 0378 (recorded by PMO = a reference to a live PMO record of the same kind): down, then up again.
-- Run by scripts/test-erp-document-recorded-by-pmo-rollback.sh, which inlines the migration files at the markers.
-- The down half is the mutation check: on the 0361 rule a reference to nothing hides the document and refuses it.
begin;
select plan(9);
insert into organizations (id, name, default_currency) values ('03789000-0000-0000-0000-00000000000a','RBP RT','IDR');
insert into auth.users (id, email) values ('03789000-0000-0000-0000-0000000000a1','rbp-rt@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('03789000-0000-0000-0000-0000000000a1','03789000-0000-0000-0000-00000000000a','RT Fin','rbp-rt@example.com','Finance','active');
insert into external_refs (org_id, domain, pmo_record_id, external_tier, external_record_id) values
  ('03789000-0000-0000-0000-00000000000a','procurement','7d1c0000-0000-4000-8000-0000000000aa','erpnext','PINV-RT');
select upsert_erp_purchase_documents('03789000-0000-0000-0000-00000000000a',
  '[{"erp_doctype":"Purchase Invoice","erp_name":"PINV-RT","supplier":"S","currency":"IDR","grand_total":1,"erp_docstatus":1,"erp_modified":"2026-02-01"}]');
select ok(not (select pmo_owned from erp_purchase_documents where erp_name = 'PINV-RT'), 'before: a dangling reference does not own the document');
-- @0378_DOWN@
select hasnt_function('public','erp_document_recorded_by_pmo', array['uuid','text','text'], 'down 0378: the helper is gone');
select ok((select pmo_owned from erp_purchase_documents where erp_name = 'PINV-RT'),
  'down 0378 (mutation check): the 0361 rule restamps the document as recorded by PMO');
set local role authenticated;
set local request.jwt.claims = '{"sub":"03789000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select is(mark_erp_purchase_documents('[{"erp_name":"PINV-RT"}]') #>> '{results,0,reason}', 'document_recorded_by_pmo',
  'down 0378 (mutation check): set-aside is refused on a dangling reference');
select is(link_erp_purchase_documents('[{"erp_name":"PINV-RT"}]') #>> '{results,0,reason}', 'document_recorded_by_pmo',
  'down 0378 (mutation check): link is refused on a dangling reference');
reset role;
-- @0378_UP@
select has_function('public','erp_document_recorded_by_pmo', array['uuid','text','text'], 'up again: the helper');
select ok(not (select pmo_owned from erp_purchase_documents where erp_name = 'PINV-RT'), 'up again: the stamp is recomputed');
set local role authenticated;
set local request.jwt.claims = '{"sub":"03789000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select is(mark_erp_purchase_documents('[{"erp_name":"PINV-RT"}]', 'note', true) #>> '{results,0,reason}', 'note_missing',
  'up again: set-aside checks pass the recorded-by-PMO rule (dry-run note reaches the note check)');
select is(mark_erp_purchase_documents('[{"erp_name":"PINV-RT"}]', 'set_aside', true) #>> '{results,0,outcome}', 'apply',
  'up again: a dangling reference no longer refuses set-aside');
reset role;
select * from finish();
rollback;

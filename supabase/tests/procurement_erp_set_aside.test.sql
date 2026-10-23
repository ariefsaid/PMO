-- procurement_erp_set_aside.test.sql — 0364. Owns AC-13d of #1319 (set aside unlinked ERP documents as overhead).
-- Mutation checks (each must go red): drop 'Finance' or 'Admin' from the role list in mark_erp_purchase_documents
-- (role rows), delete the assert_is_active_member() call (disabled row), drop `where not set_aside` from
-- erp_purchase_orphans (default-list row).
begin;
select plan(32);

insert into organizations (id, name, default_currency) values
  ('03640000-0000-0000-0000-00000000000a','SA A','IDR'), ('03640000-0000-0000-0000-00000000000b','SA B','IDR');
insert into auth.users (id, email) values
  ('03640000-0000-0000-0000-0000000000a1','sa-fin@example.com'),  ('03640000-0000-0000-0000-0000000000a2','sa-admin@example.com'),
  ('03640000-0000-0000-0000-0000000000a3','sa-pm@example.com'),   ('03640000-0000-0000-0000-0000000000a4','sa-exec@example.com'),
  ('03640000-0000-0000-0000-0000000000a5','sa-eng@example.com'),  ('03640000-0000-0000-0000-0000000000a6','sa-gone@example.com'),
  ('03640000-0000-0000-0000-0000000000b1','sa-b@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('03640000-0000-0000-0000-0000000000a1','03640000-0000-0000-0000-00000000000a','Fin','sa-fin@example.com','Finance','active'),
  ('03640000-0000-0000-0000-0000000000a2','03640000-0000-0000-0000-00000000000a','Admin','sa-admin@example.com','Admin','active'),
  ('03640000-0000-0000-0000-0000000000a3','03640000-0000-0000-0000-00000000000a','PM','sa-pm@example.com','Project Manager','active'),
  ('03640000-0000-0000-0000-0000000000a4','03640000-0000-0000-0000-00000000000a','Exec','sa-exec@example.com','Executive','active'),
  ('03640000-0000-0000-0000-0000000000a5','03640000-0000-0000-0000-00000000000a','Eng','sa-eng@example.com','Engineer','active'),
  ('03640000-0000-0000-0000-0000000000a6','03640000-0000-0000-0000-00000000000a','Gone','sa-gone@example.com','Finance','disabled'),
  ('03640000-0000-0000-0000-0000000000b1','03640000-0000-0000-0000-00000000000b','B Fin','sa-b@example.com','Finance','active');
select upsert_erp_purchase_documents('03640000-0000-0000-0000-00000000000a', $$[
 {"erp_doctype":"Purchase Invoice","erp_name":"PI-RENT","supplier":"S","currency":"IDR","grand_total":10,"erp_docstatus":1,"erp_modified":"2026-02-01"},
 {"erp_doctype":"Purchase Invoice","erp_name":"PI-CLOUD","supplier":"S","currency":"IDR","grand_total":20,"erp_docstatus":1,"erp_modified":"2026-02-01"},
 {"erp_doctype":"Purchase Invoice","erp_name":"PI-OPEN","supplier":"S","currency":"IDR","grand_total":30,"erp_docstatus":1,"erp_modified":"2026-02-01"},
 {"erp_doctype":"Purchase Invoice","erp_name":"PI-LINKED","supplier":"S","currency":"IDR","grand_total":40,"erp_docstatus":1,"erp_modified":"2026-02-01"}]$$::jsonb);
select upsert_erp_purchase_documents('03640000-0000-0000-0000-00000000000b',
  '[{"erp_doctype":"Purchase Invoice","erp_name":"PI-RENT","supplier":"S","currency":"IDR","grand_total":1,"erp_docstatus":1,"erp_modified":"2026-02-01"}]');
insert into procurements (id, org_id, title, requested_by_id, currency, total_value, status) values
  ('03640000-0000-0000-0000-0000000000e1','03640000-0000-0000-0000-00000000000a','P1','03640000-0000-0000-0000-0000000000a1','IDR',1,'Draft');
insert into procurement_erp_links (org_id, procurement_id, erp_purchase_document_id)
  select '03640000-0000-0000-0000-00000000000a','03640000-0000-0000-0000-0000000000e1', id from erp_purchase_documents where erp_name = 'PI-LINKED';

-- Admin and Finance can set aside
set local role authenticated;
set local request.jwt.claims = '{"sub":"03640000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select is(mark_erp_purchase_documents('[{"erp_name":"PI-RENT","note":"rent"},{"erp_doctype":"Purchase Invoice","erp_name":"PI-CLOUD"}]'::jsonb) #>> '{counts,apply}', '2',
  'AC-13a Finance sets aside many documents in one call');
select is((select array_agg(erp_name order by erp_name) from erp_purchase_orphans), array['PI-OPEN'],
  'AC-13a the default orphan list hides set-aside documents');
select is((select array_agg(erp_name order by erp_name) from erp_purchase_orphans_all where set_aside), array['PI-CLOUD','PI-RENT'],
  'AC-13a the include-set-aside list shows them flagged');
select is((select note from erp_purchase_orphans_all where erp_name = 'PI-RENT'), 'rent', 'AC-13b the note is shown in the list');
select is(mark_erp_purchase_documents('[{"erp_name":"PI-RENT"}]'::jsonb) #>> '{results,0,reason}', 'no_change', 'AC-13a setting aside twice is a no-op');
select is(mark_erp_purchase_documents('[{"erp_name":"PI-OPEN"}]'::jsonb, 'set_aside', true) #>> '{counts,apply}', '1', 'AC-13c a dry run reports the change');
select is((select count(*) from erp_purchase_orphans), 1::bigint, 'AC-13c a dry run changes nothing');

-- undo
select is(mark_erp_purchase_documents('[{"erp_name":"PI-CLOUD"}]'::jsonb, 'undo') #>> '{counts,apply}', '1', 'AC-13a undo works');
select is((select array_agg(erp_name order by erp_name) from erp_purchase_orphans), array['PI-CLOUD','PI-OPEN'], 'AC-13a an undone document is back in the default list');
select is((select note from erp_purchase_orphans_all where erp_name = 'PI-RENT'), 'rent', 'AC-13a undo keeps the note');

-- note without set-aside
select is(mark_erp_purchase_documents('[{"erp_name":"PI-OPEN","note":"project to confirm with accountant"}]'::jsonb, 'note') #>> '{counts,apply}', '1',
  'AC-13b a note can be set without setting aside');
select is((select note from erp_purchase_orphans where erp_name = 'PI-OPEN'), 'project to confirm with accountant', 'AC-13b the note shows on a still-open document');
select is(mark_erp_purchase_documents(jsonb_build_array(jsonb_build_object('erp_name','PI-OPEN','note',repeat('x',501))), 'note') #>> '{results,0,reason}',
  'note_too_long', 'AC-13b a note over 500 characters is refused');

-- linked refused
select is(mark_erp_purchase_documents('[{"erp_name":"PI-LINKED"}]'::jsonb) #>> '{results,0,reason}', 'document_linked', 'AC-13a a linked document is refused');
reset role;

select is((select count(*) from audit_events where action = 'procurement.erp_set_aside'), 2::bigint, 'AC-13a each set-aside is audited');

-- re-sync keeps the state
select upsert_erp_purchase_documents('03640000-0000-0000-0000-00000000000a',
  '[{"erp_doctype":"Purchase Invoice","erp_name":"PI-RENT","supplier":"S","currency":"IDR","grand_total":99,"erp_docstatus":1,"erp_modified":"2026-03-01"}]');
select is((select grand_total from erp_purchase_documents where erp_name = 'PI-RENT' and org_id = '03640000-0000-0000-0000-00000000000a'), 99::numeric, 'resync really rewrote the document');
select is((select count(*) from erp_purchase_document_marks m join erp_purchase_documents d on d.id = m.erp_purchase_document_id
            where d.erp_name = 'PI-RENT' and m.set_aside_at is not null), 1::bigint, 'AC-13d a re-sync keeps the set-aside state');

-- clear-on-link: linking a set-aside document clears the flag and keeps the note; unlinking returns it to the default list
select upsert_erp_purchase_documents('03640000-0000-0000-0000-00000000000a',
  '[{"erp_doctype":"Purchase Invoice","erp_name":"PI-LNK","supplier":"S","currency":"IDR","grand_total":5,"erp_docstatus":1,"erp_modified":"2026-02-01"}]');
set local role authenticated;
set local request.jwt.claims = '{"sub":"03640000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select mark_erp_purchase_documents('[{"erp_name":"PI-LNK","note":"keep me"}]'::jsonb);
select link_erp_purchase_documents('[{"erp_name":"PI-LNK"}]'::jsonb);
reset role;
select is((select set_aside_at from erp_purchase_document_marks m join erp_purchase_documents d on d.id = m.erp_purchase_document_id
            where d.erp_name = 'PI-LNK' and d.org_id = '03640000-0000-0000-0000-00000000000a'), null::timestamptz, 'AC-13a linking a set-aside document clears the set-aside flag');
select is((select note from erp_purchase_document_marks m join erp_purchase_documents d on d.id = m.erp_purchase_document_id
            where d.erp_name = 'PI-LNK' and d.org_id = '03640000-0000-0000-0000-00000000000a'), 'keep me', 'AC-13b linking keeps the note');
select is((select updated_by from erp_purchase_document_marks m join erp_purchase_documents d on d.id = m.erp_purchase_document_id
            where d.erp_name = 'PI-LNK' and d.org_id = '03640000-0000-0000-0000-00000000000a'), null::uuid, 'AC-13a the clear leaves no stale updated_by');
set local role authenticated;
set local request.jwt.claims = '{"sub":"03640000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select lives_ok($$ select unlink_erp_purchase_document((select l.id from procurement_erp_links l join erp_purchase_documents d on d.id = l.erp_purchase_document_id where d.erp_name = 'PI-LNK')) $$,
  'AC-13a Finance unlinks the document');
select is((select note from erp_purchase_orphans where erp_name = 'PI-LNK'), 'keep me', 'AC-13a after unlinking, the document is back in the default list with its note');
select throws_ok($$ insert into erp_purchase_document_marks (erp_purchase_document_id, org_id, note)
  select id, org_id, 'x' from erp_purchase_documents where erp_name = 'PI-OPEN' and org_id = '03640000-0000-0000-0000-00000000000a' $$,
  '42501', null, 'AC-13d a member cannot insert into the marks table directly');
select throws_ok($$ update erp_purchase_document_marks set note = 'x' $$, '42501', null, 'AC-13d a member cannot update the marks table directly');
reset role;

-- Admin can too; every other reader refused
set local role authenticated;
set local request.jwt.claims = '{"sub":"03640000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select is(mark_erp_purchase_documents('[{"erp_name":"PI-OPEN"}]'::jsonb) #>> '{counts,apply}', '1', 'AC-13d Admin may set aside');
reset role;
select set_config('sa.sql_pm', $$ select mark_erp_purchase_documents('[{"erp_name":"PI-CLOUD"}]'::jsonb) $$, true);
set local role authenticated;
set local request.jwt.claims = '{"sub":"03640000-0000-0000-0000-0000000000a3","role":"authenticated"}';
select throws_ok(current_setting('sa.sql_pm'), '42501', null, 'AC-13d a Project Manager is refused');
set local request.jwt.claims = '{"sub":"03640000-0000-0000-0000-0000000000a4","role":"authenticated"}';
select throws_ok(current_setting('sa.sql_pm'), '42501', null, 'AC-13d an Executive is refused');
select is((select count(*) from erp_purchase_orphans_all), 4::bigint, 'AC-13d an Executive reads the orphan list (audience)');
set local request.jwt.claims = '{"sub":"03640000-0000-0000-0000-0000000000a5","role":"authenticated"}';
select throws_ok(current_setting('sa.sql_pm'), '42501', null, 'AC-13d an Engineer is refused');
set local request.jwt.claims = '{"sub":"03640000-0000-0000-0000-0000000000a6","role":"authenticated"}';
select throws_ok(current_setting('sa.sql_pm'), null, null, 'AC-13d a disabled member is refused');

-- org scope
set local request.jwt.claims = '{"sub":"03640000-0000-0000-0000-0000000000b1","role":"authenticated"}';
select is((select count(*) from erp_purchase_document_marks), 0::bigint, 'AC-13d org B sees none of org A''s marks');
select is(mark_erp_purchase_documents('[{"erp_name":"PI-CLOUD"}]'::jsonb) #>> '{results,0,reason}', 'document_not_found', 'AC-13d org B cannot reach org A''s documents');
reset role;
select * from finish();
rollback;

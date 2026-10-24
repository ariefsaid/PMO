-- erp_purchase_documents.test.sql — 0335 (docs/specs/erp-purchases-readonly.spec.md).
-- Owns AC-EPR-002..006.
begin;
select plan(24);

insert into organizations (id, name, default_currency) values
  ('03350000-0000-0000-0000-00000000000a','EPR Org A','IDR'),
  ('03350000-0000-0000-0000-00000000000b','EPR Org B','IDR');
insert into auth.users (id, email) values
  ('03350000-0000-0000-0000-0000000000a1','epr-a@example.com'),
  ('03350000-0000-0000-0000-0000000000a2','epr-a-eng@example.com'),
  ('03350000-0000-0000-0000-0000000000b1','epr-b@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('03350000-0000-0000-0000-0000000000a1','03350000-0000-0000-0000-00000000000a','EPR A','epr-a@example.com','Project Manager','active'),
  ('03350000-0000-0000-0000-0000000000a2','03350000-0000-0000-0000-00000000000a','EPR A Eng','epr-a-eng@example.com','Engineer','active'),
  ('03350000-0000-0000-0000-0000000000b1','03350000-0000-0000-0000-00000000000b','EPR B','epr-b@example.com','Project Manager','active');
insert into projects (id, org_id, name, status) values
  ('03350000-0000-0000-0000-0000000000d1','03350000-0000-0000-0000-00000000000a','EPR P1','Ongoing Project'),
  ('03350000-0000-0000-0000-0000000000d2','03350000-0000-0000-0000-00000000000a','EPR P2','Ongoing Project');
insert into external_org_bindings (org_id, external_tier, site_url, secret_ref, config, activated_at) values
  ('03350000-0000-0000-0000-00000000000a','erpnext','https://erp.example.test','test-ref',
   '{"company":"Example Co","project_map":{"03350000-0000-0000-0000-0000000000d1":"ERP-A","03350000-0000-0000-0000-0000000000d2":"ERP-B"}}'::jsonb, now());
-- PINV-2 has no header project; its expense GL row carries ERP-A. A cancelled GL row on ERP-B must not count.
insert into erp_gl_entry_mirror (org_id, erp_name, account, project, voucher_type, voucher_no, debit, credit, is_cancelled, erp_modified) values
  ('03350000-0000-0000-0000-00000000000a','GLE-1','5100 - Expense','ERP-A','Purchase Invoice','PINV-2',100,0,false,'2026-01-01'),
  ('03350000-0000-0000-0000-00000000000a','GLE-2','5100 - Expense','ERP-B','Purchase Invoice','PINV-2',100,0,true,'2026-01-01');
insert into external_refs (org_id, domain, pmo_record_id, external_tier, external_record_id) values
  ('03350000-0000-0000-0000-00000000000a','procurement','pmo-pi-1','erpnext','PINV-PMO');

create temp table actuals_before as
  select * from project_mapped_actuals('03350000-0000-0000-0000-0000000000d1');

select is(
  upsert_erp_purchase_documents('03350000-0000-0000-0000-00000000000a', $$[
    {"erp_doctype":"Purchase Invoice","erp_name":"PINV-1","supplier_name":"Acme","grand_total":500,"outstanding_amount":500,
     "erp_status":"Unpaid","erp_docstatus":1,"erp_project":"ERP-B","erp_modified":"2026-02-01 10:00:00"},
    {"erp_doctype":"Purchase Invoice","erp_name":"PINV-2","supplier_name":"Beta","grand_total":100,"outstanding_amount":0,
     "erp_status":"Paid","erp_docstatus":1,"erp_modified":"2026-02-01 10:00:00"},
    {"erp_doctype":"Purchase Invoice","erp_name":"PINV-PMO","supplier_name":"Gamma","grand_total":10,"erp_docstatus":1,"erp_modified":"2026-02-01"},
    {"erp_doctype":"Purchase Order","erp_name":"PO-1","supplier_name":"Acme","grand_total":900,"erp_status":"To Bill",
     "erp_docstatus":1,"erp_project":"ERP-UNMAPPED","erp_modified":"2026-02-01"}]$$::jsonb),
  4, 'upsert writes a fresh batch');

-- AC-EPR-002 — older modified is ignored, newer replaces.
select upsert_erp_purchase_documents('03350000-0000-0000-0000-00000000000a',
  '[{"erp_doctype":"Purchase Invoice","erp_name":"PINV-1","grand_total":1,"erp_docstatus":1,"erp_modified":"2026-01-31"}]');
select is((select grand_total from erp_purchase_documents where erp_name='PINV-1'), 500.00::numeric(18,2),
  'AC-EPR-002 an older modified never overwrites the stored copy');
select upsert_erp_purchase_documents('03350000-0000-0000-0000-00000000000a',
  '[{"erp_doctype":"Purchase Invoice","erp_name":"PINV-1","supplier_name":"Acme","grand_total":500,"outstanding_amount":0,"erp_status":"Paid","erp_docstatus":1,"erp_project":"ERP-B","erp_modified":"2026-02-02"}]');
select is((select erp_status from erp_purchase_documents where erp_name='PINV-1'), 'Paid',
  'AC-EPR-002 a newer modified replaces the stored copy');

-- AC-EPR-003 — attribution: header project, GL-only project, unmapped, cancelled GL ignored.
select is((select project_ids from erp_purchase_documents where erp_name='PINV-1'),
  array['03350000-0000-0000-0000-0000000000d2']::uuid[], 'AC-EPR-003 header project maps to its PMO project');
select is((select project_ids from erp_purchase_documents where erp_name='PINV-2'),
  array['03350000-0000-0000-0000-0000000000d1']::uuid[], 'AC-EPR-003 a PI with no header project attributes through its live GL rows only');
select is((select project_ids from erp_purchase_documents where erp_name='PO-1'), '{}'::uuid[],
  'AC-EPR-003 an unmapped ERP project leaves the document unattributed');
update external_org_bindings set config = jsonb_set(config, '{project_map}',
  '{"03350000-0000-0000-0000-0000000000d1":"ERP-UNMAPPED"}'::jsonb)
  where org_id='03350000-0000-0000-0000-00000000000a';
select is(upsert_erp_purchase_documents('03350000-0000-0000-0000-00000000000a', '[]'), 0, 'an empty batch writes nothing');
select is((select project_ids from erp_purchase_documents where erp_name='PINV-2'), '{}'::uuid[],
  'AC-EPR-003 a remap clears stale attribution on the next call');
select is((select project_ids from erp_purchase_documents where erp_name='PO-1'),
  array['03350000-0000-0000-0000-0000000000d1']::uuid[], 'AC-EPR-003 a remap applies without a refetch');

-- AC-EPR-004 — PMO-pushed documents are flagged.
select ok((select pmo_owned from erp_purchase_documents where erp_name='PINV-PMO'), 'AC-EPR-004 a PI named by a procurement external_ref is pmo_owned');
select ok(not (select pmo_owned from erp_purchase_documents where erp_name='PINV-1'), 'AC-EPR-004 an ERP-native PI is not pmo_owned');

-- AC-EPR-005 — org isolation and no client writes.
set local role authenticated;
set local request.jwt.claims = '{"sub":"03350000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select is((select count(*) from erp_purchase_documents), 4::bigint, 'AC-EPR-005 an org A Project Manager reads org A rows');
select throws_ok($$ update erp_purchase_documents set grand_total = 0 $$, '42501', null,
  'AC-EPR-005 a member cannot update the mirror');
select throws_ok($$ insert into erp_purchase_documents (erp_doctype, erp_name, erp_docstatus, erp_modified)
                    values ('Purchase Invoice','FORGED',1,'2026-01-01') $$, '42501', null,
  'AC-EPR-005 a member cannot insert into the mirror');
select throws_ok($$ delete from erp_purchase_documents $$, '42501', null,
  'AC-EPR-005 a member cannot delete from the mirror');
select throws_ok($$ select upsert_erp_purchase_documents('03350000-0000-0000-0000-00000000000a','[]') $$, '42501', null,
  'AC-EPR-005 a member cannot execute the upsert');
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"03350000-0000-0000-0000-0000000000b1","role":"authenticated"}';
select is((select count(*) from erp_purchase_documents), 0::bigint, 'AC-EPR-005 an org B member reads none of org A');
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"03350000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select is((select count(*) from erp_purchase_documents), 0::bigint,
  'AC-EPR-005 an Engineer (no org-wide procurement view) reads no ERP purchases');
reset role;

delete from external_refs where org_id='03350000-0000-0000-0000-00000000000a'
 and domain='procurement' and pmo_record_id='pmo-pi-1';
select is(upsert_erp_purchase_documents('03350000-0000-0000-0000-00000000000a','[]'),0,
 'AC-EPR-004 an ownership refresh does not insert documents');
select ok(not (select pmo_owned from erp_purchase_documents where erp_name='PINV-PMO'),
 'AC-EPR-004 removing a procurement reference restores native-document visibility');
select is(upsert_erp_purchase_documents('03350000-0000-0000-0000-00000000000a',
 '[{"erp_doctype":"Purchase Invoice","erp_name":"PINV-CANCELLED","grand_total":42,"erp_docstatus":2,"erp_modified":"2026-02-03"}]'),1,
 'AC-EPR-002 the mirror records a cancelled ERP document');
select is((select erp_docstatus::int from erp_purchase_documents where erp_name='PINV-CANCELLED'),2,
 'AC-EPR-002 the stored cancellation retains its ERP document status');
set local role authenticated;
set local request.jwt.claims = '{"sub":"03350000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select is((select count(*) from erp_purchase_documents where erp_docstatus=1 and not pmo_owned),4::bigint,
 'AC-EPR-005 the visible native list includes released references and excludes cancellations');
reset role;

-- AC-EPR-006 — never part of actuals: unchanged, and nothing else reads the table.
select ok(
  not exists ((select * from project_mapped_actuals('03350000-0000-0000-0000-0000000000d1')
               except select * from actuals_before)
              union all
              (select * from actuals_before
               except select * from project_mapped_actuals('03350000-0000-0000-0000-0000000000d1')))
  and not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                   where n.nspname = 'public' and p.prosrc ilike '%erp_purchase_documents%'
                     and p.proname not in ('upsert_erp_purchase_documents','guard_procurement_erp_link_org',
                       'procurement_evidenced_step','procurement_gate_violation','procurement_ledger_held',
                       'refresh_erp_linked_purchase_total','link_erp_purchase_documents','unlink_erp_purchase_document',
                       'guard_procurement_document_record',
                       'procurement_payment_within_ceiling',
                       -- AMENDED BY 0362 (FR-PFE-006): reads linked ERP documents only as step evidence for its no-op.
                       'transition_procurement',
                       -- AMENDED BY 0363/0364: the guard names the link/mark RPCs in its allow-lists; reads no rows
                       'mark_erp_purchase_documents','stamp_erp_purchase_document_mark_org',
                       'api_client_request_guard',  -- names the link/mark RPCs in its allow-lists; reads no table
                       -- AMENDED BY 0372: the linked-documents total (0361 §4's basis, moved into one helper) — a commitment reader.
                       'erp_linked_documents_total'))
  and not exists (select 1 from pg_views where schemaname = 'public' and definition ilike '%erp_purchase_documents%'
                    and viewname not in ('erp_purchase_documents_linked','erp_purchase_orphans','erp_purchase_orphans_all')),
  'AC-EPR-006 (re-baselined by AC-PFE-005) ERP purchases never feed actuals; only the named link/commitment readers touch the table');

select * from finish();
rollback;

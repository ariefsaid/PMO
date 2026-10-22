-- 0349 — procurement evidence rows stay bound to their storage keys on every phase table, stored
-- objects are not removable by ordinary writers, and document storage/link columns follow the author rule.
begin;
select plan(45);

insert into organizations(id,name) values ('03493000-0000-0000-0000-000000000001','Evidence Org');
insert into auth.users(id,email) values
 ('03493000-0000-0000-0000-000000000011','ev-pm@example.com'),
 ('03493000-0000-0000-0000-000000000012','ev-finance@example.com'),
 ('03493000-0000-0000-0000-000000000013','ev-admin@example.com'),
 ('03493000-0000-0000-0000-000000000014','ev-author@example.com');
insert into profiles(id,org_id,full_name,email,role,status) values
 ('03493000-0000-0000-0000-000000000011','03493000-0000-0000-0000-000000000001','Evidence PM','ev-pm@example.com','Project Manager','active'),
 ('03493000-0000-0000-0000-000000000012','03493000-0000-0000-0000-000000000001','Evidence Finance','ev-finance@example.com','Finance','active'),
 ('03493000-0000-0000-0000-000000000013','03493000-0000-0000-0000-000000000001','Evidence Admin','ev-admin@example.com','Admin','active'),
 ('03493000-0000-0000-0000-000000000014','03493000-0000-0000-0000-000000000001','Evidence Author','ev-author@example.com','Project Manager','active');
insert into companies(id,org_id,name,type) values
 ('03493000-0000-0000-0000-000000000021','03493000-0000-0000-0000-000000000001','Evidence Vendor','Vendor');
insert into procurements(id,org_id,title,status) values
 ('03493000-0000-0000-0000-000000000100','03493000-0000-0000-0000-000000000001','Evidence owner','Vendor Invoiced'),
 ('03493000-0000-0000-0000-000000000101','03493000-0000-0000-0000-000000000001','Other owner','Vendor Invoiced');
insert into procurement_quotations(id,org_id,procurement_id,vendor_id,total_amount) values
 ('03493000-0000-0000-0000-000000000201','03493000-0000-0000-0000-000000000001','03493000-0000-0000-0000-000000000100','03493000-0000-0000-0000-000000000021',1);
insert into procurement_receipts(id,org_id,procurement_id,status) values
 ('03493000-0000-0000-0000-000000000202','03493000-0000-0000-0000-000000000001','03493000-0000-0000-0000-000000000100','Complete');
insert into procurement_invoices(id,org_id,procurement_id,status,amount,tax_treatment,tax_amount) values
 ('03493000-0000-0000-0000-000000000203','03493000-0000-0000-0000-000000000001','03493000-0000-0000-0000-000000000100','Received',1,'exclusive',0);
insert into purchase_requests(id,org_id,procurement_id) values
 ('03493000-0000-0000-0000-000000000204','03493000-0000-0000-0000-000000000001','03493000-0000-0000-0000-000000000100');
insert into rfqs(id,org_id,procurement_id) values
 ('03493000-0000-0000-0000-000000000205','03493000-0000-0000-0000-000000000001','03493000-0000-0000-0000-000000000100');
insert into purchase_orders(id,org_id,procurement_id) values
 ('03493000-0000-0000-0000-000000000206','03493000-0000-0000-0000-000000000001','03493000-0000-0000-0000-000000000100');
insert into payments(id,org_id,procurement_id) values
 ('03493000-0000-0000-0000-000000000207','03493000-0000-0000-0000-000000000001','03493000-0000-0000-0000-000000000100');

-- One row per phase table: table, parent column, parent id, phase segment, file-row id suffix.
create temp table phase_tables(tbl text, parent_col text, parent_id uuid, phase text, n int) on commit drop;
insert into phase_tables values
 ('procurement_quotation_files','quotation_id','03493000-0000-0000-0000-000000000201','quotation',1),
 ('procurement_receipt_files','receipt_id','03493000-0000-0000-0000-000000000202','receipt',2),
 ('procurement_invoice_files','invoice_id','03493000-0000-0000-0000-000000000203','invoice',3),
 ('purchase_request_files','purchase_request_id','03493000-0000-0000-0000-000000000204','purchase_request',4),
 ('rfq_files','rfq_id','03493000-0000-0000-0000-000000000205','rfq',5),
 ('purchase_order_files','purchase_order_id','03493000-0000-0000-0000-000000000206','purchase_order',6),
 ('payment_files','payment_id','03493000-0000-0000-0000-000000000207','payment',7);
grant select on phase_tables to authenticated;
create function pg_temp.file_id(p_n int) returns uuid language sql immutable as
 $$ select ('03493000-0000-0000-0000-0000000003' || lpad(p_n::text, 2, '0'))::uuid $$;
create function pg_temp.file_path(p_proc text, p_phase text, p_n int, p_name text) returns text language sql immutable as
 $$ select '03493000-0000-0000-0000-000000000001/' || p_proc || '/' || p_phase || '/' || pg_temp.file_id(p_n)::text || '/' || p_name $$;

set local role authenticated;
set local request.jwt.claims='{"sub":"03493000-0000-0000-0000-000000000011","role":"authenticated"}';
-- Insert: a key pointing at another procurement is refused on every phase table.
select throws_ok(
  format('insert into %I(id,org_id,%I,file_path) values (%L,%L,%L,%L)', tbl, parent_col, pg_temp.file_id(n),
         '03493000-0000-0000-0000-000000000001', parent_id,
         pg_temp.file_path('03493000-0000-0000-0000-000000000101', phase, n, 'wrong.pdf')),
  '23514','Procurement file storage key does not match its record.',
  'AC-SEC-207: ' || tbl || ' insert refuses a storage key under another procurement')
from phase_tables order by n;
-- Insert: the canonical org/procurement/phase/file key is accepted on every phase table.
select lives_ok(
  format('insert into %I(id,org_id,%I,title,file_path) values (%L,%L,%L,%L,%L)', tbl, parent_col, pg_temp.file_id(n),
         '03493000-0000-0000-0000-000000000001', parent_id, 'Original',
         pg_temp.file_path('03493000-0000-0000-0000-000000000100', phase, n, 'file.pdf')),
  'AC-SEC-207: ' || tbl || ' insert accepts the canonical storage key')
from phase_tables order by n;
-- Update: clients hold no privilege on the storage key.
select throws_ok(
  format('update %I set file_path=%L where id=%L', tbl,
         pg_temp.file_path('03493000-0000-0000-0000-000000000100', phase, n, 'other.pdf'), pg_temp.file_id(n)),
  '42501',null,
  'AC-SEC-218: ' || tbl || ' storage key is not client-updatable')
from phase_tables order by n;
-- Update: the title stays editable (the app's rename path).
select lives_ok(
  format('update %I set title=%L where id=%L', tbl, 'Renamed', pg_temp.file_id(n)),
  'AC-SEC-218: ' || tbl || ' title remains editable')
from phase_tables order by n;
reset role;

-- With the column granted for this transaction only, the trigger itself refuses any key change.
do $$ declare t text; begin
  for t in select tbl from phase_tables loop
    execute format('grant update (file_path) on public.%I to authenticated', t);
  end loop;
end $$;
set local role authenticated;
set local request.jwt.claims='{"sub":"03493000-0000-0000-0000-000000000011","role":"authenticated"}';
select throws_ok(
  format('update %I set file_path=%L where id=%L', tbl,
         pg_temp.file_path('03493000-0000-0000-0000-000000000100', phase, n, 'other.pdf'), pg_temp.file_id(n)),
  '42501','Procurement file storage key cannot be changed.',
  'AC-SEC-218: ' || tbl || ' trigger refuses re-pointing an existing file row, even at a canonical key')
from phase_tables order by n;
reset role;
do $$ declare t text; begin
  for t in select tbl from phase_tables loop
    execute format('revoke update (file_path) on public.%I from authenticated', t);
  end loop;
end $$;
select is((select count(*)::int from procurement_quotation_files where id=pg_temp.file_id(1) and file_path like '%/file.pdf' and title='Renamed'),1,
  'AC-SEC-218: refused key changes leave the original key in place');

-- ── Storage objects: insert-only for writers; Admin deletes only unreferenced objects ──────────────
insert into storage.objects(id,bucket_id,name,owner) values
 (gen_random_uuid(),'procurement-files',pg_temp.file_path('03493000-0000-0000-0000-000000000100','quotation',1,'file.pdf'),'03493000-0000-0000-0000-000000000011');
set local role authenticated;
set local request.jwt.claims='{"sub":"03493000-0000-0000-0000-000000000012","role":"authenticated"}';
select lives_ok($$insert into storage.objects(id,bucket_id,name,owner) values (gen_random_uuid(),'procurement-files',
  '03493000-0000-0000-0000-000000000001/03493000-0000-0000-0000-000000000100/invoice/03493000-0000-0000-0000-000000000399/bill.pdf',
  '03493000-0000-0000-0000-000000000012')$$,'AC-SEC-204: Finance uploads a procurement evidence object');
set local storage.allow_delete_query = 'true';
delete from storage.objects where bucket_id='procurement-files' and name like '%/03493000-0000-0000-0000-000000000399/bill.pdf';
reset role;
select is((select count(*)::int from storage.objects where bucket_id='procurement-files' and name like '%/03493000-0000-0000-0000-000000000399/bill.pdf'),1,
  'AC-SEC-204: Finance cannot delete a procurement evidence object');
set local role authenticated;
set local request.jwt.claims='{"sub":"03493000-0000-0000-0000-000000000013","role":"authenticated"}';
delete from storage.objects where bucket_id='procurement-files' and name like '%/quotation/03493000-0000-0000-0000-000000000301/file.pdf';
delete from storage.objects where bucket_id='procurement-files' and name like '%/03493000-0000-0000-0000-000000000399/bill.pdf';
reset role;
select is((select count(*)::int from storage.objects where bucket_id='procurement-files' and name like '%/quotation/03493000-0000-0000-0000-000000000301/file.pdf'),1,
  'AC-SEC-204: an Admin cannot delete an object a file row references');
select is((select count(*)::int from storage.objects where bucket_id='procurement-files' and name like '%/03493000-0000-0000-0000-000000000399/bill.pdf'),0,
  'AC-SEC-204: an Admin deletes an unreferenced object');

-- ── Project documents: storage key and Microsoft link columns follow the author-or-Admin rule ──────
insert into projects(id,org_id,code,name,status) values
 ('03493000-0000-0000-0000-000000000500','03493000-0000-0000-0000-000000000001','EV-1','Evidence project','Ongoing Project');
insert into project_documents(id,org_id,project_id,title,category,author_id) values
 ('03493000-0000-0000-0000-000000000501','03493000-0000-0000-0000-000000000001','03493000-0000-0000-0000-000000000500','Drawing','Drawing','03493000-0000-0000-0000-000000000014');
set local role authenticated;
set local request.jwt.claims='{"sub":"03493000-0000-0000-0000-000000000011","role":"authenticated"}';
select throws_ok($$update project_documents set file_path='03493000-0000-0000-0000-000000000001/03493000-0000-0000-0000-000000000500/03493000-0000-0000-0000-000000000501/swap.pdf', source='upload'
  where id='03493000-0000-0000-0000-000000000501'$$,'42501','Document metadata edit is not permitted.',
  'AC-SEC-219: a non-author cannot set a document storage key');
select throws_ok($$update project_documents set ms_drive_id='drive', ms_item_id='item', ms_web_url='https://example.invalid/item', ms_item_name='swap.pdf', ms_item_kind='file', source='onedrive'
  where id='03493000-0000-0000-0000-000000000501'$$,'42501','Document metadata edit is not permitted.',
  'AC-SEC-219: a non-author cannot link a Microsoft item to a document');
set local request.jwt.claims='{"sub":"03493000-0000-0000-0000-000000000014","role":"authenticated"}';
select lives_ok($$update project_documents set file_path='03493000-0000-0000-0000-000000000001/03493000-0000-0000-0000-000000000500/03493000-0000-0000-0000-000000000501/drawing.pdf', source='upload'
  where id='03493000-0000-0000-0000-000000000501'$$,'AC-SEC-219: the author confirms their own upload');
set local request.jwt.claims='{"sub":"03493000-0000-0000-0000-000000000013","role":"authenticated"}';
select lives_ok($$update project_documents set file_path='03493000-0000-0000-0000-000000000001/03493000-0000-0000-0000-000000000500/03493000-0000-0000-0000-000000000501/admin.pdf'
  where id='03493000-0000-0000-0000-000000000501'$$,'AC-SEC-219: an Admin may replace a document storage key');
reset role;
select is((select file_path from project_documents where id='03493000-0000-0000-0000-000000000501'),
  '03493000-0000-0000-0000-000000000001/03493000-0000-0000-0000-000000000500/03493000-0000-0000-0000-000000000501/admin.pdf',
  'AC-SEC-219: only permitted storage-key writes landed');

select finish();
rollback;

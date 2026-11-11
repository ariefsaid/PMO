-- 0409 — document preview: one durable source per purchase attachment (additive), and the Draft
-- upload-to-Microsoft swap on project documents. Proves AC-010 (document-preview spec): parent
-- visibility, org isolation, write roles and the controlled-document lifecycle hold for both storage-backed
-- and Microsoft-backed attachments.
begin;
select plan(107);

insert into organizations(id,name) values
 ('04090000-0000-0000-0000-000000000001','Preview Org'),
 ('04090000-0000-0000-0000-000000000002','Preview Other Org');
insert into auth.users(id,email) values
 ('04090000-0000-0000-0000-000000000011','pv-pm@example.invalid'),
 ('04090000-0000-0000-0000-000000000012','pv-pm2@example.invalid'),
 ('04090000-0000-0000-0000-000000000013','pv-admin@example.invalid'),
 ('04090000-0000-0000-0000-000000000014','pv-engineer@example.invalid'),
 ('04090000-0000-0000-0000-000000000015','pv-other@example.invalid');
insert into profiles(id,org_id,full_name,email,role,status) values
 ('04090000-0000-0000-0000-000000000011','04090000-0000-0000-0000-000000000001','Preview PM','pv-pm@example.invalid','Project Manager','active'),
 ('04090000-0000-0000-0000-000000000012','04090000-0000-0000-0000-000000000001','Preview PM2','pv-pm2@example.invalid','Project Manager','active'),
 ('04090000-0000-0000-0000-000000000013','04090000-0000-0000-0000-000000000001','Preview Admin','pv-admin@example.invalid','Admin','active'),
 ('04090000-0000-0000-0000-000000000014','04090000-0000-0000-0000-000000000001','Preview Engineer','pv-engineer@example.invalid','Engineer','active'),
 ('04090000-0000-0000-0000-000000000015','04090000-0000-0000-0000-000000000002','Preview Other','pv-other@example.invalid','Project Manager','active');
insert into companies(id,org_id,name,type) values
 ('04090000-0000-0000-0000-000000000021','04090000-0000-0000-0000-000000000001','Preview Vendor','Vendor');
insert into procurements(id,org_id,title,status) values
 ('04090000-0000-0000-0000-000000000100','04090000-0000-0000-0000-000000000001','Preview owner','Vendor Invoiced');
insert into procurement_quotations(id,org_id,procurement_id,vendor_id,total_amount) values
 ('04090000-0000-0000-0000-000000000201','04090000-0000-0000-0000-000000000001','04090000-0000-0000-0000-000000000100','04090000-0000-0000-0000-000000000021',1);
insert into procurement_receipts(id,org_id,procurement_id,status) values
 ('04090000-0000-0000-0000-000000000202','04090000-0000-0000-0000-000000000001','04090000-0000-0000-0000-000000000100','Complete');
insert into procurement_invoices(id,org_id,procurement_id,status,amount,tax_treatment,tax_amount) values
 ('04090000-0000-0000-0000-000000000203','04090000-0000-0000-0000-000000000001','04090000-0000-0000-0000-000000000100','Received',1,'exclusive',0);
insert into purchase_requests(id,org_id,procurement_id) values
 ('04090000-0000-0000-0000-000000000204','04090000-0000-0000-0000-000000000001','04090000-0000-0000-0000-000000000100');
insert into rfqs(id,org_id,procurement_id) values
 ('04090000-0000-0000-0000-000000000205','04090000-0000-0000-0000-000000000001','04090000-0000-0000-0000-000000000100');
insert into purchase_orders(id,org_id,procurement_id) values
 ('04090000-0000-0000-0000-000000000206','04090000-0000-0000-0000-000000000001','04090000-0000-0000-0000-000000000100');
insert into payments(id,org_id,procurement_id) values
 ('04090000-0000-0000-0000-000000000207','04090000-0000-0000-0000-000000000001','04090000-0000-0000-0000-000000000100');

create temp table phase_tables(tbl text, parent_col text, parent_id uuid, phase text, n int) on commit drop;
insert into phase_tables values
 ('procurement_quotation_files','quotation_id','04090000-0000-0000-0000-000000000201','quotation',1),
 ('procurement_receipt_files','receipt_id','04090000-0000-0000-0000-000000000202','receipt',2),
 ('procurement_invoice_files','invoice_id','04090000-0000-0000-0000-000000000203','invoice',3),
 ('purchase_request_files','purchase_request_id','04090000-0000-0000-0000-000000000204','purchase_request',4),
 ('rfq_files','rfq_id','04090000-0000-0000-0000-000000000205','rfq',5),
 ('purchase_order_files','purchase_order_id','04090000-0000-0000-0000-000000000206','purchase_order',6),
 ('payment_files','payment_id','04090000-0000-0000-0000-000000000207','payment',7);
grant select on phase_tables to authenticated;
-- file id: 3NN storage-backed, 4NN Microsoft-backed, 5NN violators
create function pg_temp.fid(p_kind int, p_n int) returns uuid language sql immutable as
 $$ select ('04090000-0000-0000-0000-000000000' || p_kind::text || lpad(p_n::text, 2, '0'))::uuid $$;
create function pg_temp.fpath(p_phase text, p_id uuid) returns text language sql immutable as
 $$ select '04090000-0000-0000-0000-000000000001/04090000-0000-0000-0000-000000000100/' || p_phase || '/' || p_id::text || '/file.pdf' $$;

-- 1. the seven columns exist on every attachment table
select is((select count(*)::int from information_schema.columns c
           where c.table_schema='public' and c.table_name=tbl
             and c.column_name in ('source','ms_drive_id','ms_item_id','ms_web_url','ms_item_name','ms_linked_by','ms_linked_at')), 7,
  'document-preview AC-010: ' || tbl || ' carries the source and Microsoft reference columns')
from phase_tables order by n;

-- 2. a project manager inserts a Microsoft-backed row; the link stamps are server-owned
set local role authenticated;
set local request.jwt.claims='{"sub":"04090000-0000-0000-0000-000000000011","role":"authenticated"}';
select lives_ok(
  format('insert into %I(id,org_id,%I,title,source,ms_drive_id,ms_item_id,ms_web_url,ms_item_name,ms_linked_by,ms_linked_at) values (%L,%L,%L,%L,%L,%L,%L,%L,%L,%L,%L)',
         tbl, parent_col, pg_temp.fid(4,n), '04090000-0000-0000-0000-000000000001', parent_id, 'Microsoft file',
         'onedrive','synthetic-drive','synthetic-item-'||n,'https://example.invalid/sites/x/file.pdf','file.pdf',
         '04090000-0000-0000-0000-000000000013','2000-01-01T00:00:00Z'),
  'document-preview AC-010: ' || tbl || ' accepts a Microsoft-backed row (no storage key)')
from phase_tables order by n;
reset role;
select is((select count(*)::int from procurement_quotation_files where id=pg_temp.fid(4,1)
            and ms_linked_by='04090000-0000-0000-0000-000000000011' and ms_linked_at > '2001-01-01'), 1,
  'document-preview AC-010: the link actor and time are stamped by the server, not the client (quotation files)')
;
select is((select count(*)::int from payment_files where id=pg_temp.fid(4,7)
            and ms_linked_by='04090000-0000-0000-0000-000000000011' and ms_linked_at > '2001-01-01'), 1,
  'document-preview AC-010: the link actor and time are stamped by the server, not the client (payment files)');

-- 3. exactly one source: the check refuses every mixed or incomplete shape
set local role authenticated;
set local request.jwt.claims='{"sub":"04090000-0000-0000-0000-000000000011","role":"authenticated"}';
select throws_ok(
  format('insert into %I(id,org_id,%I,source,ms_drive_id,ms_item_id,ms_web_url,ms_item_name,file_path) values (%L,%L,%L,%L,%L,%L,%L,%L,%L)',
         tbl, parent_col, pg_temp.fid(5,n), '04090000-0000-0000-0000-000000000001', parent_id,
         'onedrive','d','i','https://example.invalid/x','x.pdf', pg_temp.fpath(phase, pg_temp.fid(5,n))),
  '23514', null, 'document-preview AC-010: ' || tbl || ' refuses a storage key AND a Microsoft reference')
from phase_tables order by n;
select throws_ok(
  format('insert into %I(id,org_id,%I,ms_drive_id,ms_item_id,ms_web_url,ms_item_name) values (%L,%L,%L,%L,%L,%L,%L)',
         tbl, parent_col, pg_temp.fid(5,n), '04090000-0000-0000-0000-000000000001', parent_id, 'd','i','https://example.invalid/x','x.pdf'),
  '23514', null, 'document-preview AC-010: ' || tbl || ' refuses Microsoft columns without a source')
from phase_tables order by n;
select throws_ok(
  format('insert into %I(id,org_id,%I,source,ms_drive_id,ms_web_url,ms_item_name) values (%L,%L,%L,%L,%L,%L,%L)',
         tbl, parent_col, pg_temp.fid(5,n), '04090000-0000-0000-0000-000000000001', parent_id, 'onedrive','d','https://example.invalid/x','x.pdf'),
  '23514', null, 'document-preview AC-010: ' || tbl || ' refuses an incomplete Microsoft reference')
from phase_tables order by n;
select throws_ok(
  format('insert into %I(id,org_id,%I,source) values (%L,%L,%L,%L)',
         tbl, parent_col, pg_temp.fid(5,n), '04090000-0000-0000-0000-000000000001', parent_id, 'upload'),
  '23514', null, 'document-preview AC-010: ' || tbl || ' accepts only the Microsoft source (storage-backed stays source-less)')
from phase_tables order by n;

-- 4. storage-backed attachments are unchanged
select lives_ok(
  format('insert into %I(id,org_id,%I,title,file_path) values (%L,%L,%L,%L,%L)',
         tbl, parent_col, pg_temp.fid(3,n), '04090000-0000-0000-0000-000000000001', parent_id, 'Stored', pg_temp.fpath(phase, pg_temp.fid(3,n))),
  'document-preview AC-010: ' || tbl || ' still accepts a storage-backed row')
from phase_tables order by n;
select throws_ok(
  format('insert into %I(id,org_id,%I,file_path) values (%L,%L,%L,%L)',
         tbl, parent_col, pg_temp.fid(5,n), '04090000-0000-0000-0000-000000000001', parent_id,
         replace(pg_temp.fpath(phase, pg_temp.fid(5,n)), '04090000-0000-0000-0000-000000000100', '04090000-0000-0000-0000-000000000999')),
  '23514', 'Procurement file storage key does not match its record.',
  'document-preview AC-010: ' || tbl || ' still refuses a foreign storage key')
from phase_tables order by n;

-- 5. clients cannot rewrite the source or reference; title and archive stay editable
select throws_ok(
  format('update %I set ms_item_name=%L where id=%L', tbl, 'renamed.pdf', pg_temp.fid(4,n)),
  '42501', null, 'document-preview AC-010: ' || tbl || ' reference columns are not client-updatable')
from phase_tables order by n;
select throws_ok(
  format('update %I set source=null where id=%L', tbl, pg_temp.fid(4,n)),
  '42501', null, 'document-preview AC-010: ' || tbl || ' source is not client-updatable')
from phase_tables order by n;
select lives_ok(
  format('update %I set title=%L where id=%L', tbl, 'Renamed', pg_temp.fid(4,n)),
  'document-preview AC-010: ' || tbl || ' title stays editable on a Microsoft-backed row')
from phase_tables order by n;
reset role;

-- 6. read contract: org members read both kinds; another org and a non-requester Engineer read none
create function pg_temp.visible() returns int language sql stable as $$
  select (select count(*) from procurement_quotation_files) + (select count(*) from procurement_receipt_files)
       + (select count(*) from procurement_invoice_files) + (select count(*) from purchase_request_files)
       + (select count(*) from rfq_files) + (select count(*) from purchase_order_files) + (select count(*) from payment_files) $$;
grant execute on function pg_temp.visible() to authenticated;
set local role authenticated;
set local request.jwt.claims='{"sub":"04090000-0000-0000-0000-000000000012","role":"authenticated"}';
select is(pg_temp.visible(), 14, 'document-preview AC-010: an org member reads both the storage-backed and the Microsoft-backed rows');
set local request.jwt.claims='{"sub":"04090000-0000-0000-0000-000000000015","role":"authenticated"}';
select is(pg_temp.visible(), 0, 'document-preview AC-010: another organisation reads none of them');
set local request.jwt.claims='{"sub":"04090000-0000-0000-0000-000000000014","role":"authenticated"}';
select is(pg_temp.visible(), 0, 'document-preview AC-010: an Engineer who did not raise the request reads none of them');

-- 7. write roles and tenancy
select throws_ok(
  format('insert into %I(id,org_id,%I,source,ms_drive_id,ms_item_id,ms_web_url,ms_item_name) values (%L,%L,%L,%L,%L,%L,%L,%L)',
         tbl, parent_col, pg_temp.fid(5,n), '04090000-0000-0000-0000-000000000001', parent_id,'onedrive','d','i','https://example.invalid/x','x.pdf'),
  '42501', null, 'document-preview AC-010: ' || tbl || ' refuses a Microsoft-backed insert from a non-writer role')
from phase_tables order by n;
set local request.jwt.claims='{"sub":"04090000-0000-0000-0000-000000000015","role":"authenticated"}';
select throws_ok(
  format('insert into %I(id,org_id,%I,source,ms_drive_id,ms_item_id,ms_web_url,ms_item_name) values (%L,%L,%L,%L,%L,%L,%L,%L)',
         tbl, parent_col, pg_temp.fid(5,n), '04090000-0000-0000-0000-000000000001', parent_id,'onedrive','d','i','https://example.invalid/x','x.pdf'),
  '42501', null, 'document-preview AC-010: ' || tbl || ' refuses a cross-organisation Microsoft-backed insert')
from phase_tables order by n;

-- deletes stay Admin-only for Microsoft-backed rows too
set local request.jwt.claims='{"sub":"04090000-0000-0000-0000-000000000011","role":"authenticated"}';
delete from procurement_receipt_files where id = pg_temp.fid(4,2);
reset role;
select is((select count(*)::int from procurement_receipt_files where id = pg_temp.fid(4,2)), 1,
  'document-preview AC-010: a project manager cannot delete a Microsoft-backed attachment');
set local role authenticated;
set local request.jwt.claims='{"sub":"04090000-0000-0000-0000-000000000013","role":"authenticated"}';
delete from procurement_receipt_files where id = pg_temp.fid(4,2);
reset role;
select is((select count(*)::int from procurement_receipt_files where id = pg_temp.fid(4,2)), 0,
  'document-preview AC-010: an Admin deletes a Microsoft-backed attachment');

-- 8. project documents: the Draft upload-to-Microsoft swap, in one statement
insert into projects(id,org_id,code,name,status) values
 ('04090000-0000-0000-0000-000000000500','04090000-0000-0000-0000-000000000001','PV-1','Preview project','Ongoing Project');
insert into project_documents(id,org_id,project_id,title,category,status,author_id,file_path,source) values
 ('04090000-0000-0000-0000-000000000601','04090000-0000-0000-0000-000000000001','04090000-0000-0000-0000-000000000500','Draft stored','Drawing','Draft','04090000-0000-0000-0000-000000000011','04090000-0000-0000-0000-000000000001/04090000-0000-0000-0000-000000000500/04090000-0000-0000-0000-000000000601/a.pdf','upload'),
 ('04090000-0000-0000-0000-000000000602','04090000-0000-0000-0000-000000000001','04090000-0000-0000-0000-000000000500','Issued stored','Drawing','Issued','04090000-0000-0000-0000-000000000011','04090000-0000-0000-0000-000000000001/04090000-0000-0000-0000-000000000500/04090000-0000-0000-0000-000000000602/a.pdf','upload'),
 ('04090000-0000-0000-0000-000000000603','04090000-0000-0000-0000-000000000001','04090000-0000-0000-0000-000000000500','Other author','Drawing','Draft','04090000-0000-0000-0000-000000000012','04090000-0000-0000-0000-000000000001/04090000-0000-0000-0000-000000000500/04090000-0000-0000-0000-000000000603/a.pdf','upload'),
 ('04090000-0000-0000-0000-000000000604','04090000-0000-0000-0000-000000000001','04090000-0000-0000-0000-000000000500','Admin swap','Drawing','Draft','04090000-0000-0000-0000-000000000012','04090000-0000-0000-0000-000000000001/04090000-0000-0000-0000-000000000500/04090000-0000-0000-0000-000000000604/a.pdf','upload'),
 ('04090000-0000-0000-0000-000000000605','04090000-0000-0000-0000-000000000001','04090000-0000-0000-0000-000000000500','Left set','Drawing','Draft','04090000-0000-0000-0000-000000000011','04090000-0000-0000-0000-000000000001/04090000-0000-0000-0000-000000000500/04090000-0000-0000-0000-000000000605/a.pdf','upload');
insert into project_documents(id,org_id,project_id,title,category,status,author_id,source,ms_drive_id,ms_item_id,ms_web_url,ms_item_name,ms_item_kind,ms_linked_by,ms_linked_at) values
 ('04090000-0000-0000-0000-000000000606','04090000-0000-0000-0000-000000000001','04090000-0000-0000-0000-000000000500','Linked','Drawing','Draft','04090000-0000-0000-0000-000000000011','onedrive','d','i','https://example.invalid/x','x.pdf','file','04090000-0000-0000-0000-000000000011',now());

set local role authenticated;
set local request.jwt.claims='{"sub":"04090000-0000-0000-0000-000000000011","role":"authenticated"}';
select lives_ok($$update project_documents set source='onedrive', file_path=null, ms_drive_id='d', ms_item_id='i', ms_web_url='https://example.invalid/sites/x/a.pdf',
  ms_item_name='a.pdf', ms_item_kind='file' where id='04090000-0000-0000-0000-000000000601'$$,
  'document-preview AC-010: the author replaces a Draft private upload with a Microsoft file in one statement');
reset role;
select is((select source::text || '/' || coalesce(file_path,'null') || '/' || (ms_linked_by = '04090000-0000-0000-0000-000000000011')::text
           from project_documents where id='04090000-0000-0000-0000-000000000601'), 'onedrive/null/true',
  'document-preview AC-010: the swap leaves exactly one source and stamps the link actor');
set local role authenticated;
set local request.jwt.claims='{"sub":"04090000-0000-0000-0000-000000000011","role":"authenticated"}';
select throws_ok($$update project_documents set source='onedrive', file_path=null, ms_drive_id='d', ms_item_id='i', ms_web_url='https://example.invalid/sites/x/a.pdf',
  ms_item_name='a.pdf', ms_item_kind='file' where id='04090000-0000-0000-0000-000000000602'$$, '42501', null,
  'document-preview AC-010: an Issued document cannot swap its source');
select throws_ok($$update project_documents set source='onedrive', file_path='04090000-0000-0000-0000-000000000001/04090000-0000-0000-0000-000000000500/04090000-0000-0000-0000-000000000605/a.pdf',
  ms_drive_id='d', ms_item_id='i', ms_web_url='https://example.invalid/sites/x/a.pdf', ms_item_name='a.pdf', ms_item_kind='file'
  where id='04090000-0000-0000-0000-000000000605'$$, '23514', null,
  'document-preview AC-010: a swap that leaves the storage key set is refused');
select throws_ok($$update project_documents set source='onedrive', file_path=null, ms_drive_id='d', ms_item_id='i', ms_web_url='https://example.invalid/sites/x/a.pdf',
  ms_item_name='a.pdf', ms_item_kind='file' where id='04090000-0000-0000-0000-000000000603'$$, '42501', null,
  'document-preview AC-010: someone else''s Draft cannot be swapped by a non-Admin');
select throws_ok($$update project_documents set source='upload', file_path='04090000-0000-0000-0000-000000000001/04090000-0000-0000-0000-000000000500/04090000-0000-0000-0000-000000000606/b.pdf',
  ms_drive_id=null, ms_item_id=null, ms_web_url=null, ms_item_name=null, ms_item_kind=null where id='04090000-0000-0000-0000-000000000606'$$, '23514', null,
  'document-preview AC-010: a Microsoft reference still has to be cleared before a private upload');
set local request.jwt.claims='{"sub":"04090000-0000-0000-0000-000000000013","role":"authenticated"}';
select lives_ok($$update project_documents set source='onedrive', file_path=null, ms_drive_id='d', ms_item_id='i', ms_web_url='https://example.invalid/sites/x/a.pdf',
  ms_item_name='a.pdf', ms_item_kind='file' where id='04090000-0000-0000-0000-000000000604'$$,
  'document-preview AC-010: an Admin may swap a Draft they did not author');
reset role;

-- 9. budget links are untouched
select is((select count(*)::int from information_schema.columns where table_schema='public' and table_name='budget_version_document_links' and column_name='source'), 0,
  'document-preview AC-010: budget evidence links gain no source column');
select is((select count(*)::int from pg_constraint where conname='budget_version_document_links_reference_complete'), 1,
  'document-preview AC-010: budget evidence links keep their complete-reference constraint');

select * from finish();
rollback;

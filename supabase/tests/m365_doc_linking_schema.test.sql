begin;
select no_plan();

select is(
  (select array_agg(e.enumlabel::text order by e.enumsortorder)
   from pg_type t join pg_enum e on e.enumtypid = t.oid
   join pg_namespace n on n.oid = t.typnamespace
   where n.nspname = 'public' and t.typname = 'doc_source'),
  array['upload', 'onedrive']::text[],
  'AC-M365DOC-001 source enum has the two supported values'
);

select ok(
  (select count(*) = 14 and bool_and(is_nullable = 'YES')
   from information_schema.columns
   where table_schema = 'public' and table_name = 'project_documents'
     and column_name = any(array[
       'source', 'ms_drive_id', 'ms_item_id', 'ms_web_url', 'ms_item_name',
       'ms_item_kind', 'ms_linked_by', 'ms_linked_at', 'ms_last_verified_at',
       'ms_content_tag_at_issue', 'ms_version_id_at_issue', 'ms_drift_state',
       'ms_check_claim', 'ms_check_claimed_at'
     ])),
  'AC-M365DOC-001 source and Microsoft metadata columns are nullable'
);

-- Inline minimal deterministic parents because supabase test db runs selected SQL files
-- in an isolated container path; the shared fixture is reused by tests with mounted helpers.
insert into public.organizations (id,name) values
 ('10200000-0000-0000-0000-000000000001','Synthetic M365 schema org');
insert into auth.users (id,email) values
 ('10200000-0000-0000-0000-000000000102','m365-schema@example.invalid');
insert into public.profiles (id,org_id,full_name,email,role,status) values
 ('10200000-0000-0000-0000-000000000102','10200000-0000-0000-0000-000000000001','Synthetic actor','m365-schema@example.invalid','Project Manager','active');
insert into public.projects (id,org_id,code,name,status,project_manager_id) values
 ('10200000-0000-0000-0000-000000000201','10200000-0000-0000-0000-000000000001','M365-A','Synthetic project','Ongoing Project','10200000-0000-0000-0000-000000000102');

-- Legacy/plain document writes omit source; file rows default to upload while metadata-only rows remain valid.
select lives_ok($$insert into public.project_documents (id,org_id,project_id,category,title,status,author_id,file_path)
 values ('10200000-0000-0000-0000-000000000301','10200000-0000-0000-0000-000000000001','10200000-0000-0000-0000-000000000201','Specification','legacy file','Draft','10200000-0000-0000-0000-000000000102','fixture/path')$$,
 'AC-M365DOC-002 accepts a legacy file row with omitted source');
select is((select source::text from public.project_documents where id='10200000-0000-0000-0000-000000000301'),
 'upload', 'AC-M365DOC-002 defaults an omitted source to upload');
select lives_ok($$insert into public.project_documents (id,org_id,project_id,category,title,status,author_id,source)
 values (gen_random_uuid(),'10200000-0000-0000-0000-000000000001','10200000-0000-0000-0000-000000000201','Specification','metadata upload source','Draft','10200000-0000-0000-0000-000000000102','upload')$$,
 'AC-M365DOC-002 accepts upload source without a file path');
select throws_ok($$insert into public.project_documents (id,org_id,project_id,category,title,status,author_id,source,file_path)
 values (gen_random_uuid(),'10200000-0000-0000-0000-000000000001','10200000-0000-0000-0000-000000000201','Specification','collision','Draft','10200000-0000-0000-0000-000000000102','onedrive','fixture/path')$$,
 '23514', null, 'AC-M365DOC-002 rejects Microsoft source with upload path');
select throws_ok($$insert into public.project_documents (id,org_id,project_id,category,title,status,author_id,source,ms_drive_id)
 values (gen_random_uuid(),'10200000-0000-0000-0000-000000000001','10200000-0000-0000-0000-000000000201','Specification','collision','Draft','10200000-0000-0000-0000-000000000102','onedrive','drive')$$,
 '23514', null, 'AC-M365DOC-002 rejects incomplete Microsoft reference');
select throws_ok($$insert into public.project_documents (id,org_id,project_id,category,title,status,author_id,source,file_path,ms_drive_id)
 values (gen_random_uuid(),'10200000-0000-0000-0000-000000000001','10200000-0000-0000-0000-000000000201','Specification','collision','Draft','10200000-0000-0000-0000-000000000102','upload','fixture/path','drive')$$,
 '23514', null, 'AC-M365DOC-002 rejects upload with Microsoft metadata');

-- Every optional reference field is forbidden in metadata-only and upload states.
select throws_ok($$insert into public.project_documents (id,org_id,project_id,category,title,status,author_id,ms_drive_id) values (gen_random_uuid(),'10200000-0000-0000-0000-000000000001','10200000-0000-0000-0000-000000000201','Specification','orphan','Draft','10200000-0000-0000-0000-000000000102','drive')$$,'23514',null,'AC-M365DOC-002 rejects orphan drive');
select throws_ok($$insert into public.project_documents (id,org_id,project_id,category,title,status,author_id,ms_item_id) values (gen_random_uuid(),'10200000-0000-0000-0000-000000000001','10200000-0000-0000-0000-000000000201','Specification','orphan','Draft','10200000-0000-0000-0000-000000000102','item')$$,'23514',null,'AC-M365DOC-002 rejects orphan item');
select throws_ok($$insert into public.project_documents (id,org_id,project_id,category,title,status,author_id,ms_web_url) values (gen_random_uuid(),'10200000-0000-0000-0000-000000000001','10200000-0000-0000-0000-000000000201','Specification','orphan','Draft','10200000-0000-0000-0000-000000000102','https://example.invalid/x')$$,'23514',null,'AC-M365DOC-002 rejects orphan URL');
select throws_ok($$insert into public.project_documents (id,org_id,project_id,category,title,status,author_id,ms_item_name) values (gen_random_uuid(),'10200000-0000-0000-0000-000000000001','10200000-0000-0000-0000-000000000201','Specification','orphan','Draft','10200000-0000-0000-0000-000000000102','name')$$,'23514',null,'AC-M365DOC-002 rejects orphan name');
select throws_ok($$insert into public.project_documents (id,org_id,project_id,category,title,status,author_id,ms_item_kind) values (gen_random_uuid(),'10200000-0000-0000-0000-000000000001','10200000-0000-0000-0000-000000000201','Specification','orphan','Draft','10200000-0000-0000-0000-000000000102','file')$$,'23514',null,'AC-M365DOC-002 rejects orphan kind');
select throws_ok($$insert into public.project_documents (id,org_id,project_id,category,title,status,author_id,ms_linked_by) values (gen_random_uuid(),'10200000-0000-0000-0000-000000000001','10200000-0000-0000-0000-000000000201','Specification','orphan','Draft','10200000-0000-0000-0000-000000000102','10200000-0000-0000-0000-000000000102')$$,'23514',null,'AC-M365DOC-002 rejects orphan linker');
select throws_ok($$insert into public.project_documents (id,org_id,project_id,category,title,status,author_id,ms_linked_at) values (gen_random_uuid(),'10200000-0000-0000-0000-000000000001','10200000-0000-0000-0000-000000000201','Specification','orphan','Draft','10200000-0000-0000-0000-000000000102',now())$$,'23514',null,'AC-M365DOC-002 rejects orphan link time');
select throws_ok($$insert into public.project_documents (id,org_id,project_id,category,title,status,author_id,ms_last_verified_at) values (gen_random_uuid(),'10200000-0000-0000-0000-000000000001','10200000-0000-0000-0000-000000000201','Specification','orphan','Draft','10200000-0000-0000-0000-000000000102',now())$$,'23514',null,'AC-M365DOC-002 rejects orphan verification time');
select throws_ok($$insert into public.project_documents (id,org_id,project_id,category,title,status,author_id,ms_content_tag_at_issue) values (gen_random_uuid(),'10200000-0000-0000-0000-000000000001','10200000-0000-0000-0000-000000000201','Specification','orphan','Draft','10200000-0000-0000-0000-000000000102','tag')$$,'23514',null,'AC-M365DOC-002 rejects orphan baseline');
select throws_ok($$insert into public.project_documents (id,org_id,project_id,category,title,status,author_id,ms_version_id_at_issue) values (gen_random_uuid(),'10200000-0000-0000-0000-000000000001','10200000-0000-0000-0000-000000000201','Specification','orphan','Draft','10200000-0000-0000-0000-000000000102','version')$$,'23514',null,'AC-M365DOC-002 rejects orphan pin');
select throws_ok($$insert into public.project_documents (id,org_id,project_id,category,title,status,author_id,ms_drift_state) values (gen_random_uuid(),'10200000-0000-0000-0000-000000000001','10200000-0000-0000-0000-000000000201','Specification','orphan','Draft','10200000-0000-0000-0000-000000000102','clean')$$,'23514',null,'AC-M365DOC-002 rejects orphan drift');
select throws_ok($$insert into public.project_documents (id,org_id,project_id,category,title,status,author_id,ms_check_claim) values (gen_random_uuid(),'10200000-0000-0000-0000-000000000001','10200000-0000-0000-0000-000000000201','Specification','orphan','Draft','10200000-0000-0000-0000-000000000102',gen_random_uuid())$$,'23514',null,'AC-M365DOC-002 rejects orphan claim');
select throws_ok($$insert into public.project_documents (id,org_id,project_id,category,title,status,author_id,ms_check_claimed_at) values (gen_random_uuid(),'10200000-0000-0000-0000-000000000001','10200000-0000-0000-0000-000000000201','Specification','orphan','Draft','10200000-0000-0000-0000-000000000102',now())$$,'23514',null,'AC-M365DOC-002 rejects orphan claim time');

-- Complete refs reject whitespace, invalid kind/URL, and controlled fields on folders.
select throws_ok($$insert into public.project_documents (id,org_id,project_id,category,title,status,author_id,source,ms_drive_id,ms_item_id,ms_web_url,ms_item_name,ms_item_kind,ms_linked_by,ms_linked_at) values (gen_random_uuid(),'10200000-0000-0000-0000-000000000001','10200000-0000-0000-0000-000000000201','Specification','bad','Draft','10200000-0000-0000-0000-000000000102','onedrive',' ','item','https://example.invalid/x','name','file','10200000-0000-0000-0000-000000000102',now())$$,'23514',null,'AC-M365DOC-002 rejects whitespace identity');
select throws_ok($$insert into public.project_documents (id,org_id,project_id,category,title,status,author_id,source,ms_drive_id,ms_item_id,ms_web_url,ms_item_name,ms_item_kind,ms_linked_by,ms_linked_at) values (gen_random_uuid(),'10200000-0000-0000-0000-000000000001','10200000-0000-0000-0000-000000000201','Specification','bad','Draft','10200000-0000-0000-0000-000000000102','onedrive','drive','item','http://example.invalid/x','name','file','10200000-0000-0000-0000-000000000102',now())$$,'23514',null,'AC-M365DOC-002 rejects non-HTTPS URL');
select throws_ok($$insert into public.project_documents (id,org_id,project_id,category,title,status,author_id,source,ms_drive_id,ms_item_id,ms_web_url,ms_item_name,ms_item_kind,ms_linked_by,ms_linked_at) values (gen_random_uuid(),'10200000-0000-0000-0000-000000000001','10200000-0000-0000-0000-000000000201','Specification','bad','Draft','10200000-0000-0000-0000-000000000102','onedrive','drive','item','https://example.invalid/x','name','other','10200000-0000-0000-0000-000000000102',now())$$,'23514',null,'AC-M365DOC-002 rejects invalid kind');
select throws_ok($$insert into public.project_documents (id,org_id,project_id,category,title,status,author_id,source,ms_drive_id,ms_item_id,ms_web_url,ms_item_name,ms_item_kind,ms_linked_by,ms_linked_at,ms_content_tag_at_issue) values (gen_random_uuid(),'10200000-0000-0000-0000-000000000001','10200000-0000-0000-0000-000000000201','Specification','folder','Draft','10200000-0000-0000-0000-000000000102','onedrive','drive','item','https://example.invalid/x','name','folder','10200000-0000-0000-0000-000000000102',now(),'tag')$$,'23514',null,'AC-M365DOC-002 rejects folder content baseline');
select throws_ok($$insert into public.project_documents (id,org_id,project_id,category,title,status,author_id,source,ms_drive_id,ms_item_id,ms_web_url,ms_item_name,ms_item_kind,ms_linked_by,ms_linked_at,ms_check_claim,ms_check_claimed_at) values (gen_random_uuid(),'10200000-0000-0000-0000-000000000001','10200000-0000-0000-0000-000000000201','Specification','folder','Draft','10200000-0000-0000-0000-000000000102','onedrive','drive','item','https://example.invalid/x','name','folder','10200000-0000-0000-0000-000000000102',now(),gen_random_uuid(),now())$$,'23514',null,'AC-M365DOC-002 rejects folder claim');

-- Accepted metadata-only, backfilled upload, and file/folder references.
select lives_ok($$insert into public.project_documents (id,org_id,project_id,category,title,status,author_id) values (gen_random_uuid(),'10200000-0000-0000-0000-000000000001','10200000-0000-0000-0000-000000000201','Specification','metadata','Draft','10200000-0000-0000-0000-000000000102')$$,'AC-M365DOC-053 accepts metadata-only row');
select lives_ok($$insert into public.project_documents (id,org_id,project_id,category,title,status,author_id,file_path,source) values (gen_random_uuid(),'10200000-0000-0000-0000-000000000001','10200000-0000-0000-0000-000000000201','Specification','upload','Draft','10200000-0000-0000-0000-000000000102','fixture/path','upload')$$,'AC-M365DOC-053 accepts upload');
select lives_ok($$insert into public.project_documents (id,org_id,project_id,category,title,status,author_id,source,ms_drive_id,ms_item_id,ms_web_url,ms_item_name,ms_item_kind,ms_linked_by,ms_linked_at) values (gen_random_uuid(),'10200000-0000-0000-0000-000000000001','10200000-0000-0000-0000-000000000201','Specification','file','Draft','10200000-0000-0000-0000-000000000102','onedrive','drive','item','https://EXAMPLE.invalid/x','name','file','10200000-0000-0000-0000-000000000102',now())$$,'AC-M365DOC-053 accepts complete file ref');
select lives_ok($$insert into public.project_documents (id,org_id,project_id,category,title,status,author_id,source,ms_drive_id,ms_item_id,ms_web_url,ms_item_name,ms_item_kind,ms_linked_by,ms_linked_at) values (gen_random_uuid(),'10200000-0000-0000-0000-000000000001','10200000-0000-0000-0000-000000000201','Specification','folder','Draft','10200000-0000-0000-0000-000000000102','onedrive','drive','folder-item','https://example.invalid/folder','folder','folder','10200000-0000-0000-0000-000000000102',now())$$,'AC-M365DOC-053 accepts complete folder ref');

-- Supporting AC-M365DOC-001/051/052/055/066 index and FK shape proof.
select ok(to_regclass('public.m365_budget_parent_idx') is not null,
  'AC-M365DOC-052 budget evidence parent query has its ordered composite index');
select ok(to_regclass('public.project_documents_ms_identity_idx') is not null,
  'AC-M365DOC-001 project reference identity is indexed by org and item');
select ok(to_regclass('public.procurement_documents_ms_identity_idx') is not null,
  'AC-M365DOC-051 procurement reference identity is indexed by org and item');
select ok(to_regclass('public.m365_budget_identity_idx') is not null,
  'AC-M365DOC-052 budget reference identity is indexed by org and item');
select ok(exists(select 1 from pg_constraint c
  where c.conrelid='public.budget_version_document_links'::regclass
    and c.contype='f' and c.confrelid='public.budget_versions'::regclass
    and pg_get_constraintdef(c.oid) like '%ON DELETE CASCADE%'),
  'AC-M365DOC-052 budget evidence parent FK cascades on version deletion');

select * from finish();
rollback;

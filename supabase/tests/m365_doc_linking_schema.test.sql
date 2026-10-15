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

select * from finish();
rollback;

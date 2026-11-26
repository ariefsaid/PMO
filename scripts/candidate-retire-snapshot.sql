-- Catalog snapshot of every object migration 2720 drops or narrows (#2915): one line per fact, sorted, so two
-- snapshots compare with diff. Used by scripts/test-2720-candidate-rollback.sh.
select 'fn ' || p.oid::regprocedure::text || ' ' || md5(pg_get_functiondef(p.oid)) || ' acl=' || coalesce(p.proacl::text, '-')
       || ' cfg=' || coalesce(p.proconfig::text, '-')
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.proname in ('create_work_order_candidate', 'decide_work_order_candidate',
   'check_work_order_candidate_item', 'check_work_order_candidate_proof', 'check_work_order_candidate_update',
   'wo_candidate_can_assess', 'wo_candidate_item_can_edit', 'audit_work_order_candidate_row')
union all
select 'trg ' || c.relname || ' ' || md5(pg_get_triggerdef(t.oid))
  from pg_trigger t join pg_class c on c.oid = t.tgrelid
 where not t.tgisinternal and c.relname in ('work_order_candidates', 'work_order_candidate_items', 'work_order_candidate_proofs')
union all
select 'pol ' || schemaname || '.' || tablename || ' ' || policyname || ' ' || cmd || ' ' || roles::text || ' q=' || coalesce(md5(qual), '-')
       || ' w=' || coalesce(md5(with_check), '-')
  from pg_policies
 where tablename in ('work_order_candidates', 'work_order_candidate_items', 'work_order_candidate_proofs')
    or policyname like 'storage_objects_wo_candidate_proof%'
union all
select 'colgrant ' || table_name || '.' || column_name || ' ' || grantee || ' ' || privilege_type
  from information_schema.column_privileges
 where table_schema = 'public' and table_name in ('work_order_candidates', 'work_order_candidate_items', 'work_order_candidate_proofs')
   and grantee in ('authenticated', 'anon')
union all
select 'tblgrant ' || table_name || ' ' || grantee || ' ' || privilege_type
  from information_schema.table_privileges
 where table_schema = 'public' and table_name in ('work_order_candidates', 'work_order_candidate_items', 'work_order_candidate_proofs')
   and grantee in ('authenticated', 'anon')
union all
select 'bucket ' || id || ' ' || public::text || ' ' || coalesce(file_size_limit::text, '-') || ' ' || coalesce(allowed_mime_types::text, '-')
  from storage.buckets where id = 'work-order-candidate-proofs'
order by 1;

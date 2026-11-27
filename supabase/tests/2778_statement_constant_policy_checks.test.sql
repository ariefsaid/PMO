begin;
select plan(3);
select is_empty($q$select schemaname, tablename, policyname from pg_policies
 where schemaname in ('public','storage') and
 (coalesce(qual,'') || coalesce(with_check,'')) ~ '(?<!SELECT )(org_feature_enabled|domain_externally_owned)\(\( SELECT auth_org_id\(\) AS auth_org_id\), ''[a-z_]+''::text\)'$q$,
 'AC-PERF2973-001 constant feature and ownership checks use scalar subqueries');
select is_empty($q$select indexname from pg_indexes where schemaname='public'
 and indexname in ('agent_events_run_seq_idx','sales_invoices_vat_project_idx','timesheets_user_week_idx')$q$,
 'AC-PERF2973-002 redundant physical indexes are absent');
select is((select count(*)::integer from pg_index where indexrelid in
 ('public.agent_events_run_id_seq_key'::regclass,'public.sales_invoices_org_project_idx'::regclass,
 'public.timesheets_user_id_week_start_date_key'::regclass) and indisvalid and indisready),3,
 'AC-PERF2973-003 retained lookup paths are ready and valid');
select * from finish();
rollback;

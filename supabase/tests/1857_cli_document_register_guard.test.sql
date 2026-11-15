-- 1857 AC-DOC-CLI-001: a command-line sign-in (a token with a client_id claim) may POST and PATCH project_documents as an
-- active Admin, Executive, Project Manager or Finance member, the table's own write-policy roles, so `pmo documents
-- create|upload` can add a register entry and attach its uploaded file. Every other role, an inactive member, DELETE and
-- the sibling procurement document table stay refused. AC-DOC-CLI-002: the table's own rules still decide the write.
-- AC-DOC-CLI-003: every allow-list entry of the 0882 body still passes the replaced guard (one row per entry and method,
-- listed here from 0882 so a later body cannot drop one silently).
begin;
select plan(19);

insert into organizations (id, name, default_currency) values
  ('18570000-0000-0000-0000-00000000000a','DOC A','IDR'), ('18570000-0000-0000-0000-00000000000b','DOC B','IDR');
insert into auth.users (id, email) values
  ('18570000-0000-0000-0000-0000000000a1','doc-admin@example.com'), ('18570000-0000-0000-0000-0000000000a2','doc-exec@example.com'),
  ('18570000-0000-0000-0000-0000000000a3','doc-pm@example.com'), ('18570000-0000-0000-0000-0000000000a4','doc-fin@example.com'),
  ('18570000-0000-0000-0000-0000000000a5','doc-eng@example.com'), ('18570000-0000-0000-0000-0000000000a6','doc-off@example.com'),
  ('18570000-0000-0000-0000-0000000000b1','doc-pmb@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('18570000-0000-0000-0000-0000000000a1','18570000-0000-0000-0000-00000000000a','Admin','doc-admin@example.com','Admin','active'),
  ('18570000-0000-0000-0000-0000000000a2','18570000-0000-0000-0000-00000000000a','Exec','doc-exec@example.com','Executive','active'),
  ('18570000-0000-0000-0000-0000000000a3','18570000-0000-0000-0000-00000000000a','PM','doc-pm@example.com','Project Manager','active'),
  ('18570000-0000-0000-0000-0000000000a4','18570000-0000-0000-0000-00000000000a','Fin','doc-fin@example.com','Finance','active'),
  ('18570000-0000-0000-0000-0000000000a5','18570000-0000-0000-0000-00000000000a','Eng','doc-eng@example.com','Engineer','active'),
  ('18570000-0000-0000-0000-0000000000a6','18570000-0000-0000-0000-00000000000a','Off','doc-off@example.com','Project Manager','disabled'),
  ('18570000-0000-0000-0000-0000000000b1','18570000-0000-0000-0000-00000000000b','PMB','doc-pmb@example.com','Project Manager','active');
insert into projects (id, org_id, name, code) values
  ('18570000-0000-0000-0000-0000000000d1','18570000-0000-0000-0000-00000000000a','DOC project','DOC-1857');

create function pg_temp.req(p_sub text, p_method text, p_path text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_sub, 'role', 'authenticated', 'client_id', 'pmo-cli')::text, true),
         set_config('request.method', p_method, true), set_config('request.path', p_path, true), set_config('request.headers', '{}', true);
$$;
-- true when the guard lets the request through, false when it refuses with 42501
create function pg_temp.passes(p_sub text, p_method text, p_path text) returns boolean language plpgsql as $$
begin
  perform pg_temp.req(p_sub, p_method, p_path);
  perform public.api_client_request_guard();
  return true;
exception when sqlstate '42501' then
  return false;
end $$;

set local role authenticated;

-- AC-DOC-CLI-001 the new entries
select is(array(select r from unnest(array['18570000-0000-0000-0000-0000000000a1','18570000-0000-0000-0000-0000000000a2',
    '18570000-0000-0000-0000-0000000000a3','18570000-0000-0000-0000-0000000000a4']) r
  where not pg_temp.passes(r, 'POST', '/project_documents')), '{}'::text[],
  'AC-DOC-CLI-001 an active Admin, Executive, Project Manager and Finance API client may POST a document register entry');
select is(array(select r from unnest(array['18570000-0000-0000-0000-0000000000a1','18570000-0000-0000-0000-0000000000a2',
    '18570000-0000-0000-0000-0000000000a3','18570000-0000-0000-0000-0000000000a4']) r
  where not pg_temp.passes(r, 'PATCH', '/project_documents')), '{}'::text[],
  'AC-DOC-CLI-001 the same roles may PATCH a document register entry (attach the uploaded file)');
select is(pg_temp.passes('18570000-0000-0000-0000-0000000000a5', 'POST', '/project_documents'), false, 'AC-DOC-CLI-001 an Engineer API client is refused POST');
select is(pg_temp.passes('18570000-0000-0000-0000-0000000000a5', 'PATCH', '/project_documents'), false, 'AC-DOC-CLI-001 an Engineer API client is refused PATCH');
select is(pg_temp.passes('18570000-0000-0000-0000-0000000000a6', 'POST', '/project_documents'), false, 'AC-DOC-CLI-001 an inactive Project Manager is refused POST');
select is(pg_temp.passes('18570000-0000-0000-0000-0000000000a6', 'PATCH', '/project_documents'), false, 'AC-DOC-CLI-001 an inactive Project Manager is refused PATCH');
select is(pg_temp.passes('18570000-0000-0000-0000-0000000000a1', 'DELETE', '/project_documents'), false, 'AC-DOC-CLI-001 deletes stay app-only, even for an Admin');
select is(pg_temp.passes('18570000-0000-0000-0000-0000000000a1', 'POST', '/procurement_documents'), false, 'AC-DOC-CLI-001 the procurement document table is not exposed');
select is(pg_temp.passes('18570000-0000-0000-0000-0000000000a1', 'POST', '/project_documents_x'), false, 'AC-DOC-CLI-001 only the exact table name matches');
select is(pg_temp.passes('18570000-0000-0000-0000-0000000000a5', 'GET', '/project_documents'), false, 'AC-DOC-CLI-001 the read tier is unchanged: an Engineer still may not read');

-- AC-DOC-CLI-002 the table's own rules still decide: org stamping, the role policy and the Draft-only status
select pg_temp.req('18570000-0000-0000-0000-0000000000a3', 'POST', '/project_documents');
select lives_ok($$insert into public.project_documents (id, project_id, category, title, author_id) values
  ('18570000-0000-0000-0000-0000000000e1','18570000-0000-0000-0000-0000000000d1','Reference','CLI register entry','18570000-0000-0000-0000-0000000000a3')$$,
  'AC-DOC-CLI-002 a Project Manager CLI token creates a register entry');
select is((select org_id::text || ':' || status::text from public.project_documents where id = '18570000-0000-0000-0000-0000000000e1'),
  '18570000-0000-0000-0000-00000000000a:Draft', 'AC-DOC-CLI-002 the entry is stamped with the caller org and starts as Draft');
select pg_temp.req('18570000-0000-0000-0000-0000000000b1', 'POST', '/project_documents');
select throws_ok($$insert into public.project_documents (project_id, category, title) values
  ('18570000-0000-0000-0000-0000000000d1','Reference','Foreign write')$$, '42501', null,
  'AC-DOC-CLI-002 a Project Manager of another org cannot create an entry on this project');
select pg_temp.req('18570000-0000-0000-0000-0000000000a5', 'POST', '/project_documents');
select throws_ok($$insert into public.project_documents (project_id, category, title) values
  ('18570000-0000-0000-0000-0000000000d1','Reference','Engineer write')$$, '42501', null,
  'AC-DOC-CLI-002 an Engineer is refused by the table policy too');
select pg_temp.req('18570000-0000-0000-0000-0000000000a3', 'PATCH', '/project_documents');
select throws_ok($$update public.project_documents set status = 'Approved' where id = '18570000-0000-0000-0000-0000000000e1'$$, '42501', null,
  'AC-DOC-CLI-002 a PATCH cannot move the status; the status RPC stays its only writer');

-- AC-DOC-CLI-003 every 0882 allow-list entry still holds (tier, method, path, open to any active member)
create temp table entries_0882 (tier text, method text, path text, open_tier boolean) on commit drop;
insert into entries_0882 values
('write_tables','GET','/projects',true),
  ('write_tables','POST','/projects',true),
  ('write_tables','PATCH','/projects',true),
  ('write_tables','GET','/project_milestones',true),
  ('write_tables','POST','/project_milestones',true),
  ('write_tables','PATCH','/project_milestones',true),
  ('write_tables','GET','/tasks',true),
  ('write_tables','POST','/tasks',true),
  ('write_tables','PATCH','/tasks',true),
  ('write_tables','GET','/meetings',true),
  ('write_tables','POST','/meetings',true),
  ('write_tables','PATCH','/meetings',true),
  ('write_tables','GET','/crm_activities',true),
  ('write_tables','POST','/crm_activities',true),
  ('write_tables','PATCH','/crm_activities',true),
  ('write_tables','GET','/companies',true),
  ('write_tables','POST','/companies',true),
  ('write_tables','PATCH','/companies',true),
  ('write_tables','GET','/contacts',true),
  ('write_tables','POST','/contacts',true),
  ('write_tables','PATCH','/contacts',true),
  ('read_only_tables','GET','/profiles',true),
  ('read_only_tables','GET','/external_domain_ownership',true),
  ('rpcs','POST','/rpc/get_project_milestones',true),
  ('admin_write_tables','GET','/budget_versions',false),
  ('admin_write_tables','POST','/budget_versions',false),
  ('admin_write_tables','GET','/budget_line_items',false),
  ('admin_write_tables','POST','/budget_line_items',false),
  ('admin_write_tables','GET','/boq_items',false),
  ('admin_write_tables','POST','/boq_items',false),
  ('admin_rpcs','POST','/rpc/set_project_contract_value',false),
  ('admin_rpcs','POST','/rpc/transition_project',false),
  ('admin_rpcs','POST','/rpc/import_budget_line_v2',false),
  ('stage_admin_rpcs','POST','/rpc/redate_stage_entry',false),
  ('stage_admin_tables','GET','/project_stage_entries',false),
  ('purchase_rpcs','POST','/rpc/link_erp_purchase_documents',false),
  ('purchase_rpcs','POST','/rpc/link_procurement_sharepoint_item',false),
  ('purchase_rpcs','POST','/rpc/attach_erp_journal_lines',false),
  ('purchase_rpcs','POST','/rpc/project_erp_journal_lines',false),
  ('purchase_rpcs','POST','/rpc/create_record_only_journal_purchase',false),
  ('purchase_rpcs','POST','/rpc/undo_captured_purchase',false),
  ('purchase_read_views','GET','/erp_purchase_orphans',false),
  ('purchase_read_views','GET','/erp_purchase_orphans_all',false),
  ('set_aside_rpcs','POST','/rpc/mark_erp_purchase_documents',false),
  ('admin_cli_rpcs','POST','/rpc/recategorise_budget_lines',false),
  ('operator_read_tables','GET','/budget_versions',false),
  ('operator_read_tables','GET','/budget_line_items',false),
  ('operator_read_tables','GET','/budget_category_account_map',false),
  ('operator_read_tables','GET','/erp_gl_entry_mirror',false),
  ('operator_read_tables','GET','/project_documents',false),
  ('operator_read_tables','GET','/org_m365_document_settings',false),
  ('operator_read_tables','GET','/m365_record_folder_sweeps',false),
  ('operator_read_tables','GET','/contract_rate_lines',false),
  ('operator_read_tables','GET','/contract_rate_assignees',false),
  ('operator_read_rpcs','POST','/rpc/project_mapped_actuals',false),
  ('operator_read_rpcs','POST','/rpc/link_m365_documents_batch',false),
  ('budget_ops_rpcs','POST','/rpc/budget_activation_mode',false),
  ('account_map_tables','GET','/budget_category_account_map',false),
  ('account_map_tables','POST','/budget_category_account_map',false),
  ('account_map_rpcs','POST','/rpc/set_budget_push_account',false),
  ('cost_attribution_write_rpcs','POST','/rpc/preview_cost_attribution',false),
  ('cost_attribution_write_rpcs','POST','/rpc/save_cost_attribution_rule',false),
  ('cost_attribution_write_rpcs','POST','/rpc/end_cost_attribution_rule',false),
  ('cost_attribution_read_rpcs','POST','/rpc/list_cost_attribution_rules',false),
  ('equipment_write_rpcs','POST','/rpc/preview_equipment_costing',false),
  ('equipment_write_rpcs','POST','/rpc/save_equipment_costing',false),
  ('equipment_write_rpcs','POST','/rpc/end_equipment_costing',false),
  ('equipment_read_rpcs','POST','/rpc/list_equipment_costing',false),
  ('equipment_read_rpcs','POST','/rpc/list_equipment_allocations',false),
  ('equipment_usage_rpcs','POST','/rpc/list_equipment_usage_totals',true),
  ('tm_write_rpcs','POST','/rpc/save_contract_rate_line',false),
  ('tm_write_rpcs','POST','/rpc/end_contract_rate_line',false),
  ('tm_write_rpcs','POST','/rpc/set_contract_rate_assignee',false),
  ('tm_write_rpcs','POST','/rpc/end_contract_rate_assignee',false),
  ('tm_write_rpcs','POST','/rpc/assemble_tm_claim',false),
  ('tm_write_rpcs','POST','/rpc/deselect_tm_source',false),
  ('tm_write_rpcs','POST','/rpc/prepare_tm_signoff',false),
  ('tm_write_rpcs','POST','/rpc/withdraw_tm_signoff',false),
  ('tm_write_rpcs','POST','/rpc/confirm_tm_signoff',false),
  ('tm_read_rpcs','POST','/rpc/list_tm_claims',false),
  ('tm_read_rpcs','POST','/rpc/preview_tm_claim',false),
  ('tm_read_rpcs','POST','/rpc/list_tm_claim_source_details',false),
  ('native_receipt_rpcs','POST','/rpc/create_procurement_receipt',false),
  ('capture_read_rpcs','POST','/rpc/purchase_capture_source_page',false),
  ('capture_read_rpcs','POST','/rpc/purchase_capture_ledger_page',false),
  ('capture_read_rpcs','POST','/rpc/purchase_capture_feed_health',false),
  ('dispatch_read_rpcs','POST','/rpc/domain_owned_by_tier',true),
  ('dispatch_read_rpcs','POST','/rpc/actor_authorization_state',true),
  ('dispatch_read_procurement_rpcs','POST','/rpc/pre_cutover_procurement',false),
  ('capture_assign_rpcs','POST','/rpc/assign_capture_invoices',false),
  ('capture_assign_rpcs','POST','/rpc/purchase_capture_assignment_report',false);
select is((select count(*)::int from entries_0882), 91, 'AC-DOC-CLI-003 the 0882 list carries all 91 entry and method pairs');
select is(array(select tier || ' ' || method || ' ' || path from entries_0882
  where not pg_temp.passes('18570000-0000-0000-0000-0000000000a1', method, path) order by 1), '{}'::text[],
  'AC-DOC-CLI-003 an active Admin API client still passes every 0882 entry');
select is(array(select tier || ' ' || method || ' ' || path from entries_0882
  where open_tier and not pg_temp.passes('18570000-0000-0000-0000-0000000000a5', method, path) order by 1), '{}'::text[],
  'AC-DOC-CLI-003 an active Engineer API client still passes every 0882 entry open to any active member');
select is(array(select tier || ' ' || method || ' ' || path from entries_0882
  where pg_temp.passes('18570000-0000-0000-0000-0000000000a6', method, path) and not open_tier order by 1), '{}'::text[],
  'AC-DOC-CLI-003 an inactive member still passes no role-gated 0882 entry');

select * from finish();
rollback;

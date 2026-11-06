-- 0696_rls_row_policies_once_per_query.sql — evaluate the remaining caller lookups once per statement (#1254).
-- Rollback: rollback/0696_rls_row_policies_once_per_query_down.sql
--
-- 0646/0655 wrapped auth_org_id()/auth_role()/is_active_member() as (select fn()) so they run as one initplan per
-- statement. What still ran per row (public and storage policies): auth.uid(), auth.jwt(), stock_admin(), stock_master_writer() and
-- holds_spend_approval_authority(<wrapped role>). Each is STABLE/IMMUTABLE and constant within a statement, so wrapping
-- changes cost only: same USING / WITH CHECK, same roles, same command, same permissive/restrictive (ALTER POLICY
-- re-states only the expressions). pgTAP 0696_rls_once_per_query_equivalence proves equal visibility and write
-- outcomes per role, and that no public policy calls these helpers per row.
begin;

alter policy agent_attachments_insert on public.agent_attachments
  with check (((owner_id = ( SELECT auth.uid() AS uid)) AND (org_id = ( SELECT auth_org_id() AS auth_org_id)) AND (storage_path = ((('org/'::text || (( SELECT auth_org_id() AS auth_org_id))::text) || '/agent-attachments/'::text) || (id)::text)) AND (EXISTS ( SELECT 1
   FROM agent_threads t
  WHERE ((t.id = agent_attachments.thread_id) AND (t.owner_id = ( SELECT auth.uid() AS uid)) AND (t.org_id = ( SELECT auth_org_id() AS auth_org_id))))) AND ( SELECT is_active_member() AS is_active_member)));
alter policy agent_attachments_select on public.agent_attachments
  using (((owner_id = ( SELECT auth.uid() AS uid)) AND (org_id = ( SELECT auth_org_id() AS auth_org_id)) AND ( SELECT is_active_member() AS is_active_member)));
alter policy agent_attachments_update on public.agent_attachments
  using (((owner_id = ( SELECT auth.uid() AS uid)) AND (org_id = ( SELECT auth_org_id() AS auth_org_id)) AND ( SELECT is_active_member() AS is_active_member)))
  with check (((owner_id = ( SELECT auth.uid() AS uid)) AND (org_id = ( SELECT auth_org_id() AS auth_org_id)) AND (storage_path = ((('org/'::text || (( SELECT auth_org_id() AS auth_org_id))::text) || '/agent-attachments/'::text) || (id)::text)) AND (EXISTS ( SELECT 1
   FROM agent_threads t
  WHERE ((t.id = agent_attachments.thread_id) AND (t.owner_id = ( SELECT auth.uid() AS uid)) AND (t.org_id = ( SELECT auth_org_id() AS auth_org_id))))) AND ( SELECT is_active_member() AS is_active_member)));
alter policy agent_automations_delete on public.agent_automations
  using (((owner_id = ( SELECT auth.uid() AS uid)) AND (org_id = ( SELECT auth_org_id() AS auth_org_id)) AND ( SELECT is_active_member() AS is_active_member)));
alter policy agent_automations_insert on public.agent_automations
  with check (((owner_id = ( SELECT auth.uid() AS uid)) AND (org_id = ( SELECT auth_org_id() AS auth_org_id)) AND ( SELECT is_active_member() AS is_active_member)));
alter policy agent_automations_select on public.agent_automations
  using (((owner_id = ( SELECT auth.uid() AS uid)) AND (org_id = ( SELECT auth_org_id() AS auth_org_id)) AND ( SELECT is_active_member() AS is_active_member)));
alter policy agent_automations_update on public.agent_automations
  using (((owner_id = ( SELECT auth.uid() AS uid)) AND (org_id = ( SELECT auth_org_id() AS auth_org_id)) AND ( SELECT is_active_member() AS is_active_member)))
  with check (((owner_id = ( SELECT auth.uid() AS uid)) AND (org_id = ( SELECT auth_org_id() AS auth_org_id)) AND ( SELECT is_active_member() AS is_active_member)));
alter policy agent_events_insert on public.agent_events
  with check (((owner_id = ( SELECT auth.uid() AS uid)) AND (org_id = ( SELECT auth_org_id() AS auth_org_id)) AND (EXISTS ( SELECT 1
   FROM agent_runs r
  WHERE ((r.id = agent_events.run_id) AND (r.owner_id = ( SELECT auth.uid() AS uid)) AND (r.org_id = ( SELECT auth_org_id() AS auth_org_id))))) AND ( SELECT is_active_member() AS is_active_member)));
alter policy agent_events_select on public.agent_events
  using (((owner_id = ( SELECT auth.uid() AS uid)) AND (org_id = ( SELECT auth_org_id() AS auth_org_id)) AND ( SELECT is_active_member() AS is_active_member)));
alter policy agent_events_update on public.agent_events
  using (((owner_id = ( SELECT auth.uid() AS uid)) AND (org_id = ( SELECT auth_org_id() AS auth_org_id)) AND (type = 'assistant'::text) AND ( SELECT is_active_member() AS is_active_member)))
  with check (((owner_id = ( SELECT auth.uid() AS uid)) AND (org_id = ( SELECT auth_org_id() AS auth_org_id)) AND (type = 'assistant'::text) AND ( SELECT is_active_member() AS is_active_member)));
alter policy agent_runs_insert on public.agent_runs
  with check (((owner_id = ( SELECT auth.uid() AS uid)) AND (org_id = ( SELECT auth_org_id() AS auth_org_id)) AND (EXISTS ( SELECT 1
   FROM agent_threads t
  WHERE ((t.id = agent_runs.thread_id) AND (t.owner_id = ( SELECT auth.uid() AS uid)) AND (t.org_id = ( SELECT auth_org_id() AS auth_org_id))))) AND ( SELECT is_active_member() AS is_active_member)));
alter policy agent_runs_select on public.agent_runs
  using (((owner_id = ( SELECT auth.uid() AS uid)) AND (org_id = ( SELECT auth_org_id() AS auth_org_id)) AND ( SELECT is_active_member() AS is_active_member)));
alter policy agent_runs_update on public.agent_runs
  using (((owner_id = ( SELECT auth.uid() AS uid)) AND (org_id = ( SELECT auth_org_id() AS auth_org_id)) AND ( SELECT is_active_member() AS is_active_member)))
  with check (((owner_id = ( SELECT auth.uid() AS uid)) AND (org_id = ( SELECT auth_org_id() AS auth_org_id)) AND ( SELECT is_active_member() AS is_active_member)));
alter policy agent_threads_insert on public.agent_threads
  with check (((owner_id = ( SELECT auth.uid() AS uid)) AND (org_id = ( SELECT auth_org_id() AS auth_org_id)) AND ( SELECT is_active_member() AS is_active_member)));
alter policy agent_threads_select on public.agent_threads
  using (((owner_id = ( SELECT auth.uid() AS uid)) AND (org_id = ( SELECT auth_org_id() AS auth_org_id)) AND ( SELECT is_active_member() AS is_active_member)));
alter policy agent_threads_update on public.agent_threads
  using (((owner_id = ( SELECT auth.uid() AS uid)) AND (org_id = ( SELECT auth_org_id() AS auth_org_id)) AND ( SELECT is_active_member() AS is_active_member)))
  with check (((owner_id = ( SELECT auth.uid() AS uid)) AND (org_id = ( SELECT auth_org_id() AS auth_org_id)) AND ( SELECT is_active_member() AS is_active_member)));
alter policy agent_usage_insert on public.agent_usage
  with check (((owner_id = ( SELECT auth.uid() AS uid)) AND (org_id = ( SELECT auth_org_id() AS auth_org_id)) AND ((run_id IS NULL) OR (EXISTS ( SELECT 1
   FROM agent_runs r
  WHERE ((r.id = agent_usage.run_id) AND (r.owner_id = ( SELECT auth.uid() AS uid)) AND (r.org_id = ( SELECT auth_org_id() AS auth_org_id)))))) AND ( SELECT is_active_member() AS is_active_member)));
alter policy agent_usage_select on public.agent_usage
  using (((owner_id = ( SELECT auth.uid() AS uid)) AND (org_id = ( SELECT auth_org_id() AS auth_org_id)) AND ( SELECT is_active_member() AS is_active_member)));
alter policy comments_insert on public.comments
  with check (((org_id = ( SELECT auth_org_id() AS auth_org_id)) AND ( SELECT is_active_member() AS is_active_member) AND (author_id = ( SELECT auth.uid() AS uid)) AND can_read_comment_parent(entity_type, entity_id)));
alter policy comments_select on public.comments
  using (((org_id = ( SELECT auth_org_id() AS auth_org_id)) AND ( SELECT is_active_member() AS is_active_member) AND can_read_comment_parent(entity_type, entity_id) AND ((archived_at IS NULL) OR (author_id = ( SELECT auth.uid() AS uid)))));
alter policy comments_update on public.comments
  using (((org_id = ( SELECT auth_org_id() AS auth_org_id)) AND ( SELECT is_active_member() AS is_active_member) AND (author_id = ( SELECT auth.uid() AS uid)) AND (archived_at IS NULL)))
  with check (((author_id = ( SELECT auth.uid() AS uid)) AND (archived_at IS NOT NULL)));
alter policy contract_rate_assignees_select on public.contract_rate_assignees
  using (((org_id = ( SELECT auth_org_id() AS auth_org_id)) AND ( SELECT is_active_member() AS is_active_member) AND ((( SELECT auth_role() AS auth_role) = ANY (ARRAY['Admin'::user_role, 'Finance'::user_role, 'Executive'::user_role])) OR ((( SELECT auth_role() AS auth_role) = 'Project Manager'::user_role) AND (EXISTS ( SELECT 1
   FROM projects p
  WHERE ((p.id = contract_rate_assignees.project_id) AND (p.org_id = contract_rate_assignees.org_id) AND (p.project_manager_id = ( SELECT auth.uid() AS uid)))))))));
alter policy contract_rate_lines_select on public.contract_rate_lines
  using (((org_id = ( SELECT auth_org_id() AS auth_org_id)) AND ( SELECT is_active_member() AS is_active_member) AND ((( SELECT auth_role() AS auth_role) = ANY (ARRAY['Admin'::user_role, 'Finance'::user_role, 'Executive'::user_role])) OR ((( SELECT auth_role() AS auth_role) = 'Project Manager'::user_role) AND (EXISTS ( SELECT 1
   FROM projects p
  WHERE ((p.id = contract_rate_lines.project_id) AND (p.org_id = contract_rate_lines.org_id) AND (p.project_manager_id = ( SELECT auth.uid() AS uid)))))))));
alter policy equipment_usage_entries_select on public.equipment_usage_entries
  using (((org_id = ( SELECT auth_org_id() AS auth_org_id)) AND ( SELECT is_active_member() AS is_active_member) AND ((author_id = ( SELECT auth.uid() AS uid)) OR (( SELECT auth_role() AS auth_role) = ANY (ARRAY['Admin'::user_role, 'Finance'::user_role, 'Executive'::user_role, 'Project Manager'::user_role])))));
alter policy erp_gl_entry_mirror_employee_read_scope on public.erp_gl_entry_mirror
  using (((party_type IS DISTINCT FROM 'Employee'::text) OR ( SELECT holds_spend_approval_authority(( SELECT auth_role() AS auth_role)) AS holds_spend_approval_authority)));
alter policy erp_payment_ledger_mirror_employee_read_scope on public.erp_payment_ledger_mirror
  using (((party_type IS DISTINCT FROM 'Employee'::text) OR ( SELECT holds_spend_approval_authority(( SELECT auth_role() AS auth_role)) AS holds_spend_approval_authority)));
alter policy expense_claim_files_write on public.expense_claim_files
  using (((org_id = ( SELECT auth_org_id() AS auth_org_id)) AND ( SELECT is_active_member() AS is_active_member) AND (EXISTS ( SELECT 1
   FROM expense_claims c
  WHERE ((c.id = expense_claim_files.claim_id) AND (c.org_id = ( SELECT auth_org_id() AS auth_org_id)) AND (c.claimant_id = ( SELECT auth.uid() AS uid)) AND (c.status = ANY (ARRAY['Draft'::expense_claim_status, 'Rejected'::expense_claim_status])))))))
  with check (((org_id = ( SELECT auth_org_id() AS auth_org_id)) AND ( SELECT is_active_member() AS is_active_member) AND (EXISTS ( SELECT 1
   FROM expense_claims c
  WHERE ((c.id = expense_claim_files.claim_id) AND (c.org_id = ( SELECT auth_org_id() AS auth_org_id)) AND (c.claimant_id = ( SELECT auth.uid() AS uid)) AND (c.status = ANY (ARRAY['Draft'::expense_claim_status, 'Rejected'::expense_claim_status])))))));
alter policy expense_claim_lines_write on public.expense_claim_lines
  using (((org_id = ( SELECT auth_org_id() AS auth_org_id)) AND ( SELECT is_active_member() AS is_active_member) AND (EXISTS ( SELECT 1
   FROM expense_claims c
  WHERE ((c.id = expense_claim_lines.claim_id) AND (c.org_id = ( SELECT auth_org_id() AS auth_org_id)) AND (c.claimant_id = ( SELECT auth.uid() AS uid)) AND (c.kind = 'claim'::expense_kind) AND (c.status = ANY (ARRAY['Draft'::expense_claim_status, 'Rejected'::expense_claim_status])))))))
  with check (((org_id = ( SELECT auth_org_id() AS auth_org_id)) AND ( SELECT is_active_member() AS is_active_member) AND (EXISTS ( SELECT 1
   FROM expense_claims c
  WHERE ((c.id = expense_claim_lines.claim_id) AND (c.org_id = ( SELECT auth_org_id() AS auth_org_id)) AND (c.claimant_id = ( SELECT auth.uid() AS uid)) AND (c.kind = 'claim'::expense_kind) AND (c.status = ANY (ARRAY['Draft'::expense_claim_status, 'Rejected'::expense_claim_status])))))));
alter policy expense_claims_insert on public.expense_claims
  with check (((org_id = ( SELECT auth_org_id() AS auth_org_id)) AND ( SELECT is_active_member() AS is_active_member) AND (claimant_id = ( SELECT auth.uid() AS uid)) AND ((project_id IS NULL) OR (EXISTS ( SELECT 1
   FROM projects p
  WHERE ((p.id = expense_claims.project_id) AND (p.org_id = ( SELECT auth_org_id() AS auth_org_id))))))));
alter policy expense_claims_select on public.expense_claims
  using (((org_id = ( SELECT auth_org_id() AS auth_org_id)) AND ( SELECT is_active_member() AS is_active_member) AND ((claimant_id = ( SELECT auth.uid() AS uid)) OR ( SELECT holds_spend_approval_authority(( SELECT auth_role() AS auth_role)) AS holds_spend_approval_authority))));
alter policy expense_claims_update on public.expense_claims
  using (((org_id = ( SELECT auth_org_id() AS auth_org_id)) AND ( SELECT is_active_member() AS is_active_member) AND (claimant_id = ( SELECT auth.uid() AS uid)) AND (status = ANY (ARRAY['Draft'::expense_claim_status, 'Rejected'::expense_claim_status]))))
  with check (((org_id = ( SELECT auth_org_id() AS auth_org_id)) AND ( SELECT is_active_member() AS is_active_member) AND (claimant_id = ( SELECT auth.uid() AS uid)) AND (status = ANY (ARRAY['Draft'::expense_claim_status, 'Rejected'::expense_claim_status])) AND ((project_id IS NULL) OR (EXISTS ( SELECT 1
   FROM projects p
  WHERE ((p.id = expense_claims.project_id) AND (p.org_id = ( SELECT auth_org_id() AS auth_org_id))))))));
alter policy external_command_outbox_expenses_read_scope on public.external_command_outbox
  using (((domain IS DISTINCT FROM 'expenses'::text) OR ( SELECT holds_spend_approval_authority(( SELECT auth_role() AS auth_role)) AS holds_spend_approval_authority)));
alter policy imprest_floats_select on public.imprest_floats
  using (((org_id = ( SELECT auth_org_id() AS auth_org_id)) AND ( SELECT is_active_member() AS is_active_member) AND ( SELECT holds_spend_approval_authority(( SELECT auth_role() AS auth_role)) AS holds_spend_approval_authority)));
alter policy imprest_plan_lines_write on public.imprest_plan_lines
  using (((org_id = ( SELECT auth_org_id() AS auth_org_id)) AND ( SELECT is_active_member() AS is_active_member) AND (EXISTS ( SELECT 1
   FROM imprest_plans p
  WHERE ((p.id = imprest_plan_lines.plan_id) AND (p.author_id = ( SELECT auth.uid() AS uid))))) AND org_feature_enabled(( SELECT auth_org_id() AS auth_org_id), 'imprest'::text)))
  with check (((org_id = ( SELECT auth_org_id() AS auth_org_id)) AND ( SELECT is_active_member() AS is_active_member) AND (EXISTS ( SELECT 1
   FROM imprest_plans p
  WHERE ((p.id = imprest_plan_lines.plan_id) AND (p.author_id = ( SELECT auth.uid() AS uid))))) AND org_feature_enabled(( SELECT auth_org_id() AS auth_org_id), 'imprest'::text)));
alter policy imprest_plans_insert on public.imprest_plans
  with check (((org_id = ( SELECT auth_org_id() AS auth_org_id)) AND ( SELECT is_active_member() AS is_active_member) AND (author_id = ( SELECT auth.uid() AS uid)) AND (status = 'Draft'::text) AND ( SELECT holds_spend_approval_authority(( SELECT auth_role() AS auth_role)) AS holds_spend_approval_authority) AND (EXISTS ( SELECT 1
   FROM imprest_floats f
  WHERE ((f.id = imprest_plans.float_id) AND (f.org_id = ( SELECT auth_org_id() AS auth_org_id)) AND (f.archived_at IS NULL)))) AND org_feature_enabled(( SELECT auth_org_id() AS auth_org_id), 'imprest'::text)));
alter policy notifications_delete on public.notifications
  using (((owner_id = ( SELECT auth.uid() AS uid)) AND (org_id = ( SELECT auth_org_id() AS auth_org_id)) AND ( SELECT is_active_member() AS is_active_member)));
alter policy notifications_insert on public.notifications
  with check (((owner_id = ( SELECT auth.uid() AS uid)) AND (org_id = ( SELECT auth_org_id() AS auth_org_id)) AND ( SELECT is_active_member() AS is_active_member)));
alter policy notifications_select on public.notifications
  using (((owner_id = ( SELECT auth.uid() AS uid)) AND (org_id = ( SELECT auth_org_id() AS auth_org_id)) AND ( SELECT is_active_member() AS is_active_member)));
alter policy notifications_update on public.notifications
  using (((owner_id = ( SELECT auth.uid() AS uid)) AND (org_id = ( SELECT auth_org_id() AS auth_org_id)) AND ( SELECT is_active_member() AS is_active_member)))
  with check (((owner_id = ( SELECT auth.uid() AS uid)) AND (org_id = ( SELECT auth_org_id() AS auth_org_id)) AND ( SELECT is_active_member() AS is_active_member)));
alter policy odoo_revenue_census_seen_service on public.odoo_revenue_census_seen
  using (((( SELECT auth.jwt() AS jwt) ->> 'role'::text) = 'service_role'::text))
  with check (((( SELECT auth.jwt() AS jwt) ->> 'role'::text) = 'service_role'::text));
alter policy platform_operators_self_select on public.platform_operators
  using ((user_id = ( SELECT auth.uid() AS uid)));
alter policy procurements_insert_self_requester on public.procurements
  with check (((requested_by_id = ( SELECT auth.uid() AS uid)) AND ( SELECT is_active_member() AS is_active_member) AND org_feature_enabled(( SELECT auth_org_id() AS auth_org_id), 'procurement'::text)));
alter policy stock_items_delete on public.stock_items
  using (((org_id = ( SELECT auth_org_id() AS auth_org_id)) AND ( SELECT is_active_member() AS is_active_member) AND ( SELECT stock_admin() AS stock_admin) AND org_feature_enabled(( SELECT auth_org_id() AS auth_org_id), 'stock'::text)));
alter policy stock_items_insert on public.stock_items
  with check (((org_id = ( SELECT auth_org_id() AS auth_org_id)) AND ( SELECT is_active_member() AS is_active_member) AND ( SELECT stock_master_writer() AS stock_master_writer) AND org_feature_enabled(( SELECT auth_org_id() AS auth_org_id), 'stock'::text)));
alter policy stock_items_update on public.stock_items
  using (((org_id = ( SELECT auth_org_id() AS auth_org_id)) AND ( SELECT is_active_member() AS is_active_member) AND ( SELECT stock_master_writer() AS stock_master_writer) AND org_feature_enabled(( SELECT auth_org_id() AS auth_org_id), 'stock'::text)))
  with check (((org_id = ( SELECT auth_org_id() AS auth_org_id)) AND ( SELECT is_active_member() AS is_active_member) AND ( SELECT stock_master_writer() AS stock_master_writer) AND org_feature_enabled(( SELECT auth_org_id() AS auth_org_id), 'stock'::text)));
alter policy stock_units_delete on public.stock_units
  using (((org_id = ( SELECT auth_org_id() AS auth_org_id)) AND ( SELECT is_active_member() AS is_active_member) AND ( SELECT stock_admin() AS stock_admin) AND org_feature_enabled(( SELECT auth_org_id() AS auth_org_id), 'stock'::text)));
alter policy stock_units_insert on public.stock_units
  with check (((org_id = ( SELECT auth_org_id() AS auth_org_id)) AND ( SELECT is_active_member() AS is_active_member) AND ( SELECT stock_master_writer() AS stock_master_writer) AND org_feature_enabled(( SELECT auth_org_id() AS auth_org_id), 'stock'::text)));
alter policy stock_units_update on public.stock_units
  using (((org_id = ( SELECT auth_org_id() AS auth_org_id)) AND ( SELECT is_active_member() AS is_active_member) AND ( SELECT stock_master_writer() AS stock_master_writer) AND org_feature_enabled(( SELECT auth_org_id() AS auth_org_id), 'stock'::text)))
  with check (((org_id = ( SELECT auth_org_id() AS auth_org_id)) AND ( SELECT is_active_member() AS is_active_member) AND ( SELECT stock_master_writer() AS stock_master_writer) AND org_feature_enabled(( SELECT auth_org_id() AS auth_org_id), 'stock'::text)));
alter policy stock_warehouses_delete on public.stock_warehouses
  using (((org_id = ( SELECT auth_org_id() AS auth_org_id)) AND ( SELECT is_active_member() AS is_active_member) AND ( SELECT stock_admin() AS stock_admin) AND org_feature_enabled(( SELECT auth_org_id() AS auth_org_id), 'stock'::text)));
alter policy stock_warehouses_insert on public.stock_warehouses
  with check (((org_id = ( SELECT auth_org_id() AS auth_org_id)) AND ( SELECT is_active_member() AS is_active_member) AND ( SELECT stock_master_writer() AS stock_master_writer) AND org_feature_enabled(( SELECT auth_org_id() AS auth_org_id), 'stock'::text)));
alter policy stock_warehouses_update on public.stock_warehouses
  using (((org_id = ( SELECT auth_org_id() AS auth_org_id)) AND ( SELECT is_active_member() AS is_active_member) AND ( SELECT stock_master_writer() AS stock_master_writer) AND org_feature_enabled(( SELECT auth_org_id() AS auth_org_id), 'stock'::text)))
  with check (((org_id = ( SELECT auth_org_id() AS auth_org_id)) AND ( SELECT is_active_member() AS is_active_member) AND ( SELECT stock_master_writer() AS stock_master_writer) AND org_feature_enabled(( SELECT auth_org_id() AS auth_org_id), 'stock'::text)));
alter policy task_reminders_select on public.task_reminders
  using (((sender_id = ( SELECT auth.uid() AS uid)) AND (org_id = ( SELECT auth_org_id() AS auth_org_id)) AND ( SELECT is_active_member() AS is_active_member)));
alter policy timesheet_erp_mirror_select on public.timesheet_erp_mirror
  using (((org_id = ( SELECT auth_org_id() AS auth_org_id)) AND (EXISTS ( SELECT 1
   FROM timesheets t
  WHERE ((t.id = timesheet_erp_mirror.timesheet_id) AND (t.org_id = ( SELECT auth_org_id() AS auth_org_id)) AND ((t.user_id = ( SELECT auth.uid() AS uid)) OR (( SELECT auth_role() AS auth_role) = ANY (ARRAY['Admin'::user_role, 'Executive'::user_role, 'Project Manager'::user_role, 'Finance'::user_role])) OR (EXISTS ( SELECT 1
           FROM profiles p
          WHERE ((p.id = t.user_id) AND (p.manager_id = ( SELECT auth.uid() AS uid)))))))))));
alter policy tm_claims_select on public.tm_claims
  using (((org_id = ( SELECT auth_org_id() AS auth_org_id)) AND ( SELECT is_active_member() AS is_active_member) AND ((( SELECT auth_role() AS auth_role) = ANY (ARRAY['Admin'::user_role, 'Finance'::user_role, 'Executive'::user_role])) OR ((( SELECT auth_role() AS auth_role) = 'Project Manager'::user_role) AND (EXISTS ( SELECT 1
   FROM projects p
  WHERE ((p.id = tm_claims.project_id) AND (p.org_id = tm_claims.org_id) AND (p.project_manager_id = ( SELECT auth.uid() AS uid)))))))));
alter policy user_views_delete on public.user_views
  using (((org_id = ( SELECT auth_org_id() AS auth_org_id)) AND ((user_id = ( SELECT auth.uid() AS uid)) OR (( SELECT auth_role() AS auth_role) = 'Admin'::user_role)) AND ( SELECT is_active_member() AS is_active_member) AND org_feature_enabled(( SELECT auth_org_id() AS auth_org_id), 'user_views'::text)));
alter policy user_views_insert on public.user_views
  with check (((org_id = ( SELECT auth_org_id() AS auth_org_id)) AND (user_id = ( SELECT auth.uid() AS uid)) AND ( SELECT is_active_member() AS is_active_member) AND org_feature_enabled(( SELECT auth_org_id() AS auth_org_id), 'user_views'::text)));
alter policy user_views_select on public.user_views
  using (((org_id = ( SELECT auth_org_id() AS auth_org_id)) AND ((user_id = ( SELECT auth.uid() AS uid)) OR (scope = 'shared_org'::text)) AND ( SELECT is_active_member() AS is_active_member)));
alter policy user_views_update on public.user_views
  using (((org_id = ( SELECT auth_org_id() AS auth_org_id)) AND ((user_id = ( SELECT auth.uid() AS uid)) OR (( SELECT auth_role() AS auth_role) = 'Admin'::user_role)) AND ( SELECT is_active_member() AS is_active_member) AND org_feature_enabled(( SELECT auth_org_id() AS auth_org_id), 'user_views'::text)))
  with check (((org_id = ( SELECT auth_org_id() AS auth_org_id)) AND ((user_id = ( SELECT auth.uid() AS uid)) OR (( SELECT auth_role() AS auth_role) = 'Admin'::user_role)) AND ( SELECT is_active_member() AS is_active_member) AND org_feature_enabled(( SELECT auth_org_id() AS auth_org_id), 'user_views'::text)));
alter policy storage_document_author_delete on storage.objects
  using (((bucket_id <> 'project-documents'::text) OR (( SELECT is_active_member() AS is_active_member) AND (EXISTS ( SELECT 1
   FROM project_documents pd
  WHERE (((pd.id)::text = split_part(objects.name, '/'::text, 3)) AND (pd.org_id = ( SELECT auth_org_id() AS auth_org_id)) AND ((pd.project_id)::text = split_part(objects.name, '/'::text, 2)) AND ((pd.author_id = ( SELECT auth.uid() AS uid)) OR (( SELECT auth_role() AS auth_role) = 'Admin'::user_role))))))));
alter policy storage_document_author_insert on storage.objects
  with check (((bucket_id <> 'project-documents'::text) OR (( SELECT is_active_member() AS is_active_member) AND (EXISTS ( SELECT 1
   FROM project_documents pd
  WHERE (((pd.id)::text = split_part(objects.name, '/'::text, 3)) AND (pd.org_id = ( SELECT auth_org_id() AS auth_org_id)) AND ((pd.project_id)::text = split_part(objects.name, '/'::text, 2)) AND ((pd.author_id = ( SELECT auth.uid() AS uid)) OR (( SELECT auth_role() AS auth_role) = 'Admin'::user_role))))))));
alter policy storage_document_author_update on storage.objects
  using (((bucket_id <> 'project-documents'::text) OR (( SELECT is_active_member() AS is_active_member) AND (EXISTS ( SELECT 1
   FROM project_documents pd
  WHERE (((pd.id)::text = split_part(objects.name, '/'::text, 3)) AND (pd.org_id = ( SELECT auth_org_id() AS auth_org_id)) AND ((pd.project_id)::text = split_part(objects.name, '/'::text, 2)) AND ((pd.author_id = ( SELECT auth.uid() AS uid)) OR (( SELECT auth_role() AS auth_role) = 'Admin'::user_role))))))))
  with check (((bucket_id <> 'project-documents'::text) OR (( SELECT is_active_member() AS is_active_member) AND (EXISTS ( SELECT 1
   FROM project_documents pd
  WHERE (((pd.id)::text = split_part(objects.name, '/'::text, 3)) AND (pd.org_id = ( SELECT auth_org_id() AS auth_org_id)) AND ((pd.project_id)::text = split_part(objects.name, '/'::text, 2)) AND ((pd.author_id = ( SELECT auth.uid() AS uid)) OR (( SELECT auth_role() AS auth_role) = 'Admin'::user_role))))))));
alter policy storage_objects_agent_attachments_read on storage.objects
  using (((bucket_id = 'agent-attachments'::text) AND (( SELECT auth.uid() AS uid) IS NOT NULL) AND (split_part(name, '/'::text, 1) = 'org'::text) AND (split_part(name, '/'::text, 2) = (( SELECT auth_org_id() AS auth_org_id))::text) AND (split_part(name, '/'::text, 3) = 'agent-attachments'::text) AND (array_length(string_to_array(name, '/'::text), 1) = 4) AND (EXISTS ( SELECT 1
   FROM agent_attachments aa
  WHERE (((aa.id)::text = split_part(objects.name, '/'::text, 4)) AND (aa.owner_id = ( SELECT auth.uid() AS uid)) AND (aa.org_id = ( SELECT auth_org_id() AS auth_org_id)) AND (aa.storage_path = objects.name))))));
alter policy storage_objects_agent_attachments_write on storage.objects
  using (((bucket_id = 'agent-attachments'::text) AND (( SELECT auth.uid() AS uid) IS NOT NULL) AND (split_part(name, '/'::text, 1) = 'org'::text) AND (split_part(name, '/'::text, 2) = (( SELECT auth_org_id() AS auth_org_id))::text) AND (split_part(name, '/'::text, 3) = 'agent-attachments'::text) AND (array_length(string_to_array(name, '/'::text), 1) = 4) AND (EXISTS ( SELECT 1
   FROM agent_attachments aa
  WHERE (((aa.id)::text = split_part(objects.name, '/'::text, 4)) AND (aa.owner_id = ( SELECT auth.uid() AS uid)) AND (aa.org_id = ( SELECT auth_org_id() AS auth_org_id)) AND (aa.storage_path = objects.name))))))
  with check (((bucket_id = 'agent-attachments'::text) AND (( SELECT auth.uid() AS uid) IS NOT NULL) AND (split_part(name, '/'::text, 1) = 'org'::text) AND (split_part(name, '/'::text, 2) = (( SELECT auth_org_id() AS auth_org_id))::text) AND (split_part(name, '/'::text, 3) = 'agent-attachments'::text) AND (array_length(string_to_array(name, '/'::text), 1) = 4) AND (EXISTS ( SELECT 1
   FROM agent_attachments aa
  WHERE (((aa.id)::text = split_part(objects.name, '/'::text, 4)) AND (aa.owner_id = ( SELECT auth.uid() AS uid)) AND (aa.org_id = ( SELECT auth_org_id() AS auth_org_id)) AND (aa.storage_path = objects.name))))));
alter policy storage_objects_expense_receipt_read on storage.objects
  using (((bucket_id = 'expense-receipts'::text) AND (( SELECT auth.uid() AS uid) IS NOT NULL) AND (split_part(name, '/'::text, 1) = (( SELECT auth_org_id() AS auth_org_id))::text) AND (array_length(string_to_array(name, '/'::text), 1) = 4) AND (EXISTS ( SELECT 1
   FROM expense_claims c
  WHERE ((c.id)::text = split_part(objects.name, '/'::text, 2))))));
alter policy storage_objects_expense_receipt_write on storage.objects
  using (((bucket_id = 'expense-receipts'::text) AND (( SELECT auth.uid() AS uid) IS NOT NULL) AND (split_part(name, '/'::text, 1) = (( SELECT auth_org_id() AS auth_org_id))::text) AND (array_length(string_to_array(name, '/'::text), 1) = 4) AND (EXISTS ( SELECT 1
   FROM expense_claims c
  WHERE (((c.id)::text = split_part(objects.name, '/'::text, 2)) AND (c.org_id = ( SELECT auth_org_id() AS auth_org_id)) AND (c.claimant_id = ( SELECT auth.uid() AS uid)) AND (c.status = ANY (ARRAY['Draft'::expense_claim_status, 'Rejected'::expense_claim_status])))))))
  with check (((bucket_id = 'expense-receipts'::text) AND (( SELECT auth.uid() AS uid) IS NOT NULL) AND (split_part(name, '/'::text, 1) = (( SELECT auth_org_id() AS auth_org_id))::text) AND (array_length(string_to_array(name, '/'::text), 1) = 4) AND (EXISTS ( SELECT 1
   FROM expense_claims c
  WHERE (((c.id)::text = split_part(objects.name, '/'::text, 2)) AND (c.org_id = ( SELECT auth_org_id() AS auth_org_id)) AND (c.claimant_id = ( SELECT auth.uid() AS uid)) AND (c.status = ANY (ARRAY['Draft'::expense_claim_status, 'Rejected'::expense_claim_status])))))));
alter policy storage_objects_proc_file_delete on storage.objects
  using (((bucket_id = 'procurement-files'::text) AND (( SELECT auth.uid() AS uid) IS NOT NULL) AND (split_part(name, '/'::text, 1) = (( SELECT auth_org_id() AS auth_org_id))::text) AND (( SELECT auth_role() AS auth_role) = 'Admin'::user_role) AND (NOT (EXISTS ( SELECT 1
   FROM procurement_quotation_files f
  WHERE (f.file_path = objects.name)
UNION ALL
 SELECT 1
   FROM procurement_receipt_files f
  WHERE (f.file_path = objects.name)
UNION ALL
 SELECT 1
   FROM procurement_invoice_files f
  WHERE (f.file_path = objects.name)
UNION ALL
 SELECT 1
   FROM purchase_request_files f
  WHERE (f.file_path = objects.name)
UNION ALL
 SELECT 1
   FROM rfq_files f
  WHERE (f.file_path = objects.name)
UNION ALL
 SELECT 1
   FROM purchase_order_files f
  WHERE (f.file_path = objects.name)
UNION ALL
 SELECT 1
   FROM payment_files f
  WHERE (f.file_path = objects.name))))));
alter policy storage_objects_proc_file_insert on storage.objects
  with check (((bucket_id = 'procurement-files'::text) AND (( SELECT auth.uid() AS uid) IS NOT NULL) AND (split_part(name, '/'::text, 1) = (( SELECT auth_org_id() AS auth_org_id))::text) AND (array_length(string_to_array(name, '/'::text), 1) = 5) AND (( SELECT auth_role() AS auth_role) = ANY (ARRAY['Admin'::user_role, 'Executive'::user_role, 'Project Manager'::user_role, 'Finance'::user_role])) AND (EXISTS ( SELECT 1
   FROM procurements p
  WHERE (((p.id)::text = split_part(objects.name, '/'::text, 2)) AND (p.org_id = ( SELECT auth_org_id() AS auth_org_id)))))));
alter policy storage_objects_proc_file_read on storage.objects
  using (((bucket_id = 'procurement-files'::text) AND (( SELECT auth.uid() AS uid) IS NOT NULL) AND (split_part(name, '/'::text, 1) = (( SELECT auth_org_id() AS auth_org_id))::text) AND (array_length(string_to_array(name, '/'::text), 1) = 5) AND ( SELECT is_active_member() AS is_active_member) AND ((( SELECT auth_role() AS auth_role) = ANY (ARRAY['Admin'::user_role, 'Executive'::user_role, 'Project Manager'::user_role, 'Finance'::user_role])) OR ((split_part(name, '/'::text, 3) <> ALL (ARRAY['invoice'::text, 'payment'::text])) AND (EXISTS ( SELECT 1
   FROM procurements p
  WHERE (((p.id)::text = split_part(objects.name, '/'::text, 2)) AND (p.requested_by_id = ( SELECT auth.uid() AS uid)))))))));
alter policy storage_objects_project_doc_read on storage.objects
  using (((bucket_id = 'project-documents'::text) AND (( SELECT auth.uid() AS uid) IS NOT NULL) AND (split_part(name, '/'::text, 1) = (( SELECT auth_org_id() AS auth_org_id))::text) AND (array_length(string_to_array(name, '/'::text), 1) = 4) AND ( SELECT is_active_member() AS is_active_member)));
alter policy storage_objects_project_doc_write on storage.objects
  using (((bucket_id = 'project-documents'::text) AND (( SELECT auth.uid() AS uid) IS NOT NULL) AND (split_part(name, '/'::text, 1) = (( SELECT auth_org_id() AS auth_org_id))::text) AND (array_length(string_to_array(name, '/'::text), 1) = 4) AND (( SELECT auth_role() AS auth_role) = ANY (ARRAY['Admin'::user_role, 'Executive'::user_role, 'Project Manager'::user_role, 'Finance'::user_role])) AND (EXISTS ( SELECT 1
   FROM project_documents pd
  WHERE (((pd.id)::text = split_part(objects.name, '/'::text, 3)) AND (pd.org_id = ( SELECT auth_org_id() AS auth_org_id)) AND ((pd.project_id)::text = split_part(objects.name, '/'::text, 2)) AND (pd.status = 'Draft'::doc_status))))))
  with check (((bucket_id = 'project-documents'::text) AND (( SELECT auth.uid() AS uid) IS NOT NULL) AND (split_part(name, '/'::text, 1) = (( SELECT auth_org_id() AS auth_org_id))::text) AND (array_length(string_to_array(name, '/'::text), 1) = 4) AND (( SELECT auth_role() AS auth_role) = ANY (ARRAY['Admin'::user_role, 'Executive'::user_role, 'Project Manager'::user_role, 'Finance'::user_role])) AND (EXISTS ( SELECT 1
   FROM project_documents pd
  WHERE (((pd.id)::text = split_part(objects.name, '/'::text, 3)) AND (pd.org_id = ( SELECT auth_org_id() AS auth_org_id)) AND ((pd.project_id)::text = split_part(objects.name, '/'::text, 2)) AND (pd.status = 'Draft'::doc_status))))));

commit;

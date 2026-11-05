-- 0640_rls_caller_initplans_down.sql — reverse 0640 exactly.
-- Restores each policy's pre-0640 expression text, captured from pg_policy before the change,
-- by ALTER POLICY. Policy OIDs, names, roles, commands, permissive modes, comments and grants are
-- untouched by 0640, so restoring the two expressions restores the baseline catalog exactly.
-- This is NOT "unwrap every matching helper": calls wrapped before 0640 (0333's statement-snapshot
-- policy) had the wrapper in the baseline text and are restored to that same wrapped form.
begin;

-- public.agent_attachments.agent_attachments_insert  [true FOR INSERT TO PUBLIC]
alter policy agent_attachments_insert on public.agent_attachments
  with check (
    ((owner_id = auth.uid()) AND (org_id = auth_org_id()) AND (storage_path = ((('org/'::text || (auth_org_id())::text) || '/agent-attachments/'::text) || (id)::text)) AND (EXISTS ( SELECT 1
   FROM agent_threads t
  WHERE ((t.id = agent_attachments.thread_id) AND (t.owner_id = auth.uid()) AND (t.org_id = auth_org_id())))) AND is_active_member())
  );

-- public.agent_attachments.agent_attachments_select  [true FOR SELECT TO PUBLIC]
alter policy agent_attachments_select on public.agent_attachments
  using (
    ((owner_id = auth.uid()) AND (org_id = auth_org_id()) AND is_active_member())
  );

-- public.agent_attachments.agent_attachments_update  [true FOR UPDATE TO PUBLIC]
alter policy agent_attachments_update on public.agent_attachments
  using (
    ((owner_id = auth.uid()) AND (org_id = auth_org_id()) AND is_active_member())
  )
  with check (
    ((owner_id = auth.uid()) AND (org_id = auth_org_id()) AND (storage_path = ((('org/'::text || (auth_org_id())::text) || '/agent-attachments/'::text) || (id)::text)) AND (EXISTS ( SELECT 1
   FROM agent_threads t
  WHERE ((t.id = agent_attachments.thread_id) AND (t.owner_id = auth.uid()) AND (t.org_id = auth_org_id())))) AND is_active_member())
  );

-- public.agent_automations.agent_automations_delete  [true FOR DELETE TO PUBLIC]
alter policy agent_automations_delete on public.agent_automations
  using (
    ((owner_id = auth.uid()) AND (org_id = auth_org_id()) AND is_active_member())
  );

-- public.agent_automations.agent_automations_insert  [true FOR INSERT TO PUBLIC]
alter policy agent_automations_insert on public.agent_automations
  with check (
    ((owner_id = auth.uid()) AND (org_id = auth_org_id()) AND is_active_member())
  );

-- public.agent_automations.agent_automations_select  [true FOR SELECT TO PUBLIC]
alter policy agent_automations_select on public.agent_automations
  using (
    ((owner_id = auth.uid()) AND (org_id = auth_org_id()) AND is_active_member())
  );

-- public.agent_automations.agent_automations_update  [true FOR UPDATE TO PUBLIC]
alter policy agent_automations_update on public.agent_automations
  using (
    ((owner_id = auth.uid()) AND (org_id = auth_org_id()) AND is_active_member())
  )
  with check (
    ((owner_id = auth.uid()) AND (org_id = auth_org_id()) AND is_active_member())
  );

-- public.agent_events.agent_events_insert  [true FOR INSERT TO PUBLIC]
alter policy agent_events_insert on public.agent_events
  with check (
    ((owner_id = auth.uid()) AND (org_id = auth_org_id()) AND (EXISTS ( SELECT 1
   FROM agent_runs r
  WHERE ((r.id = agent_events.run_id) AND (r.owner_id = auth.uid()) AND (r.org_id = auth_org_id())))) AND is_active_member())
  );

-- public.agent_events.agent_events_select  [true FOR SELECT TO PUBLIC]
alter policy agent_events_select on public.agent_events
  using (
    ((owner_id = auth.uid()) AND (org_id = auth_org_id()) AND is_active_member())
  );

-- public.agent_events.agent_events_update  [true FOR UPDATE TO PUBLIC]
alter policy agent_events_update on public.agent_events
  using (
    ((owner_id = auth.uid()) AND (org_id = auth_org_id()) AND (type = 'assistant'::text) AND is_active_member())
  )
  with check (
    ((owner_id = auth.uid()) AND (org_id = auth_org_id()) AND (type = 'assistant'::text) AND is_active_member())
  );

-- public.agent_runs.agent_runs_insert  [true FOR INSERT TO PUBLIC]
alter policy agent_runs_insert on public.agent_runs
  with check (
    ((owner_id = auth.uid()) AND (org_id = auth_org_id()) AND (EXISTS ( SELECT 1
   FROM agent_threads t
  WHERE ((t.id = agent_runs.thread_id) AND (t.owner_id = auth.uid()) AND (t.org_id = auth_org_id())))) AND is_active_member())
  );

-- public.agent_runs.agent_runs_select  [true FOR SELECT TO PUBLIC]
alter policy agent_runs_select on public.agent_runs
  using (
    ((owner_id = auth.uid()) AND (org_id = auth_org_id()) AND is_active_member())
  );

-- public.agent_runs.agent_runs_update  [true FOR UPDATE TO PUBLIC]
alter policy agent_runs_update on public.agent_runs
  using (
    ((owner_id = auth.uid()) AND (org_id = auth_org_id()) AND is_active_member())
  )
  with check (
    ((owner_id = auth.uid()) AND (org_id = auth_org_id()) AND is_active_member())
  );

-- public.agent_threads.agent_threads_insert  [true FOR INSERT TO PUBLIC]
alter policy agent_threads_insert on public.agent_threads
  with check (
    ((owner_id = auth.uid()) AND (org_id = auth_org_id()) AND is_active_member())
  );

-- public.agent_threads.agent_threads_select  [true FOR SELECT TO PUBLIC]
alter policy agent_threads_select on public.agent_threads
  using (
    ((owner_id = auth.uid()) AND (org_id = auth_org_id()) AND is_active_member())
  );

-- public.agent_threads.agent_threads_update  [true FOR UPDATE TO PUBLIC]
alter policy agent_threads_update on public.agent_threads
  using (
    ((owner_id = auth.uid()) AND (org_id = auth_org_id()) AND is_active_member())
  )
  with check (
    ((owner_id = auth.uid()) AND (org_id = auth_org_id()) AND is_active_member())
  );

-- public.agent_usage.agent_usage_insert  [true FOR INSERT TO PUBLIC]
alter policy agent_usage_insert on public.agent_usage
  with check (
    ((owner_id = auth.uid()) AND (org_id = auth_org_id()) AND ((run_id IS NULL) OR (EXISTS ( SELECT 1
   FROM agent_runs r
  WHERE ((r.id = agent_usage.run_id) AND (r.owner_id = auth.uid()) AND (r.org_id = auth_org_id()))))) AND is_active_member())
  );

-- public.agent_usage.agent_usage_select  [true FOR SELECT TO PUBLIC]
alter policy agent_usage_select on public.agent_usage
  using (
    ((owner_id = auth.uid()) AND (org_id = auth_org_id()) AND is_active_member())
  );

-- public.audit_events.audit_events_select  [true FOR SELECT TO PUBLIC]
alter policy audit_events_select on public.audit_events
  using (
    (is_active_member() AND (((scope = 'platform'::text) AND (org_id IS NULL) AND is_operator()) OR ((scope = 'org'::text) AND (org_id IS NOT NULL) AND (org_id = auth_org_id()) AND ((auth_role() = 'Admin'::user_role) OR is_operator()))))
  );

-- public.boq_items.boq_items_delete  [true FOR DELETE TO PUBLIC]
alter policy boq_items_delete on public.boq_items
  using (
    ((org_id = auth_org_id()) AND is_active_member() AND (auth_role() = ANY (ARRAY['Admin'::user_role, 'Executive'::user_role, 'Project Manager'::user_role, 'Finance'::user_role])) AND org_feature_enabled(auth_org_id(), 'sales_invoices'::text))
  );

-- public.boq_items.boq_items_insert  [true FOR INSERT TO PUBLIC]
alter policy boq_items_insert on public.boq_items
  with check (
    ((org_id = auth_org_id()) AND is_active_member() AND (auth_role() = ANY (ARRAY['Admin'::user_role, 'Executive'::user_role, 'Project Manager'::user_role, 'Finance'::user_role])) AND (EXISTS ( SELECT 1
   FROM projects p
  WHERE ((p.id = boq_items.project_id) AND (p.org_id = auth_org_id())))) AND org_feature_enabled(auth_org_id(), 'sales_invoices'::text))
  );

-- public.boq_items.boq_items_select  [true FOR SELECT TO PUBLIC]
alter policy boq_items_select on public.boq_items
  using (
    ((org_id = auth_org_id()) AND is_active_member())
  );

-- public.boq_items.boq_items_update  [true FOR UPDATE TO PUBLIC]
alter policy boq_items_update on public.boq_items
  using (
    ((org_id = auth_org_id()) AND is_active_member() AND (auth_role() = ANY (ARRAY['Admin'::user_role, 'Executive'::user_role, 'Project Manager'::user_role, 'Finance'::user_role])) AND org_feature_enabled(auth_org_id(), 'sales_invoices'::text))
  )
  with check (
    ((org_id = auth_org_id()) AND is_active_member() AND (auth_role() = ANY (ARRAY['Admin'::user_role, 'Executive'::user_role, 'Project Manager'::user_role, 'Finance'::user_role])) AND org_feature_enabled(auth_org_id(), 'sales_invoices'::text))
  );

-- public.boq_material_allowances.boq_material_allowances_delete  [true FOR DELETE TO PUBLIC]
alter policy boq_material_allowances_delete on public.boq_material_allowances
  using (
    ((org_id = auth_org_id()) AND is_active_member() AND boq_allowance_clear_ok(boq_item_id, item_id))
  );

-- public.boq_material_allowances.boq_material_allowances_insert  [true FOR INSERT TO PUBLIC]
alter policy boq_material_allowances_insert on public.boq_material_allowances
  with check (
    ((org_id = auth_org_id()) AND is_active_member() AND boq_allowance_ok(boq_item_id, item_id))
  );

-- public.boq_material_allowances.boq_material_allowances_select  [true FOR SELECT TO PUBLIC]
alter policy boq_material_allowances_select on public.boq_material_allowances
  using (
    ((org_id = auth_org_id()) AND is_active_member())
  );

-- public.boq_material_allowances.boq_material_allowances_update  [true FOR UPDATE TO PUBLIC]
alter policy boq_material_allowances_update on public.boq_material_allowances
  using (
    ((org_id = auth_org_id()) AND is_active_member() AND boq_allowance_ok(boq_item_id, item_id))
  )
  with check (
    ((org_id = auth_org_id()) AND is_active_member() AND boq_allowance_ok(boq_item_id, item_id))
  );

-- public.budget_category_account_map.budget_category_account_map_select  [true FOR SELECT TO PUBLIC]
alter policy budget_category_account_map_select on public.budget_category_account_map
  using (
    ((org_id = auth_org_id()) AND is_active_member())
  );

-- public.budget_category_account_map.budget_category_account_map_write  [true FOR ALL TO PUBLIC]
alter policy budget_category_account_map_write on public.budget_category_account_map
  using (
    ((org_id = auth_org_id()) AND is_active_member() AND (auth_role() = 'Admin'::user_role))
  )
  with check (
    ((org_id = auth_org_id()) AND is_active_member() AND (auth_role() = 'Admin'::user_role))
  );

-- public.budget_distribution_plans.budget_distribution_plans_select  [true FOR SELECT TO PUBLIC]
alter policy budget_distribution_plans_select on public.budget_distribution_plans
  using (
    ((org_id = auth_org_id()) AND is_active_member() AND (EXISTS ( SELECT 1
   FROM (budget_versions v
     JOIN projects p ON ((p.id = v.project_id)))
  WHERE ((v.id = budget_distribution_plans.budget_version_id) AND (v.org_id = auth_org_id()) AND (p.org_id = auth_org_id())))))
  );

-- public.budget_line_items.budget_line_items_select  [true FOR SELECT TO PUBLIC]
alter policy budget_line_items_select on public.budget_line_items
  using (
    ((org_id = auth_org_id()) AND is_active_member())
  );

-- public.budget_line_items.budget_line_items_write  [true FOR ALL TO PUBLIC]
alter policy budget_line_items_write on public.budget_line_items
  using (
    ((org_id = auth_org_id()) AND (auth_role() = ANY (ARRAY['Admin'::user_role, 'Executive'::user_role, 'Project Manager'::user_role, 'Finance'::user_role])) AND (EXISTS ( SELECT 1
   FROM budget_versions bv
  WHERE ((bv.id = budget_line_items.budget_version_id) AND (bv.org_id = auth_org_id())))) AND is_active_member())
  )
  with check (
    ((org_id = auth_org_id()) AND (auth_role() = ANY (ARRAY['Admin'::user_role, 'Executive'::user_role, 'Project Manager'::user_role, 'Finance'::user_role])) AND (EXISTS ( SELECT 1
   FROM budget_versions bv
  WHERE ((bv.id = budget_line_items.budget_version_id) AND (bv.org_id = auth_org_id())))) AND is_active_member())
  );

-- public.budget_occupant_consents.budget_occupant_consents_select  [true FOR SELECT TO PUBLIC]
alter policy budget_occupant_consents_select on public.budget_occupant_consents
  using (
    ((org_id = auth_org_id()) AND is_active_member() AND ((auth_role())::text = ANY (ARRAY['Admin'::text, 'Finance'::text])))
  );

-- public.budget_projections.budget_projections_select  [true FOR SELECT TO PUBLIC]
alter policy budget_projections_select on public.budget_projections
  using (
    ((org_id = auth_org_id()) AND is_active_member())
  );

-- public.budget_projections.budget_projections_write  [true FOR ALL TO PUBLIC]
alter policy budget_projections_write on public.budget_projections
  using (
    ((org_id = auth_org_id()) AND is_active_member() AND (auth_role() = ANY (ARRAY['Admin'::user_role, 'Executive'::user_role, 'Project Manager'::user_role, 'Finance'::user_role])) AND org_feature_enabled(auth_org_id(), 'budget_projection'::text))
  )
  with check (
    ((org_id = auth_org_id()) AND is_active_member() AND (auth_role() = ANY (ARRAY['Admin'::user_role, 'Executive'::user_role, 'Project Manager'::user_role, 'Finance'::user_role])) AND (EXISTS ( SELECT 1
   FROM projects p
  WHERE ((p.id = budget_projections.project_id) AND (p.org_id = auth_org_id())))) AND org_feature_enabled(auth_org_id(), 'budget_projection'::text))
  );

-- public.budget_version_account_erp_mirror.budget_version_account_erp_mirror_select  [true FOR SELECT TO PUBLIC]
alter policy budget_version_account_erp_mirror_select on public.budget_version_account_erp_mirror
  using (
    ((org_id = auth_org_id()) AND is_active_member())
  );

-- public.budget_version_document_links.m365_budget_links_delete  [true FOR DELETE TO authenticated]
alter policy m365_budget_links_delete on public.budget_version_document_links
  using (
    ((org_id = auth_org_id()) AND is_active_member() AND (auth_role() = ANY (ARRAY['Admin'::user_role, 'Executive'::user_role, 'Project Manager'::user_role, 'Finance'::user_role])) AND (EXISTS ( SELECT 1
   FROM budget_versions v
  WHERE ((v.id = budget_version_document_links.budget_version_id) AND (v.org_id = auth_org_id()) AND (v.status = 'Draft'::budget_status)))))
  );

-- public.budget_version_document_links.m365_budget_links_insert  [true FOR INSERT TO authenticated]
alter policy m365_budget_links_insert on public.budget_version_document_links
  with check (
    ((org_id = auth_org_id()) AND is_active_member() AND (auth_role() = ANY (ARRAY['Admin'::user_role, 'Executive'::user_role, 'Project Manager'::user_role, 'Finance'::user_role])) AND (EXISTS ( SELECT 1
   FROM budget_versions v
  WHERE ((v.id = budget_version_document_links.budget_version_id) AND (v.org_id = auth_org_id()) AND (v.status = 'Draft'::budget_status)))))
  );

-- public.budget_version_document_links.m365_budget_links_select  [true FOR SELECT TO authenticated]
alter policy m365_budget_links_select on public.budget_version_document_links
  using (
    ((org_id = auth_org_id()) AND is_active_member() AND (EXISTS ( SELECT 1
   FROM budget_versions v
  WHERE ((v.id = budget_version_document_links.budget_version_id) AND (v.org_id = auth_org_id())))))
  );

-- public.budget_version_editors.budget_version_editors_select  [true FOR SELECT TO PUBLIC]
alter policy budget_version_editors_select on public.budget_version_editors
  using (
    ((org_id = auth_org_id()) AND is_active_member() AND (EXISTS ( SELECT 1
   FROM budget_versions bv
  WHERE ((bv.id = budget_version_editors.budget_version_id) AND (bv.org_id = auth_org_id())))))
  );

-- public.budget_version_erp_mirror.budget_version_erp_mirror_select  [true FOR SELECT TO PUBLIC]
alter policy budget_version_erp_mirror_select on public.budget_version_erp_mirror
  using (
    ((org_id = auth_org_id()) AND is_active_member())
  );

-- public.budget_versions.budget_versions_select  [true FOR SELECT TO PUBLIC]
alter policy budget_versions_select on public.budget_versions
  using (
    ((org_id = auth_org_id()) AND is_active_member())
  );

-- public.budget_versions.budget_versions_write  [true FOR ALL TO PUBLIC]
alter policy budget_versions_write on public.budget_versions
  using (
    ((org_id = auth_org_id()) AND (auth_role() = ANY (ARRAY['Admin'::user_role, 'Executive'::user_role, 'Project Manager'::user_role, 'Finance'::user_role])) AND (EXISTS ( SELECT 1
   FROM projects p
  WHERE ((p.id = budget_versions.project_id) AND (p.org_id = auth_org_id())))) AND is_active_member())
  )
  with check (
    ((org_id = auth_org_id()) AND (auth_role() = ANY (ARRAY['Admin'::user_role, 'Executive'::user_role, 'Project Manager'::user_role, 'Finance'::user_role])) AND (EXISTS ( SELECT 1
   FROM projects p
  WHERE ((p.id = budget_versions.project_id) AND (p.org_id = auth_org_id())))) AND is_active_member())
  );

-- public.budget_year_distributions.budget_year_distributions_select  [true FOR SELECT TO PUBLIC]
alter policy budget_year_distributions_select on public.budget_year_distributions
  using (
    ((org_id = auth_org_id()) AND is_active_member() AND (EXISTS ( SELECT 1
   FROM (budget_versions v
     JOIN projects p ON ((p.id = v.project_id)))
  WHERE ((v.id = budget_year_distributions.budget_version_id) AND (v.org_id = auth_org_id()) AND (p.org_id = auth_org_id())))))
  );

-- public.comments.comments_insert  [true FOR INSERT TO PUBLIC]
alter policy comments_insert on public.comments
  with check (
    ((org_id = auth_org_id()) AND is_active_member() AND (author_id = auth.uid()) AND can_read_comment_parent(entity_type, entity_id))
  );

-- public.comments.comments_select  [true FOR SELECT TO PUBLIC]
alter policy comments_select on public.comments
  using (
    ((org_id = auth_org_id()) AND is_active_member() AND can_read_comment_parent(entity_type, entity_id) AND ((archived_at IS NULL) OR (author_id = auth.uid())))
  );

-- public.comments.comments_update  [true FOR UPDATE TO PUBLIC]
alter policy comments_update on public.comments
  using (
    ((org_id = auth_org_id()) AND is_active_member() AND (author_id = auth.uid()) AND (archived_at IS NULL))
  )
  with check (
    ((author_id = auth.uid()) AND (archived_at IS NOT NULL))
  );

-- public.companies.companies_delete  [true FOR DELETE TO PUBLIC]
alter policy companies_delete on public.companies
  using (
    ((org_id = auth_org_id()) AND (auth_role() = ANY (ARRAY['Admin'::user_role, 'Executive'::user_role, 'Project Manager'::user_role, 'Finance'::user_role])) AND is_active_member() AND org_feature_enabled(auth_org_id(), 'crm'::text) AND (NOT domain_externally_owned(auth_org_id(), 'companies'::text)))
  );

-- public.companies.companies_delete_admin_only  [false FOR DELETE TO PUBLIC]
alter policy companies_delete_admin_only on public.companies
  using (
    ((auth_role() = 'Admin'::user_role) AND is_active_member() AND org_feature_enabled(auth_org_id(), 'crm'::text))
  );

-- public.companies.companies_insert  [true FOR INSERT TO PUBLIC]
alter policy companies_insert on public.companies
  with check (
    ((org_id = auth_org_id()) AND (auth_role() = ANY (ARRAY['Admin'::user_role, 'Executive'::user_role, 'Project Manager'::user_role, 'Finance'::user_role])) AND is_active_member() AND org_feature_enabled(auth_org_id(), 'crm'::text) AND (NOT domain_externally_owned(auth_org_id(), 'companies'::text)))
  );

-- public.companies.companies_select  [true FOR SELECT TO PUBLIC]
alter policy companies_select on public.companies
  using (
    ((org_id = auth_org_id()) AND is_active_member())
  );

-- public.companies.companies_update  [true FOR UPDATE TO PUBLIC]
alter policy companies_update on public.companies
  using (
    ((org_id = auth_org_id()) AND (auth_role() = ANY (ARRAY['Admin'::user_role, 'Executive'::user_role, 'Project Manager'::user_role, 'Finance'::user_role])) AND is_active_member() AND org_feature_enabled(auth_org_id(), 'crm'::text))
  )
  with check (
    ((org_id = auth_org_id()) AND (auth_role() = ANY (ARRAY['Admin'::user_role, 'Executive'::user_role, 'Project Manager'::user_role, 'Finance'::user_role])) AND is_active_member() AND org_feature_enabled(auth_org_id(), 'crm'::text))
  );

-- public.contacts.contacts_delete  [true FOR DELETE TO PUBLIC]
alter policy contacts_delete on public.contacts
  using (
    ((org_id = auth_org_id()) AND (auth_role() = ANY (ARRAY['Admin'::user_role, 'Executive'::user_role, 'Project Manager'::user_role, 'Finance'::user_role])) AND is_active_member() AND org_feature_enabled(auth_org_id(), 'crm'::text) AND (EXISTS ( SELECT 1
   FROM companies c
  WHERE ((c.id = contacts.company_id) AND (c.org_id = auth_org_id())))) AND (NOT domain_externally_owned(auth_org_id(), 'companies'::text)))
  );

-- public.contacts.contacts_delete_admin_only  [false FOR DELETE TO PUBLIC]
alter policy contacts_delete_admin_only on public.contacts
  using (
    ((auth_role() = 'Admin'::user_role) AND is_active_member() AND org_feature_enabled(auth_org_id(), 'crm'::text))
  );

-- public.contacts.contacts_insert  [true FOR INSERT TO PUBLIC]
alter policy contacts_insert on public.contacts
  with check (
    ((org_id = auth_org_id()) AND (auth_role() = ANY (ARRAY['Admin'::user_role, 'Executive'::user_role, 'Project Manager'::user_role, 'Finance'::user_role])) AND is_active_member() AND org_feature_enabled(auth_org_id(), 'crm'::text) AND (EXISTS ( SELECT 1
   FROM companies c
  WHERE ((c.id = contacts.company_id) AND (c.org_id = auth_org_id())))) AND (NOT domain_externally_owned(auth_org_id(), 'companies'::text)))
  );

-- public.contacts.contacts_select  [true FOR SELECT TO PUBLIC]
alter policy contacts_select on public.contacts
  using (
    ((org_id = auth_org_id()) AND is_active_member())
  );

-- public.contacts.contacts_update  [true FOR UPDATE TO PUBLIC]
alter policy contacts_update on public.contacts
  using (
    ((org_id = auth_org_id()) AND (auth_role() = ANY (ARRAY['Admin'::user_role, 'Executive'::user_role, 'Project Manager'::user_role, 'Finance'::user_role])) AND is_active_member() AND org_feature_enabled(auth_org_id(), 'crm'::text) AND (EXISTS ( SELECT 1
   FROM companies c
  WHERE ((c.id = contacts.company_id) AND (c.org_id = auth_org_id())))))
  )
  with check (
    ((org_id = auth_org_id()) AND (auth_role() = ANY (ARRAY['Admin'::user_role, 'Executive'::user_role, 'Project Manager'::user_role, 'Finance'::user_role])) AND is_active_member() AND org_feature_enabled(auth_org_id(), 'crm'::text) AND (EXISTS ( SELECT 1
   FROM companies c
  WHERE ((c.id = contacts.company_id) AND (c.org_id = auth_org_id())))))
  );

-- public.contract_rate_assignees.contract_rate_assignees_select  [true FOR SELECT TO PUBLIC]
alter policy contract_rate_assignees_select on public.contract_rate_assignees
  using (
    ((org_id = auth_org_id()) AND is_active_member() AND ((auth_role() = ANY (ARRAY['Admin'::user_role, 'Finance'::user_role, 'Executive'::user_role])) OR ((auth_role() = 'Project Manager'::user_role) AND (EXISTS ( SELECT 1
   FROM projects p
  WHERE ((p.id = contract_rate_assignees.project_id) AND (p.org_id = contract_rate_assignees.org_id) AND (p.project_manager_id = auth.uid())))))))
  );

-- public.contract_rate_lines.contract_rate_lines_select  [true FOR SELECT TO PUBLIC]
alter policy contract_rate_lines_select on public.contract_rate_lines
  using (
    ((org_id = auth_org_id()) AND is_active_member() AND ((auth_role() = ANY (ARRAY['Admin'::user_role, 'Finance'::user_role, 'Executive'::user_role])) OR ((auth_role() = 'Project Manager'::user_role) AND (EXISTS ( SELECT 1
   FROM projects p
  WHERE ((p.id = contract_rate_lines.project_id) AND (p.org_id = contract_rate_lines.org_id) AND (p.project_manager_id = auth.uid())))))))
  );

-- public.cost_attribution_rule_targets.cost_attribution_rule_targets_select  [true FOR SELECT TO PUBLIC]
alter policy cost_attribution_rule_targets_select on public.cost_attribution_rule_targets
  using (
    ((org_id = auth_org_id()) AND is_active_member() AND (auth_role() = ANY (ARRAY['Admin'::user_role, 'Finance'::user_role, 'Executive'::user_role, 'Project Manager'::user_role])))
  );

-- public.cost_attribution_rules.cost_attribution_rules_select  [true FOR SELECT TO PUBLIC]
alter policy cost_attribution_rules_select on public.cost_attribution_rules
  using (
    ((org_id = auth_org_id()) AND is_active_member() AND (auth_role() = ANY (ARRAY['Admin'::user_role, 'Finance'::user_role, 'Executive'::user_role, 'Project Manager'::user_role])))
  );

-- public.credits.credits_insert  [true FOR INSERT TO PUBLIC]
alter policy credits_insert on public.credits
  with check (
    (is_operator() AND (org_id = auth_org_id()) AND is_active_member() AND (owner_id IS NULL))
  );

-- public.credits.credits_select  [true FOR SELECT TO PUBLIC]
alter policy credits_select on public.credits
  using (
    ((org_id = auth_org_id()) AND (auth_role() = ANY (ARRAY['Admin'::user_role, 'Executive'::user_role])) AND is_active_member())
  );

-- public.crm_activities.crm_activities_select  [true FOR SELECT TO PUBLIC]
alter policy crm_activities_select on public.crm_activities
  using (
    ((org_id = auth_org_id()) AND is_active_member())
  );

-- public.crm_activities.crm_activities_write  [true FOR ALL TO PUBLIC]
alter policy crm_activities_write on public.crm_activities
  using (
    ((org_id = auth_org_id()) AND (auth_role() = ANY (ARRAY['Admin'::user_role, 'Executive'::user_role, 'Project Manager'::user_role, 'Finance'::user_role])) AND (EXISTS ( SELECT 1
   FROM contacts ct
  WHERE ((ct.id = crm_activities.contact_id) AND (ct.org_id = auth_org_id())))) AND is_active_member() AND org_feature_enabled(auth_org_id(), 'crm'::text))
  )
  with check (
    ((org_id = auth_org_id()) AND (auth_role() = ANY (ARRAY['Admin'::user_role, 'Executive'::user_role, 'Project Manager'::user_role, 'Finance'::user_role])) AND (EXISTS ( SELECT 1
   FROM contacts ct
  WHERE ((ct.id = crm_activities.contact_id) AND (ct.org_id = auth_org_id())))) AND is_active_member() AND org_feature_enabled(auth_org_id(), 'crm'::text))
  );

-- public.equipment_assets.equipment_assets_delete  [true FOR DELETE TO PUBLIC]
alter policy equipment_assets_delete on public.equipment_assets
  using (
    ((org_id = auth_org_id()) AND is_active_member() AND (auth_role() = 'Admin'::user_role))
  );

-- public.equipment_assets.equipment_assets_insert  [true FOR INSERT TO PUBLIC]
alter policy equipment_assets_insert on public.equipment_assets
  with check (
    ((org_id = auth_org_id()) AND is_active_member() AND (auth_role() = ANY (ARRAY['Admin'::user_role, 'Project Manager'::user_role])))
  );

-- public.equipment_assets.equipment_assets_select  [true FOR SELECT TO PUBLIC]
alter policy equipment_assets_select on public.equipment_assets
  using (
    ((org_id = auth_org_id()) AND is_active_member())
  );

-- public.equipment_assets.equipment_assets_update  [true FOR UPDATE TO PUBLIC]
alter policy equipment_assets_update on public.equipment_assets
  using (
    ((org_id = auth_org_id()) AND is_active_member() AND (auth_role() = ANY (ARRAY['Admin'::user_role, 'Project Manager'::user_role])))
  )
  with check (
    (org_id = auth_org_id())
  );

-- public.equipment_costing_settings.equipment_costing_settings_select  [true FOR SELECT TO PUBLIC]
alter policy equipment_costing_settings_select on public.equipment_costing_settings
  using (
    ((org_id = auth_org_id()) AND is_active_member() AND (auth_role() = ANY (ARRAY['Admin'::user_role, 'Finance'::user_role, 'Executive'::user_role, 'Project Manager'::user_role])))
  );

-- public.equipment_usage_entries.equipment_usage_entries_delete  [true FOR DELETE TO PUBLIC]
alter policy equipment_usage_entries_delete on public.equipment_usage_entries
  using (
    ((org_id = auth_org_id()) AND is_active_member() AND (auth_role() = 'Admin'::user_role))
  );

-- public.equipment_usage_entries.equipment_usage_entries_select  [true FOR SELECT TO PUBLIC]
alter policy equipment_usage_entries_select on public.equipment_usage_entries
  using (
    ((org_id = auth_org_id()) AND is_active_member() AND ((author_id = auth.uid()) OR (auth_role() = ANY (ARRAY['Admin'::user_role, 'Finance'::user_role, 'Executive'::user_role, 'Project Manager'::user_role]))))
  );

-- public.erp_account_mirror.erp_account_mirror_select  [true FOR SELECT TO PUBLIC]
alter policy erp_account_mirror_select on public.erp_account_mirror
  using (
    ((org_id = auth_org_id()) AND is_active_member() AND (auth_role() = ANY (ARRAY['Admin'::user_role, 'Finance'::user_role, 'Executive'::user_role])))
  );

-- public.erp_actuals_snapshot.erp_actuals_snapshot_select  [true FOR SELECT TO PUBLIC]
alter policy erp_actuals_snapshot_select on public.erp_actuals_snapshot
  using (
    ((org_id = auth_org_id()) AND is_active_member())
  );

-- public.erp_ap_aging_snapshot.erp_ap_aging_snapshot_select  [true FOR SELECT TO PUBLIC]
alter policy erp_ap_aging_snapshot_select on public.erp_ap_aging_snapshot
  using (
    ((org_id = auth_org_id()) AND is_active_member())
  );

-- public.erp_ar_aging_snapshot.erp_ar_aging_snapshot_select  [true FOR SELECT TO PUBLIC]
alter policy erp_ar_aging_snapshot_select on public.erp_ar_aging_snapshot
  using (
    ((org_id = auth_org_id()) AND is_active_member())
  );

-- public.erp_connect_census.erp_connect_census_select  [true FOR SELECT TO PUBLIC]
alter policy erp_connect_census_select on public.erp_connect_census
  using (
    ((org_id = auth_org_id()) AND is_active_member() AND (auth_role() = ANY (ARRAY['Admin'::user_role, 'Finance'::user_role])))
  );

-- public.erp_connect_proposals.erp_connect_proposals_select  [true FOR SELECT TO PUBLIC]
alter policy erp_connect_proposals_select on public.erp_connect_proposals
  using (
    ((org_id = auth_org_id()) AND is_active_member() AND ((auth_role() = 'Admin'::user_role) OR ((auth_role() = 'Finance'::user_role) AND (kind = 'account'::text))))
  );

-- public.erp_connect_runs.erp_connect_runs_select  [true FOR SELECT TO PUBLIC]
alter policy erp_connect_runs_select on public.erp_connect_runs
  using (
    ((org_id = auth_org_id()) AND is_active_member() AND (auth_role() = ANY (ARRAY['Admin'::user_role, 'Finance'::user_role])))
  );

-- public.erp_employees.erp_employees_select  [true FOR SELECT TO PUBLIC]
alter policy erp_employees_select on public.erp_employees
  using (
    ((org_id = auth_org_id()) AND is_active_member() AND ((auth_role() = ANY (ARRAY['Admin'::user_role, 'Executive'::user_role, 'Finance'::user_role, 'Project Manager'::user_role])) OR (profile_id = ( SELECT auth.uid() AS uid))))
  );

-- public.erp_gl_entry_mirror.erp_gl_entry_mirror_employee_read_scope  [false FOR SELECT TO authenticated]
alter policy erp_gl_entry_mirror_employee_read_scope on public.erp_gl_entry_mirror
  using (
    ((party_type IS DISTINCT FROM 'Employee'::text) OR holds_spend_approval_authority(auth_role()))
  );

-- public.erp_gl_entry_mirror.erp_gl_entry_mirror_select  [true FOR SELECT TO PUBLIC]
alter policy erp_gl_entry_mirror_select on public.erp_gl_entry_mirror
  using (
    ((org_id = auth_org_id()) AND is_active_member() AND (auth_role() = ANY (ARRAY['Admin'::user_role, 'Finance'::user_role, 'Executive'::user_role])))
  );

-- public.erp_payment_ledger_mirror.erp_payment_ledger_mirror_employee_read_scope  [false FOR SELECT TO authenticated]
alter policy erp_payment_ledger_mirror_employee_read_scope on public.erp_payment_ledger_mirror
  using (
    ((party_type IS DISTINCT FROM 'Employee'::text) OR holds_spend_approval_authority(auth_role()))
  );

-- public.erp_payment_ledger_mirror.erp_payment_ledger_mirror_select  [true FOR SELECT TO PUBLIC]
alter policy erp_payment_ledger_mirror_select on public.erp_payment_ledger_mirror
  using (
    ((org_id = auth_org_id()) AND is_active_member() AND (auth_role() = ANY (ARRAY['Admin'::user_role, 'Finance'::user_role, 'Executive'::user_role])))
  );

-- public.expense_account_map.expense_account_map_select  [true FOR SELECT TO PUBLIC]
alter policy expense_account_map_select on public.expense_account_map
  using (
    ((org_id = auth_org_id()) AND is_active_member())
  );

-- public.expense_advance_returns.expense_advance_returns_select  [true FOR SELECT TO PUBLIC]
alter policy expense_advance_returns_select on public.expense_advance_returns
  using (
    ((org_id = auth_org_id()) AND is_active_member() AND (EXISTS ( SELECT 1
   FROM expense_claims c
  WHERE (c.id = expense_advance_returns.advance_id))))
  );

-- public.expense_claim_files.expense_claim_files_select  [true FOR SELECT TO PUBLIC]
alter policy expense_claim_files_select on public.expense_claim_files
  using (
    ((org_id = auth_org_id()) AND is_active_member() AND (EXISTS ( SELECT 1
   FROM expense_claims c
  WHERE (c.id = expense_claim_files.claim_id))))
  );

-- public.expense_claim_files.expense_claim_files_write  [true FOR ALL TO PUBLIC]
alter policy expense_claim_files_write on public.expense_claim_files
  using (
    ((org_id = auth_org_id()) AND is_active_member() AND (EXISTS ( SELECT 1
   FROM expense_claims c
  WHERE ((c.id = expense_claim_files.claim_id) AND (c.org_id = auth_org_id()) AND (c.claimant_id = auth.uid()) AND (c.status = ANY (ARRAY['Draft'::expense_claim_status, 'Rejected'::expense_claim_status]))))))
  )
  with check (
    ((org_id = auth_org_id()) AND is_active_member() AND (EXISTS ( SELECT 1
   FROM expense_claims c
  WHERE ((c.id = expense_claim_files.claim_id) AND (c.org_id = auth_org_id()) AND (c.claimant_id = auth.uid()) AND (c.status = ANY (ARRAY['Draft'::expense_claim_status, 'Rejected'::expense_claim_status]))))))
  );

-- public.expense_claim_lines.expense_claim_lines_select  [true FOR SELECT TO PUBLIC]
alter policy expense_claim_lines_select on public.expense_claim_lines
  using (
    ((org_id = auth_org_id()) AND is_active_member() AND (EXISTS ( SELECT 1
   FROM expense_claims c
  WHERE (c.id = expense_claim_lines.claim_id))))
  );

-- public.expense_claim_lines.expense_claim_lines_write  [true FOR ALL TO PUBLIC]
alter policy expense_claim_lines_write on public.expense_claim_lines
  using (
    ((org_id = auth_org_id()) AND is_active_member() AND (EXISTS ( SELECT 1
   FROM expense_claims c
  WHERE ((c.id = expense_claim_lines.claim_id) AND (c.org_id = auth_org_id()) AND (c.claimant_id = auth.uid()) AND (c.kind = 'claim'::expense_kind) AND (c.status = ANY (ARRAY['Draft'::expense_claim_status, 'Rejected'::expense_claim_status]))))))
  )
  with check (
    ((org_id = auth_org_id()) AND is_active_member() AND (EXISTS ( SELECT 1
   FROM expense_claims c
  WHERE ((c.id = expense_claim_lines.claim_id) AND (c.org_id = auth_org_id()) AND (c.claimant_id = auth.uid()) AND (c.kind = 'claim'::expense_kind) AND (c.status = ANY (ARRAY['Draft'::expense_claim_status, 'Rejected'::expense_claim_status]))))))
  );

-- public.expense_claims.expense_claims_insert  [true FOR INSERT TO PUBLIC]
alter policy expense_claims_insert on public.expense_claims
  with check (
    ((org_id = auth_org_id()) AND is_active_member() AND (claimant_id = auth.uid()) AND ((project_id IS NULL) OR (EXISTS ( SELECT 1
   FROM projects p
  WHERE ((p.id = expense_claims.project_id) AND (p.org_id = auth_org_id()))))))
  );

-- public.expense_claims.expense_claims_select  [true FOR SELECT TO PUBLIC]
alter policy expense_claims_select on public.expense_claims
  using (
    ((org_id = auth_org_id()) AND is_active_member() AND ((claimant_id = auth.uid()) OR holds_spend_approval_authority(auth_role())))
  );

-- public.expense_claims.expense_claims_update  [true FOR UPDATE TO PUBLIC]
alter policy expense_claims_update on public.expense_claims
  using (
    ((org_id = auth_org_id()) AND is_active_member() AND (claimant_id = auth.uid()) AND (status = ANY (ARRAY['Draft'::expense_claim_status, 'Rejected'::expense_claim_status])))
  )
  with check (
    ((org_id = auth_org_id()) AND is_active_member() AND (claimant_id = auth.uid()) AND (status = ANY (ARRAY['Draft'::expense_claim_status, 'Rejected'::expense_claim_status])) AND ((project_id IS NULL) OR (EXISTS ( SELECT 1
   FROM projects p
  WHERE ((p.id = expense_claims.project_id) AND (p.org_id = auth_org_id()))))))
  );

-- public.expense_posting_erp_mirror.expense_posting_erp_mirror_select  [true FOR SELECT TO PUBLIC]
alter policy expense_posting_erp_mirror_select on public.expense_posting_erp_mirror
  using (
    ((org_id = auth_org_id()) AND is_active_member() AND (EXISTS ( SELECT 1
   FROM expense_claims c
  WHERE (c.id = expense_posting_erp_mirror.claim_id))))
  );

-- public.external_command_outbox.external_command_outbox_expenses_read_scope  [false FOR SELECT TO authenticated]
alter policy external_command_outbox_expenses_read_scope on public.external_command_outbox
  using (
    ((domain IS DISTINCT FROM 'expenses'::text) OR holds_spend_approval_authority(auth_role()))
  );

-- public.external_command_outbox.external_command_outbox_select  [true FOR SELECT TO PUBLIC]
alter policy external_command_outbox_select on public.external_command_outbox
  using (
    ((org_id = auth_org_id()) AND is_active_member())
  );

-- public.external_domain_ownership.external_domain_ownership_select  [true FOR SELECT TO PUBLIC]
alter policy external_domain_ownership_select on public.external_domain_ownership
  using (
    ((org_id = auth_org_id()) AND is_active_member())
  );

-- public.external_domain_ownership.external_domain_ownership_write  [true FOR ALL TO PUBLIC]
alter policy external_domain_ownership_write on public.external_domain_ownership
  using (
    (is_operator() AND is_active_member())
  )
  with check (
    (is_operator() AND is_active_member())
  );

-- public.external_master_records.external_master_records_select  [true FOR SELECT TO PUBLIC]
alter policy external_master_records_select on public.external_master_records
  using (
    ((org_id = auth_org_id()) AND is_active_member() AND ((kind <> ALL (ARRAY['account'::text, 'tax'::text, 'partner'::text])) OR (auth_role() = ANY (ARRAY['Admin'::user_role, 'Executive'::user_role, 'Finance'::user_role]))))
  );

-- public.external_org_bindings.external_org_bindings_select  [true FOR SELECT TO PUBLIC]
alter policy external_org_bindings_select on public.external_org_bindings
  using (
    ((org_id = auth_org_id()) AND is_active_member())
  );

-- public.external_org_bindings.external_org_bindings_update_admin_only  [false FOR UPDATE TO PUBLIC]
alter policy external_org_bindings_update_admin_only on public.external_org_bindings
  using (
    (auth_role() = 'Admin'::user_role)
  );

-- public.external_project_bindings.external_project_bindings_select  [true FOR SELECT TO PUBLIC]
alter policy external_project_bindings_select on public.external_project_bindings
  using (
    ((org_id = auth_org_id()) AND is_active_member())
  );

-- public.external_ref_lineage.external_ref_lineage_select  [true FOR SELECT TO PUBLIC]
alter policy external_ref_lineage_select on public.external_ref_lineage
  using (
    ((org_id = auth_org_id()) AND is_active_member())
  );

-- public.external_reference_items.external_reference_items_select  [true FOR SELECT TO PUBLIC]
alter policy external_reference_items_select on public.external_reference_items
  using (
    ((org_id = auth_org_id()) AND is_active_member())
  );

-- public.external_reference_items.external_reference_items_write  [true FOR ALL TO PUBLIC]
alter policy external_reference_items_write on public.external_reference_items
  using (
    ((org_id = auth_org_id()) AND is_active_member() AND (NOT domain_externally_owned(auth_org_id(), 'reference'::text)))
  )
  with check (
    ((org_id = auth_org_id()) AND is_active_member() AND (NOT domain_externally_owned(auth_org_id(), 'reference'::text)))
  );

-- public.external_refs.external_refs_select  [true FOR SELECT TO PUBLIC]
alter policy external_refs_select on public.external_refs
  using (
    ((org_id = auth_org_id()) AND is_active_member())
  );

-- public.external_sync_watermarks.external_sync_watermarks_select  [true FOR SELECT TO PUBLIC]
alter policy external_sync_watermarks_select on public.external_sync_watermarks
  using (
    ((org_id = auth_org_id()) AND is_active_member())
  );

-- public.fx_rates.fx_rates_insert  [true FOR INSERT TO PUBLIC]
alter policy fx_rates_insert on public.fx_rates
  with check (
    ((org_id = auth_org_id()) AND is_active_member() AND (auth_role() = ANY (ARRAY['Finance'::user_role, 'Admin'::user_role])) AND org_feature_enabled(auth_org_id(), 'multi_currency'::text))
  );

-- public.fx_rates.fx_rates_select  [true FOR SELECT TO authenticated]
alter policy fx_rates_select on public.fx_rates
  using (
    ((org_id = auth_org_id()) AND is_active_member())
  );

-- public.fx_rates.fx_rates_update  [true FOR UPDATE TO PUBLIC]
alter policy fx_rates_update on public.fx_rates
  using (
    ((org_id = auth_org_id()) AND is_active_member() AND (auth_role() = ANY (ARRAY['Finance'::user_role, 'Admin'::user_role])) AND org_feature_enabled(auth_org_id(), 'multi_currency'::text))
  )
  with check (
    ((org_id = auth_org_id()) AND is_active_member() AND (auth_role() = ANY (ARRAY['Finance'::user_role, 'Admin'::user_role])) AND org_feature_enabled(auth_org_id(), 'multi_currency'::text))
  );

-- public.imprest_cash_counts.imprest_cash_counts_select  [true FOR SELECT TO PUBLIC]
alter policy imprest_cash_counts_select on public.imprest_cash_counts
  using (
    ((org_id = auth_org_id()) AND is_active_member() AND (EXISTS ( SELECT 1
   FROM imprest_floats f
  WHERE (f.id = imprest_cash_counts.float_id))))
  );

-- public.imprest_float_changes.imprest_float_changes_select  [true FOR SELECT TO PUBLIC]
alter policy imprest_float_changes_select on public.imprest_float_changes
  using (
    ((org_id = auth_org_id()) AND is_active_member() AND (EXISTS ( SELECT 1
   FROM imprest_floats f
  WHERE (f.id = imprest_float_changes.float_id))))
  );

-- public.imprest_floats.imprest_floats_select  [true FOR SELECT TO PUBLIC]
alter policy imprest_floats_select on public.imprest_floats
  using (
    ((org_id = auth_org_id()) AND is_active_member() AND holds_spend_approval_authority(auth_role()))
  );

-- public.imprest_plan_lines.imprest_plan_lines_select  [true FOR SELECT TO PUBLIC]
alter policy imprest_plan_lines_select on public.imprest_plan_lines
  using (
    ((org_id = auth_org_id()) AND is_active_member() AND (EXISTS ( SELECT 1
   FROM imprest_plans p
  WHERE (p.id = imprest_plan_lines.plan_id))))
  );

-- public.imprest_plan_lines.imprest_plan_lines_write  [true FOR ALL TO PUBLIC]
alter policy imprest_plan_lines_write on public.imprest_plan_lines
  using (
    ((org_id = auth_org_id()) AND is_active_member() AND (EXISTS ( SELECT 1
   FROM imprest_plans p
  WHERE ((p.id = imprest_plan_lines.plan_id) AND (p.author_id = auth.uid())))) AND org_feature_enabled(auth_org_id(), 'imprest'::text))
  )
  with check (
    ((org_id = auth_org_id()) AND is_active_member() AND (EXISTS ( SELECT 1
   FROM imprest_plans p
  WHERE ((p.id = imprest_plan_lines.plan_id) AND (p.author_id = auth.uid())))) AND org_feature_enabled(auth_org_id(), 'imprest'::text))
  );

-- public.imprest_plans.imprest_plans_insert  [true FOR INSERT TO PUBLIC]
alter policy imprest_plans_insert on public.imprest_plans
  with check (
    ((org_id = auth_org_id()) AND is_active_member() AND (author_id = auth.uid()) AND (status = 'Draft'::text) AND holds_spend_approval_authority(auth_role()) AND (EXISTS ( SELECT 1
   FROM imprest_floats f
  WHERE ((f.id = imprest_plans.float_id) AND (f.org_id = auth_org_id()) AND (f.archived_at IS NULL)))) AND org_feature_enabled(auth_org_id(), 'imprest'::text))
  );

-- public.imprest_plans.imprest_plans_select  [true FOR SELECT TO PUBLIC]
alter policy imprest_plans_select on public.imprest_plans
  using (
    ((org_id = auth_org_id()) AND is_active_member() AND (EXISTS ( SELECT 1
   FROM imprest_floats f
  WHERE (f.id = imprest_plans.float_id))))
  );

-- public.imprest_posting_erp_mirror.imprest_posting_erp_mirror_select  [true FOR SELECT TO PUBLIC]
alter policy imprest_posting_erp_mirror_select on public.imprest_posting_erp_mirror
  using (
    ((org_id = auth_org_id()) AND is_active_member() AND (EXISTS ( SELECT 1
   FROM imprest_replenishments r
  WHERE (r.id = imprest_posting_erp_mirror.replenishment_id))))
  );

-- public.imprest_replenishments.imprest_replenishments_select  [true FOR SELECT TO PUBLIC]
alter policy imprest_replenishments_select on public.imprest_replenishments
  using (
    ((org_id = auth_org_id()) AND is_active_member() AND (EXISTS ( SELECT 1
   FROM imprest_floats f
  WHERE (f.id = imprest_replenishments.float_id))))
  );

-- public.incident_reports.incident_reports_delete  [true FOR DELETE TO PUBLIC]
alter policy incident_reports_delete on public.incident_reports
  using (
    ((org_id = auth_org_id()) AND is_active_member() AND (auth_role() = ANY (ARRAY['Admin'::user_role, 'Executive'::user_role, 'Project Manager'::user_role, 'Finance'::user_role])) AND org_feature_enabled(auth_org_id(), 'incidents'::text))
  );

-- public.incident_reports.incident_reports_delete_admin_only  [false FOR DELETE TO PUBLIC]
alter policy incident_reports_delete_admin_only on public.incident_reports
  using (
    (auth_role() = 'Admin'::user_role)
  );

-- public.incident_reports.incident_reports_insert  [true FOR INSERT TO PUBLIC]
alter policy incident_reports_insert on public.incident_reports
  with check (
    ((org_id = auth_org_id()) AND is_active_member() AND org_feature_enabled(auth_org_id(), 'incidents'::text))
  );

-- public.incident_reports.incident_reports_select  [true FOR SELECT TO PUBLIC]
alter policy incident_reports_select on public.incident_reports
  using (
    ((org_id = auth_org_id()) AND is_active_member())
  );

-- public.incident_reports.incident_reports_update  [true FOR UPDATE TO PUBLIC]
alter policy incident_reports_update on public.incident_reports
  using (
    ((org_id = auth_org_id()) AND (auth_role() = ANY (ARRAY['Admin'::user_role, 'Executive'::user_role, 'Project Manager'::user_role, 'Finance'::user_role])) AND is_active_member() AND org_feature_enabled(auth_org_id(), 'incidents'::text))
  )
  with check (
    ((org_id = auth_org_id()) AND is_active_member() AND org_feature_enabled(auth_org_id(), 'incidents'::text))
  );

-- public.incoming_payments.incoming_payments_delete  [true FOR DELETE TO PUBLIC]
alter policy incoming_payments_delete on public.incoming_payments
  using (
    ((org_id = auth_org_id()) AND is_active_member() AND (auth_role() = ANY (ARRAY['Admin'::user_role, 'Finance'::user_role])) AND (NOT domain_externally_owned(auth_org_id(), 'revenue'::text)) AND org_feature_enabled(auth_org_id(), 'revenue'::text))
  );

-- public.incoming_payments.incoming_payments_insert  [true FOR INSERT TO PUBLIC]
alter policy incoming_payments_insert on public.incoming_payments
  with check (
    ((org_id = auth_org_id()) AND is_active_member() AND (auth_role() = ANY (ARRAY['Admin'::user_role, 'Finance'::user_role])) AND (NOT domain_externally_owned(auth_org_id(), 'revenue'::text)) AND org_feature_enabled(auth_org_id(), 'revenue'::text))
  );

-- public.incoming_payments.incoming_payments_select  [true FOR SELECT TO PUBLIC]
alter policy incoming_payments_select on public.incoming_payments
  using (
    ((org_id = auth_org_id()) AND is_active_member())
  );

-- public.incoming_payments.incoming_payments_update  [true FOR UPDATE TO PUBLIC]
alter policy incoming_payments_update on public.incoming_payments
  using (
    ((org_id = auth_org_id()) AND is_active_member() AND (auth_role() = ANY (ARRAY['Admin'::user_role, 'Finance'::user_role])) AND org_feature_enabled(auth_org_id(), 'revenue'::text))
  )
  with check (
    ((org_id = auth_org_id()) AND is_active_member() AND (auth_role() = ANY (ARRAY['Admin'::user_role, 'Finance'::user_role])) AND org_feature_enabled(auth_org_id(), 'revenue'::text))
  );

-- public.m365_record_folder_sweeps.m365_record_folder_sweeps_select  [true FOR SELECT TO authenticated]
alter policy m365_record_folder_sweeps_select on public.m365_record_folder_sweeps
  using (
    ((org_id = auth_org_id()) AND is_active_member() AND ((auth_role())::text = ANY (ARRAY['Admin'::text, 'Executive'::text, 'Project Manager'::text, 'Finance'::text])))
  );

-- public.meeting_access_grants.meeting_access_grants_delete  [true FOR DELETE TO PUBLIC]
alter policy meeting_access_grants_delete on public.meeting_access_grants
  using (
    ((org_id = auth_org_id()) AND is_active_member() AND ((granted_by = ( SELECT auth.uid() AS uid)) OR (auth_role() = 'Admin'::user_role) OR (EXISTS ( SELECT 1
   FROM meetings m
  WHERE ((m.id = meeting_access_grants.meeting_id) AND (m.created_by_id = ( SELECT auth.uid() AS uid)))))))
  );

-- public.meeting_access_grants.meeting_access_grants_insert  [true FOR INSERT TO PUBLIC]
alter policy meeting_access_grants_insert on public.meeting_access_grants
  with check (
    ((org_id = auth_org_id()) AND is_active_member() AND can_read_meeting(meeting_id) AND (EXISTS ( SELECT 1
   FROM profiles pr
  WHERE ((pr.id = meeting_access_grants.user_id) AND (pr.org_id = auth_org_id())))))
  );

-- public.meeting_access_grants.meeting_access_grants_select  [true FOR SELECT TO PUBLIC]
alter policy meeting_access_grants_select on public.meeting_access_grants
  using (
    ((org_id = auth_org_id()) AND is_active_member() AND can_read_meeting(meeting_id))
  );

-- public.meeting_attendees.meeting_attendees_delete  [true FOR DELETE TO PUBLIC]
alter policy meeting_attendees_delete on public.meeting_attendees
  using (
    ((org_id = auth_org_id()) AND is_active_member() AND (EXISTS ( SELECT 1
   FROM meetings m
  WHERE ((m.id = meeting_attendees.meeting_id) AND (m.org_id = auth_org_id()) AND ((m.created_by_id = ( SELECT auth.uid() AS uid)) OR (auth_role() = 'Admin'::user_role))))))
  );

-- public.meeting_attendees.meeting_attendees_insert  [true FOR INSERT TO PUBLIC]
alter policy meeting_attendees_insert on public.meeting_attendees
  with check (
    ((org_id = auth_org_id()) AND is_active_member() AND (EXISTS ( SELECT 1
   FROM meetings m
  WHERE ((m.id = meeting_attendees.meeting_id) AND (m.org_id = auth_org_id()) AND ((m.created_by_id = ( SELECT auth.uid() AS uid)) OR (auth_role() = 'Admin'::user_role))))) AND ((profile_id IS NULL) OR (EXISTS ( SELECT 1
   FROM profiles pr
  WHERE ((pr.id = meeting_attendees.profile_id) AND (pr.org_id = auth_org_id()))))) AND ((contact_id IS NULL) OR (EXISTS ( SELECT 1
   FROM contacts ct
  WHERE ((ct.id = meeting_attendees.contact_id) AND (ct.org_id = auth_org_id()))))))
  );

-- public.meeting_attendees.meeting_attendees_select  [true FOR SELECT TO PUBLIC]
alter policy meeting_attendees_select on public.meeting_attendees
  using (
    ((org_id = auth_org_id()) AND is_active_member() AND can_read_meeting(meeting_id))
  );

-- public.meetings.meetings_delete  [true FOR DELETE TO PUBLIC]
alter policy meetings_delete on public.meetings
  using (
    ((org_id = auth_org_id()) AND is_active_member() AND (auth_role() = 'Admin'::user_role))
  );

-- public.meetings.meetings_insert  [true FOR INSERT TO PUBLIC]
alter policy meetings_insert on public.meetings
  with check (
    ((org_id = auth_org_id()) AND is_active_member() AND ((project_id IS NULL) OR (EXISTS ( SELECT 1
   FROM projects p
  WHERE ((p.id = meetings.project_id) AND (p.org_id = auth_org_id()))))))
  );

-- public.meetings.meetings_select  [true FOR SELECT TO PUBLIC]
alter policy meetings_select on public.meetings
  using (
    ((org_id = auth_org_id()) AND is_active_member() AND ((auth_role() = 'Admin'::user_role) OR (created_by_id = ( SELECT auth.uid() AS uid)) OR is_meeting_attendee(id) OR has_meeting_grant(id)))
  );

-- public.meetings.meetings_update  [true FOR UPDATE TO PUBLIC]
alter policy meetings_update on public.meetings
  using (
    ((org_id = auth_org_id()) AND is_active_member() AND ((auth_role() = 'Admin'::user_role) OR (created_by_id = ( SELECT auth.uid() AS uid))))
  )
  with check (
    ((org_id = auth_org_id()) AND is_active_member() AND ((auth_role() = 'Admin'::user_role) OR (created_by_id = ( SELECT auth.uid() AS uid))) AND ((project_id IS NULL) OR (EXISTS ( SELECT 1
   FROM projects p
  WHERE ((p.id = meetings.project_id) AND (p.org_id = auth_org_id()))))))
  );

-- public.notifications.notifications_delete  [true FOR DELETE TO PUBLIC]
alter policy notifications_delete on public.notifications
  using (
    ((owner_id = auth.uid()) AND (org_id = auth_org_id()) AND is_active_member())
  );

-- public.notifications.notifications_insert  [true FOR INSERT TO PUBLIC]
alter policy notifications_insert on public.notifications
  with check (
    ((owner_id = auth.uid()) AND (org_id = auth_org_id()) AND is_active_member())
  );

-- public.notifications.notifications_select  [true FOR SELECT TO PUBLIC]
alter policy notifications_select on public.notifications
  using (
    ((owner_id = auth.uid()) AND (org_id = auth_org_id()) AND is_active_member())
  );

-- public.notifications.notifications_update  [true FOR UPDATE TO PUBLIC]
alter policy notifications_update on public.notifications
  using (
    ((owner_id = auth.uid()) AND (org_id = auth_org_id()) AND is_active_member())
  )
  with check (
    ((owner_id = auth.uid()) AND (org_id = auth_org_id()) AND is_active_member())
  );

-- public.org_features.org_features_admin_feedback_insert  [true FOR INSERT TO PUBLIC]
alter policy org_features_admin_feedback_insert on public.org_features
  with check (
    ((feature_key = 'feedback_surveys'::text) AND (org_id = auth_org_id()) AND is_active_member() AND (auth_role() = 'Admin'::user_role))
  );

-- public.org_features.org_features_admin_feedback_update  [true FOR UPDATE TO PUBLIC]
alter policy org_features_admin_feedback_update on public.org_features
  using (
    ((feature_key = 'feedback_surveys'::text) AND (org_id = auth_org_id()) AND is_active_member() AND (auth_role() = 'Admin'::user_role))
  )
  with check (
    ((feature_key = 'feedback_surveys'::text) AND (org_id = auth_org_id()) AND is_active_member() AND (auth_role() = 'Admin'::user_role))
  );

-- public.org_features.org_features_select  [true FOR SELECT TO PUBLIC]
alter policy org_features_select on public.org_features
  using (
    ((org_id = auth_org_id()) AND is_active_member())
  );

-- public.org_features.org_features_write  [true FOR ALL TO PUBLIC]
alter policy org_features_write on public.org_features
  using (
    ((feature_key <> 'feedback_surveys'::text) AND is_operator() AND is_active_member())
  )
  with check (
    ((feature_key <> 'feedback_surveys'::text) AND is_operator() AND is_active_member())
  );

-- public.org_imprest_settings.org_imprest_settings_select  [true FOR SELECT TO PUBLIC]
alter policy org_imprest_settings_select on public.org_imprest_settings
  using (
    ((org_id = auth_org_id()) AND is_active_member())
  );

-- public.org_m365_document_settings.m365_settings_insert  [true FOR INSERT TO authenticated]
alter policy m365_settings_insert on public.org_m365_document_settings
  with check (
    ((org_id = auth_org_id()) AND is_active_member() AND (auth_role() = 'Admin'::user_role))
  );

-- public.org_m365_document_settings.m365_settings_select  [true FOR SELECT TO authenticated]
alter policy m365_settings_select on public.org_m365_document_settings
  using (
    ((org_id = auth_org_id()) AND is_active_member())
  );

-- public.org_m365_document_settings.m365_settings_update  [true FOR UPDATE TO authenticated]
alter policy m365_settings_update on public.org_m365_document_settings
  using (
    ((org_id = auth_org_id()) AND is_active_member() AND (auth_role() = 'Admin'::user_role))
  )
  with check (
    ((org_id = auth_org_id()) AND is_active_member() AND (auth_role() = 'Admin'::user_role))
  );

-- public.organizations.organizations_select  [true FOR SELECT TO PUBLIC]
alter policy organizations_select on public.organizations
  using (
    ((id = auth_org_id()) AND is_active_member())
  );

-- public.organizations.organizations_update_project_number_pattern  [true FOR UPDATE TO PUBLIC]
alter policy organizations_update_project_number_pattern on public.organizations
  using (
    ((id = auth_org_id()) AND is_active_member() AND (auth_role() = 'Admin'::user_role))
  )
  with check (
    ((id = auth_org_id()) AND is_active_member() AND (auth_role() = 'Admin'::user_role))
  );

-- public.organizations.organizations_update_tax_default  [true FOR UPDATE TO PUBLIC]
alter policy organizations_update_tax_default on public.organizations
  using (
    ((id = auth_org_id()) AND is_active_member() AND (auth_role() = 'Admin'::user_role))
  )
  with check (
    ((id = auth_org_id()) AND is_active_member() AND (auth_role() = 'Admin'::user_role))
  );

-- public.payment_files.payment_files_delete_admin_only  [false FOR DELETE TO PUBLIC]
alter policy payment_files_delete_admin_only on public.payment_files
  using (
    ((auth_role() = 'Admin'::user_role) AND is_active_member() AND org_feature_enabled(auth_org_id(), 'procurement'::text))
  );

-- public.payment_files.payment_files_select  [true FOR SELECT TO PUBLIC]
alter policy payment_files_select on public.payment_files
  using (
    ((org_id = auth_org_id()) AND is_active_member())
  );

-- public.payment_files.payment_files_write  [true FOR ALL TO PUBLIC]
alter policy payment_files_write on public.payment_files
  using (
    ((org_id = auth_org_id()) AND (auth_role() = ANY (ARRAY['Admin'::user_role, 'Executive'::user_role, 'Project Manager'::user_role, 'Finance'::user_role])) AND (EXISTS ( SELECT 1
   FROM payments r
  WHERE ((r.id = payment_files.payment_id) AND (r.org_id = auth_org_id())))) AND is_active_member() AND org_feature_enabled(auth_org_id(), 'procurement'::text))
  )
  with check (
    ((org_id = auth_org_id()) AND (auth_role() = ANY (ARRAY['Admin'::user_role, 'Executive'::user_role, 'Project Manager'::user_role, 'Finance'::user_role])) AND (EXISTS ( SELECT 1
   FROM payments r
  WHERE ((r.id = payment_files.payment_id) AND (r.org_id = auth_org_id())))) AND is_active_member() AND org_feature_enabled(auth_org_id(), 'procurement'::text))
  );

-- public.payments.payments_delete  [true FOR DELETE TO PUBLIC]
alter policy payments_delete on public.payments
  using (
    ((org_id = auth_org_id()) AND is_active_member() AND (auth_role() = ANY (ARRAY['Admin'::user_role, 'Executive'::user_role, 'Project Manager'::user_role, 'Finance'::user_role])) AND (EXISTS ( SELECT 1
   FROM procurements p
  WHERE ((p.id = payments.procurement_id) AND (p.org_id = auth_org_id())))) AND (NOT domain_externally_owned(auth_org_id(), 'procurement'::text)) AND org_feature_enabled(auth_org_id(), 'procurement'::text))
  );

-- public.payments.payments_insert  [true FOR INSERT TO PUBLIC]
alter policy payments_insert on public.payments
  with check (
    ((org_id = auth_org_id()) AND is_active_member() AND (auth_role() = ANY (ARRAY['Admin'::user_role, 'Executive'::user_role, 'Project Manager'::user_role, 'Finance'::user_role])) AND (EXISTS ( SELECT 1
   FROM procurements p
  WHERE ((p.id = payments.procurement_id) AND (p.org_id = auth_org_id())))) AND (NOT domain_externally_owned(auth_org_id(), 'procurement'::text)) AND org_feature_enabled(auth_org_id(), 'procurement'::text))
  );

-- public.payments.payments_select  [true FOR SELECT TO PUBLIC]
alter policy payments_select on public.payments
  using (
    ((org_id = auth_org_id()) AND is_active_member())
  );

-- public.payments.payments_update  [true FOR UPDATE TO PUBLIC]
alter policy payments_update on public.payments
  using (
    ((org_id = auth_org_id()) AND is_active_member() AND (auth_role() = ANY (ARRAY['Admin'::user_role, 'Executive'::user_role, 'Project Manager'::user_role, 'Finance'::user_role])) AND (EXISTS ( SELECT 1
   FROM procurements p
  WHERE ((p.id = payments.procurement_id) AND (p.org_id = auth_org_id())))) AND org_feature_enabled(auth_org_id(), 'procurement'::text))
  )
  with check (
    ((org_id = auth_org_id()) AND is_active_member() AND (auth_role() = ANY (ARRAY['Admin'::user_role, 'Executive'::user_role, 'Project Manager'::user_role, 'Finance'::user_role])) AND (EXISTS ( SELECT 1
   FROM procurements p
  WHERE ((p.id = payments.procurement_id) AND (p.org_id = auth_org_id())))) AND org_feature_enabled(auth_org_id(), 'procurement'::text))
  );

-- public.pipeline_stage_config.pipeline_stage_config_select  [true FOR SELECT TO PUBLIC]
alter policy pipeline_stage_config_select on public.pipeline_stage_config
  using (
    ((org_id = auth_org_id()) AND is_active_member())
  );

-- public.pipeline_stage_config.pipeline_stage_config_write  [true FOR ALL TO PUBLIC]
alter policy pipeline_stage_config_write on public.pipeline_stage_config
  using (
    ((org_id = auth_org_id()) AND is_active_member() AND (auth_role() = 'Admin'::user_role))
  )
  with check (
    ((org_id = auth_org_id()) AND is_active_member() AND (auth_role() = 'Admin'::user_role))
  );

-- public.po_variation_lines.po_variation_lines_read  [true FOR SELECT TO PUBLIC]
alter policy po_variation_lines_read on public.po_variation_lines
  using (
    ((org_id = auth_org_id()) AND is_active_member() AND (EXISTS ( SELECT 1
   FROM po_variations v
  WHERE (v.id = po_variation_lines.variation_id))))
  );

-- public.po_variations.po_variations_read  [true FOR SELECT TO PUBLIC]
alter policy po_variations_read on public.po_variations
  using (
    ((org_id = auth_org_id()) AND is_active_member() AND (EXISTS ( SELECT 1
   FROM purchase_orders po
  WHERE (po.id = po_variations.po_id))))
  );

-- public.procurement_doc_counters.procurement_doc_counters_select  [true FOR SELECT TO PUBLIC]
alter policy procurement_doc_counters_select on public.procurement_doc_counters
  using (
    (org_id = auth_org_id())
  );

-- public.procurement_documents.procurement_documents_select  [true FOR SELECT TO PUBLIC]
alter policy procurement_documents_select on public.procurement_documents
  using (
    ((org_id = auth_org_id()) AND is_active_member())
  );

-- public.procurement_documents.procurement_documents_write  [true FOR ALL TO PUBLIC]
alter policy procurement_documents_write on public.procurement_documents
  using (
    ((org_id = auth_org_id()) AND (auth_role() = ANY (ARRAY['Admin'::user_role, 'Executive'::user_role, 'Project Manager'::user_role, 'Finance'::user_role])) AND (EXISTS ( SELECT 1
   FROM procurements p
  WHERE ((p.id = procurement_documents.procurement_id) AND (p.org_id = auth_org_id())))) AND is_active_member() AND org_feature_enabled(auth_org_id(), 'procurement'::text))
  )
  with check (
    ((org_id = auth_org_id()) AND (auth_role() = ANY (ARRAY['Admin'::user_role, 'Executive'::user_role, 'Project Manager'::user_role, 'Finance'::user_role])) AND (EXISTS ( SELECT 1
   FROM procurements p
  WHERE ((p.id = procurement_documents.procurement_id) AND (p.org_id = auth_org_id())))) AND is_active_member() AND org_feature_enabled(auth_org_id(), 'procurement'::text))
  );

-- public.procurement_import_runs.procurement_import_runs_select  [true FOR SELECT TO authenticated]
alter policy procurement_import_runs_select on public.procurement_import_runs
  using (
    ((org_id = auth_org_id()) AND is_active_member())
  );

-- public.procurement_invoice_files.procurement_invoice_files_delete_admin_only  [false FOR DELETE TO PUBLIC]
alter policy procurement_invoice_files_delete_admin_only on public.procurement_invoice_files
  using (
    ((auth_role() = 'Admin'::user_role) AND is_active_member() AND org_feature_enabled(auth_org_id(), 'procurement'::text))
  );

-- public.procurement_invoice_files.procurement_invoice_files_select  [true FOR SELECT TO PUBLIC]
alter policy procurement_invoice_files_select on public.procurement_invoice_files
  using (
    ((org_id = auth_org_id()) AND is_active_member())
  );

-- public.procurement_invoice_files.procurement_invoice_files_write  [true FOR ALL TO PUBLIC]
alter policy procurement_invoice_files_write on public.procurement_invoice_files
  using (
    ((org_id = auth_org_id()) AND (auth_role() = ANY (ARRAY['Admin'::user_role, 'Executive'::user_role, 'Project Manager'::user_role, 'Finance'::user_role])) AND (EXISTS ( SELECT 1
   FROM procurement_invoices v
  WHERE ((v.id = procurement_invoice_files.invoice_id) AND (v.org_id = auth_org_id())))) AND is_active_member() AND org_feature_enabled(auth_org_id(), 'procurement'::text))
  )
  with check (
    ((org_id = auth_org_id()) AND (auth_role() = ANY (ARRAY['Admin'::user_role, 'Executive'::user_role, 'Project Manager'::user_role, 'Finance'::user_role])) AND (EXISTS ( SELECT 1
   FROM procurement_invoices v
  WHERE ((v.id = procurement_invoice_files.invoice_id) AND (v.org_id = auth_org_id())))) AND is_active_member() AND org_feature_enabled(auth_org_id(), 'procurement'::text))
  );

-- public.procurement_invoice_lines.procurement_invoice_lines_read  [true FOR SELECT TO PUBLIC]
alter policy procurement_invoice_lines_read on public.procurement_invoice_lines
  using (
    ((org_id = auth_org_id()) AND is_active_member() AND (EXISTS ( SELECT 1
   FROM procurement_invoices i
  WHERE (i.id = procurement_invoice_lines.invoice_id))))
  );

-- public.procurement_invoices.procurement_invoices_delete  [true FOR DELETE TO PUBLIC]
alter policy procurement_invoices_delete on public.procurement_invoices
  using (
    ((org_id = auth_org_id()) AND is_active_member() AND (auth_role() = ANY (ARRAY['Admin'::user_role, 'Executive'::user_role, 'Project Manager'::user_role, 'Finance'::user_role])) AND (EXISTS ( SELECT 1
   FROM procurements p
  WHERE ((p.id = procurement_invoices.procurement_id) AND (p.org_id = auth_org_id())))) AND (NOT domain_externally_owned(auth_org_id(), 'procurement'::text)) AND org_feature_enabled(auth_org_id(), 'procurement'::text))
  );

-- public.procurement_invoices.procurement_invoices_insert  [true FOR INSERT TO PUBLIC]
alter policy procurement_invoices_insert on public.procurement_invoices
  with check (
    ((org_id = auth_org_id()) AND is_active_member() AND (auth_role() = ANY (ARRAY['Admin'::user_role, 'Executive'::user_role, 'Project Manager'::user_role, 'Finance'::user_role])) AND (EXISTS ( SELECT 1
   FROM procurements p
  WHERE ((p.id = procurement_invoices.procurement_id) AND (p.org_id = auth_org_id())))) AND (NOT domain_externally_owned(auth_org_id(), 'procurement'::text)) AND org_feature_enabled(auth_org_id(), 'procurement'::text))
  );

-- public.procurement_invoices.procurement_invoices_select  [true FOR SELECT TO PUBLIC]
alter policy procurement_invoices_select on public.procurement_invoices
  using (
    ((org_id = auth_org_id()) AND is_active_member())
  );

-- public.procurement_invoices.procurement_invoices_update  [true FOR UPDATE TO PUBLIC]
alter policy procurement_invoices_update on public.procurement_invoices
  using (
    ((org_id = auth_org_id()) AND is_active_member() AND (auth_role() = ANY (ARRAY['Admin'::user_role, 'Executive'::user_role, 'Project Manager'::user_role, 'Finance'::user_role])) AND (EXISTS ( SELECT 1
   FROM procurements p
  WHERE ((p.id = procurement_invoices.procurement_id) AND (p.org_id = auth_org_id())))) AND org_feature_enabled(auth_org_id(), 'procurement'::text))
  )
  with check (
    ((org_id = auth_org_id()) AND is_active_member() AND (auth_role() = ANY (ARRAY['Admin'::user_role, 'Executive'::user_role, 'Project Manager'::user_role, 'Finance'::user_role])) AND (EXISTS ( SELECT 1
   FROM procurements p
  WHERE ((p.id = procurement_invoices.procurement_id) AND (p.org_id = auth_org_id())))) AND org_feature_enabled(auth_org_id(), 'procurement'::text))
  );

-- public.procurement_items.procurement_items_draft_only  [false FOR INSERT TO PUBLIC]
alter policy procurement_items_draft_only on public.procurement_items
  with check (
    ((EXISTS ( SELECT 1
   FROM procurements p
  WHERE ((p.id = procurement_items.procurement_id) AND (p.org_id = auth_org_id()) AND (p.status = 'Draft'::procurement_status)))) AND is_active_member() AND org_feature_enabled(auth_org_id(), 'procurement'::text))
  );

-- public.procurement_items.procurement_items_draft_only_del  [false FOR DELETE TO PUBLIC]
alter policy procurement_items_draft_only_del on public.procurement_items
  using (
    ((EXISTS ( SELECT 1
   FROM procurements p
  WHERE ((p.id = procurement_items.procurement_id) AND (p.org_id = auth_org_id()) AND (p.status = 'Draft'::procurement_status)))) AND is_active_member() AND org_feature_enabled(auth_org_id(), 'procurement'::text))
  );

-- public.procurement_items.procurement_items_draft_only_mod  [false FOR UPDATE TO PUBLIC]
alter policy procurement_items_draft_only_mod on public.procurement_items
  using (
    ((EXISTS ( SELECT 1
   FROM procurements p
  WHERE ((p.id = procurement_items.procurement_id) AND (p.org_id = auth_org_id()) AND (p.status = 'Draft'::procurement_status)))) AND is_active_member() AND org_feature_enabled(auth_org_id(), 'procurement'::text))
  )
  with check (
    ((EXISTS ( SELECT 1
   FROM procurements p
  WHERE ((p.id = procurement_items.procurement_id) AND (p.org_id = auth_org_id()) AND (p.status = 'Draft'::procurement_status)))) AND is_active_member() AND org_feature_enabled(auth_org_id(), 'procurement'::text))
  );

-- public.procurement_items.procurement_items_requester  [true FOR INSERT TO PUBLIC]
alter policy procurement_items_requester on public.procurement_items
  with check (
    ((org_id = auth_org_id()) AND (EXISTS ( SELECT 1
   FROM procurements p
  WHERE ((p.id = procurement_items.procurement_id) AND (p.org_id = auth_org_id()) AND (p.requested_by_id = ( SELECT auth.uid() AS uid))))) AND is_active_member() AND org_feature_enabled(auth_org_id(), 'procurement'::text))
  );

-- public.procurement_items.procurement_items_requester_del  [true FOR DELETE TO PUBLIC]
alter policy procurement_items_requester_del on public.procurement_items
  using (
    ((org_id = auth_org_id()) AND (EXISTS ( SELECT 1
   FROM procurements p
  WHERE ((p.id = procurement_items.procurement_id) AND (p.org_id = auth_org_id()) AND (p.requested_by_id = ( SELECT auth.uid() AS uid))))) AND is_active_member() AND org_feature_enabled(auth_org_id(), 'procurement'::text))
  );

-- public.procurement_items.procurement_items_requester_mod  [true FOR UPDATE TO PUBLIC]
alter policy procurement_items_requester_mod on public.procurement_items
  using (
    ((org_id = auth_org_id()) AND (EXISTS ( SELECT 1
   FROM procurements p
  WHERE ((p.id = procurement_items.procurement_id) AND (p.org_id = auth_org_id()) AND (p.requested_by_id = ( SELECT auth.uid() AS uid))))) AND is_active_member() AND org_feature_enabled(auth_org_id(), 'procurement'::text))
  )
  with check (
    ((org_id = auth_org_id()) AND (EXISTS ( SELECT 1
   FROM procurements p
  WHERE ((p.id = procurement_items.procurement_id) AND (p.org_id = auth_org_id()) AND (p.requested_by_id = ( SELECT auth.uid() AS uid))))) AND is_active_member() AND org_feature_enabled(auth_org_id(), 'procurement'::text))
  );

-- public.procurement_items.procurement_items_select  [true FOR SELECT TO PUBLIC]
alter policy procurement_items_select on public.procurement_items
  using (
    ((org_id = auth_org_id()) AND is_active_member())
  );

-- public.procurement_items.procurement_items_write  [true FOR ALL TO PUBLIC]
alter policy procurement_items_write on public.procurement_items
  using (
    ((org_id = auth_org_id()) AND (auth_role() = ANY (ARRAY['Admin'::user_role, 'Executive'::user_role, 'Project Manager'::user_role, 'Finance'::user_role])) AND (EXISTS ( SELECT 1
   FROM procurements p
  WHERE ((p.id = procurement_items.procurement_id) AND (p.org_id = auth_org_id())))) AND is_active_member() AND org_feature_enabled(auth_org_id(), 'procurement'::text))
  )
  with check (
    ((org_id = auth_org_id()) AND (auth_role() = ANY (ARRAY['Admin'::user_role, 'Executive'::user_role, 'Project Manager'::user_role, 'Finance'::user_role])) AND (EXISTS ( SELECT 1
   FROM procurements p
  WHERE ((p.id = procurement_items.procurement_id) AND (p.org_id = auth_org_id())))) AND is_active_member() AND org_feature_enabled(auth_org_id(), 'procurement'::text))
  );

-- public.procurement_quotation_files.procurement_quotation_files_delete_admin_only  [false FOR DELETE TO PUBLIC]
alter policy procurement_quotation_files_delete_admin_only on public.procurement_quotation_files
  using (
    ((auth_role() = 'Admin'::user_role) AND is_active_member() AND org_feature_enabled(auth_org_id(), 'procurement'::text))
  );

-- public.procurement_quotation_files.procurement_quotation_files_select  [true FOR SELECT TO PUBLIC]
alter policy procurement_quotation_files_select on public.procurement_quotation_files
  using (
    ((org_id = auth_org_id()) AND is_active_member())
  );

-- public.procurement_quotation_files.procurement_quotation_files_write  [true FOR ALL TO PUBLIC]
alter policy procurement_quotation_files_write on public.procurement_quotation_files
  using (
    ((org_id = auth_org_id()) AND (auth_role() = ANY (ARRAY['Admin'::user_role, 'Executive'::user_role, 'Project Manager'::user_role, 'Finance'::user_role])) AND (EXISTS ( SELECT 1
   FROM procurement_quotations q
  WHERE ((q.id = procurement_quotation_files.quotation_id) AND (q.org_id = auth_org_id())))) AND is_active_member() AND org_feature_enabled(auth_org_id(), 'procurement'::text))
  )
  with check (
    ((org_id = auth_org_id()) AND (auth_role() = ANY (ARRAY['Admin'::user_role, 'Executive'::user_role, 'Project Manager'::user_role, 'Finance'::user_role])) AND (EXISTS ( SELECT 1
   FROM procurement_quotations q
  WHERE ((q.id = procurement_quotation_files.quotation_id) AND (q.org_id = auth_org_id())))) AND is_active_member() AND org_feature_enabled(auth_org_id(), 'procurement'::text))
  );

-- public.procurement_quotations.procurement_quotations_select  [true FOR SELECT TO PUBLIC]
alter policy procurement_quotations_select on public.procurement_quotations
  using (
    ((org_id = auth_org_id()) AND is_active_member())
  );

-- public.procurement_quotations.procurement_quotations_write  [true FOR ALL TO PUBLIC]
alter policy procurement_quotations_write on public.procurement_quotations
  using (
    ((org_id = auth_org_id()) AND (auth_role() = ANY (ARRAY['Admin'::user_role, 'Executive'::user_role, 'Project Manager'::user_role, 'Finance'::user_role])) AND (EXISTS ( SELECT 1
   FROM procurements p
  WHERE ((p.id = procurement_quotations.procurement_id) AND (p.org_id = auth_org_id())))) AND is_active_member() AND org_feature_enabled(auth_org_id(), 'procurement'::text))
  )
  with check (
    ((org_id = auth_org_id()) AND (auth_role() = ANY (ARRAY['Admin'::user_role, 'Executive'::user_role, 'Project Manager'::user_role, 'Finance'::user_role])) AND (EXISTS ( SELECT 1
   FROM procurements p
  WHERE ((p.id = procurement_quotations.procurement_id) AND (p.org_id = auth_org_id())))) AND is_active_member() AND org_feature_enabled(auth_org_id(), 'procurement'::text))
  );

-- public.procurement_receipt_files.procurement_receipt_files_delete_admin_only  [false FOR DELETE TO PUBLIC]
alter policy procurement_receipt_files_delete_admin_only on public.procurement_receipt_files
  using (
    ((auth_role() = 'Admin'::user_role) AND is_active_member() AND org_feature_enabled(auth_org_id(), 'procurement'::text))
  );

-- public.procurement_receipt_files.procurement_receipt_files_select  [true FOR SELECT TO PUBLIC]
alter policy procurement_receipt_files_select on public.procurement_receipt_files
  using (
    ((org_id = auth_org_id()) AND is_active_member())
  );

-- public.procurement_receipt_files.procurement_receipt_files_write  [true FOR ALL TO PUBLIC]
alter policy procurement_receipt_files_write on public.procurement_receipt_files
  using (
    ((org_id = auth_org_id()) AND (auth_role() = ANY (ARRAY['Admin'::user_role, 'Executive'::user_role, 'Project Manager'::user_role, 'Finance'::user_role])) AND (EXISTS ( SELECT 1
   FROM procurement_receipts r
  WHERE ((r.id = procurement_receipt_files.receipt_id) AND (r.org_id = auth_org_id())))) AND is_active_member() AND org_feature_enabled(auth_org_id(), 'procurement'::text))
  )
  with check (
    ((org_id = auth_org_id()) AND (auth_role() = ANY (ARRAY['Admin'::user_role, 'Executive'::user_role, 'Project Manager'::user_role, 'Finance'::user_role])) AND (EXISTS ( SELECT 1
   FROM procurement_receipts r
  WHERE ((r.id = procurement_receipt_files.receipt_id) AND (r.org_id = auth_org_id())))) AND is_active_member() AND org_feature_enabled(auth_org_id(), 'procurement'::text))
  );

-- public.procurement_receipts.procurement_receipts_delete  [true FOR DELETE TO PUBLIC]
alter policy procurement_receipts_delete on public.procurement_receipts
  using (
    ((org_id = auth_org_id()) AND is_active_member() AND (auth_role() = ANY (ARRAY['Admin'::user_role, 'Executive'::user_role, 'Project Manager'::user_role, 'Finance'::user_role])) AND (EXISTS ( SELECT 1
   FROM procurements p
  WHERE ((p.id = procurement_receipts.procurement_id) AND (p.org_id = auth_org_id())))) AND (NOT domain_externally_owned(auth_org_id(), 'procurement'::text)) AND org_feature_enabled(auth_org_id(), 'procurement'::text))
  );

-- public.procurement_receipts.procurement_receipts_insert  [true FOR INSERT TO PUBLIC]
alter policy procurement_receipts_insert on public.procurement_receipts
  with check (
    ((org_id = auth_org_id()) AND is_active_member() AND (auth_role() = ANY (ARRAY['Admin'::user_role, 'Executive'::user_role, 'Project Manager'::user_role, 'Finance'::user_role])) AND (EXISTS ( SELECT 1
   FROM procurements p
  WHERE ((p.id = procurement_receipts.procurement_id) AND (p.org_id = auth_org_id())))) AND (NOT domain_externally_owned(auth_org_id(), 'procurement'::text)) AND org_feature_enabled(auth_org_id(), 'procurement'::text))
  );

-- public.procurement_receipts.procurement_receipts_select  [true FOR SELECT TO PUBLIC]
alter policy procurement_receipts_select on public.procurement_receipts
  using (
    ((org_id = auth_org_id()) AND is_active_member())
  );

-- public.procurement_receipts.procurement_receipts_update  [true FOR UPDATE TO PUBLIC]
alter policy procurement_receipts_update on public.procurement_receipts
  using (
    ((org_id = auth_org_id()) AND is_active_member() AND (auth_role() = ANY (ARRAY['Admin'::user_role, 'Executive'::user_role, 'Project Manager'::user_role, 'Finance'::user_role])) AND (EXISTS ( SELECT 1
   FROM procurements p
  WHERE ((p.id = procurement_receipts.procurement_id) AND (p.org_id = auth_org_id())))) AND org_feature_enabled(auth_org_id(), 'procurement'::text))
  )
  with check (
    ((org_id = auth_org_id()) AND is_active_member() AND (auth_role() = ANY (ARRAY['Admin'::user_role, 'Executive'::user_role, 'Project Manager'::user_role, 'Finance'::user_role])) AND (EXISTS ( SELECT 1
   FROM procurements p
  WHERE ((p.id = procurement_receipts.procurement_id) AND (p.org_id = auth_org_id())))) AND org_feature_enabled(auth_org_id(), 'procurement'::text))
  );

-- public.procurement_status_events.procurement_status_events_read  [true FOR SELECT TO PUBLIC]
alter policy procurement_status_events_read on public.procurement_status_events
  using (
    ((org_id = auth_org_id()) AND is_active_member())
  );

-- public.procurements.procurements_insert  [true FOR INSERT TO PUBLIC]
alter policy procurements_insert on public.procurements
  with check (
    ((org_id = auth_org_id()) AND is_active_member() AND org_feature_enabled(auth_org_id(), 'procurement'::text))
  );

-- public.procurements.procurements_insert_self_requester  [false FOR INSERT TO PUBLIC]
alter policy procurements_insert_self_requester on public.procurements
  with check (
    ((requested_by_id = auth.uid()) AND is_active_member() AND org_feature_enabled(auth_org_id(), 'procurement'::text))
  );

-- public.procurements.procurements_select  [true FOR SELECT TO PUBLIC]
alter policy procurements_select on public.procurements
  using (
    ((org_id = auth_org_id()) AND is_active_member())
  );

-- public.procurements.procurements_update  [true FOR UPDATE TO PUBLIC]
alter policy procurements_update on public.procurements
  using (
    ((org_id = auth_org_id()) AND (auth_role() = ANY (ARRAY['Admin'::user_role, 'Executive'::user_role, 'Project Manager'::user_role, 'Finance'::user_role])) AND is_active_member() AND org_feature_enabled(auth_org_id(), 'procurement'::text))
  )
  with check (
    ((org_id = auth_org_id()) AND is_active_member() AND org_feature_enabled(auth_org_id(), 'procurement'::text))
  );

-- public.progress_assessment_quantities.progress_assessment_quantities_delete  [true FOR DELETE TO PUBLIC]
alter policy progress_assessment_quantities_delete on public.progress_assessment_quantities
  using (
    ((org_id = auth_org_id()) AND is_active_member() AND progress_assessment_line_ok(entry_id, boq_item_id) AND org_feature_enabled(auth_org_id(), 'sales_invoices'::text))
  );

-- public.progress_assessment_quantities.progress_assessment_quantities_insert  [true FOR INSERT TO PUBLIC]
alter policy progress_assessment_quantities_insert on public.progress_assessment_quantities
  with check (
    ((org_id = auth_org_id()) AND is_active_member() AND progress_assessment_line_ok(entry_id, boq_item_id) AND org_feature_enabled(auth_org_id(), 'sales_invoices'::text))
  );

-- public.progress_assessment_quantities.progress_assessment_quantities_select  [true FOR SELECT TO PUBLIC]
alter policy progress_assessment_quantities_select on public.progress_assessment_quantities
  using (
    ((org_id = auth_org_id()) AND is_active_member())
  );

-- public.progress_assessment_quantities.progress_assessment_quantities_update  [true FOR UPDATE TO PUBLIC]
alter policy progress_assessment_quantities_update on public.progress_assessment_quantities
  using (
    ((org_id = auth_org_id()) AND is_active_member() AND progress_assessment_line_ok(entry_id, boq_item_id) AND org_feature_enabled(auth_org_id(), 'sales_invoices'::text))
  )
  with check (
    ((org_id = auth_org_id()) AND is_active_member() AND progress_assessment_line_ok(entry_id, boq_item_id) AND org_feature_enabled(auth_org_id(), 'sales_invoices'::text))
  );

-- public.progress_claim_evidence.progress_claim_evidence_select  [true FOR SELECT TO PUBLIC]
alter policy progress_claim_evidence_select on public.progress_claim_evidence
  using (
    ((org_id = auth_org_id()) AND is_active_member())
  );

-- public.progress_claim_lines.progress_claim_lines_select  [true FOR SELECT TO PUBLIC]
alter policy progress_claim_lines_select on public.progress_claim_lines
  using (
    ((org_id = auth_org_id()) AND is_active_member())
  );

-- public.progress_claims.progress_claims_select  [true FOR SELECT TO PUBLIC]
alter policy progress_claims_select on public.progress_claims
  using (
    ((org_id = auth_org_id()) AND is_active_member())
  );

-- public.project_documents.project_documents_delete_admin_only  [false FOR DELETE TO PUBLIC]
alter policy project_documents_delete_admin_only on public.project_documents
  using (
    ((auth_role() = 'Admin'::user_role) AND is_active_member())
  );

-- public.project_documents.project_documents_select  [true FOR SELECT TO PUBLIC]
alter policy project_documents_select on public.project_documents
  using (
    ((org_id = auth_org_id()) AND is_active_member())
  );

-- public.project_documents.project_documents_write  [true FOR ALL TO PUBLIC]
alter policy project_documents_write on public.project_documents
  using (
    ((org_id = auth_org_id()) AND (auth_role() = ANY (ARRAY['Admin'::user_role, 'Executive'::user_role, 'Project Manager'::user_role, 'Finance'::user_role])) AND (EXISTS ( SELECT 1
   FROM projects p
  WHERE ((p.id = project_documents.project_id) AND (p.org_id = auth_org_id())))) AND is_active_member())
  )
  with check (
    ((org_id = auth_org_id()) AND (auth_role() = ANY (ARRAY['Admin'::user_role, 'Executive'::user_role, 'Project Manager'::user_role, 'Finance'::user_role])) AND (EXISTS ( SELECT 1
   FROM projects p
  WHERE ((p.id = project_documents.project_id) AND (p.org_id = auth_org_id())))) AND is_active_member())
  );

-- public.project_milestones.project_milestones_select  [true FOR SELECT TO PUBLIC]
alter policy project_milestones_select on public.project_milestones
  using (
    ((org_id = auth_org_id()) AND is_active_member())
  );

-- public.project_milestones.project_milestones_write  [true FOR ALL TO PUBLIC]
alter policy project_milestones_write on public.project_milestones
  using (
    ((org_id = auth_org_id()) AND (auth_role() = ANY (ARRAY['Admin'::user_role, 'Project Manager'::user_role])) AND (EXISTS ( SELECT 1
   FROM projects p
  WHERE ((p.id = project_milestones.project_id) AND (p.org_id = auth_org_id())))) AND is_active_member())
  )
  with check (
    ((org_id = auth_org_id()) AND (auth_role() = ANY (ARRAY['Admin'::user_role, 'Project Manager'::user_role])) AND (EXISTS ( SELECT 1
   FROM projects p
  WHERE ((p.id = project_milestones.project_id) AND (p.org_id = auth_org_id())))) AND is_active_member())
  );

-- public.project_progress_entries.project_progress_entries_insert  [true FOR INSERT TO PUBLIC]
alter policy project_progress_entries_insert on public.project_progress_entries
  with check (
    ((org_id = auth_org_id()) AND is_active_member() AND may_record_project_progress(project_id) AND org_feature_enabled(auth_org_id(), 'management_pack'::text))
  );

-- public.project_progress_entries.project_progress_entries_select  [true FOR SELECT TO PUBLIC]
alter policy project_progress_entries_select on public.project_progress_entries
  using (
    ((org_id = auth_org_id()) AND is_active_member())
  );

-- public.project_progress_entries.project_progress_entries_update  [true FOR UPDATE TO PUBLIC]
alter policy project_progress_entries_update on public.project_progress_entries
  using (
    ((org_id = auth_org_id()) AND is_active_member() AND may_record_project_progress(project_id) AND org_feature_enabled(auth_org_id(), 'management_pack'::text))
  )
  with check (
    ((org_id = auth_org_id()) AND is_active_member() AND may_record_project_progress(project_id) AND org_feature_enabled(auth_org_id(), 'management_pack'::text))
  );

-- public.project_stage_entries.project_stage_entries_select  [true FOR SELECT TO authenticated]
alter policy project_stage_entries_select on public.project_stage_entries
  using (
    ((org_id = auth_org_id()) AND is_active_member() AND (EXISTS ( SELECT 1
   FROM projects p
  WHERE (p.id = project_stage_entries.project_id))))
  );

-- public.projects.projects_delete_admin_only  [false FOR DELETE TO PUBLIC]
alter policy projects_delete_admin_only on public.projects
  using (
    ((auth_role() = 'Admin'::user_role) AND is_active_member())
  );

-- public.projects.projects_select  [true FOR SELECT TO PUBLIC]
alter policy projects_select on public.projects
  using (
    ((org_id = auth_org_id()) AND is_active_member())
  );

-- public.projects.projects_write  [true FOR ALL TO PUBLIC]
alter policy projects_write on public.projects
  using (
    ((org_id = auth_org_id()) AND (auth_role() = ANY (ARRAY['Admin'::user_role, 'Executive'::user_role, 'Project Manager'::user_role, 'Finance'::user_role])) AND is_active_member())
  )
  with check (
    ((org_id = auth_org_id()) AND (auth_role() = ANY (ARRAY['Admin'::user_role, 'Executive'::user_role, 'Project Manager'::user_role, 'Finance'::user_role])) AND is_active_member())
  );

-- public.purchase_order_files.purchase_order_files_delete_admin_only  [false FOR DELETE TO PUBLIC]
alter policy purchase_order_files_delete_admin_only on public.purchase_order_files
  using (
    ((auth_role() = 'Admin'::user_role) AND is_active_member() AND org_feature_enabled(auth_org_id(), 'procurement'::text))
  );

-- public.purchase_order_files.purchase_order_files_select  [true FOR SELECT TO PUBLIC]
alter policy purchase_order_files_select on public.purchase_order_files
  using (
    ((org_id = auth_org_id()) AND is_active_member())
  );

-- public.purchase_order_files.purchase_order_files_write  [true FOR ALL TO PUBLIC]
alter policy purchase_order_files_write on public.purchase_order_files
  using (
    ((org_id = auth_org_id()) AND (auth_role() = ANY (ARRAY['Admin'::user_role, 'Executive'::user_role, 'Project Manager'::user_role, 'Finance'::user_role])) AND (EXISTS ( SELECT 1
   FROM purchase_orders r
  WHERE ((r.id = purchase_order_files.purchase_order_id) AND (r.org_id = auth_org_id())))) AND is_active_member() AND org_feature_enabled(auth_org_id(), 'procurement'::text))
  )
  with check (
    ((org_id = auth_org_id()) AND (auth_role() = ANY (ARRAY['Admin'::user_role, 'Executive'::user_role, 'Project Manager'::user_role, 'Finance'::user_role])) AND (EXISTS ( SELECT 1
   FROM purchase_orders r
  WHERE ((r.id = purchase_order_files.purchase_order_id) AND (r.org_id = auth_org_id())))) AND is_active_member() AND org_feature_enabled(auth_org_id(), 'procurement'::text))
  );

-- public.purchase_order_lines.purchase_order_lines_read  [true FOR SELECT TO PUBLIC]
alter policy purchase_order_lines_read on public.purchase_order_lines
  using (
    ((org_id = auth_org_id()) AND is_active_member() AND (EXISTS ( SELECT 1
   FROM purchase_orders po
  WHERE (po.id = purchase_order_lines.po_id))))
  );

-- public.purchase_order_revisions.purchase_order_revisions_read  [true FOR SELECT TO PUBLIC]
alter policy purchase_order_revisions_read on public.purchase_order_revisions
  using (
    ((org_id = auth_org_id()) AND is_active_member() AND (EXISTS ( SELECT 1
   FROM purchase_orders po
  WHERE (po.id = purchase_order_revisions.po_id))))
  );

-- public.purchase_orders.purchase_orders_delete  [true FOR DELETE TO PUBLIC]
alter policy purchase_orders_delete on public.purchase_orders
  using (
    ((org_id = auth_org_id()) AND is_active_member() AND (auth_role() = ANY (ARRAY['Admin'::user_role, 'Executive'::user_role, 'Project Manager'::user_role, 'Finance'::user_role])) AND (EXISTS ( SELECT 1
   FROM procurements p
  WHERE ((p.id = purchase_orders.procurement_id) AND (p.org_id = auth_org_id())))) AND (NOT domain_externally_owned(auth_org_id(), 'procurement'::text)) AND org_feature_enabled(auth_org_id(), 'procurement'::text))
  );

-- public.purchase_orders.purchase_orders_insert  [true FOR INSERT TO PUBLIC]
alter policy purchase_orders_insert on public.purchase_orders
  with check (
    ((org_id = auth_org_id()) AND is_active_member() AND (auth_role() = ANY (ARRAY['Admin'::user_role, 'Executive'::user_role, 'Project Manager'::user_role, 'Finance'::user_role])) AND (EXISTS ( SELECT 1
   FROM procurements p
  WHERE ((p.id = purchase_orders.procurement_id) AND (p.org_id = auth_org_id())))) AND (NOT domain_externally_owned(auth_org_id(), 'procurement'::text)) AND org_feature_enabled(auth_org_id(), 'procurement'::text))
  );

-- public.purchase_orders.purchase_orders_select  [true FOR SELECT TO PUBLIC]
alter policy purchase_orders_select on public.purchase_orders
  using (
    ((org_id = auth_org_id()) AND is_active_member())
  );

-- public.purchase_orders.purchase_orders_update  [true FOR UPDATE TO PUBLIC]
alter policy purchase_orders_update on public.purchase_orders
  using (
    ((org_id = auth_org_id()) AND is_active_member() AND (auth_role() = ANY (ARRAY['Admin'::user_role, 'Executive'::user_role, 'Project Manager'::user_role, 'Finance'::user_role])) AND (EXISTS ( SELECT 1
   FROM procurements p
  WHERE ((p.id = purchase_orders.procurement_id) AND (p.org_id = auth_org_id())))) AND org_feature_enabled(auth_org_id(), 'procurement'::text))
  )
  with check (
    ((org_id = auth_org_id()) AND is_active_member() AND (auth_role() = ANY (ARRAY['Admin'::user_role, 'Executive'::user_role, 'Project Manager'::user_role, 'Finance'::user_role])) AND (EXISTS ( SELECT 1
   FROM procurements p
  WHERE ((p.id = purchase_orders.procurement_id) AND (p.org_id = auth_org_id())))) AND org_feature_enabled(auth_org_id(), 'procurement'::text))
  );

-- public.purchase_request_files.purchase_request_files_delete_admin_only  [false FOR DELETE TO PUBLIC]
alter policy purchase_request_files_delete_admin_only on public.purchase_request_files
  using (
    ((auth_role() = 'Admin'::user_role) AND is_active_member() AND org_feature_enabled(auth_org_id(), 'procurement'::text))
  );

-- public.purchase_request_files.purchase_request_files_select  [true FOR SELECT TO PUBLIC]
alter policy purchase_request_files_select on public.purchase_request_files
  using (
    ((org_id = auth_org_id()) AND is_active_member())
  );

-- public.purchase_request_files.purchase_request_files_write  [true FOR ALL TO PUBLIC]
alter policy purchase_request_files_write on public.purchase_request_files
  using (
    ((org_id = auth_org_id()) AND (auth_role() = ANY (ARRAY['Admin'::user_role, 'Executive'::user_role, 'Project Manager'::user_role, 'Finance'::user_role])) AND (EXISTS ( SELECT 1
   FROM purchase_requests r
  WHERE ((r.id = purchase_request_files.purchase_request_id) AND (r.org_id = auth_org_id())))) AND is_active_member() AND org_feature_enabled(auth_org_id(), 'procurement'::text))
  )
  with check (
    ((org_id = auth_org_id()) AND (auth_role() = ANY (ARRAY['Admin'::user_role, 'Executive'::user_role, 'Project Manager'::user_role, 'Finance'::user_role])) AND (EXISTS ( SELECT 1
   FROM purchase_requests r
  WHERE ((r.id = purchase_request_files.purchase_request_id) AND (r.org_id = auth_org_id())))) AND is_active_member() AND org_feature_enabled(auth_org_id(), 'procurement'::text))
  );

-- public.purchase_requests.purchase_requests_select  [true FOR SELECT TO PUBLIC]
alter policy purchase_requests_select on public.purchase_requests
  using (
    ((org_id = auth_org_id()) AND is_active_member())
  );

-- public.purchase_requests.purchase_requests_write  [true FOR ALL TO PUBLIC]
alter policy purchase_requests_write on public.purchase_requests
  using (
    ((org_id = auth_org_id()) AND (auth_role() = ANY (ARRAY['Admin'::user_role, 'Executive'::user_role, 'Project Manager'::user_role, 'Finance'::user_role])) AND (EXISTS ( SELECT 1
   FROM procurements p
  WHERE ((p.id = purchase_requests.procurement_id) AND (p.org_id = auth_org_id())))) AND is_active_member() AND org_feature_enabled(auth_org_id(), 'procurement'::text))
  )
  with check (
    ((org_id = auth_org_id()) AND (auth_role() = ANY (ARRAY['Admin'::user_role, 'Executive'::user_role, 'Project Manager'::user_role, 'Finance'::user_role])) AND (EXISTS ( SELECT 1
   FROM procurements p
  WHERE ((p.id = purchase_requests.procurement_id) AND (p.org_id = auth_org_id())))) AND is_active_member() AND org_feature_enabled(auth_org_id(), 'procurement'::text))
  );

-- public.record_changes.record_changes_select  [true FOR SELECT TO authenticated]
alter policy record_changes_select on public.record_changes
  using (
    ((org_id = auth_org_id()) AND is_active_member() AND record_history_visible(entity_type, entity_id))
  );

-- public.rfq_files.rfq_files_delete_admin_only  [false FOR DELETE TO PUBLIC]
alter policy rfq_files_delete_admin_only on public.rfq_files
  using (
    ((auth_role() = 'Admin'::user_role) AND is_active_member() AND org_feature_enabled(auth_org_id(), 'procurement'::text))
  );

-- public.rfq_files.rfq_files_select  [true FOR SELECT TO PUBLIC]
alter policy rfq_files_select on public.rfq_files
  using (
    ((org_id = auth_org_id()) AND is_active_member())
  );

-- public.rfq_files.rfq_files_write  [true FOR ALL TO PUBLIC]
alter policy rfq_files_write on public.rfq_files
  using (
    ((org_id = auth_org_id()) AND (auth_role() = ANY (ARRAY['Admin'::user_role, 'Executive'::user_role, 'Project Manager'::user_role, 'Finance'::user_role])) AND (EXISTS ( SELECT 1
   FROM rfqs r
  WHERE ((r.id = rfq_files.rfq_id) AND (r.org_id = auth_org_id())))) AND is_active_member() AND org_feature_enabled(auth_org_id(), 'procurement'::text))
  )
  with check (
    ((org_id = auth_org_id()) AND (auth_role() = ANY (ARRAY['Admin'::user_role, 'Executive'::user_role, 'Project Manager'::user_role, 'Finance'::user_role])) AND (EXISTS ( SELECT 1
   FROM rfqs r
  WHERE ((r.id = rfq_files.rfq_id) AND (r.org_id = auth_org_id())))) AND is_active_member() AND org_feature_enabled(auth_org_id(), 'procurement'::text))
  );

-- public.rfqs.rfqs_select  [true FOR SELECT TO PUBLIC]
alter policy rfqs_select on public.rfqs
  using (
    ((org_id = auth_org_id()) AND is_active_member())
  );

-- public.rfqs.rfqs_write  [true FOR ALL TO PUBLIC]
alter policy rfqs_write on public.rfqs
  using (
    ((org_id = auth_org_id()) AND (auth_role() = ANY (ARRAY['Admin'::user_role, 'Executive'::user_role, 'Project Manager'::user_role, 'Finance'::user_role])) AND (EXISTS ( SELECT 1
   FROM procurements p
  WHERE ((p.id = rfqs.procurement_id) AND (p.org_id = auth_org_id())))) AND is_active_member() AND org_feature_enabled(auth_org_id(), 'procurement'::text))
  )
  with check (
    ((org_id = auth_org_id()) AND (auth_role() = ANY (ARRAY['Admin'::user_role, 'Executive'::user_role, 'Project Manager'::user_role, 'Finance'::user_role])) AND (EXISTS ( SELECT 1
   FROM procurements p
  WHERE ((p.id = rfqs.procurement_id) AND (p.org_id = auth_org_id())))) AND is_active_member() AND org_feature_enabled(auth_org_id(), 'procurement'::text))
  );

-- public.sales_invoice_authors.sales_invoice_authors_select  [true FOR SELECT TO PUBLIC]
alter policy sales_invoice_authors_select on public.sales_invoice_authors
  using (
    ((org_id = auth_org_id()) AND is_active_member())
  );

-- public.sales_invoice_submit_authorizations.sales_invoice_submit_authorizations_select  [true FOR SELECT TO PUBLIC]
alter policy sales_invoice_submit_authorizations_select on public.sales_invoice_submit_authorizations
  using (
    ((org_id = auth_org_id()) AND is_active_member())
  );

-- public.sales_invoices.sales_invoices_delete  [true FOR DELETE TO PUBLIC]
alter policy sales_invoices_delete on public.sales_invoices
  using (
    ((org_id = auth_org_id()) AND is_active_member() AND (auth_role() = ANY (ARRAY['Admin'::user_role, 'Finance'::user_role])) AND (NOT domain_externally_owned(auth_org_id(), 'revenue'::text)) AND org_feature_enabled(auth_org_id(), 'sales_invoices'::text))
  );

-- public.sales_invoices.sales_invoices_insert  [true FOR INSERT TO PUBLIC]
alter policy sales_invoices_insert on public.sales_invoices
  with check (
    ((org_id = auth_org_id()) AND is_active_member() AND (auth_role() = ANY (ARRAY['Admin'::user_role, 'Finance'::user_role])) AND (NOT domain_externally_owned(auth_org_id(), 'revenue'::text)) AND org_feature_enabled(auth_org_id(), 'sales_invoices'::text))
  );

-- public.sales_invoices.sales_invoices_select  [true FOR SELECT TO PUBLIC]
alter policy sales_invoices_select on public.sales_invoices
  using (
    ((org_id = auth_org_id()) AND is_active_member())
  );

-- public.sales_invoices.sales_invoices_update  [true FOR UPDATE TO PUBLIC]
alter policy sales_invoices_update on public.sales_invoices
  using (
    ((org_id = auth_org_id()) AND is_active_member() AND (auth_role() = ANY (ARRAY['Admin'::user_role, 'Finance'::user_role])) AND org_feature_enabled(auth_org_id(), 'sales_invoices'::text))
  )
  with check (
    ((org_id = auth_org_id()) AND is_active_member() AND (auth_role() = ANY (ARRAY['Admin'::user_role, 'Finance'::user_role])) AND org_feature_enabled(auth_org_id(), 'sales_invoices'::text))
  );

-- public.spend_approvers.spend_approvers_delete  [true FOR DELETE TO PUBLIC]
alter policy spend_approvers_delete on public.spend_approvers
  using (
    ((org_id = auth_org_id()) AND is_active_member() AND (auth_role() = 'Admin'::user_role))
  );

-- public.spend_approvers.spend_approvers_insert  [true FOR INSERT TO PUBLIC]
alter policy spend_approvers_insert on public.spend_approvers
  with check (
    ((org_id = auth_org_id()) AND is_active_member() AND (auth_role() = 'Admin'::user_role) AND (EXISTS ( SELECT 1
   FROM profiles pf
  WHERE ((pf.id = spend_approvers.profile_id) AND (pf.org_id = auth_org_id()) AND (pf.status = 'active'::profile_status) AND holds_spend_approval_authority(pf.role)))) AND ((project_id IS NULL) OR (EXISTS ( SELECT 1
   FROM projects p
  WHERE ((p.id = spend_approvers.project_id) AND (p.org_id = auth_org_id()))))))
  );

-- public.spend_approvers.spend_approvers_select  [true FOR SELECT TO PUBLIC]
alter policy spend_approvers_select on public.spend_approvers
  using (
    ((org_id = auth_org_id()) AND is_active_member())
  );

-- public.stock_document_lines.stock_document_lines_select  [true FOR SELECT TO PUBLIC]
alter policy stock_document_lines_select on public.stock_document_lines
  using (
    ((org_id = auth_org_id()) AND is_active_member())
  );

-- public.stock_documents.stock_documents_select  [true FOR SELECT TO PUBLIC]
alter policy stock_documents_select on public.stock_documents
  using (
    ((org_id = auth_org_id()) AND is_active_member())
  );

-- public.stock_items.stock_items_delete  [true FOR DELETE TO PUBLIC]
alter policy stock_items_delete on public.stock_items
  using (
    ((org_id = auth_org_id()) AND is_active_member() AND stock_admin() AND org_feature_enabled(auth_org_id(), 'stock'::text))
  );

-- public.stock_items.stock_items_insert  [true FOR INSERT TO PUBLIC]
alter policy stock_items_insert on public.stock_items
  with check (
    ((org_id = auth_org_id()) AND is_active_member() AND stock_master_writer() AND org_feature_enabled(auth_org_id(), 'stock'::text))
  );

-- public.stock_items.stock_items_select  [true FOR SELECT TO PUBLIC]
alter policy stock_items_select on public.stock_items
  using (
    ((org_id = auth_org_id()) AND is_active_member())
  );

-- public.stock_items.stock_items_update  [true FOR UPDATE TO PUBLIC]
alter policy stock_items_update on public.stock_items
  using (
    ((org_id = auth_org_id()) AND is_active_member() AND stock_master_writer() AND org_feature_enabled(auth_org_id(), 'stock'::text))
  )
  with check (
    ((org_id = auth_org_id()) AND is_active_member() AND stock_master_writer() AND org_feature_enabled(auth_org_id(), 'stock'::text))
  );

-- public.stock_reorder_levels.stock_reorder_levels_select  [true FOR SELECT TO PUBLIC]
alter policy stock_reorder_levels_select on public.stock_reorder_levels
  using (
    ((org_id = auth_org_id()) AND is_active_member())
  );

-- public.stock_units.stock_units_delete  [true FOR DELETE TO PUBLIC]
alter policy stock_units_delete on public.stock_units
  using (
    ((org_id = auth_org_id()) AND is_active_member() AND stock_admin() AND org_feature_enabled(auth_org_id(), 'stock'::text))
  );

-- public.stock_units.stock_units_insert  [true FOR INSERT TO PUBLIC]
alter policy stock_units_insert on public.stock_units
  with check (
    ((org_id = auth_org_id()) AND is_active_member() AND stock_master_writer() AND org_feature_enabled(auth_org_id(), 'stock'::text))
  );

-- public.stock_units.stock_units_select  [true FOR SELECT TO PUBLIC]
alter policy stock_units_select on public.stock_units
  using (
    ((org_id = auth_org_id()) AND is_active_member())
  );

-- public.stock_units.stock_units_update  [true FOR UPDATE TO PUBLIC]
alter policy stock_units_update on public.stock_units
  using (
    ((org_id = auth_org_id()) AND is_active_member() AND stock_master_writer() AND org_feature_enabled(auth_org_id(), 'stock'::text))
  )
  with check (
    ((org_id = auth_org_id()) AND is_active_member() AND stock_master_writer() AND org_feature_enabled(auth_org_id(), 'stock'::text))
  );

-- public.stock_warehouse_keepers.stock_warehouse_keepers_select  [true FOR SELECT TO PUBLIC]
alter policy stock_warehouse_keepers_select on public.stock_warehouse_keepers
  using (
    ((org_id = auth_org_id()) AND is_active_member())
  );

-- public.stock_warehouses.stock_warehouses_delete  [true FOR DELETE TO PUBLIC]
alter policy stock_warehouses_delete on public.stock_warehouses
  using (
    ((org_id = auth_org_id()) AND is_active_member() AND stock_admin() AND org_feature_enabled(auth_org_id(), 'stock'::text))
  );

-- public.stock_warehouses.stock_warehouses_insert  [true FOR INSERT TO PUBLIC]
alter policy stock_warehouses_insert on public.stock_warehouses
  with check (
    ((org_id = auth_org_id()) AND is_active_member() AND stock_master_writer() AND org_feature_enabled(auth_org_id(), 'stock'::text))
  );

-- public.stock_warehouses.stock_warehouses_select  [true FOR SELECT TO PUBLIC]
alter policy stock_warehouses_select on public.stock_warehouses
  using (
    ((org_id = auth_org_id()) AND is_active_member())
  );

-- public.stock_warehouses.stock_warehouses_update  [true FOR UPDATE TO PUBLIC]
alter policy stock_warehouses_update on public.stock_warehouses
  using (
    ((org_id = auth_org_id()) AND is_active_member() AND stock_master_writer() AND org_feature_enabled(auth_org_id(), 'stock'::text))
  )
  with check (
    ((org_id = auth_org_id()) AND is_active_member() AND stock_master_writer() AND org_feature_enabled(auth_org_id(), 'stock'::text))
  );

-- public.subcontract_acceptance_lines.subcontract_acceptance_lines_read  [true FOR SELECT TO PUBLIC]
alter policy subcontract_acceptance_lines_read on public.subcontract_acceptance_lines
  using (
    (EXISTS ( SELECT 1
   FROM subcontract_acceptances a
  WHERE ((a.id = subcontract_acceptance_lines.acceptance_id) AND (a.org_id = auth_org_id()) AND is_active_member())))
  );

-- public.subcontract_acceptances.subcontract_acceptances_read  [true FOR SELECT TO PUBLIC]
alter policy subcontract_acceptances_read on public.subcontract_acceptances
  using (
    ((org_id = auth_org_id()) AND is_active_member() AND (EXISTS ( SELECT 1
   FROM purchase_orders po
  WHERE (po.id = subcontract_acceptances.po_id))))
  );

-- public.task_dependencies.task_dependencies_select  [true FOR SELECT TO PUBLIC]
alter policy task_dependencies_select on public.task_dependencies
  using (
    ((org_id = auth_org_id()) AND is_active_member())
  );

-- public.task_dependencies.task_dependencies_write  [true FOR ALL TO PUBLIC]
alter policy task_dependencies_write on public.task_dependencies
  using (
    ((org_id = auth_org_id()) AND (auth_role() = ANY (ARRAY['Admin'::user_role, 'Executive'::user_role, 'Project Manager'::user_role, 'Finance'::user_role])) AND (EXISTS ( SELECT 1
   FROM tasks t
  WHERE ((t.id = task_dependencies.task_id) AND (t.org_id = auth_org_id())))) AND (EXISTS ( SELECT 1
   FROM tasks t
  WHERE ((t.id = task_dependencies.depends_on_id) AND (t.org_id = auth_org_id())))) AND is_active_member())
  )
  with check (
    ((org_id = auth_org_id()) AND (auth_role() = ANY (ARRAY['Admin'::user_role, 'Executive'::user_role, 'Project Manager'::user_role, 'Finance'::user_role])) AND (EXISTS ( SELECT 1
   FROM tasks t
  WHERE ((t.id = task_dependencies.task_id) AND (t.org_id = auth_org_id())))) AND (EXISTS ( SELECT 1
   FROM tasks t
  WHERE ((t.id = task_dependencies.depends_on_id) AND (t.org_id = auth_org_id())))) AND is_active_member())
  );

-- public.task_reminders.task_reminders_select  [true FOR SELECT TO PUBLIC]
alter policy task_reminders_select on public.task_reminders
  using (
    ((sender_id = auth.uid()) AND (org_id = auth_org_id()) AND is_active_member())
  );

-- public.tasks.tasks_delete  [true FOR DELETE TO PUBLIC]
alter policy tasks_delete on public.tasks
  using (
    ((org_id = auth_org_id()) AND is_active_member() AND (auth_role() = ANY (ARRAY['Admin'::user_role, 'Executive'::user_role, 'Project Manager'::user_role])) AND ((project_id IS NULL) OR (EXISTS ( SELECT 1
   FROM projects p
  WHERE ((p.id = tasks.project_id) AND (p.org_id = auth_org_id()))))) AND (NOT task_domain_externally_owned(project_id)))
  );

-- public.tasks.tasks_insert  [true FOR INSERT TO PUBLIC]
alter policy tasks_insert on public.tasks
  with check (
    ((org_id = auth_org_id()) AND is_active_member() AND (auth_role() = ANY (ARRAY['Admin'::user_role, 'Executive'::user_role, 'Project Manager'::user_role, 'Finance'::user_role, 'Engineer'::user_role])) AND ((project_id IS NULL) OR (EXISTS ( SELECT 1
   FROM projects p
  WHERE ((p.id = tasks.project_id) AND (p.org_id = auth_org_id()))))) AND (NOT task_domain_externally_owned(project_id)))
  );

-- public.tasks.tasks_select  [true FOR SELECT TO PUBLIC]
alter policy tasks_select on public.tasks
  using (
    ((org_id = auth_org_id()) AND is_active_member())
  );

-- public.tasks.tasks_update  [true FOR UPDATE TO PUBLIC]
alter policy tasks_update on public.tasks
  using (
    ((org_id = auth_org_id()) AND is_active_member() AND ((auth_role() = ANY (ARRAY['Admin'::user_role, 'Executive'::user_role, 'Project Manager'::user_role])) OR ((created_by = ( SELECT auth.uid() AS uid)) AND (NOT task_domain_externally_owned(project_id)))) AND ((project_id IS NULL) OR (EXISTS ( SELECT 1
   FROM projects p
  WHERE ((p.id = tasks.project_id) AND (p.org_id = auth_org_id()))))))
  )
  with check (
    ((org_id = auth_org_id()) AND is_active_member() AND ((auth_role() = ANY (ARRAY['Admin'::user_role, 'Executive'::user_role, 'Project Manager'::user_role])) OR ((created_by = ( SELECT auth.uid() AS uid)) AND (NOT task_domain_externally_owned(project_id)))) AND ((project_id IS NULL) OR (EXISTS ( SELECT 1
   FROM projects p
  WHERE ((p.id = tasks.project_id) AND (p.org_id = auth_org_id()))))))
  );

-- public.tasks.tasks_update_own_status  [true FOR UPDATE TO PUBLIC]
alter policy tasks_update_own_status on public.tasks
  using (
    ((org_id = auth_org_id()) AND is_active_member() AND (assignee_id = ( SELECT auth.uid() AS uid)) AND (NOT task_domain_externally_owned(project_id)))
  )
  with check (
    ((org_id = auth_org_id()) AND is_active_member() AND (assignee_id = ( SELECT auth.uid() AS uid)) AND (NOT task_domain_externally_owned(project_id)))
  );

-- public.timesheet_entries.timesheet_entries_select  [true FOR SELECT TO PUBLIC]
alter policy timesheet_entries_select on public.timesheet_entries
  using (
    ((org_id = auth_org_id()) AND (EXISTS ( SELECT 1
   FROM timesheets t
  WHERE ((t.id = timesheet_entries.timesheet_id) AND ((t.user_id = ( SELECT auth.uid() AS uid)) OR (auth_role() = ANY (ARRAY['Admin'::user_role, 'Executive'::user_role, 'Project Manager'::user_role, 'Finance'::user_role])) OR (EXISTS ( SELECT 1
           FROM profiles p
          WHERE ((p.id = t.user_id) AND (p.manager_id = ( SELECT auth.uid() AS uid))))))))) AND is_active_member())
  );

-- public.timesheet_entries.timesheet_entries_write  [true FOR ALL TO PUBLIC]
alter policy timesheet_entries_write on public.timesheet_entries
  using (
    ((org_id = auth_org_id()) AND (auth_role() = ANY (ARRAY['Admin'::user_role, 'Executive'::user_role, 'Project Manager'::user_role, 'Engineer'::user_role])) AND (EXISTS ( SELECT 1
   FROM timesheets t
  WHERE ((t.id = timesheet_entries.timesheet_id) AND (t.user_id = ( SELECT auth.uid() AS uid)) AND (t.status = 'Draft'::timesheet_status)))) AND (EXISTS ( SELECT 1
   FROM projects p
  WHERE ((p.id = timesheet_entries.project_id) AND (p.org_id = auth_org_id())))) AND is_active_member() AND org_feature_enabled(auth_org_id(), 'timesheets'::text))
  )
  with check (
    ((org_id = auth_org_id()) AND (auth_role() = ANY (ARRAY['Admin'::user_role, 'Executive'::user_role, 'Project Manager'::user_role, 'Engineer'::user_role])) AND (EXISTS ( SELECT 1
   FROM timesheets t
  WHERE ((t.id = timesheet_entries.timesheet_id) AND (t.user_id = ( SELECT auth.uid() AS uid)) AND (t.status = 'Draft'::timesheet_status)))) AND (EXISTS ( SELECT 1
   FROM projects p
  WHERE ((p.id = timesheet_entries.project_id) AND (p.org_id = auth_org_id())))) AND is_active_member() AND org_feature_enabled(auth_org_id(), 'timesheets'::text))
  );

-- public.timesheet_erp_mirror.timesheet_erp_mirror_select  [true FOR SELECT TO PUBLIC]
alter policy timesheet_erp_mirror_select on public.timesheet_erp_mirror
  using (
    ((org_id = auth_org_id()) AND (EXISTS ( SELECT 1
   FROM timesheets t
  WHERE ((t.id = timesheet_erp_mirror.timesheet_id) AND (t.org_id = auth_org_id()) AND ((t.user_id = auth.uid()) OR (auth_role() = ANY (ARRAY['Admin'::user_role, 'Executive'::user_role, 'Project Manager'::user_role, 'Finance'::user_role])) OR (EXISTS ( SELECT 1
           FROM profiles p
          WHERE ((p.id = t.user_id) AND (p.manager_id = auth.uid())))))))))
  );

-- public.timesheets.timesheets_insert  [true FOR INSERT TO PUBLIC]
alter policy timesheets_insert on public.timesheets
  with check (
    ((org_id = auth_org_id()) AND (user_id = ( SELECT auth.uid() AS uid)) AND is_active_member() AND org_feature_enabled(auth_org_id(), 'timesheets'::text))
  );

-- public.timesheets.timesheets_select  [true FOR SELECT TO PUBLIC]
alter policy timesheets_select on public.timesheets
  using (
    ((org_id = auth_org_id()) AND ((user_id = ( SELECT auth.uid() AS uid)) OR (auth_role() = ANY (ARRAY['Admin'::user_role, 'Executive'::user_role, 'Project Manager'::user_role, 'Finance'::user_role])) OR (EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = timesheets.user_id) AND (p.manager_id = ( SELECT auth.uid() AS uid)))))) AND is_active_member())
  );

-- public.timesheets.timesheets_update_own  [true FOR UPDATE TO PUBLIC]
alter policy timesheets_update_own on public.timesheets
  using (
    ((org_id = auth_org_id()) AND (user_id = ( SELECT auth.uid() AS uid)) AND (status = 'Draft'::timesheet_status) AND is_active_member() AND org_feature_enabled(auth_org_id(), 'timesheets'::text))
  )
  with check (
    ((org_id = auth_org_id()) AND (user_id = ( SELECT auth.uid() AS uid)) AND (status = 'Draft'::timesheet_status) AND is_active_member() AND org_feature_enabled(auth_org_id(), 'timesheets'::text))
  );

-- public.tm_claim_lines.tm_claim_lines_select  [true FOR SELECT TO PUBLIC]
alter policy tm_claim_lines_select on public.tm_claim_lines
  using (
    ((org_id = auth_org_id()) AND (EXISTS ( SELECT 1
   FROM tm_claims c
  WHERE (c.id = tm_claim_lines.claim_id))))
  );

-- public.tm_claim_sources.tm_claim_sources_select  [true FOR SELECT TO PUBLIC]
alter policy tm_claim_sources_select on public.tm_claim_sources
  using (
    ((org_id = auth_org_id()) AND (EXISTS ( SELECT 1
   FROM tm_claims c
  WHERE (c.id = tm_claim_sources.claim_id))))
  );

-- public.tm_claims.tm_claims_select  [true FOR SELECT TO PUBLIC]
alter policy tm_claims_select on public.tm_claims
  using (
    ((org_id = auth_org_id()) AND is_active_member() AND ((auth_role() = ANY (ARRAY['Admin'::user_role, 'Finance'::user_role, 'Executive'::user_role])) OR ((auth_role() = 'Project Manager'::user_role) AND (EXISTS ( SELECT 1
   FROM projects p
  WHERE ((p.id = tm_claims.project_id) AND (p.org_id = tm_claims.org_id) AND (p.project_manager_id = auth.uid())))))))
  );

-- public.user_views.user_views_delete  [true FOR DELETE TO PUBLIC]
alter policy user_views_delete on public.user_views
  using (
    ((org_id = auth_org_id()) AND ((user_id = auth.uid()) OR (auth_role() = 'Admin'::user_role)) AND is_active_member() AND org_feature_enabled(auth_org_id(), 'user_views'::text))
  );

-- public.user_views.user_views_insert  [true FOR INSERT TO PUBLIC]
alter policy user_views_insert on public.user_views
  with check (
    ((org_id = auth_org_id()) AND (user_id = auth.uid()) AND is_active_member() AND org_feature_enabled(auth_org_id(), 'user_views'::text))
  );

-- public.user_views.user_views_select  [true FOR SELECT TO PUBLIC]
alter policy user_views_select on public.user_views
  using (
    ((org_id = auth_org_id()) AND ((user_id = auth.uid()) OR (scope = 'shared_org'::text)) AND is_active_member())
  );

-- public.user_views.user_views_update  [true FOR UPDATE TO PUBLIC]
alter policy user_views_update on public.user_views
  using (
    ((org_id = auth_org_id()) AND ((user_id = auth.uid()) OR (auth_role() = 'Admin'::user_role)) AND is_active_member() AND org_feature_enabled(auth_org_id(), 'user_views'::text))
  )
  with check (
    ((org_id = auth_org_id()) AND ((user_id = auth.uid()) OR (auth_role() = 'Admin'::user_role)) AND is_active_member() AND org_feature_enabled(auth_org_id(), 'user_views'::text))
  );

-- public.vendor_withholding_slip_bills.vendor_withholding_slip_bills_select  [true FOR SELECT TO authenticated]
alter policy vendor_withholding_slip_bills_select on public.vendor_withholding_slip_bills
  using (
    ((org_id = auth_org_id()) AND is_active_member() AND (EXISTS ( SELECT 1
   FROM procurement_invoices i
  WHERE ((i.id = vendor_withholding_slip_bills.invoice_id) AND (i.org_id = vendor_withholding_slip_bills.org_id)))))
  );

-- public.vendor_withholding_slips.vendor_withholding_slips_select  [true FOR SELECT TO authenticated]
alter policy vendor_withholding_slips_select on public.vendor_withholding_slips
  using (
    ((org_id = auth_org_id()) AND is_active_member() AND (EXISTS ( SELECT 1
   FROM companies c
  WHERE ((c.id = vendor_withholding_slips.vendor_id) AND (c.org_id = vendor_withholding_slips.org_id)))))
  );

-- public.work_order_acceptance_lines.work_order_acceptance_lines_read  [true FOR SELECT TO PUBLIC]
alter policy work_order_acceptance_lines_read on public.work_order_acceptance_lines
  using (
    (EXISTS ( SELECT 1
   FROM work_order_acceptances a
  WHERE ((a.id = work_order_acceptance_lines.acceptance_id) AND (a.org_id = auth_org_id()) AND is_active_member())))
  );

-- public.work_order_acceptances.work_order_acceptances_read  [true FOR SELECT TO PUBLIC]
alter policy work_order_acceptances_read on public.work_order_acceptances
  using (
    ((org_id = auth_org_id()) AND is_active_member())
  );

-- public.work_order_lines.work_order_lines_delete  [true FOR DELETE TO PUBLIC]
alter policy work_order_lines_delete on public.work_order_lines
  using (
    ((org_id = auth_org_id()) AND is_active_member() AND (auth_role() = ANY (ARRAY['Admin'::user_role, 'Executive'::user_role, 'Project Manager'::user_role, 'Finance'::user_role])))
  );

-- public.work_order_lines.work_order_lines_insert  [true FOR INSERT TO PUBLIC]
alter policy work_order_lines_insert on public.work_order_lines
  with check (
    ((org_id = auth_org_id()) AND is_active_member() AND (auth_role() = ANY (ARRAY['Admin'::user_role, 'Executive'::user_role, 'Project Manager'::user_role, 'Finance'::user_role])) AND (EXISTS ( SELECT 1
   FROM ((work_orders w
     JOIN boq_items b ON ((b.project_id = w.project_id)))
     JOIN projects p ON ((p.id = w.project_id)))
  WHERE ((w.id = work_order_lines.work_order_id) AND (b.id = work_order_lines.boq_item_id) AND (w.org_id = auth_org_id()) AND (b.org_id = auth_org_id()) AND (p.org_id = auth_org_id())))))
  );

-- public.work_order_lines.work_order_lines_read  [true FOR SELECT TO PUBLIC]
alter policy work_order_lines_read on public.work_order_lines
  using (
    ((org_id = auth_org_id()) AND is_active_member())
  );

-- public.work_order_lines.work_order_lines_update  [true FOR UPDATE TO PUBLIC]
alter policy work_order_lines_update on public.work_order_lines
  using (
    ((org_id = auth_org_id()) AND is_active_member() AND (auth_role() = ANY (ARRAY['Admin'::user_role, 'Executive'::user_role, 'Project Manager'::user_role, 'Finance'::user_role])))
  )
  with check (
    ((org_id = auth_org_id()) AND is_active_member() AND (auth_role() = ANY (ARRAY['Admin'::user_role, 'Executive'::user_role, 'Project Manager'::user_role, 'Finance'::user_role])))
  );

-- public.work_orders.work_orders_insert  [true FOR INSERT TO PUBLIC]
alter policy work_orders_insert on public.work_orders
  with check (
    ((org_id = auth_org_id()) AND is_active_member() AND (auth_role() = ANY (ARRAY['Admin'::user_role, 'Executive'::user_role, 'Project Manager'::user_role, 'Finance'::user_role])) AND (EXISTS ( SELECT 1
   FROM projects p
  WHERE ((p.id = work_orders.project_id) AND (p.org_id = auth_org_id())))))
  );

-- public.work_orders.work_orders_select  [true FOR SELECT TO PUBLIC]
alter policy work_orders_select on public.work_orders
  using (
    ((org_id = auth_org_id()) AND is_active_member())
  );

-- public.work_orders.work_orders_update  [true FOR UPDATE TO PUBLIC]
alter policy work_orders_update on public.work_orders
  using (
    ((org_id = auth_org_id()) AND is_active_member() AND (auth_role() = ANY (ARRAY['Admin'::user_role, 'Executive'::user_role, 'Project Manager'::user_role, 'Finance'::user_role])))
  )
  with check (
    ((org_id = auth_org_id()) AND is_active_member() AND (auth_role() = ANY (ARRAY['Admin'::user_role, 'Executive'::user_role, 'Project Manager'::user_role, 'Finance'::user_role])) AND (EXISTS ( SELECT 1
   FROM projects p
  WHERE ((p.id = work_orders.project_id) AND (p.org_id = auth_org_id())))))
  );

-- storage.objects.storage_document_author_delete  [false FOR DELETE TO PUBLIC]
alter policy storage_document_author_delete on storage.objects
  using (
    ((bucket_id <> 'project-documents'::text) OR (is_active_member() AND (EXISTS ( SELECT 1
   FROM project_documents pd
  WHERE (((pd.id)::text = split_part(objects.name, '/'::text, 3)) AND (pd.org_id = auth_org_id()) AND ((pd.project_id)::text = split_part(objects.name, '/'::text, 2)) AND ((pd.author_id = auth.uid()) OR (auth_role() = 'Admin'::user_role)))))))
  );

-- storage.objects.storage_document_author_insert  [false FOR INSERT TO PUBLIC]
alter policy storage_document_author_insert on storage.objects
  with check (
    ((bucket_id <> 'project-documents'::text) OR (is_active_member() AND (EXISTS ( SELECT 1
   FROM project_documents pd
  WHERE (((pd.id)::text = split_part(objects.name, '/'::text, 3)) AND (pd.org_id = auth_org_id()) AND ((pd.project_id)::text = split_part(objects.name, '/'::text, 2)) AND ((pd.author_id = auth.uid()) OR (auth_role() = 'Admin'::user_role)))))))
  );

-- storage.objects.storage_document_author_update  [false FOR UPDATE TO PUBLIC]
alter policy storage_document_author_update on storage.objects
  using (
    ((bucket_id <> 'project-documents'::text) OR (is_active_member() AND (EXISTS ( SELECT 1
   FROM project_documents pd
  WHERE (((pd.id)::text = split_part(objects.name, '/'::text, 3)) AND (pd.org_id = auth_org_id()) AND ((pd.project_id)::text = split_part(objects.name, '/'::text, 2)) AND ((pd.author_id = auth.uid()) OR (auth_role() = 'Admin'::user_role)))))))
  )
  with check (
    ((bucket_id <> 'project-documents'::text) OR (is_active_member() AND (EXISTS ( SELECT 1
   FROM project_documents pd
  WHERE (((pd.id)::text = split_part(objects.name, '/'::text, 3)) AND (pd.org_id = auth_org_id()) AND ((pd.project_id)::text = split_part(objects.name, '/'::text, 2)) AND ((pd.author_id = auth.uid()) OR (auth_role() = 'Admin'::user_role)))))))
  );

-- storage.objects.storage_objects_agent_attachments_read  [true FOR SELECT TO PUBLIC]
alter policy storage_objects_agent_attachments_read on storage.objects
  using (
    ((bucket_id = 'agent-attachments'::text) AND (auth.uid() IS NOT NULL) AND (split_part(name, '/'::text, 1) = 'org'::text) AND (split_part(name, '/'::text, 2) = (auth_org_id())::text) AND (split_part(name, '/'::text, 3) = 'agent-attachments'::text) AND (array_length(string_to_array(name, '/'::text), 1) = 4) AND (EXISTS ( SELECT 1
   FROM agent_attachments aa
  WHERE (((aa.id)::text = split_part(objects.name, '/'::text, 4)) AND (aa.owner_id = auth.uid()) AND (aa.org_id = auth_org_id()) AND (aa.storage_path = objects.name)))))
  );

-- storage.objects.storage_objects_agent_attachments_write  [true FOR ALL TO PUBLIC]
alter policy storage_objects_agent_attachments_write on storage.objects
  using (
    ((bucket_id = 'agent-attachments'::text) AND (auth.uid() IS NOT NULL) AND (split_part(name, '/'::text, 1) = 'org'::text) AND (split_part(name, '/'::text, 2) = (auth_org_id())::text) AND (split_part(name, '/'::text, 3) = 'agent-attachments'::text) AND (array_length(string_to_array(name, '/'::text), 1) = 4) AND (EXISTS ( SELECT 1
   FROM agent_attachments aa
  WHERE (((aa.id)::text = split_part(objects.name, '/'::text, 4)) AND (aa.owner_id = auth.uid()) AND (aa.org_id = auth_org_id()) AND (aa.storage_path = objects.name)))))
  )
  with check (
    ((bucket_id = 'agent-attachments'::text) AND (auth.uid() IS NOT NULL) AND (split_part(name, '/'::text, 1) = 'org'::text) AND (split_part(name, '/'::text, 2) = (auth_org_id())::text) AND (split_part(name, '/'::text, 3) = 'agent-attachments'::text) AND (array_length(string_to_array(name, '/'::text), 1) = 4) AND (EXISTS ( SELECT 1
   FROM agent_attachments aa
  WHERE (((aa.id)::text = split_part(objects.name, '/'::text, 4)) AND (aa.owner_id = auth.uid()) AND (aa.org_id = auth_org_id()) AND (aa.storage_path = objects.name)))))
  );

-- storage.objects.storage_objects_expense_receipt_read  [true FOR SELECT TO authenticated]
alter policy storage_objects_expense_receipt_read on storage.objects
  using (
    ((bucket_id = 'expense-receipts'::text) AND (auth.uid() IS NOT NULL) AND (split_part(name, '/'::text, 1) = (auth_org_id())::text) AND (array_length(string_to_array(name, '/'::text), 1) = 4) AND (EXISTS ( SELECT 1
   FROM expense_claims c
  WHERE ((c.id)::text = split_part(objects.name, '/'::text, 2)))))
  );

-- storage.objects.storage_objects_expense_receipt_write  [true FOR ALL TO authenticated]
alter policy storage_objects_expense_receipt_write on storage.objects
  using (
    ((bucket_id = 'expense-receipts'::text) AND (auth.uid() IS NOT NULL) AND (split_part(name, '/'::text, 1) = (auth_org_id())::text) AND (array_length(string_to_array(name, '/'::text), 1) = 4) AND (EXISTS ( SELECT 1
   FROM expense_claims c
  WHERE (((c.id)::text = split_part(objects.name, '/'::text, 2)) AND (c.org_id = auth_org_id()) AND (c.claimant_id = auth.uid()) AND (c.status = ANY (ARRAY['Draft'::expense_claim_status, 'Rejected'::expense_claim_status]))))))
  )
  with check (
    ((bucket_id = 'expense-receipts'::text) AND (auth.uid() IS NOT NULL) AND (split_part(name, '/'::text, 1) = (auth_org_id())::text) AND (array_length(string_to_array(name, '/'::text), 1) = 4) AND (EXISTS ( SELECT 1
   FROM expense_claims c
  WHERE (((c.id)::text = split_part(objects.name, '/'::text, 2)) AND (c.org_id = auth_org_id()) AND (c.claimant_id = auth.uid()) AND (c.status = ANY (ARRAY['Draft'::expense_claim_status, 'Rejected'::expense_claim_status]))))))
  );

-- storage.objects.storage_objects_proc_file_delete  [true FOR DELETE TO PUBLIC]
alter policy storage_objects_proc_file_delete on storage.objects
  using (
    ((bucket_id = 'procurement-files'::text) AND (auth.uid() IS NOT NULL) AND (split_part(name, '/'::text, 1) = (auth_org_id())::text) AND (auth_role() = 'Admin'::user_role) AND (NOT (EXISTS ( SELECT 1
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
  WHERE (f.file_path = objects.name)))))
  );

-- storage.objects.storage_objects_proc_file_insert  [true FOR INSERT TO PUBLIC]
alter policy storage_objects_proc_file_insert on storage.objects
  with check (
    ((bucket_id = 'procurement-files'::text) AND (auth.uid() IS NOT NULL) AND (split_part(name, '/'::text, 1) = (auth_org_id())::text) AND (array_length(string_to_array(name, '/'::text), 1) = 5) AND (auth_role() = ANY (ARRAY['Admin'::user_role, 'Executive'::user_role, 'Project Manager'::user_role, 'Finance'::user_role])) AND (EXISTS ( SELECT 1
   FROM procurements p
  WHERE (((p.id)::text = split_part(objects.name, '/'::text, 2)) AND (p.org_id = auth_org_id())))))
  );

-- storage.objects.storage_objects_proc_file_read  [true FOR SELECT TO PUBLIC]
alter policy storage_objects_proc_file_read on storage.objects
  using (
    ((bucket_id = 'procurement-files'::text) AND (auth.uid() IS NOT NULL) AND (split_part(name, '/'::text, 1) = (auth_org_id())::text) AND (array_length(string_to_array(name, '/'::text), 1) = 5) AND is_active_member() AND ((auth_role() = ANY (ARRAY['Admin'::user_role, 'Executive'::user_role, 'Project Manager'::user_role, 'Finance'::user_role])) OR ((split_part(name, '/'::text, 3) <> ALL (ARRAY['invoice'::text, 'payment'::text])) AND (EXISTS ( SELECT 1
   FROM procurements p
  WHERE (((p.id)::text = split_part(objects.name, '/'::text, 2)) AND (p.requested_by_id = auth.uid())))))))
  );

-- storage.objects.storage_objects_project_doc_read  [true FOR SELECT TO PUBLIC]
alter policy storage_objects_project_doc_read on storage.objects
  using (
    ((bucket_id = 'project-documents'::text) AND (auth.uid() IS NOT NULL) AND (split_part(name, '/'::text, 1) = (auth_org_id())::text) AND (array_length(string_to_array(name, '/'::text), 1) = 4) AND is_active_member())
  );

-- storage.objects.storage_objects_project_doc_write  [true FOR ALL TO PUBLIC]
alter policy storage_objects_project_doc_write on storage.objects
  using (
    ((bucket_id = 'project-documents'::text) AND (auth.uid() IS NOT NULL) AND (split_part(name, '/'::text, 1) = (auth_org_id())::text) AND (array_length(string_to_array(name, '/'::text), 1) = 4) AND (auth_role() = ANY (ARRAY['Admin'::user_role, 'Executive'::user_role, 'Project Manager'::user_role, 'Finance'::user_role])) AND (EXISTS ( SELECT 1
   FROM project_documents pd
  WHERE (((pd.id)::text = split_part(objects.name, '/'::text, 3)) AND (pd.org_id = auth_org_id()) AND ((pd.project_id)::text = split_part(objects.name, '/'::text, 2)) AND (pd.status = 'Draft'::doc_status)))))
  )
  with check (
    ((bucket_id = 'project-documents'::text) AND (auth.uid() IS NOT NULL) AND (split_part(name, '/'::text, 1) = (auth_org_id())::text) AND (array_length(string_to_array(name, '/'::text), 1) = 4) AND (auth_role() = ANY (ARRAY['Admin'::user_role, 'Executive'::user_role, 'Project Manager'::user_role, 'Finance'::user_role])) AND (EXISTS ( SELECT 1
   FROM project_documents pd
  WHERE (((pd.id)::text = split_part(objects.name, '/'::text, 3)) AND (pd.org_id = auth_org_id()) AND ((pd.project_id)::text = split_part(objects.name, '/'::text, 2)) AND (pd.status = 'Draft'::doc_status)))))
  );

commit;

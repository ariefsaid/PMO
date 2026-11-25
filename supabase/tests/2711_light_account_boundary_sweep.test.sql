-- 2711_light_account_boundary_sweep.test.sql — field accounts read only their own work (docs/specs/light-accounts.spec.md).
-- AC-LA-014 the standing boundary sweep, so the narrowing of 1205-1229 and its later migrations can never silently fall behind the schema:
--   (a) every public security-definer function the signed-in role can execute either refuses a field account by body
--       (the 1209/1219/1461 guard) or is on the named allowlist below, each with its reason;
--   (b) every public table carrying org_id either carries the restrictive light_account_deny_select or
--       light_account_scope_select policy, or is on the named allowlist below, each with its reason;
--   (c) storage.objects carries the restrictive field-account policy for the project-documents bucket.
-- The allowlists are name-keyed (an overload is covered by its name) and each entry is asserted to still exist, so a
-- rename must come back through this test instead of passing silently. Objects added later without a guard or an
-- entry fail (a) or (b) — including objects from another lane at integration.
-- MUTATION NOTES (break the rule; the named assertion must go red; restore):
--   create function public.zzz_sweep_probe() returns void language plpgsql security definer as 'begin null; end';
--   plus grant execute to authenticated ........................ 'AC-LA-014 every public security-definer function ...'
--   drop policy light_account_deny_select on progress_claim_lines 'AC-LA-014 every public org table ...'
--   drop policy storage_objects_project_doc_light on storage.objects 'AC-LA-014 the project-documents bucket ...'
--   comment line '-- perform public.assert_not_light()' only, in an unguarded probe granted to authenticated
--                                                              'AC-LA-014 every public security-definer function ...'
--   change a helper entry's function to 'returns setof boolean' .. 'every allowlisted helper returns a single scalar value'
--   add a name to the field_path rows ........................... 'the field-path allowlist is exactly the ruled ...'
--   rename allowlist entry my_home to my_home_x ................. 'every allowlisted function still exists'
begin;
create extension if not exists pgtap;
select plan(8);

create temp table la_fn_allow (fn text primary key, kind text not null check (kind in ('field_path','helper','trigger')), why text not null);
insert into la_fn_allow values
  ('order_receiving_blind', 'helper', 'scalar policy predicate: a field account holds no storekeeper job, so it answers false'),
  ('order_receiving_line_blind', 'helper', 'scalar policy predicate scoped to the caller organization, false without the storekeeper job'),
  ('attendance_can_record', 'field_path', 'the field home, clock-in, attendance and own-leave paths'),
  ('attendance_second_record_may_decide', 'helper', 'the signed-in authorization-state or organisation-setting helper the shell and the policies read'),
  ('attendance_second_record_may_enter', 'helper', 'the signed-in authorization-state or organisation-setting helper the shell and the policies read'),
  ('attendance_generate_timesheet', 'field_path', 'the field home, clock-in, attendance and own-leave paths'),
  ('attendance_record', 'field_path', 'the field home, clock-in, attendance and own-leave paths'),
  ('leave_authority', 'helper', 'the gate names a management role or an approver set the light seats never hold'),
  ('leave_enabled', 'field_path', 'the field home, clock-in, attendance and own-leave paths'),
  ('leave_on_date', 'field_path', 'the field home, clock-in, attendance and own-leave paths'),
  ('leave_request_cancel', 'field_path', 'the field home, clock-in, attendance and own-leave paths'),
  ('leave_request_submit', 'field_path', 'the field home, clock-in, attendance and own-leave paths'),
  ('leave_requestable_people', 'field_path', 'the field home, clock-in, attendance and own-leave paths'),
  ('medical_release_holds', 'field_path', 'the field home, clock-in, attendance and own-leave paths'),
  ('my_home', 'field_path', 'the field home, clock-in, attendance and own-leave paths'),
  ('phone_check_in', 'field_path', 'the field home, clock-in, attendance and own-leave paths'),
  ('set_my_email_opt_out', 'field_path', 'the field home, clock-in, attendance and own-leave paths'),
  ('actor_authorization_state', 'field_path', 'the signed-in authorization-state or organisation-setting helper the shell and the policies read'),
  ('actor_built_in_role', 'helper', 'the signed-in authorization-state or organisation-setting helper the shell and the policies read'),
  ('actor_has_person_documents_access', 'helper', 'the signed-in authorization-state or organisation-setting helper the shell and the policies read'),
  ('actor_has_role_capability', 'helper', 'the signed-in authorization-state or organisation-setting helper the shell and the policies read'),
  ('actor_is_light', 'helper', 'the signed-in authorization-state or organisation-setting helper the shell and the policies read'),
  ('actor_may_see_medical_documents', 'helper', 'the signed-in authorization-state or organisation-setting helper the shell and the policies read'),
  ('expiry_document_object_is_medical', 'helper', 'a stored-file helper the expiry-documents storage policy reads through the write rule; it answers for the caller''s own organisation and a field account holds no document right'),
  ('actor_may_order_purchases', 'helper', 'the ordering-job-role gate the purchasing read policies call; a field account never holds an ordering role (the setting refuses field roles), so it answers false'),
  ('actor_may_read_purchase_cases', 'helper', 'scalar inspection predicate: explicitly false for field accounts and requires the held Procurement Manager key; the field-account denial is proved and mutation-checked in 2422_purchase_case_read.test.sql'),
  ('actor_may_see_prices', 'helper', 'the signed-in authorization-state or organisation-setting helper the shell and the policies read'),
  ('actor_may_see_prices_now', 'helper', 'the signed-in authorization-state or organisation-setting helper the shell and the policies read'),
  ('actor_sees_prices', 'helper', 'the signed-in authorization-state or organisation-setting helper the shell and the policies read'),
  ('auth_manager_id', 'helper', 'the signed-in authorization-state or organisation-setting helper the shell and the policies read'),
  ('auth_org_id', 'helper', 'the signed-in authorization-state or organisation-setting helper the shell and the policies read'),
  ('auth_role', 'helper', 'the signed-in authorization-state or organisation-setting helper the shell and the policies read'),
  ('get_built_in_roles_enabled', 'helper', 'the signed-in authorization-state or organisation-setting helper the shell and the policies read'),
  ('get_hide_prices_enabled', 'helper', 'the signed-in authorization-state or organisation-setting helper the shell and the policies read'),
  ('get_may_see_prices', 'helper', 'the signed-in authorization-state or organisation-setting helper the shell and the policies read'),
  ('get_phone_check_in_supervisor_role', 'helper', 'the signed-in authorization-state or organisation-setting helper the shell and the policies read'),
  ('is_active_member', 'helper', 'the signed-in authorization-state or organisation-setting helper the shell and the policies read'),
  ('may_approve_journal', 'helper', 'the signed-in authorization-state or organisation-setting helper the shell and the policies read'),
  ('org_feature_enabled', 'helper', 'the signed-in authorization-state or organisation-setting helper the shell and the policies read'),
  ('org_has_feature', 'helper', 'the signed-in authorization-state or organisation-setting helper the shell and the policies read'),
  ('org_has_member_email', 'helper', 'the signed-in authorization-state or organisation-setting helper the shell and the policies read'),
  ('org_reads_erp_ledger', 'helper', 'the signed-in authorization-state or organisation-setting helper the shell and the policies read'),
  ('worker_effective_crew', 'helper', 'a Foreman''s own roster and tick read it; it returns one crew id for a person and day in the caller''s organisation, the placement and loan fact every member already reads (crew-followed)'),
  ('org_seat_report', 'field_path', 'the signed-in authorization-state or organisation-setting helper the shell and the policies read'),
  ('profile_prefs_unchanged', 'helper', 'the signed-in authorization-state or organisation-setting helper the shell and the policies read'),
  ('resolved_org_features', 'field_path', 'the signed-in authorization-state or organisation-setting helper the shell and the policies read'),
  ('resolved_org_plan', 'field_path', 'the signed-in authorization-state or organisation-setting helper the shell and the policies read'),
  ('boq_item_quantity_locked', 'helper', 'a capability or audience helper the shell and the policies read'),
  ('budget_activation_mode', 'helper', 'a capability or audience helper the shell and the policies read'),
  ('can_add_incident_evidence', 'helper', 'a capability or audience helper the shell and the policies read'),
  ('can_add_inspection_file', 'helper', 'a capability or audience helper the shell and the policies read'),
  ('can_add_qcr_file', 'helper', 'a capability or audience helper the shell and the policies read'),
  ('can_read_meeting', 'helper', 'a capability or audience helper the shell and the policies read'),
  ('manpower_can_manage', 'helper', 'a capability or audience helper the shell and the policies read: it returns false for a field account and leaks nothing else'),
  ('crew_can_manage', 'helper', 'a capability or audience helper the shell and the policies read'),
  ('crew_tool_can_report', 'helper', 'a capability or audience helper the shell and the policies read'),
  ('crew_tool_is_reporter', 'helper', 'a capability or audience helper the shell and the policies read'),
  ('crew_tool_photo_stored', 'helper', 'a capability or audience helper the shell and the policies read'),
  ('dsr_may_enter', 'helper', 'a capability or audience helper the shell and the policies read'),
  ('dsr_may_see_revenue', 'helper', 'a capability or audience helper the shell and the policies read'),
  ('dsr_may_write_revenue', 'helper', 'a capability or audience helper the shell and the policies read'),
  ('dsr_may_validate', 'helper', 'a capability or audience helper the shell and the policies read'),
  ('dsr_photo_stored', 'helper', 'a capability or audience helper the shell and the policies read'),
  ('dsr_photo_writable', 'helper', 'a capability or audience helper the shell and the policies read'),
  ('has_meeting_grant', 'helper', 'a capability or audience helper the shell and the policies read'),
  ('is_meeting_attendee', 'helper', 'a capability or audience helper the shell and the policies read'),
  ('light_can_see_crew', 'helper', 'a capability or audience helper the shell and the policies read'),
  ('light_can_see_crew_member', 'helper', 'a capability or audience helper the shell and the policies read'),
  ('light_can_see_work_order', 'helper', 'a capability or audience helper the shell and the policies read'),
  ('m365_folder_linked_elsewhere', 'helper', 'a capability or audience helper the shell and the policies read'),
  ('m365_record_folder_default_matches', 'helper', 'a capability or audience helper the shell and the policies read'),
  ('project_win_eligibility', 'helper', 'a capability or audience helper the shell and the policies read'),
  ('propose_project_number', 'helper', 'a capability or audience helper the shell and the policies read'),
  ('qcr_file_object_access', 'helper', 'a capability or audience helper the shell and the policies read'),
  ('actor_may_see_billing_steps', 'helper', 'a capability or audience helper the shell and the policies read'),
  ('actor_may_run_billing_steps', 'helper', 'a capability or audience helper the shell and the policies read'),
  ('actor_holds_job_role', 'helper', 'a job-role right gate the policies and functions read; a field account holds no named job role and no manager level, so it answers false'),
  ('actor_holds_owner_job_role', 'helper', 'a job-role right gate the close-out notice reads; a field account holds no named job role, so it answers false'),
  ('actor_may_enter_leave_for_others', 'helper', 'a job-role right gate the policies and functions read; a field account holds no named job role and no manager level, so it answers false'),
  ('actor_may_lend_workers', 'helper', 'a job-role right gate the policies and functions read; a field account holds no named job role and no manager level, so it answers false'),
  ('actor_may_manage_document_types', 'helper', 'a job-role right gate the policies and functions read; a field account holds no named job role and no manager level, so it answers false'),
  ('actor_may_review_timesheets', 'helper', 'a job-role right gate the policies and functions read; a field account holds no named job role and no manager level, so it answers false'),
  ('actor_may_task_issue', 'helper', 'a job-role right gate the policies and functions read; a field account holds no named job role and no manager level, so it answers false'),
  ('actor_may_tick_clearances', 'helper', 'a job-role right gate the policies and functions read; a field account holds no named job role and no manager level, so it answers false'),
  ('actor_may_write_people', 'helper', 'a job-role right gate the policies and functions read; a field account holds no named job role and no manager level, so it answers false'),
  ('crew_tool_may_manage', 'helper', 'a job-role right gate the policies and functions read; a field account holds no named job role and no manager level, so it answers false'),
  ('wo_step_readable', 'helper', 'a capability or audience helper the shell and the policies read'),
  ('wo_step_owner_matches', 'helper', 'a capability or audience helper the shell and the policies read'),
  ('record_history_table', 'helper', 'history visibility only: names the table a registered history entity lives in and reads no tenant row, so a field account can learn nothing from it'),
  ('spc_may_prepare', 'helper', 'a capability or audience helper the shell and the policies read'),
  ('spc_may_read', 'helper', 'a capability or audience helper the shell and the policies read'),
  ('spc_may_read_rates', 'helper', 'a capability or audience helper the shell and the policies read'),
  ('stock_can_attach', 'helper', 'a capability or audience helper the shell and the policies read'),
  ('stock_doc_readable', 'helper', 'a capability or audience helper the shell and the policies read'),
  ('phone_check_in_is_supervisor', 'helper', 'the gate names a management role or an approver set the light seats never hold'),
  ('audit_budget_version_delete', 'trigger', 'a table-write trigger function, not client-callable; the write itself is refused to a field account'),
  ('audit_budget_version_insert', 'trigger', 'a table-write trigger function, not client-callable; the write itself is refused to a field account'),
  ('audit_budget_version_update', 'trigger', 'a table-write trigger function, not client-callable; the write itself is refused to a field account'),
  ('audit_company_delete', 'trigger', 'a table-write trigger function, not client-callable; the write itself is refused to a field account'),
  ('audit_incoming_payment_delete', 'trigger', 'a table-write trigger function, not client-callable; the write itself is refused to a field account'),
  ('audit_incoming_payment_insert', 'trigger', 'a table-write trigger function, not client-callable; the write itself is refused to a field account'),
  ('audit_procurement_insert', 'trigger', 'a table-write trigger function, not client-callable; the write itself is refused to a field account'),
  ('audit_procurement_invoice_delete', 'trigger', 'a table-write trigger function, not client-callable; the write itself is refused to a field account'),
  ('audit_procurement_invoice_insert', 'trigger', 'a table-write trigger function, not client-callable; the write itself is refused to a field account'),
  ('audit_procurement_quotation_delete', 'trigger', 'a table-write trigger function, not client-callable; the write itself is refused to a field account'),
  ('audit_procurement_quotation_insert', 'trigger', 'a table-write trigger function, not client-callable; the write itself is refused to a field account'),
  ('audit_procurement_receipt_delete', 'trigger', 'a table-write trigger function, not client-callable; the write itself is refused to a field account'),
  ('audit_procurement_receipt_insert', 'trigger', 'a table-write trigger function, not client-callable; the write itself is refused to a field account'),
  ('audit_project_delete', 'trigger', 'a table-write trigger function, not client-callable; the write itself is refused to a field account'),
  ('audit_project_document_insert', 'trigger', 'a table-write trigger function, not client-callable; the write itself is refused to a field account'),
  ('audit_project_document_update', 'trigger', 'a table-write trigger function, not client-callable; the write itself is refused to a field account'),
  ('audit_project_insert', 'trigger', 'a table-write trigger function, not client-callable; the write itself is refused to a field account'),
  ('audit_sales_invoice_delete', 'trigger', 'a table-write trigger function, not client-callable; the write itself is refused to a field account'),
  ('audit_sales_invoice_insert', 'trigger', 'a table-write trigger function, not client-callable; the write itself is refused to a field account'),
  ('audit_timesheet_insert', 'trigger', 'a table-write trigger function, not client-callable; the write itself is refused to a field account'),
  ('audit_work_order_insert', 'trigger', 'a table-write trigger function, not client-callable; the write itself is refused to a field account'),
  ('guard_erp_purchase_capture_org', 'trigger', 'a table-write trigger function, not client-callable; the write itself is refused to a field account'),
  ('guard_record_only_child', 'trigger', 'a table-write trigger function, not client-callable; the write itself is refused to a field account'),
  ('guard_record_only_erp_link', 'trigger', 'a table-write trigger function, not client-callable; the write itself is refused to a field account'),
  ('guard_record_only_journal_attach', 'trigger', 'a table-write trigger function, not client-callable; the write itself is refused to a field account'),
  ('guard_record_only_source', 'trigger', 'a table-write trigger function, not client-callable; the write itself is refused to a field account'),
  ('guard_record_only_status', 'trigger', 'a table-write trigger function, not client-callable; the write itself is refused to a field account'),
  ('procurement_items_native_mirror_guard', 'trigger', 'a table-write trigger function, not client-callable; the write itself is refused to a field account'),
  ('procurement_quotations_insert_guard', 'trigger', 'a table-write trigger function, not client-callable; the write itself is refused to a field account'),
  ('procurement_quotations_native_mirror_guard', 'trigger', 'a table-write trigger function, not client-callable; the write itself is refused to a field account'),
  ('purchase_requests_native_mirror_guard', 'trigger', 'a table-write trigger function, not client-callable; the write itself is refused to a field account'),
  ('rfqs_native_mirror_guard', 'trigger', 'a table-write trigger function, not client-callable; the write itself is refused to a field account'),
  ('stamp_org_id', 'trigger', 'a table-write trigger function, not client-callable; the write itself is refused to a field account'),
  ('timesheet_entry_week_bounds_guard', 'trigger', 'a table-write trigger function, not client-callable; the write itself is refused to a field account'),
  ('timesheet_mirror_unknown_witness_guard', 'trigger', 'a table-write trigger function, not client-callable; the write itself is refused to a field account'),
  ('timesheets_week_start_bounds_guard', 'trigger', 'a table-write trigger function, not client-callable; the write itself is refused to a field account'),
  ('dsr_stock_issue_on', 'helper', 'the site-report stock switch: dsr_post_stock reads it, so guarding it would refuse the posting for every account'),
  ('equipment_plan_approver_ok', 'helper', 'the plan approver test: approve and reject equipment plan call it, so it must answer for every account'),
  ('equipment_plan_engineer_on_project', 'helper', 'the equipment_plans select policy calls it, so it must answer for every account'),
  ('revenue_plan_enabled', 'helper', 'the revenue-plan switch several reads and the work_order_revenue_plan select policy call'),
  ('safety_day_writable', 'helper', 'the safety-day write policies and safety_save_talk call it, so it must answer for every account'),
  ('safety_may_enter', 'helper', 'the safety-day policies and the safety writes call it'),
  ('safety_may_enter_day', 'helper', 'the safety_officer_entries insert policy calls it'),
  ('safety_may_see_people', 'helper', 'safety_may_see_people_day calls it'),
  ('safety_may_see_people_day', 'helper', 'the safety fitness, attendee and photo select policies call it'),
  ('safety_photo_stored', 'helper', 'the safety_toolbox_photos insert policy calls it'),
  ('safety_records_enabled', 'helper', 'the safety_days write guard and the setting write call it'),
  ('site_checkpoint_may_read', 'helper', 'the site_checkpoints select policy and the photo path test call it'),
  ('site_checkpoint_may_record', 'helper', 'record_site_checkpoint and the photo write policy call it'),
  ('site_checkpoint_photo_path_ok', 'helper', 'the site-checkpoint photo storage policies call it'),
  ('site_checkpoint_photo_stored', 'helper', 'record_site_checkpoint checks the stored object through it'),
  ('site_checkpoint_today', 'helper', 'record_site_checkpoint and the work-order checkpoint flag read the organisation date through it'),
  ('stock_can_handover', 'helper', 'the stock handover photo write policy calls it, so it must answer for every account'),
  ('stock_handover_readable', 'helper', 'the stock handover photo read policy calls it'),
  ('stock_proof_timing_of', 'helper', 'receive_stock_transfer and stock_post_core read the proof timing through it'),
  ('stock_reservations_on', 'helper', 'the reservation reads and writes check the switch through it'),
  ('stock_transfer_mode_of', 'helper', 'stock_lock_transfer, send_stock_transfer and the stock document guards read the mode through it'),
  ('stock_wo_transfers_on', 'helper', 'post_stock_wo_transfer checks the switch through it'),
  ('stock_transfer_receiving_items', 'field_path', 'addressed-transfer labels and quality requirements only, scoped to the receiving field account and its organisation; 2381 proves both refusals'),
  ('receive_stock_transfer', 'field_path', 'the delivery confirmation path: a field account confirms the count and the photo'),
  ('record_stock_handover', 'field_path', 'the handover confirmation path: a field account signs for the delivery addressed to it'),
  ('report_absence', 'field_path', 'a light worker reports only their own absence');

create temp table la_table_allow (t text primary key, why text not null);
insert into la_table_allow values
  ('absence_reports', 'the existing policy admits only the caller''s own rows or the light seat''s own audience'),
  ('agent_attachments', 'the existing policy admits only the caller''s own rows or the light seat''s own audience'),
  ('agent_automations', 'the existing policy admits only the caller''s own rows or the light seat''s own audience'),
  ('agent_dispatch_watermarks', 'written and read by definers only: the signed-in role holds no SELECT grant'),
  ('agent_events', 'the existing policy admits only the caller''s own rows or the light seat''s own audience'),
  ('agent_runs', 'the existing policy admits only the caller''s own rows or the light seat''s own audience'),
  ('agent_threads', 'the existing policy admits only the caller''s own rows or the light seat''s own audience'),
  ('agent_usage', 'the existing policy admits only the caller''s own rows or the light seat''s own audience'),
  ('alert_send_log', 'written and read by definers only: the signed-in role holds no SELECT grant'),
  ('attendance_days', 'the existing policy admits only the caller''s own rows or the light seat''s own audience'),
  ('attendance_photos', 'the existing policy admits only the caller''s own rows or the light seat''s own audience'),
  ('audit_events', 'the existing policy names management roles the light seats never hold'),
  ('bill_match_exceptions', 'the existing policy joins a parent whose own rows a field account cannot read'),
  ('budget_archive_cancel_intents', 'written and read by definers only: the signed-in role holds no SELECT grant'),
  ('budget_archive_requests', 'written and read by definers only: the signed-in role holds no SELECT grant'),
  ('budget_occupant_consents', 'the existing policy names management roles the light seats never hold'),
  ('budget_version_document_links', 'the existing policy joins a parent whose own rows a field account cannot read'),
  ('budget_version_editors', 'the existing policy joins a parent whose own rows a field account cannot read'),
  ('clearance_items', 'the existing policy names management roles the light seats never hold'),
  ('contract_rate_assignees', 'the existing policy names management roles the light seats never hold'),
  ('cost_attribution_rule_targets', 'the existing policy names management roles the light seats never hold'),
  ('cost_attribution_rules', 'the existing policy names management roles the light seats never hold'),
  ('cost_disciplines', 'organisation reference or configuration list the shell and roster flows render'),
  ('credit_allocations', 'the existing policy admits only the callers own rows (and the light seats own audience)'),
  ('credit_reservations', 'written and read by definers only: the signed-in role holds no SELECT grant'),
  ('credits', 'the existing policy names management roles the light seats never hold'),
  ('crew_standard_roles', 'organisation reference or configuration list the shell and roster flows render'),
  ('crew_worker_rotation_off', 'organisation reference or configuration list the shell and roster flows render'),
  ('document_expiry_notices', 'written and read by definers only: the signed-in role holds no SELECT grant'),
  ('document_types', 'organisation reference or configuration list the shell and roster flows render'),
  ('dsr_consumables', 'the existing policy joins a parent whose own rows a field account cannot read'),
  ('dsr_events', 'the existing policy joins a parent whose own rows a field account cannot read'),
  ('dsr_idle_periods', 'the existing policy joins a parent whose own rows a field account cannot read'),
  ('dsr_idle_reasons', 'organisation reference or configuration list the shell and roster flows render'),
  ('dsr_photos', 'the existing policy joins a parent whose own rows a field account cannot read'),
  ('dsr_progress_lines', 'written and read by definers only: the signed-in role holds no SELECT grant'),
  ('dsr_weather_conditions', 'organisation reference or configuration list the shell and roster flows render'),
  ('email_event_settings', 'the existing policy names management roles the light seats never hold'),
  ('email_org_settings', 'the existing policy names management roles the light seats never hold'),
  ('email_outbox', 'written and read by definers only: the signed-in role holds no SELECT grant'),
  ('email_user_prefs', 'the existing policy admits only the caller''s own rows or the light seat''s own audience'),
  ('equipment_costing_settings', 'the existing policy names management roles the light seats never hold'),
  ('equipment_escalation_log', 'written and read by definers only: the signed-in role holds no SELECT grant'),
  ('equipment_rental_checks', 'the existing policy names management roles the light seats never hold'),
  ('equipment_rental_terms', 'the existing policy names management roles the light seats never hold'),
  ('erp_account_mirror', 'the existing policy names management roles the light seats never hold'),
  ('erp_capture_batches', 'written and read by definers only: the signed-in role holds no SELECT grant'),
  ('erp_capture_feed_witnesses', 'written and read by definers only: the signed-in role holds no SELECT grant'),
  ('erp_capture_invoice_assignments', 'the existing policy names management roles the light seats never hold'),
  ('erp_company_default_requests', 'the existing policy names management roles the light seats never hold'),
  ('erp_connect_census', 'the existing policy names management roles the light seats never hold'),
  ('erp_connect_proposals', 'the existing policy names management roles the light seats never hold'),
  ('erp_connect_runs', 'the existing policy names management roles the light seats never hold'),
  ('erp_connect_staged', 'written and read by definers only: the signed-in role holds no SELECT grant'),
  ('erp_cost_centre_mirror', 'the existing policy names management roles the light seats never hold'),
  ('erp_employees', 'the existing policy admits only the callers own rows (and the light seats own audience)'),
  ('erp_financial_statement_dirty_date', 'written and read by definers only: the signed-in role holds no SELECT grant'),
  ('erp_financial_statement_published_context', 'written and read by definers only: the signed-in role holds no SELECT grant'),
  ('erp_financial_statement_report_batch', 'written and read by definers only: the signed-in role holds no SELECT grant'),
  ('erp_financial_statement_report_pending', 'written and read by definers only: the signed-in role holds no SELECT grant'),
  ('erp_financial_statement_snapshot', 'the existing policy names a management role the light seats never hold'),
  ('erp_fiscal_year_intents', 'written and read by definers only: the signed-in role holds no SELECT grant'),
  ('erp_journal_line_links', 'the existing policy names management roles the light seats never hold'),
  ('erp_payment_ledger_mirror', 'the existing policy names management roles the light seats never hold'),
  ('erp_purchase_captures', 'the existing policy names management roles the light seats never hold'),
  ('erp_purchase_document_marks', 'the existing policy names management roles the light seats never hold'),
  ('erp_purchase_documents', 'the existing policy names management roles the light seats never hold'),
  ('erp_statement_change_state', 'written and read by definers only: the signed-in role holds no SELECT grant'),
  ('erp_statement_nightly_obligation', 'written and read by definers only: the signed-in role holds no SELECT grant'),
  ('erp_statement_pass_run', 'written and read by definers only: the signed-in role holds no SELECT grant'),
  ('erp_sweep_full_run', 'written and read by definers only: the signed-in role holds no SELECT grant'),
  ('erp_sweep_lock', 'written and read by definers only: the signed-in role holds no SELECT grant'),
  ('erpnext_payment_inflight_bills', 'written and read by definers only: the signed-in role holds no SELECT grant'),
  ('expense_advance_returns', 'the existing policy joins a parent whose own rows a field account cannot read'),
  ('expense_claim_files', 'the existing policy joins a parent whose own rows a field account cannot read'),
  ('expense_posting_erp_mirror', 'the existing policy joins a parent whose own rows a field account cannot read'),
  ('expiry_documents', 'the existing policy names management roles the light seats never hold'),
  ('external_command_outbox', 'written and read by definers only: the signed-in role holds no SELECT grant'),
  ('external_org_bindings', 'written and read by definers only: the signed-in role holds no SELECT grant'),
  ('fx_rates', 'organisation reference or configuration list the shell and roster flows render'),
  ('imprest_cash_counts', 'the existing policy joins a parent whose own rows a field account cannot read'),
  ('imprest_float_changes', 'the existing policy joins a parent whose own rows a field account cannot read'),
  ('imprest_plan_lines', 'the existing policy joins a parent whose own rows a field account cannot read'),
  ('imprest_plans', 'the existing policy joins a parent whose own rows a field account cannot read'),
  ('imprest_posting_erp_mirror', 'the existing policy joins a parent whose own rows a field account cannot read'),
  ('imprest_replenishments', 'the existing policy joins a parent whose own rows a field account cannot read'),
  ('incident_types', 'organisation reference or configuration list the shell and roster flows render'),
  ('incident_files', 'own-row scope: only the files this person uploaded'),
  ('journal_entry_authors', 'the existing policy names management roles the light seats never hold'),
  ('leave_requests', 'the existing policy admits only the caller''s own rows or the light seat''s own audience'),
  ('leave_types', 'organisation reference or configuration list the shell and roster flows render'),
  ('m365_org_apps', 'written and read by definers only: the signed-in role holds no SELECT grant'),
  ('m365_pkce_states', 'written and read by definers only: the signed-in role holds no SELECT grant'),
  ('m365_record_folder_sweeps', 'the existing policy names management roles the light seats never hold'),
  ('meeting_access_grants', 'the existing policy requires a meeting read grant'),
  ('meeting_attendees', 'the existing policy requires a meeting read grant'),
  ('ms_graph_connections', 'written and read by definers only: the signed-in role holds no SELECT grant'),
  ('notifications', 'the existing policy admits only the caller''s own rows or the light seat''s own audience'),
  ('odoo_ledger_census_seen', 'written and read by definers only: the signed-in role holds no SELECT grant'),
  ('odoo_ledger_checks', 'the existing policy names management roles the light seats never hold'),
  ('odoo_revenue_census_seen', 'written and read by definers only: the signed-in role holds no SELECT grant'),
  ('odoo_stock_cost_census_seen', 'written and read by definers only: the signed-in role holds no SELECT grant'),
  ('odoo_stock_cost_checks', 'the existing policy names management roles the light seats never hold'),
  ('opening_balance_lines', 'the existing policy names management roles the light seats never hold'),
  ('opening_balances', 'the existing policy names management roles the light seats never hold'),
  ('org_ai_allowance_grants', 'written and read by definers only: the signed-in role holds no SELECT grant'),
  ('org_features', 'organisation reference or configuration list the shell and roster flows render'),
  ('org_m365_document_settings', 'organisation reference or configuration list the shell and roster flows render'),
  ('org_plans', 'written and read by definers only: the signed-in role holds no SELECT grant'),
  ('org_role_names', 'organisation reference or configuration list the shell and roster flows render'),
  ('org_second_member_marks', 'written and read by definers only: the signed-in role holds no SELECT grant'),
  ('org_terminology', 'organisation reference or configuration list the shell and roster flows render'),
  ('people', 'the existing policy names a management role the light seats never hold'),
  ('person_clearances', 'the existing policy names management roles the light seats never hold'),
  ('phone_check_ins', 'the existing policy admits only the caller''s own rows or the light seat''s own audience'),
  ('pipeline_stage_config', 'organisation reference or configuration list the shell and roster flows render'),
  ('pipeline_stage_config_0591_backup', 'written and read by definers only: the signed-in role holds no SELECT grant'),
  ('po_variation_lines', 'the existing policy joins a parent whose own rows a field account cannot read'),
  ('po_variations', 'the existing policy joins a parent whose own rows a field account cannot read'),
  ('procurement_bill_match_lines', 'the existing policy joins a parent whose own rows a field account cannot read'),
  ('procurement_bill_matches', 'the existing policy joins a parent whose own rows a field account cannot read'),
  ('procurement_create_intents', 'written and read by definers only: the signed-in role holds no SELECT grant'),
  ('procurement_erp_links', 'the existing policy names management roles the light seats never hold'),
  ('profiles', 'organisation reference or configuration list the shell and roster flows render'),
  ('project_number_counters', 'written and read by definers only: the signed-in role holds no SELECT grant'),
  ('purchase_history_imports', 'the existing policy names management roles the light seats never hold'),
  ('purchase_order_revisions', 'the existing policy joins a parent whose own rows a field account cannot read'),
  ('rate_catalogue_stage_weights', 'the existing policy joins a parent whose own rows a field account cannot read'),
  ('rate_catalogue_variants', 'the existing policy names management roles the light seats never hold'),
  ('record_changes', 'the existing policy joins a parent whose own rows a field account cannot read'),
  ('revenue_erp_mirror', 'the existing policy names management roles the light seats never hold'),
  ('scheduled_report_runs', 'written and read by definers only: the signed-in role holds no SELECT grant'),
  ('scheduled_reports', 'the existing policy names management roles the light seats never hold'),
  ('stock_document_files', 'the existing policy joins a parent whose own rows a field account cannot read'),
  ('stock_tags', 'organisation reference or configuration list the shell and roster flows render'),
  ('stock_units', 'organisation reference or configuration list the shell and roster flows render'),
  ('stock_warehouse_keepers', 'organisation reference or configuration list the shell and roster flows render'),
  ('task_proofs', 'the existing policy joins a parent whose own rows a field account cannot read'),
  ('task_reminders', 'the existing policy admits only the caller''s own rows or the light seat''s own audience'),
  ('timesheet_entries', 'the existing policy admits only the caller''s own rows or the light seat''s own audience'),
  ('timesheet_erp_mirror', 'the existing policy admits only the caller''s own rows or the light seat''s own audience'),
  ('timesheets', 'the existing policy admits only the caller''s own rows or the light seat''s own audience'),
  ('tm_claim_lines', 'the existing policy joins a parent whose own rows a field account cannot read'),
  ('tm_claim_sources', 'the existing policy joins a parent whose own rows a field account cannot read'),
  ('user_views', 'the existing policy admits only the caller''s own saved views, or definitions shared with the organisation'),
  ('vendor_withholding_slip_bills', 'the existing policy joins a parent whose own rows a field account cannot read'),
  ('vendor_withholding_slips', 'written and read by definers only: the signed-in role holds no SELECT grant'),
  -- 1480: six tables whose standing policy-set assertion (0128, 0212, bfy_column_nullable, equipment_status) cannot
  -- carry a new restrictive policy, so the light test sits inside the table's own policy instead.
  ('error_events', 'service-role telemetry: FORCE RLS and no policy by design (0128), so the signed-in role reads no row'),
  ('budget_version_erp_mirror', 'its one select policy excludes a light account (1480); the mirror is the ERP push''s own copy of budget data'),
  ('equipment_status_days', 'its select policy excludes a light account (1480): machine-written status, not the phone home'),
  ('equipment_status_history', 'its select policy excludes a light account (1480): machine-written status, not the phone home'),
  ('equipment_downtime_proofs', 'its select policy excludes a light account (1480): breakdown evidence, not the phone home'),
  ('external_reference_items', 'its select and ALL write policies exclude a light account (1480); the reference list is office data');

-- an allowlist entry that stops matching a real object is a stale entry, not a pass
select is((select count(*)::int from la_fn_allow d
            where not exists (select 1 from pg_proc p
                               where p.pronamespace = 'public'::regnamespace and p.proname = d.fn)), 0,
  'AC-LA-014 every allowlisted function still exists (a rename revisits this list)');
select is((select count(*)::int from la_table_allow d where to_regclass('public.' || d.t) is null), 0,
  'AC-LA-014 every allowlisted table still exists (a rename revisits this list)');

-- (a) the definer sweep; a failure lists every missing body in full
select is((
  select coalesce(string_agg(p.proname, ', ' order by p.proname), '')
    from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and p.prokind = 'f'
     and p.prosecdef
     and has_function_privilege('authenticated', p.oid, 'EXECUTE')
     and regexp_replace(p.prosrc, '--[^\n]*', '', 'g') !~* '(perform|where)\s+public\.assert_not_light\(\)'
     and not exists (select 1 from la_fn_allow d where d.fn = p.proname)
), '',
  'AC-LA-014 every public security-definer function the signed-in role can execute refuses a field account by body or is allowlisted');

-- the allowlist is checked by kind, not by claim: a field path is an exact set (adding one is a ruling),
-- a helper answers a scalar, a trigger function returns trigger
select is((select coalesce(string_agg(fn, ', ' order by fn), '') from la_fn_allow where kind = 'field_path'),
  (select string_agg(x, ', ' order by x) from unnest(array[
  'attendance_can_record', 'attendance_generate_timesheet', 'attendance_record', 'leave_enabled',
  'leave_on_date', 'leave_request_cancel', 'leave_request_submit', 'leave_requestable_people',
  'medical_release_holds', 'my_home', 'phone_check_in', 'set_my_email_opt_out', 'actor_authorization_state',
  'org_seat_report', 'resolved_org_features', 'resolved_org_plan', 'receive_stock_transfer', 'stock_transfer_receiving_items',
  'record_stock_handover', 'report_absence']) x),
  'AC-LA-014 the field-path allowlist is exactly the ruled field-account paths');
select is((
  select coalesce(string_agg(distinct p.proname, ', ' order by p.proname), '')
    from pg_proc p join la_fn_allow d on d.fn = p.proname
   where p.pronamespace = 'public'::regnamespace and d.kind = 'helper'
     and (p.proretset or p.prorettype not in
          ('boolean'::regtype, 'text'::regtype, 'uuid'::regtype, 'integer'::regtype, 'date'::regtype,
           'numeric'::regtype, 'public.user_role'::regtype))
), '', 'AC-LA-014 every allowlisted helper returns a single scalar value');
select is((
  select coalesce(string_agg(distinct p.proname, ', ' order by p.proname), '')
    from pg_proc p join la_fn_allow d on d.fn = p.proname
   where p.pronamespace = 'public'::regnamespace and d.kind = 'trigger' and p.prorettype <> 'trigger'::regtype
), '', 'AC-LA-014 every allowlisted trigger function returns trigger');

-- (b) the table sweep; a failure lists every uncovered table in full
select is((
  select coalesce(string_agg(c.relname, ', ' order by c.relname), '')
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public'
     and c.relkind in ('r','p')
     and exists (select 1 from pg_attribute a where a.attrelid = c.oid and a.attname = 'org_id' and not a.attisdropped)
     and not exists (
           select 1 from pg_policies pol
            where pol.schemaname = 'public' and pol.tablename = c.relname
              and pol.cmd = 'SELECT' and pol.permissive = 'RESTRICTIVE'
              and pol.policyname in ('light_account_deny_select', 'light_account_scope_select'))
     and not exists (select 1 from la_table_allow d where d.t = c.relname)
), '',
  'AC-LA-014 every public org table confines a field account with the restrictive select policy or is allowlisted');

-- (c) the project-documents bucket is closed to a field account by a restrictive storage policy
select ok(exists (
  select 1 from pg_policies
   where schemaname = 'storage' and tablename = 'objects'
     and policyname = 'storage_objects_project_doc_light'
     and cmd = 'SELECT' and permissive = 'RESTRICTIVE'
     and qual like '%actor_is_light%' and qual like '%project-documents%'
), 'AC-LA-014 the project-documents bucket carries the restrictive field-account read policy');

select * from finish();
rollback;

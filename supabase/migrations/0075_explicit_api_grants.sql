-- 0075_explicit_api_grants.sql — audit finding #4 (defense-in-depth): activate
-- `auto_expose_new_tables = false` SAFELY. This migration is the companion required before that
-- flag can flip — it EXPLICITLY grants, per table, the exact DML privileges `authenticated`/`anon`
-- currently hold via the (now-being-retired) implicit auto-expose default, so flipping the flag off
-- is a ZERO-BEHAVIOR-CHANGE, defense-in-depth-only move: today's grants continue verbatim; only
-- FUTURE tables stop being auto-exposed (they will need an explicit GRANT of their own, forcing a
-- deliberate review instead of an accidental wide-open default).
--
-- ── HOW THE GRANT LIST WAS CAPTURED (ground truth, not hand-authored) ──────────────────────────────
-- With `auto_expose_new_tables` still commented out (i.e. defaulting ON), `supabase db reset` was run
-- and the LIVE, EFFECTIVE grants were read back from Postgres itself:
--   • information_schema.role_table_grants  — table-level privilege per (table, grantee)
--   • information_schema.role_column_grants — column-level privilege per (table, grantee, column),
--     needed because six tables (0008/0010/0014/0017/0051) already REVOKE the table-wide UPDATE
--     grant from `authenticated` and re-GRANT UPDATE on an explicit narrower column list (RPC-only
--     columns for money/status/SoD fields) — a plain table-level mirror would have been WRONG for
--     those six (it would restore write access to columns like contract_value that a security-
--     definer RPC is the sole authority for). `anon` was NOT narrowed by those migrations (RLS blocks
--     anon regardless; the DML grant was simply never touched for that role) — mirrored as-is, see
--     the flag note in the final report, not silently "fixed" here.
--   • No `public` schema sequences exist (every PK is `gen_random_uuid()`), so there is nothing to
--     grant `USAGE`/`SELECT` on for identity columns.
-- Every `grant` below is therefore a byte-for-byte mirror of what Postgres reported as already
-- granted — nothing broadened, nothing narrowed. Four record tables (payments / purchase_orders /
-- purchase_requests / rfqs) intentionally get NO insert/update/delete grant at all: 0058 already
-- revoked those (RPC-only writes, `create_purchase_request`/`create_rfq`/`create_purchase_order`/
-- `create_payment` + `transition_procurement` run as the security-definer function owner and are
-- unaffected by a caller-role table grant) — this migration simply preserves that lockdown.
--
-- Idempotent / re-runnable: plain `grant` statements are naturally idempotent in Postgres (granting
-- an already-held privilege is a no-op, no error).
--
-- Reversibility (ADR-0006, pre-production): `supabase db reset`. Manual rollback: re-comment
-- `auto_expose_new_tables` in config.toml and re-reset (PostgREST/Supabase will re-derive the
-- implicit grants on next `db reset`); the explicit grants below are otherwise harmless to leave in
-- place (they match what auto-expose would grant anyway).

grant delete, insert, references, select, trigger, truncate on public.agent_attachments to authenticated;
grant update on public.agent_attachments to authenticated;
grant delete, insert, references, select, trigger, truncate on public.agent_attachments to anon;
grant update on public.agent_attachments to anon;

grant delete, insert, references, select, trigger, truncate on public.agent_automations to authenticated;
grant update on public.agent_automations to authenticated;
grant delete, insert, references, select, trigger, truncate on public.agent_automations to anon;
grant update on public.agent_automations to anon;

grant delete, insert, references, select, trigger, truncate on public.agent_dispatch_watermarks to authenticated;
grant update on public.agent_dispatch_watermarks to authenticated;
grant delete, insert, references, select, trigger, truncate on public.agent_dispatch_watermarks to anon;
grant update on public.agent_dispatch_watermarks to anon;

grant delete, insert, references, select, trigger, truncate on public.agent_events to authenticated;
grant update on public.agent_events to authenticated;
grant delete, insert, references, select, trigger, truncate on public.agent_events to anon;
grant update on public.agent_events to anon;

grant delete, insert, references, select, trigger, truncate on public.agent_runs to authenticated;
grant update on public.agent_runs to authenticated;
grant delete, insert, references, select, trigger, truncate on public.agent_runs to anon;
grant update on public.agent_runs to anon;

grant delete, insert, references, select, trigger, truncate on public.agent_threads to authenticated;
grant update on public.agent_threads to authenticated;
grant delete, insert, references, select, trigger, truncate on public.agent_threads to anon;
grant update on public.agent_threads to anon;

grant delete, insert, references, select, trigger, truncate on public.agent_usage to authenticated;
grant update on public.agent_usage to authenticated;
grant delete, insert, references, select, trigger, truncate on public.agent_usage to anon;
grant update on public.agent_usage to anon;

grant delete, insert, references, select, trigger, truncate on public.budget_line_items to authenticated;
grant update on public.budget_line_items to authenticated;
grant delete, insert, references, select, trigger, truncate on public.budget_line_items to anon;
grant update on public.budget_line_items to anon;

grant delete, insert, references, select, trigger, truncate on public.budget_versions to authenticated;
grant update on public.budget_versions to authenticated;
grant delete, insert, references, select, trigger, truncate on public.budget_versions to anon;
grant update on public.budget_versions to anon;

grant delete, insert, references, select, trigger, truncate on public.companies to authenticated;
grant update on public.companies to authenticated;
grant delete, insert, references, select, trigger, truncate on public.companies to anon;
grant update on public.companies to anon;

grant delete, insert, references, select, trigger, truncate on public.contacts to authenticated;
grant update on public.contacts to authenticated;
grant delete, insert, references, select, trigger, truncate on public.contacts to anon;
grant update on public.contacts to anon;

grant delete, insert, references, select, trigger, truncate on public.credits to authenticated;
grant update on public.credits to authenticated;
grant delete, insert, references, select, trigger, truncate on public.credits to anon;
grant update on public.credits to anon;

grant delete, insert, references, select, trigger, truncate on public.crm_activities to authenticated;
grant update on public.crm_activities to authenticated;
grant delete, insert, references, select, trigger, truncate on public.crm_activities to anon;
grant update on public.crm_activities to anon;

grant delete, insert, references, select, trigger, truncate on public.error_events to authenticated;
grant update on public.error_events to authenticated;
grant delete, insert, references, select, trigger, truncate on public.error_events to anon;
grant update on public.error_events to anon;

grant delete, insert, references, select, trigger, truncate on public.incident_reports to authenticated;
grant update on public.incident_reports to authenticated;
grant delete, insert, references, select, trigger, truncate on public.incident_reports to anon;
grant update on public.incident_reports to anon;

grant delete, insert, references, select, trigger, truncate on public.notifications to authenticated;
grant update on public.notifications to authenticated;
grant delete, insert, references, select, trigger, truncate on public.notifications to anon;
grant update on public.notifications to anon;

grant delete, insert, references, select, trigger, truncate on public.org_features to authenticated;
grant update on public.org_features to authenticated;
grant delete, insert, references, select, trigger, truncate on public.org_features to anon;
grant update on public.org_features to anon;

grant delete, insert, references, select, trigger, truncate on public.organizations to authenticated;
grant update on public.organizations to authenticated;
grant delete, insert, references, select, trigger, truncate on public.organizations to anon;
grant update on public.organizations to anon;

grant delete, insert, references, select, trigger, truncate on public.payment_files to authenticated;
grant update on public.payment_files to authenticated;
grant delete, insert, references, select, trigger, truncate on public.payment_files to anon;
grant update on public.payment_files to anon;

grant references, select, trigger, truncate on public.payments to authenticated;
grant references, select, trigger, truncate on public.payments to anon;

grant delete, insert, references, select, trigger, truncate on public.pipeline_stage_config to authenticated;
grant update on public.pipeline_stage_config to authenticated;
grant delete, insert, references, select, trigger, truncate on public.pipeline_stage_config to anon;
grant update on public.pipeline_stage_config to anon;

grant delete, insert, references, select, trigger, truncate on public.platform_operators to authenticated;
grant update on public.platform_operators to authenticated;
grant delete, insert, references, select, trigger, truncate on public.platform_operators to anon;
grant update on public.platform_operators to anon;

grant delete, insert, references, select, trigger, truncate on public.procurement_doc_counters to authenticated;
grant update on public.procurement_doc_counters to authenticated;
grant delete, insert, references, select, trigger, truncate on public.procurement_doc_counters to anon;
grant update on public.procurement_doc_counters to anon;

grant delete, insert, references, select, trigger, truncate on public.procurement_documents to authenticated;
grant update on public.procurement_documents to authenticated;
grant delete, insert, references, select, trigger, truncate on public.procurement_documents to anon;
grant update on public.procurement_documents to anon;

grant delete, insert, references, select, trigger, truncate on public.procurement_invoice_files to authenticated;
grant update on public.procurement_invoice_files to authenticated;
grant delete, insert, references, select, trigger, truncate on public.procurement_invoice_files to anon;
grant update on public.procurement_invoice_files to anon;

grant delete, insert, references, select, trigger, truncate on public.procurement_invoices to authenticated;
grant update (id, org_id, procurement_id, invoice_date, status, created_at) on public.procurement_invoices to authenticated;
grant delete, insert, references, select, trigger, truncate on public.procurement_invoices to anon;
grant update on public.procurement_invoices to anon;

grant delete, insert, references, select, trigger, truncate on public.procurement_items to authenticated;
grant update on public.procurement_items to authenticated;
grant delete, insert, references, select, trigger, truncate on public.procurement_items to anon;
grant update on public.procurement_items to anon;

grant delete, insert, references, select, trigger, truncate on public.procurement_quotation_files to authenticated;
grant update on public.procurement_quotation_files to authenticated;
grant delete, insert, references, select, trigger, truncate on public.procurement_quotation_files to anon;
grant update on public.procurement_quotation_files to anon;

grant delete, insert, references, select, trigger, truncate on public.procurement_quotations to authenticated;
grant update (id, org_id, procurement_id, vendor_id, reference, total_amount, received_date, is_selected, file_url) on public.procurement_quotations to authenticated;
grant delete, insert, references, select, trigger, truncate on public.procurement_quotations to anon;
grant update on public.procurement_quotations to anon;

grant delete, insert, references, select, trigger, truncate on public.procurement_receipt_files to authenticated;
grant update on public.procurement_receipt_files to authenticated;
grant delete, insert, references, select, trigger, truncate on public.procurement_receipt_files to anon;
grant update on public.procurement_receipt_files to anon;

grant delete, insert, references, select, trigger, truncate on public.procurement_receipts to authenticated;
grant update (id, org_id, procurement_id, receipt_date, status, created_at) on public.procurement_receipts to authenticated;
grant delete, insert, references, select, trigger, truncate on public.procurement_receipts to anon;
grant update on public.procurement_receipts to anon;

grant delete, insert, references, select, trigger, truncate on public.procurement_status_events to authenticated;
grant update on public.procurement_status_events to authenticated;
grant delete, insert, references, select, trigger, truncate on public.procurement_status_events to anon;
grant update on public.procurement_status_events to anon;

grant delete, insert, references, select, trigger, truncate on public.procurements to authenticated;
grant update (id, org_id, code, title, project_id, total_value, vendor_id, created_at, updated_at) on public.procurements to authenticated;
grant delete, insert, references, select, trigger, truncate on public.procurements to anon;
grant update on public.procurements to anon;

grant delete, insert, references, select, trigger, truncate on public.profiles to authenticated;
grant update on public.profiles to authenticated;
grant delete, insert, references, select, trigger, truncate on public.profiles to anon;
grant update on public.profiles to anon;

grant delete, insert, references, select, trigger, truncate on public.project_documents to authenticated;
grant update (id, org_id, project_id, code, category, title, revision, doc_date, author_id, file_path, created_at) on public.project_documents to authenticated;
grant delete, insert, references, select, trigger, truncate on public.project_documents to anon;
grant update on public.project_documents to anon;

grant delete, insert, references, select, trigger, truncate on public.project_milestones to authenticated;
grant update on public.project_milestones to authenticated;
grant delete, insert, references, select, trigger, truncate on public.project_milestones to anon;
grant update on public.project_milestones to anon;

grant delete, insert, references, select, trigger, truncate on public.projects to authenticated;
grant update (id, org_id, code, name, client_id, project_manager_id, budget, spent, start_date, end_date, last_update, created_at, archived_at) on public.projects to authenticated;
grant delete, insert, references, select, trigger, truncate on public.projects to anon;
grant update on public.projects to anon;

grant delete, insert, references, select, trigger, truncate on public.purchase_order_files to authenticated;
grant update on public.purchase_order_files to authenticated;
grant delete, insert, references, select, trigger, truncate on public.purchase_order_files to anon;
grant update on public.purchase_order_files to anon;

grant references, select, trigger, truncate on public.purchase_orders to authenticated;
grant references, select, trigger, truncate on public.purchase_orders to anon;

grant delete, insert, references, select, trigger, truncate on public.purchase_request_files to authenticated;
grant update on public.purchase_request_files to authenticated;
grant delete, insert, references, select, trigger, truncate on public.purchase_request_files to anon;
grant update on public.purchase_request_files to anon;

grant references, select, trigger, truncate on public.purchase_requests to authenticated;
grant references, select, trigger, truncate on public.purchase_requests to anon;

grant delete, insert, references, select, trigger, truncate on public.rfq_files to authenticated;
grant update on public.rfq_files to authenticated;
grant delete, insert, references, select, trigger, truncate on public.rfq_files to anon;
grant update on public.rfq_files to anon;

grant references, select, trigger, truncate on public.rfqs to authenticated;
grant references, select, trigger, truncate on public.rfqs to anon;

grant delete, insert, references, select, trigger, truncate on public.task_dependencies to authenticated;
grant update on public.task_dependencies to authenticated;
grant delete, insert, references, select, trigger, truncate on public.task_dependencies to anon;
grant update on public.task_dependencies to anon;

grant delete, insert, references, select, trigger, truncate on public.tasks to authenticated;
grant update on public.tasks to authenticated;
grant delete, insert, references, select, trigger, truncate on public.tasks to anon;
grant update on public.tasks to anon;

grant delete, insert, references, select, trigger, truncate on public.timesheet_entries to authenticated;
grant update on public.timesheet_entries to authenticated;
grant delete, insert, references, select, trigger, truncate on public.timesheet_entries to anon;
grant update on public.timesheet_entries to anon;

grant delete, insert, references, select, trigger, truncate on public.timesheets to authenticated;
grant update on public.timesheets to authenticated;
grant delete, insert, references, select, trigger, truncate on public.timesheets to anon;
grant update on public.timesheets to anon;

grant delete, insert, references, select, trigger, truncate on public.user_views to authenticated;
grant update on public.user_views to authenticated;
grant delete, insert, references, select, trigger, truncate on public.user_views to anon;
grant update on public.user_views to anon;

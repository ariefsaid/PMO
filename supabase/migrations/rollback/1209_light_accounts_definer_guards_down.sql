-- The guard is a one-line prefix, inert for everyone but a light account. Reversal: re-apply the latest migration that defines each
-- function named in 1209 (a rollback of 1205 would break them, so reverse 1209's bodies first):
--   get_budget_archive_targets 0578, list_account_reconciliation 1145, list_tm_claim_source_details 0680, equipment_rental_check 1034,
--   approved_timesheet_for_push 0220, org_usage_summary + org_agent_run_stats 0086, org_credit_balance 0067, preview_task_reminders 0442.
drop index if exists public.incident_reports_reported_by_idx;
drop index if exists public.tasks_assignee_idx;

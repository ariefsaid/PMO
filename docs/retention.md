# Data retention

Every log-, queue- or history-shaped table (`*_log`, `*_events`, `*_runs`, `*_inbox`, `*_outbox`,
`*_history`, `*_usage`, `*_attempts`, `*_fires`, `notifications`) and every `cron.schedule` job declares
here how long rows are kept. `scripts/check-retention.mjs` (in `check:guards`) fails on an unlisted
table or job and on a stale entry. Decision cell starts with `purge, <N days|months> (\`job-name\`)`,
`keep: <reason>` or `self-cleaning`. Entries with a dot live outside the migrations.

## Tables

| Table | Decision |
|---|---|
| `cron.job_run_details` | purge, 7 days (`cron-run-history-purge`, 0564) |
| `error_events` | purge, 90 days (`error-events-purge`) |
| `net._http_response` | self-cleaning (pg_net TTL) |
| `clickup_webhook_inbox` | purge, 30 days, processed (done) rows only (`clickup-webhook-inbox-purge`, 0565) |
| `alert_send_log` | purge, 90 days (`alert-send-log-purge`, 0565) |
| `notifications` | purge, 180 days, read ones only (`notifications-purge`, 0565) |
| `email_outbox` | keep: delivery record, one row per emailed notification; removed with its notification (`notifications-purge`) |
| `scheduled_report_runs` | purge, 90 days (`scheduled-report-tick`, 1227); finished scheduled-report `email_outbox` rows follow the same 90 days |
| `phone_check_ins` | purge, 90 days, position columns only (`phone-check-in-position-purge`, 1467); the check-in record itself stays: outcome, decision and hours are business history |
| `agent_runs` | keep: owner decision pending (#1755) |
| `agent_events` | keep: owner decision pending (#1755) |
| `agent_usage` | keep: owner decision pending (#1755); proposal 13 months for billing |
| `agent_threads` | keep: owner decision pending (#1755); how long conversations are kept (privacy) |
| `audit_events` | keep: audit trail; at scale split by year (#1746) |
| `record_changes` | keep: audit trail; at scale split by year (#1746) |
| `external_command_outbox` | keep: money-posting evidence |
| `erp_financial_statement_*` | keep: raw ERP response and cleaned copy kept on purpose as statement evidence; an unfinished capture is replaced by the next one |
| `procurement_status_events` | keep: procurement status history shown on the record |
| `material_request_events` | keep: material request approval history shown on the request (who decided, for whom, why) |
| `stock_reservation_events` | keep: reservation history shown with the reservation (who reserved, released, lent and consumed, and for which request) |
| `work_order_section_readiness_events` | keep: a section's readiness history shown on its record (who, when, note; #2576); removed with the section |
| `client_requisition_events` | keep: client requisition history and the reservations and releases the figures are derived from; never edited or deleted (#2585) |
| `owner_material_reconciliation_events` | keep: material reconciliation step changes retain actor, time and reason for the section record (#3010) |
| `dsr_events` | keep: site report transition history and return reasons shown on the record (#1522) |
| `quantity_change_request_events` | keep: quantity change request transition history, actors and reasons shown on the request (#2578); a change to a billable quantity is audit evidence |
| `agent_automation_fires` | keep: owner decision pending (#1755); automation fire claims |
| `procurement_import_runs` | keep: owner decision pending (#1755); import run history |
| `erp_connect_runs` | keep: owner decision pending (#1755); ERP connect run history |
| `equipment_status_history` | keep: who set each machine's daily status and when; it backs a rental-bill deduction (0985) |
| `equipment_rental_checks` | keep: records reasons for including unproven downtime in a rental check (0987) |
| `equipment_escalation_log` | keep: one row per machine per day it was escalated, so a rerun sends nothing twice (0985) |
| `org_ai_allowance_grants` | keep: one row per org per month; the idempotency key for the AI allowance grant (0535), and the pointer from a month to its `credits` row — a grant history, not log noise |

## Cron jobs

| Job | Decision |
|---|---|
| `cron-run-history-purge` | keep: purge job, stores no rows |
| `error-events-purge` | keep: purge job, stores no rows |
| `clickup-webhook-inbox-purge` | keep: purge job, stores no rows |
| `document-expiry-warnings` | keep: writes one dedupe row per notice (`document_expiry_notices`, removed with its document); notifications fall under `notifications-purge` |
| `alert-send-log-purge` | keep: purge job, stores no rows |
| `notifications-purge` | keep: purge job, stores no rows |
| `phone-check-in-position-purge` | keep: purge job, stores no rows (1467) |
| `agent-dispatch-tick` | keep: trigger only, stores no rows |
| `telegram-notify-tick` | keep: trigger only, stores no rows |
| `email-notify-tick` | keep: trigger only, stores no rows |
| `scheduled-report-tick` | keep: queues scheduled reports and purges its own 90-day-old rows (1227) |
| `clickup-sweep-tick` | keep: trigger only, stores no rows |
| `clickup-webhook-worker-tick` | keep: trigger only, stores no rows |
| `erpnext-sweep-tick` | keep: trigger only, stores no rows |
| `odoo-sweep-tick` | keep: trigger only, stores no rows |
| `m365-pkce-sweep` | keep: trigger only, stores no rows |
| `incident-escalation` | keep: trigger only; each escalation writes one audit event, which the audit retention rule already governs |
| `billing-stage-overdue` | keep: trigger only; stamps one column on the stage row once and writes one audit event per overdue stage, which the audit retention rule already governs |
| `site-checkpoint-materialise` | keep: creates the day's checkpoint rows, which are the evidence and are kept with the work order |
| `site-checkpoint-late` | keep: trigger only; each reminder writes one audit event, which the audit retention rule already governs |
| `done-not-claimed` | keep: trigger only; writes one stamp row and one audit event per notified line (the stamp stays so a line is told once; the audit event is governed by the audit retention rule) |
| `equipment-downtime-escalation` | keep: trigger only; its rows are the escalation log, listed above (0986) |
| `tpi-overdue` | keep: trigger only; each notice is a `notifications` row (governed by `notifications-purge`) and one `overdue_notified_at` stamp on the inspection (1134) |
| `plan-monthly-ai-allowance` | keep: trigger only, stores no rows (it writes one grant row per org per month, listed above) |

# Plan: scheduled reports by email (#2714)

Spec: `docs/specs/scheduled-email-reports.spec.md`. Test-first. Stacked on #2711 (migrations 1220-1223).

## Design
`scheduled_reports` (org record) -> `scheduled_report_tick()` (pg_cron, every 5 minutes, same pattern as `email_notify_tick`) -> for each due report inserts a `scheduled_report_runs` row (unique report+period) and, per recipient, an `email_outbox` row carrying its own subject/body. Delivery reuses `claim_email_outbox` / `complete_email_outbox` and the `email-notify` function; no second provider adapter.

`email_outbox` change (migration 1225): `notification_id` becomes nullable; new nullable `report_id`, `period_key`, `subject`, `body`; check that exactly one of notification_id / report_id is set; unique (report_id, period_key, recipient_id). Existing rows and unique key unchanged.

## Migrations (range 1225-1229; rollbacks in `supabase/migrations/rollback/<n>_<slug>_down.sql`)
- `1225_scheduled_reports_tables.sql` - `scheduled_reports` (id, org_id, name, kind, frequency, weekday smallint null, send_time time, recipient_user_ids uuid[], recipient_roles text[], enabled default true, archived_at, created_by, timestamps), `scheduled_report_runs` (report_id, period_key, org_id, queued int, unique (report_id, period_key)), outbox alterations above. RLS forced; Admin select on reports; no client policy on runs/outbox; org_id stamped by trigger.
- `1226_scheduled_report_content.sql` - `scheduled_report_body(p_kind, p_org, p_recipient, p_period)`: definer, service/definer-only; computes per-recipient figures with the recipient's role and project-manager relation applied explicitly (a copy of the dsr_may_see_revenue audience keyed on the recipient, not on auth.uid()).
- `1227_scheduled_report_tick.sql` - `scheduled_report_tick()` + `cron.schedule('scheduled-report-tick','*/5 * * * *')`; local date/time from `organizations.default_timezone`; recipient resolution as FR-SCH-006; stale-row failure inside `claim_email_outbox` (replaced, same signature, returns subject/body for report rows).
- `1228_scheduled_report_rpcs.sql` - Admin-only `save_scheduled_report`, `set_scheduled_report_enabled`, `archive_scheduled_report`; `list_scheduled_reports` is a plain Admin-select on the table.
- `1229` reserved (unused). Retention purge (90 days) lives inside the tick.

## Edge function `supabase/functions/email-notify/`
Extend `templates.ts` with a `scheduled_report` event (en/id lead and foot; subject and body from the row) and `index.ts` to pass row subject/body through; tests added to `index.test.ts` importing `./index.ts`, mocking `globalThis.fetch`.

## Frontend (inside the existing Administration email card, no new route)
`pmo-portal/src/lib/db/scheduledReports.ts`, `src/lib/repositories/scheduledReports.ts` (+ contract), `src/components/emailNotifications/ScheduledReportsSetting.tsx` mounted by `EmailNotificationsSetting.tsx`, gated by `can('manage','orgEmailNotifications')`; shared form primitives, tokens, strings in the `emailNotifications` namespace (en + id); screenshots `docs/evidence/1215/2714/{phone-390,desktop-1440}.png`. Glossary: "scheduled report", "report kind".

## Tests (one owner per AC)
- pgTAP `supabase/tests/1225_scheduled_reports.test.sql`: AC-SCH-001..008, 010, 012 + mutation checks.
- Deno `supabase/functions/email-notify/index.test.ts`: AC-SCH-009.
- Vitest `ScheduledReportsSetting.test.tsx`, repository test: AC-SCH-011.
- Registry: `supabase/tests/inventory/anon-executable-definers/2714-scheduled-reports.txt`, `scripts/isolation-probe-denominator.d/2714-scheduled-reports.json`.
- Vitest scope: the new files plus `src/components/emailNotifications` and `src/lib/repositories`; not `related` on policy.ts/App.tsx.

## Settings added (default = unchanged)
No existing setting changes. New org records only on Admin creation: none exist by default, so no organisation sees a change. Per-report: kind, frequency, weekday, send time (org timezone), recipients, on/off. Email language and per-user opt-out are the #2711 ones.

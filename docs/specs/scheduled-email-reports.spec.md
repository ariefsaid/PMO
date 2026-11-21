# Scheduled reports by email (#2714)

Builds on `email-notifications.spec.md` (#2711): same outbox, same delivery function, same Resend adapter, same per-user opt-out and language setting. Nothing is seeded: an organisation with no scheduled report sees no change.
Out of scope: export of every table (Q1 2027), phone push, attachments, a report designer, custom report kinds.

## Concepts
- **Report kind**: one of a small fixed set, each computed in the database from data that already exists: `daily_progress` (the day's site reports: reports by status, progress lines and quantity per work order; a revenue total only for a recipient who may see revenue) and `overdue_tasks` (open tasks past their due date, per project).
- **Scheduled report**: an organisation record: name, kind, frequency (`daily` or `weekly`), weekday (weekly only), local send time (hour and minute, in the organisation's timezone), recipients (people and/or roles), on/off.
- **Period**: the local date a run covers (daily: the day being reported; weekly: the week ending that day). `period_key` = kind + ISO date; with report and recipient it is the idempotency key.

## Requirements (EARS)
- **FR-SCH-001** The system shall store scheduled reports per organisation; with no row, nothing is queued and no screen or rule changes.
- **FR-SCH-002** Only an Admin shall create, edit, switch off or archive a scheduled report, through security-definer RPCs; the table has no client write grant.
- **FR-SCH-003** The kind shall be one of the fixed set; frequency `daily` or `weekly`; a weekly report requires a weekday; the send time is a local time in the organisation's timezone; recipients are a list of people (members of the same organisation) and/or roles; at least one recipient entry is required and at most 50.
- **FR-SCH-004** When a pg_cron tick runs, the system shall find each enabled, non-archived report whose local send time has passed for the current local period and which has no run for that period, and queue exactly one outbox row per resolved recipient for it, in the same transaction as the run record.
- **FR-SCH-005** Queuing shall be idempotent: re-running the tick, or two overlapping ticks, produces no second row for the same report, period and recipient.
- **FR-SCH-006** Recipients resolve to active members of the report's organisation with an address, by person plus every active member holding a listed role, de-duplicated; a user who opted out of email receives nothing.
- **FR-SCH-007** The body shall be computed in the database at queue time, separately per recipient, from data that recipient may see: a figure the recipient's role may not read (revenue) is left out of that recipient's email, never masked with a placeholder, and no row of another organisation is ever counted.
- **FR-SCH-008** A report with nothing to say for the period (no reports that day, no overdue tasks) shall still send once with an explicit "nothing to report" line, so silence is never ambiguous.
- **FR-SCH-009** The delivery function shall send these rows through the existing claim, lease, retry and idempotency-key path, with subject and body rendered from a template in English or Bahasa Indonesia (the organisation's email language); no organisation or client name appears in a template.
- **FR-SCH-010** If the sender secret is absent the existing behaviour holds (nothing sent, rows stay pending); a pending scheduled row older than 48 hours shall be marked failed rather than sent late.
- **FR-SCH-011** The outbox and the run record shall be unreadable to every client role.
- **FR-SCH-012** The Administration email card shall gain a "Scheduled reports" list and form (Admin only, `can()` gated): create, edit, switch on/off, archive; labels in English and Bahasa Indonesia; usable at 390 px.

## Acceptance criteria (owning layer)
- **AC-SCH-001** Given no scheduled report, when the tick runs, then no outbox row and no run row. *(pgTAP)*
- **AC-SCH-002** Given a daily report due now with two recipients, when the tick runs, then exactly two outbox rows and one run row; running the tick again adds nothing. *(pgTAP)*
- **AC-SCH-003** Given the local send time is later than now (org timezone), or the report is off or archived, then nothing is queued. Given a timezone ahead of UTC, the local date and time decide, not UTC. *(pgTAP)*
- **AC-SCH-004** Given a weekly report, then it fires only on its weekday. *(pgTAP)*
- **AC-SCH-005** Given recipients by person and by role overlapping, then one row each; an opted-out, inactive or other-org user gets none; in-app data is untouched. *(pgTAP)*
- **AC-SCH-006** Given a day with site reports, then a recipient who may see revenue gets the revenue total and one who may not gets the same report with no revenue figure anywhere in the body; another organisation's reports are never counted. *(pgTAP)*
- **AC-SCH-007** Given a day with nothing to report, then the row's body says so. *(pgTAP)*
- **AC-SCH-008** Given a non-Admin calls a write RPC, or any client selects the outbox or run table, or direct writes the report table, then denied. Given invalid kind, frequency, missing weekday, empty or oversize recipients, then refused. *(pgTAP)*
- **AC-SCH-009** Given a scheduled row, then Resend is called once with the Idempotency-Key and the body renders in both languages without an organisation name. *(Deno, shipped handler, mocked fetch)*
- **AC-SCH-010** Given a scheduled row pending over 48 hours, then it is failed, not sent. *(pgTAP)*
- **AC-SCH-011** Given the Administration email card, then an Admin lists, creates, switches off and archives a report; a non-Admin sees none of it; English and Bahasa labels render. *(Vitest; phone and desktop screenshots)*
- **AC-SCH-012** Existing #2711 tests and an organisation with no report are unchanged. *(existing pgTAP and Deno files, untouched)*

## Notes
- "At send time" = when the tick queues the row (at most one tick, 5 minutes, before delivery); the body is a snapshot of that moment.
- Mutation check (build report): remove the opt-out filter, the revenue gate, and the idempotency unique key in turn; each named test must go red.

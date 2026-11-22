# Spec: Issue types as a kept list, and effective working hours beside the closing time (issue-closing-measure)

**Status:** Draft for approval, 2026-11-22. Lane gap-billing, size S. IDs `FR-ICM-###`, `AC-ICM-###`. Plan: `docs/plans/2026-11-22-issue-closing-measure.md`. Migrations 1820-1829. Builds on the shipped closing-time report (`docs/specs/closing-time-report.spec.md`, migration 1424) and the daily site report (`docs/specs/daily-site-report.spec.md`, migrations 1040/1041). Not a money path (no figure is posted or stored; hours are minutes of site time).

## Job story

When I review how fast issues are closed, I want the closing time measured per issue and grouped by a kept list of issue types (not free text), with the effective working hours of each work order per day (hours worked minus stopped hours) shown beside it, so I can tell a slow closer from a site that simply could not work.

## 1. What exists today (verified on the base, `fc42e1a0`)

| Ask | Shipped | Where |
|---|---|---|
| Opened and closed timestamps | Yes. `created_at`; `closed_at`/`closed_by` stamped by the database when status becomes Closed, cleared on reopen. | `supabase/migrations/1026_site_issue_log_columns.sql:25,74-103` |
| Closing time per issue, grouped | Yes. RPC `get_issue_closing_time_report(date, date, text)` returns per group: total, closed, open, average and median closing hours, overdue. Screen `pmo-portal/pages/incidents/ClosingTimeReport.tsx`, settings `pages/admin/IssueClosingReportSettings.tsx`; off until an organisation turns it on (`issue_closing_report_settings.enabled`). | `1424_issue_closing_report.sql:3-220` |
| Issue type is a list | **No. Free text.** `incident_reports.type text not null` and a plain `TextField` with the placeholder "e.g. Near Miss…". The report groups by `btrim(type)`, and department groups store free-text strings (`issue_department_groups.issue_types text[]`), so "Electrical", "electrical " and "Elec." become three groups. | `0001_init_schema.sql:232`; `pmo-portal/components/IncidentFormModal.tsx:251-259`; `1424:150-175` |
| Stopped hours captured | **Yes, already.** `dsr_idle_periods(report_id, minutes 1..1440, reason_id)` on every daily site report, reasons from the Admin-kept list `dsr_idle_reasons`. Captured on the report form ("Add idle time"). Costed elsewhere by `work_order_idle_cost` (1256), minutes only; no per-day read. | `1040_daily_site_reports.sql:10,95-104`; `pages/siteReports/SiteReportDetail.tsx:224-237`; `1256_work_order_idle_cost.sql:31-36` |
| Hours worked per work order per day | **Yes, already.** `daily_site_reports.start_time`, `end_time` and the generated `total_minutes` (the site day), one live report per work order per day (`daily_site_reports_one_per_day`). Null when times are not entered. | `1040:41-45,70-72` |
| Effective hours (worked minus stopped) per work order per day | **No.** No read, screen or column combines the two. The performance indices (`1286`) are money indices (EV/AC/PV) and do not use time. | grep of `supabase/migrations`, `pmo-portal` |

Person-hours (approved timesheets, "actual crew hours", glossary) are a different measure: hours of people, not the site day. This spec uses the **site day** because the job story asks for hours per work order per day net of stoppage, and the stoppage is recorded against the site day. Open question 1 asks the owner to confirm.

**Stopped hours need no new capture.** Nothing is invented: the new read only combines `total_minutes` and `dsr_idle_periods`.

## 2. Requirements (EARS)

**Kept list of issue types**
- FR-ICM-001 The system shall store the organisation's issue types in a new table `incident_types (id, org_id, label, archived_at, created_at)`, label 1-80 characters, one live label per organisation (case-insensitive, trimmed), `org_id` stamped by default/trigger, never from the client. Pattern: `cost_disciplines` (0950) and `dsr_idle_reasons` (1040): every active member reads, an Admin writes, soft-archive (ADR-0018), RLS and an isolation-probe fragment.
- FR-ICM-002 `incident_reports` shall gain `type_id uuid references incident_types(id)`. The existing `type` text column stays, as the stored label, so every current reader (register, analytics, print, report) and all history keep working.
- FR-ICM-003 When an issue is created or its type changes, the database shall resolve the type to a list entry and write the entry's label to `type`; a type that matches no live entry of the organisation shall be refused (23514, `ICM_TYPE_NOT_IN_LIST`) with a message that tells the person to pick from the list or ask an Admin to add it. An update that leaves the type unchanged is never refused (an issue whose type was later archived stays editable).
- FR-ICM-004 When an Admin renames a type, the database shall carry the new label to the `type` of every issue of that type and to any department group naming the old label, in the same statement, so a rename never splits history.
- FR-ICM-005 An Admin shall add, rename and archive types on a small Administration card (list, add, rename, archive; archived hidden from the picker, kept on old issues). The new-organisation default list is neutral and editable: "Near miss", "Equipment damage", "Spill", "Other".
- FR-ICM-006 The issue form shall replace the free-text type field with a picker of live types; an empty list says "No issue types yet. An Admin adds them in Administration." and who to ask.

**Migration of existing free text (safe, reversible, history kept)**
- FR-ICM-007 At migration time, for every organisation, the system shall insert one `incident_types` row per distinct `lower(btrim(type))` of its issues (label = the most frequent spelling, ties by earliest), and set `type_id` on every issue by that same key. `type` text is left exactly as it was written (history) and is rewritten to the label only the next time the issue's type is edited. Blank types map to "Other". The migration is idempotent and loses no row.
- FR-ICM-008 Reversal drops `type_id`, the table and the triggers and leaves `type` untouched, so it is complete without a data restore.

**Closing time grouped by the list**
- FR-ICM-009 Where an issue has a `type_id`, `get_issue_closing_time_report` shall group by the type's current label (not the issue's stored text); department groups shall match by label so a rename follows (FR-ICM-004). Result columns and every existing behaviour are unchanged; the legacy `Unassigned` bucket remains for issues with no type.

**Effective working hours per work order per day**
- FR-ICM-010 The system shall provide `get_work_order_effective_hours(p_work_order uuid, p_from date, p_to date)` returning, per `work_date`: `worked_minutes` (the report's `total_minutes`), `stopped_minutes` (sum of its idle periods), `effective_minutes` (`greatest(worked - stopped, 0)`), and `has_times` (false when the report has no start/end, then worked and effective are null, never 0).
- FR-ICM-011 Only validated, non-superseded, non-archived reports count (same eligibility as `work_order_idle_cost`, 1256); a work order with no such report on a day has no row for that day.
- FR-ICM-012 The read shall be security invoker, so it returns only what the caller's existing row security on `daily_site_reports` lets them read; another organisation's work order returns nothing; the range is capped at 366 days.
- FR-ICM-013 The closing-time report screen shall show, beside the type table, an "Effective working hours" panel for a chosen work order and the same date range: a per-day table (worked, stopped, effective, in hours with one decimal) with a total, and a one-line basis ("site day from the validated daily report, minus stopped time"). Days with no times say "times not entered". With no work order chosen the panel says what to pick. Visible wherever the closing report is visible; no new switch.
- FR-ICM-014 All new strings English and Bahasa Indonesia; `DESIGN.md` tokens; usable at 390 px and 1440 px; shared form primitives; every refusal in `pmo-portal/src/lib/refusals.ts` with an English and a Bahasa Indonesia sentence.

## 3. Settings and defaults
No new switch. The type list is organisation data (Admin card, neutral default list for new organisations; existing organisations get their own distinct values). The closing report keeps its existing on/off and grouping settings. Where an organisation is already using the free-text behaviour, the change in who may type what is covered by migrating its values into the list (FR-ICM-007), so nobody loses a type.

## 4. Acceptance criteria

| AC | Given / When / Then | Layer |
|---|---|---|
| AC-ICM-001 | Given issues typed "Electrical", "electrical " and "Plumbing" in one org, when the migration logic runs, then two types exist, all three issues carry a `type_id`, and `type` text is unchanged. A second org's values stay in its own list. | pgTAP |
| AC-ICM-002 | Given a live type, when an issue is created with that type, then `type` equals the label; with an unlisted type, refused with `ICM_TYPE_NOT_IN_LIST`; with another org's type id, refused. | pgTAP (mutation: remove the list check, red) |
| AC-ICM-003 | Given an issue whose type is archived afterwards, when another field is edited, then it saves; when its type is changed to an archived type, refused. | pgTAP |
| AC-ICM-004 | Given a type used by issues and a department group, when an Admin renames it, then the issues' `type` and the group's entry carry the new label. | pgTAP |
| AC-ICM-005 | Given an Engineer and a user of another org, when they insert, rename or archive a type, then denied; an active member reads own org's list only. | pgTAP |
| AC-ICM-006 | Given closed issues of two types, one renamed after closing, when the closing report runs, then one group under the new label with the exact average and median. | pgTAP |
| AC-ICM-007 | Given a work order with a validated report 08:00-16:30 and 90 + 30 idle minutes, then that day shows worked 510, stopped 120, effective 390. | pgTAP |
| AC-ICM-008 | Given a draft, submitted, returned, superseded and archived report, then none appears; given a report with no times, then `has_times` false and worked/effective null (not 0); given stopped above worked, effective is 0. | pgTAP |
| AC-ICM-009 | Given a work order of another org, or a range over 366 days, then no rows / refused. | pgTAP |
| AC-ICM-010 | Given the Administration card, when an Admin adds, renames and archives a type, then the repository is called and the list updates; a non-Admin sees no card. | Unit |
| AC-ICM-011 | Given the issue form, then the type is a picker of live types, an empty list shows the empty-state text, and submit stays disabled until one is chosen. | Unit |
| AC-ICM-012 | Given the closing report with a work order chosen, then the daily table, total and "times not entered" rows render; with none chosen, the hint; in Bahasa Indonesia every label is translated. | Unit |
| AC-ICM-013 | Given the journey: Admin adds a type, a manager raises and closes an issue of it, the closing report shows the type's group and, for a work order with a validated report, the effective hours beside it. | E2E (one journey, orchestrator's wave run) |

## 5. Tests whose steps change (goal intact)
Specs or tests that create an issue with an arbitrary type string (`IncidentFormModal.test.tsx`, `Incidents*.test.tsx`, pgTAP `0979_site_issue_log.test.sql` and any other file inserting `incident_reports`, and e2e that types free text into the Type field) must pick or seed a listed type; found by grep at build and named in the report. The register, analytics and print tests stay untouched (they read `type` text).

## 6. Open questions for the owner
1. "Hours worked" = the site day on the daily report (start to end), net of its recorded stopped time (recommended; both already captured). Alternative: person-hours from approved timesheets. Built meanwhile: site day.
2. A type not on the list is refused for everyone (recommended, as the job story says "not free text"). Alternative: any member may add a type on the spot. Built meanwhile: Admin-only list, refusal tells them whom to ask.
3. Should the closing time exclude stopped time too (closing time net of days the site could not work)? Built meanwhile: no, it stays calendar time, the effective hours sit beside it.

## 7. Out of scope
Per-issue linkage to a stoppage; cost of idle time (1256 stays); issue type per severity rules; changing `incident_type` semantics for safety reporting.

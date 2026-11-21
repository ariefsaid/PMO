# Spec: Closing-time report for issues by department (#2678)

**Status:** Draft, 2026-11-21. Map #2516 (contractor field operations by 15 Dec). Size S.
IDs: `FR-CTR-###`, `AC-CTR-###`. Plan: `docs/plans/2026-11-21-closing-time-report.md`.
Role contract: `.claude/agents/implementer.md` (UI parts: `ui-implementer.md`).
Not a money path.

## Job story

When I review site issues, I want to see how long each department takes to close them,
so I can see where issues stall.

## What ships

A report of time to close per department, from data the issue log already holds.
Settings the client controls: Date range and department grouping.
Generic for contract-based organisations: every item is a setting or data the client fills in; no client process is coded.
Existing organisations see no change unless a setting turns it on; existing tests stay green untouched.

## 1. AS-IS & Grounding

- Issue log (`incident_reports`):
  - Created at `created_at`, incident date `incident_date`, issue category/discipline `type` (free text <= 255 chars), `severity`, `status` ('Open', 'Investigating', 'Closed').
  - Closure stamp: `closed_at` and `closed_by` stamped server-side by trigger `incident_reports_zz_issue_guard` (migration 1026).
  - Due timestamp: `due_at` (optional timestamptz).
  - Currently `/incidents` displays a server-paged register with status and due filters. No departmental aggregate or closing-time metric view exists.
- Tenancy & Permissions:
  - `org_id = (select public.auth_org_id()) and (select public.is_active_member())` for RLS select.
  - Feature switch & organization settings pattern: `issue_closing_report_settings` stores per-org enablement and default grouping.
  - Disabled by default (`enabled = false`) ensuring existing organisations see no visual change and zero regression.

## 2. Requirements (EARS)

### Feature enablement & Settings (Client controlled)
- **FR-CTR-001** The system shall store organization settings for the closing-time report (`issue_closing_report_settings`), with `enabled` (boolean, default false) and `grouping_mode` (`type` or `department_groups`).
- **FR-CTR-002** When the report setting `enabled` is false, the incident register shall render identically to baseline without the report tab or navigation link.
- **FR-CTR-003** When an authorized manager configures department grouping, the system shall allow defining named department groups (`issue_department_groups`) and mapping one or more issue types to each group.
- **FR-CTR-004** When no custom department groups are defined, or when grouping mode is set to `type`, the system shall group issues by their raw issue `type` string (with null/blank grouped as "Unassigned").

### Aggregation & Metrics
- **FR-CTR-010** The system shall compute closing duration as the elapsed time between `created_at` and `closed_at` for closed issues.
- **FR-CTR-011** The system shall provide a database query/RPC `get_issue_closing_time_report` scoped to `auth_org_id()` accepting optional parameters:
  - `p_date_from` (date, inclusive)
  - `p_date_to` (date, inclusive)
  - `p_grouping_mode` (text: 'type' or 'department_groups')
- **FR-CTR-012** For each department group within the selected date range, the report shall calculate:
  - `department`: name of the department group or issue type
  - `total_issues`: count of all issues matching the filter
  - `closed_issues`: count of closed issues
  - `open_issues`: count of open or investigating issues
  - `avg_closing_hours`: average time in hours to close for closed issues (or null if none closed)
  - `median_closing_hours`: median time in hours to close (percentile 50) for closed issues (or null if none closed)
  - `overdue_issues`: count of open/investigating issues where `due_at < now()` (stalled issues)
- **FR-CTR-013** When an issue has `status <> 'Closed'`, it shall contribute to `open_issues` and, if `due_at < now()`, to `overdue_issues`, but shall not distort the closed duration metrics.

### Presentation & UX
- **FR-CTR-020** When enabled, `/incidents` shall offer a view toggle or link to switch to the Closing-Time Report.
- **FR-CTR-021** The report screen shall allow the user to filter by Date Range (presets: 30 days, 90 days, Year to Date, All Time, or custom from/to dates) and switch Department Grouping (by Issue Type or by Department Groups).
- **FR-CTR-022** The report screen shall display summary cards (Total Issues, Closed Issues, Overall Average Closing Time, and Stalled/Overdue Issues) followed by a responsive data table.
- **FR-CTR-023** The report table and cards shall format durations clearly in hours or days (e.g. "1.5 days", "18 hours").
- **FR-CTR-024** All user-facing strings shall be available in English and Bahasa Indonesia.
- **FR-CTR-025** The screen shall follow `DESIGN.md` tokens and be usable on mobile viewports (375 px) and desktop.

## 3. Acceptance criteria

| AC | Given / When / Then | Owning layer |
|---|---|---|
| AC-CTR-001 | Given an org with report `enabled = false`, when loading `/incidents`, then no closing-report view toggle or report link is shown. | Unit |
| AC-CTR-002 | Given an org with report `enabled = true`, when loading `/incidents`, then the report toggle is available and opens the closing-time report. | Unit |
| AC-CTR-003 | Given an org with issues, when calling `get_issue_closing_time_report` with date filters, then only issues within `incident_date` range are included. | pgTAP |
| AC-CTR-004 | Given closed issues with known `created_at` and `closed_at`, when running the report, then average and median closing hours match exact duration math. | pgTAP |
| AC-CTR-005 | Given open issues past their `due_at`, when running the report, then `overdue_issues` counts them truthfully under their department. | pgTAP |
| AC-CTR-006 | Given custom department groups mapping types to departments, when grouping mode is `department_groups`, then issues roll up under their mapped department name. | pgTAP |
| AC-CTR-007 | Given an issue type not in any department group, when grouping by `department_groups`, then it groups under "Unassigned" (or "Other"). | pgTAP |
| AC-CTR-008 | Given a cross-org caller, when querying report or settings, then RLS denies access to another org's data. | pgTAP |
| AC-CTR-009 | Given the report screen, when changing the date range or grouping filter, then the data table and summary cards update accordingly. | Unit |
| AC-CTR-010 | Given the report rendered in Bahasa Indonesia, then all metric labels, department headers, and controls render in Bahasa Indonesia. | Unit |
| AC-CTR-011 | Given a phone viewport (375 px), then the summary cards stack cleanly and the table scrolls horizontally without layout break. | Unit |

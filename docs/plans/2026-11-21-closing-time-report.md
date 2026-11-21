# Plan: Closing-time report for issues by department (#2678)

**Date:** 2026-11-21
**Target:** 15 December 2026 (Map #2516, contractor field operations)
**Spec:** `docs/specs/closing-time-report.spec.md`
**Role:** Implementer / UI Implementer
**Size:** S

## 1. Scope & Objective

Build ticket #2678: "Closing-time report for issues by department".
Provides a report showing how long each department takes to close issues and where issues stall, using data the issue log (`incident_reports`) already holds.
Client-controlled settings: Date range and department grouping.
Zero impact on existing orgs: setting `enabled` defaults to false.

## 2. Technical Design

### A. Database Layer (Migration 1424)
- **File:** `supabase/migrations/1424_issue_closing_report.sql`
- **Reversal:** `supabase/migrations/rollback/1424_issue_closing_report_down.sql`
- **Tables:**
  1. `public.issue_closing_report_settings`:
     - `org_id uuid primary key references organizations(id) on delete cascade`
     - `enabled boolean not null default false`
     - `grouping_mode text not null default 'type' check (grouping_mode in ('type', 'department_groups'))`
     - `created_at timestamptz not null default now()`
     - `updated_at timestamptz not null default now()`
     - `updated_by uuid references profiles(id) default auth.uid()`
  2. `public.issue_department_groups`:
     - `id uuid primary key default gen_random_uuid()`
     - `org_id uuid not null default (select public.auth_org_id()) references organizations(id) on delete cascade`
     - `name text not null check (char_length(btrim(name)) between 1 and 100)`
     - `issue_types text[] not null default '{}'`
     - `created_at timestamptz not null default now()`
     - `updated_at timestamptz not null default now()`
     - Unique constraint: `(org_id, lower(btrim(name)))`
- **RLS & Security:**
  - Wrap helper calls with `(select public.auth_org_id())`, `(select public.is_active_member())`, `(select public.auth_role())`.
  - SELECT: all active members of the org.
  - INSERT/UPDATE/DELETE: Admin and Project Manager roles.
  - Automatic `stamp_org_id` trigger on insert.
- **RPC:**
  - `public.get_issue_closing_time_report(p_date_from date default null, p_date_to date default null, p_grouping_mode text default null)`
  - Returns table with:
    - `department text`
    - `total_issues bigint`
    - `closed_issues bigint`
    - `open_issues bigint`
    - `avg_closing_hours numeric`
    - `median_closing_hours numeric`
    - `overdue_issues bigint`
  - Calculates duration in hours as `extract(epoch from (closed_at - created_at)) / 3600.0`.
  - Median via `percentile_cont(0.5) within group (order by extract(epoch from (closed_at - created_at)) / 3600.0)`.

### B. Data Access Layer (DAL) & Repositories
- **DAL:** `pmo-portal/src/lib/db/issueClosingReport.ts`
  - `getIssueClosingReportSettings()`
  - `updateIssueClosingReportSettings(settings)`
  - `listIssueDepartmentGroups()`
  - `saveIssueDepartmentGroup(group)`
  - `deleteIssueDepartmentGroup(id)`
  - `getIssueClosingTimeReport(params: { dateFrom?: string; dateTo?: string; groupingMode?: 'type' | 'department_groups' })`
- **Repository Seam (ADR-0017):**
  - Contract in `pmo-portal/src/lib/repositories/contracts/issueClosingReport.ts`
  - Implementation in `pmo-portal/src/lib/repositories/issueClosingReport.ts`
  - Wire into `pmo-portal/src/lib/repositories/types.ts` and `pmo-portal/src/lib/repositories/index.ts`

### C. Hooks Layer
- **Hooks:** `pmo-portal/src/hooks/useIssueClosingReport.ts`
  - `useIssueClosingReportSettings()`
  - `useIssueDepartmentGroups()`
  - `useIssueClosingReport(params)`
  - Mutations for settings and department groups.

### D. UI Presentation
- **Component:** `pmo-portal/pages/incidents/ClosingTimeReport.tsx`
  - Date Range filter bar (quick presets: 30d, 90d, YTD, All Time, custom from/to).
  - Department Grouping toggle (By Issue Type vs By Department Groups).
  - Summary metric cards (Total Issues, Closed Issues, Avg Time to Close, Stalled/Overdue).
  - Responsive DataTable with columns: Department, Total, Closed, Open, Overdue (with amber warning indicator for stalled), Avg Time to Close, Median Time to Close.
  - Formatted durations (e.g., "1.5 days" / "12 hours").
- **Integration in `/incidents` (`pmo-portal/pages/Incidents.tsx`):**
  - Check `useIssueClosingReportSettings()`.
  - If `enabled = false`: baseline view only (no visual change).
  - If `enabled = true`: ViewToggle ("Register" | "Closing-time report") in page header, allowing switching views.
- **Route registration:**
  - Route `/incidents/closing-time` in `App.tsx` mapped to `ClosingTimeReport`.
- **Admin Settings:**
  - `pmo-portal/pages/admin/IssueClosingReportSettings.tsx` included in Administration settings so Admins can enable the report and configure Department Groups.

### E. Translations
- Add keys to `pmo-portal/public/locales/en/incidents.json` and `pmo-portal/public/locales/id/incidents.json`.
- Add admin settings keys to `administration.json`.

## 3. Test Strategy & Traceability

| AC | Owning Layer | Test Location |
|---|---|---|
| AC-CTR-001 | Unit | `pmo-portal/pages/Incidents.test.tsx` / `Incidents.closingReport.test.tsx` |
| AC-CTR-002 | Unit | `pmo-portal/pages/incidents/ClosingTimeReport.test.tsx` |
| AC-CTR-003 | pgTAP | `supabase/tests/1424_issue_closing_report.test.sql` |
| AC-CTR-004 | pgTAP | `supabase/tests/1424_issue_closing_report.test.sql` |
| AC-CTR-005 | pgTAP | `supabase/tests/1424_issue_closing_report.test.sql` |
| AC-CTR-006 | pgTAP | `supabase/tests/1424_issue_closing_report.test.sql` |
| AC-CTR-007 | pgTAP | `supabase/tests/1424_issue_closing_report.test.sql` |
| AC-CTR-008 | pgTAP | `supabase/tests/1424_issue_closing_report.test.sql` |
| AC-CTR-009 | Unit | `pmo-portal/pages/incidents/ClosingTimeReport.test.tsx` |
| AC-CTR-010 | Unit | `pmo-portal/pages/incidents/ClosingTimeReport.bahasa.test.tsx` |
| AC-CTR-011 | Unit | `pmo-portal/pages/incidents/ClosingTimeReport.test.tsx` |

## 4. Execution Steps

1. Commit and push spec and plan to `feat/2678-closing-time-report`.
2. Author pgTAP test `supabase/tests/1424_issue_closing_report.test.sql` (RED).
3. Author migration `supabase/migrations/1424_issue_closing_report.sql` and `rollback/1424_issue_closing_report_down.sql` (GREEN).
4. Run pgTAP test via VPS test runner.
5. Author DAL, repository seam, and hooks with unit tests.
6. Author ClosingTimeReport component, route, view toggle, and admin settings with unit tests.
7. Run all gates: guards, typecheck, eslint, vitest.
8. Verify everything is green, commit, push branch, and submit worker_done.

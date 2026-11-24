# Finance report project totals

- AC-RR-001 and AC-RR-002 belong to `supabase/tests/2300_reports_rollup.test.sql`. Compare report inputs against the shipped per-project readers on synthetic data. Migration 2300 adds the totals RPC. Migration 2301 removes the redundant full finance calculation from the existing cost reader. Both have reverse migrations.
- AC-RR-003 belongs to `pmo-portal/pages/ManagementPackEarned.test.tsx`. Exercise the page, query, repository and data access with a mocked RPC transport.
- Keep the report's display rules in `src/lib/earnedBilledProfit.ts`, shared with the project tab.

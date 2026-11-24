# Plan: Management views round (24 November 2026)

All tasks implement `docs/specs/management-views-1124.spec.md`. The single migration sequence is 2280–2289; every SQL change has a rollback. No local browser journeys or database reset. Run only changed Vitest files and the touched pgTAP files through the spare runner after pushing the branch.

| Task | Paths | Proof / AC |
|---|---|---|
| 1. Project portfolio read | `supabase/migrations/2280_project_management_overview.sql`, rollback, pgTAP; `pmo-portal/src/lib/db/milestones.ts`, repository contract/adapter/hook; project portfolio helper + tests | AC-MV-001 batch data, milestone counts, planned/actual, no N+1; AC-MV-001 unit ranking |
| 2. Executive home table | `pmo-portal/src/components/dashboard/hub/company/ProjectPortfolioTable.tsx`, `CompanyDashboard.tsx`, focused tests, dashboard translations | AC-MV-001 all project rows, sortable columns, project navigation, loading/error/empty |
| 3. Scoped work in hand | migration 2281 + rollback; `supabase/tests/work_in_hand.test.sql`; `policy.ts` + policy test; `App.tsx`, `WorkInHand.tsx`, `WorkOrdersBoard.tsx`, focused tests | AC-MV-002 server scope and count; AC-MV-003 role route and scoped total |
| 4. Unaccepted billing progress | migration 2282 + rollback and pgTAP; billing candidate DAL/repository/hook; `BillingPlan.tsx`, focused tests, finance en/id strings | AC-MV-004 exact quantity difference and independent group states |
| 5. Billing-board value totals | migration 2283 + rollback and pgTAP; `billingBoard.ts`, DB mapping, `BillingBoard.tsx`, focused tests, finance en/id strings; `docs/specs/billing-board.spec.md`, `docs/decisions.md`, glossary | AC-MV-005 exact currency totals and no card money; AC-MV-006 DB role gate |
| 6. Final targeted evidence | touched gates and tests only; `scripts/check:restated-functions` if applicable; `scripts/ux-proof.sh` on modified routes | Typecheck, guards, touched lint/unit/pgTAP; UI captures at 1440/390 in English/Bahasa |

Implementation notes:

- Reuse the existing batch `get_projects_delivery` result for actual schedule progress, the existing finance budget-review result for spend/active budget, and one new milestone batch read for planned progress and milestone counts.
- Keep each currency separate for board values. SQL returns the original amount text; TypeScript sums exact cents with `BigInt`.
- The Project Manager work-in-hand result and undated invoice count are scoped to assigned project IDs; never expose the organization-wide count to that role.
- If no accepted/milestone state can be represented without inventing an allocation rule, list it in the lane open file instead of guessing.

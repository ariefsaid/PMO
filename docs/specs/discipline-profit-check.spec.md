# Profit per project and per discipline with shared people and equipment: verification

Item `discipline-profit-check` (lane gap-billing). Status: **Draft, 2026-11-22**. ID: `AC-DPC-###`.
Verify-only: the shipped base answers the ask; this adds one acceptance test and no product code.

**Job story.** When people and equipment are not dedicated to one work order, I want profit per project and per
discipline, so I can see what each earns after the cost nobody booked to a single work order.

## 1. Finding (what the base does today)
- **Per project.** The project Work orders tab "Plan vs actual" card (`pages/project-detail/WorkOrderPlanVsActual.tsx`,
  total row) shows revenue, direct margin and result after shared cost. Roles: Admin, Executive, Finance, Project Manager
  (`workOrderPlan.view`, `src/auth/policy.ts`); others read "restricted". No organisation setting gates it.
- **Per discipline.** The "Profit per discipline" card (`pages/project-detail/DisciplineProfit.tsx`) shows revenue
  (validated progress at the frozen rate), direct cost, shared cost, margin before and after shared cost, and a project
  total row. Same roles, plus the organisation setting `organizations.discipline_profit_enabled`, **off by default**,
  Admin-only (DD-DPR-1; migration 1265). The earned-and-billed card follows the same switch (DD-EBR-1).
- **Shared cost.** Cost with no work order (booked people, equipment, bills) is the project's shared pool
  (FR-WPVA-020 to 023). It is split over work orders by their share of positive direct cost, or by a saved custom split
  (Admin, Executive, Finance), by largest remainder; with no positive direct cost it stays "Not assigned"
  (`allocateShared`, `src/lib/workOrderPlanVsActual.ts`). Each work order's share is split over its disciplines by their
  share of its direct cost (FR-WPVA-031), so project total = sum of disciplines + "Not assigned" (FR-WPVA-032).
- **People and equipment money.** A timesheet line or equipment entry counts as cost only where a rate exists: labour
  through the labour-costing setting (default off; migrations 1250 to 1252), equipment through a hire rate. A line with no
  rate shows hours, no money (reason `no-rate`), so it is neither a zero nor a guess.
- **Not covered by one test.** Unit tests prove the pieces (AC-DPR-009/010, AC-WPVA-004/011/012) but none composes
  work-order cost, an unattributed priced timesheet line and an unattributed equipment line through `rollupProject` into
  `disciplineProfit` and asserts that the discipline margins reconcile to the project figures.
- No real gap: nobody is shown a wrong figure; the only open item is the policy question below.

## 2. Open question (not built; no rule invented)
**Question.** Should shared cost reach a discipline by its work orders' share of direct cost (today), by revenue share, or
by a rate the customer sets per discipline?
**Recommended answer.** Keep direct-cost share as the default; offer the customer's own custom split per project as the
override (already built, Admin, Executive, Finance). Do not add a per-discipline rate until a customer asks.
**Shown meanwhile.** Shared cost in its own column, margin before and after it side by side, and "Not assigned" when no
direct cost exists to weigh by.

## 3. Requirement and acceptance criterion
- FR-DPC-001 Where a project has cost on work orders and cost with no work order (people, equipment), the margin per
  discipline after shared cost shall sum, with "Not assigned", to the project's revenue minus its total cost.

| AC | Given / When / Then | Owning layer |
|---|---|---|
| AC-DPC-001 | Given work orders A and B with direct cost in civil and electrical, plus an unattributed Approved-timesheet line and an unattributed equipment line, and validated revenue per discipline, when the roll-up and `disciplineProfit` are computed, then each discipline's shared cost is its work orders' direct-share allocation, and sum of margins after shared cost plus Not assigned equals total revenue minus the project's total cost, to the cent. | Unit (Layer-1 money test), `pmo-portal/src/lib/disciplineProfit.test.ts` |

Lowest sufficient layer: pure functions, no database. Mutation check: set the allocation in `allocateShared` to a fixed
share (e.g. `share := 0.5`) or drop the shared pool from the discipline total, and AC-DPC-001 goes red.

## 4. Settings
None added. Existing: `discipline_profit_enabled` (default off), labour costing (default off).

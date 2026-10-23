# Budget categories: Travel & accommodation and Vehicle (#1326)

Builds on #804 (Special expenses, migration 0229) and #768 (several ERP accounts per category, 0246).
Migration 0366. Rollback: `supabase/migrations/rollback/0366_budget_travel_vehicle_categories_down.sql`.

## Requirements

- **FR-TVC-001** The `budget_category` enum shall gain `Travel & accommodation` and `Vehicle`, appended after
  the eight existing values. Labels live in the `finance` namespace (`budgetCategory.travelAccommodation`,
  `budgetCategory.vehicle`), en and id.
- **FR-TVC-002** Admin → Accounting setup shall list both categories, and an Admin may map each to one or more
  ERP accounts (one push account, the rest actuals-only, as for every category). The budget push and mapped
  actuals treat them like every other category.
- **FR-TVC-003** When an active Admin calls `recategorise_budget_lines(p_line_ids, p_category)`, the system
  shall move the named lines from Special expenses to `p_category` (Travel & accommodation or Vehicle), all or
  nothing, audit each moved line (`budget_line.recategorise`), and return the number moved. It is reachable
  through the REST API and `pmo rpc` (active-Admin tier of the API-client guard).
- **FR-TVC-004** `pmo load` shall write a `Special expenses` line whose description names travel, hotel,
  tickets or per diem as Travel & accommodation, and one naming a vehicle or fuel as Vehicle. A line naming
  both, or neither, and every other category, is written as the file says. The line's import key still uses
  the file's category.
- **FR-TVC-005** While a budget version is Active or Archived, its lines shall not be re-categorised.
- **FR-TVC-006** *Mapped-actuals precedence.* An ERP account backs exactly one category
  (`unique (org_id, erp_account)`). During the accountant's reclass the old account stays under Special
  expenses and the new project accounts (519102 hotel, 519103 transport and travel, 519104 vehicle rental)
  sit under the new categories. Actuals sum each account's net, so a reclass journal moves the amount from one
  category to the other and the categories always add up to the mapped accounts. An account cannot be listed
  under two categories, so no tie-break is needed.

## Acceptance criteria

| AC | Given / When / Then | Owning test |
|---|---|---|
| AC-TVC-001 | Given the migration, when the enum is read, then the two values follow the eight existing ones, and each has a finance-namespace label | `supabase/tests/budget_travel_vehicle_categories.test.sql`; `pmo-portal/src/lib/i18n/budgetCategoryLabel.test.ts` |
| AC-TVC-002 | Given Accounting setup, when an Admin maps Travel & accommodation to 519102 (push) and 519103 and Vehicle to 519104, then those rows are written; when a budget is pushed, each category goes to its push account | `pmo-portal/pages/admin/BudgetAccountMap.test.tsx`; `pmo-portal/src/lib/adapterSeam/erpnext/budgetAccountPlan.test.ts` |
| AC-TVC-003 | Given Draft Special-expenses lines, when an Admin moves one or several, then only they change category and amounts are unchanged; Finance, a disabled Admin, another org, a non-Special line, a wrong target or an empty list are refused | `supabase/tests/budget_travel_vehicle_categories.test.sql` |
| AC-TVC-004 | Given an SBP load file, when it is loaded, then travel/hotel/ticket/per-diem lines are Travel & accommodation, vehicle/fuel lines are Vehicle, and a Draft loaded earlier is not loaded twice | `scripts/pmo-load.test.mjs` |
| AC-TVC-005 | Given an Active version, when any move names one of its lines (alone or in a batch), then the call is refused and every line of the version is unchanged | `supabase/tests/budget_travel_vehicle_categories.test.sql` |
| AC-TVC-006 | Given the old account under Special expenses and the new accounts under the new categories after a partial reclass, when mapped actuals are read, then each account counts once and the categories sum to the mapped nets | `supabase/tests/budget_travel_vehicle_categories.test.sql` |
| AC-TVC-007 | Given an OAuth API client, when it POSTs `recategorise_budget_lines`, then only an active Admin passes the guard | `supabase/tests/budget_travel_vehicle_categories.test.sql`; `scripts/pmo.test.mjs` |

## Rulings

- The move is restricted to Special expenses → the two new categories (the issue's scope); it is not a
  general category editor.
- Moving lines makes the Admin an editor of that Draft (DD-BUDGET-7), so a different person activates it.
- Lines already moved stay moved on rollback: a move is authored budget content, never reverted silently.

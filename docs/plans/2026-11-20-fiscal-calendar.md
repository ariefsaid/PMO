# Plan — fiscal calendar for organizations with no accounting system (#2329)

Spec: `docs/specs/fiscal-calendar.spec.md`. Branch `feat/2329-fiscal-calendar`. Migrations 1018–1019 (range 1018–1021).

## Design

```
organizations.fiscal_year_start_month (1..12 | NULL)          ← set_org_fiscal_year_start_month (Admin, no ledger)
        │
        ├─ org_pmo_fiscal_start_month()   NULL when unset OR org_reads_erp_ledger()  (D-3: the ERP keeps its calendar)
        ├─ pmo_fiscal_year_for_date(date, month)  → (name, start_date, end_date)      pure, immutable
        ├─ pmo_fiscal_year_by_name(text, month)   → the span, or no row               pure, immutable
        └─ get_pmo_fiscal_calendar(project)       → BudgetProjectFiscalCalendar jsonb (the ERP read's shape)

get_budget_comparison(project, year)  — PMO branch only:
   year NULL               → project_pmo_paid_by_category(project, NULL, NULL)        (unchanged figure)
   year = a PMO year name  → project_pmo_paid_by_category(project, start, end)        (new year cut)
   otherwise               → recorded NULL                                            (0897 behaviour)

project_pmo_paid_by_category(project, from, to)
   paid purchases: procurement_paid_pre_tax_between(pr, from, to)  — the 0560 pre-tax ratio over payments in window
   hire charge:    equipment_charge_project_actuals_between(project, from, to) — work month in window
   The one-argument helper (0897) becomes a call to the three-argument one with no window: one definition.
```

Frontend: `fetchPmoFiscalCalendar` (repository, RPC) feeds the existing `calendarQuery` in `BudgetProjection.tsx` on the
PMO basis, so the year picker, default year and Forecast run the same path as an ERP calendar. Administration ›
Accounting gains `OrgFiscalYearStart` (SelectField, `can('manage','orgAccounting')`).

No new table, so no isolation fixture. The write is a security-definer RPC with the role, membership and basis checks
inside it, proven by pgTAP and mutation-checked.

## Tasks

1. **pgTAP red** — `supabase/tests/1018_fiscal_calendar.test.sql` (AC-FCAL-001…010). Run:
   `npx supabase@2.122.1 test db supabase/tests/1018_fiscal_calendar.test.sql` → fails (functions missing).
2. **1018 migration** — `supabase/migrations/1018_org_fiscal_calendar.sql` + `rollback/1018_org_fiscal_calendar_down.sql`:
   column, pure helpers, `org_pmo_fiscal_start_month`, `set_org_fiscal_year_start_month`, `get_pmo_fiscal_calendar`.
3. **1019 migration** — `supabase/migrations/1020_budget_comparison_fiscal_year_cut.sql` + rollback: windowed helpers,
   `project_pmo_paid_by_category(uuid,date,date)`, one-argument helper delegates, `get_budget_comparison` PMO branch.
4. **pgTAP green** + regression: `supabase/tests/0897_budget_comparison_no_ledger.test.sql`,
   `supabase/tests/budget_whole_project_comparison.test.sql`. Mutation checks M1–M3 (below).
5. **Types** — add the column and the three RPCs to `pmo-portal/src/lib/supabase/database.types.ts`.
6. **Repository red→green** — `fetchPmoFiscalCalendar` in `src/lib/repositories/budgetProjection.ts`
   (test: `budgetProjection.test.ts`), `getFiscalCalendar` / `setFiscalYearStartMonth` on `orgSettings`
   (`src/lib/db/orgs.ts`, `repositories/admin.ts`, contract).
7. **Budget tab red→green** — `pages/BudgetProjection.test.tsx` AC-FCAL-011/012/013, then `BudgetProjection.tsx`.
8. **Admin setting red→green** — `pages/admin/OrgFiscalYearStart.test.tsx` AC-FCAL-014, then the component and its
   slot in `pages/Administration.tsx`; strings in `public/locales/{en,id}/`.
9. **Glossary** — *Fiscal calendar*, *Fiscal year start month*.
9a. **Inventories** — `supabase/tests/0178_anon_executable_definers.test.sql`: the setter joins the retained client
    writer set (+1, 180). Month names come from the format seam (`formatUtcMonthLong` in `src/lib/format.ts`).
10. **Gates** — check:guards, typecheck, eslint on touched files, `vitest related`, pgTAP files.

## Traceability

| AC | Owning layer | Test |
|---|---|---|
| AC-FCAL-001…010 | pgTAP | `supabase/tests/1018_fiscal_calendar.test.sql` |
| AC-FCAL-011…013 | Vitest/RTL | `pmo-portal/pages/BudgetProjection.test.tsx` |
| AC-FCAL-014 | Vitest/RTL | `pmo-portal/pages/admin/OrgFiscalYearStart.test.tsx` |

No e2e: every AC is owned below the browser (ADR-0010); the cross-stack seam is one RPC whose contract pgTAP proves
and whose response the repository validates.

## Mutation checks

- **M1 role** — `set_org_fiscal_year_start_month` accepts any role → AC-FCAL-003 red.
- **M2 basis** — drop the ledger refusal → AC-FCAL-004 red.
- **M3 placement** — use `<` for `>=` on the window start → AC-FCAL-005 red.

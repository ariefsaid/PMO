# Fiscal calendar for organizations with no accounting system (#2329)

Map: #894. Follows #2325 (the Budget tab's comparison without an accounting system).

## Job story

When my organization keeps its books outside any connected accounting system and our year runs April to March,
I want PMO to place each payment in the right fiscal year by its date,
so the Budget tab shows what we spent in each budget year instead of "Spending is not split by year yet".

## Context and prior art

- `get_budget_comparison` (0580, 0897) splits recorded spending by fiscal year only for an organization that reads
  an accounting-system ledger (`org_reads_erp_ledger()`, 0765). Without one, a year scope's recorded figure is NULL
  ("no fiscal calendar, and year labels are never parsed into dates", 0897).
- The ERP's calendar reaches the Budget tab through `external-items` / `budget-project-calendar`
  (`supabase/functions/external-items/projectFiscalCalendar.ts`) as a `BudgetProjectFiscalCalendar`. That stays the
  calendar wherever the organization reads an accounting system.
- Budget years are free-text labels (`budget_line_items.fiscal_year`, `budget_year_distributions.fiscal_year`).
  A budget year maps to a PMO fiscal year by **name**, never by parsing an arbitrary label.
- PMO paid spending per category is `project_pmo_paid_by_category` (0897): paid purchases pre-tax
  (`procurement_paid_pre_tax`, 0560) plus the internal hire charge (`equipment_charge_project_actuals`).

## Decisions

- **D-1 One setting, derived years.** The calendar is one value: the month the fiscal year starts
  (`organizations.fiscal_year_start_month`, 1–12, NULL = not set). Years are computed, never stored, so there is no
  new table and no per-year maintenance.
- **D-2 Year names.** A fiscal year starting in January is named by its year (`2027`); any other start month is named
  `<start year>-<end year>` (`2026-2027` = 2026-04-01..2027-03-31). This is the naming an accounting system that is
  connected later most commonly uses, so labels survive a later connection.
- **D-3 The accounting system keeps its calendar.** Where the organization reads an accounting-system ledger, PMO's
  setting is refused and ignored; the ERP calendar and ledger figures are untouched.
- **D-4 A payment's date decides its year.** A purchase's paid pre-tax amount is split across years in proportion to
  its payments' amounts in each year (the same pre-tax ratio as the all-years figure). A paid payment with no date
  cannot be placed, so that purchase's category is unknown in every year scope (it still counts in All years).
- **D-5 Hire charges by work month.** The internal hire charge is already grouped by work month; a month belongs
  wholly to one fiscal year because fiscal years start on the first of a month.
- **D-6 Changing the start month re-cuts history.** Because years are derived, a change applies to every past
  payment at once. Budget years named for the old calendar then match no fiscal year and say so. The Admin setting
  states this before saving.

## Requirements (EARS)

- **FR-FCAL-001** The system shall let an Admin of an organization that reads no accounting-system ledger set or clear
  the month its fiscal year starts.
- **FR-FCAL-002** When anyone other than an active Admin of that organization tries to change the start month, the
  system shall refuse the change.
- **FR-FCAL-003** While the organization reads an accounting-system ledger, the system shall refuse a start-month
  change and shall not use a stored start month anywhere.
- **FR-FCAL-004** The system shall place a date in the fiscal year whose start is the latest first-of-the-start-month
  on or before that date, named per D-2.
- **FR-FCAL-005** When a budget-year label equals the name of a fiscal year under the organization's calendar, the
  system shall treat that budget year as that fiscal year; any other label matches no fiscal year.
- **FR-FCAL-006** When the Budget tab comparison is read for a fiscal year of the organization's calendar, the system
  shall report per category the PMO paid spending whose payment dates fall in that year (D-4) plus the hire charge of
  its work months (D-5); a category with none is a known zero.
- **FR-FCAL-007** When the scope is a label that is not a fiscal year, or no start month is set, the system shall keep
  the year scope's recorded figure unknown (0897 behaviour).
- **FR-FCAL-008** The system shall serve each visible project's PMO fiscal calendar in the `BudgetProjectFiscalCalendar`
  shape: the consecutive fiscal years covering the project's dates.
- **FR-FCAL-009** While the organization has a PMO calendar, the Budget tab shall open on the current fiscal year and
  offer each fiscal year, exactly as it does with an accounting-system calendar.
- **FR-FCAL-010** Where no PMO calendar is set, the Budget tab shall keep opening on All years with "Spending is not
  split by year yet" (0897 behaviour).
- **FR-FCAL-011** When a selected budget year is not a fiscal year of the calendar, the Budget tab shall say spending
  cannot be placed in it.
- **NFR-FCAL-001** Every amount is in the project currency; nothing is converted (0897 rules carry over).
- **NFR-FCAL-002** English and Bahasa Indonesia strings.

## Acceptance criteria (Given/When/Then)

- **AC-FCAL-001** Given a fiscal year starting in April, when PMO places 2027-03-31, then it is in `2026-2027`
  (2026-04-01 to 2027-03-31), and 2027-04-01 is in `2027-2028`; with a January start 2027-03-31 is in `2027`.
- **AC-FCAL-002** Given an April start, when the labels `2026-2027`, `2026`, `FY26` and `2026-2028` are matched, then
  only `2026-2027` is a fiscal year (2026-04-01 to 2027-03-31).
- **AC-FCAL-003** Given an organization with no accounting system, when its Admin sets April, then the setting is
  stored and audited; when a Finance user or a member of another organization tries, or the month is 13, then it is
  refused and nothing changes.
- **AC-FCAL-004** Given an organization that reads an accounting-system ledger, when its Admin sets a start month, then
  it is refused, and its comparison and calendar are unaffected by any stored value.
- **AC-FCAL-005** (the ticket's done-when) Given an April start and Labor paid 1,000 on 2027-03-31 and 400 on
  2027-04-01, when the comparison is read for `2026-2027`, then Labor recorded is 1,000; for `2027-2028` it is 400;
  and the years add up to All years (1,400).
- **AC-FCAL-006** Given the same organization, when a year has no payment, then its recorded is a known 0; when the
  scope is `FY26`, then recorded is unknown; given an organization with no start month, then a year scope's recorded
  stays unknown.
- **AC-FCAL-007** Given a taxed purchase paid in two years, when each year is read, then each year counts its share
  before tax and the shares add up to the all-years figure.
- **AC-FCAL-008** Given approved hire usage in March 2027 and April 2027, when each year is read, then each charge is in
  its own year.
- **AC-FCAL-009** Given a paid payment with no date, when a year is read, then that category is unknown in the year and
  still counts in All years.
- **AC-FCAL-010** Given a project running 2026-06-01 to 2027-08-31 and an April start, when its PMO calendar is read,
  then it is resolved with `2026-2027` and `2027-2028`; with no end date it holds only the start year; with no start
  month it is not resolved; for another organization's project it returns nothing.
- **AC-FCAL-011** Given a PMO calendar on the Budget tab, when it opens, then it opens on the current fiscal year and
  the Spent column shows the year's recorded figure, not "Spending is not split by year yet".
- **AC-FCAL-012** Given no PMO calendar, when the Budget tab opens, then it opens on All years and keeps the
  not-split message.
- **AC-FCAL-013** Given a selected budget year that is not a fiscal year of the calendar, then the tab says spending
  cannot be placed in it.
- **AC-FCAL-014** Given Administration › Accounting, when an Admin of an organization with no accounting system picks
  April and saves, then the setting is saved; a non-Admin sees the value read-only; where an accounting system is
  read, the section says that system sets the fiscal year.

## Out of scope

- **Financial statements.** Statements are built only from an accounting system's ledger (ADR-0088); an organization
  without one has none to cut. The calendar is ready for them when a PMO-native statement exists.
- **Whole-project budget distributions** for an organization with no accounting system: the distribution editor still
  takes its years from the accounting-system calendar. Serving the PMO calendar there is a follow-up.
- Per-year commitments: commitments stay project-wide (they carry no date of their own on this basis).

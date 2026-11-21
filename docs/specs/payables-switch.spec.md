# Payables — unpaid supplier invoices with ageing, behind the `payables` switch — issue 1861

Status: **draft for owner sign-off** · Map: #1718 · Builds on `plans-and-feature-switches.spec.md` (D6, D17, catalogue row `payables`).

**Job story.** When a supplier invoice has been recorded against a procurement case and not yet paid, I want one list of what we owe, aged by invoice date, company-wide and per project, so I can decide what to pay first and see each project's open payables without an ERP.

## Current behaviour at origin/dev

- `/finance/payables` exists (`pmo-portal/pages/finance/PayablesPage.tsx`), built from procurement cases at *Vendor Invoiced* (`isProcurementReadyToPay`, `pages/finance/PayablesPage.tsx:78`), unpaid balance via `supplierUnpaid` (`src/lib/procurement/procurementMoney.ts:138`), age from the earliest supplier invoice date, buckets 0–30 / 31–60 / 61–90 / over 90 (`AgeingStrip kind="payables"`), search, overdue toggle, export, per-currency totals, unknown balances counted not zeroed.
- The route and nav item are gated by the **`procurement`** switch (`App.tsx` route table, `Rail.tsx`, `routeMatch.ts`), not by a `payables` switch. No `payables` key exists in `FEATURE_KEYS` (`src/lib/features.ts`) or in the DB switch registry (`org_features` check constraint, `plan_features`, `global_features`; latest definitions in `0531`/`0533`).
- The catalogue row `payables` (Starter off; Growth, Pro, Enterprise on) is specified but not implemented.
- There is no project filter on the page and no payables figure on a project's money section (`ProjectFinancesSection` / `MoneyBlock`).
- `erp_purchases` (Pro) is a separate ERP-sourced screen and is unchanged. `usePayablesPagePosition` already folds linked ERP documents into the balance of a case; that behaviour stays.

## Requirements (EARS)

- **FR-PAY-001.** The system shall register a `payables` switch in the code registry and the database registry, placed Growth and above (Starter off), globally on, per the catalogue.
- **FR-PAY-002.** While `payables` is off for an org, the system shall hide the Payables nav item, block `/finance/payables` (same blocked-route behaviour as other switches), and hide the project payables figure. (D6)
- **FR-PAY-003.** While `payables` is on, `/finance/payables` and its nav item shall be reachable by the same roles as today (Executive, Finance, Admin); the `procurement` switch shall no longer gate them.
- **FR-PAY-004.** When Finance opens payables, the page shall list one row per procurement case at *Vendor Invoiced* with an unpaid balance, showing supplier, project, invoice date, amount and days outstanding. *(New: an explicit invoice-date column; today only age in days is shown.)*
- **FR-PAY-005.** When a case moves to *Paid*, it shall leave payables, its total and its ageing buckets. *(Exists; now covered by an AC.)*
- **FR-PAY-006.** The ageing buckets shall be the same boundaries and presentation as the receivables screen, aged by invoice date, per currency. *(Exists; locked by a shared-boundary test.)*
- **FR-PAY-007.** When a project is chosen in a project filter (`?project=<id>`, URL-owned), the list, totals and ageing shall be restricted to that project. *(New.)*
- **FR-PAY-008.** The project money section shall show that project's open payables total per currency, linking to `/finance/payables?project=<id>`; unknown balances are counted, never added as zero. *(New.)*
- **FR-PAY-009.** Where `erp_purchases` is on, that screen shall behave as before; payables shall not read from it except through the existing linked-document balance.
- **FR-PAY-010.** The assistant read tool for payables (if one is registered for the finance area) shall be removed from the tool set while `payables` is off (D6, D13).

## Acceptance criteria

- **AC-PAY-001.** Given two Vendor Invoiced unpaid cases on project A and one Paid case, when Finance opens payables, then two rows show, aged by invoice date, totalling their amounts.
- **AC-PAY-002.** Given `payables` is off for the org, when any user visits `/finance/payables`, then the route is blocked and no Payables nav item renders.
- **AC-PAY-003.** Given `payables` is on and `procurement` is on, when Finance opens the page, then it renders; given an org on Starter, then the switch resolves off.
- **AC-PAY-004.** Given a case is marked Paid, when the list refreshes, then it is absent from rows, total and buckets.
- **AC-PAY-005.** Given invoices 10, 45, 75 and 120 days old, then they fall in 0–30, 31–60, 61–90 and over 90 respectively, and receivables and payables share the boundary constants.
- **AC-PAY-006.** Given cases on projects A and B, when `?project=A` is set, then only A's rows, total and buckets show, and Back/refresh keep the filter.
- **AC-PAY-007.** Given project A has two unpaid cases, when a finance-role user opens project A, then its money section shows their total and a link to the filtered page; given `payables` off, then the figure is absent.
- **AC-PAY-008.** Given one unpaid case with no known amount, then it is counted as unknown, shown in the note, and not added to any total.
- **AC-PAY-009.** Given the DB registry, when migrations apply, then `payables` is accepted by `org_features`, Starter resolves off, Growth/Pro/Enterprise on, and a global off beats an org on.
- **AC-PAY-010.** Given `payables` off, then the assistant payables read tool is not offered.

## Out of scope

New payment recording, ERP push, the `erp_purchases` screen, vendor withholding, line-level match (`procurement_full`).

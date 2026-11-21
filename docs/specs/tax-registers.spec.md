# Tax registers for the monthly returns (#898)

> Map #894 (month-end close when the ERP is headless). Owner frame: OD-ERP-3 / OD-ERP-4 (tax registers are a
> first-month-end item). Inputs already shipped: vendor withholding (#876, ADR-0082/0084), e-Faktur number and date
> (#893, DD-EFK-1/2), vendor withholding slips (#911), receipt withholding with slip number and article (#762, #1275).
> Plan: `docs/plans/2026-11-15-tax-registers.md`. Read-only: no new write path, no ERP call.

## 0. Job story

When Finance prepares the monthly returns, I want to list, for a chosen month, the output VAT on sales invoices against
the input VAT on vendor bills, the withholding slips customers issued to us with each one checked against the expected
rate, and the withholding we owe on vendor bills, so that I can fill the returns from PMO without opening the ERP or
re-keying figures.

## 1. What exists today vs what is new

**Exists (stored per row, no register):**
- `sales_invoices`: `tax_amount`, `tax_rate`, `tax_treatment`, `efaktur_number`, `efaktur_date` (0188, 0272).
- `procurement_invoices` (vendor bills): `tax_amount` (VAT), `withheld_amount`, `withheld_pph_type` (`pph23`|`pph4_2`),
  `efaktur_number`, `efaktur_date` (0196, 0266, 0272, 0273).
- `incoming_payments` (receipts): `withheld_amount`, `withholding_slip_number`, `withholding_article`, `received_amount`
  (0232, 0811).
- `vendor_withholding_slips` + `vendor_withholding_slip_bills`: slips we issue to vendors per tax period (0281/0282).
- Pages `pages/finance/ReceivablesPage.tsx`, `PayablesPage.tsx`, Finance hub; no tax-return view.

**New:** one read-only Tax registers screen under Finance with three registers for a selected month, per-register totals,
a CSV export, and the read functions behind them.

## 2. Scope

**In:** (A) VAT register — output vs input VAT, grouped by e-Faktur date month; (B) customer withholding register — slips
received, with an expected-rate check; (C) vendor withholding register — withholding owed on vendor bills for the month,
with the slip reference where one exists.
**Out:** posting/filing to the tax office; e-Bupot or e-Faktur file formats; editing any figure (existing setters own
that); year-end; multi-currency conversion (figures stay in each document's currency, one total row per currency).

## 3. Requirements (EARS)

- **FR-TAXREG-001** The system shall provide a Tax registers screen at `/finance/tax-registers` with a month selector
  defaulting to the previous calendar month.
- **FR-TAXREG-002** While the user's real JWT role is Admin or Finance, the system shall show the screen; for any other
  role the route and the read functions shall refuse (RLS/definer role check is the authority, `can()` is UX only).
- **FR-TAXREG-003** The VAT register shall list sales invoices (output) and vendor bills (input) whose e-Faktur date falls
  in the selected month, showing document number, counterparty, e-Faktur number, e-Faktur date, net, VAT and currency.
- **FR-TAXREG-004** When a VAT-bearing, non-cancelled invoice or bill has no e-Faktur number/date, the system shall list it
  in an "Awaiting e-Faktur" group (by document date in the month), not omit it.
- **FR-TAXREG-005** The VAT register shall total output VAT, input VAT and their difference per currency, never mixing
  currencies.
- **FR-TAXREG-006** Cancelled documents shall be excluded from every register.
- **FR-TAXREG-007** The customer withholding register shall list receipts in the month with `withheld_amount > 0`:
  receipt date, customer, invoice, withholding article, slip number, amount withheld, and the expected amount.
- **FR-TAXREG-008** Expected withholding shall equal the invoice net amount × the article's configured rate; when the
  receipt's withheld amount differs by more than 1 currency unit (rounding tolerance), the row shall be flagged
  "differs from expected" and show the difference.
- **FR-TAXREG-009** A receipt with withheld amount but no slip number shall be flagged "slip missing".
- **FR-TAXREG-010** The vendor withholding register shall list vendor bills in the month with `withheld_amount > 0`
  grouped by `withheld_pph_type`: vendor, bill number, tax base, withheld amount, and the covering active slip number or
  "no slip yet"; totals per type and currency.
- **FR-TAXREG-011** Registers shall be reads only: no register control may write, and each figure shall equal the stored
  document value (no recomputation of VAT or withholding except the expected-rate check in FR-TAXREG-008).
- **FR-TAXREG-012** Where a register exceeds one page the system shall page by keyset cursor and totals shall cover the
  whole month, not the visible page.
- **FR-TAXREG-013** The user shall be able to export each register's full month as CSV; amounts as plain decimals, dates
  ISO, text cells protected against spreadsheet formula injection.
- **FR-TAXREG-014** Each register shall render empty, loading and error states with plain-language copy in both locales.
- **FR-TAXREG-015** Every read shall be scoped to the caller's organization by the existing tenancy seam; no `org_id` is
  passed from the client.

## 4. Acceptance criteria (Given/When/Then)

- **AC-TAXREG-001** Given a Finance user, when they open Tax registers, then the previous month is selected and the three
  registers load. (FR-001, 002)
- **AC-TAXREG-002** Given a user in a non-Finance/Admin role, when they request the route or call a register function,
  then they see the access-denied state / the function refuses. (FR-002)
- **AC-TAXREG-003** Given a sales invoice with VAT 110 and e-Faktur date in the month and a vendor bill with VAT 40 in the
  same month, when the VAT register loads, then output 110, input 40, difference 70 show for that currency. (FR-003, 005)
- **AC-TAXREG-004** Given a VAT invoice without e-Faktur data, when the register loads, then it appears under Awaiting
  e-Faktur and not in the dated list. (FR-004)
- **AC-TAXREG-005** Given a cancelled invoice and a cancelled bill, when any register loads, then neither appears.
  (FR-006)
- **AC-TAXREG-006** Given invoices in IDR and USD, when the VAT register loads, then totals are separate per currency.
  (FR-005)
- **AC-TAXREG-007** Given a receipt withholding exactly the expected amount, when the customer register loads, then it
  shows no flag. (FR-007, 008)
- **AC-TAXREG-008** Given a receipt withholding less than expected beyond tolerance, then the row is flagged with the
  difference. (FR-008)
- **AC-TAXREG-009** Given a withholding receipt with no slip number, then the row is flagged "slip missing". (FR-009)
- **AC-TAXREG-010** Given vendor bills withholding PPh 23 and PPh 4(2), one covered by an active slip and one not, then
  rows group by type, show the slip number or "no slip yet", with per-type totals. (FR-010)
- **AC-TAXREG-011** Given a voided slip, then its bills show "no slip yet". (FR-010)
- **AC-TAXREG-012** Given more than one page of rows, then page 2 loads by cursor and the total equals the sum of all
  pages. (FR-012)
- **AC-TAXREG-013** Given a register, when the user exports CSV, then the file has every row of the month and a cell
  beginning with `=` is neutralized. (FR-013)
- **AC-TAXREG-014** Given a month with no data, then each register shows its empty state; given a failed read, then an
  error state with retry. (FR-014)
- **AC-TAXREG-015** Given a second organization's documents, when the first org reads any register, then none appear.
  (FR-015)
- **AC-TAXREG-016** Given the screen, then no control writes and each shown figure equals the stored document value.
  (FR-011)

## 5. Open points

Decided in the plan's owner questions: where the expected rate comes from; whether the VAT register groups by e-Faktur
date or document date; whether to ship all three registers in one slice.

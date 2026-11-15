# Left to bill — one derivation for report tiles, rows and home (#2203)

Scope: arithmetic ownership of the **Left to bill** figure in the monthly management pack
(`docs/specs/monthly-management-pack.spec.md`, ADR-0076). Not in scope: which historical rows the pack
reads (#2201), the recognition basis itself, or any database change.

## Problem

Left to bill is contract value less invoiced to date. The pack's own month field `backlog` held a
different measure, contract value less **recognised** to date (DD-MMP-3), and every screen that showed
Left to bill re-derived the right number itself on top of it: the report rows, the per-currency totals,
the headline tile, the export and the home figure each carried their own override. A reader who took
the pack's field at its name got the wrong amount whenever progress recognition differed from invoicing.

## Terms

- **Left to bill** — signed contract value (net of tax) less invoiced to date, for contract rows, in the
  contract currency, at a month. It does not depend on the recognition basis.
- **Remaining work** — signed contract value less recognised to date (DD-MMP-3's measure, previously named
  "backlog"). It follows the recognition basis (progress, earned value or invoiced, ADR-0076).

## Requirements

- **FR-LTB-001** (ubiquitous) The management pack shall carry Left to bill as a named field on every row
  month and every per-currency totals month, derived once inside `src/lib/reports/managementPack.ts`.
- **FR-LTB-002** (ubiquitous) The pack shall carry Remaining work as a separate named field; it shall not
  be labelled or shown as Left to bill.
- **FR-LTB-003** (event-driven) When the report renders its headline tile, project rows, per-currency
  totals or export, or the home dashboard renders its Left to bill figure or per-project list, each shall
  read the pack's Left to bill field or `leftToBillAt` over it, and shall not recompute it from contract
  and invoiced values.
- **FR-LTB-004** (state-driven) While a contract project has an invoice in another currency awaiting
  reconciliation, its Left to bill and Remaining work shall be unknown (null), and any total that
  includes that row shall be unknown — never 0.
- **FR-LTB-005** (state-driven) While a currency has no contract rows, its Left to bill total shall be 0
  (no signed contract leaves nothing to bill).
- **FR-LTB-006** (ubiquitous) Rows without a contract (other-currency, unassigned) shall have null Left
  to bill and null Remaining work.

## Acceptance criteria

- **AC-LTB-001** Given one IDR contract of 1,000,000 with 60% complete recorded and 200,000 invoiced as at
  the month, When the pack is built, Then the row's Left to bill is 800,000 and its Remaining work is
  400,000; and the report tile, the project row cell, `leftToBillAt`, the home Left to bill total and the
  home per-project list all read 800,000 for that month and currency.
- **AC-LTB-002** Given the same contract with a USD invoice awaiting reconciliation, When the pack is built,
  Then the row and IDR totals Left to bill are null, the home total is null, and the project is absent
  from the home per-project list; no surface shows 0.
- **AC-LTB-003** Given a contract with no progress recorded (invoiced basis), When the pack is built, Then
  Left to bill equals Remaining work equals contract less invoiced, and the basis stays `invoiced`.

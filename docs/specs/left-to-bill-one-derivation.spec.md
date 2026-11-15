# Left to bill — one derivation for report tiles, rows and home (#2203)

Scope: arithmetic ownership of the **Left to bill** figure in the monthly management pack
(`docs/specs/monthly-management-pack.spec.md`, ADR-0076). Not in scope: which historical rows the pack
reads (#2201) or the recognition basis itself. One database change (0919) adds a flag to the pack's
project facts; which projects the pack returns is unchanged.

## Problem

Left to bill is contract value less invoiced to date. The pack's own month field `backlog` held a
different measure, contract value less **recognised** to date (DD-MMP-3), and every screen that showed
Left to bill re-derived the right number itself on top of it: the report rows, the per-currency totals,
the headline tile, the export and the home figure each carried their own override. A reader who took
the pack's field at its name got the wrong amount whenever progress recognition differed from invoicing.

## Terms

- **Left to bill** — signed contract value (net of tax) less invoiced to date, for contracts we hold, in the
  contract currency, at a month. It does not depend on the recognition basis.
- **Held contract** — a project on an on-hand status and not archived: the same set as Contract on hand,
  independent of the selected period. The pack also returns closed or archived projects billed in the
  window; those are not held.
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
- **FR-LTB-007** (ubiquitous) Left to bill shall count only held contracts; the per-project lines and every
  total shall come from that one set, so a project is in both or neither. A row that is not held shows no
  Left to bill (a plain dash, not the unknown reason) and its reconciliation state does not make a total
  unknown. Remaining work and the other measures keep their existing row set.
- **FR-LTB-008** (ubiquitous) The pack's project facts shall carry `on_hand` (0919); a project without the
  flag shall not count as held (only the server knows whether it is archived).

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
- **AC-LTB-004** Given the contract above plus an archived project and a lost project each billed in the
  window, When the pack is built, Then their rows carry no Left to bill, the IDR total, tile, home total
  and home list read 800,000 for the held contract alone, and building the pack from a later start month
  (the unheld projects drop out, the held contract's invoice moves before the window) gives the same Left
  to bill at the same month.

## Traceability

| AC | Owning test |
|---|---|
| AC-LTB-001 | `pmo-portal/pages/__tests__/ManagementPack.leftToBill.test.tsx` (tile, row, home) · `src/lib/reports/managementPack.test.ts` (pack) |
| AC-LTB-002 | same two files |
| AC-LTB-003 | `src/lib/reports/managementPack.test.ts` |
| AC-LTB-004 | `src/lib/reports/managementPack.test.ts` (set, period, missing flag) · `ManagementPack.leftToBill.test.tsx` (screen) · `supabase/tests/0919_pack_on_hand_after_billed_totals.test.sql` (flag) |

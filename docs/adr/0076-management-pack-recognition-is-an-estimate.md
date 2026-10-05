# ADR-0076 — Management-pack revenue recognition is a PMO estimate over billing, not a ledger

- **Status:** Proposed (2026-10-06, issue #765)
- **Related:** ADR-0048 (ERPNext is the accounting engine), ADR-0055 (external system is the source of
  truth per domain; PMO keeps read models and additive enhancements), ADR-0017 (repository seam),
  OD-TAX-1 / migration 0197 (net-of-tax normalisation), DD-CUR-6 (per-currency, never converted).
- **Spec:** `docs/specs/monthly-management-pack.spec.md` (DD-MMP-1..6).

## Context

The monthly management pack needs "recognised revenue" per project and month, and "unbilled" =
recognised − invoiced. PMO holds invoices (ERP-mirrored or native), contract values with their tax basis,
project dates and milestone weights. It holds no history of progress and no revenue ledger. The first
client's books recognise revenue on billing at the tax-exclusive base and have no unbilled-revenue
account, so a ledger-faithful pack would show unbilled = 0 forever.

Two directions were possible:

1. **Recognise in the ledger.** Post accruals / contract assets to ERPNext from PMO. Rejected: it moves
   accounting policy into PMO, contradicts ADR-0048 (ERP is the engine) and the client's own practice,
   and every posted accrual becomes an outbox money command with SoD — a large surface for a report.
2. **Estimate in PMO, beside the ledger.** Default to billing basis (equal to the books), and let Finance
   or the project's PM state a month-end percent complete that switches that project to progress basis
   in the pack only.

## Decision

Option 2.

- Recognised to date at month *m* = latest `project_progress_entries.pct_complete` dated ≤ *m* × net
  contract value; with no such entry, = invoiced to date net of tax. Recognised in month = difference of
  consecutive month-end figures.
- `project_progress_entries` is a new PMO-owned table: one row per project per month, RLS-scoped,
  org-stamped, recorder stamped server-side. It is never pushed to any external system and no external
  domain owns it.
- The pack's figures are computed from facts returned by one SECURITY INVOKER RPC
  (`get_management_pack`) — RLS stays the tenancy boundary — and derived in a pure TypeScript function
  in integer cents. The SQL side does the money normalisation (0197's net formula) so there is one place
  that decides what an invoice is worth; TypeScript does the time-series arithmetic.
- The UI labels every figure "excl. PPN" and the recognition basis per row ("Invoiced" or "n% complete").

## Consequences

- The pack equals the client's books for every project nobody has recorded progress on — the safe default.
- "Unbilled" is a management judgement, visibly attributed (who/when per entry), not an accounting fact.
  Anyone reading it as a contract asset in the GL is wrong; the page subtitle and this ADR say so.
- No new money path, outbox command, SoD gate or ERP mapping.
- Overwriting a month's entry keeps only the latest value (with its recorder). If audit history of
  estimates is later needed, add an append-only history table; the read path does not change.
- If a client ever wants recognition in the ledger, that is a new ADR on the ERP side; this table can
  feed it but does not become it.
- The net-of-tax CASE expression now lives in four places (0197's two, the drawdown gate, and this RPC).
  A shared immutable SQL helper is a worthwhile behaviour-neutral follow-up; not done here to avoid
  touching money-gate functions in a reporting change.

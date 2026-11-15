# ADR-NNNN — One ledger seam for the accountant's desk; three ledgers over time

- **Status:** Proposed (design for owner sign-off, 2026-11-15). Number allocated at merge.
- **Related:** spec `docs/specs/accountants-desk.spec.md`; ADR-0048 (ERP as accounting engine), ADR-0055 (adapters,
  ownership map), ADR-0058 (money outbox), ADR-0094 (PMO as the only interface; Odoo Community baseline), ADR-0097
  (PMO stock sub-ledger, one writer), ADR-0016/0017/0019 (authorization, repository seam, server-enforced SoD),
  OD-VISION-ERP (`docs/decisions.md:3692`); issues #894, #895, #896, #899, #900, #2163.

## Context

A client starts on Odoo Community 20 as a hidden ledger: nobody, the accountant included, opens it. Operational money
already posts through PMO's adapters and outbox (`pmo-portal/src/lib/adapterSeam/dispatch.ts:664`;
`supabase/migrations/0096_erpnext_seam_tables.sql:47`). What has no home is the accountant's own work: manual journals,
bank reconciliation, fixed assets and depreciation, tax registers, month-end and year-end close. The owner moved this
block to Next; the first month-end may be December's books. Third-party Odoo modules are ruled out (#2163,
2026-11-15). The same screens must later run on PMO's own ledger for a client with no ERP (OD-VISION-ERP).

Two facts shape the choice. First, Odoo Community has **no** bank-statement import, reconciliation screen or
depreciation (#2163, citing #1484), and **no** statement report engine (V-ODA9,
`docs/research/2026-10-31-odoo20-dev-bed-verification.md:225`). Second, what Community **does** have is the general
ledger itself: posted moves (`odoo/revenueAdapter.ts:72`), reversal (`scripts/odoo-probe.mjs:708-712`), line
reconciliation (`odoo/procurementAdapter.ts:459`), grouped reads (`supabase/functions/_shared/odooLedgerFeed.ts:159`) and
lock-date fields (V-ODA4, `…bed-verification.md:220`; the write is not yet verified). ERPNext has all of the desk's
functions natively, but PMO uses only its Journal Entry and GL today (`erpnext/doctypeRegistry.ts:174-179`).

## Decision

1. **One seam, `LedgerPort`, with six operations:** post a balanced journal (with maker and approver recorded on the
   PMO side), reverse a journal, read lines and balances by period, read and set the period lock, optionally reconcile
   ledger lines, and declare capabilities. Nothing else. It sits inside `pmo-portal/src/lib/adapterSeam/` beside the
   existing contract (`contract.ts`) and is proven by one shared contract suite run per tier.
2. **The desk's own state lives in PMO on every tier.** Journal drafts and approvals, bank statements and matches,
   the asset register and depreciation schedule, period status and the checklist, tax sign-offs. The ledger holds
   posted entries only. Depreciation, fees, accruals, revaluation and (where the tier's convention needs it) the
   closing entry are all journals through the one post operation.
3. **Three ledgers over time behind the same port:** Odoo Community now, ERPNext (already connected for other orgs),
   and a PMO-native ledger later (an append-only writer in the ADR-0097 pattern), each declaring per operation
   `supported` / `pending` / `unavailable`. A TO VERIFY operation stays `pending` until a bed probe says otherwise.
4. **An entry exists once.** One PMO record, one outbox key, one ledger document; the mirror recognises PMO-originated
   entries by their anchor and shows them once. A ledger entry PMO did not originate is shown, counted and flagged.
5. **PMO's period status is the first lock; the ledger's lock follows it** where the tier supports writing one. PMO
   refuses a back-dated write before the outbox on every tier, so the rule holds even where the ledger cannot lock.

## Alternatives, and what breaks under each

- **Allow Odoo modules (OCA reconciliation and assets).** Breaks the owner's no-modules ruling (#2163) and ADR-0094's
  zero-customisation baseline; every Odoo upgrade waits on community ports; the work happens in Odoo screens nobody
  opens, so PMO would still need its own screens, now with two writers of reconciliation state; and none of it carries
  to an org with no ERP.
- **Build the desk directly against Odoo (no seam).** Works for this client in December, then breaks twice: ERPNext
  orgs need a second desk, and the no-ERP org needs a third. Odoo vocabulary would leak out of
  `adapterSeam/odoo/**` (against NFR-ODC-009, `odoo/client.ts:2-3`), and every money rule (balance, lock, SoD) would be
  re-implemented per ERP.
- **Build the PMO-native ledger first and treat Odoo as a copy.** Two ledgers of record for one company: PMO's and
  Odoo's would drift, and the connected ERP stops being the source of truth that ADR-0094 and ADR-0055 §5 make it. It
  also misses December: a native ledger needs its own correctness work, chart, opening balances and migration
  before it can be trusted, none of which the hidden-ledger client needs.

## Consequences

- PMO gains about eight tables of desk state and one contract suite; each piece ships alone (spec §6).
- On Odoo Community the bank reconciliation and asset register are PMO's only; Odoo's balances stay correct because
  every effect on the books still arrives as a posted journal.
- Some Odoo behaviour is unproven (spec §11, V-ACD1–10); the matching workflows ship `pending` and the desk says so.
- ERPNext orgs use the same desk; ERPNext's native assets, bank tools and period closing are deliberately not used at
  first, so one design serves all tiers. Adopting a native ERPNext function later is a per-operation declaration change.
- The PMO-native ledger becomes an adapter, not a rewrite of the desk.

## Relationship to ADR-0048 and ADR-0055

- **ADR-0048** — kept: for a connected org the ERP's ledger is the oracle; PMO never recomputes a posted figure and
  shows ledger-sourced numbers as such. **Superseded in part:** its line "period-close … stay in ERPNext's native UI
  indefinitely" no longer holds; month-end and year-end close move into PMO for every tier. Statutory filing
  (e-Faktur, returns) stays outside PMO as ADR-0048 said.
- **ADR-0055** — kept: adapters on stock APIs, the ownership map (Accounting is ERP-owned when connected, PMO-owned when
  not, §5 row 1), single writer per domain. This ADR adds the accounting row's contract; it does not change who owns it.
- **ADR-0094** — kept and applied: PMO is the only interface; no customisation; uncertain outcomes are held and shown.

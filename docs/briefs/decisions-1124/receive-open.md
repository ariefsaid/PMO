# Receive lane status

Status: **incomplete; specification and initial red contracts only**. No runtime implementation or migrations are included. Do not integrate this branch as a completed feature.

Captured Director rulings:

- Purchasing maps each order line to an existing stock item; receivers never change mappings. Unmapped service/direct-use lines retain the existing path. A receipt freezes its mapping.
- Stock valuation uses organisation currency and receipt-date `fx_rate_on`, snapshots the rate, uses 1 for the same currency, and refuses missing rates with pair and date.
- Enablement is limited to PMO-owned purchasing and inventory. ERP-connected receiving remains a follow-up.

Spec: `docs/specs/receive-against-order.spec.md`. Plan: `docs/plans/2026-11-24-receive-against-order.md`.

Proof: the spare runner applied the branch baseline and executed `supabase/tests/2220_receive_against_order.test.sql`; all four schema-contract tests failed as expected because implementation is absent. This is initial red evidence, not acceptance. No guards, typecheck, lint, browser, behaviour pgTAP or mutation acceptance is claimed.

Remaining: implement the complete lane, replace the schema-only starting coverage with its behavioural owning proofs, execute mutation checks, and obtain all required local and integration evidence. Existing bills and three-way match compare purchase-currency values (migrations 0349 and 1018); this work proposes no change to those rules. ADR-0085 originally limits JISDOR to display equivalents, so the authorised receipt snapshot use also needs a recorded architectural amendment.

DONE: 1124d-receive

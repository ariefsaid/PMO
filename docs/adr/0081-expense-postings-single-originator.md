# ADR-0081 — Expense postings: a durable intent in the event's transaction, driven by the sweep alone

- **Status:** Proposed (eng-planner, 2026-10-07) — for Director acceptance with the phase B plan
- **Context:** #775 phase B; spec `docs/specs/expense-claims.spec.md` §10 (DD-EXP-12..22); plan
  `docs/plans/2026-10-07-expense-claims-phase-b.md`; spike `docs/spikes/2026-10-07-erpnext-employee-expense-postings.md`
- **Related:** ADR-0059 (Posture B — this ADR refines its §1 "write trigger" row and §4 for one domain; it does not
  change the posture), ADR-0058 (outbox, applies verbatim), ADR-0078 (core doctypes), OD-XING-1 (pre-binding events
  are not pushed), OD-ERP-3 (ERPNext is headless)

## Context

ADR-0059 Posture B has two originators for each push: the foreground caller (the browser, right after the PMO
transition) and the sweep backstop. Both P3b (timesheets) and P3c (budgets) were built that way, and most of their
review rounds were spent on what two originators cause:

1. **The absent queue.** The browser can die before its request reaches the server, leaving no mirror row and no
   outbox row. The timesheet sweep needed a second, bounded anti-join query over `timesheets` to find them, then a
   reserved budget so that queue could not be starved (HIGH-3).
2. **The originator race.** Two originators with no shared state must derive identical keys from identically
   rendered stamps, and a caller-chosen key or id spelling became a second identity (BLOCK 3, round 1 and 2).
3. **Lost mirror updates.** The foreground and the sweep both write the mirror's push state; every park became a
   compare-and-set (NEW-4) and the held witness needed fenced RPCs (0155, 0163).

Expense postings have five consequences per claim lifecycle (approval, cash payment, advance settlement, advance
payment, advance return) plus a cancel. Nobody waits for them: ERPNext is headless (OD-ERP-3), and a claim's ledger
effect landing within the sweep interval is enough for project actuals and month-end.

## Decision

1. **The PMO event writes a durable intent in its own transaction.** An `AFTER UPDATE OF status` trigger on
   `expense_claims` and an `AFTER INSERT` trigger on `expense_advance_returns` insert `pending` rows into the side
   mirror `expense_posting_erp_mirror`, one per posting, keyed `unique (org_id, posting_identity)` and carrying the
   event's stamp and actor. The insert is `on conflict do nothing` and touches nothing outside the side mirror, so it
   cannot fail the transition for any external reason (ADR-0059 §3.2), and the transition RPCs are unchanged
   (§3.1). The trigger writes only while the org employs the `expenses` domain, which is also the epoch boundary
   (OD-XING-1).
2. **The sweep is the only originator.** A new per-org pass (`reconcileOrgExpensePostings`) reads the intent queue,
   re-asserts the database gate (`expense_posting_for_push`, service role only) against the recorded actor, resolves
   every reference, freezes the result into the outbox payload, and runs `dispatchMoneyWrite` — the same outbox,
   claim, fencing, recovery probe and replay authorization every other domain uses. `adapter-dispatch` has no
   `expenses` route, so no client can originate a posting.
3. **Keys are still deterministic** (ADR-0059 §4): `<prefix>:<subject uuid>:<stamp epoch ms>`. With one originator
   they no longer arbitrate a race; they make every sweep re-run land on the same outbox row and the same ERP anchor.
4. **Ordering between postings is the pass's job, not the client's.** A payment or settlement waits for its claim's
   approval Journal Entry; a cancel waits for the Journal Entry it cancels. Intents are processed oldest first, so a
   claim's approval normally posts before its payment in the same tick.

## Consequences

- Good: the absent queue, the originator race and the mirror's two-writer lost update do not exist for this domain.
  The intent is as durable as the claim itself.
- Good: a single code path to test and reason about; the served e2e drives it by invoking the sweep.
- Good: reversal is still `drop table` plus dropping two triggers (ADR-0059 §3.7) — no PMO data is lost.
- Cost: a posting lands up to one sweep interval after the event (today the cron is hourly). Acceptable: no user
  waits on it. If a later domain needs immediate posting, it can add a server-side kick that runs the same pass for
  one org — never a second, client-driven originator.
- Cost: the sweep must be running for anything to post. It already must, for every Posture-B recovery.
- Cost: a trigger on `expense_claims` now runs inside every status change. It reads two small indexed tables (binding
  and ownership) and returns at once for an org that does not employ `expenses`.
- Neutral: timesheets and budgets keep their two-originator design; this ADR does not ask to migrate them.

## Alternatives considered

- **ADR-0059 as written (browser push after the transition, sweep as backstop).** Rejected: it buys sub-minute latency
  nobody needs at the price of the three defect classes above, all of which the timesheet code still carries.
- **Write the intent inside `transition_expense_claim`.** Rejected: ADR-0059 §3.1 keeps the PMO process untouched;
  a trigger leaves the RPC, its tests and its SoD exactly as phase A shipped them, and reverses by dropping it.
- **A queue table separate from the side mirror.** Rejected: the mirror already is the work queue and the operator
  surface (ADR-0059 §6); a second table would be a second state to keep in step.

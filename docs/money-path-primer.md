# P3a money-path primer — read this INSTEAD of re-deriving the architecture

Orientation doc for anyone (human or agent) working the ERPNext money path. It exists so a fix or
audit lane does not spend its first third re-reading ADR-0058, the review docs and six source files
to rebuild the same mental model. **It is a map, not an authority** — where this disagrees with the
code or an ADR, they win, and you should fix this file.

## The one-paragraph model

PMO writes money into ERPNext through `adapter-dispatch` (an edge function). Every write is fenced by
an **outbox** (`external_command_outbox`, ADR-0058) whose job is a single invariant: **one PMO record
mints at most one ERP document, ever.** A write is *claimed* (generation-fenced), *committed* to ERP,
then *finalized* (external ref + read-model mirror), then *confirmed*. Anything that dies mid-way is
recovered by the **sweep**, which re-runs the same algorithm. Separately, ERP changes flow back in via
a **webhook** (latency) and the **sweep poll** (truth) into read-model mirror tables.

## The five things that keep going wrong

Every audit round has found defects in one of these five buckets. Check yours against them first.

1. **Duplicate money.** Two ERP documents for one intent. Causes found so far: per-click idempotency
   keys (the retry never reused the key); a claim budget that didn't bound the actual POST; a recovery
   probe that reissued while the original request was still alive; concurrent creates on one record.
2. **Wrong-document adoption.** The recovery probe or the sweep poll adopts an ERP doc that isn't
   ours. Causes: unescaped LIKE metacharacters in the key; short/non-opaque keys matching as
   substrings; missing `payment_type` discriminator (a Receive adopting a Pay entry); a stale or
   capped in-flight key set.
3. **Separation of duties.** One human sets the money *and* approves it. Causes: author stamped only
   on create (so an approver's edit was unattributed); last-writer-wins authorship; a clearance TTL
   shorter than the operation it guards; a release path reachable by the party being constrained.
4. **Tenancy.** A row crosses an org or an ERP company boundary. Remember RLS does **not** protect
   service-role writes — the sweep, the webhook and the mirror writers must enforce org scoping
   themselves.
5. **Wrong number on screen.** The DB can be perfect and the UI still lies: silent PostgREST
   truncation (`max_rows = 1000` bounds *any* single read), unstable paging, statuses derived without
   their oracle, a fabricated `$0` rendered from a failed query.

## Invariants you must not break

- **ADR-0058 C-1**: a *mutable-anchor* kind (Payment Entry) is **held, never reissued** on an
  inconclusive probe. Immutable-anchor kinds (Sales/Purchase Invoice) may reissue.
- **Fencing**: `claim_generation` discards a stale claimant's *write-backs*. It cannot un-mint their
  *ERP document* — so never rely on it to prevent a duplicate POST.
- **Draft-then-submit** (OD-SAR-DRAFT-SUBMIT): an SI is created as an ERP DRAFT; a *different* user
  submits it. Any path that rebuilds the invoice body is an authorship event.
- **The ledger is the oracle** (ADR-0048): PMO mirrors ERP money, never recomputes it.
- **Fail closed.** A guard that cannot evaluate must refuse, not pass.

## Where things live

| Concern | File |
|---|---|
| Claim / commit / finalize / recover | `pmo-portal/src/lib/adapterSeam/dispatch.ts` |
| ERP HTTP transport, retries, deadlines | `.../erpnext/client.ts` |
| Recovery probes (anchor + PE composite) | `.../erpnext/recoveryProbe.ts` |
| Per-doctype behaviour (submittable, anchor) | `.../erpnext/doctypeRegistry.ts` |
| Request body builders / `fromDoc` mappers | `.../erpnext/bodies/*` |
| Dispatch entry, gates, authz | `supabase/functions/adapter-dispatch/index.ts` + `*Guard.ts` |
| Read-model mirror writers | `supabase/functions/adapter-dispatch/readModelWriters.ts` |
| Inbound feed (adopt, lifecycle, status) | `supabase/functions/_shared/erpnextFeedDeps.ts` |
| Sweep (recovery pass + doctype poll) | `supabase/functions/erpnext-sweep/index.ts` |
| Outbox schema + its RPCs | `supabase/migrations/0096_erpnext_seam_tables.sql` |
| Per-bill in-flight serialization (0682) | `supabase/migrations/0682_erpnext_payment_inflight_per_bill.sql` |

**Issued material cost (Odoo, #2282).** An organisation whose inventory Odoo owns gets the cost of material issued to a project from Odoo's
`picking_entry` analytic line: `runLedgerPass` → `runStockCostKind` (`supabase/functions/_shared/odooLedgerFeed.ts`) →
`apply_odoo_stock_cost_page` → `odoo_stock_cost_lines` → `refreshActuals({ stockCost })` (`erpnext/actualsSnapshot.ts`) → snapshot rows
`source_report = 'Odoo stock issue'`. Rows applied and not yet published leave the `ledger-stock-unpublished:odoo` marker, so a pass that
throws before it publishes is made good by the next one; the hourly stock check runs only after the publish. The check covers every counted
row, never only the tied ones. Bed facts: `docs/research/2026-11-14-odoo-stock-protocol.md` section 11.

**The refused-claim write (0682, ERPNext payments).** When a bill's purchase rules refuse a procurement payment's
claim, the dispatcher's claim wrapper (`claimOutboxForCommit` in
`supabase/functions/adapter-dispatch/moneyOutboxDeps.ts`) records that through the SQL function
`fail_refused_payment_claim` (migration 0682) — its only caller. Scope: it fails that one never-claimed `pending` row
(spending its automatic attempt budget, so neither the sweep's candidate list nor the pending-retry list re-drives it —
a person's retry is the way forward) and, via the outbox trigger, frees the bill so another payment can take it. It
never touches a row that was ever claimed: an unknown outcome belongs to the sweep's adopt-or-hold recovery, never to
a silent failure. The sweep treats a retry refused because the bill is held (`payment-in-flight-for-bill`) as a
deferral — quiet, tried again next tick — not an error.

**The statement recovery scan (0698).** The 0685 post-confirm statement trigger fires only on
`UPDATE OF state`, so a confirmation that never passes through it — a row written already-confirmed,
or one whose post-confirm bookkeeping rolled back — would otherwise wait for the nightly 02:00
materialization. The sweep's per-tick call to `scan_erp_statement_confirmed_misses`
(`supabase/migrations/0698_statement_confirmed_recovery_scan.sql`) stamps those rows
(`external_command_outbox.statement_intent_at`, supported by a matching partial index) and raises one
coalesced reserved-path intent, so the refresh runs on the next tick instead of at 02:00. The same
migration backfills the pre-rollout confirmed history, so the first scan reports only real misses;
the scan is fenced by the same 0685 lease/binding machinery as every other writer and is a no-op for
organizations with the feature disabled.

**When the sweep stops starting money rows (#2149).** One deadline for the whole sweep invocation
(`SWEEP_INVOCATION_DEADLINE_MS`, `erpnext-sweep/sweepCadence.ts`), spent by the sweep's ERP fetch (`orgErpFetch`,
`erpnext-sweep/sweepShared.ts`). Each try (one ERP request attempt) gets `min(120 s, time left − SWEEP_OUTCOME_WRITE_MARGIN_MS)`;
a try that cannot get a full minimum (`SWEEP_MIN_TRY_MS`, one recovery-probe attempt) is refused before anything is sent.
The client's retry waits go through the same budget (`orgErpTransport`): a wait after which no full try would fit is not
spent, and that client's later tries are refused unsent. So every ERP try the sweep's passes make ends by the deadline minus
the margin, and what it produced can still be written. The connect run and connect sends spend the same budget: each starts
only while a full minimum try fits, and their ERPNext client is built on the sweep's budgeted fetch (`sweepErpFetchWrap`); a
connect tick the budget refused or cut is not counted against the run, and a cut send waits for the next tick. A refused or cut try is retryable `external-unreachable`: for a create the dispatch marks
nothing and the reconciler owns the row, the same path as the claim-budget refusal. The whole-project budget adapter asks
`writeMayStart` before it records its `post_started` stage, so a create that would be refused unsent never leaves that stage
(which holds the next attempt for an operator) behind. A row the budget cuts after it started is recorded exactly as the
client's own per-attempt timeout would record it. Separately, a request that gets no complete answer (it failed, the client's own deadline aborted it,
or the body stopped part-way; an error status is an answer, and the budget's own stop is not silence) marks the organisation
for the rest of the tick. Once the organisation is marked, or no full minimum try fits, the outbox recovery pass and the
budget, timesheet, expense, site float and budget-archive backstops start no new row, and the hourly passes start nothing.
An organisation whose ERPNext did not answer on a tick has that run deferred as failed (`defer_erp_full_sweep` with
`sweepRetryDelaySeconds`, #1642), and the cycle orders every organisation with a failure count after the others, so its
tries cannot take the time the others' money passes need; its rows stay as they are and run once it answers. The statement
and hourly passes spend an earlier deadline, `HOURLY_TRY_DEADLINE_MS` (125 s): **start limit** — no hourly pass starts
after 105 s (`HOURLY_INVOCATION_DEADLINE_MS`), and no hourly or statement ERP try starts unless a full minimum try fits the
125 s deadline (so none after 95 s); **end limit** — every hourly try ends by 125 − 10 = 115 s, the last moment a money try
can start, so the next organisation's money passes still get a full minimum try. An hourly pass whose try the budget refused
or cut leaves the run unfinished (due again next tick), not failed. The backstops stamp `last_attempt_at` on each row **when
its turn comes**, one row at a time, so a row a stopped tick never reached keeps its place and its retry clock. A row not started is left exactly as it is (no stamp, no claim, no outcome, attempts unchanged); the next tick
resumes from it. The stop only ever withholds a start; it never marks, fails or reissues anything.

**The parked-unit resume (202 `budget-cancellation-pending`).** A v16 whole-project range activation whose
*predecessor* still has an unsettled ERPNext archive cancellation is PARKED, not pushed: the budget gate
writes `push_error='waiting-for-budget-archive-cancellation'` on each account unit and returns 202 with
**no outbox row at all** (the fan-out never begins). The sweep's budget backstop therefore cannot find a
candidate for those rows and must not call them orphaned. Once the project's `budget_archive_cancel_intents`
are all settled (`budgetArchiveCancelState` — the same classifier the gate uses), the resume re-runs
`buildBudgetDispatchPlan` (the SAME gate) and drives each unit through the ordinary outbox path, attributed
to the archive intent's recorded actor and re-authorized at drive time. A held intent parks the units
`held` with `budget-archive-cancellation-held`; a unit the re-derived plan no longer contains (the account
left the budget) is retired as `budget-archive-cancellation-superseded`. Never a second push path.

**Order families in purchase capture (0903, #2277).** An ERP order and every invoice billing it are one purchase
(the linker's I-2). An Admin's family placement links them into one record-only purchase, or attaches the invoices to
the order's captured purchase; each untagged invoice is an ordinary B1 placement decision on it, so its ledger cost
counts through `capture_assigned_gl` exactly as B1's do, and the commitment comes only from the canonical readers
(`procurement_ledger_held(_many)`, `procurement_open_commitments`). Nothing is written to the ERP.

**Closing a work order (#2593, migrations 1400-1402).** A work order reaches `Closed` by two routes: `transition_work_order`
(only when it has no contract lines) and `confirm_work_order_acceptance` for a final acceptance, which also stamps the closing
value. One `before update of status` trigger, `work_orders_zzzzzz_closeout_guard`, covers both: it refuses with detail
`closeout-incomplete` while a required item of the work order's close-out checklist is not done, and stamps `closed_by` from the
caller. The refusal rolls back the whole statement, so a final acceptance stays unconfirmed and no closing value is stamped.
Neither function is edited. A work order that has no checklist (the organisation had no list when it was issued, or it was
issued before 1402) closes exactly as before. The checklist is copied at issue, so editing the organisation's list never
re-gates a work order already issued.

## Numeric relationships that MUST hold (a whole round was lost to one of these)

These constants live in different files and nothing type-checks their relationship. If you change one,
re-check the others and assert the relationship in a test:

- quarantine reclaim window (`0096`, 5 min) **>** claim budget + POST deadline + settle margin
- per-attempt ERP deadline × max attempts **<** the window any lock/clearance guarding it is given
- SoD clearance TTL **>** the longest an ERP submit can still be in flight
- any PostgREST read cap **<** `max_rows` (1000) — a `limit(1001)` saturation check can never fire
- sweep invocation deadline (`SWEEP_INVOCATION_DEADLINE_MS`) **<** the function's 150 s wall-clock cap; every try
  that starts ends by that deadline **−** `SWEEP_OUTCOME_WRITE_MARGIN_MS`, and none starts with less than
  `SWEEP_MIN_TRY_MS` (= `ERP_PROBE_TIMEOUT_MS`). Asserted on a fake clock in `erpnext-sweep/moneyPassTiming.test.ts`.
- hourly try deadline (`HOURLY_TRY_DEADLINE_MS`) **−** `SWEEP_OUTCOME_WRITE_MARGIN_MS` **≤** the last money try start
  (`SWEEP_INVOCATION_DEADLINE_MS` − the margin − `SWEEP_MIN_TRY_MS`, 115 s). Asserted in `moneyPassTiming.test.ts`, and
  from every start time in `fullSweepCompletion.test.ts` (AC-ENA-CAD-009).

## How to verify (and what each gate does NOT prove)

- `npm run verify` — typecheck + lint + unit + build. Proves nothing about ERP behaviour.
- `supabase test db` via `scripts/with-db-lock.sh` — RLS/RPC truth. Single-session: it cannot express
  a real concurrency interleave, only the mechanism.
- deno tests per edge function — pure logic at the seam. Does not prove the call site is *wired*.
- the served-fn money e2e vs the live bench — the only gate that touches real ERPNext. It asserts **DB
  rows, not rendered figures**, so a wrong number on screen passes it.

**Shared-resource rule:** one local Supabase and one ERPNext bench serve every worktree. Wrap every
DB-driving command in `scripts/with-db-lock.sh`, and chain `db reset && supabase test db` in ONE hold
— a sibling reset between them silently contaminates the result.

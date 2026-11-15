# #2149 Part A: one deadline budget for the ERP sweep's tries

Branch `fix/2149-part-a-sync-timing` (money path, ships alone). Builds on `00c887a63`, which stops an
organisation's passes once its ERPNext does not answer and stops new money rows past a fixed 125 s cutoff.
The Director's ruling replaces that fixed cutoff with a deadline budget.

## The rule

- **One deadline for the whole invocation:** `SWEEP_INVOCATION_DEADLINE_MS` (145 s) after the handler starts,
  under the function's 150 s wall-clock cap (the 5 s left covers the job-run summary and lock release).
- **Each try's timeout** = `min(120 s, time left − SWEEP_OUTCOME_WRITE_MARGIN_MS)`. A try is one ERP request
  attempt. The margin (10 s) is the time kept for writing what that try produced (outbox outcome, mirror
  stamp, hold), so the outcome write always has its margin.
- **No new try starts unless a full minimum try fits:** a try needs at least `SWEEP_MIN_TRY_MS`
  (= `ERP_PROBE_TIMEOUT_MS`, 20 s, the shortest full attempt the client makes). A try that does not fit is
  refused **before anything is sent**.
- **No new row or pass starts** unless a minimum try fits (same check), replacing
  `MONEY_ROW_START_DEADLINE_MS`. The hourly block applies the same check besides its own deadline.
- What does not fit is left for the next pass. Total of all tries can then never pass
  `deadline − margin`, so never the cap.

## Where it is enforced

At the one ERP fetch every sweep pass shares, `orgErpFetch` (`erpnext-sweep/sweepShared.ts`). The cycle
gives each organisation the invocation's `SweepBudget` (deadline + clock). The fetch wrapper:

1. computes the try timeout; below the minimum it throws `sweep-deadline` without calling ERPNext;
2. otherwise arms an abort for that timeout (on an injectable timer, so tests run on a fake clock), joined
   with the caller's own signal; the abort stays armed through the body read.

A budget refusal or budget abort is our own stop, not ERPNext's silence: it does not mark the organisation
`erpUnanswered`.

### Why a refused or cut-short try is safe (safe-retry holds)

The ERP client classifies a fetch failure as retryable `external-unreachable`. For a create `POST` the
dispatch then marks nothing: the outbox row stays `committing` and the reconciler owns it at lease expiry
(ADR-0058 §4), exactly as for the existing claim-budget refusal (`commit-claim-budget-exhausted`). A refused
try sent nothing, so the later recovery probe's answer is true. A try cut short by the budget is the same
case as the client's own 120 s abort: unknown outcome, probe first, a mutable-anchor kind is held, never
reissued (C-1). Idempotent GETs retried by the client are refused again pre-send, so no extra try starts.

## The batch stamp (primer correction)

The budget, timesheet, expense, site float and budget-archive backstops stamp **the whole batch**
`last_attempt_at` before looping. With a stop that can hit mid-loop, that strands rows:

- **Who:** a person whose expense posting or site float transfer failed earlier and is due its retry.
- **What:** the tick lists it in the batch, stamps it, then stops before its turn.
- **Wrong outcome:** the queue's retry delay (`expense_posting_queue`, 0358; the site float filter) counts
  from `last_attempt_at`, so the posting waits up to another hour though nothing was tried; in every queue
  the untried rows drop behind rows that really ran, so the primer's "left exactly as it is" was false.

So this is part of the fix: **each row is stamped when its turn comes**, right before it starts (a row that
kills the isolate is still stamped first, so it still rotates behind the rest). A batch the stop cuts short
is resumed on the next tick from its first untried row, not re-stamped.

## Tests (Deno, fake clock) — `erpnext-sweep/moneyPassTiming.test.ts`

- a slow first try leaves no second try (first try takes 120 s; the next is refused before sending);
- the outcome write always has its margin (no try's abort is armed past `deadline − margin`, at any start);
- a try is refused, not sent, once a minimum try does not fit; a budget stop does not mark the org silent;
- a cut-short try is aborted by the budget timer, body read included;
- the cycle: no money row / pass starts once a minimum try does not fit;
- each backstop stamps a row only when it starts it; a stopped batch leaves later rows unstamped, and the
  next tick resumes from them;
- constants: tries end by `deadline − margin` < cap; min try = probe deadline.

## Files

`sweepCadence.ts` (constants), `sweepShared.ts` (budget + fetch wrapper), `index.ts` (cycle wiring, handler),
the five backstop cores + live deps (stamp at turn), `docs/money-path-primer.md`, the test file.

## Out of scope

Foreground submit timing (separate ticket); the connect run/sends clients (`_shared/erpClientForOrg.ts`,
not a money backstop); no schema change.

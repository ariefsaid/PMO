VERDICT: NO SHIP

Round 10 — adversarial money review of the timesheet `Approved → Draft` re-open (Slice A),
`origin/dev..HEAD` (25 commits, migrations 0151/0152/0155/0157). Standing in for the capped
cross-family gate; same family as the builders, so every claim below was replayed against the
migrated local database (the four migrations applied inside one rolled-back transaction on top of
the shared DB) rather than argued from the diff's prose.

**The round-8 BLOCK is genuinely closed on the path it was found on.** I reproduced 0157's fix
end-to-end: a served `command-held` stamps `post_submit_unknown_at`, the witness survives
`release_outbox_hold`, the re-open still refuses after the release, and only the audited attestation
lifts it. The trigger's stickiness, the fail-closed branches, the ACLs and the attestation's
authorization all behave as the migration says.

**The BLOCK below is the same defect on a producer 0157 did not enumerate.** `mark_outbox_held` — the
statement that actually creates the hold — writes only the OUTBOX. On the SERVED path a *separate,
later, best-effort* call stamps the mirror witness. **On the SWEEP path there is no such call at all.**
So a sweep-driven hold leaves the re-open fenced by nothing but the outbox state, which is precisely
the state `release_outbox_hold` clears. Reproduced to two outbox rows for one week.

---

## BLOCK 1 — a hold created by the SWEEP records no witness, so a release re-opens the round-8 hole

**Money outcome:** ERPNext keeps a live submitted Timesheet for week W while PMO returns W to Draft.
The corrected week is re-approved under a new approval generation → a new idempotency key → a
**second** ERP Timesheet. The client's project costing carries both weeks of hours, permanently. The
original command can never be adopted afterwards (`timesheet-approval-superseded`), so it never learns
the `ts_number` that would have fenced the second push. This is round-8 BLOCK 1, unchanged in
consequence, reached through a different door.

**Why the witness is missing.** `post_submit_unknown_at` is written in exactly two places:

- `record_timesheet_command_held` (`0157:246-249`), called only from
  `adapter-dispatch/index.ts:930-949` `recordTimesheetPushFailure`; and
- `parkTimesheetMirrorRow` (`supabase/functions/erpnext-sweep/index.ts:1292`), on a LATER tick.

But the hold itself is created by `money.markOutboxHeld(...)` inside `dispatch.ts` — four sites,
`pmo-portal/src/lib/adapterSeam/dispatch.ts:320`, `:351`, `:391`, and the re-throw at `:562`. When
`dispatchMoneyWrite` is driven by the sweep (`supabase/functions/erpnext-sweep/index.ts:1621`), that
RPC commits the outbox to `held` and the `command-held` AppError is then merely logged
(`erpnext-sweep/index.ts:1645-1647`, `console.warn`). **The sweep has no mirror failure recorder at
all** — it imports only `getReadModelWriter`, the success writer (`erpnext-sweep/index.ts:85`;
`grep markTimesheetPushOutcome supabase/functions/erpnext-sweep/` is empty). Nothing tells the mirror.

One of the four hold producers is *structurally* sweep-exclusive: the
`recovery-reissue-unauthorized` hold at `dispatch.ts:391-406` fires only when
`money.reauthorizeRecoveryReissue` is wired, and that dep is set in exactly one place —
`erpnext-sweep/index.ts:1793`. That hold can therefore **never** stamp a witness at the moment it
occurs.

**Reproduction (verbatim, against the migrated DB, all inside a rolled-back transaction):**

1. Sheet S Approved. Push minted through the shipped guard (`insert_timesheet_outbox_pending`),
   claimed → `committing`. The ERP submit lands; the read-back does not.
2. The served catch records the post-submit unknown as an ordinary failure (`external-unreachable` is
   not `command-held`, so `markTimesheetPushOutcome` takes the plain upsert at
   `readModelWriters.ts:1002-1013`): mirror `failed`, **no witness**. Confirmed.
3. The sweep re-drives it; the recovery probe fails deterministically →
   `mark_outbox_held(ob, gen, 'recovery-probe-failed: deterministic')` → `1`:
   `outbox=held  mirror=failed  no_witness=t`
4. Re-open correctly refused — **but only by the outbox**:
   `STEP4: refused -> reopen-push-in-flight`
5. Admin runs the documented route out, `release_outbox_hold(ob, 'probe fixed; safe to re-drive')`:
   `outbox=failed  mirror=failed  still_no_witness=t`
   (0152 §A's mirror CAS is `where push_state = 'held'` — the mirror is `failed`, so it matches 0 rows
   and the release silently learns nothing to preserve.)
6. `STEP6: *** RE-OPEN ADMITTED WITH AN UNKNOWN ERP OUTCOME ***` → `status = Draft`
7. Re-submit + re-approve + mint through the guard →
   `outbox_rows_for_this_week = 2` — a second ERPNext Timesheet for the same week.

**Reachability.** The sweep pass IS the ordinary resolver of a post-submit unknown: the dispatch
deliberately marks nothing (`dispatch.ts:451-453`), the row goes `committing` → `quarantined`, and
`outbox_reconcile_candidates` admits both at any age (`0131:52-53`), so pass 6 owns the recovery. A
deterministic `fromDoc`/`mirrorMoney` failure on that probe is the exact class round-3 introduced the
hold for. The hold is logged and nothing else surfaces it until the *next* tick, so an operator
watching sweep logs who releases the hold and asks the approver to re-open the week — the workflow
0152 documents — walks straight into step 6.

**The partial mitigation, stated honestly, and why it is not enough.** On a later tick the sweep re-
lists the sheet (`listPendingTimesheetPushes`, mirror `pending`/`failed`,
`erpnext-sweep/index.ts:1466-1473`), finds the `held` outbox row (not a 0131 candidate, and not
`committing`/`quarantined` so the round-3 early return does not fire) and parks the mirror `held` +
witness. So the exposure normally closes in one tick. It does **not** close when:
- the release happens inside that tick (the reproduction above);
- the mirror is not `pending`/`failed` — e.g. `pushed` with no `ts_number` from an earlier empty-sheet
  success, or already `held` — in which case the sheet is never listed and the witness never arrives;
- the sheet falls outside the tick's `limit` budget under a backlog;
- the sheet has no mirror row and is older than the 14-day `ABSENT_SHEET_LOOKBACK_MS`;
- **or the served path is the producer and the recorder throws** — `recordTimesheetPushFailure`
  swallows it (`index.ts:946-948`), and with no sweep enabled for the org nothing ever re-stamps.

A fence that depends on a later cron tick to become true is the same shape as the sentence 0157 was
written to delete: an ERP fact inferred from PMO queue state.

**Smallest fix.** Make the witness contemporaneous with the fact, in the same transaction as the hold:
add to `mark_outbox_held`, for a `domain = 'timesheets'` row, the identical statement 0157 already
uses —

```sql
update public.timesheet_erp_mirror
   set post_submit_unknown_at = now()
 where timesheet_id = <the row's pmo_record_id::uuid>
   and (ts_number is null or erp_cancelled_at is not null);
```

with an insert for the absent-mirror case. §2's trigger already makes it sticky and
first-observed-wins, so this is idempotent with both existing writers and changes no other domain.
That closes the sweep producer, the swallowed-recorder producer and any future caller of
`markOutboxHeld` at once, and removes the dependency on a recorder being reached at all.

*(Narrower alternative if `mark_outbox_held` must not change: have `release_outbox_hold`'s timesheets
arm STAMP the witness rather than assume one — a hold on a timesheets command always means the ERP
outcome is unknown, and a `held` outbox row can leave `held` only through this function. It closes the
release door completely but leaves the mirror unwitnessed for anything else that reads it.)*

---

## SHOULD-FIX

### S1 — `markTimesheetPushOutcome`'s non-held upsert can downgrade a sweep-parked `held` mirror
`supabase/functions/adapter-dispatch/readModelWriters.ts:1003-1013` is an unguarded blind upsert: no
generation CAS, no `held`-preservation. Replayed in the DB: a mirror at `held` + witness is rewritten
to `failed` by any later classified failure. Today the money invariant survives only because the
witness outlives it — i.e. the witness is now load-bearing for a second reason that no comment or test
records, and the `push_state = 'held'` predicate at `0157:372-375` (the stated fence for pre-0157
residue) is erasable by an ordinary failure. *Fix:* either give this upsert the same
"never overwrite `held`" clause the sweep's park has (`.in('push_state', [...])`), or state in
`0157 §4` that the `held` predicate is advisory and the witness is the only fence.

### S2 — nothing tests a hold produced through the sweep's `dispatchMoneyWrite`
Every oracle for the held path takes the mirror recorder's existence as its premise:
`readModelWriters.timesheets.test.ts` and `0157_*` drive `record_timesheet_command_held` directly;
`timesheetNotDueYet.test.ts` drives the *park*; `dispatch.money.test.ts` asserts the marker is stamped
on the thrown error. No test asserts what the mirror looks like after
`erpnext-sweep/index.ts:1621` throws `command-held` — which is exactly the state BLOCK 1 exploits.
*Fix:* one deno test that drives `deps.driveTimesheetPush` with a backstop dep whose
`dispatchMoneyWrite` throws `command-held`, asserting the mirror carries the witness.

### S3 — the FE offers an active Re-open on a `held` mirror
`pmo-portal/pages/Approvals.tsx:357-358` classifies `outcomeUnknown` on `post_submit_unknown_at` only.
A mirror at `push_state = 'held'` with a terminal outbox (the pre-0157 residue the RPC explicitly
fences at `0157:372-375`, and the sweep's park before its witness lands) renders the active button and
the server refuses. Round-8's N3 in a new place; cosmetic because the server has the last word, but
this program has repeatedly decided a surface must be true rather than plausible. *Fix:* include
`row.mirror?.push_state === 'held'` in `outcomeUnknown`.

### S4 — `release_outbox_hold` overload collision (integration hazard, observed live)
The shared local DB (at migration 0156, carrying another in-flight branch) has
`release_outbox_hold(uuid, text, text DEFAULT null)`; 0152 creates the 2-arg form. With both present,
`select release_outbox_hold($1, $2)` fails `42725 function ... is not unique` — I hit it and had to
drop one to finish the reproduction. `origin/dev` today carries only the 2-arg form (`0137:198`), so
this is not this branch's defect, but this branch owns one of the two halves: whichever lands second
must reconcile the signature, or **every hold release breaks at runtime**, and a 3-arg version that
does not carry 0152 §A's mirror arm silently reverts round 4. *Fix:* flag it in the PR body for the
integrator.

---

## Answers to the brief's targeted questions

1. **Every producer of "PMO lost track of a submit outcome."** Enumerated from the code:
   `postSubmitUnknown` → `external-unreachable` (row left `committing`, fenced by the outbox
   predicate); the four `markOutboxHeld` sites in `dispatch.ts`; the sweep's attempts-exhausted park.
   The witness is stamped on the *recording* of the first (served only) and on the *park* of the last.
   **It is not stamped on the hold itself** → BLOCK 1.
2. **Trigger stickiness / the GUC.** Attacked and it holds. `authenticated` has **no** write policy
   and **no** table privilege on `timesheet_erp_mirror` (`has_table_privilege('authenticated', …,
   'UPDATE') = f`, the only policy is `timesheet_erp_mirror_select`), so setting the GUC — which an
   authenticated role *can* do for a placeholder variable, and which I confirmed it can — reaches no
   UPDATE. Verified: GUC set as `authenticated`, direct UPDATE → `42501 permission denied`, witness
   intact. The GUC is `is_local => true` and reset to `''` before the function returns; a post-
   attestation UPDATE in the same transaction cannot clear the witness (verified). This is
   trust-on-service-role, which is the same trust every other definer here already rests on.
3. **The attestation RPC.** Admin-only, org-re-asserted, active-membership-checked, reason-required
   (blank refused), refuses when there is nothing to attest, `for update` on the mirror row before it
   decides, audited with the correct `log_audit(action, org, actor, entity, detail)` argument order,
   and the audit row is asserted by content in `0157_unknown_witness_lifecycle.test.sql:96-101`.
   Verified in the DB, including a cross-org Admin → `42501 not authorized`. It **can** clear the
   witness for a sheet whose ERP document does exist — the operator's assertion is the only guard.
   That is the right design: the question is about the external system, and only a human who looked or
   a learned `ts_number` can answer it. The reason string + audit row make it accountable.
4. **S2's deliberate deviation from "raise instead".** The builder is right and the review was wrong.
   Raising would be swallowed at `index.ts:946-948`, leaving **no mirror row and no witness** — the
   exact admitting state. Recording the restrictive `held` + the witness is strictly safer for the
   money invariant. Verified both branches in the DB: `p_outbox_id = null` → `held` + witness, and a
   bogus uuid → `held` + witness, with the identity-lost reason on the row. The cost is a spurious
   permanent block requiring an Admin attestation when the threading has a bug — the correct trade.
5. **S3's SQL (`approved_at_pushed is null` ⇒ CAS-matching writers only).** The only writer subject to
   this guard is `record_timesheet_command_held`. The writers it now rejects are the released/
   superseded branch and the unlocatable branch — neither is a current-generation writer, and both
   still stamp the witness (which is deliberately outside the guard, `0157:239-249`). No legitimate
   writer is harmfully rejected.
6. **S4's 90-day bound.** Display only. The `transition_timesheet` body differs from 0152 by exactly
   the one added predicate (mechanical diff, comments stripped) — no date bound anywhere server-side,
   so no sheet becomes unreachable to the RPC. The query is index-served by
   `timesheets_org_status_week_idx (org_id, status, week_start_date DESC)` and the `.in()` list is now
   bounded by `REOPENABLE_PAGE_LIMIT`; the DB-performance objection from round 8 is closed. *Minor:*
   there is no "show older" affordance, so a >90-day week with a stuck push has no UI route at all —
   and `REOPENABLE_SELECT` still uses `*` plus `timesheet_entries(*)` for up to 100 sheets on a hot
   page.
7. **Tests that cannot fail.** The new pgTAP asserts exact values in both directions and uses shipped
   writers to mint fixtures; the deno park tests carry a genuine negative control (a `failed` park must
   NOT stamp). I did not trust the "mutation proven" claims — I independently re-derived the same
   behaviours against the live DB (fail-closed branches, trigger stickiness, first-observed-wins,
   ts_number clear, empty-sheet `pushed` NOT clearing, release survival, attestation ACL). They hold.
   The structural blindness is S2 above: the suite's premise is that a hold is always accompanied by a
   recorder call, and BLOCK 1 lives in the case where it is not.

## Also confirmed (not re-litigated)

- `Draft` / `Submitted` / `Rejected` arms of `transition_timesheet` are unchanged from 0152 — a
  comment-stripped mechanical diff shows exactly one added `if exists (… post_submit_unknown_at …)`
  block and nothing else.
- No machine-only RPC is reachable by a client role. On the migrated catalog:
  `insert_timesheet_outbox_pending`, `record_timesheet_command_held`, `timesheet_push_key_witness`,
  `mark_outbox_held`, `claim_outbox_for_commit` → `execute = f` for both `authenticated` and `anon`;
  `transition_timesheet` and `attest_timesheet_no_erp_document` → `authenticated` only, `anon` `f`.
- `POST_SUBMIT_UNKNOWN_IS_IN_FLIGHT` contains only `timesheet` (`erpnext/adapter.ts:112`).
- No ERP cancel / correction-intent machinery: `correction_intent` / `confirm_timesheet_cancel` appear
  only inside 0151's Slice-B seam comment. Slice B is genuinely deferred.
- Indexes: no missing index on any hot path this change introduces. The re-open predicates are
  unique-key lookups on `timesheet_erp_mirror.timesheet_id`; the sweep's queue is served by
  `timesheet_erp_mirror_org_state_idx (org_id, push_state)`; the new bounded surface query is served by
  `timesheets_org_status_week_idx`. No N+1 and no unbounded scan introduced (S4 removed the one that
  existed).

## WHAT I COULD NOT VERIFY

- No live ERPNext bench. I did not observe a real post-submit unknown, a real deterministic `fromDoc`
  failure, or ERPNext's behaviour on a second Timesheet for the same employee/week. If ERPNext's own
  overlap validation rejects the second submit, BLOCK 1's outcome changes from "hours double-counted"
  to "the corrected week can never reach ERP while an orphan document holds the original" — both are
  money-wrong, and PMO must not use the external system's validation as its fence.
- BLOCK 1 was reproduced at the database boundary (RPC-level, one rolled-back transaction) with the
  sweep's `dispatchMoneyWrite → markOutboxHeld` step performed as the `mark_outbox_held` RPC it calls,
  not by executing the deployed edge function. The absence of any mirror recorder on that path was
  established by reading and grepping `erpnext-sweep/index.ts`, not by running the worker.
- I did not run the gate battery (told it is green) and did not measure changed-line coverage; my
  coverage observation is qualitative and confined to S2.
- The local DB is at 0156 and carries another branch's migrations; I applied 0151/0152/0155/0157 on top
  inside a transaction. Everything I assert was observed in that state and rolled back. I could not
  inspect production/staging outbox or mirror rows, so the pre-0151 residue population remains unknown.
- I did not re-run the builder's own mutation harness (the one that had reported a false all-green);
  I substituted independent behavioural replay, which is a weaker guarantee about the harness itself.

## CROSS-FAMILY BLIND SPOT

The thing I am worst-placed to catch is again the thing I nearly did not. 0157's §2 header states its
own completeness — *"Four writers touch this mirror today (the dispatch success path, the
failure/held recorder, the sweep's park, the ERP feed) and 0152's release is a fifth by symmetry"* —
and I read that list as the enumeration rather than as the claim it is. It is a list of MIRROR writers,
and the defect is a writer of the OUTBOX that has no mirror counterpart; the sentence is true and
irrelevant, which is the most expensive kind of comment and the kind I write myself. I only found it
by refusing to accept "the witness is stamped whenever PMO loses track" and instead grepping for every
caller of `markOutboxHeld` and asking, per call site, *who tells the mirror?* A different family would
more likely have distrusted the enumeration on first read.

Two places where that bias probably still costs you: (a) the narrative in `0157 §4` about what terminal
`failed` does and does not prove is now honest, but it rests entirely on the anchor probe being
complete — I checked that `timesheet` has an immutable `note` anchor and a `like %key%` filter, and did
not test it against a real ERPNext `note` value; (b) `dispatch.ts`'s error classification is the single
point on which "post-submit ⇒ in-flight, never absent" rests, and I confirmed only that it holds for
the paths through `commitCreate`/`commitTransition` — a 500-with-`TypeError` from `submitDoc` itself is
classified non-retryable `commit-rejected` (`erpnext/client.ts:340`) and lands terminal with no
witness, which is safe only if Frappe really did roll the submit back.

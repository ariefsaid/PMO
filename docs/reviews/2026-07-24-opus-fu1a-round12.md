VERDICT: SHIP

Round 12 — adversarial money review of the timesheet `Approved → Draft` re-open (Slice A),
`origin/dev..HEAD` (28 commits, migrations 0151/0152/0155/0157/0158). Standing in for the capped
cross-family gate; same family as the builders, so **every claim below was replayed against the
migrated local database** (0151/0152/0155/0157/0158 applied on top of the shared DB inside one
rolled-back transaction, with a `pg_get_functiondef` catalog probe proving each definition actually
landed before any assertion — the round-9/11 false-all-green lesson) rather than argued from the
diff's prose.

**The round-10 BLOCK is genuinely closed, and closed at the right level.** I reproduced it: a hold
created the way the SWEEP creates it (`insert_timesheet_outbox_pending` → `claim_outbox_for_commit` →
`mark_outbox_held`, with `record_timesheet_command_held` never called) now stamps
`post_submit_unknown_at` in the same transaction; the witness survives `release_outbox_hold`; the
re-open still refuses afterwards; only the audited attestation lifts it. **Coverage is by construction,
not by enumeration** — I could not find a producer of a durable "PMO lost track of a submit outcome"
that bypasses it (§Answers 1).

**No BLOCK this round.** The two findings below are about the *route out*, not the fence. Both fail in
the conservative direction — a week gets stuck, never double-counted — and neither is reachable as a
wrong number in a client's ERP.

---

## SHOULD-FIX 1 — the attestation is the only documented route out of an unknown, and it has no surface anywhere in the app

**Money outcome:** a week that hits a post-submit unknown cannot be corrected *through the product*. It
needs an engineer with database access. Every hour of that week stays uncorrectable until someone runs
SQL by hand; there is no audit-visible, permissioned, in-product act for the one decision the whole
slice hangs on.

**Reproduction (verified):** `grep -rn "attest" pmo-portal/src pmo-portal/pages` returns exactly two
hits, neither of them a call site — one is a ClickUp comment, one is a test comment. The re-open row
renders `ERP result unknown — an administrator must confirm what ERPNext holds`
(`/Users/ariefsaid/Coding/PMO/.claude/worktrees/tsp-reopen/pmo-portal/pages/Approvals.tsx:376-378`) and
the refusal toast repeats it (`:412-417`). There is no control anywhere that reaches
`attest_timesheet_no_erp_document`. The plan's §9 runbook covers only the *pre-0151 residue* and never
names the RPC as an operator step.

This is the codebase's own stated contract, from its own module:
`pushErrorCopy.ts:22` — *"`remedy` is what must change first; it is always present when `retryable` is
false, **because a withheld button with no route out is a dead end** (the C-3 lesson)."* The surface
states a remedy that the product does not offer.

**Smallest fix:** an Admin-gated affordance on the `outcomeUnknown` row — a `ConfirmDialog` with a
required reason, calling `attest_timesheet_no_erp_document` through the repository seam. The RPC is
already Admin-only, org-re-asserted, reason-required and audited, so the surface adds no authority. If
that is out of scope for Slice A, the *minimum* is a named runbook step in
`docs/plans/2026-07-23-timesheet-reopen-unpushed.md` §9 stating the exact call, who may make it, and
that it is currently console-only — a fence whose only key is undocumented is a fence nobody can pass.

## SHOULD-FIX 2 — the attestation cannot clear a mirror stuck at `push_state='held'`, and 0158 adds a way to reach that state

**Money outcome:** the same stranding, one layer deeper. After a *successful* attestation the re-open
still refuses **with the identical error code**, and the operator's remaining in-product action
(Retry) re-POSTs the original hours — the one act that can permanently foreclose the correction by
minting the ERP document Slice A refuses on (`reopen-erp-document-held`, Slice B deferred).

**Reproduction (verbatim, against the migrated DB, all inside a rolled-back transaction):**

```
S1 held_cas_result=0
S1 outbox_state=committing mirror_state=held witness=true     <- 0158 stamped on a LOST CAS
   (the winning claimant then terminal-fails on the sweep path, which has no mirror recorder)
S1 RELEASE: REFUSED -> outbox command is failed — only a held command can be released
S1 ATTEST : SUCCEEDED
S1 after attest: mirror_state=held witness=false
S1 REOPEN : REFUSED -> reopen-push-outcome-unknown            <- 0157 §4's THIRD predicate
```

The same replay on the **pre-existing** producer (`parkTimesheetMirrorRow(row,'held',
'timesheet-push-attempts-exhausted')`, `supabase/functions/erpnext-sweep/index.ts:1613`, whose outbox
row is by definition *not* `held`) reproduces identically (`S2 …`). So the class predates this round —
but 0158 adds a second door to it, because its stamp is unconditional and its INSERT hard-codes
`push_state = 'held'` (`supabase/migrations/0158_stamp_unknown_witness_at_hold_creation.sql:136-138`)
even when the hold's CAS returned 0. That state is created by the shipped code and is asserted by the
shipped test (`supabase/tests/0158_hold_stamps_witness_at_creation.test.sql:229-237`, "SHEET D"), which
checks the witness and never looks at what the `push_state` it wrote does afterwards.

Why nothing recovers it: a `held` mirror is excluded from pass 6's queue
(`erpnext-sweep/index.ts:1470`), pass 1 skips the timesheets domain entirely (`:397`),
`release_outbox_hold` refuses a non-`held` outbox (`0152:79-81`), and
`attest_timesheet_no_erp_document` touches only the witness by design (`0157:486-489`).

**Smallest fix:** let the attestation say the whole thing it is asserting. In `0157 §5`'s UPDATE, add
`push_state = case when push_state = 'held' then 'failed' else push_state end`. An operator who has
just certified *"ERPNext holds no Timesheet for this week"* has certified exactly the fact that makes
`failed` honest and re-drivable — that is the same statement, not a new authority, and it leaves the
witness semantics untouched. *(Optional belt-and-braces, if you would rather not widen the attestation:
`0158:138` writes `case when v_n = 1 then 'held' else 'failed' end`, so a fenced-out claimant never
creates a `held` mirror no release can reach. The witness stays unconditional either way — that part of
the design is right.)*

## MINOR 3 — 0158 puts a new, unclassified `push_error` vocabulary onto the operator surface

Before 0158 a `held` timesheet mirror's `push_error` was always written by
`record_timesheet_command_held` as `command-held: …`, which `pushErrorCopy.ts:CODES` classifies
(`retryable:false`, remedy "An administrator must release the hold"). 0158's INSERT persists the *hold's
own* reason instead — `recovery-probe-failed: …`, `recovery-inconclusive-absence: …`,
`recovery-reissue-unauthorized: …` — and none of the three is in `CODES`. On the sweep path no recorder
ever overwrites it, so that is the final persisted value the "ERP pushes needing attention" queue
renders (`pmo-portal/pages/Approvals.tsx:230-232` → `PushStateBadge` → `describePushError`).

Consequence: the most money-sensitive row in the slice reads *"The push failed for a reason this screen
could not be classified against a known cause"* and — because the unknown-code fallback is
`retryable: true` (fail-open, correctly) — is given a **Retry** button whose only possible answer is the
outbox's `held` branch (`dispatch.ts:556-566`). Inert, not harmful, but it is precisely the "a button
that can only ever fail" the I-14/I-15 round already removed from this component. *(Nothing leaks:
`splitCode` drops everything after the first colon, so `redactErrorForOutbox`'s detail never renders.)*
**Fix:** three entries in `CODES` with `retryable: false` and the release/attest remedy. The same gap
already exists for `timesheet-push-attempts-exhausted` / `-no-outbox-candidate` / `-gate-refused` (the
budget twins ARE classified, with a comment at `pushErrorCopy.ts` calling classifying them
"mandatory") — worth closing in the same edit.

## MINOR 4 — one adapted oracle lost a little discrimination (the others did not)

`supabase/tests/0155_command_held_fenced_on_release.test.sql:100-103` asserts the mirror ends `failed`
after a released generation's late recorder runs. Pre-0158 the row did not exist until the recorder
wrote it, so a recorder that did *nothing* left NULL and failed the assertion. Post-0158 the release
itself leaves the row `failed`, so a no-op recorder now passes. The named property ("a released
generation cannot write `held`") is still pinned — a blind-`held` mutation still turns this red, which
is the round-5 BLOCK this file owns — but the "records `failed` to keep the recovery route open" half is
no longer proven here. **Fix:** assert the reason too, e.g.
`push_error like '%hold released or superseded%'`. Also `:76`'s comment ("updates zero mirror rows
because none exists") is now false — the release updates one.

The other two adaptations hold up. **0151** (`:126-131`) deletes the mirror so arm (d) still isolates
the OUTBOX predicate: drop `'held'` from `state in (…)` and that arm admits and fails — I checked the
mutation direction, not just the prose. **0152** (`:78-97`) upserts onto the row the hold now creates
and still pins the release CAS in both directions, including the `pushed`/`ts_number` negative control
that must never be re-queued.

---

## Answers to the brief's targeted questions

1. **Is coverage really by construction?** Yes, for the hold class. I enumerated every durable
   "PMO lost track of a submit outcome" state from the code rather than from 0158's header:
   (a) the four `markOutboxHeld` sites — now witnessed in the same transaction, including the
   structurally sweep-exclusive `reauthorizeRecoveryReissue` one; (b) a post-submit unknown reclassified
   to `external-unreachable` (`erpnext/adapter.ts:141-149`) leaves the row `committing` → fenced by the
   outbox predicate, and resolves into (a) or into a `ts_number`; (c) `quarantineCommitting` → fenced;
   (d) `markOutboxCommitted`/`confirm` gaps leave `committed` → fenced; (e) the sweep's held-park —
   stamps (`erpnext-sweep/index.ts:1292`). The one residual is (f): `markOutboxFailed` on a
   **non-retryable** error thrown by `submitDoc` *itself* — reachable only through the 500-TypeError
   bucket (`erpnext/client.ts:341-343`), since every other PUT failure is either retried to
   `external-unreachable` or is a 4xx rejection that leaves no document. That is pre-existing, named by
   round 10, and unverifiable without a bench (see below). Everything after `submitDoc` returns is
   covered by `postSubmitUnknown`.
2. **Do the skip paths reopen the hole?** No. Non-uuid `pmo_record_id`: a legacy/foreign row whose id can
   never equal `p_timesheet_id::text`, so it fences nothing either way. Ghost uuid: the sheet does not
   exist, so there is nothing to re-open. Cross-org: the witness is written under the SHEET's org and the
   re-open's witness predicate carries **no org filter** (`0157:364-368`), so it still refuses; the
   attestation's `m.org_id = v_org` is the sheet's org, so the two agree. None of the three leaves a hold
   that fences nothing. The "may never make a hold fail" claim is true — I drove all three negative
   controls and each returned `1`.
3. **The adapted tests.** See MINOR 4: two are intact under the mutation the original caught, one lost
   half its discrimination. No oracle was weakened in the direction that matters (none of the three can
   now pass while the money predicate is broken).
4. **Is "advisory" safe for the `push_state='held'` predicate?** Yes. I enumerated every writer that can
   put a timesheet mirror into `held`: `mark_outbox_held` (0158), `record_timesheet_command_held`
   (0157 §3, stamped unconditionally outside its guard), and `parkTimesheetMirrorRow`'s held branch
   (which sets the witness in the same PostgREST patch). `markTimesheetPushOutcome`'s blind upsert can
   only ever write `pushed`/`failed` (`readModelWriters.ts:1000-1013`), so it can downgrade `held` but
   can never create one — and the witness is sticky through that downgrade. The claim holds.
   *(It is load-bearing in the other direction too: SHOULD-FIX 2 exists only because that predicate
   still refuses after the witness is gone.)*
5. **The residual over-stamp.** The asymmetry argument is right in the ordinary case and self-healing is
   better than the header claims: a later successful push learns a `ts_number` and §2 rule 1 dissolves the
   witness with no human at all, so a systematic probe misconfiguration does not leave an org-wide
   attestation backlog once the config is fixed. It costs an attestation only for a week that must be
   corrected *while still unpushed*. Where the argument is **incomplete** is the cost: "one audited Admin
   attestation" is true only when the hold's CAS landed. On a lost CAS it is an attestation *plus* a
   re-push, or DB surgery — SHOULD-FIX 2, reproduced above.
6. **Tests that cannot fail.** I did not accept the "mutation proven" claim. I re-derived the behaviours
   independently against the live DB *after* proving the definitions had landed with
   `pg_get_functiondef(...) like '%post_submit_unknown_at%'` — the same class of probe round 11 used to
   catch its own harness, run from my own session, on the DB's *internal* port inside the container
   (`docker exec … psql -p 5432`), which is the exact thing round 11's harness got wrong. The results
   above (`S1 held_cas_result=0`, `mirror_state=held witness=true`, the two refusals) are my own reads.
   The new pgTAP asserts exact values in both directions and mints its fixtures through the shipped
   writers; the deno addition (`timesheetBackstop.test.ts:167-199`) pins the structural fact (the sweep
   records nothing on the mirror) rather than restating the fix, which is the right shape for S2. The
   one structural blindness I can name is the one MINOR 4 and SHOULD-FIX 2 share: **every oracle for a
   `held` mirror stops at the moment the state is written, and none asks what can still move it.**

## Also confirmed (verified, not re-litigated)

- **`Draft`/`Submitted`/`Rejected` arms unchanged.** Mechanical comment-stripped diff of
  `transition_timesheet` across 0151 → 0152 → 0157: exactly two added `if exists (…)` blocks, four lines
  and five lines, nothing else — no reordering of the SoD check, no change to the stamps.
- **No machine-only RPC reachable by a client role**, on the migrated catalog:
  `mark_outbox_held`, `insert_timesheet_outbox_pending`, `record_timesheet_command_held`,
  `timesheet_push_key_witness` → `execute = false` for both `authenticated` and `anon`;
  `transition_timesheet`, `release_outbox_hold`, `attest_timesheet_no_erp_document` → `authenticated`
  only, `anon` false. `authenticated` has neither UPDATE nor INSERT on `timesheet_erp_mirror`, so the
  §2 trigger's GUC escape reaches no write.
- **No ERP cancel / correction-intent machinery.** `correction_intent`, `reopen_approved_timesheet`,
  `confirm_timesheet_cancel`, `complete_timesheet_reopen` appear only in the spec/plan/review prose and
  in 0151's Slice-B seam comment. Slice B is genuinely deferred.
- **DB performance.** 0158 adds, per hold: one PK re-read of `external_command_outbox`, one PK read of
  `timesheets`, and one `on conflict (timesheet_id)` upsert on the mirror's unique key. All index-served,
  all O(1), no new query on any listing path, no N+1, no unbounded scan. `release_outbox_hold` still has
  exactly one definition (`OVERLOADS release_outbox_hold=1` on a clean apply) — plan §10's integration
  hazard is real but belongs to whichever branch lands second.

## WHAT I COULD NOT VERIFY

- **No live ERPNext bench.** I did not observe a real post-submit unknown, a real deterministic `fromDoc`
  failure, or ERPNext's behaviour on a second Timesheet for one employee/week. In particular I could not
  test whether Frappe rolls back a submit that ends in the 500-TypeError bucket — the one classification
  on which "a terminal `failed` past `submitDoc` leaves no document" still rests (Answers §1(f)). PMO must
  not use ERPNext's own overlap validation as its fence, so this stays a real residual either way.
- **I did not run the gate battery** (told it is green) and did not measure changed-line coverage. My
  coverage observation is qualitative and confined to MINOR 4 and Answers §6.
- **The shared local DB is at 0151** and does not carry 0152/0155/0157/0158 (nor the sibling budget
  branch's 0153/0154/0156). Everything I assert was observed with those four applied on top inside one
  transaction and rolled back; I therefore did **not** re-observe the 2-arg/3-arg
  `release_outbox_hold` collision round 10 hit, and I could not inspect production or staging outbox /
  mirror rows, so the pre-0151 residue census remains unknown.
- **I reproduced SHOULD-FIX 2 at the database boundary**, performing the sweep's
  `dispatchMoneyWrite → markOutboxHeld` step as the `mark_outbox_held` RPC it calls and the winning
  claimant's terminal failure as the outbox write it performs — not by executing the deployed worker.
  The absence of a mirror recorder on that path was established by reading `erpnext-sweep/index.ts`
  (pass 1 skips `timesheets` at `:397`; `driveTimesheetPush`'s throw is contained at `:1644-1646`).
- **I did not re-run the builder's own mutation harness.** I substituted an independent replay with my
  own catalog probe, which is a stronger guarantee about the *behaviour* and a weaker one about the
  *harness*.

## CROSS-FAMILY BLIND SPOT

The bias that nearly cost me this round is the mirror image of round 10's. There, the reviewer read a
comment's enumeration as a specification. Here the enumeration is genuinely complete — and I caught
myself treating *that* as the end of the question. 0158's header is a careful, honest argument about
**who writes the witness**, and it is correct; what it never asks is **what the state it writes alongside
the witness does next**. `push_state = 'held'` is chosen in that INSERT with one sentence of
justification ("so the two rows agree the moment the hold exists"), which is true, and it is the value
that makes the row invisible to every recovery queue and refused by a predicate the same migration
demotes to "advisory" three paragraphs earlier. I only saw it by replaying the row's *life after* the
assertion the shipped test stops at. A different family would more likely have asked "and then what?"
of a state machine on first read, instead of grading the argument that was actually written.

Two places where that bias probably still costs you: (a) I graded 0157 §5's attestation against what it
*claims* to do (answer one question) and found it correct, rather than against what the operator needs it
to do (unblock the week) — SHOULD-FIX 2 is exactly that gap, and it took a DB replay to see; (b) the FE
was reviewed for whether it *agrees with* the RPC's refusals, which it now does precisely, rather than
for whether the product contains the act it instructs the operator to perform — SHOULD-FIX 1 is a
one-`grep` finding that eleven rounds of server-side review never had reason to run.

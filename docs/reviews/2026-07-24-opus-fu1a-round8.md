VERDICT: NO SHIP

Round 8 — adversarial money review of the timesheet `Approved → Draft` re-open (Slice A), `origin/dev..HEAD`
(23 commits, migrations 0151/0152/0155). Standing in for the capped cross-family gate (gpt-5.6-luna); I am
the same family as the builders, so I verified every claim against the code and, for the one BLOCK, against
the migrated local database rather than reasoning about it.

**The round-6 three are genuinely closed.** The round-7 CAS (`4a9fbe2a`) is, as far as I can attack it, correct
(details in "Round-6 closure check" below). The BLOCK below is **older than round 7 and was created by the
round-4 fix** — it is the one place where the migration's own stated safety invariant is false, and the
shipped pgTAP asserts the false state as intended behaviour.

---

## BLOCK 1 — `release_outbox_hold` converts "PMO does not know what ERP holds" into "re-open admitted"

**Money outcome:** ERPNext keeps a live, submitted Timesheet for week W while PMO returns W to Draft. The
corrected week is re-approved under a **new** approval generation → a new idempotency key → a **second** ERP
Timesheet. The client's project costing carries **both weeks of hours**, permanently, and PMO shows nothing
wrong. The original command can never be adopted afterwards (proof below), so this does not self-heal.

**Reproduction (run against the migrated local DB, `docker exec supabase_db_pmo-portal psql`, all inside a
rolled-back transaction — transcript verbatim):**

1. Sheet S is Approved (T1). A push is minted through the shipped guard, claimed, and the recovery probe
   fails deterministically (`mirrorMoney` refuses an ERP read-back value — the exact class round-3 SHOULD-FIX 3
   introduced the hold for). Outbox O1 = `held`; the served writer records mirror = `held` through the new CAS.
2. Re-open is correctly refused:
   `STATE A: re-open refused -> reopen-push-outcome-unknown`
3. An Admin runs the documented route out, `release_outbox_hold(O1, 'probe fixed; safe to re-drive')`:
   `outbox=failed mirror=failed ts_number=NULL`
4. Re-open of the *same sheet*, *same unknown ERP outcome*:
   `STATE B: *** RE-OPEN ADMITTED while the ERP outcome is UNKNOWN ***` → `sheet status now: Draft`
5. Corrected week re-submitted + re-approved, then:
   `OLD ROW: claim refused -> timesheet-approval-superseded (the live ERP doc can never be adopted)`
   `NEW COMMAND MINTED: 4110f9a8-… (a second ERP Timesheet for the same week)` → `outbox_rows_for_this_week = 2`

**Why the code permits it.** `supabase/migrations/0152_release_timesheet_mirror_hold.sql:86` moves the outbox
`held → failed` and `:95-107` CASes the mirror `held → failed`. The re-open arm's entire safety argument for
admitting `failed` is stated at `0152:239-245`:

> "For a timesheet command written by THIS release, `failed` means the failure happened BEFORE or AT the ERP
> submit — a rejection, which leaves no document."

`release_outbox_hold` is a counterexample to that sentence, produced by the same migration. A hold means the
POST/submit succeeded and the read-back did not (the arm says exactly this at `0152:219-228`); the release
**learns nothing about ERP** — it only re-queues. Both fences (`:232` held-mirror, `:260` non-terminal-outbox)
are keyed on states the release clears in one transaction.

**This is not an oversight in the tests — it is asserted.**
`supabase/tests/0152_reopen_refuses_held_mirror.test.sql:129,135`:
`'AC-TSC-R5(b): once released … the re-open ADMITS per the existing rules'` and `'the released sheet actually
flips to Draft'`. Thirty lines earlier the same file asserts that the held mirror means *"PMO does not know
whether ERP holds a document, and an unknown ERP outcome can never be admitted"* (`:104`). Both cannot be true.

**Why it is not self-healing.** After the release the backstop *can* re-drive (mirror `failed` is its queue) —
but (a) the re-open is one click, available immediately, and (b) the hold class is by construction
*deterministic*: the re-drive re-probes, re-maps, re-fails and re-holds. If a human re-opens first,
`claim_outbox_for_commit` refuses that row forever (`timesheet-approval-superseded`, `0151` §C), so the live
ERP document is never adopted and never gets a `ts_number` — the one fact that would fence the second push.
The FE actively offers the button in exactly this state: `pmo-portal/pages/Approvals.tsx:341-352` renders
"Re-open for correction" whenever `ts_number` is null and no non-terminal command exists.

**Trigger honesty.** There is no in-app timesheet release UI today (the only `release_outbox_hold` caller is
the *budget* banner, `pmo-portal/src/lib/repositories/budgetProjection.ts:246`), so step 3 is a psql/RPC action
by an Admin. That lowers frequency, not severity — and it is precisely the workflow the migration documents
("`release_outbox_hold` … is the operator's route out, and after it the ordinary rules apply again",
`0152:227-228`). The moment a timesheet release banner is added by symmetry with the budget one, this becomes
a two-click money loss.

**Smallest fix.** The release must not make an *unknown* look like a *rejection*. Two shapes, either is small:

- *(preferred, honest)* Add `timesheet_erp_mirror.post_submit_unknown_at timestamptz`, set by
  `record_timesheet_command_held` (and by the sweep's held park) and cleared only by a `pushed` outcome that
  learns a `ts_number` — or by an explicit, audited operator attestation ("ERPNext holds no Timesheet for this
  week"). Add one predicate to the re-open arm: refuse while it is set. The release then restores the recovery
  route *without* opening the re-open, which is what round 4 actually asked for.
- *(narrower, zero schema)* Capture what the probe already saw. `probeErpByAnchorKey`
  (`pmo-portal/src/lib/adapterSeam/erpnext/recoveryProbe.ts:63-70`) has the ERP document **name in hand** when
  `fromDoc` throws, and throws it away. Carry it on the `command-held` marker (the round-7 threading is
  already there) and write it to `ts_number`; the existing `reopen-erp-document-held` fence then holds
  forever, release or no release. This does not cover a probe that failed before listing, so it is a partial fix.

*(Do not "fix" this by releasing the timesheets outbox to `pending` instead of `failed`: `pending` ages out of
`outbox_reconcile_candidates` via `created_at > now() - outbox_max_auto_age()`, after which the sheet is
blocked with no release route — the round-4 dead end again.)*

---

## SHOULD-FIX

### S1 — the served seam that carries the round-7 marker is the one link with no test
`supabase/functions/adapter-dispatch/index.ts:937-941` is the only place the `heldOutboxId` /
`heldClaimGeneration` marker is *read*. `grep -rn heldOutboxId` returns exactly four hits: the type, the
stamp, one dispatch-side test, and this line. Both ends are tested (`dispatch.money.test.ts:1531-1539`,
`readModelWriters.timesheets.test.ts` round-6 cases); the join is not. That is the same shape as the defect
`dispatch.money.test.ts:1370-1378` itself documents ("the defect lived exactly in the JOIN between them").
Failure mode if it regresses: a genuinely-held command records mirror `failed` — safety then rests solely on
the outbox fence, and after BLOCK 1's release nothing holds. *Fix:* extract `recordTimesheetPushFailure`'s
marker extraction into a named exported pure function (`heldIdentityFor(failure)`) in `readModelWriters.ts`
and assert both arms in the deno suite.

### S2 — the CAS's "fails closed" is fail-*open* on the mirror side
`0155:98` records `failed` whenever the CAS misses, including when `p_outbox_id` is NULL. The header calls
this "fails closed to `failed`, never a blind `held`" — but on the *mirror* fence `failed` is the permissive
state and `held` is the restrictive one, so a lost marker downgrades the fence rather than tightening it.
It is currently covered by the outbox-side check, which is why this is not a BLOCK. *Fix:* when the exact row
cannot be located at all (`v_out_state is null`), raise instead of recording an outcome — an unlocatable
outbox row is a bug, not an outcome, and the served catch already swallows the throw (`index.ts:947-949`).

### S3 — the generation guard's NULL-witness escape admits a *proven-stale* writer
`0155:116` allows any overwrite when the existing row's `approved_at_pushed is null`. The rows the sweep
creates always have a NULL witness — `parkTimesheetMirrorRow`'s absent-branch insert names only
`org_id/timesheet_id/push_state/push_error` (`supabase/functions/erpnext-sweep/index.ts:1288`). So on exactly
the rows the sweep writes, the guard's stated property ("a STALE (older-generation) writer's `failed` is a
no-op against a newer generation's row", `0155:33-35`) is false. The 0155 tests only exercise witnessed rows
(`0155_command_held_generation.test.sql` seeds `approved_at_pushed` on every row), so no test can see this.
Reachability is narrow (it needs a served stale writer landing on a sweep-parked row), which is why it is not
a BLOCK. *Fix:* have `parkTimesheetMirrorRow` write the candidate's `approved_at` as the witness, or treat a
NULL existing witness as "unknown generation ⇒ only a CAS-matching (non-stale) writer may overwrite".

### S4 — the re-open surface is an unbounded, never-shrinking query on a hot page
`pmo-portal/src/lib/db/timesheetTransition.ts:218-247` selects **every** Approved timesheet in the org that
isn't the viewer's, with entries + mirror joined, with no `limit` and no date bound, then feeds every id into
`.in('pmo_record_id', ids)`. Approved sheets accumulate forever (Admin/Exec/PM/Finance see all rows under
`timesheets_select`), so at 200 staff × 5 years this is ~50k rows per Approvals page view and a PostgREST
`in` list long enough to hit URL limits. The index support is fine (`timesheets_org_status_week_idx` covers
`status` + `week_start_date DESC`; the outbox side is covered by
`external_command_outbox_one_inflight_per_record`) — the problem is the missing bound, not a missing index.
*Fix:* bound to a correction-relevant window (e.g. `week_start_date >= now() - interval '90 days'`) and/or
`.limit()` + "show older", and chunk the `in` list.

### S5 — the dblink pgTAP file leaks committed fixtures on any mid-file failure
`supabase/tests/0155_command_held_interleave.test.sql` commits its org/user/profile/timesheet/outbox rows from
a second session (correctly — a row-level `FOR UPDATE` needs cross-session visibility) and removes them at the
end. pgTAP's `rollback` cannot undo them, so if any statement between the fixture insert and the cleanup errors
(the step-2 `dblink(... record_timesheet_command_held ...)` raises, the connection drops, the lock wait behaves
differently under CI load), the rows survive for the rest of the `supabase test db` run. Nothing in the run
counts globally today, so I could not construct an actual cross-file failure — but this is the first file in
the repo that can leave state behind, and the next unscoped `count(*)` test written anywhere in the suite will
inherit a flake with a very confusing signature. *Fix:* add an idempotent pre-clean (`dblink_exec` the same
DELETE block *before* the inserts), so a leaked run self-heals on the next one.

---

## NOTES

- **N1 — the "rejection leaves no document" invariant has a second, smaller hole.** `commitCreate` does
  `createDoc` → `submitDoc` (`pmo-portal/src/lib/adapterSeam/erpnext/adapter.ts:194-196`). A create that
  succeeds followed by a submit ERP *rejects* is terminal `failed` while ERPNext holds a **draft** Timesheet
  PMO has no pointer to. Draft docs carry no costing, so this is orphan clutter rather than a double-count —
  but the sentence at `0152:240-242` is stated absolutely and is not.
- **N2 — the CAS's return value is discarded.** `record_timesheet_command_held` returns `held`/`failed`;
  `markTimesheetPushOutcome` (`readModelWriters.ts:966-977`) ignores it, so the one signal that "your hold was
  recorded as failed because it had been released" never reaches a log or an operator surface.
- **N3 — surface wording.** With mirror `held` + a terminal outbox (the sweep's `attempts-exhausted` park),
  `Approvals.tsx:343` classifies the row as `inFlight` and says "Push in progress" for something that is not
  in progress. The server has the last word, so it is cosmetic — but it is the kind of statement this program
  has repeatedly decided must be true rather than plausible.

---

## Round-6 closure check (I attacked these hardest; they hold)

1. **Threading.** All four `command-held` throw sites in `dispatch.ts` (`:334`, `:373`, `:403`, `:563`) stamp
   the marker with the row's own id + token; the two Payment-Entry sites stamp *their* row, and the mirror
   writer is only invoked for `approvedSheet` (a gated timesheet push), so a PE marker can never reach the
   timesheet recorder. `toDispatchError` returns an `AppError` by identity (`dispatch.ts:654`), and both served
   catches keep the instance (`index.ts:1049`, `:1134`) — no re-wrap drops it. The sweep never calls the
   recorder at all, so there is no unmarked served path. (Untested seam: S1.)
2. **Lock ordering.** `record_timesheet_command_held` takes outbox-row → mirror-row; `release_outbox_hold`
   takes the same order (`0152:56-60` then `:102`). `transition_timesheet` takes the `timesheets` row lock then
   the advisory lock but never a row lock on the outbox/mirror; `claim_outbox_for_commit` takes the advisory
   lock then updates the outbox and never row-locks `timesheets`. No cycle, no third writer of the mirror under
   a conflicting order.
3. **The generation witness / CAS stability.** `mark_outbox_held` does **not** bump `claim_generation` (verified
   against the live catalog), and `claim_outbox_for_commit` cannot claim a `held` row, so the token the marker
   carries is stable from hold to mirror write — the CAS cannot spuriously miss. Only `release_outbox_hold`
   bumps it, which is the intended miss. `>=` (not `>`) on the witness is right: one key per approval means one
   row per generation, so an equal witness is the same generation re-writing itself.
4. **The dblink test proves what it claims.** `lock_timeout` fires only on a lock wait, and the only lock the
   RPC waits on is the exact outbox row, so the 55P03 assertion cannot pass for a connection failure (that
   errors the file) or an unrelated wait; the sibling file supplies the positive control (a still-held row at
   the right generation records `held`), so "always record failed" does not pass the suite. Leak risk: S5.

## Also confirmed (not re-litigated)

- `Draft` / `Submitted` / `Rejected` arms of `transition_timesheet` are behaviourally unchanged from 0007
  (mechanical diff: only the map entry, the new `Approved→Draft` arm, and the narrowing of the old Draft arm
  by `v_from = 'Rejected'`).
- `insert_timesheet_outbox_pending` and `record_timesheet_command_held` are service_role-only — confirmed on the
  live catalog: `has_function_privilege('authenticated'|'anon', …, 'execute')` = `f` for both.
- `POST_SUBMIT_UNKNOWN_IS_IN_FLIGHT` contains only `timesheet` (`adapter.ts:112`); every other kind's
  post-submit error returns by identity.
- No ERP cancel / correction-intent machinery exists (`grep` for `correction_intent` /
  `reopen_approved_timesheet` / `confirm_timesheet_cancel`: no hits) — Slice B is genuinely deferred, and the
  refusals that stand in for it are correct behaviour.

## WHAT I COULD NOT VERIFY

- No live ERPNext bench run: I did not observe a real post-submit unknown, a real deterministic `fromDoc`
  failure, or ERPNext's actual behaviour on a second Timesheet for the same employee/week. If ERPNext's overlap
  validation rejects the second submit, BLOCK 1's outcome changes from "hours double-counted" to "the corrected
  week can never reach ERP while an orphan document holds the original" — both are money-wrong; I state the
  first because PMO must not depend on the external system's validation as its fence.
- I did not run the full gate battery (told it is green) and did not measure changed-line coverage; my coverage
  observation is qualitative and confined to S1/S3.
- I could not inspect production/staging outbox or mirror rows, so the size of the pre-0151 residue population
  (0151's own named gap) remains unknown.
- BLOCK 1's reproduction was executed at the database boundary (RPC-level, one rolled-back transaction), not
  through the deployed edge functions and UI.

## CROSS-FAMILY BLIND SPOT

Honestly: the thing I am worst-placed to catch is the thing I nearly missed. The 23 commits are dense with
first-person narrative comments that *assert* their own safety ("the double-count is unreachable", "after it
the ordinary rules apply again", "fails closed"). I share the builders' prior for writing exactly that prose,
and my instinct is to read it as a specification rather than as a claim. BLOCK 1 sits inside the most
confident paragraph in the diff and is asserted as correct by its own pgTAP — I only found it because I
insisted on replaying the state machine in the database instead of following the argument. A different family
would more likely have flagged the sentence at `0152:239-245` on first read, because it would not have found
the phrasing familiar.

Two more places where that bias is likely still costing you, and where I would want the cross-family gate to
re-look even after BLOCK 1 is fixed: (a) the *narrative* justification for admitting terminal `failed` at all
(everything rests on one classification decision in `postSubmitUnknown`, and I checked it holds *today* — I did
not enumerate every future non-retryable error that can escape after a submit); and (b) the pgTAP fixtures,
which are now mostly minted by the shipped writers (genuinely good) but still choose the *witnessed*, tidy
shape of every row — S3 exists precisely because the untidy shape the sweep writes was never put under the
oracle.

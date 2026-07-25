VERDICT: NO SHIP

## Findings (ranked by money impact)

### 1. BLOCK — 0155 still permits the round-5 release-before-mirror race

**Failure:** `record_timesheet_command_held` is not one atomic read/write. Its `EXISTS` query at `supabase/migrations/0155_fence_timesheet_command_held_mirror.sql:51-57` sets `v_state='held'`, then the function reaches the separate mirror `INSERT` at `:71-77`. The `EXISTS` query does not lock the outbox row.

Reproduction:

1. O1 is `held`; its mirror row does not yet exist.
2. The late handler enters the RPC, sees `EXISTS=true`, and is descheduled before the `INSERT`.
3. Admin `release_outbox_hold` locks O1, changes it to `failed`, updates zero mirror rows, and commits (`supabase/migrations/0152_release_timesheet_mirror_hold.sql:85-107`).
4. The late handler resumes with the already-selected `v_state='held'` and inserts a new `held` mirror row. There is no conflict, so the `WHERE push_state <> 'pushed'` predicate cannot help.

The final state is again **outbox `failed` + mirror `held`**: the backstop excludes the mirror, the re-open fence refuses it, and the released outbox cannot be released again. The new pgTAP test only tests release completing before the RPC starts (`supabase/tests/0155_command_held_fenced_on_release.test.sql:77-100`); it does not pause after `EXISTS`.

**Smallest fix:** lock and recheck the exact outbox row (`SELECT ... FOR UPDATE`) before writing the mirror, with release taking the same lock order, or make the fence and mirror write one correctly locking/revalidating SQL operation. Add the interleaving test, not just the serial ordering test.

### 2. BLOCK — the live-held `EXISTS` can belong to a newer approval generation

**Failure:** The RPC has no outbox id, claim generation, idempotency key, or generation comparison. It only asks whether *any* timesheet outbox for `(org, timesheet_id)` is currently `held` (`0155:33-64`). The partial unique index only prevents simultaneous non-terminal rows; it admits a successor after the old row becomes terminal (`supabase/migrations/0134_outbox_serialization_and_key_single_use.sql:52-55`).

Reproduction:

1. Generation T1 creates O1; ERP POST succeeds, recovery fails deterministically, O1 becomes `held`, and T1's late writer is delayed.
2. Admin releases O1 to `failed`.
3. T1 is re-opened, corrected, submitted, and approved as T2. O2 is admitted because O1 is terminal; O2 reaches `held` after its own recovery probe failure.
4. The delayed T1 writer calls `record_timesheet_command_held`. O2 is the row satisfying `EXISTS`, so the RPC writes `held` for O2 while persisting T1's `approved_at` and reason (`0155:71-77`).

The mirror now attributes O2's unknown ERP document outcome to T1. `claim_generation` is bumped by release (`0152:85-89`) but is never supplied to or checked by this RPC. That is not a generation-exact CAS; a later generation-specific recovery/correction can use the wrong witness and risk posting or reconciling the wrong week's ERP document.

**Smallest fix:** carry the exact outbox id plus claim generation (or an equivalent exact generation key) into the recorder and condition the decision/write on that row. If the exact row has been released and a successor is active, the stale writer must not write any outcome onto the successor's mirror.

### 3. BLOCK — the new pushed-row guard hides a held push after an earlier empty-sheet success

**Failure:** `push_state='pushed'` is not synonymous with “a live ERP document exists.” The empty-approved-sheet path deliberately records `pushed` with `ts_number=NULL` (`supabase/functions/adapter-dispatch/index.ts:756-767`; test `supabase/functions/adapter-dispatch/readModelWriters.timesheets.test.ts:168-181`). The mirror is one row per sheet, so that row survives the next approval generation.

Reproduction:

1. T1 has no chargeable hours. Its mirror becomes `pushed`, `ts_number=NULL`.
2. T1 is re-opened (the live-document fence only rejects `ts_number IS NOT NULL`, `supabase/migrations/0152_release_timesheet_mirror_hold.sql:215-218`), corrected, and re-approved as T2.
3. T2's ERP POST succeeds but recovery's deterministic read-back fails, so O2 becomes `held`. The new RPC computes `v_state='held'`, but its conflict predicate is false against the old `pushed` mirror (`0155:71-77`). The upsert silently updates zero rows and leaves the mirror claiming `pushed` with T1's old witness.
4. Releasing O2 changes the outbox to `failed`, but `release_outbox_hold` releases the mirror only when it is `push_state='held'` (`0152:102-107`). The mirror remains `pushed`; the timesheet backstop excludes it (`supabase/functions/erpnext-sweep/index.ts:1448-1459`).
5. Re-open now sees no `ts_number`, no `held` mirror, and only a terminal `failed` outbox (`0152:230-237`), so it can admit another approval while O2's ERP document may still exist. The next push can create a second ERP Timesheet and double-count the hours.

The predicate correctly protects an existing `pushed` row with a live ERP number, but it is too broad for the documented no-document `pushed` state. Before 0155, the command-held write would have changed this prior row to `held`, preserving the safety fence.

**Smallest fix:** distinguish a live pushed document (`ts_number IS NOT NULL` and not cancelled) from the documented pushed/no-document outcome, preferably with an explicit generation/outcome witness. Add the empty-generation → held-generation → release regression test.

## Attack dispositions

- **Conflict/upsert for the new RPC:** for an existing live `pushed` mirror, `ON CONFLICT ... WHERE timesheet_erp_mirror.push_state <> 'pushed'` protects the ERP number and applies to both `v_state='held'` and the released `v_state='failed'` arms. Finding 3 is the exception caused by the legitimate `pushed`/`ts_number=NULL` state.
- **Delegation:** `markTimesheetPushOutcome` checks `outcome.code === 'command-held'`, calls `record_timesheet_command_held`, and returns before the old upsert (`supabase/functions/adapter-dispatch/readModelWriters.ts:958-967`). No command-held path reaches that old upsert.
- **ACL and normal request tenancy:** authenticated/anonymous execution is revoked and only `service_role` is granted (`0155:82-86`). The edge function derives `orgId` from the caller profile (`supabase/functions/adapter-dispatch/index.ts:644-655`), and the approved-timesheet gate rejects a sheet whose org differs from the actor's org (`supabase/migrations/0138_approved_timesheet_for_push.sql:45-57`). A normal tenant caller cannot use this RPC for another org.
- **Defense-in-depth NOTE:** the RPC itself does not assert `timesheets.org_id = p_org`. A service-role caller can invoke it with `p_org=OrgA` and an existing sheet from OrgB; the FK checks only the sheet UUID, so the no-outbox branch can insert a failed mirror carrying OrgA. Service role already bypasses RLS and can write the table directly, so this is not an authenticated tenant escalation, but deriving/checking org from the sheet would close the argument-level gap.

## Verification

- `scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db'` — PASS (231 files / 2,305 tests).

## WHAT I COULD NOT VERIFY

- I did not run two live concurrent Edge Function transactions against a deployed ERPNext instance or inspect production rows. The BLOCKs above are reproducible from the committed SQL statement/lock ordering and the documented state transitions.
- The committed 0155 test suite does not exercise a pause between `EXISTS` and `INSERT`, a successor approval generation, or a prior `pushed` mirror with `ts_number=NULL`.

LUNA-REVIEW-DONE

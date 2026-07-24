VERDICT: NO SHIP

The spec closes several previously found holes, but its cancellation path is not yet a money-safe state machine. The shipped outbox, sweep, and mirror primitives do not compose into the claimed correction operation without additional generation, authorization, and recovery contracts.

## Findings (ranked by money impact)

### 1. BLOCK — `Approved → Draft` can pass while a live ERP generation is committed or racing

**Failure:** T1 is created/submitted in ERP. The `after-commit-before-mirror` seam fires. The outbox is already `committed` with `external_record_id=T1`, but no mirror row exists yet. The §4.1/FR-TSC-010 predicate sees no live mirror and no `committing` row, so it permits `Approved → Draft` while T1 is live. The later corrected push is blocked by the non-terminal `committed` row, or the delayed finalize writes T1 back into the mirror after PMO is Draft; the 32h correction is then stranded (and the mirror can say the wrong generation is current).

The same gap exists after a successful cancel has only partially finalized: a tombstone is present, but the cancel outbox is still `committed` and the mapping/lineage work is unfinished. FR-TSC-010 allows Draft on the tombstone alone, then re-approval encounters the still-live mapping or an unfinished command.

**Evidence:** correction spec §4.1, FR-TSC-010/060 (spec lines 161–172, 237–245); `adapter-dispatch/index.ts:1075–1082` fault seam; `pmo-portal/src/lib/adapterSeam/dispatch.ts:457–466`; `supabase/migrations/0096_erpnext_seam_tables.sql:196–207`; `supabase/migrations/0134_outbox_serialization_and_key_single_use.sql:52–55`.

**Smallest fix:** Define “cancel confirmed” as a durable, generation-specific completion condition: mirror tombstone + idempotent lineage + mapping superseded + cancel outbox `confirmed` (or an equivalent atomic DB marker). The RPC must inspect all relevant non-terminal outbox states and mapping evidence, not only `committing`. Serialize the check/status update with the push/cancel claim using a shared per-timesheet lock; a read of mirror/outbox followed by an unrelated update is not a reservation.

### 2. BLOCK — the spec calls a queued push safe, but it can post after Draft and permanently wedge the next generation

**Failure:** A push outbox row is `pending`. The re-open RPC reads that it is not `committing` and proceeds. Before the status update commits, `approved_timesheet_for_push` reads the still-Approved row, claims the pending command, and creates T1; the RPC then commits Draft. This violates the central invariant and a later correction can create a second live document unless blocked elsewhere.

If the pending claimant instead observes Draft, its gate refuses, but the old `pending` row remains. `external_command_outbox_one_inflight_per_record` includes `pending`; the next approval’s new `ts:<id>:t2` row receives `command-in-flight-for-record`. The timesheet backstop does not find a Draft sheet to clear the old row. The corrected week never reaches ERP.

**Evidence:** correction spec FR-TSC-081 explicitly allows `pending` (spec lines 364–372); `supabase/migrations/0138_approved_timesheet_for_push.sql:45–47` does not lock the sheet; `pmo-portal/src/lib/adapterSeam/dispatch.ts:511–519`; migration 0134 lines 52–55; `erpnext-sweep/index.ts:1391–1399` only queues absent sheets while `status='Approved'`.

**Smallest fix:** Reject pending push commands during re-open, or atomically retire/poison the generation’s pending row inside the re-open transaction. If pending is retained as an allowed case, the claim gate and the transition must take the same per-sheet lock and re-check status immediately before the ERP POST; the current gate read is insufficient.

### 3. BLOCK — `cancel_origin='pmo'` is not a generation discriminator; the sweep can replay the old push as a correction is opening

**Failure:** T1 is cancelled, the mirror is stamped `cancel_origin='pmo'`, and the PMO status is still Approved for the small interval before `transition_timesheet` commits Draft. The FR-TSC-082 widened queue sees Approved + a PMO tombstone and derives the old push key `ts:<id>:t1` because `approved_at` has not changed. It finds the already-confirmed T1 push row and replays it; the confirmed replay calls `timesheetsWriter`, which clears the tombstone and marks T1 `pushed` even though ERP has T1 at `docstatus=2`. The user is either blocked from reopening or is left with a Draft sheet whose ERP state is not what PMO believes.

The failure path is worse: FR-TSC-011 requires a failed cancel to set mirror `push_state='failed'` while `erp_cancelled_at` may still be null. The existing timesheet queue then treats the failed *cancel* as a failed *create*, derives `ts:<id>:t1`, and never retries `tsc:<id>:t1`. If the ERP cancel actually committed before the failure, PMO can falsely resurrect T1 in its mirror; if it did not, the cancel is silently lost.

**Evidence:** correction spec FR-TSC-052/070/082 and the claim in §5.3 that no push fires while Approved pending cancel (spec lines 323–328, 373–398); `erpnext-sweep/index.ts:1429–1455` and `1519–1569`; `readModelWriters.ts:891–912` (confirmed replay clears `erp_cancelled_at`).

**Smallest fix:** Give cancellation its own durable intent/queue and operation-aware backstop. A PMO tombstone before the status flip must be excluded from the push queue; only a *new* approval generation, with a matching create outbox row or an explicit generation marker, may be driven. A failed cancel must never be represented solely by the push mirror’s `failed` state.

### 4. BLOCK — the shipped sweep has no owner for a failed correction cancel

**Failure:** The PMO cancel is a `transition` command. On a classified ERP rejection, `dispatchMoneyWrite` stores `state='failed'`. Migration 0131 deliberately excludes failed transition rows from automatic candidates. The generic sweep also unconditionally skips the `timesheets` domain, while `timesheetBackstop` only derives and drives `ts:<id>:<approved_at>` create pushes; it has no `tsc:` cancel path. Therefore the required “cancel failed → sweep retries the same cancel key” path in FR-TSC-011 and the error table has no reachable implementation.

**Evidence:** correction spec FR-TSC-011/052 and AC-TSC-052; `supabase/migrations/0131_outbox_rejection_terminal.sql:42–61`; `supabase/functions/erpnext-sweep/index.ts:376–393`; `supabase/functions/erpnext-sweep/index.ts:1519–1569`.

**Smallest fix:** Add a correction-cancel reconcile pass that selects only this explicitly authorized intent, preserves 0131’s terminal rule for unrelated human transitions, derives the persisted `tsc:` key, and uses the cancel-specific finalizer. Add a real test for ERP rejection and transport failure; the current push backstop is not that pass.

### 5. BLOCK — the required server-resolved cancel target cannot pass through the shipped command path

**Failure:** FR-TSC-030 forbids a client `externalRecordId` and requires resolution from `external_refs`. The current `checkTransitionTargetBinding` permits a missing target but only validates a supplied one; it does not inject or return the mapped name. The adapter then requires `record.externalRecordId`. A client-supplied target is rejected by the timesheets guard. Thus a valid cancel either reaches `adapter.ts` and fails “transition requires externalRecordId,” or violates the target-binding rule.

**Evidence:** correction spec FR-TSC-030; `transitionTargetGuard.ts:50–75, 104–132`; `pmo-portal/src/lib/adapterSeam/erpnext/adapter.ts:157–165`. The existing `dispatchFactory` timesheet preflight resolves employee/project refs but not the transition target (`dispatchFactory.ts:412–422, 812–816`).

**Smallest fix:** Specify a server-only target resolution contract (for example, resolve `external_refs` into an internal `ctx.refs.self` consumed by a timesheet-cancel adapter path). Never place that target in the client command, and add an AC for “no client target reaches ERP successfully; a foreign target is rejected.”

### 6. BLOCK — generic outbox finalization writes a cancel as a fresh live push

**Failure:** Even if the target is injected, the shipped `dispatchMoneyWrite` finalizer first upserts the external mapping, then invokes the domain writer. `timesheetsWriter` unconditionally writes `push_state='pushed'`, copies the cancelled canonical’s `ts_number`, and clears `erp_cancelled_at`; it does not write timesheet cancellation lineage or clear the mapping. A successful ERP cancel therefore leaves PMO saying T1 is current/live, and the next re-open is rejected as if T1 were still enforceable. This is the opposite of FR-TSC-040/041.

**Evidence:** `pmo-portal/src/lib/adapterSeam/dispatch.ts:218–246`; `supabase/functions/adapter-dispatch/readModelWriters.ts:891–916`; correction spec FR-TSC-040/041.

**Smallest fix:** Make finalization operation-aware and fenced: cancel → record one cancellation lineage row → tombstone mirror with origin → clear the current mapping → confirm the cancel outbox. Do not route cancel through the fresh-push writer or generic `recordOutboxRef` upsert without a specified compensating transaction/order.

### 7. BLOCK — cancel is exposed without the re-open authority or a one-time correction intent

**Failure:** `isTimesheetPush` gates every timesheet operation alike. The served path only checks Approved status; `approved_timesheet_for_push` admits the historical approver or any `Admin`, `Executive`, `Project Manager`, or `Finance`. Once the new server-side target resolution exists, a Finance/Project Manager (or an old approver whose current manager authority has changed) can POST `operation:'transition', verb:'cancel'` directly. ERP T1 is cancelled while PMO remains Approved, without the §4.1 `Approved → Draft` authority check. A delayed/unauthorized cancel can then be mistaken for a PMO tombstone and re-created by the widened backstop.

**Evidence:** correction spec FR-TSC-020/021 and §2; `supabase/functions/adapter-dispatch/approvalGuard.ts:46–49`; `supabase/functions/adapter-dispatch/index.ts:704–719`; `supabase/migrations/0138_approved_timesheet_for_push.sql:76–84`; `adapter.ts:175–182`.

**Smallest fix:** Require a server-created, timesheet-generation-bound correction intent, created only after the exact re-open authority (approver population + Admin, owner rejected) succeeds. The cancel command and its sweep retry consume that intent; a generic timesheet push authorization must not authorize cancel.

### 8. BLOCK — desk/PMO cancel ordering is not an atomic first-writer decision

**Failure:** PMO sends cancel; the accountant cancels T1 in Desk before PMO finalization. The inbound path can stamp `desk`, then the PMO path can later stamp `pmo` unless the new writer performs an atomic compare-and-set. The widened `pmo` queue then treats an accountant’s permanent Desk tombstone as a correction and re-creates ERP work. The reverse race can produce two lineage inserts before either side sees the other. Unknown/null origin is only fail-closed in the queue; it does not solve a concurrent PMO write.

**Evidence:** correction spec FR-TSC-082/090 says the echo must not overwrite a non-null origin but specifies no lock/CAS; current `erpnextFeedDeps.ts:150–165` unconditionally updates the tombstone, and `lineage.ts:46–57` resolves/tombstones/inserts in separate calls. `external_ref_lineage` has no uniqueness constraint (`supabase/migrations/0096_erpnext_seam_tables.sql:82–94`).

**Smallest fix:** Make origin assignment an atomic conditional update that returns the winning origin; PMO must abort/skip if `desk` won, and inbound must no-op if `pmo` won. Add a unique cancellation-lineage key plus `ON CONFLICT DO NOTHING`, and test both interleavings (including duplicate webhook delivery).

### 9. BLOCK — ADR-0058’s anchor recovery cannot recover a crashed cancel

**Failure:** The ERP `PUT {docstatus:2}` commits, then the process dies before the adapter returns/marks the outbox committed. The cancellation key is never stamped into T1: `commitTransition` only calls `cancelDoc` and re-fetches. When a stale `committing` row is quarantined, the generic recovery probe searches the Timesheet anchor (`note`) for `tsc:<id>:t1`; T1 only carries the original `ts:<id>:t1` push key. The probe misses, and the generic immutable-anchor policy retries cancel; ERPNext returns `417 Cannot edit cancelled document` (the spike’s §6 behavior), leaving the mirror live and the sheet blocked. If the implementation chooses `held` instead, it still strands the correction with no specified resolution.

**Evidence:** correction spec FR-TSC-052 and R-CRASH-WINDOW; `pmo-portal/src/lib/adapterSeam/erpnext/adapter.ts:175–182`; `pmo-portal/src/lib/adapterSeam/dispatch.ts:489–501`; `docs/spikes/2026-07-20-erpnext-timesheet-fields.md:§2, §6`.

**Smallest fix:** Give cancel recovery its own idempotent probe: persist the resolved T1 target in the cancel outbox payload, GET its current docstatus during recovery, treat docstatus 2 as successful cancellation, and finalize the tombstone without relying on a create anchor or blindly issuing a second cancel. Add a fault test for death after the ERP cancel commit and before outbox finalization.

## Acceptance and coverage defects

### SHOULD-FIX — AC-TSC-052 asserts an impossible mechanism

A same-key retry does not collide on `23505`: `dispatchMoneyWrite` reads the existing outbox row before inserting, and `timesheetBackstop` also reads the same key (`erpnext-sweep/index.ts:1519–1521`; `dispatch.ts:533–556`). The existing ADR explicitly describes same-key retry as “never inserts.” AC-TSC-052’s required “second attempt COLLIDED … a `23505`” cannot be true for a conforming implementation. Assert one ERP cancel, one row, and reconciliation; test a different-key race separately if desired.

### SHOULD-FIX — AC-TSC-040 is owned by a layer that cannot execute the claimed writer

The traceability table assigns the full lineage/mapping/mirror lifecycle to pgTAP, but the shipped lineage and read-model writes are edge-function/service-role code (`lineage.ts`, `erpnextFeedDeps.ts`, `readModelWriters.ts`), not a SQL RPC called by the AC. A pgTAP fixture cannot cause the implementation to write those rows without either pre-seeding the result or testing a SQL imitation. Move the lifecycle AC to served-boundary e2e; keep pgTAP for RPC authority, RLS, uniqueness, and CAS contracts.

### SHOULD-FIX — required failure/crash cases have no owning AC

FR-TSC-011’s ERP-rejected/unreachable cancel, the pending-row race, the crash after cancel commit, and the Desk-during-PMO interleaving are not owned by any AC. AC-TSC-011 is a sequential happy path; AC-TSC-052 is the impossible collision assertion; AC-TSC-090 is sequential. A green suite can therefore omit the exact lost-count paths this spec claims NFR-TSC-IDEM-001 covers.

### NOTE — AC-TSC-020 is internally sequentially inconsistent

It says M and A both succeed against one Approved sheet, but M’s successful call changes it to Draft before A calls the same transition. Use an independent Approved fixture/transaction per actor.

## WHAT I COULD NOT VERIFY

- I did not run the Supabase stack, ERPNext, Playwright, or a real concurrent transaction/fault-injection test; the reproductions above are derived from the shipped SQL and code paths.
- I could not verify owner decisions for OQ-TSC-2/OQ-TSC-3 or acceptance of Proposed ADR-0059. The correction implementation itself does not exist yet, so its future operation-specific finalizer/lock design cannot be inspected.

LUNA-REVIEW-DONE

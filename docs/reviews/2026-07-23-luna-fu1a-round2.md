VERDICT: NO SHIP

Scope: adversarial Round 2 review of `origin/dev..HEAD` (`f572a5c7`, 20 commits) for Slice A of the timesheet correction path. Slice B's live-ERP cancel/intent machinery remains out of scope; I did not treat its absence as a defect.

Execution:

- `scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db'`: PASS — 227 files / 2,269 pgTAP tests.
- `cd pmo-portal && npm run verify:locked`: PASS — typecheck, lint, 760 Vitest files / 6,534 tests, and build.
- Relevant Deno suites: PASS — 26 adapter-dispatch tests and 13 timesheet-backstop tests.
- `git diff --check`: PASS.

## Round-1 disposition

| Round-1 finding | Round-2 result |
|---|---|
| BLOCK 1 — unguarded absent mint / failed-row claim | The original `Draft` race is fixed: the absent mint uses the fenced RPC and the claim now takes `ts-correct:<canonical-uuid>` and raises `P0001` on `Draft`. It is **not fully closed**; the fence still ignores the approval generation (Finding 1). |
| BLOCK 2 — authenticated callers mint forged outbox rows | **Fixed.** `authenticated`, `anon`, and `public` no longer have execute privilege; `service_role` is the only grant, and the ACL test exercises an authenticated forged call. |
| BLOCK 3 — UUID spelling split | **Partial.** The SQL guard and served command record now use the canonical UUID. The deterministic key is still derived from raw client text and is not enforced against the gate's canonical `(id, approved_at)` (Finding 3). |
| SHOULD-FIX 4 — surface honesty / stale caches | **The requested re-open fix is present.** The DAL reads non-terminal outbox states and `reopenApproved` invalidates both the re-openable and push-attention keys. A record-aware authority mismatch and approval-path refresh gap remain (Finding 5). |
| SHOULD-FIX 5 — weak concurrency/ACL tests | **Partially fixed.** The dblink lock-wait test and ACL test are real improvements. They do not cover generation rollover, committed-row recovery, post-submit failure classification, or the served key adoption (Finding 6). |

## Findings (ranked by money impact)

### 1. BLOCK — Both new fences validate `status = 'Approved'`, but neither validates the approval generation

`approved_at` is the generation witness and is deliberately retained on `Approved → Draft`, then replaced on the next approval (`supabase/migrations/0151_timesheet_reopen_unpushed.sql:152-158`). The insert guard only loads `status` (`:175-207`); the recreated claim only loads `domain`, `pmo_record_id`, and `status` (`:247-277`). Neither compares the persisted command's `payload.approved_at` / key to the sheet's current `approved_at`.

Concrete interleaving:

1. Generation T1 is `Approved`; a T1 push row is `failed` and therefore intentionally does not block re-open.
2. A sweep/foreground request has already read T1 and is paused before its insert or claim.
3. The approver re-opens the sheet, the owner edits it, and it is submitted and approved again as generation T2.
4. The paused T1 insert enters the lock, sees only `status = 'Approved'` (now T2), and inserts T1; or the paused T1 retry enters `claim_outbox_for_commit`, sees only `status = 'Approved'`, and claims the old failed row.
5. The old hours can be posted, followed by T2's corrected hours: two ERP Timesheets for one correction cycle.

The claim path is reachable exactly as written: `dispatch.ts:511-515` sends existing `failed` rows directly to `claimOutboxForCommit`; the claim RPC has no generation predicate. I reproduced this locally in one rolled-back SQL transaction: after creating a failed T1 row, performing `Approved → Draft → Submitted → Approved`, the current `claim_outbox_for_commit` returned `state = committing` and `attempt_count = 1` for the stale T1 row.

**Required fix:** carry the approval witness into both DB fences. The insert must reject when the payload/key witness is not the current `timesheets.approved_at`; the claim must reject a timesheet row whose persisted payload witness does not equal the current witness (fail closed for old rows with no witness). Add the actual `Draft → re-approve → stale insert/claim` money oracle, not just a `Draft` oracle.

### 2. BLOCK — A post-submit unknown failure is recorded as terminal `failed`, so Slice A can reopen while ERP already holds the Timesheet

The shipped ERP adapter invokes `afterSubmitHook` after the ERP submit and before the re-fetch (`pmo-portal/src/lib/adapterSeam/erpnext/adapter.ts:139`). The explicit `after-submit-before-mirror` seam throws a plain, unclassified `Error` to model this crash window (`supabase/functions/adapter-dispatch/faultSeams.ts:76-79,116-119`). But `dispatch.ts:isRetryableTransport` recognizes only `AdapterError('external-unreachable')` (`:189`), and `claimAndCommit` marks every other adapter exception `failed` (`:387-390`). The handler then records a `failed` mirror without a `ts_number` (`readModelWriters.ts:939-957`).

That state is exactly the state Slice A admits: the reopen predicate ignores `failed` outbox rows and sees no live mirror number (`0151:119-136`). Thus the simulated post-submit failure can produce:

- ERP: a submitted Timesheet exists;
- outbox: `failed`;
- mirror: `failed`, `ts_number = NULL`;
- PMO: `Approved → Draft` succeeds;
- the corrected approval can later create a second ERP Timesheet.

The `after-commit-before-mirror` seam is safer because the outbox is first marked `committed`; the after-submit seam currently does not preserve that uncertainty. No test drives this failure through claim/finalization and then attempts the reopen.

**Required fix:** never classify an exception after a non-idempotent ERP submit as proof of “no ERP document.” Leave the row in a recoverable in-flight state, add an explicit post-submit-unknown outcome, or make the reopen fence fail closed on that state. The fault seam must exercise the same durable state as a real process failure.

### 3. BLOCK — The two originators still do not share one enforced deterministic key

The served handler adopts the gate's canonical UUID into `command.record.id` (`supabase/functions/adapter-dispatch/index.ts:722-727`), but it never replaces or validates `command.idempotencyKey`. The browser repository derives the key from the raw argument (`pmo-portal/src/lib/repositories/index.ts:584-595`), while `timesheetPushKey` simply interpolates that raw ID (`pmo-portal/src/lib/adapterSeam/erpnext/timesheetPushKey.ts:46`). The sweep derives its key from the canonical UUID (`supabase/functions/erpnext-sweep/index.ts:1537`). The served opaque-key check accepts either an arbitrary UUID or any matching-looking deterministic key (`transitionTargetGuard.ts:207-228`); it does not check that a timesheet key matches the gate's UUID and witness.

A direct authenticated caller can therefore use a random UUID or an uppercase UUID spelling. The outbox `pmo_record_id` is canonical, but the foreground row can be keyed `ts:<UPPERCASE>:t1` while the sweep searches `ts:<lowercase>:t1`. Since `failed` is excluded from `external_command_outbox_one_inflight_per_record`, the sweep can mint a second row under the canonical key. If the first attempt had an uncertain post-submit failure, this becomes a second ERP Timesheet rather than a harmless retry.

**Required fix:** after the server gate, derive the timesheet key from `approvedSheet.timesheet_id` and `approvedSheet.approved_at`, or reject any supplied key that is not exactly that value. The repository must also use `gate.timesheet_id`, not its raw input. Add a served-boundary test that asserts both the command ID and key are canonical gate truth.

### 4. BLOCK — The timesheet backstop has no owner for committed outbox rows once a mirror exists, and ages known committed orphans out

`outbox_reconcile_candidates` deliberately returns `committed` rows without an age limit (`supabase/migrations/0131_outbox_rejection_terminal.sql:42-50`). The generic recovery pass nevertheless skips **all** timesheet candidates (`supabase/functions/erpnext-sweep/index.ts:397`). The timesheet-specific queue only selects mirror rows in `pending`/`failed` (`:1455-1460`) and its absent anti-join excludes every existing mirror row (`:1400-1420`).

Two crash seams are consequently ownerless:

- ERP commit → external-ref/mirror succeeds → `confirm_outbox` fails: mirror is `pushed`, outbox remains `committed`; the generic pass skips it and the timesheet queue does not list it.
- ERP commit/ref succeeds → process dies before mirror: the absent queue can find it only inside the 14-day `ABSENT_SHEET_LOOKBACK_MS`; a known durable `committed` outbox row older than that is abandoned even though `0131` still says it must converge.

This does not immediately double-post, but it can leave a real ERP Timesheet without a PMO mirror/ref confirmation, keep the outbox in the one-in-flight set, and leave the correction path unable to identify/reconcile the document. A sweep backstop that claims to own the domain must own finalize-only `committed` rows independently of the mirror/absent lookback.

**Required fix:** route all timesheet `committed` candidates through a finalize-only recovery path (or let the generic pass handle only `committed` timesheet rows), and test both committed-with-mirror and committed-without-mirror crashes.

### 5. SHOULD-FIX — The UI permission gate is still broader than the server's row-specific re-open authority

The RPC correctly checks owner-first SoD, line manager, Admin/Executive only when the manager is null, and Admin break-glass (`0151:103-113`). The page instead uses the static `may('transition', 'approval')` result (`pmo-portal/pages/Approvals.tsx:409`) and renders the entire re-open section for that role (`:520-522`). `DELIVERY` is `Admin | Executive | Project Manager` (`pmo-portal/src/auth/policy.ts:90`). Therefore an Executive on a manager-assigned sheet and a Project Manager who is not the line manager can see a live re-open button that the RPC will reject. Conversely, the DB-proven Engineer line-manager path is excluded from the Approvals page entirely.

The RPC remains the authority, so this is not a money bypass, but it is not an honest or usable affordance. Make the read model expose row-specific re-openability/authority, or gate the button from the same manager relationship. The re-open mutation's two requested cache invalidations are present (`useTimesheetApproval.ts:158-163`); the ordinary `approve` success path still invalidates only the own/awaiting queues (`:124-125`), so a newly approved sheet or newly recorded push failure can also remain stale on an already-open Approvals page.

### 6. SHOULD-FIX — The new tests still do not bind the remaining money properties

The dblink test is useful: it proves that each of the three entry points waits for the same advisory-lock key. Its own limitation is accurate: it holds the lock and tests `lock_timeout`; it does not execute a full interleaving in which one transaction commits a status change and the other observes the post-lock witness. It also does not exercise the served sweep/adapter path.

The current green suites still lack:

- stale T1 failed-row claim after T1 reopen and T2 approval;
- stale T1 fenced insert after T2 approval;
- key mismatch between uppercase/raw foreground and canonical sweep;
- `committed` outbox with mirror already present, and committed orphan beyond the absent lookback;
- after-submit plain failure followed by Slice-A reopen;
- an integration assertion that `adapter-dispatch/index.ts` actually adopts the canonical gate ID (the Deno test only tests `approvalGuard`'s returned object).

These are not cosmetic coverage requests: removing the missing generation/key/committed-row logic would leave all current new tests green.

## Correct / verified

- The `Approved → Draft` authority is server-side, owner-first, and has no actor parameter. Admin self-reopen is rejected before Admin break-glass; current manager/role data is read from the database. `transition_timesheet` is executable by `authenticated`, not `anon` or the service role.
- The four-state enum is unchanged. `Draft`, `Submitted`, and `Rejected` arms and their stamps match `0007`; `Approved → Draft` leaves `submitted_at`, `approved_by`, and `approved_at` untouched. The pgTAP authority/stamp tests pass.
- The insert guard and claim guard use the same canonical `ts-correct:<uuid>` advisory key. A `Draft` claim raises `P0001` before claiming, and the absent sweep mint now uses the guard RPC rather than a raw table insert.
- `insert_timesheet_outbox_pending` is machine-only, and its authenticated forged-session ACL test passes. The non-timesheet claim update/return path is byte-for-byte the `0096` path apart from the timesheet-specific pre-check; the unused `p_lease`, return shape, state predicate, and ACL were checked.
- The re-openable DAL reads the non-terminal outbox states (`pending`, `committing`, `committed`, `quarantined`, `held`) and fails closed on outbox-read errors. The successful re-open invalidates both relevant queue keys.
- The eight full-correction/terminal sites in the r2 specification were checked. Sites requiring Slice-B cancel intents, cancel finalization, cancel probes, and lineage CAS remain deliberately absent rather than silently implemented in Slice A. For Slice A, the desk-cancel exclusion and create-shaped writer are unchanged and appropriate; the generic skip's old “Approved is terminal” rationale was removed. The remaining structural recovery issue is Finding 4.

## WHAT I COULD NOT VERIFY

- I did not run a live ERPNext bench or served-function Playwright journey, so I did not observe a real ERP submit/response failure or the final ERP document count. The post-submit finding is established from the shipped adapter/fault-seam/error-state ordering and needs a served fault test before it can be closed.
- I did not run a true two-session generation rollover; the local SQL reproduction was a rolled-back transaction proving the current claim RPC admits a stale failed row after a new approval. The paused-request interleaving follows directly from the async gate/preflight ordering.
- The dblink test proves lock waiting, not the full commit/interleaving observation; its precondition and claim tests are sequential.
- I did not validate production role/ACL/secret deployment configuration or the real PostgREST/ERPNext response shapes beyond the local migration and unit suites.

LUNA-REVIEW-DONE
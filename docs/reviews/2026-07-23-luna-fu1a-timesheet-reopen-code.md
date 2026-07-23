VERDICT: NO SHIP

Scope: reviewed `origin/dev..HEAD` only. I did not treat the unbuilt Slice-B live-ERP cancel as a defect.

## Findings (ranked by money impact)

### 1. BLOCK — The named lock does not cover the sweep or retry claim; `failed` is the missing state

**Failure:** An `Approved` 40-hour sheet has no mirror, and the sweep's absent queue reads it as Approved. Before the sweep drives it, an authorized manager calls `transition_timesheet`. The RPC takes the named lock, sees no mirror/outbox evidence, and commits `Draft`. The sweep then inserts a pending row directly and posts the old 40 hours. The owner corrects to 32 hours and re-approves; ERP now holds both generations, costing 72 hours.

The same race exists with an existing `failed` push (mirror queue or foreground Retry): Slice A deliberately admits `failed`, but `dispatchMoneyWrite` reads an existing row and proceeds directly to `claim_outbox_for_commit`; it does not call the new insert guard. The generic claim has no timesheet status check or named lock. A gate read that saw Approved can therefore claim/post after the re-open commits Draft.

**Evidence:** The re-open only checks `pending, committing, committed, quarantined, held` at `supabase/migrations/0151_timesheet_reopen_unpushed.sql:119-136`. The sweep has two queues at `supabase/functions/erpnext-sweep/index.ts:1437-1455`; its gate is a read at `:1458-1507`, but the absent queue inserts directly at `:1334-1347`, and both an existing row and a freshly minted row reach `dispatchMoneyWrite` at `:1521-1569`. `dispatchMoneyWrite` skips insertion when a row exists (`pmo-portal/src/lib/adapterSeam/dispatch.ts:538-556`), while `claim_outbox_for_commit` only claims `pending|failed` (`supabase/migrations/0096_erpnext_seam_tables.sql:132-153`). The plan's claim that a stale failed row “is therefore never re-driven” (`docs/plans/2026-07-23-timesheet-reopen-unpushed.md:65-73`) is false.

**Smallest fix:** Every timesheet mint/claim path must enter a DB transaction that takes `ts-correct:<canonical UUID>`, rechecks `status='Approved'`, and either inserts/claims or refuses. Route the sweep's absent mint through that guard, and add a timesheet-specific guarded claim for existing `pending|failed` rows (or fail closed on `failed` until that exists). A second gate read in TypeScript is not sufficient.

### 2. BLOCK — An ordinary authenticated caller can mint arbitrary machine outbox commands

**Failure:** `insert_timesheet_outbox_pending` is executable by `authenticated`, but it checks only that the referenced UUID currently has status `Approved`. A user can call it directly with their own org/sheet, the known deterministic key `ts:<id>:<approved_at>`, a forged `payload.entries`/`user_id`, and their own `p_actor`. The timesheet sweep finds that exact row, and because an existing row is driven rather than re-minted, the server-read subject from the gate does not replace the persisted payload. Recovery authorization checks active membership/domain/kind, not that the actor is the sheet's approver; timesheets are explicitly delegated out of the role check. This can post inflated or misattributed hours to ERP.

The same function also trusts `p_org`, `p_domain`, `p_tier`, `p_operation`, and `p_actor`; it can be used to inject non-timesheet outbox rows into other sweep paths. It never checks that `p_org` equals the timesheet's org. The explicit foreign `org_id` is not corrected by the stamp trigger (`0074_org_id_stamp_trigger.sql:73-89`).

**Evidence:** `supabase/migrations/0151_timesheet_reopen_unpushed.sql:174-202` shows the status-only check, client-controlled insert values, and `grant execute ... to authenticated`. The sweep drives an existing row without replacing its payload (`supabase/functions/erpnext-sweep/index.ts:1521-1569`); replay authorization only performs the generic actor/domain/kind check (`supabase/functions/adapter-dispatch/authGuard.ts:200-225`). There is no new ACL/argument-binding pgTAP proof; the new SQL tests invoke the function as the test runner, not as an untrusted JWT.

**Smallest fix:** Revoke `authenticated` execute; grant this machine-only RPC to `service_role` only. Additionally bind `p_record_id` to the loaded row's org and constrain domain/tier/operation, or derive the payload/actor from the server-side approved-sheet gate rather than accepting them as RPC inputs.

### 3. BLOCK — Equivalent UUID spellings use different locks and different outbox identities

**Failure:** The served dispatcher accepts an uppercase canonical UUID: `approved_timesheet_for_push(uuid)` casts it and passes. The new RPC hashes raw `p_record_id` text and stores raw `p_record_id` text. A push for `ABCDEF...` therefore takes `ts-correct:ABCDEF...` and creates an outbox row keyed by uppercase text. A normal re-open uses `p_timesheet_id::text` (lowercase), takes a different advisory lock, and queries for lowercase `pmo_record_id`; it sees no outbox row and can commit Draft while the uppercase push proceeds. The partial one-in-flight index is also text-keyed, so it does not serialize the two spellings. This is a direct path to a live old ERP document plus a later corrected document.

**Evidence:** The re-open uses canonical `p_timesheet_id::text` in `supabase/migrations/0151_timesheet_reopen_unpushed.sql:119,132-135`, while the push guard uses raw text at `:185-196`. `adapter-dispatch/index.ts:704-719` passes the caller's raw `record.id`; `0138_approved_timesheet_for_push.sql:39-51` accepts it as UUID; and `transitionTargetGuard.ts:221-228` also performs text-keyed outbox/mapping reads.

**Smallest fix:** Normalize or reject non-canonical record IDs at the served boundary, and use `p_record_id::uuid::text` consistently for the advisory key, outbox row, mapping, and command identity. Prefer a UUID parameter for the guard RPC.

### 4. SHOULD-FIX — The Approvals surface claims “re-openable” for real in-flight seams and stays stale after success

**Failure:** A no-mirror sheet with a real `pending`, `committing`, or `committed` outbox row is returned by `listReopenableApprovedTimesheets` as `mirror=null`; `Approvals.tsx:334-368` renders the active button. The server then refuses, but the operator receives no honest reason until clicking. After a successful re-open, `useTimesheetMutations` invalidates only the own/awaiting keys (`useTimesheetApproval.ts:123-157`), not `reopenableApprovedKey` or the push-attention key, so the Draft sheet and an obsolete Retry can remain visible.

**Smallest fix:** Expose the outbox state through a secure read RPC/view and classify it before rendering; invalidate the re-openable and push-attention queries on success. Also make the affordance record-aware: the broad `canApproveTimesheets` gate lets non-manager Executive/Project Manager users see buttons the RPC will reject on manager-assigned sheets.

### 5. SHOULD-FIX — The new tests do not bind the money boundary or the new RPC ACL

Deleting both `pg_advisory_xact_lock` calls still passes the new precondition and push-insert pgTAP tests: every call is sequential (`0151_timesheet_reopen_precondition.test.sql:118-222`, `0151_timesheet_push_insert_recheck.test.sql:102-125`). The Deno test only verifies that a mocked dependency calls a named RPC; it cannot see the SQL lock/status behavior. The backstop mint fake deliberately stops before the real dispatch/claim, so it cannot expose the stale-gate race. The UI's `pending`/`pushing` mirror fixtures are not states produced by any shipped writer; the actual no-mirror outbox seams are untested. No test invokes the new RPC as `authenticated` with a forged org/actor/payload.

**Smallest fix:** Add a real concurrent DB/served-boundary test for sweep absent and failed queues, a mutation that removes the guard/claim lock, and pgTAP ACL/tenant/argument-binding tests. Use fixtures produced by the shipped sweep/writers rather than an unreachable mirror state.

## What is correct / checked

- The new transition has the intended authority ordering: owner is rejected before the manager/Admin predicates (`0151:103-115`); there is no actor parameter on `transition_timesheet`, no service-role transition arm, and the FE uses the real role. I found no owner self-reopen path through another transition arm or impersonation.
- `Rejected→Draft` remains owner-only in behavior; `Submitted→Approved/Rejected` logic and stamps are unchanged; `Approved→Draft` leaves `submitted_at`, `approved_by`, and `approved_at` untouched. The four-state enum is unchanged.
- The live-mirror, committed, pending, committing, quarantined, and held cases are covered by the direct RPC predicate. The missing `failed` case is safe only as a static “rejection means no document” assumption; it is not safe against the shipped retry/sweep claim paths above.
- The generic outbox skip, mirror writer, finalizer, lineage, recovery probe, target guard, and served cancel gate are correctly left alone for Slice A's no-cancel scope. However, the generic-sweep comment at `supabase/functions/erpnext-sweep/index.ts:383-393` still says its safety depends on Approved being terminal; that premise is now false and should be rewritten around the domain backstop's atomic status/claim gate.

## WHAT I COULD NOT VERIFY

- I did not run Supabase/pgTAP, the full application suite, Playwright, ERPNext, or real concurrent/fault-injection transactions. The BLOCKs above are reproducible from the committed SQL and code ordering.
- I could not verify the live PostgREST JSON representation of the composite RPC return or production role configuration; neither changes the exposed `authenticated` grant or the static race paths.

LUNA-REVIEW-DONE

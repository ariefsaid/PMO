VERDICT: NO SHIP

## Findings (ranked by money impact)

### 1. BLOCK — An unknown Purchase Order submit can be re-POSTed because this kind has no recovery identity

**Failure:** Dispatch a `procurement/create` Purchase Order. The ERP `POST` and submit `PUT` both succeed, then the post-submit GET is unreachable. `commitCreate` now returns `external-unreachable`, leaving the outbox `committing`. After lease/quarantine recovery, the probe returns no document because Purchase Order has `anchorField: null`; `reissueOnInconclusiveAbsence` then permits a fresh commit. The adapter creates and submits `PO-2` while the already-submitted `PO-1` remains live. The PMO mapping points at `PO-2`, leaving two purchase commitments in ERP.

**Evidence:** `pmo-portal/src/lib/adapterSeam/erpnext/adapter.ts:169-180`; `pmo-portal/src/lib/adapterSeam/erpnext/doctypeRegistry.ts:97,185-190`; `supabase/functions/erpnext-sweep/index.ts:283-284`; `pmo-portal/src/lib/adapterSeam/dispatch.ts:489-501` and `:330-385`.

**Smallest fix:** Do not auto-reissue an unknown post-submit for an anchorless kind: set it to an operator-held outcome (the safe default for Purchase Order and the other anchorless submittables), or add a durable ERP recovery anchor. A no-probe miss is not proof that the first POST did not commit.

### 2. BLOCK — The new `committing` state can permanently wedge the Timesheet slot through the Timesheet backstop

**Failure:** A Timesheet create POST/submit succeeds, but the process dies or the post-submit read fails. The edge catch records `timesheet_erp_mirror.push_state = 'failed'`, while the outbox remains `committing`. If the Timesheet backstop runs while that claim is fresh (or while its quarantine window is not due), `outbox_reconcile_candidates` does not include the row. `driveTimesheetPush` finds the existing row, sees it is not in `eligibleOutboxIds`, and parks the mirror row as `held` (`:1587-1591`). `held` is excluded from the backstop query, the generic outbox pass explicitly skips Timesheets, and the outbox's `committing`/`quarantined` row remains inside the one-in-flight index. The ERP document is never adopted; re-open is refused forever by the non-terminal outbox row.

**Evidence:** `pmo-portal/src/lib/adapterSeam/erpnext/adapter.ts:171-180`; `supabase/functions/adapter-dispatch/index.ts:930-938,1123-1135`; `supabase/migrations/0131_outbox_rejection_terminal.sql:42-53`; `supabase/functions/erpnext-sweep/index.ts:1587-1596,1608-1614` and `:397`; `supabase/functions/erpnext-sweep/timesheetBackstop.ts:81-83`; `supabase/migrations/0134_outbox_serialization_and_key_single_use.sql:52-55`.

**Smallest fix:** Mirror the Budget backstop's exception: when the existing outbox row is `committing` or `quarantined` but not currently eligible, leave the mirror `failed` and return. Only park `held` for a genuinely exhausted/terminal replay. Let the stale-claim/recovery pass own the row.

### 3. SHOULD-FIX — A permanent post-submit mapping error is converted into an endless in-flight recovery loop

**Failure:** A submittable Purchase Invoice (or Timesheet/Payment Entry) is submitted, but the read-back contains an invalid money value such as `grand_total: "not-a-number"` or an out-of-range decimal. The mapper throws after ERP has committed; `postSubmitUnknown` converts that deterministic mapping error to `external-unreachable`. On recovery, the anchor probe fetches the same document and calls the same `fromDoc` mapper (`recoveryProbe.ts:67-72`) before `claimAndCommit` can mark anything. The exception escapes, so the row stays `committing`; each lease/quarantine cycle repeats and the posted document never reaches a confirmed mirror.

**Evidence:** `pmo-portal/src/lib/adapterSeam/erpnext/adapter.ts:172-180`; `pmo-portal/src/lib/adapterSeam/erpnext/bodies/purchaseInvoice.ts:27-28`; `pmo-portal/src/lib/adapterSeam/erpnext/recoveryProbe.ts:64-72`; `pmo-portal/src/lib/adapterSeam/dispatch.ts:294-302,399-401`.

**Smallest fix:** Treat post-submit mapping/read-back failures as a distinct operator-held recovery outcome, and catch probe/adoption exceptions before leaving a claimed row `committing`. Never let a permanent mapper error fall back to either a blind POST or an unbounded in-flight loop.

### 4. SHOULD-FIX — Sales Invoice submit recovery probes with the create key, not the submitted document

**Failure:** Sales Invoice create uses key `K1`, stamps `remarks = K1`, and leaves a draft. The later SoD-gated `transition/submit` uses a new `keyFor(intent)` key `K2` (`pmo-portal/src/lib/repositories/index.ts:271,508-517`); the submit path does not stamp `K2`. If submit succeeds but the post-submit GET fails, recovery probes `remarks` for `K2`, finds nothing, and retries `PUT docstatus=1` against an already-submitted invoice. The usual ERP response is a rejection, leaving the outbox failed and the PMO mirror at Draft even though revenue is posted.

**Evidence:** `pmo-portal/src/lib/repositories/index.ts:271,508-517`; `pmo-portal/src/lib/adapterSeam/erpnext/adapter.ts:152,204-214`; `pmo-portal/src/lib/adapterSeam/erpnext/doctypeRegistry.ts:115`; `supabase/functions/erpnext-sweep/index.ts:283-284`; `pmo-portal/src/lib/adapterSeam/dispatch.ts:294-302`.

**Smallest fix:** For `transition/submit`, recover by the persisted `externalRecordId` and re-fetch/verify the submitted document; do not use the transition's unsurfaced idempotency key as an ERP anchor or re-submit blindly.

### 5. SHOULD-FIX — 0151 has no upgrade treatment for pre-0151 failed unknowns

**Failure:** A row created by the pre-0151 code is `failed` with no `ts_number` because the ERP submit succeeded but the post-submit read failed. Applying 0151 leaves it failed. The new re-open predicate excludes `failed`, sees no live mirror number, and allows `Approved → Draft`; the corrected approval can then create a second ERP Timesheet before the old ERP document is reconciled.

**Evidence:** `supabase/migrations/0151_timesheet_reopen_unpushed.sql:120-136` has no failed-row protection or data migration; the old failure shape is the one described by the current post-submit path at `pmo-portal/src/lib/adapterSeam/erpnext/adapter.ts:98-104`.

**Smallest fix:** Before enabling the re-open edge, census/recover legacy failed Timesheet rows, or make failed historical Timesheet outbox rows block re-open until a probe/adoption or explicit operator resolution proves what ERP holds.

## Checks and dispositions

- **Insert/key trace:** all current production Timesheet mints use server/gate truth: the repository uses `gate.timesheet_id` and `gate.approved_at` (`pmo-portal/src/lib/repositories/index.ts:596-604`), the sweep derives the same key (`supabase/functions/erpnext-sweep/index.ts:1537-1556`), and `createDbMoneyOutboxDeps` routes `timesheets` through the guarded RPC (`supabase/functions/adapter-dispatch/moneyOutboxDeps.ts:180-204`). Recovery/reissue does not mint a new row. I found no shipped path that pairs a current witness with a stale payload; the machine-only RPC itself still accepts its payload arguments, so this conclusion depends on the service-role ACL and those callers. The migration does not normalize/census pre-round2 uppercase-text identities or other legacy rows; that live-data risk is covered by finding 5.
- **Served replacement:** `applyCanonicalTimesheetTruth` replaces `record.id`, author, witness, entries, and key (`supabase/functions/adapter-dispatch/approvalGuard.ts:131-145`), before target checks, adapter selection, outbox insertion, or ERP work. No downstream path uses the pre-replacement key; the earlier auth/gate reads only use the supplied ID to locate the same UUID.
- **Witness:** `timesheet_push_key_witness` compares numeric `timestamptz` values, so timezone/rendering variants of one stored instant agree; the explicit NULL check plus `is distinct from` fails closed (`0151:188-200,248-250,335-337`). Current writers source the database's microsecond-precision value, so I found no reachable precision collision. A trusted direct RPC key with extra fractional precision can be folded by PostgreSQL's timestamp precision; the served boundary overwrites untrusted keys before this RPC.
- **Transition arms:** since round 2, the Draft/Submitted/Rejected arms are unchanged. Relative to 0007, the only intentional differences are the `Approved → Draft` map/arm and narrowing the old Draft arm to `v_from = 'Rejected'`; the old legal arms and stamps remain byte-for-byte in behavior (`0151:80-149`).
- **Non-Timesheet claim:** the `claim_outbox_for_commit` update predicate, state transition, attempt/claim-generation increments, return, and ACL remain the 0096 behavior for every non-Timesheet row (`0151:312-350`); the added key read is only consumed by the Timesheet branch.
- **Payment Entry and Budget:** Payment Entry's mutable-anchor policy holds a no-hit recovery rather than re-POSTing; that is the deliberate C-1 operator hold. Budget's `upsertOnGrain`/grain read normally prevents two live Budgets, so it does not reproduce the Purchase Order duplicate, though it is not an idempotency-anchor adoption.
- **Carried, deliberately deferred:** Slice B's live-ERP cancel/lineage machinery remains absent; refusing a pushed Timesheet is intentional and is not re-raised as BLOCK 4.

## WHAT I COULD NOT VERIFY

- I did not run a live ERPNext failure/recovery or served Edge Function journey, so the Sales Invoice repeat-submit response and the deployed sweep cadence remain unobserved.
- I cannot inspect the production outbox to prove whether legacy failed/witnessless rows exist. This includes pre-round2 uppercase `pmo_record_id` rows: the new claim normalizes its lock identity, but the re-open predicate still compares text (`0151:132-135`). The source has no current nonconforming writer, but 0151 supplies no live-data census.
- I ran the focused Vitest (72 passed) and Deno adapter/sweep suites (42 passed), but not the full current pgTAP/Playwright/integration suite or a true concurrent fault-injection transaction.

LUNA-REVIEW-DONE

VERDICT: NO SHIP

## Findings (ranked by money impact)

### 1. BLOCK — the release can commit before the mirror exists, and the late held write recreates the dead end

**Failure:** A Timesheet POST/submit has succeeded in ERPNext; recovery's deterministic probe fails. `markOutboxHeld` commits the outbox as `held` first (`pmo-portal/src/lib/adapterSeam/dispatch.ts:307-318`). The handler records the `command-held` mirror only later, in the dispatch catch (`supabase/functions/adapter-dispatch/index.ts:930-938,1123-1135`), through an unguarded `upsert` (`supabase/functions/adapter-dispatch/readModelWriters.ts:945-955`).

An Admin release interleaving is therefore:

1. Outbox = `held`; mirror row is not present yet.
2. `release_outbox_hold` locks only the outbox (`supabase/migrations/0152_release_timesheet_mirror_hold.sql:56-60`), changes it to `failed` (`:85-90`), updates zero mirror rows because none exists (`:102-108`), audits `mirror_released=0`, and commits.
3. The delayed handler upserts the mirror as `held`.

The final state is **outbox `failed` + mirror `held`**. The backstop excludes `held` (`supabase/functions/erpnext-sweep/index.ts:1454-1460`), the new re-open fence refuses it (`0152_release_timesheet_mirror_hold.sql:230-232`), and a second release is refused because the outbox is no longer `held` (`:73-77`). The ERP Timesheet remains live but cannot be adopted/re-probed through the restored queue, and the correction path is dead-ended; payroll hours cannot be safely reconciled.

I replayed this exact ordering against the local migrated database and observed `outbox_state=failed, mirror_state=held`. The current 0152 pgTAP test seeds the mirror before release, so it does not exercise this interleaving.

**Smallest fix:** Do not leave the mirror outcome as a later un-fenced upsert. Write the Timesheet mirror hold in the same DB transaction that marks the outbox held, and/or make the outcome writer carry the outbox id/generation and CAS only while that exact outbox generation is still `held`. A released generation must be unable to write `held` afterward. Add the no-mirror → release → delayed-writer oracle.

## Attack disposition

- **Mirror CAS scope:** Correct for an already-present row. The predicate is `domain='timesheets'`, the released outbox's own `pmo_record_id` cast to UUID, and its own `org_id` (`0152:95-107`); another sheet or another domain is not touched. `timesheet_erp_mirror.timesheet_id` is globally `unique` (`0136_p3b_timesheet_erp_storage.sql:33-39`), so two mirror rows for one `timesheet_id` cannot exist. A `failed` or `pushed` mirror is not changed because the CAS requires `push_state='held'`; a pushed, non-cancelled document still blocks re-open. The defect above is the missing-row/late-writer race, not cross-sheet scope.
- **Held lifecycle / over-refusal:** There are two mirror-held producers. The deterministic `command-held` outcome has the Admin release route. The sweep can also park `timesheet-push-attempts-exhausted` (`erpnext-sweep/index.ts:1587-1603`) beside a terminal `failed` outbox, so that particular held row has no releaseable held command. It is not permanently un-clearable: the attention surface offers its retry path, which calls `repositories.timesheet.pushApproved` (`pages/Approvals.tsx:238-244`, `useTimesheetApproval.ts:193-198`); a successful or ordinary failed retry overwrites the held mirror. I therefore do not raise blanket `any held` as a separate money BLOCK. The race above produces the non-retryable `command-held` shape with no route out.
- **Non-timesheet release:** The old outbox state check, `failed` transition, generation bump, timestamp, authorization, and existing audit fields (`reason`/`released_from`) are unchanged from 0137 (`0137_budget_push_seam.sql:229-252` versus `0152:73-90,112-117`). The new write is inside `if v_domain = 'timesheets'` (`0152:95-110`), so budget/PI/PO rows do not enter it or cast `pmo_record_id`. The audit JSON is additively extended with `mirror_released: 0` for non-timesheet releases; no money state or recovery behavior changes. The full DB suite covers the existing release contract and the new non-timesheet collision case.
- **Reversibility:** 0152 adds no table or column and only replaces `release_outbox_hold` and `transition_timesheet`; restoring the 0137 and 0151 bodies in that order is structurally reversible, then 0151's own rollback can proceed. No automated down migration was executed; already-performed operator releases are, naturally, data changes rather than rollbackable migration DDL.

## Verification

- `scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db'` — PASS (230 files / 2,300 tests).
- `cd pmo-portal && npm run verify:locked` — PASS (typecheck, lint, 760 Vitest files / 6,558 tests, build).

## WHAT I COULD NOT VERIFY

- I did not run two live Edge Function requests against a real ERPNext instance; the BLOCK is established by the committed async ordering and reproduced locally at the database state boundary.
- I could not inspect production outbox/mirror rows or execute a deployed rollback.

LUNA-REVIEW-DONE

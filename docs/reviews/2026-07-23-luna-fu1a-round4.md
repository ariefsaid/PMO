VERDICT: NO SHIP

## Findings (ranked by money impact)

### 1. BLOCK — Releasing the new deterministic-probe hold does not release the Timesheet mirror

**Failure:** A Timesheet POST/submit succeeds, then recovery finds the ERP document but `fromDoc`/`mirrorMoney` fails deterministically. The new recovery branch correctly fences `external_command_outbox` to `held` (`pmo-portal/src/lib/adapterSeam/dispatch.ts:294-318`); the served retry catch then records `timesheet_erp_mirror` as `held` (`supabase/functions/adapter-dispatch/index.ts:930-941`; `supabase/functions/adapter-dispatch/readModelWriters.ts:945-955`). The documented Admin action only changes the outbox `held → failed` and increments its generation; it does not change the mirror (`supabase/migrations/0137_budget_push_seam.sql:229-244`).

After release, the Timesheet backstop still selects only mirror `pending`/`failed` (`supabase/functions/erpnext-sweep/index.ts:1446-1459`), while generic recovery skips Timesheets (`:375-397`). The UI classifies `command-held` as non-retryable and renders no Retry (`pmo-portal/src/lib/adapterSeam/pushErrorCopy.ts:133-137`; `pmo-portal/src/components/timesheets/PushStateBadge.tsx:70-80`), and there is no Timesheet caller for `release_outbox_hold`. The mirror therefore cannot re-probe/adopt after the purported release.

The normal UI can then offer `Re-open for correction`: terminal `failed` is excluded from the in-flight query (`pmo-portal/src/lib/db/timesheetTransition.ts:183-190,235-250`), the Approvals surface sees no live `ts_number` or non-terminal command and renders the button (`pmo-portal/pages/Approvals.tsx:341-365`), and the RPC admits `failed` (`supabase/migrations/0151_timesheet_reopen_unpushed.sql:128-154`). Re-opening and re-approving posts a new approval generation while the original ERP Timesheet remains live: the client's hours are double-counted.

**Smallest fix:** Make `release_outbox_hold` atomically CAS the matching `timesheet_erp_mirror` from `held` to `failed` (or provide an equivalent, audited same-key retry/reconciliation route) when releasing a Timesheet command. Do not leave the mirror held while making the outbox terminal again.

## Dispositions of the requested attacks

- **Narrowing:** Complete for the reachable create and submit-transition paths. `POST_SUBMIT_UNKNOWN_IS_IN_FLIGHT` contains only `timesheet` (`pmo-portal/src/lib/adapterSeam/erpnext/adapter.ts:93-112`); non-timesheet caught errors return by identity (`:141-148`), while both current Timesheet submit paths pass the kind through (`:195-207,230-240`). The existing non-timesheet transport/anchorless behavior remains the explicitly backlogged pre-existing gap, not a new finding. The registry test's exact derived list fails when a new anchorless, auto-submit, reissue-capable kind is added (`pmo-portal/src/lib/adapterSeam/erpnext/adapter.test.ts:209-217`); `neverReissue` is intentionally excluded because it is the safe hold policy.
- **Shared fencing:** The new hold branch passes the claimant generation, checks a zero-row result, and reconciles the current row (`dispatch.ts:307-318`). The SQL guard is `id + claim_generation + state='committing'` (`supabase/migrations/0096_erpnext_seam_tables.sql:250-260`). I found no fencing bypass or automatic re-POST in this change. The block above is the missing recovery route after the safe hold.
- **Pre-0151 residue:** No PMO-side field distinguishes the historical clean-rejection shape from a successful ERP submit followed by failed read-back: both can be `failed` with no `ts_number`. The census plus operator ERP lookup is therefore the only honest discriminator; I did not raise the absence of a data migration itself as a separate finding.

## WHAT I COULD NOT VERIFY

- I could not inspect production outbox contents, the actual 0151 application timestamp, or perform the required ERP Desk census.
- I did not run a live ERP failure/recovery journey or the full `npm run verify`/full integration suite. Targeted Vitest passed 87 tests; targeted Deno sweep/outbox tests passed 32 tests.

LUNA-REVIEW-DONE

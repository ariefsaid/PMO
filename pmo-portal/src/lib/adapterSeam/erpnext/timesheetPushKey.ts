/**
 * erpnext/timesheetPushKey.ts (P3b, FR-TSP-041, ADR-0059 §4) — the timesheet push's DETERMINISTIC
 * idempotency key.
 *
 * ⚑ WHY IT LIVES HERE, on the shared seam, and not in `repositories/index.ts` where it started.
 * The push has TWO independent originators with NO shared client state: the Approvals UI (a manager
 * approving) and the reconciling sweep backstop (`erpnext-sweep/timesheetBackstop.ts`). BOTH must import
 * this one derivation — exactly as `budgetPushKey.ts` says of its own P3c sibling. `repositories/index.ts`
 * is a CLIENT module: 38 imports deep, including `@/src/lib/supabase/client` (the browser singleton),
 * which a Deno edge function cannot load at all. The only alternative to moving it was to let the sweep
 * re-implement the key — and two independently-maintained derivations DRIFT, at which point the outbox's
 * `unique (org_id, domain, pmo_record_id, idempotency_key)` (mig 0096) no longer collides for what is
 * really one command, and the user's push and the sweep's push both reach ERPNext. That is not a
 * duplicate row: it is a SECOND ERP Timesheet, i.e. a DUPLICATED WEEK OF HOURS on the client's project
 * cost. The confinement is enforced by `timesheetPushKey.test.ts`, not left to convention.
 *
 * Shape: `ts:<timesheet_id>:<approved_at>` — accepted by the served boundary's opaque-key guard
 * (`adapter-dispatch/transitionTargetGuard.ts`, the `<prefix>:<uuid>:<stamp>` form).
 *
 * ⚑ Why `approved_at` and not the timesheet id alone. A sheet can legitimately be re-approved (rejected,
 * corrected, approved again). Keyed on the id alone that re-approval collides with the ORIGINAL push and
 * is SILENTLY SUPPRESSED — leaving ERPNext holding the superseded hours while PMO shows the corrected
 * ones, with nothing on screen to say so. The `approved_at` witness makes each approval its own command.
 *
 * ⚑ Why the RAW stamp here, where `budgetPushKey` normalizes to epoch ms. That normalization exists
 * because the budget's two originators read `activated_at` through DIFFERENT transports, which render one
 * instant differently (PostgREST `…T10:00:00+00:00` vs a server-side/SQL read `… 10:00:00+00`) — two
 * spellings of one instant would be two keys. This key's two originators do NOT diverge that way: the FE
 * reads `approved_at` off the `approved_timesheet_for_push` RPC and the sweep reads it off the
 * `timesheets` column, and BOTH go through PostgREST, which renders them identically (measured:
 * `2026-07-19T02:55:21.340995+00:00` from each). The raw stamp is therefore already transport-stable, and
 * a second normalization scheme would be a second thing to keep in step for no gain.
 * ⛔ If a THIRD originator ever reads this stamp over a non-PostgREST transport (a direct SQL/pg client,
 * a Postgres trigger), that premise breaks and this must normalize like `budgetPushKey` does.
 */

/** The `timesheets` domain's key prefix (ADR-0059 §4; `bud:` is P3c's budget sibling). */
export const TIMESHEET_PUSH_KEY_PREFIX = 'ts';

/**
 * Derive the timesheet push's idempotency key from DB truth.
 *
 * `approvedAt` is always the SERVER's witness — the FE takes it from the `approved_timesheet_for_push`
 * gate's return and the sweep from the sheet's own column; neither ever supplies a client-side clock.
 */
export function timesheetPushKey(timesheetId: string, approvedAt: string): string {
  return `${TIMESHEET_PUSH_KEY_PREFIX}:${timesheetId}:${approvedAt}`;
}

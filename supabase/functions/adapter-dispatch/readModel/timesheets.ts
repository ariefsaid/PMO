import { AppError } from '../../../../pmo-portal/src/lib/appError.ts';
import type { AdapterCommand } from '../../../../pmo-portal/src/lib/adapterSeam/contract.ts';
import type { ReadModelWriter, ReadModelWriterCtx } from './types.ts';

/** The server-resolved `approved_at` witness this push was keyed on. It is threaded onto the command
 *  by the dispatch's approval gate FROM THE DB (`approved_timesheet_for_push`), never from a client
 *  payload. A missing witness THROWS rather than writing a null: the mirrored row would otherwise be
 *  unauditable — nothing would tie it to the approval it was supposed to record (ADR-0059 §6; the
 *  Luna P3a finding where a sweep finalized with a NULL actor and silently no-op'd an SoD). */
function requireApprovedAtWitness(command: AdapterCommand): string {
  const at = (command.record as { approved_at?: unknown }).approved_at;
  if (typeof at !== 'string' || !at) {
    throw new AppError('approved_at witness missing on timesheet push command', 'DISPATCH_FAILED');
  }
  return at;
}

/**
 * P3b: the ERP-side state for a PMO-OWNED record. Writes ONLY `timesheet_erp_mirror` — NEVER
 * `timesheets`, `timesheet_entries` or `profiles` (FR-TSP-072, ADR-0059 §3.1: PMO is SoT there, and a
 * service-role write is not protected by their RLS). `onConflict:'timesheet_id'` makes a re-apply
 * idempotent on the 1:1 seam. ERP totals are mirrored VERBATIM as the read-back oracle (ADR-0048),
 * never recomputed from `timesheet_entries`.
 */
export const timesheetsWriter: ReadModelWriter = {
  async upsert(ctx, canonical, command) {
    const approvedAt = requireApprovedAtWitness(command);
    const { error } = await ctx.serviceClient.from('timesheet_erp_mirror').upsert(
      {
        org_id: ctx.orgId,
        timesheet_id: String(command.record.id),
        ts_number: (canonical.ts_number as string | null | undefined) ?? null,
        push_state: 'pushed',
        push_error: null,
        pushed_at: new Date().toISOString(),
        approved_at_pushed: approvedAt,
        erp_total_hours: (canonical.erp_total_hours as string | null | undefined) ?? null,
        erp_total_costing_amount: (canonical.erp_total_costing_amount as string | null | undefined) ?? null,
        erp_docstatus: (canonical.erp_docstatus as number | null | undefined) ?? null,
        erp_modified: (canonical.erp_modified as string | null | undefined) ?? null,
        erp_amended_from: (canonical.erp_amended_from as string | null | undefined) ?? null,
        // ⚑ M-1 (Luna audit round 3) — the sibling of `budgetWriter`'s clear, for the same reason:
        // MEDIUM-G's sticky tombstone is the backstop's exclusion, and only a fresh PMO push may lift
        // it. Without this the first Desk cancel blinded the backstop to this sheet permanently.
        erp_cancelled_at: null,
      },
      { onConflict: 'timesheet_id' },
    );
    if (error) throw new AppError(`timesheet_erp_mirror upsert failed: ${error.message}`, 'DISPATCH_FAILED');
  },
};

/**
 * FR-TSP-085 / ADR-0059 §6 — record the OUTCOME of a push that produced no ERP document.
 *
 * Because the PMO transition already succeeded, **nothing else will ever surface a failed push**: the
 * user has moved on and the sheet looks fine. So every classified rejection must land as durable,
 * operator-visible state rather than as a log line.
 *  • `outcome === null` ⇒ nothing to push (an empty / all-zero-hours approved sheet, FR-TSP-056):
 *    recorded as `pushed` with no `ts_number` — a SUCCESS, so it never re-enters the retry queue.
 *  • `command-held` ⇒ `held` (terminal until an operator acts — never re-driven).
 *  • anything else ⇒ `failed` + the classified, client-safe reason.
 *
 * ⚑ NEW-7 (Luna audit round 4) — `ts_number` is deliberately NOT NAMED, the mirror image of M-1's
 * deliberate `erp_cancelled_at: null`. An `upsert` updates only the columns it names, and this writer
 * used to name `ts_number: null` on every path. A sheet that HAD pushed successfully
 * (`ts_number='TS-2026-00042'`, a real ERPNext Timesheet) and whose LATER attempt was rejected had that
 * number erased — the ERP document still existed, still carried hours, and PMO's only pointer to it was
 * gone, so nobody could reconcile it. This function is by definition the NO-DOCUMENT outcome: it never
 * learns a document number, so it must never claim one. A fresh row still gets the column default
 * (NULL); a previously known number survives to be reconciled.
 */
/**
 * ⚑ S1 (Luna FU-1a round-8) — the ONE link in the `command-held` chain that had no test.
 *
 * `dispatch.ts` stamps a `command-held` AppError with the exact outbox row + claim generation the hold
 * was produced under; `record_timesheet_command_held` compare-and-sets the mirror on that precise
 * row+generation. Both ends were covered; the code that reads the marker off the caught error and
 * decides whether to pass it lived inline in the served handler, where no test could reach it — the
 * same "the defect lived in the JOIN between them" shape this suite has hit before. It is a pure
 * decision, so it lives here with the writer it feeds and has its own oracle.
 *
 * Returns the identity ONLY for a `command-held`: no other outcome may carry one, because for any other
 * code the recovery branch did not produce a hold and any marker riding along is stale. A `command-held`
 * with no marker yields undefined fields (not a guess) — the RPC then fences with nulls and records the
 * restrictive `held` + the unknown witness (0157 §3, S2).
 */
export function heldIdentityFor(
  failure: { code?: string; heldOutboxId?: string; heldClaimGeneration?: number },
): { outboxId?: string; claimGeneration?: number } | undefined {
  if (failure.code !== 'command-held') return undefined;
  return { outboxId: failure.heldOutboxId, claimGeneration: failure.heldClaimGeneration };
}

export async function markTimesheetPushOutcome(
  ctx: ReadModelWriterCtx,
  timesheetId: string,
  approvedAt: string,
  outcome: { code?: string; message: string } | null,
  /** ⚑ Luna FU-1a round-6 — the EXACT outbox row + fencing token this held outcome was produced under
   *  (threaded from the `command-held` AppError; extracted by `heldIdentityFor`). The RPC fences its
   *  mirror write on that precise row+generation (a generation-exact CAS), so a concurrent release or a
   *  successor approval generation cannot make a released outcome land `held`. Absent for every
   *  non-held outcome. ⚑ Round-8 S2: a MISSING id no longer records `failed` — on the mirror fence
   *  `failed` is the permissive state, so 0157 records the restrictive `held` plus the durable
   *  unknown-outcome witness and names the lost identity in the reason. */
  held?: { outboxId?: string; claimGeneration?: number },
): Promise<void> {
  // ⚑ THE RELEASE-BEFORE-MIRROR RACE (Luna FU-1a round-5 BLOCK, migration 0155). The `command-held`
  // outcome is recorded HERE — later than, and in a separate transaction from, the outbox hold
  // (`dispatch.ts` → `mark_outbox_held`). An Admin `release_outbox_hold` can interleave between the two,
  // find no mirror row to release, and commit the outbox to `failed`; a blind upsert of `held` here would
  // then RESURRECT the dead end (outbox `failed` + mirror `held`, non-retryable, non-releasable). So the
  // `command-held` write goes through `record_timesheet_command_held`, which reads the outbox and writes
  // the mirror in ONE statement: it records `held` ONLY while a `held` timesheet outbox for this record is
  // still live, and records the RELEASED outcome (`failed`) otherwise. A released generation can never
  // write `held`. Every OTHER outcome (`pushed` success / classified `failed`) is unaffected by the race
  // and keeps the direct upsert below.
  if (outcome !== null && outcome.code === 'command-held') {
    const { error } = await ctx.serviceClient.rpc('record_timesheet_command_held', {
      p_org: ctx.orgId,
      p_timesheet_id: timesheetId,
      p_approved_at: approvedAt,
      p_reason: `${outcome.code}: ${outcome.message}`,
      // The generation-exact fence identity. Null (no id/generation) makes the RPC fence fail closed —
      // it records the released outcome (`failed`), never a blind `held` (round-6 BLOCK 1/2).
      p_outbox_id: held?.outboxId ?? null,
      p_claim_generation: held?.claimGeneration ?? null,
    });
    if (error) throw new AppError(`timesheet_erp_mirror held outcome write failed: ${error.message}`, 'DISPATCH_FAILED');
    return;
  }
  const pushState = outcome === null ? 'pushed' : 'failed';
  const { error } = await ctx.serviceClient.from('timesheet_erp_mirror').upsert(
    {
      org_id: ctx.orgId,
      timesheet_id: timesheetId,
      push_state: pushState,
      push_error: outcome === null ? null : `${outcome.code ?? 'error'}: ${outcome.message}`,
      pushed_at: outcome === null ? new Date().toISOString() : null,
      approved_at_pushed: approvedAt,
    },
    { onConflict: 'timesheet_id' },
  );
  if (error) throw new AppError(`timesheet_erp_mirror outcome write failed: ${error.message}`, 'DISPATCH_FAILED');
}

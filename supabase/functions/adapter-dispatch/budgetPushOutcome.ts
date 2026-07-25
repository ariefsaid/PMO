/**
 * budgetPushOutcome.ts (M-1/M-2, Luna audit round 3) — WHAT a rejected budget push means for the
 * durable, operator-visible mirror state.
 *
 * `recordBudgetPushFailure` (index.ts) exists because a push failure that is not written down is
 * indistinguishable from a push that never happened (round-2 HIGH-2). But it ran for EVERY error code,
 * including the two 409s — and a 409 is not a push failure:
 *
 *  • `command-in-flight-for-record` (0116's one-in-flight-per-record index) means ANOTHER command for
 *    this same PMO record is still settling. It is the normal outcome of a double-clicked Retry, or of
 *    the sweep backstop driving the row while the operator retries. The in-flight command OWNS the
 *    outcome and will write it. Recording a failure here raises a false money alarm ("ERPNext is still
 *    enforcing the previous budget…") for a benign serialization, and — if it lands after the winner's
 *    `push_state='pushed'` — overwrites a genuinely-enforced budget with `failed` and re-enqueues it
 *    into the backstop. So: record NOTHING and let the winner speak.
 *
 *  • `command-held` is real, but it is not `failed`: it is terminal until an operator acts, and the
 *    sweep backstop deliberately excludes `held` rows precisely so it never re-drives something a
 *    human must resolve. Writing `failed` put it back in the automatic queue that cannot help it.
 *    ⚑ THE ROUTE OUT (audit round 5, HIGH-2): the operator's own Retry is NOT it — a retry derives the
 *    SAME deterministic key, so it re-reads the held row and throws `command-held` again; and a NEW key
 *    for the same PMO record violates `external_command_outbox_one_inflight_per_record` (`held` is
 *    inside that partial index) and 409s forever. The route out is the Admin-only, audited
 *    `release_outbox_hold` RPC (migration 0137 §4), which moves the row `held` → `failed` so the
 *    ORDINARY bounded recovery — this backstop included — owns it again. `held` banners identically.
 *
 * Kept as a pure, exported decision rather than an inline condition so it is provable in isolation:
 * the same shape as `feedErrorPolicy.ts`, and for the same reason (a money rule buried inside a
 * `Deno.serve` handler is a rule nothing can test).
 */
import { COMMAND_IN_FLIGHT_FOR_RECORD } from '../../../pmo-portal/src/lib/adapterSeam/dispatch.ts';

export type BudgetPushOutcome =
  /** Another command owns this record's outcome — write nothing, alarm nobody. */
  | { record: false }
  /** Durable state the operator must see, with the state it should be recorded as. */
  | { record: true; pushState: 'failed' | 'held' };

export function classifyBudgetPushOutcome(code: string | null | undefined): BudgetPushOutcome {
  if (code === COMMAND_IN_FLIGHT_FOR_RECORD) return { record: false };
  if (code === 'command-held') return { record: true, pushState: 'held' };
  return { record: true, pushState: 'failed' };
}

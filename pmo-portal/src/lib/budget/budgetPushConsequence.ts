/**
 * budget/budgetPushConsequence.ts (P3c slice 4, FR-BUD-008/120, ADR-0059 §3.1/§3.2).
 *
 * ⚑ THE MONEY INVARIANT: activating a budget version MUST NEVER fail because ERPNext failed. PMO is the
 * source of truth (ADR-0059 Posture B); the push is a CONSEQUENCE of activation, never its precondition.
 *
 * This is the FOREGROUND originator (the other is the sweep backstop, a later slice, not built by this
 * issue): activate — the shipped `activate_budget_version` RPC, untouched — THEN push, strictly AFTER
 * that RPC's own transaction has committed. A push failure of ANY class (ERP unreachable, rejected,
 * held, no binding configured) is swallowed into a durable `pushState` — never surfaced as an activation
 * failure, never rolled back, and never retry-looped here. The durable failure state itself is written
 * server-side (the `adapter-dispatch` budget gate + `budget_version_erp_mirror`) — this module's only job
 * is to guarantee the CALLER's promise resolves successfully regardless of what the push did.
 */
export interface ActivateAndPushDeps {
  versionId: string;
  /** The shipped `activate_budget_version` RPC — its own authority, its own transaction, UNTOUCHED. */
  rpc(fn: string, args: Record<string, unknown>): Promise<{ error: { message: string; code?: string } | null }>;
  /** Dispatch the push for `versionId`. Any rejection (ERP unreachable, a classified `commit-rejected`,
   *  or no ERPNext binding at all) is caught here and NEVER re-thrown. */
  dispatch(versionId: string): Promise<unknown>;
}

export interface ActivateAndPushResult {
  /** Whether the PMO transition itself succeeded. `false` only for a REAL activation failure (the RPC's
   *  own authorization/state-machine rejection) — never for a push failure. */
  activated: boolean;
  /** Present only when `activated` is `false` — the RPC's own error. */
  error?: { message: string; code?: string };
  /** Present only when `activated` is `true` — whether the push consequence succeeded. Durable failure
   *  detail lives server-side in `budget_version_erp_mirror`, not on this in-memory result. */
  pushState?: 'pushed' | 'failed';
}

export async function activateAndPush(deps: ActivateAndPushDeps): Promise<ActivateAndPushResult> {
  const { error } = await deps.rpc('activate_budget_version', { version_id: deps.versionId });
  if (error) return { activated: false, error }; // a REAL activation failure — the PMO transition's own

  try {
    await deps.dispatch(deps.versionId);
    return { activated: true, pushState: 'pushed' };
  } catch {
    // ⚑ ADR-0059 §3.2: never fail the user's action on ERP. The durable failure lives server-side
    // (the gate/dispatch writes budget_version_erp_mirror); the sweep backstop re-drives it later.
    return { activated: true, pushState: 'failed' };
  }
}

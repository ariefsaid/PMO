/**
 * creditRateGuard — the credit-backed RateGuard implementation (FR-AUC-011, ADR-0044 §6,
 * AMENDED by ADR-0049 / ops-admin-surface FR-CRE-002/004: the balance scope is per-ORG, not
 * per-owner). Preflight (NFR-AUC-SEC-005): computes and returns a result; never writes to
 * credits/agent_usage itself. Deputy invariant: takes the already-injected caller-JWT
 * HandlerSupabaseLike; constructs no client.
 *
 * The balance is the ORG POOL via the `org_credit_balance(p_org_id)` security-definer RPC
 * (migration 0067 — asserts `p_org_id = auth_org_id()` server-side + is_active_member() at entry),
 * so any member's deputy turn reads their OWN org pool regardless of which member fired it
 * (FR-CRE-004, AC-CRE-003). Per-owner balance is no longer defined (FR-CRE-001/002).
 *
 * RACE FIX (audit CRITICAL — reserve_credits, migration 0077): the read-only `org_credit_balance`
 * probe below is a TOCTOU preflight — it reads balance BEFORE the model call and the agent_usage.cost
 * row is written AFTER. N concurrent turns for one org all read the SAME balance, all pass, all spend
 * → the org goes negative (unbounded overspend). When the caller passes a `runId`, `check()` instead
 * does an atomic check-and-hold via `reserve_credits` (per-org advisory txn lock + counts UNRELEASED
 * reservations against available), so a concurrent second reserve blocks on the lock and is then
 * rejected for insufficient_credits. The release half of the pair — `release_credits(runId)` once the
 * real usage row has landed — is the caller's responsibility (see RESERVE_UNIT + the wiring note below).
 */
import type { HandlerSupabaseLike } from '../agent-chat/handler.ts';

export interface CreditRateGuardDeps {
  supabase: HandlerSupabaseLike;
}

/**
 * The conservative per-turn HOLD amount for the reserve path (audit CRITICAL — reserve_credits race).
 * When `check(orgId, runId)` is called with a runId, the guard atomically reserves this much against
 * the org pool (under reserve_credits' per-org advisory lock) before the model turn; release_credits
 * then drops the hold once the real agent_usage.cost row lands, so the spend is counted exactly once.
 * The hold is a temporary lock, NOT the spend itself.
 *
 * Value rationale: a documented default — there is NO existing per-turn cost constant in the functions
 * layer, and pricing isn't finalized (compose-view plan Open Question 2 — cost defaults to 0 today; the
 * provider-reported total_cost is the only signal). $0.01 (one cent USD) is a conservative floor:
 *   • large enough to represent a real turn's cost for the models in use (typical chat turns are a
 *     fraction of a cent; a cent covers the common case),
 *   • small enough not to over-lock an org's balance for the sub-second hold window,
 *   • trivially tunable (one constant) once a pricing rate lands.
 * The reserve's PRIMARY job is to SERIALIZE concurrent turns for an org + bound concurrent overspend to
 * RESERVE_UNIT per in-flight turn. It CANNOT cap a single turn whose actual cost exceeds it (turn costs
 * are reported after the call); the residual per-turn-overspend window is a known, documented tradeoff
 * that narrows as RESERVE_UNIT is tuned toward the real per-turn ceiling. This is flagged to the
 * Director as a residual risk alongside the wiring decision.
 */
export const RESERVE_UNIT = 0.01;

/**
 * Read a Postgres SQLSTATE from a Supabase-client RPC error object, defensively (the wire shape is
 * `{ code: '23514', ... }` for a `raise exception ... using errcode` — the same shape the FE's
 * classifyMutationError reads). Returns undefined for any non-string code so a malformed error falls
 * through to the fail-closed meter_error branch rather than mis-classifying.
 */
function pgErrCode(error: unknown): string | undefined {
  const code = (error as { code?: unknown })?.code;
  return typeof code === 'string' ? code : undefined;
}

export interface RateGuardResult {
  exceeded: boolean;
  retryAfterSeconds: number;
  /** 'out_of_credits' = balance <= 0 (the normal FR-CRE-004 path, the existing RATE_LIMITED UX).
   *  'meter_error' = the org_credit_balance RPC itself failed — fail-closed (exceeded:true) BUT
   *  distinguishable, so the deputy/automation surface can show an honest "meter temporarily
   *  unavailable" message instead of a false "out of credits" (M2, ADR-0049). */
  reason: 'out_of_credits' | 'meter_error';
}

/**
 * Factory matching the RateGuard interface's `check(orgId)` shape. The param was renamed
 * userId → orgId per ADR-0049 (OBS-AUC-001 — the interface is reused, not redefined). An OPTIONAL
 * `runId` selects the atomic RESERVE path (audit CRITICAL); when omitted, the read-only
 * `org_credit_balance` path is used (unchanged behavior — the existing tests + any call-site that
 * has not yet been wired to thread a run id keep working). A function accepting `(orgId, runId?)` is
 * structurally assignable to the handler `RateGuard.check(orgId: string)` interface, so wiring the
 * reserve path at the call-sites is a no-op interface change (just pass the run id) — deferred to the
 * Director (see the wiring note in the file header + this issue's summary).
 */
export function createCreditRateGuard(deps: CreditRateGuardDeps): {
  check(orgId: string, runId?: string): Promise<RateGuardResult>;
} {
  return {
    async check(orgId: string, runId?: string): Promise<RateGuardResult> {
      // RESERVE PATH (audit CRITICAL): atomic check-and-hold via reserve_credits. The read-only
      // org_credit_balance probe has a TOCTOU race (N concurrent turns read the same balance, all
      // pass, all spend → negative); reserve_credits holds a per-org advisory txn lock + counts
      // UNRELEASED reservations, so a concurrent second reserve blocks on the lock and is rejected.
      // 'insufficient_credits' (23514) maps to the EXISTING out-of-credits UX; any OTHER errcode is
      // fail-closed (exceeded:true) BUT distinguishable as reason:'meter_error' (unchanged).
      if (runId !== undefined) {
        const { error } = await deps.supabase.rpc('reserve_credits', {
          p_org_id: orgId,
          p_amount: RESERVE_UNIT,
          p_run_id: runId,
        });
        if (error) {
          if (pgErrCode(error) === '23514') {
            // The org pool can't cover even the conservative hold → the existing out-of-credits UX.
            return { exceeded: true, retryAfterSeconds: 0, reason: 'out_of_credits' };
          }
          return { exceeded: true, retryAfterSeconds: 0, reason: 'meter_error' };
        }
        // Hold created — not exceeded. reason:'out_of_credits' is the credit-BUCKET label (the same
        // value the read-only path returns when not exceeded), NOT the outcome — the existing
        // convention (see creditRateGuard.test.ts: positive balance → reason out_of_credits).
        return { exceeded: false, retryAfterSeconds: 0, reason: 'out_of_credits' };
      }

      // READ-ONLY PATH (unchanged): org_credit_balance probe. Retained for call-sites without a runId
      // (e.g. compose-view, which has no agent_run) and to keep the existing guard tests green. It does
      // NOT close the race on its own — only the reserve path above does. Call-sites that have been
      // wired to pass a runId get the race-closed behavior automatically.
      const { data, error } = await deps.supabase.rpc('org_credit_balance', { p_org_id: orgId });
      // org_credit_balance asserts p_org_id = auth_org_id() server-side. On RPC error (or a
      // non-numeric result), fail-OPEN is WRONG for a meter — fail closed (exceeded:true) BUT
      // distinguishable: return reason:'meter_error'. The normal balance<=0 path returns
      // reason:'out_of_credits' (the existing FR-CRE-004 RATE_LIMITED/out-of-credits UX is
      // UNCHANGED); 'meter_error' is a new, rarer state surfaced alongside it. Call-sites that
      // surface a user message branch on `reason`.
      if (error || typeof data !== 'number') {
        return { exceeded: true, retryAfterSeconds: 0, reason: 'meter_error' };
      }
      // FR-AUC-013: retryAfterSeconds is always 0 for the credit case — a shortfall does not
      // resolve after a fixed wait, unlike a request-per-minute throttle. The client (panel)
      // interprets retryAfterSeconds<=0 on RATE_LIMITED as "out of credits" (convention, not a
      // new wire field — spec Open Question 2).
      return { exceeded: data <= 0, retryAfterSeconds: 0, reason: 'out_of_credits' };
    },
  };
}

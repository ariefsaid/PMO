/**
 * creditRateGuard — the credit-backed RateGuard implementation (FR-AUC-011, ADR-0044 §6,
 * AMENDED by ADR-0049 / ops-admin-surface FR-CRE-002/004: the balance scope is per-ORG, not
 * per-owner). Read-only preflight (NFR-AUC-SEC-005): computes and returns a result; never writes
 * to credits/agent_usage itself. Deputy invariant: takes the already-injected caller-JWT
 * HandlerSupabaseLike; constructs no client.
 *
 * The balance is the ORG POOL via the `org_credit_balance(p_org_id)` security-definer RPC
 * (migration 0065 — asserts `p_org_id = auth_org_id()` server-side + is_active_member() at entry),
 * so any member's deputy turn reads their OWN org pool regardless of which member fired it
 * (FR-CRE-004, AC-CRE-003). Per-owner balance is no longer defined (FR-CRE-001/002).
 */
import type { HandlerSupabaseLike } from '../agent-chat/handler.ts';

export interface CreditRateGuardDeps {
  supabase: HandlerSupabaseLike;
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
 * userId → orgId per ADR-0049 (OBS-AUC-001 — the interface is reused, not redefined).
 */
export function createCreditRateGuard(deps: CreditRateGuardDeps): {
  check(orgId: string): Promise<RateGuardResult>;
} {
  return {
    async check(orgId: string): Promise<RateGuardResult> {
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

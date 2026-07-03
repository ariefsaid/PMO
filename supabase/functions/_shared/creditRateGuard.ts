/**
 * creditRateGuard — the credit-backed RateGuard implementation (FR-AUC-011, ADR-0044 §6).
 * Read-only preflight (NFR-AUC-SEC-005): computes and returns a boolean; never writes to
 * credits/agent_usage itself. Deputy invariant: takes the already-injected caller-JWT
 * HandlerSupabaseLike; constructs no client.
 */
import type { HandlerSupabaseLike } from '../agent-chat/handler';
import { clampUsageValue } from './usage';

export interface CreditRateGuardDeps {
  supabase: HandlerSupabaseLike;
}

export interface RateGuardResult {
  exceeded: boolean;
  retryAfterSeconds: number;
}

/**
 * balance = sum(credits.amount) - sum(agent_usage.cost), scoped to userId, computed fresh
 * (FR-AUC-010 — never cached/stored). A user with no credits rows has balance = 0 - spent.
 * NFR-AUC-SEC-004-EXT residual: agent_usage.cost is already clamped at write time (usage.ts);
 * this read-path clamp is defense-in-depth only, per NFR-AUC-SEC-004's "no second clamp is
 * strictly needed at read time, but confirm no bypass" instruction.
 *
 * Security review LOW-2: this preflight is advisory/eventually-consistent, not transactionally
 * atomic with the write it gates — a bounded transient overspend is possible under concurrent
 * requests (accepted v1 tradeoff, spec NFR-AUC-PERF-002). Revisit if ADR-0044 §6's background
 * runs increase concurrency enough to make the overspend window materially larger.
 */
async function computeBalance(deps: CreditRateGuardDeps, userId: string): Promise<number> {
  const [{ data: grants }, { data: usage }] = await Promise.all([
    deps.supabase.from('credits').select('amount').eq('owner_id', userId).limit(10_000),
    deps.supabase.from('agent_usage').select('cost').eq('owner_id', userId).limit(10_000),
  ]);
  const granted = (grants ?? []).reduce<number>(
    (sum, row) => sum + clampUsageValue((row as { amount?: number }).amount),
    0,
  );
  const spent = (usage ?? []).reduce<number>(
    (sum, row) => sum + clampUsageValue((row as { cost?: number }).cost),
    0,
  );
  return granted - spent;
}

/**
 * Factory (not a class) matching the RateGuard interface's `check(userId)` shape verbatim
 * (OBS-AUC-001 — the interface is reused, not redefined).
 */
export function createCreditRateGuard(deps: CreditRateGuardDeps): {
  check(userId: string): Promise<RateGuardResult>;
} {
  return {
    async check(userId: string): Promise<RateGuardResult> {
      const balance = await computeBalance(deps, userId);
      // FR-AUC-013: retryAfterSeconds is always 0 for the credit case — a shortfall does not
      // resolve after a fixed wait, unlike a request-per-minute throttle. The client (panel)
      // interprets retryAfterSeconds<=0 on RATE_LIMITED as "out of credits" (convention, not a
      // new wire field — spec Open Question 2).
      return { exceeded: balance <= 0, retryAfterSeconds: 0 };
    },
  };
}

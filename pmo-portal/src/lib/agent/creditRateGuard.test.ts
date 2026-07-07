/**
 * Tests for creditRateGuard — the credit-backed RateGuard implementation (FR-AUC-011).
 * AMENDED by ADR-0049 / ops-admin-surface FR-CRE-002/004: balance scope is per-ORG (via the
 * org_credit_balance RPC), not per-owner. These are MOCKED shape tests for the guard's JS branch
 * only — they are NOT the owner of AC-CRE-003; the owning proof is pgTAP 0118 (credits_enforced
 * org_pool), which switches JWTs between two org-X members.
 */
import { it, expect, vi } from 'vitest';
import { createCreditRateGuard, RESERVE_UNIT } from '../../../../supabase/functions/_shared/creditRateGuard';
import type { CreditRateGuardDeps } from '../../../../supabase/functions/_shared/creditRateGuard';

/** Build a mock HandlerSupabaseLike-shaped `.rpc('org_credit_balance', …)` responder. */
function mockOrgBalance(opts: { data?: unknown; error?: unknown }): CreditRateGuardDeps['supabase'] {
  return {
    rpc: vi.fn().mockResolvedValue({
      data: opts.data ?? null,
      error: opts.error ?? null,
    }),
  } as unknown as CreditRateGuardDeps['supabase'];
}

/**
 * Build a mock that dispatches `.rpc(fn, args)` BY function name, so a reserve-path test can stub
 * `reserve_credits` independently of `org_credit_balance` (the reserve path must NOT call the
 * read-only balance probe at all — it goes straight to reserve_credits).
 */
function mockRpcByFn(
  handlers: Record<string, () => { data: unknown; error: unknown }>,
): CreditRateGuardDeps['supabase'] & { rpc: ReturnType<typeof vi.fn> } {
  return {
    rpc: vi.fn(async (fn: string) => handlers[fn]?.() ?? { data: null, error: { code: 'UNHANDLED' } }),
  } as unknown as CreditRateGuardDeps['supabase'] & { rpc: ReturnType<typeof vi.fn> };
}

it('positive org balance not rate-limited; reason=out_of_credits', async () => {
  const supabase = mockOrgBalance({ data: 500 });
  const guard = createCreditRateGuard({ supabase });
  const result = await guard.check('org-1');
  expect(result).toEqual({ exceeded: false, retryAfterSeconds: 0, reason: 'out_of_credits' });
  expect(supabase.rpc).toHaveBeenCalledWith('org_credit_balance', { p_org_id: 'org-1' });
});

it('exactly-zero org balance is exceeded (boundary — <= 0, not < 0)', async () => {
  const supabase = mockOrgBalance({ data: 0 });
  const guard = createCreditRateGuard({ supabase });
  const result = await guard.check('org-2');
  expect(result).toEqual({ exceeded: true, retryAfterSeconds: 0, reason: 'out_of_credits' });
});

it('negative org balance is exceeded (spent more than granted)', async () => {
  const supabase = mockOrgBalance({ data: -5 });
  const guard = createCreditRateGuard({ supabase });
  const result = await guard.check('org-3');
  expect(result).toEqual({ exceeded: true, retryAfterSeconds: 0, reason: 'out_of_credits' });
});

it('RPC error → fail-closed BUT distinguishable (reason=meter_error, not out_of_credits)', async () => {
  const supabase = mockOrgBalance({ data: null, error: { code: '42501', message: 'denied' } });
  const guard = createCreditRateGuard({ supabase });
  const result = await guard.check('org-4');
  expect(result).toEqual({ exceeded: true, retryAfterSeconds: 0, reason: 'meter_error' });
});

it('non-numeric RPC result → meter_error (fail-closed + distinguishable)', async () => {
  const supabase = mockOrgBalance({ data: 'not-a-number' });
  const guard = createCreditRateGuard({ supabase });
  const result = await guard.check('org-5');
  expect(result).toEqual({ exceeded: true, retryAfterSeconds: 0, reason: 'meter_error' });
});

// ── RESERVE PATH (audit CRITICAL — reserve_credits race, migration 0077) ─────────────────────────
// The guard's read-only path has a TOCTOU race (N concurrent turns read the same balance, all pass,
// all spend → negative). When the caller passes a runId, check() instead does an atomic check-and-hold
// via reserve_credits. These are MOCKED shape tests for the guard's JS branch; the owning proof that
// the RACE is closed deterministically is pgTAP 0134_reserve_credits.test.sql (the advisory lock makes
// serialized holds == the concurrent worst case).

it('reserve path: success (hold created) → not exceeded; calls reserve_credits with RESERVE_UNIT', async () => {
  const supabase = mockRpcByFn({
    reserve_credits: () => ({ data: 'resv-1', error: null }),
  });
  const guard = createCreditRateGuard({ supabase });
  const result = await guard.check('org-1', 'run-1');
  expect(result).toEqual({ exceeded: false, retryAfterSeconds: 0, reason: 'out_of_credits' });
  expect(supabase.rpc).toHaveBeenCalledWith('reserve_credits', {
    p_org_id: 'org-1',
    p_amount: RESERVE_UNIT,
    p_run_id: 'run-1',
  });
  // The reserve path must NOT also call the read-only balance probe (double RPC would be wasteful +
  // would re-open the race the reserve just closed).
  expect(supabase.rpc).toHaveBeenCalledTimes(1);
});

it('reserve path: insufficient_credits (23514) → out_of_credits UX (NOT meter_error)', async () => {
  const supabase = mockRpcByFn({
    reserve_credits: () => ({ data: null, error: { code: '23514', message: 'insufficient_credits' } }),
  });
  const guard = createCreditRateGuard({ supabase });
  const result = await guard.check('org-1', 'run-1');
  expect(result).toEqual({ exceeded: true, retryAfterSeconds: 0, reason: 'out_of_credits' });
});

it('reserve path: any OTHER RPC errcode → meter_error (fail-closed + distinguishable)', async () => {
  const supabase = mockRpcByFn({
    reserve_credits: () => ({ data: null, error: { code: '42501', message: 'org_mismatch' } }),
  });
  const guard = createCreditRateGuard({ supabase });
  const result = await guard.check('org-1', 'run-1');
  expect(result).toEqual({ exceeded: true, retryAfterSeconds: 0, reason: 'meter_error' });
});

it('reserve path: a malformed error (no string code) → meter_error (never mis-classified as out_of_credits)', async () => {
  const supabase = mockRpcByFn({
    reserve_credits: () => ({ data: null, error: { message: 'something broke' } }), // no .code
  });
  const guard = createCreditRateGuard({ supabase });
  const result = await guard.check('org-1', 'run-1');
  expect(result).toEqual({ exceeded: true, retryAfterSeconds: 0, reason: 'meter_error' });
});

it('reserve path: empty-string runId is still treated as a reserve (runId !== undefined, not truthy)', async () => {
  // runLoop's continuation passes req.runId ?? '' — an empty string is a real (if degenerate) run id
  // and MUST take the reserve path, not silently fall back to the racing read-only probe.
  const supabase = mockRpcByFn({
    reserve_credits: () => ({ data: 'resv-2', error: null }),
  });
  const guard = createCreditRateGuard({ supabase });
  const result = await guard.check('org-1', '');
  expect(result).toEqual({ exceeded: false, retryAfterSeconds: 0, reason: 'out_of_credits' });
  expect(supabase.rpc).toHaveBeenCalledWith('reserve_credits', {
    p_org_id: 'org-1',
    p_amount: RESERVE_UNIT,
    p_run_id: '',
  });
});

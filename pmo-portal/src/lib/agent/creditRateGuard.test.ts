/**
 * Tests for creditRateGuard — the credit-backed RateGuard implementation (FR-AUC-011).
 * AMENDED by ADR-0049 / ops-admin-surface FR-CRE-002/004: balance scope is per-ORG (via the
 * org_credit_balance RPC), not per-owner. These are MOCKED shape tests for the guard's JS branch
 * only — they are NOT the owner of AC-CRE-003; the owning proof is pgTAP 0118 (credits_enforced
 * org_pool), which switches JWTs between two org-X members.
 */
import { it, expect, vi } from 'vitest';
import { createCreditRateGuard } from '../../../../supabase/functions/_shared/creditRateGuard';
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

/**
 * Tests for creditRateGuard — the credit-backed RateGuard implementation.
 * AC-AUC-015: positive balance not rate-limited.
 * Also proves the balance shape's canonical arithmetic on the TypeScript call site
 * (mirrors pgTAP 0096's proof of the SQL expression: coalesce(sum(),0) - coalesce(sum(),0)).
 */
import { it, expect, vi } from 'vitest';
import { createCreditRateGuard } from '../../../../supabase/functions/_shared/creditRateGuard';
import type { CreditRateGuardDeps } from '../../../../supabase/functions/_shared/creditRateGuard';

/** Build a mock HandlerSupabaseLike-shaped `.from('credits')`/`.from('agent_usage')` chain. */
function mockCreditsAndUsage(opts: {
  grants: Array<{ amount: number }>;
  usage: Array<{ cost: number }>;
}): CreditRateGuardDeps['supabase'] {
  return {
    from: vi.fn().mockImplementation((table: string) => ({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue(
            table === 'credits'
              ? { data: opts.grants, error: null }
              : { data: opts.usage, error: null },
          ),
        }),
      }),
    })),
  } as unknown as CreditRateGuardDeps['supabase'];
}

it('AC-AUC-015 positive balance not rate-limited', async () => {
  const supabase = mockCreditsAndUsage({ grants: [{ amount: 100 }], usage: [{ cost: 10 }, { cost: 15 }] });
  const guard = createCreditRateGuard({ supabase });
  const result = await guard.check('user-1');
  expect(result).toEqual({ exceeded: false, retryAfterSeconds: 0 });
});

it('zero-grants + positive-usage balance resolves exceeded (the AC-AUC-016 decision-logic half)', async () => {
  const supabase = mockCreditsAndUsage({ grants: [], usage: [{ cost: 5 }] });
  const guard = createCreditRateGuard({ supabase });
  const result = await guard.check('user-2');
  expect(result).toEqual({ exceeded: true, retryAfterSeconds: 0 });
});

it('exactly-zero balance is exceeded (boundary — <= 0, not < 0)', async () => {
  const supabase = mockCreditsAndUsage({ grants: [{ amount: 10 }], usage: [{ cost: 10 }] });
  const guard = createCreditRateGuard({ supabase });
  const result = await guard.check('user-3');
  expect(result).toEqual({ exceeded: true, retryAfterSeconds: 0 });
});

it('non-finite/negative row values are clamped in the balance computation (defense-in-depth)', async () => {
  const supabase = mockCreditsAndUsage({
    grants: [{ amount: NaN }, { amount: 50 }],
    usage: [{ cost: -3 }],
  });
  const guard = createCreditRateGuard({ supabase });
  // granted = 0 + 50 = 50; spent = 0 (negative clamped) → balance 50, not exceeded.
  const result = await guard.check('user-4');
  expect(result).toEqual({ exceeded: false, retryAfterSeconds: 0 });
});

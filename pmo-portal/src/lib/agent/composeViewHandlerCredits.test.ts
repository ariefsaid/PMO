/**
 * Tests for compose-view's credit-backed RateGuard wiring + usage recording.
 * AC-AUC-017: the same enforcement + shared balance applies to compose-view, not a
 * second independent budget.
 */
import { it, expect, vi } from 'vitest';
import { composeViewHandler } from '../../../../supabase/functions/compose-view/handler';
import type { HandlerDeps } from '../../../../supabase/functions/compose-view/handler';
import { createCreditRateGuard } from '../../../../supabase/functions/_shared/creditRateGuard';

/**
 * compose-view's SupabaseLike needs both the profiles-lookup shape (`.eq().single()`) AND
 * the creditRateGuard shape (`.eq().limit()`) — Task B9 widens the interface to support
 * both on the same `.eq(...)` return.
 */
function mockProfilesCreditsAndUsage(opts: {
  orgId: string;
  grants: Array<{ amount: number }>;
  usage: Array<{ cost: number }>;
}): HandlerDeps['supabase'] {
  return {
    from: vi.fn().mockImplementation((table: string) => ({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({ data: { org_id: opts.orgId }, error: null }),
          limit: vi.fn().mockResolvedValue(
            table === 'credits' ? { data: opts.grants, error: null } : { data: opts.usage, error: null },
          ),
        }),
      }),
    })),
  } as unknown as HandlerDeps['supabase'];
}

it('AC-AUC-017 compose-view shares the same balance and guard', async () => {
  const modelClientCreate = vi.fn();
  const supabase = mockProfilesCreditsAndUsage({ orgId: 'org-1', grants: [], usage: [{ cost: 1 }] }); // balance = -1
  const result = await composeViewHandler(
    { prompt: 'show me active projects', orgId: 'org-1' },
    {
      modelClient: { create: modelClientCreate },
      model: 'deepseek/deepseek-v4-flash',
      supabase,
      userId: 'user-1',
      rateGuard: createCreditRateGuard({ supabase: supabase as never }),
    },
  );
  expect(result).toMatchObject({ status: 429, body: { error: 'RATE_LIMITED', retryAfterSeconds: 0 } });
  expect(modelClientCreate).not.toHaveBeenCalled();
});

it('positive balance allows compose-view to proceed past the preflight to the model call', async () => {
  const supabase = mockProfilesCreditsAndUsage({ orgId: 'org-1', grants: [{ amount: 100 }], usage: [] });
  // A model-call failure here proves the preflight passed and composeSpec() was reached
  // (a 429 would short-circuit before ever calling create()) — the actual compose+repair
  // loop is composeSpec.test.ts's concern, not this credit-wiring test's.
  const modelClientCreate = vi.fn().mockRejectedValue(new Error('upstream down'));
  const result = await composeViewHandler(
    { prompt: 'show me active projects', orgId: 'org-1' },
    {
      modelClient: { create: modelClientCreate },
      model: 'deepseek/deepseek-v4-flash',
      supabase,
      userId: 'user-1',
      rateGuard: createCreditRateGuard({ supabase: supabase as never }),
    },
  );
  expect(modelClientCreate).toHaveBeenCalled();
  expect(result).toMatchObject({ status: 502 });
});

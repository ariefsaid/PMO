/**
 * Tests for compose-view's credit-backed RateGuard wiring + usage recording.
 * AC-AUC-017: the same enforcement + shared balance applies to compose-view, not a
 * second independent budget. AMENDED by ADR-0049 / ops-admin-surface (FR-CRE-002/004): the
 * balance is now the ORG pool, read via the `org_credit_balance` RPC — not a per-owner
 * `.from('credits')/.from('agent_usage')` sum.
 */
import { it, expect, vi } from 'vitest';
import { composeViewHandler } from '../../../../supabase/functions/compose-view/handler';
import type { HandlerDeps } from '../../../../supabase/functions/compose-view/handler';
import { createCreditRateGuard } from '../../../../supabase/functions/_shared/creditRateGuard';

/**
 * compose-view's SupabaseLike needs both the profiles-lookup shape (`.eq().single()`) AND
 * the creditRateGuard's `.rpc('org_credit_balance', …)` shape.
 */
function mockProfilesAndOrgBalance(opts: { orgId: string; balance: number }): HandlerDeps['supabase'] {
  return {
    from: vi.fn().mockImplementation(() => ({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({ data: { org_id: opts.orgId }, error: null }),
        }),
      }),
    })),
    rpc: vi.fn().mockResolvedValue({ data: opts.balance, error: null }),
  } as unknown as HandlerDeps['supabase'];
}

it('AC-AUC-017 compose-view shares the same balance and guard', async () => {
  const modelClientCreate = vi.fn();
  const supabase = mockProfilesAndOrgBalance({ orgId: 'org-1', balance: -1 });
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
  const supabase = mockProfilesAndOrgBalance({ orgId: 'org-1', balance: 100 });
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

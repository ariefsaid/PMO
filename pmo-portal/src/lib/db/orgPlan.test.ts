/**
 * Plans S4 (FR-PLN-016) — the org-plan DAL: the RPC is S3's `resolved_org_plan()`, which may not exist in
 * this deployment yet. One probe per page load, then quiet: the group property is analytics, and a
 * deployment without the projection must not fire a failing request per session (or per stale window).
 *
 * The hook suite mocks this module, so this file owns the module itself: the call name, the shape guard,
 * the absence latch, and the fact that a transient failure does NOT latch.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const rpc = vi.hoisted(() => vi.fn());
vi.mock('@/src/lib/supabase/client', () => ({ supabase: { rpc } }));

const PLAN = { plan_id: 'growth', plan_name: 'Growth', seat_limit: 25, project_limit: 100, ai_monthly_messages: 1500 };

/** A fresh module instance per test (the absence latch is module state, like a page load). */
async function freshOrgPlan() {
  vi.resetModules();
  return await import('./orgPlan');
}

beforeEach(() => {
  rpc.mockReset();
});

describe('getOwnOrgPlan', () => {
  it('reads the caller-scoped projection and coerces one row', async () => {
    rpc.mockResolvedValue({ data: [PLAN], error: null });
    const { getOwnOrgPlan, RESOLVED_ORG_PLAN_RPC } = await freshOrgPlan();
    expect(await getOwnOrgPlan()).toEqual(PLAN);
    expect(rpc).toHaveBeenCalledWith(RESOLVED_ORG_PLAN_RPC);
  });

  it('probes an absent function ONCE, then skips quietly', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: 'PGRST202', message: 'Could not find the function public.resolved_org_plan in the schema cache' } });
    const { getOwnOrgPlan } = await freshOrgPlan();
    expect(await getOwnOrgPlan()).toBeNull();
    expect(await getOwnOrgPlan()).toBeNull();
    expect(await getOwnOrgPlan()).toBeNull();
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it('does not latch a transient failure — the next session window may succeed', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { code: '57014', message: 'canceling statement due to statement timeout' } });
    rpc.mockResolvedValueOnce({ data: [PLAN], error: null });
    const { getOwnOrgPlan } = await freshOrgPlan();
    expect(await getOwnOrgPlan()).toBeNull();
    expect(await getOwnOrgPlan()).toEqual(PLAN);
    expect(rpc).toHaveBeenCalledTimes(2);
  });

  it('returns null for a row that is not the promised shape, and never throws', async () => {
    rpc.mockResolvedValue({ data: [{ plan_id: 42 }], error: null });
    const { getOwnOrgPlan } = await freshOrgPlan();
    expect(await getOwnOrgPlan()).toBeNull();

    rpc.mockRejectedValue(new Error('network'));
    expect(await getOwnOrgPlan()).toBeNull();
  });

  it('classifies only the "no such function" shapes as absent', async () => {
    const { isMissingRpcError } = await freshOrgPlan();
    expect(isMissingRpcError({ code: 'PGRST202' })).toBe(true);
    expect(isMissingRpcError({ code: '42883' })).toBe(true);
    expect(isMissingRpcError({ message: 'ERROR: function public.resolved_org_plan() does not exist' })).toBe(true);
    expect(isMissingRpcError({ code: '57014', message: 'statement timeout' })).toBe(false);
    expect(isMissingRpcError({ code: '42501', message: 'permission denied' })).toBe(false);
    expect(isMissingRpcError(null)).toBe(false);
  });
});

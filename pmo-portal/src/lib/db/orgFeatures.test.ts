import { describe, it, expect, vi, beforeEach } from 'vitest';

const rpc = vi.fn();
vi.mock('@/src/lib/supabase/client', () => ({ supabase: { rpc: (...a: unknown[]) => rpc(...a) } }));

import {
  projectPlanCatalogue,
  projectResolvedFeatures,
  getOwnPlan,
  listOwnResolvedFeatures,
  listOperatorOrgOverrides,
  listOperatorResolvedFeatures,
} from './orgFeatures';

beforeEach(() => rpc.mockReset());

/**
 * The projection is the ONLY place a resolved row becomes a UI value (FR-PLN-005): the display map
 * that nav/routes read, and the per-key detail the Operator console reads. These tests pin the three
 * rules that a silent bug would hide: display vs entitlement stay separate, unknown keys never leak,
 * and an unrecognised source degrades to `unknown` instead of being trusted.
 */
describe('projectResolvedFeatures', () => {
  it('separates display from entitlement (FR-PLN-005a: ERP-owned revenue)', () => {
    const result = projectResolvedFeatures([
      { feature_key: 'revenue', enabled: true, display_enabled: false, source: 'plan' },
      { feature_key: 'crm', enabled: true, display_enabled: true, source: 'override' },
    ]);
    expect(result.display.revenue).toBe(false);
    expect(result.states.revenue).toEqual({ enabled: true, displayEnabled: false, source: 'plan' });
    expect(result.display.crm).toBe(true);
    expect(result.states.crm?.source).toBe('override');
  });

  it('drops a key the FE does not know (a DB registry ahead of the UI must not leak)', () => {
    const result = projectResolvedFeatures([
      { feature_key: 'unknown_module', enabled: true, display_enabled: true, source: 'plan' },
      { feature_key: 'projects', enabled: true, display_enabled: true, source: 'core' },
    ]);
    expect(Object.keys(result.display)).toEqual(['projects']);
    expect(result.display.projects).toBe(true);
  });

  it('degrades an unrecognised source to unknown rather than trusting it', () => {
    const result = projectResolvedFeatures([
      { feature_key: 'crm', enabled: true, display_enabled: true, source: 'something_new' },
    ]);
    expect(result.states.crm?.source).toBe('unknown');
  });
});

describe('projectPlanCatalogue', () => {
  it('collapses the flat (plan, feature) rows into plans + matrix + all-orgs flags', () => {
    const result = projectPlanCatalogue([
      {
        plan_id: 'starter',
        plan_name: 'Starter',
        seat_limit: 10,
        project_limit: 25,
        ai_monthly_messages: 300,
        feature_key: 'crm',
        feature_enabled: true,
        global_enabled: true,
      },
      {
        plan_id: 'starter',
        plan_name: 'Starter',
        seat_limit: 10,
        project_limit: 25,
        ai_monthly_messages: 300,
        feature_key: 'stock',
        feature_enabled: false,
        global_enabled: true,
      },
      {
        plan_id: 'starter',
        plan_name: 'Starter',
        seat_limit: 10,
        project_limit: 25,
        ai_monthly_messages: 300,
        feature_key: 'feedback_surveys',
        feature_enabled: true,
        global_enabled: null,
      },
    ]);
    expect(result.plans).toEqual([
      { planId: 'starter', name: 'Starter', seatLimit: 10, projectLimit: 25, aiMonthlyMessages: 300 },
    ]);
    expect(result.defaults.starter).toEqual({ crm: true, stock: false, feedback_surveys: true });
    // The Admin-owned key has no global row — null, never a fabricated `true`.
    expect(result.global.feedback_surveys).toBeNull();
    expect(result.global.crm).toBe(true);
  });

  it('keeps a null limit as null (per contract / unlimited)', () => {
    const result = projectPlanCatalogue([
      {
        plan_id: 'enterprise',
        plan_name: 'Enterprise',
        seat_limit: null,
        project_limit: null,
        ai_monthly_messages: null,
        feature_key: 'crm',
        feature_enabled: true,
        global_enabled: true,
      },
    ]);
    expect(result.plans[0]?.seatLimit).toBeNull();
    expect(result.plans[0]?.projectLimit).toBeNull();
  });
});

describe('the resolved read goes through the database projection, not the table', () => {
  it('own org reads resolved_org_features()', async () => {
    rpc.mockResolvedValue({ data: [], error: null });
    await listOwnResolvedFeatures();
    expect(rpc).toHaveBeenCalledWith('resolved_org_features');
  });

  it('the operator read passes the org id', async () => {
    rpc.mockResolvedValue({ data: [], error: null });
    await listOperatorResolvedFeatures('org-1');
    expect(rpc).toHaveBeenCalledWith('operator_resolved_org_features', { p_org_id: 'org-1' });
  });

  it('the override-presence read passes the org id and drops keys the FE cannot label', async () => {
    rpc.mockResolvedValue({
      data: [{ feature_key: 'stock' }, { feature_key: 'not_a_switch' }],
      error: null,
    });
    await expect(listOperatorOrgOverrides('org-1')).resolves.toEqual(['stock']);
    expect(rpc).toHaveBeenCalledWith('operator_org_overrides', { p_org_id: 'org-1' });
  });

  it('resolved_org_plan maps the single row and returns null when empty', async () => {
    rpc.mockResolvedValue({
      data: [
        {
          plan_id: 'growth',
          plan_name: 'Growth',
          seat_limit: 25,
          project_limit: 100,
          ai_monthly_messages: 1500,
        },
      ],
      error: null,
    });
    await expect(getOwnPlan()).resolves.toEqual({
      planId: 'growth',
      name: 'Growth',
      seatLimit: 25,
      projectLimit: 100,
      aiMonthlyMessages: 1500,
    });
    rpc.mockResolvedValue({ data: [], error: null });
    await expect(getOwnPlan()).resolves.toBeNull();
  });
});

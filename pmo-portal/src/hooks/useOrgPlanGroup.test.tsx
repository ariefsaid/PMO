// Plans S4 (FR-PLN-016) — the hook that turns the org plan into a PostHog group property.
//
// The DAL seam is mocked here on purpose: the plan's real source is S3's member-scoped
// `resolved_org_plan()` projection (migration 0537), so this suite owns the WIRING — plan resolved →
// the analytics facade's org-group helper → `analyticsClient.group('organisation', orgId, { plan })`;
// plan unresolved → nothing; a plan change → exactly one re-registration.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

const analytics = vi.hoisted(() => ({ group: vi.fn() }));
vi.mock('@/src/lib/analytics/client', () => ({ analyticsClient: analytics }));

const currentPlan = vi.hoisted(() => vi.fn());
const getOrgPlan = vi.hoisted(() => vi.fn());
vi.mock('@/src/lib/repositories/admin', () => ({
  orgFeatureRepository: { currentPlan, getOrgPlan },
}));

const authState = vi.hoisted(() => ({ currentUser: null as { id: string; org_id: string } | null }));
vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: authState.currentUser, role: 'Admin' }),
}));

import { useOrgPlanGroup, ORG_GROUP_TYPE } from './useOrgPlanGroup';
import { useOrgPlan } from './usePlans';
import { invalidateFeatureState } from './useOrgFeatures';
import { SERVER_SESSION_STALE_TIME } from '@/src/lib/queryPolicies';

function Probe() {
  useOrgPlanGroup();
  return null;
}

function renderProbe() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(
    <QueryClientProvider client={client}>
      <Probe />
    </QueryClientProvider>,
  );
  return { client, ...view };
}

beforeEach(() => {
  analytics.group.mockReset();
  currentPlan.mockReset();
  getOrgPlan.mockReset();
  authState.currentUser = { id: 'u1', org_id: 'org-1' };
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('useOrgPlanGroup — FR-PLN-016', () => {
  it('ages the session plan instead of caching it forever', async () => {
    currentPlan.mockResolvedValue({ plan_id: 'starter', plan_name: 'Starter', seat_limit: 10, project_limit: 25, ai_monthly_messages: 300 });
    const { client } = renderProbe();
    await waitFor(() => expect(analytics.group).toHaveBeenCalledWith(ORG_GROUP_TYPE, 'org-1', { plan: 'starter' }));
    const query = client.getQueryCache().find({ queryKey: ['orgPlanGroup', 'org-1'] });
    const options = query?.options as
      | { staleTime?: number; gcTime?: number; refetchOnWindowFocus?: boolean }
      | undefined;
    expect(options?.staleTime).toBe(SERVER_SESSION_STALE_TIME);
    expect(options?.gcTime).toBe(Infinity);
    expect(options?.refetchOnWindowFocus).toBe(true);
  });

  it('registers the plan as the organisation group property', async () => {
    currentPlan.mockResolvedValue({ plan_id: 'growth', plan_name: 'Growth', seat_limit: 25, project_limit: 100, ai_monthly_messages: 1500 });
    renderProbe();
    await waitFor(() => expect(analytics.group).toHaveBeenCalledTimes(1));
    expect(analytics.group).toHaveBeenCalledWith(ORG_GROUP_TYPE, 'org-1', { plan: 'growth' });
  });

  it('registers nothing when the plan cannot be resolved (0537 not deployed / no session)', async () => {
    currentPlan.mockResolvedValue(null);
    renderProbe();
    await waitFor(() => expect(currentPlan).toHaveBeenCalled());
    expect(analytics.group).not.toHaveBeenCalled();
  });

  it('does not read the plan without a signed-in org', () => {
    authState.currentUser = null;
    renderProbe();
    expect(currentPlan).not.toHaveBeenCalled();
    expect(analytics.group).not.toHaveBeenCalled();
  });

  it('re-registers exactly once when the plan changes, and never on a plain re-render', async () => {
    currentPlan.mockResolvedValue({ plan_id: 'starter', plan_name: 'Starter', seat_limit: 10, project_limit: 25, ai_monthly_messages: 300 });
    const { client, rerender } = renderProbe();
    await waitFor(() => expect(analytics.group).toHaveBeenCalledWith(ORG_GROUP_TYPE, 'org-1', { plan: 'starter' }));
    expect(analytics.group).toHaveBeenCalledTimes(1);

    // A plan assignment invalidates the group key through `invalidateFeatureState` (the Operator
    // console owns that invalidation); simulate it on the SAME client so the hook sees a new plan
    // without being remounted.
    currentPlan.mockResolvedValue({ plan_id: 'pro', plan_name: 'Pro', seat_limit: 50, project_limit: null, ai_monthly_messages: 5000 });
    await invalidateFeatureState(client);
    await waitFor(() => expect(analytics.group).toHaveBeenCalledWith(ORG_GROUP_TYPE, 'org-1', { plan: 'pro' }));
    expect(analytics.group).toHaveBeenCalledTimes(2);

    // A re-render with the same org and plan must not re-send it.
    rerender(
      <QueryClientProvider client={client}>
        <Probe />
      </QueryClientProvider>,
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(analytics.group).toHaveBeenCalledTimes(2);
  });

  // Review finding 1: the analytics group reader returns an `OrgPlan` object while the Operator
  // console's reader returns the assigned plan id STRING. They once shared `['orgPlan', orgId]`, so
  // whichever mounted first installed a value the other could not read. Both mount orders must work.
  it.each(['group-first', 'operator-first'] as const)(
    'keeps the OrgPlan object and the operator plan id on separate keys (%s)',
    async (order) => {
      const groupPlan = { plan_id: 'growth', plan_name: 'Growth', seat_limit: 25, project_limit: 100, ai_monthly_messages: 1500 };
      currentPlan.mockResolvedValue(groupPlan);
      getOrgPlan.mockResolvedValue('starter');

      const reads: unknown[] = [];
      function OperatorPlanProbe() {
        const { data } = useOrgPlan('org-1');
        React.useEffect(() => {
          if (data !== undefined) reads.push(data);
        }, [data]);
        return null;
      }
      const probes =
        order === 'group-first'
          ? [<Probe key="group" />, <OperatorPlanProbe key="operator" />]
          : [<OperatorPlanProbe key="operator" />, <Probe key="group" />];

      const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      render(<QueryClientProvider client={client}>{probes}</QueryClientProvider>);

      await waitFor(() => expect(analytics.group).toHaveBeenCalledWith(ORG_GROUP_TYPE, 'org-1', { plan: 'growth' }));
      await waitFor(() => expect(reads).toContain('starter'));
      // The operator reader must see the string the console can match to the catalogue, never the
      // analytics reader's object (which `plans.find(...)` cannot match).
      expect(reads.every((value) => typeof value === 'string')).toBe(true);
    },
  );
});

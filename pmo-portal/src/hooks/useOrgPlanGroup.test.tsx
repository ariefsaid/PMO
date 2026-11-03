// Plans S4 (FR-PLN-016) — the hook that turns the org plan into a PostHog group property.
//
// The DAL seam is mocked here on purpose: the plan's real source is S3's member-scoped
// `resolved_org_plan()` projection (migration 0537), so this suite owns the WIRING — plan resolved →
// `analyticsClient.group('organisation', orgId, { plan })`; plan unresolved → nothing; a plan change →
// exactly one re-registration.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

const analytics = vi.hoisted(() => ({ group: vi.fn() }));
vi.mock('@/src/lib/analytics/client', () => ({ analyticsClient: analytics }));

const currentPlan = vi.hoisted(() => vi.fn());
vi.mock('@/src/lib/repositories', () => ({
  repositories: { orgFeature: { currentPlan } },
}));

const authState = vi.hoisted(() => ({ currentUser: null as { id: string; org_id: string } | null }));
vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: authState.currentUser, role: 'Admin' }),
}));

import { useOrgPlanGroup, ORG_GROUP_TYPE } from './useOrgPlanGroup';

function Probe() {
  useOrgPlanGroup();
  return null;
}

function renderProbe() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <Probe />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  analytics.group.mockReset();
  currentPlan.mockReset();
  authState.currentUser = { id: 'u1', org_id: 'org-1' };
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('useOrgPlanGroup — FR-PLN-016', () => {
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

  it('re-registers exactly once when the plan changes', async () => {
    currentPlan.mockResolvedValue({ plan_id: 'starter', plan_name: 'Starter', seat_limit: 10, project_limit: 25, ai_monthly_messages: 300 });
    const view = renderProbe();
    await waitFor(() => expect(analytics.group).toHaveBeenCalledWith(ORG_GROUP_TYPE, 'org-1', { plan: 'starter' }));
    currentPlan.mockResolvedValue({ plan_id: 'pro', plan_name: 'Pro', seat_limit: 50, project_limit: null, ai_monthly_messages: 5000 });
    // A plan assignment invalidates the query (the Operator console owns that invalidation); simulate it.
    view.unmount();
    renderProbe();
    await waitFor(() => expect(analytics.group).toHaveBeenCalledWith(ORG_GROUP_TYPE, 'org-1', { plan: 'pro' }));
  });
});

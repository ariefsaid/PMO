import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { renderToString } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const { calls, record } = vi.hoisted(() => {
  const calls: string[] = [];
  return { calls, record: (name: string) => () => { calls.push(name); return Promise.resolve([]); } };
});
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { org_id: 'org-1', id: 'u1', role: 'Finance' } }) }));
vi.mock('@/src/lib/repositories', () => ({
  repositories: {
    billingStages: { waitingSteps: record('billing steps'), waitingWorkOrderSteps: record('work-order steps') },
    closeoutChecklist: { waitingItems: record('close-out items') },
  },
}));
vi.mock('@/src/lib/repositories/workOrderMaterialAlerts', () => ({ workOrderMaterialAlertsRepository: { waiting: record('material alerts') } }));
vi.mock('@/src/lib/repositories/manpowerNeeds', () => ({ manpowerNeedRepository: { toFill: record('manpower') } }));

import { useWaitingSteps, useWaitingWorkOrderSteps } from './useBillingSteps';
import { useWaitingCloseoutItems } from './useCloseoutChecklist';
import { useWaitingMaterialAlerts } from './useWorkOrderMaterialAlerts';
import { useManpowerToFill } from './useManpowerNeeds';

// The home's needs-you reads used to leave only after the whole dashboard committed, and then behind a lazy repository load:
// on a slow machine the work-order billing step appeared ~7 s after opening home (JOB-T3, 28 Nov 2026). They start in the
// render that first asks for them; the row rules in the database still decide what comes back.
function Home({ on }: { on: boolean }) {
  useWaitingSteps(on);
  useWaitingWorkOrderSteps(on);
  useWaitingCloseoutItems(on);
  useWaitingMaterialAlerts(on);
  useManpowerToFill(on);
  return null;
}

const renderOnce = (on: boolean) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  // A server render runs no effects: whatever is asked for here was asked for during render.
  renderToString(<QueryClientProvider client={qc}><Home on={on} /></QueryClientProvider>);
};

describe('needs-you waiting reads', () => {
  it('start during the first render, before the screen commits', async () => {
    calls.length = 0;
    renderOnce(true);
    await new Promise((r) => setTimeout(r, 0));
    expect([...calls].sort()).toEqual(['billing steps', 'close-out items', 'manpower', 'material alerts', 'work-order steps']);
  });

  it('ask nothing while their gate is closed', async () => {
    calls.length = 0;
    renderOnce(false);
    await new Promise((r) => setTimeout(r, 0));
    expect(calls).toEqual([]);
  });
});

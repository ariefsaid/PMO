import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthContext, type AuthContextValue } from '@/src/auth/AuthContext';
import { awaitingApprovalKey } from '@/src/hooks/approvalsQueryKeys';
import { acceptancesAwaitingConfirmationKey } from '@/src/hooks/useWorkOrderAcceptances';
import { waitingDecisionsKey, decisionStandingKey } from '@/src/hooks/useWaitingDecisions';
import { orgSwitchKey } from '@/src/hooks/useOrgSwitch';
import { MemoryRouter } from 'react-router';

const { approvalsData, userId, roleState } = vi.hoisted(() => ({
  approvalsData: {
    procurements: [
      { id: 'p1', status: 'Requested', requested_by_id: 'someone-else', approvalRoute: { route: 'flat' } },
      { id: 'p2', status: 'Requested', requested_by_id: 'current-user', approvalRoute: { route: 'flat' } },
    ],
    timesheets: [{ id: 't1' }, { id: 't2' }],
    expenses: [
      { claim: { id: 'e1', status: 'Submitted', claimant_id: 'someone-else' }, route: { route: 'flat' } },
      { claim: { id: 'e2', status: 'Submitted', claimant_id: 'current-user' }, route: { route: 'flat' } },
    ],
    invoices: [{ id: 'i1' }],
    expenseError: false,
  },
  userId: 'current-user',
  roleState: { activeRole: 'Admin' },
}));

vi.mock('@/src/auth/impersonation', () => ({
  useEffectiveRole: () => ({ effectiveRole: roleState.activeRole, realRole: roleState.activeRole }),
}));
vi.mock('@/src/auth/useIsOperator', () => ({ useIsOperator: () => false }));
vi.mock('@/src/hooks/useMedicalRelease', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/src/hooks/useMedicalRelease')>()), useMedicalReleases: () => ({ data: [], isPending: false, isError: false, refetch: () => undefined }) }));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { id: userId, org_id: 'synthetic-org' }, role: roleState.activeRole }) }));
vi.mock('@/src/hooks/useUserViews', () => ({ useUserViews: () => ({ data: [] }) }));
vi.mock('@/src/hooks/useOrgFeatures', () => ({
  useOrgFeatures: () => ({ data: { crm: true, procurement: true, timesheets: true, revenue: true, sales_pipeline: true } }),
}));
vi.mock('@/src/lib/features', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/src/lib/features')>()),
  isFeatureEnabled: () => false,
  FEATURE_ENV_DEFAULT: { crm: true, procurement: true, timesheets: true, revenue: true, sales_pipeline: true },
}));
// test/setup.ts holds the two database reads behind the shared waiting list idle, but its partial mock
// omits the real cache-key factories — and every case here seeds the canonical cache with them. Keep the
// real exports and re-hold only the two reads idle, so the badge still aggregates every live queue source.
vi.mock('@/src/hooks/useWaitingDecisions', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/src/hooks/useWaitingDecisions')>()),
  useDatabaseWaiting: () => ({ data: [], isPending: false, isError: false, refetch: () => undefined }),
  useDecisionStanding: () => ({ data: false, isPending: false, isError: false }),
}));

import { Rail } from '../Rail';

/** Explicit per-case seeding for the two timesheet queues Rail reads (OD-TS-5: an assigned
 *  manager may hold ANY role, so both queue caches are seeded for every role under test; Rail's
 *  eligibility hooks themselves mount only for Engineer. */
interface QueueSeeds {
  /** Rows in the awaiting-approval (pending) queue; defaults to the two-row shared fixture. */
  pending?: unknown[];
  /** Rows in the re-openable-approved (correction) queue; defaults to empty. */
  corrections?: unknown[];
}

function renderRail(onNavigate = vi.fn(), role = 'Admin', queues: QueueSeeds = {}) {
  roleState.activeRole = role;
  const pendingRows = queues.pending ?? approvalsData.timesheets;
  const correctionRows = queues.corrections ?? [];
  // fix-waiting: the badge reads the shared live list, so every source it reads is seeded and kept fresh for these short cases.
  const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false, refetchOnMount: false, refetchOnWindowFocus: false } } });
  // Rail's Engineer-only eligibility wrapper mounts both real queue hooks. Other roles still get
  // seeded cache entries.
  // staleTime: Infinity keeps seeded data fresh at mount; each hook's explicit 60s
  // refetchInterval overrides the false interval default below, so polling remains enabled. These
  // short cases finish before it fires and do not test a later refetch.
  queryClient.setQueryDefaults(['timesheets-awaiting'], { staleTime: Infinity, refetchInterval: false });
  queryClient.setQueryDefaults(['timesheets-reopenable-approved'], { staleTime: Infinity, refetchInterval: false });
  queryClient.setQueryDefaults(['timesheet-approval-work'], { staleTime: Infinity, refetchInterval: false });
  queryClient.setQueryData(['external-domain-ownership', 'synthetic-org'], []);
  queryClient.setQueryData(['material-requests', 'synthetic-org', 'waiting'], []);
  queryClient.setQueryData(['imprest-awaiting', 'synthetic-org'], { plans: [], replenishments: [] });
  queryClient.setQueryData(['procurements', 'synthetic-org', 'requested'], approvalsData.procurements);
  queryClient.setQueryData(['expense-claims-awaiting', 'synthetic-org'], approvalsData.expenses);
  queryClient.setQueryData(awaitingApprovalKey('synthetic-org', userId, roleState.activeRole as AuthContextValue['role']), pendingRows);
  queryClient.setQueryData(['timesheets-reopenable-approved', 'synthetic-org', userId, roleState.activeRole], correctionRows);
  queryClient.setQueryData(['timesheet-approval-work', 'synthetic-org', userId, roleState.activeRole], pendingRows.length > 0 || correctionRows.length > 0);
  queryClient.setQueryData(['salesInvoices', 'synthetic-org', 'native-drafts'], [
    { ...approvalsData.invoices[0], author_user_id: 'someone-else', author_user_ids: ['someone-else'] },
  ]);
  queryClient.setQueryData(['leave-settings', 'synthetic-org'], { enabled: false, approver_role: null });
  queryClient.setQueryData(orgSwitchKey('synthetic-org', 'modulePeopleCrews'), true);
  queryClient.setQueryData(orgSwitchKey('synthetic-org', 'safetyRecords'), false);
  queryClient.setQueryData(acceptancesAwaitingConfirmationKey('synthetic-org', userId), []);
  queryClient.setQueryData(waitingDecisionsKey('synthetic-org', userId), []);
  queryClient.setQueryData(decisionStandingKey('synthetic-org', userId), false);
  render(
    <QueryClientProvider client={queryClient}>
      <AuthContext.Provider value={{
        currentUser: { id: userId, org_id: 'synthetic-org' },
        role: roleState.activeRole,
      } as AuthContextValue}>
        <MemoryRouter initialEntries={['/projects']}>
          <Rail onNavigate={onNavigate} />
        </MemoryRouter>
      </AuthContext.Provider>
    </QueryClientProvider>,
  );
  return { onNavigate, queryClient };
}

describe('Rail — persistent approvals access (UX-001)', () => {
  it('keeps counted Approvals outside the scrollable destination list and retains Sales', () => {
    renderRail();

    const rail = screen.getByRole('complementary');
    const nav = within(rail).getByRole('navigation', { name: 'Primary navigation' });
    const approvals = within(nav).getByRole('link', { name: /Approvals,.*5 pending/i });
    const scrollableDestinations = nav.querySelector('[data-rail-scroll-region]');

    expect(approvals).toHaveAttribute('href', '/approvals');
    expect(scrollableDestinations).not.toContainElement(approvals);
    expect(scrollableDestinations).toContainElement(within(nav).getByRole('link', { name: 'Sales Pipeline' }));
    expect(screen.getByRole('link', { name: /Approvals,.*5 pending/i })).toBeInTheDocument();
  });

  it('calls navigation for the counted Approvals link and retains its href', () => {
    const { onNavigate } = renderRail();
    const approvalLink = screen.getByRole('link', { name: /Approvals,.*5 pending/i });

    fireEvent.click(approvalLink);

    expect(onNavigate).toHaveBeenCalledOnce();
    expect(approvalLink).toHaveAttribute('href', '/approvals');
  });

  it('does not render an empty pinned strip for Engineer', () => {
    renderRail(vi.fn(), 'Engineer', { pending: [], corrections: [] });

    const rail = screen.getByRole('complementary');
    expect(rail.querySelector('[data-rail-pinned-approvals]')).not.toBeInTheDocument();
    expect(within(rail).queryByRole('link', { name: /Approvals/i })).not.toBeInTheDocument();
  });

  it('shows the pinned Approvals strip and pending count for an Engineer with an assigned queue', () => {
    renderRail(vi.fn(), 'Engineer', { pending: approvalsData.timesheets, corrections: [] });

    const rail = screen.getByRole('complementary');
    const approvals = within(rail).getByRole('link', { name: /Approvals,.*2 pending/i });
    expect(rail.querySelector('[data-rail-pinned-approvals]')).toContainElement(approvals);
    expect(approvals).toHaveAttribute('href', '/approvals');
  });

  it('does not present an unknown count as zero when a queue source is unavailable', async () => {
    const { queryClient } = renderRail();
    await queryClient.invalidateQueries({ queryKey: ['expense-claims-awaiting', 'synthetic-org'] });
    // H5 (r2-g1c ruling): the count must show on every page, so while a queue is stale the rail
    // keeps the last COMPLETE count for this signed-in user and role — it never falls back to a
    // partial total or to 0, which would read as "nothing to approve".
    const approvals = await screen.findByRole('link', { name: /Approvals,.*5 pending/i });
    expect(within(approvals).getByText('5')).toBeInTheDocument();
    expect(within(approvals).queryByText('0')).not.toBeInTheDocument();
  });
});

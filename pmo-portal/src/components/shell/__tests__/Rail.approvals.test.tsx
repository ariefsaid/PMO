import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthContext, type AuthContextValue } from '@/src/auth/AuthContext';
import { MemoryRouter } from 'react-router';

const { approvalsData, userId, activeRole } = vi.hoisted(() => ({
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
  activeRole: 'Admin',
}));

vi.mock('@/src/auth/impersonation', () => ({
  useEffectiveRole: () => ({ effectiveRole: activeRole, realRole: activeRole }),
}));
vi.mock('@/src/auth/useIsOperator', () => ({ useIsOperator: () => false }));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { id: userId, org_id: 'synthetic-org' }, role: activeRole }) }));
vi.mock('@/src/hooks/useUserViews', () => ({ useUserViews: () => ({ data: [] }) }));
vi.mock('@/src/hooks/useOrgFeatures', () => ({
  useOrgFeatures: () => ({ data: { crm: true, procurement: true, timesheets: true, revenue: true } }),
}));
vi.mock('@/src/lib/features', () => ({
  isFeatureEnabled: () => false,
  FEATURE_ENV_DEFAULT: { crm: true, procurement: true, timesheets: true, revenue: true },
}));

import { Rail } from '../Rail';

function renderRail(onNavigate = vi.fn()) {
  const queryClient = new QueryClient();
  queryClient.setQueryData(['external-domain-ownership', 'synthetic-org'], []);
  queryClient.setQueryData(['procurements', 'synthetic-org'], approvalsData.procurements);
  queryClient.setQueryData(['expense-claims-awaiting', 'synthetic-org'], approvalsData.expenses);
  queryClient.setQueryData(['timesheets-awaiting', 'synthetic-org', userId, activeRole], approvalsData.timesheets);
  queryClient.setQueryData(['salesInvoices', 'synthetic-org', 'native-drafts'], [
    { ...approvalsData.invoices[0], author_user_id: 'someone-else', author_user_ids: ['someone-else'] },
  ]);
  render(
    <QueryClientProvider client={queryClient}>
      <AuthContext.Provider value={{
        currentUser: { id: userId, org_id: 'synthetic-org' },
        role: activeRole,
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
    expect(approvals.parentElement).not.toBe(scrollableDestinations);
    expect(scrollableDestinations).toContainElement(within(nav).getByRole('link', { name: 'Sales Pipeline' }));
    expect(screen.getByRole('link', { name: /Approvals,.*5 pending/i })).toBeInTheDocument();
  });

  it('keeps the same counted destination available from the phone drawer and closes on navigation', () => {
    const { onNavigate } = renderRail();
    const approvalLink = screen.getByRole('link', { name: /Approvals,.*5 pending/i });

    fireEvent.click(approvalLink);

    expect(onNavigate).toHaveBeenCalledOnce();
    expect(approvalLink).toHaveAttribute('href', '/approvals');
  });

  it('does not present an unknown count as zero when a queue source is unavailable', async () => {
    const { queryClient } = renderRail();
    await queryClient.invalidateQueries({ queryKey: ['expense-claims-awaiting', 'synthetic-org'] });
    expect(await screen.findByRole('link', { name: /^Approvals$/i })).toBeInTheDocument();
    expect(screen.queryByText('5')).not.toBeInTheDocument();
  });
});

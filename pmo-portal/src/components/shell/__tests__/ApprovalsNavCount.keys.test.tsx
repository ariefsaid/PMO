import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthContext, type AuthContextValue } from '@/src/auth/AuthContext';

const keys = vi.hoisted(() => ({
  procurements: vi.fn(() => ['owner-factory', 'procurements'] as const),
  expenses: vi.fn(() => ['owner-factory', 'expenses'] as const),
  timesheets: vi.fn(() => ['owner-factory', 'timesheets'] as const),
  invoices: vi.fn(() => ['owner-factory', 'invoices'] as const),
  ownership: vi.fn(() => ['owner-factory', 'ownership'] as const),
  hooks: {
    procurement: vi.fn(),
    expense: vi.fn(),
    timesheets: vi.fn(),
    invoices: vi.fn(),
  },
}));

vi.mock('@/src/hooks/approvalsQueryKeys', () => ({
  procurementsKey: keys.procurements,
  expenseClaimsAwaitingKey: keys.expenses,
  awaitingApprovalKey: keys.timesheets,
  nativeDraftInvoicesKey: keys.invoices,
  externalDomainOwnershipKey: keys.ownership,
}));

import { ApprovalsNavCount } from '../ApprovalsNavCount';

const orgId = 'org-1';
const userId = 'user-1';
const queueKeys = [keys.procurements(), keys.expenses(), keys.timesheets(), keys.invoices()] as const;
const ownershipKey = keys.ownership();

function authValue(role: AuthContextValue['role'] = 'Admin') {
  return {
    currentUser: { id: userId, org_id: orgId } as AuthContextValue['currentUser'],
    role,
  } as AuthContextValue;
}

function makeClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function seedReady(client: QueryClient, ownership: { domain: string; externalTier: string | null }[] = []) {
  client.setQueryData(ownershipKey, ownership);
  client.setQueryData(queueKeys[0], [
    { id: 'p1', status: 'Requested', requested_by_id: 'other', approvalRoute: { route: 'flat' } },
  ]);
  client.setQueryData(queueKeys[1], [
    { claim: { id: 'e1', status: 'Submitted', claimant_id: 'other' }, route: { route: 'flat' } },
  ]);
  client.setQueryData(queueKeys[2], [{ id: 't1' }]);
  client.setQueryData(queueKeys[3], [
    { id: 'i1', author_user_id: 'other', author_user_ids: ['other'] },
    { id: 'i2', author_user_id: userId, author_user_ids: ['other', userId] },
  ]);
}

function renderCount(client: QueryClient, role: AuthContextValue['role'] = 'Admin') {
  return render(
    <QueryClientProvider client={client}>
      <AuthContext.Provider value={authValue(role)}>
        <ApprovalsNavCount />
      </AuthContext.Provider>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('ApprovalsNavCount owner cache keys', () => {
  it('AC-FAA-008 reads the owner factories, keeps real-role and authorship filters, and performs no queue fetches', () => {
    const client = makeClient();
    seedReady(client);

    renderCount(client);

    expect(screen.getByText('4')).toBeInTheDocument();
    expect(keys.procurements).toHaveBeenCalledWith(orgId);
    expect(keys.expenses).toHaveBeenCalledWith(orgId);
    expect(keys.timesheets).toHaveBeenCalledWith(orgId, userId, 'Admin');
    expect(keys.invoices).toHaveBeenCalledWith(orgId);
    expect(keys.ownership).toHaveBeenCalledWith(orgId);
    expect(client.getQueryCache().findAll().every((query) => query.getObserversCount() === 0)).toBe(true);
  });

  it('AC-FAA-008 omits the count when an applicable owner cache is missing', () => {
    const client = makeClient();
    seedReady(client);
    client.removeQueries({ queryKey: queueKeys[1], exact: true });

    renderCount(client);

    expect(screen.queryByText('4')).not.toBeInTheDocument();
    expect(client.getQueryCache().findAll().every((query) => query.getObserversCount() === 0)).toBe(true);
  });

  it('AC-FAA-008 omits the count when an owner cache has been invalidated or errored', async () => {
    const invalidated = makeClient();
    seedReady(invalidated);
    await invalidated.invalidateQueries({ queryKey: queueKeys[1], exact: true });
    const invalidatedRender = renderCount(invalidated);
    expect(screen.queryByText('4')).not.toBeInTheDocument();
    invalidatedRender.unmount();

    const errored = makeClient();
    seedReady(errored);
    errored.getQueryCache().find({ queryKey: queueKeys[1], exact: true })?.setState({
      status: 'error', error: new Error('unavailable'),
    });
    renderCount(errored);
    expect(screen.queryByText('4')).not.toBeInTheDocument();
  });

  it('AC-FAA-008 omits invoice counts when the revenue domain is externally owned', () => {
    const client = makeClient();
    seedReady(client, [{ domain: 'revenue', externalTier: 'ERPNext' }]);

    renderCount(client);

    expect(screen.getByText('3')).toBeInTheDocument();
    expect(keys.invoices).not.toHaveBeenCalled();
  });

  it('AC-FAA-008 scopes the awaiting cache and invoice affordance to the authenticated role', () => {
    const client = makeClient();
    seedReady(client);

    renderCount(client, 'Project Manager');

    expect(screen.getByText('3')).toBeInTheDocument();
    expect(keys.timesheets).toHaveBeenCalledWith(orgId, userId, 'Project Manager');
    expect(keys.invoices).not.toHaveBeenCalled();
  });
});

import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
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

  it('OD-TS-5 counts cached pending timesheet for assigned Engineer manager', () => {
    const client = makeClient();
    // Engineer has no procurement or invoice approval authority; only timesheets queue is applicable
    client.setQueryData(queueKeys[2], [{ id: 't1' }]);

    renderCount(client, 'Engineer');

    expect(screen.getByText('1')).toBeInTheDocument();
    expect(keys.timesheets).toHaveBeenCalledWith(orgId, userId, 'Engineer');
    expect(keys.procurements).not.toHaveBeenCalled();
    expect(keys.expenses).not.toHaveBeenCalled();
    expect(keys.invoices).not.toHaveBeenCalled();
    expect(client.getQueryCache().findAll().every((query) => query.getObserversCount() === 0)).toBe(true);
  });

  it('OD-TS-5 counts cached pending timesheet for assigned Finance manager with role-appropriate queues seeded', () => {
    const client = makeClient();
    // Finance can approve procurement and invoices; seed those applicable queues as empty / ready
    client.setQueryData(ownershipKey, []);
    client.setQueryData(queueKeys[0], []);
    client.setQueryData(queueKeys[1], []);
    client.setQueryData(queueKeys[2], [{ id: 't1' }]);
    client.setQueryData(queueKeys[3], []);

    renderCount(client, 'Finance');

    expect(screen.getByText('1')).toBeInTheDocument();
    expect(keys.timesheets).toHaveBeenCalledWith(orgId, userId, 'Finance');
    expect(client.getQueryCache().findAll().every((query) => query.getObserversCount() === 0)).toBe(true);
  });

  it('OD-TS-5 omits the count when the pending timesheets cache is missing, errored, or invalidated', async () => {
    // Missing pending cache for Engineer
    const missingClient = makeClient();
    renderCount(missingClient, 'Engineer');
    expect(screen.queryByText('1')).not.toBeInTheDocument();
    expect(screen.queryByText('0')).not.toBeInTheDocument();
    cleanup();

    // Errored pending cache for Engineer
    const erroredClient = makeClient();
    erroredClient.setQueryData(queueKeys[2], [{ id: 't1' }]);
    erroredClient.getQueryCache().find({ queryKey: queueKeys[2], exact: true })?.setState({
      status: 'error',
      error: new Error('timesheets unavailable'),
    });
    renderCount(erroredClient, 'Engineer');
    expect(screen.queryByText('1')).not.toBeInTheDocument();
    expect(screen.queryByText('0')).not.toBeInTheDocument();
    cleanup();

    // Invalidated pending cache for Engineer
    const invalidatedClient = makeClient();
    invalidatedClient.setQueryData(queueKeys[2], [{ id: 't1' }]);
    await invalidatedClient.invalidateQueries({ queryKey: queueKeys[2], exact: true });
    renderCount(invalidatedClient, 'Engineer');
    expect(screen.queryByText('1')).not.toBeInTheDocument();
    expect(screen.queryByText('0')).not.toBeInTheDocument();
    cleanup();

    // For Admin: missing pending cache omits count rather than presenting a partial total
    const partialClient = makeClient();
    seedReady(partialClient);
    partialClient.removeQueries({ queryKey: queueKeys[2], exact: true });
    renderCount(partialClient, 'Admin');
    expect(screen.queryByText('4')).not.toBeInTheDocument();
    expect(screen.queryByText('3')).not.toBeInTheDocument();
    expect(screen.queryByText('0')).not.toBeInTheDocument();
  });

  it('OD-TS-5 updates count on successful cache update, retaining all existing role and other queue totals', async () => {
    const client = makeClient();
    seedReady(client); // Admin: 1 proc + 1 exp + 1 ts + 1 inv = 4

    renderCount(client, 'Admin');
    expect(screen.getByText('4')).toBeInTheDocument();

    act(() => {
      client.setQueryData(queueKeys[2], [{ id: 't1' }, { id: 't2' }]);
    });

    expect(await screen.findByText('5')).toBeInTheDocument();
    expect(screen.queryByText('4')).not.toBeInTheDocument();
    expect(client.getQueryCache().findAll().every((query) => query.getObserversCount() === 0)).toBe(true);
  });
});

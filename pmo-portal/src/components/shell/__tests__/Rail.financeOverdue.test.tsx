import React from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { AuthContext, type AuthContextValue } from '@/src/auth/AuthContext';

const dal = vi.hoisted(() => ({
  listInvoices: vi.fn(async () => [] as unknown[]),
  listPayments: vi.fn(async () => [] as unknown[]),
  listProcurements: vi.fn(async () => [] as unknown[]),
  roleState: { role: 'Finance' },
}));

vi.mock('@/src/auth/impersonation', () => ({
  useEffectiveRole: () => ({ effectiveRole: dal.roleState.role, realRole: dal.roleState.role }),
}));

vi.mock('@/src/auth/useIsOperator', () => ({ useIsOperator: () => false }));
vi.mock('@/src/hooks/useUserViews', () => ({ useUserViews: () => ({ data: [] }) }));
vi.mock('@/src/hooks/useOrgFeatures', () => ({
  useOrgFeatures: () => ({ data: { crm: true, procurement: true, timesheets: true, revenue: true, sales_pipeline: true } }),
}));
vi.mock('@/src/lib/features', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/src/lib/features')>()),
  isFeatureEnabled: () => false,
  FEATURE_ENV_DEFAULT: { crm: true, procurement: true, timesheets: true, revenue: true, sales_pipeline: true },
}));

vi.mock('@/src/lib/repositories', () => ({
  repositories: {
    revenue: {
      listInvoices: dal.listInvoices,
      listPayments: dal.listPayments,
    },
    procurement: {
      list: dal.listProcurements,
    },
    fxRates: {
      context: vi.fn(async () => ({ timezone: 'Asia/Jakarta', base_currency: 'IDR' })),
    },
  },
}));

vi.mock('@/src/components/shell/ApprovalsNavCount', () => ({ ApprovalsNavCount: () => null }));

import { Rail } from '../Rail';

function renderRailOnRoute(initialRoute = '/projects/p1', queryClient?: QueryClient) {
  const qc = queryClient ?? new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const auth: AuthContextValue = {
    currentUser: { id: 'u-1', org_id: 'org-test' },
    role: 'Finance',
    signOut: vi.fn(),
  } as unknown as AuthContextValue;

  return render(
    <QueryClientProvider client={qc}>
      <AuthContext.Provider value={auth}>
        <MemoryRouter initialEntries={[initialRoute]}>
          <Rail />
        </MemoryRouter>
      </AuthContext.Provider>
    </QueryClientProvider>,
  );
}

describe('Rail — on-demand finance overdue count (removing global reads from project detail)', () => {
  beforeEach(() => {
    dal.roleState.role = 'Finance';
    dal.listInvoices.mockReset().mockResolvedValue([]);
    dal.listPayments.mockReset().mockResolvedValue([]);
    dal.listProcurements.mockReset().mockResolvedValue([]);
  });

  it('on initial project route, does NOT fire global finance reads and displays no fake zero', async () => {
    renderRailOnRoute('/projects/p1');

    await act(async () => {
      await new Promise((r) => setTimeout(r, 60));
    });

    expect(dal.listInvoices).not.toHaveBeenCalled();
    expect(dal.listPayments).not.toHaveBeenCalled();
    expect(dal.listProcurements).not.toHaveBeenCalled();

    const financeLink = screen.getByRole('link', { name: /^Finance$/i });
    expect(financeLink).toBeInTheDocument();
    expect(screen.queryByText('0')).not.toBeInTheDocument();
  });

  it('triggering on-demand load via mouseEnter on Finance link loads accurate data', async () => {
    dal.listInvoices.mockResolvedValue([
      { id: 'inv-1', status: 'Unpaid', amount: 500, received_date: '2026-09-01', erp_payment_terms_days: 30 },
    ]);

    renderRailOnRoute('/projects/p1');

    expect(dal.listInvoices).not.toHaveBeenCalled();

    const financeLink = screen.getByRole('link', { name: /^Finance$/i });
    fireEvent.mouseEnter(financeLink);

    expect(dal.listInvoices).toHaveBeenCalled();
  });

  it('triggering on-demand load via focus on Finance link loads accurate data', async () => {
    dal.listInvoices.mockResolvedValue([]);

    renderRailOnRoute('/projects/p1');

    expect(dal.listInvoices).not.toHaveBeenCalled();

    const financeLink = screen.getByRole('link', { name: /^Finance$/i });
    fireEvent.focus(financeLink);

    expect(dal.listInvoices).toHaveBeenCalled();
  });

  it('on /finance route, eagerly loads data without waiting for interaction', async () => {
    renderRailOnRoute('/finance');

    expect(dal.listInvoices).toHaveBeenCalled();
  });
});

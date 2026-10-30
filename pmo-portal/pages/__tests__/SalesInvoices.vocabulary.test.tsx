import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { BahasaProvider } from '@/test/bahasa';
import { Rail } from '@/src/components/shell/Rail';
import ReceivablesPage from '../finance/ReceivablesPage';

const state = vi.hoisted(() => ({ role: 'Finance' as string, revenue: true }));
vi.mock('@/src/auth/useIsOperator', () => ({ useIsOperator: () => false }));
vi.mock('@/src/auth/impersonation', () => ({ useEffectiveRole: () => ({ effectiveRole: state.role, realRole: state.role }) }));
vi.mock('@/src/hooks/useUserViews', () => ({ useUserViews: () => ({ data: [] }) }));
vi.mock('@/src/hooks/useOrgFeatures', () => ({ useOrgFeatures: () => ({ data: { revenue: state.revenue } }) }));
vi.mock('@/src/hooks/useErpItemOptions', () => ({ useErpItemOptions: () => ({ connected: false, loadOptions: async () => [] }) }));
vi.mock('@/src/hooks/useOrgCurrency', () => ({
  useOrgCurrency: () => 'IDR',
  useOrgCurrencyState: () => ({ currency: 'IDR', isResolved: true, isError: false }),
}));
vi.mock('@/src/hooks/useRevenueMode', () => ({ useRevenueMode: () => 'native' }));
vi.mock('@/src/hooks/useFinancePosition', () => ({
  useFinancePosition: () => ({
    position: {
      receivablesCount: 0, receivablesUnknownCount: 0,
      overdue: [],
      overdueTotals: {},
      overdueUnknownCount: 0,
      drafts: { canApprove: [], awaitingOther: [], all: [] },
      toSend: [],
      unappliedPayments: [],
      unappliedTotals: {},
      payables: [],
      payablesTotals: {},
      receivablesAgeing: {},
      payablesAgeing: {},
    },
    today: '2026-10-28',
    isPending: false,
    isError: false,
    retry: vi.fn(),
  }),
}));
vi.mock('@/src/hooks/useRevenue', () => ({
  useSalesInvoices: () => ({ data: [], isPending: false, isError: false, refetch: vi.fn() }),
  useIncomingPayments: () => ({ data: [], isPending: false, isError: false }),
  useAssignInvoiceProject: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useRevenueMutations: () => ({ create: { mutateAsync: vi.fn(), isPending: false }, submitInvoice: { mutateAsync: vi.fn(), isPending: false }, cancelInvoice: { mutateAsync: vi.fn(), isPending: false }, setReceivedDate: { mutateAsync: vi.fn(), isPending: false }, setEfaktur: { mutateAsync: vi.fn(), isPending: false }, pendingPush: { status: 'idle', lastError: null, lastPushAt: null } }),
}));
vi.mock('@/src/hooks/useFkOptions', () => ({ useClientCompanyOptions: () => ({ data: [] }), useInvoiceProjectOptions: () => ({ data: [], isPending: false, refetch: vi.fn(async () => ({ data: [], error: null })) }) }));
vi.mock('@/src/hooks/useProjects', () => ({ useProjects: () => ({ data: [], isPending: false }) }));
vi.mock('@/src/hooks/useTasks', () => ({ useAssignableProfiles: () => ({ data: [], isPending: false }) }));
vi.mock('@/src/hooks/useInvoicePdfDownload', () => ({ useInvoicePdfDownload: () => ({ download: vi.fn(), inFlightIds: new Set<string>() }) }));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { id: 'finance-1', org_id: 'org-1' }, role: state.role }) }));
vi.mock('@/src/lib/adapterSeam/ownershipCache', () => ({ routeDomainWrite: vi.fn(() => 'pmo') }));
vi.mock('@/src/hooks/useExternalDomainOwnership', () => ({ useExternalDomainOwnership: () => ({ data: [], isError: false }) }));
vi.mock('@/src/components/ui', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/src/components/ui')>();
  return { ...actual, useToast: () => ({ toast: vi.fn() }) };
});

function renderPage(locale: 'en' | 'id') {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={queryClient}><BahasaProvider locale={locale}><MemoryRouter initialEntries={['/finance/receivables']}><Rail /><ReceivablesPage /></MemoryRouter></BahasaProvider></QueryClientProvider>);
}

describe('Receivables vocabulary', () => {
  it('AC-UXA-017: rail link and page heading share the localized noun and real route', () => {
    const { unmount } = renderPage('en');
    expect(screen.getByRole('link', { name: 'Receivables' })).toHaveAttribute('href', '/finance/receivables');
    expect(screen.getByRole('heading', { name: 'Receivables' })).toBeInTheDocument();
    unmount();
    renderPage('id');
    expect(screen.getByRole('link', { name: 'Piutang' })).toHaveAttribute('href', '/finance/receivables');
    expect(screen.getByRole('heading', { name: 'Piutang' })).toBeInTheDocument();
  });
});

import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { BahasaProvider } from '@/test/bahasa';
import { Rail } from '@/src/components/shell/Rail';
import SalesInvoices from '../SalesInvoices';

const state = vi.hoisted(() => ({ role: 'Finance' as string, revenue: true }));
vi.mock('@/src/auth/useIsOperator', () => ({ useIsOperator: () => false }));
vi.mock('@/src/auth/impersonation', () => ({ useEffectiveRole: () => ({ effectiveRole: state.role, realRole: state.role }) }));
vi.mock('@/src/hooks/useUserViews', () => ({ useUserViews: () => ({ data: [] }) }));
vi.mock('@/src/hooks/useOrgFeatures', () => ({ useOrgFeatures: () => ({ data: { revenue: state.revenue } }) }));
vi.mock('@/src/hooks/useErpItemOptions', () => ({ useErpItemOptions: () => ({ connected: false, loadOptions: async () => [] }) }));
vi.mock('@/src/hooks/useOrgCurrency', () => ({ useOrgCurrency: () => 'IDR' }));
vi.mock('@/src/hooks/useRevenue', () => ({
  useSalesInvoices: () => ({ data: [], isPending: false, isError: false, refetch: vi.fn() }),
  useAssignInvoiceProject: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useRevenueMutations: () => ({ create: { mutateAsync: vi.fn(), isPending: false }, submitInvoice: { mutateAsync: vi.fn(), isPending: false }, cancelInvoice: { mutateAsync: vi.fn(), isPending: false }, setReceivedDate: { mutateAsync: vi.fn(), isPending: false }, pendingPush: { status: 'idle', lastError: null, lastPushAt: null } }),
}));
vi.mock('@/src/hooks/useFkOptions', () => ({ useClientCompanyOptions: () => ({ data: [] }), useInvoiceProjectOptions: () => ({ data: [], isPending: false, refetch: vi.fn(async () => ({ data: [], error: null })) }) }));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { id: 'finance-1', org_id: 'org-1' }, role: state.role }) }));
vi.mock('@/src/lib/adapterSeam/ownershipCache', () => ({ routeDomainWrite: vi.fn(() => 'pmo') }));
vi.mock('@/src/hooks/useExternalDomainOwnership', () => ({ useExternalDomainOwnership: () => ({ data: [], isError: false }) }));
vi.mock('@/src/components/ui', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/src/components/ui')>();
  return { ...actual, useToast: () => ({ toast: vi.fn() }) };
});

function renderPage(locale: 'en' | 'id') {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={queryClient}><BahasaProvider locale={locale}><MemoryRouter><Rail /><SalesInvoices /></MemoryRouter></BahasaProvider></QueryClientProvider>);
}

describe('Sales Invoices vocabulary', () => {
  it('AC-UXA-017: rail link and page heading share the localized noun and real route', () => {
    const { unmount } = renderPage('en');
    expect(screen.getByRole('link', { name: 'Sales Invoices' })).toHaveAttribute('href', '/sales-invoices');
    expect(screen.getByRole('heading', { name: 'Sales Invoices' })).toBeInTheDocument();
    unmount();
    renderPage('id');
    expect(screen.getByRole('link', { name: 'Faktur Penjualan' })).toHaveAttribute('href', '/sales-invoices');
    expect(screen.getByRole('heading', { name: 'Faktur Penjualan' })).toBeInTheDocument();
  });
});

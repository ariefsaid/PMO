import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { ToastProvider } from '@/src/components/ui';
import ProcurementTab from '../tabs/ProcurementTab';

// Same mock set as ProcurementBlock.floor.test.tsx (the shared list harness) — the
// project-detail composition renders the real ProcurementBlock; its reads are faked.
// The two ERP side sections are not this row's subject.
const makeRow = (over: Record<string, unknown> = {}) => ({
  id: 'p-1', code: 'PR-1', title: 'Inverters', status: 'Vendor Invoiced', total_value: 62_000, approved_total_value: null, currency: 'USD',
  project_id: 'p1', budget_category: 'Materials', requested_by_id: 'u-requester', approved_by_id: 'u-approver', vendor_id: 'v-1',
  created_at: '2026-10-27T00:00:00.000Z', updated_at: '2026-10-27T00:00:00.000Z', status_events: [],
  project: { name: 'Site', code: 'P1' }, vendor: { name: 'Acme Supply' }, requested_by: { full_name: 'Rina Requester' },
  purchase_requests: [], purchase_orders: [], receipts: [], procurement_invoices: [{ amount: 62_000, erp_outstanding_amount: 62_000, invoice_date: '2026-10-20' }], payments: [],
  ...over,
});

const procState = vi.hoisted(() => ({ data: [] as unknown[], isPending: false, isError: false, refetch: vi.fn() }));
const authState = vi.hoisted(() => ({ userId: 'u-finance', role: 'Finance' }));

vi.mock('@/src/hooks/useProcurements', () => ({ useProcurements: () => procState, useProjectProcurements: () => procState }));
vi.mock('@/src/hooks/useErpPurchases', () => ({
  useErpPurchases: () => ({ data: [], isError: false, isPending: false, refetch: vi.fn() }),
  useErpOrphans: () => ({ data: [], isError: false, refetch: vi.fn() }),
}));
vi.mock('../ErpPurchasesSection', () => ({ ErpPurchasesSection: () => <section aria-label="erp purchases" /> }));
vi.mock('../ErpJournalLinesSection', () => ({ ErpJournalLinesSection: () => <section aria-label="erp journal" /> }));
vi.mock('@/src/hooks/useProjects', () => ({ useProject: () => ({ data: null }) }));
vi.mock('@/src/hooks/useProcurementDetail', () => ({
  useProcurementDetail: (id?: string) => {
    const found = (procState.data as Array<ReturnType<typeof makeRow>>).find((candidate) => candidate.id === id);
    return { data: found ? { ...found, items: [], quotations: [], invoices: found.procurement_invoices } : undefined, isPending: false, isError: false, refetch: vi.fn() };
  },
}));
vi.mock('@/src/hooks/useProjectPosition', () => ({ useBudgetPosition: () => ({ rows: [], hasBudget: false, isPending: false, actualsPending: false }) }));
vi.mock('@/src/components/export/useExport', () => ({ useExport: () => ({ exportXlsx: vi.fn(), busy: false }) }));
vi.mock('@/src/hooks/useErpPurchaseLinks', () => ({ useLinkErpDocuments: () => ({ mutateAsync: vi.fn(), isPending: false }) }));
vi.mock('@/src/auth/impersonation', () => ({ useEffectiveRole: () => ({ realRole: authState.role, effectiveRole: authState.role }) }));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { id: authState.userId, org_id: 'org-1' }, role: authState.role }) }));

const renderTab = () => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}>
    <MemoryRouter><ToastProvider><ProcurementTab projectId="p1" /></ToastProvider></MemoryRouter>
  </QueryClientProvider>,
);

beforeEach(() => {
  procState.data = [
    makeRow({ id: 'p-1', code: 'PR-1', title: 'Inverters', budget_category: 'Materials', requested_by_id: 'u-requester', requested_by: { full_name: 'Rina Requester' } }),
    makeRow({ id: 'p-2', code: 'PR-2', title: 'Cable trays', budget_category: 'Labor', requested_by_id: 'u-other', requested_by: { full_name: 'Budi Owner' } }),
  ];
  sessionStorage.clear();
  window.matchMedia = ((query: string) => ({ matches: query.includes('min-width:'), media: query, onchange: null, addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false })) as unknown as typeof window.matchMedia;
});

describe('ProcurementTab floor', () => {
  it('floor: Search narrows procurement rows to the typed title', async () => {
    renderTab();
    expect(screen.getByText('Cable trays')).toBeInTheDocument();

    await userEvent.type(screen.getByRole('searchbox', { name: 'Search procurement' }), 'Inverters');
    expect(screen.getByText('Inverters')).toBeInTheDocument();
    expect(screen.queryByText('Cable trays')).not.toBeInTheDocument();
  });

  it('floor: Category filter narrows rows to the chosen category', async () => {
    renderTab();

    await userEvent.selectOptions(screen.getByLabelText('Filter by category'), 'Labor');
    expect(screen.getByText('Cable trays')).toBeInTheDocument();
    expect(screen.queryByText('Inverters')).not.toBeInTheDocument();
  });

  it('floor: Owner filter narrows rows to the chosen requester', async () => {
    renderTab();

    await userEvent.selectOptions(screen.getByLabelText('Filter by owner'), 'u-other');
    expect(screen.getByText('Cable trays')).toBeInTheDocument();
    expect(screen.queryByText('Inverters')).not.toBeInTheDocument();
  });
});

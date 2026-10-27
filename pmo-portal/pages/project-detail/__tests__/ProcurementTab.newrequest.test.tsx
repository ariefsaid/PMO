import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Role } from '@/src/auth/AuthContext';
import { ToastProvider } from '@/src/components/ui';
import { formatCurrency } from '@/src/lib/format';
import { MemoryRouter, useLocation } from 'react-router';
import { ProcurementBlock } from '@/src/components/procurement/ProcurementBlock';

const { procState, projectState, erpState, detailState, budgetState } = vi.hoisted(() => ({
  procState: {
    data: [] as unknown[],
    isPending: false,
    isError: false,
    refetch: vi.fn(),
  },
  projectState: {
    data: { id: 'proj-abc', currency: 'USD' } as { id: string; currency: string } | null,
  },
  erpState: { data: [] as unknown[], isError: false, refetch: vi.fn() },
  detailState: { data: null as unknown, isPending: false, isError: false, refetch: vi.fn() },
  budgetState: {
    rows: [{ category: 'Materials', budget: 10_000, actual: 1_500 }],
    hasBudget: true,
    isPending: false,
    actualsPending: false,
  },
}));

vi.mock('@/src/hooks/useErpPurchaseLinks', () => ({ useLinkErpDocuments: () => ({ mutateAsync: vi.fn(), isPending: false }) }));
vi.mock('@/src/hooks/useErpPurchases', () => ({
  useErpPurchases: () => erpState,
  useErpOrphans: () => ({ data: erpState.data.filter((row) => (row as { procurementId: string | null }).procurementId === null), isError: false, refetch: vi.fn() }),
  useHasErpPurchases: () => ({ data: false }),
}));
vi.mock('@/src/hooks/useProcurements', () => ({
  useProcurements: () => procState,
  useProjectProcurements: () => procState,
}));
vi.mock('@/src/hooks/useProjects', () => ({ useProject: () => projectState }));
vi.mock('@/src/hooks/useProcurementDetail', () => ({ useProcurementDetail: () => detailState }));
vi.mock('../useProjectPosition', () => ({ useBudgetPosition: () => budgetState }));

vi.mock('@/src/hooks/useFkOptions', () => ({
  useProjectOptions: () => ({ data: [{ value: 'proj-abc', label: 'Test Project', sub: 'PRJ-ABC' }] }),
  useVendorOptions: () => ({ data: [] }),
}));
vi.mock('@/src/hooks/useProcurementCrud', () => ({
  useCreateProcurement: () => ({ mutateAsync: vi.fn().mockResolvedValue({ id: 'new-pr-1' }), isPending: false }),
}));

const mockNavigate = vi.fn();
vi.mock('react-router', async (orig) => {
  const real = await orig<typeof import('react-router')>();
  return { ...real, useNavigate: () => mockNavigate };
});

let realRole: Role = 'Project Manager';
vi.mock('@/src/auth/impersonation', () => ({ useEffectiveRole: () => ({ realRole, effectiveRole: realRole }) }));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { id: 'u-1', org_id: 'org-1' }, role: realRole }) }));

import ProcurementTab from '../tabs/ProcurementTab';

const renderTab = (role: Role = 'Project Manager') => {
  realRole = role;
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <ToastProvider>
          <ProcurementTab projectId="proj-abc" />
        </ToastProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
};

const renderBlock = (role: Role = 'Project Manager', initialEntry = '/projects/proj-abc?tab=procurement') => {
  realRole = role;
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[initialEntry]}>
        <ToastProvider>
          <ProcurementBlock projectId="proj-abc" />
          <LocationSearch />
        </ToastProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
};

const LocationSearch = () => <output data-testid="location-search">{useLocation().search}</output>;

const procurement = (id: string, status: string, overrides: Record<string, unknown> = {}) => ({
  id,
  code: `PR-${id}`,
  title: id,
  status,
  total_value: 1_250,
  approved_total_value: null,
  currency: 'USD',
  project_id: 'proj-abc',
  budget_category: 'Materials',
  requested_by_id: 'u-1',
  vendor_id: null,
  created_at: '2026-10-01T00:00:00.000Z',
  updated_at: '2026-10-01T00:00:00.000Z',
  status_events: [{ to_status: 'Requested', created_at: '2026-10-02T00:00:00.000Z' }],
  project: { name: 'Test Project', code: 'PRJ-ABC' },
  vendor: { name: 'Northwind Supplies' },
  requested_by: { full_name: 'Project Manager' },
  ...overrides,
});

beforeEach(() => {
  procState.data = [];
  procState.isPending = false;
  procState.isError = false;
  procState.refetch.mockClear();
  projectState.data = { id: 'proj-abc', currency: 'USD' };
  erpState.data = [];
  erpState.isError = false;
  detailState.data = null;
  detailState.isPending = false;
  detailState.isError = false;
  detailState.refetch.mockClear();
  mockNavigate.mockClear();
  realRole = 'Project Manager';
});

describe('project procurement tab', () => {
  it('keeps New procurement available from the project and passes its id to the create route', async () => {
    renderTab('Project Manager');
    await userEvent.click(screen.getByRole('button', { name: /new procurement/i }));
    expect(mockNavigate).toHaveBeenCalledWith('/procurement/new?project=proj-abc');
  });

  it('shows the project-scoped empty state and one create action', () => {
    renderTab('Project Manager');
    expect(screen.getByText('No procurement on this project yet.')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /new procurement/i })).toHaveLength(1);
  });

  it('AC-1402 keeps the project procurement list embedded in its page section', () => {
    renderTab('Project Manager');
    const list = screen.getByRole('region', { name: 'Procurement' });
    expect(list).not.toHaveClass('bg-card', 'rounded-lg', 'border');
  });

  it.each(['Admin', 'Finance', 'Project Manager'] as const)('shows money for %s', (role) => {
    procState.data = [procurement('requested probes', 'Requested')];
    renderTab(role);
    expect(screen.getByRole('columnheader', { name: /Value/ })).toBeInTheDocument();
    const amount = formatCurrency(1_250, 'USD');
    expect(screen.getAllByText((_, element) => element?.textContent === amount).length).toBeGreaterThanOrEqual(2);
  });

  it('AC-1402 hides every procurement amount from Engineer while keeping the same stage and list', () => {
    procState.data = [procurement('own request', 'Draft')];
    renderTab('Engineer');
    expect(screen.getByText('own request')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Request/ })).toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: /Value/ })).not.toBeInTheDocument();
    const amount = formatCurrency(1_250, 'USD');
    expect(screen.queryByText((_, element) => element?.textContent === amount)).not.toBeInTheDocument();
  });

  it('shows approvers an action and tells other roles the request is waiting on an approver', () => {
    procState.data = [procurement('awaiting review', 'Requested', { requested_by_id: 'u-2' })];
    const { unmount } = renderTab('Finance');
    expect(screen.getByText('Approve or return')).toBeInTheDocument();
    unmount();
    renderTab('Engineer');
    expect(screen.getByText('Waiting on approver')).toBeInTheDocument();
  });

  it('counts only requests that are waiting for this approver, excluding their own requests', () => {
    procState.data = [
      procurement('for another approver', 'Requested', { requested_by_id: 'u-2' }),
      procurement('own request', 'Requested', { requested_by_id: 'u-1' }),
    ];
    renderTab('Finance');
    expect(screen.getByText('1 for you')).toBeInTheDocument();
  });

  it('opens the shared drawer from a row and shows the category, budget position, timeline, and documents', async () => {
    procState.data = [procurement('proc-1', 'Requested', { title: 'ultrasonic probes' })];
    detailState.data = {
      statusEvents: [{ to_status: 'Requested', created_at: '2026-10-02T00:00:00.000Z' }],
      purchase_requests: [],
      quotations: [{ vq_number: 'VQ-100', reference: null }],
      purchase_orders: [],
      receipts: [],
      invoices: [],
      payments: [],
    };
    renderTab('Finance');
    await userEvent.click(screen.getByRole('button', { name: 'Open ultrasonic probes' }));
    const drawer = screen.getByRole('dialog');
    expect(within(drawer).getByText('Materials')).toBeInTheDocument();
    expect(within(drawer).getByText('Budget left in category')).toBeInTheDocument();
    expect(within(drawer).getByText(formatCurrency(7_250, 'USD'))).toBeInTheDocument();
    expect(within(drawer).getByText('Step timeline')).toBeInTheDocument();
    expect(within(drawer).getAllByText('Not recorded').length).toBeGreaterThan(0);
    expect(within(drawer).getByText('Quotation')).toBeInTheDocument();
    expect(within(drawer).getByRole('link', { name: 'Open full page' })).toHaveAttribute('href', '/procurement/proc-1');
  });

  it('switches the displayed records from the stage band and can clear the stage filter', async () => {
    procState.data = [
      procurement('awaiting review', 'Requested'),
      procurement('approved order', 'Approved'),
    ];
    renderTab('Project Manager');
    await userEvent.click(screen.getByRole('button', { name: /Approved/ }));
    expect(screen.getByText('approved order')).toBeInTheDocument();
    expect(screen.queryByText('awaiting review')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Clear stage filter' }));
    expect(screen.getByText('awaiting review')).toBeInTheDocument();
  });

  it('reveals approval and export actions when an approver selects rows', async () => {
    procState.data = [procurement('awaiting review', 'Requested', { requested_by_id: 'u-2' })];
    renderTab('Finance');
    await userEvent.click(screen.getByRole('checkbox', { name: 'Select awaiting review' }));
    expect(screen.getByRole('button', { name: 'Approve' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Return' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Export' })).toBeInTheDocument();
  });

  it('preserves stage-specific next steps for the lifecycle statuses', () => {
    procState.data = [
      procurement('request', 'Draft'),
      procurement('in flight', 'Vendor Quoted'),
      procurement('order', 'Ordered'),
      procurement('received', 'Received'),
      procurement('invoice', 'Vendor Invoiced'),
      procurement('paid', 'Paid'),
    ];
    renderTab('Project Manager');
    expect(screen.getByText('Submit for approval')).toBeInTheDocument();
    expect(screen.getByText('Choose a quote')).toBeInTheDocument();
    expect(screen.getByText('Record delivery')).toBeInTheDocument();
    expect(screen.getByText('Record supplier invoice')).toBeInTheDocument();
    expect(screen.getByText('Pay')).toBeInTheDocument();
    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
  });

  it('shows an ERP hint in the procurement empty state when accounting documents are available', () => {
    erpState.data = [{ id: 'd1', procurementId: null, doctype: 'Purchase Invoice', name: 'PINV-1', projectIds: ['proj-abc'], currency: 'USD', outstanding: 1, dueDate: null, docDate: null, isReturn: false, grandTotal: 1, netTotal: 1 }];
    renderTab('Finance');
    expect(screen.getByText('Purchases recorded in the accounting system appear below.')).toBeInTheDocument();
  });
});

describe('shared procurement block', () => {
  it('AC-1402 keeps every amount hidden from Engineers', () => {
    procState.data = [procurement('own request', 'Draft')];
    renderBlock('Engineer');
    expect(screen.getByText('own request')).toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: /Value/ })).not.toBeInTheDocument();
    expect(screen.queryByText((_, element) => element?.textContent === formatCurrency(1_250, 'USD'))).not.toBeInTheDocument();
    expect(screen.queryByText(/Unpaid/i)).not.toBeInTheDocument();
  });

  it('opens the drawer from ?open=<id> and removes that parameter when closed', async () => {
    procState.data = [procurement('proc-1', 'Requested', { title: 'ultrasonic probes' })];
    renderBlock('Finance', '/projects/proj-abc?tab=procurement&open=proc-1');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'ultrasonic probes' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /close/i }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByTestId('location-search')).toHaveTextContent('?tab=procurement');
  });

  it('uses DataTable selection to expose approver bulk actions', async () => {
    procState.data = [procurement('awaiting review', 'Requested', { requested_by_id: 'u-2' })];
    renderBlock('Finance');
    await userEvent.click(screen.getByRole('checkbox', { name: 'Select awaiting review' }));
    expect(screen.getByText('1 selected')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Approve' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Return' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Export' })).toBeInTheDocument();
  });

  it('shows the most recorded payment amount and the finance unpaid line', () => {
    procState.data = [procurement('paid record', 'Paid', {
      purchase_requests: [{ amount: 1_000, date: '2026-09-01', created_at: '2026-09-01T00:00:00.000Z', external_ref: null }],
      purchase_orders: [{ amount: 900, date: '2026-09-02', created_at: '2026-09-02T00:00:00.000Z', external_ref: null }],
      receipts: [{ receipt_date: '2026-09-03', created_at: '2026-09-03T00:00:00.000Z' }],
      procurement_invoices: [{ amount: 800, invoice_date: '2026-09-04', created_at: '2026-09-04T00:00:00.000Z', erp_outstanding_amount: null, external_ref: null }],
      payments: [{ amount: 300, date: '2026-09-05', created_at: '2026-09-05T00:00:00.000Z', status: 'Paid' }],
    })];
    renderBlock('Finance');
    expect(screen.getAllByText((_, element) => element?.textContent === formatCurrency(300, 'USD')).length).toBeGreaterThan(0);
    expect(screen.getByText(/Unpaid/)).toBeInTheDocument();
  });

  it('expands procurement facts, line items, next step, budget impact, and drawer entry', async () => {
    procState.data = [procurement('expandable', 'Requested')];
    detailState.data = {
      id: 'expandable',
      items: [{ id: 'item-1', name: 'Probe', description: 'Ultrasonic', quantity: 2 }],
      purchase_requests: [],
      purchase_orders: [],
      receipts: [],
      invoices: [],
      payments: [],
      quotations: [],
      statusEvents: [],
    };
    renderBlock('Finance');
    await userEvent.click(screen.getByRole('button', { name: 'Expand procurement details' }));
    expect(screen.getByText('Line items')).toBeInTheDocument();
    expect(screen.getByText('Probe · Ultrasonic · 2')).toBeInTheDocument();
    expect(screen.getByText('Budget left in category')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open procurement' })).toBeInTheDocument();
  });
});

describe('project procurement loading and error states', () => {
  it('renders an aria-busy loading skeleton', () => {
    procState.isPending = true;
    renderTab('Project Manager');
    expect(document.querySelector('[aria-busy="true"]')).not.toBeNull();
  });

  it('shows a retry action after a procurement read failure', async () => {
    procState.isError = true;
    procState.data = undefined as unknown as unknown[];
    renderTab('Project Manager');
    await userEvent.click(screen.getByRole('button', { name: /try again|retry/i }));
    expect(procState.refetch).toHaveBeenCalled();
  });
});

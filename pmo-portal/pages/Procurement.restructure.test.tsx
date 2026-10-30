import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToastProvider } from '@/src/components/ui';
import Procurement from './Procurement';
import ErpPurchases from './ErpPurchases';

const now = Date.now();
const daysAgo = (days: number) => new Date(now - days * 86_400_000).toISOString();
const row = (over: Record<string, unknown> = {}) => ({
  id: 'p-default',
  code: 'PROC-001',
  title: 'Default procurement',
  status: 'Draft',
  total_value: 1000,
  currency: 'USD',
  project_id: 'project-a',
  requested_by_id: 'u-other',
  vendor_id: null,
  created_at: daysAgo(2),
  project: { name: 'Project A', code: 'PA-001', project_manager_id: 'u-pm' },
  vendor: null,
  requested_by: { full_name: 'Raised by' },
  purchase_requests: [],
  purchase_orders: [],
  procurement_invoices: [],
  payments: [],
  ...over,
});

const procState = { data: [] as unknown[], isPending: false, isError: false, refetch: vi.fn() };
const authState = { userId: 'u-pm' };
const roleState = { role: 'Project Manager' as string | null };
const projectsState = { data: [] as { id: string; name: string }[], isPending: false, isError: false, refetch: vi.fn() };
const erpState = { data: [] as unknown[], isPending: false, isError: false, refetch: vi.fn() };

vi.mock('@/src/hooks/useProcurements', () => ({ useProcurements: () => procState, useProjectProcurements: () => procState }));
vi.mock('@/src/hooks/useErpPurchases', () => ({
  useErpPurchases: () => erpState,
  useErpOrphans: () => erpState,
  useHasErpPurchases: () => ({ data: false }),
}));
vi.mock('@/src/hooks/useErpPurchaseLinks', () => ({ useLinkErpDocuments: () => ({ mutateAsync: vi.fn(), isPending: false }) }));
vi.mock('@/src/hooks/useProjects', () => ({ useProjects: () => projectsState, useProject: () => ({ data: null }) }));
vi.mock('@/src/hooks/useProcurementDetail', () => ({ useProcurementDetail: () => ({ data: null, isPending: false, isError: false, refetch: vi.fn() }) }));
vi.mock('@/pages/project-detail/useProjectPosition', () => ({ useBudgetPosition: () => ({ rows: [], hasBudget: false, isPending: false, actualsPending: false }) }));
vi.mock('@/src/hooks/useFkOptions', () => ({
  useProjectOptions: () => ({ data: [] }),
  useVendorOptions: () => ({ data: [] }),
}));
vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: { id: authState.userId, org_id: 'org-1' }, role: roleState.role }),
}));
vi.mock('@/src/auth/impersonation', () => ({
  useEffectiveRole: () => ({ effectiveRole: roleState.role, realRole: roleState.role }),
}));
vi.mock('@/src/auth/usePermission', () => ({
  usePermission: () => (action: string, entity: string) =>
    action === 'view' && entity === 'procurement' ? roleState.role !== 'Engineer' : true,
}));

const RouteProbe = () => {
  const location = useLocation();
  return <output data-testid="route-path">{location.pathname + location.search}</output>;
};

function renderPage(path = '/procurement') {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}>
      <ToastProvider>
        <MemoryRouter initialEntries={[path]}>
          <RouteProbe />
          <Procurement />
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

describe('Procurement list restructure', () => {
  beforeEach(() => {
    procState.data = [row()];
    procState.isPending = false;
    procState.isError = false;
    projectsState.data = [];
    projectsState.isPending = false;
    projectsState.isError = false;
    projectsState.refetch.mockReset();
    erpState.data = [];
    erpState.isPending = false;
    erpState.isError = false;
    authState.userId = 'u-pm';
    roleState.role = 'Project Manager';
    sessionStorage.clear();
  });

  it('waits for project references and offers a safe retry on failure', async () => {
    roleState.role = 'Finance';
    authState.userId = 'u-finance';
    erpState.data = [{ id: 'orphan-1', name: 'ORPHAN-1', doctype: 'Purchase Order', projectIds: ['p1'], currency: 'USD' }];
    projectsState.isPending = true;
    const view = renderPage('/procurement?tab=orphans');
    expect(screen.queryByText('ORPHAN-1')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Export list' })).not.toBeInTheDocument();
    projectsState.isPending = false;
    projectsState.isError = true;
    view.unmount();
    renderPage('/procurement?tab=orphans');
    expect(screen.queryByText('ORPHAN-1')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Export list' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /retry/i }));
    expect(projectsState.refetch).toHaveBeenCalled();
  });

  it('shows the orphan export only after project names are ready', () => {
    roleState.role = 'Finance';
    authState.userId = 'u-finance';
    projectsState.data = [{ id: 'p1', name: 'Tower' }];
    erpState.data = [{ id: 'orphan-1', name: 'ORPHAN-1', doctype: 'Purchase Order', projectIds: ['p1', 'missing-1'], currency: 'USD' }];

    renderPage('/procurement?tab=orphans');

    expect(screen.getByRole('row', { name: /ORPHAN-1/ })).toHaveTextContent('Tower, Project unavailable (missing-1)');
    expect(screen.getByRole('button', { name: 'Export list' })).toBeEnabled();
  });

  it('Finance opens Needs you with the oldest unpaid supplier invoice first', () => {
    roleState.role = 'Finance';
    authState.userId = 'u-finance';
    procState.data = [
      row({
        id: 'invoice-old',
        title: 'Older unpaid invoice',
        status: 'Vendor Invoiced',
        created_at: daysAgo(12),
        procurement_invoices: [{ amount: 400, erp_outstanding_amount: 400, invoice_date: daysAgo(12) }],
      }),
      row({ id: 'approval-new', title: 'Newer approval', status: 'Requested', created_at: daysAgo(3) }),
    ];

    renderPage();

    const needsYou = screen.getByRole('tab', { name: /Needs you/i });
    expect(needsYou).toHaveAttribute('aria-selected', 'true');
    const invoiceTitle = screen.getByRole('button', { name: 'Open Older unpaid invoice' });
    const approvalTitle = screen.getByRole('button', { name: 'Open Newer approval' });
    const invoiceRow = invoiceTitle.closest('tr, li');
    const approvalRow = approvalTitle.closest('tr, li');
    expect(invoiceRow).not.toBeNull();
    expect(approvalRow).not.toBeNull();
    expect(Boolean(invoiceRow!.compareDocumentPosition(approvalRow!) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true);
  });

  it('Project Managers see procurements only for projects they manage', () => {
    procState.data = [
      row({ id: 'managed', title: 'Managed project work' }),
      row({
        id: 'unmanaged',
        title: 'Other project work',
        project: { name: 'Project B', code: 'PB-001', project_manager_id: 'u-another-pm' },
      }),
    ];

    renderPage('/procurement?tab=all');

    expect(screen.getByText('Managed project work')).toBeInTheDocument();
    expect(screen.queryByText('Other project work')).not.toBeInTheDocument();
  });

  it("SEC-RS-1: a Project Manager's list includes requests they raised on another project or with no project", () => {
    procState.data = [
      row({ id: 'managed', title: 'Managed project work' }),
      row({
        id: 'own-on-other',
        title: 'My request on another project',
        requested_by_id: 'u-pm',
        project: { name: 'Project B', code: 'PB-001', project_manager_id: 'u-another-pm' },
      }),
      row({ id: 'own-overhead', title: 'My overhead request', requested_by_id: 'u-pm', project_id: null, project: null }),
      row({ id: 'other-overhead', title: 'Colleague overhead request', project_id: null, project: null }),
      row({
        id: 'unmanaged',
        title: 'Other project work',
        project: { name: 'Project B', code: 'PB-001', project_manager_id: 'u-another-pm' },
      }),
    ];

    renderPage('/procurement?tab=all');

    expect(screen.getByText('Managed project work')).toBeInTheDocument();
    expect(screen.getByText('My request on another project')).toBeInTheDocument();
    expect(screen.getByText('My overhead request')).toBeInTheDocument();
    expect(screen.queryByText('Colleague overhead request')).not.toBeInTheDocument();
    expect(screen.queryByText('Other project work')).not.toBeInTheDocument();
  });

  it('Engineers do not see the Not in a procurement tab', () => {
    roleState.role = 'Engineer';
    authState.userId = 'u-engineer';
    procState.data = [row({ id: 'own', requested_by_id: 'u-engineer' })];

    renderPage();

    expect(screen.queryByRole('tab', { name: /Not in a procurement/i })).not.toBeInTheDocument();
  });

  it('Engineers see only their rows and no supplier invoice or payment amounts', () => {
    roleState.role = 'Engineer';
    authState.userId = 'u-engineer';
    procState.data = [
      row({
        id: 'engineer-own',
        title: 'My supplier invoice',
        requested_by_id: 'u-engineer',
        status: 'Vendor Invoiced',
        total_value: 1000,
        procurement_invoices: [{ amount: 500, erp_outstanding_amount: 300 }],
        payments: [{ amount: 200, status: 'Paid' }],
      }),
      row({ id: 'someone-elses', title: 'Another engineer invoice', requested_by_id: 'u-other' }),
    ];

    renderPage('/procurement?tab=all');

    expect(screen.getByText('My supplier invoice')).toBeInTheDocument();
    expect(screen.queryByText('Another engineer invoice')).not.toBeInTheDocument();
    const page = screen.getByRole('tabpanel');
    expect(page).not.toHaveTextContent('$500');
    expect(page).not.toHaveTextContent('$300');
    expect(page).not.toHaveTextContent('$200');
    expect(screen.getByTestId('summary-total-ordered')).toHaveAttribute('title', expect.stringMatching(/supplier invoice and payment amounts are not shown/i));
  });

  it('Finance can open the Not in a procurement tab', () => {
    roleState.role = 'Finance';
    renderPage();

    expect(screen.getByRole('tab', { name: /Not in a procurement/i })).toBeInTheDocument();
  });

  it('the grouped Status filter narrows the current tab to ordered procurements', async () => {
    roleState.role = 'Admin';
    procState.data = [
      row({ id: 'request', title: 'Request row', status: 'Requested' }),
      row({ id: 'ordered', title: 'Ordered row', status: 'Ordered' }),
    ];
    renderPage('/procurement?tab=all&view=grouped');

    await userEvent.selectOptions(screen.getByLabelText('Status'), 'group:Ordered');

    expect(screen.getByTestId('route-path')).toHaveTextContent('status=group%3AOrdered');
    expect(screen.getByText('Ordered row')).toBeInTheDocument();
    expect(screen.queryByText('Request row')).not.toBeInTheDocument();
  });

  it('Grouped view shows counts for each next-step group', async () => {
    roleState.role = 'Admin';
    procState.data = [
      row({ id: 'approval', title: 'Approval item', status: 'Requested' }),
      row({ id: 'invoice', title: 'Invoice item', status: 'Vendor Invoiced', procurement_invoices: [{ amount: 300, erp_outstanding_amount: 300 }] }),
      row({ id: 'paid', title: 'Paid item', status: 'Paid' }),
      row({ id: 'rejected', title: 'Rejected item', status: 'Rejected' }),
    ];
    renderPage('/procurement?tab=all');

    await userEvent.click(screen.getByRole('tab', { name: /Grouped/i }));

    expect(screen.getByTestId('group-count-needs-approval')).toHaveTextContent('1');
    expect(screen.getByTestId('group-count-invoiced')).toHaveTextContent('1');
    expect(screen.getByTestId('group-count-done')).toHaveTextContent('2');
  });

  it('the Pay summary uses the unpaid invoice amount and explains its basis', () => {
    roleState.role = 'Finance';
    procState.data = [row({
      id: 'unpaid',
      title: 'Supplier invoice due',
      status: 'Vendor Invoiced',
      total_value: 1000,
      procurement_invoices: [{ amount: 500, erp_outstanding_amount: 300, invoice_date: daysAgo(5) }],
      payments: [{ amount: 200, status: 'Paid' }],
    })];
    renderPage('/procurement?tab=all');

    const payTotal = screen.getByTestId('summary-total-unpaid');
    expect(payTotal).toHaveTextContent('$300');
    expect(payTotal).toHaveAttribute('title', expect.stringMatching(/unpaid balance/i));
  });

  it('L6/F11 + O7: tabs own the counts and the money for their scope; the tiles carry only the figures no tab owns', () => {
    roleState.role = 'Finance';
    authState.userId = 'u-finance';
    procState.data = [
      row({ id: 'a', status: 'Vendor Invoiced', procurement_invoices: [{ amount: 2_400_000, erp_outstanding_amount: 2_400_000, invoice_date: daysAgo(4) }] }),
      row({ id: 'b', status: 'Vendor Invoiced', procurement_invoices: [{ amount: 33_500, erp_outstanding_amount: 33_500, invoice_date: daysAgo(9) }] }),
      row({ id: 'c', status: 'Ordered', purchase_orders: [{ amount: 9_000 }] }),
    ];
    erpState.data = [{ id: 'orphan-1', currency: 'USD', grandTotal: 700 }];
    renderPage();

    expect(screen.getByRole('tab', { name: /Needs you/i })).toHaveTextContent('2');
    expect(screen.getByRole('tab', { name: /Needs you/i })).toHaveTextContent('$2.4M');
    expect(screen.getByRole('tab', { name: /Not in a procurement/i })).toHaveTextContent('1');
    expect(screen.getByRole('tab', { name: /Not in a procurement/i })).toHaveTextContent('$700');
    expect(screen.queryByTestId('summary-cell-needs-you')).toBeNull();
    expect(screen.queryByTestId('summary-cell-orphans')).toBeNull();
    expect(screen.getByTestId('summary-total-unpaid')).toHaveTextContent('$2.4M');
    expect(screen.getByTestId('summary-total-unpaid')).toHaveAttribute('aria-label', expect.stringContaining('$2,433,500'));
    expect(screen.getByTestId('summary-cell-unpaid')).toHaveTextContent(/2 procurements/);
    expect(screen.getByTestId('summary-cell-ordered')).toHaveTextContent(/1 procurement/);
  });

  it('L12c: the unpaid tile shows the recorded balance and says how many have none, instead of "amount not recorded" alone', () => {
    roleState.role = 'Finance';
    authState.userId = 'u-finance';
    procState.data = [
      row({ id: 'known', status: 'Vendor Invoiced', procurement_invoices: [{ amount: 30_000, erp_outstanding_amount: 30_000, invoice_date: daysAgo(4) }] }),
      row({ id: 'blank', status: 'Vendor Invoiced', procurement_invoices: [] }),
    ];
    renderPage('/procurement?tab=all');

    const tile = screen.getByTestId('summary-total-unpaid');
    expect(tile).toHaveTextContent('$30K');
    expect(tile).toHaveTextContent(/1 more has no amount recorded/i);
    expect(tile).not.toHaveTextContent(/USD amount not recorded/i);
  });

  it('C4: a known zero reads 0 and an Engineer gets no supplier-invoice tile', () => {
    roleState.role = 'Engineer';
    authState.userId = 'u-engineer';
    procState.data = [row({ id: 'mine', requested_by_id: 'u-engineer', status: 'Requested' })];
    renderPage('/procurement?tab=all');

    expect(screen.queryByTestId('summary-cell-unpaid')).toBeNull();
    const ordered = screen.getByTestId('summary-total-ordered');
    expect(ordered).toHaveTextContent('0');
    expect(ordered).not.toHaveTextContent(/no amount/i);
    expect(screen.queryByText('No amount')).toBeNull();
  });

  it('/erp-purchases redirects to the Procurement orphans tab', () => {
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}>
        <MemoryRouter initialEntries={['/erp-purchases']}>
          <Routes>
            <Route path="/erp-purchases" element={<ErpPurchases />} />
            <Route path="/procurement" element={<RouteProbe />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(within(screen.getByTestId('route-path').parentElement as HTMLElement).getByTestId('route-path'))
      .toHaveTextContent('/procurement?tab=orphans');
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
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
const erpState = { data: [] as unknown[], isPending: false, isError: false, refetch: vi.fn() };

vi.mock('@/src/hooks/useProcurements', () => ({ useProcurements: () => procState }));
vi.mock('@/src/hooks/useErpPurchases', () => ({
  useErpOrphans: () => erpState,
  useHasErpPurchases: () => ({ data: false }),
}));
vi.mock('@/src/hooks/useProjects', () => ({ useProjects: () => ({ data: [] }) }));
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
vi.mock('@/src/auth/usePermission', () => ({ usePermission: () => () => true }));

const RouteProbe = () => {
  const location = useLocation();
  return <output data-testid="route-path">{location.pathname + location.search}</output>;
};

function renderPage(path = '/procurement') {
  return render(
    <ToastProvider>
      <MemoryRouter initialEntries={[path]}>
        <RouteProbe />
        <Procurement />
      </MemoryRouter>
    </ToastProvider>,
  );
}

describe('Procurement list restructure', () => {
  beforeEach(() => {
    procState.data = [row()];
    procState.isPending = false;
    procState.isError = false;
    erpState.data = [];
    erpState.isPending = false;
    erpState.isError = false;
    authState.userId = 'u-pm';
    roleState.role = 'Project Manager';
    sessionStorage.clear();
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
    const reason = screen.getByTestId('needs-you-reason-invoice-old');
    const invoiceTitle = screen.getByText('Older unpaid invoice');
    const approvalTitle = screen.getByText('Newer approval');
    expect(reason).toHaveTextContent(/Unpaid.*12 days/i);
    expect(Boolean(reason.compareDocumentPosition(invoiceTitle) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true);
    expect(Boolean(invoiceTitle.compareDocumentPosition(approvalTitle) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true);
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
    const payTotal = screen.getByTestId('summary-total-pay');
    expect(payTotal).not.toHaveTextContent('$500');
    expect(payTotal).not.toHaveTextContent('$300');
    expect(payTotal).not.toHaveTextContent('$200');
    expect(payTotal).toHaveAttribute('title', expect.stringMatching(/supplier invoice and payment amounts are not shown/i));
  });

  it('Finance can open the Not in a procurement tab', () => {
    roleState.role = 'Finance';
    renderPage();

    expect(screen.getByRole('tab', { name: /Not in a procurement/i })).toBeInTheDocument();
  });

  it('clicking Order filters the current tab and writes ?stage=order', async () => {
    roleState.role = 'Admin';
    procState.data = [
      row({ id: 'request', title: 'Request row', status: 'Requested' }),
      row({ id: 'ordered', title: 'Ordered row', status: 'Ordered' }),
    ];
    renderPage('/procurement?tab=all');

    await userEvent.click(screen.getByRole('button', { name: /Order stage/i }));

    expect(screen.getByTestId('route-path')).toHaveTextContent('?tab=all&stage=order');
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

    const payTotal = screen.getByTestId('summary-total-pay');
    expect(payTotal).toHaveTextContent('$300');
    expect(payTotal).toHaveAttribute('title', expect.stringMatching(/unpaid balance/i));
  });

  it('/erp-purchases redirects to the Procurement orphans tab', () => {
    render(
      <MemoryRouter initialEntries={['/erp-purchases']}>
        <Routes>
          <Route path="/erp-purchases" element={<ErpPurchases />} />
          <Route path="/procurement" element={<RouteProbe />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(within(screen.getByTestId('route-path').parentElement as HTMLElement).getByTestId('route-path'))
      .toHaveTextContent('/procurement?tab=orphans');
  });
});

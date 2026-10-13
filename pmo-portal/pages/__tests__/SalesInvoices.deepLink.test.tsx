import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { ToastProvider } from '@/src/components/ui';
import { ImpersonationProvider } from '@/src/auth/impersonation';
import type { SalesInvoiceRow } from '@/src/lib/db/revenue';

/** SalesInvoices page — ?q= deep link (#787, AC-AIN-015). */

// Mock hooks to provide stable test data
const hoisted = vi.hoisted(() => ({
  salesInvoicesState: {
    data: [
      {
        id: 'inv-1',
        org_id: 'org-1',
        project_id: null,
        customer_id: 'cust-1',
        customer_name: 'Acme Energy',
        si_number: 'ACC-SINV-2026-00001',
        reference_number: 'PO-12345',
        invoice_date: '2026-07-01',
        amount: 10000,
        currency: 'USD',
        // #548: 0188 makes tax_treatment NOT NULL. The two fixtures below carry OPPOSITE bases so
        // this file can tell a derived label from a hardcoded one.
        tax_treatment: 'inclusive',
        erp_outstanding_amount: 5000,
        status: 'Submitted',
        erp_docstatus: 1,
        erp_modified: null,
        erp_amended_from: null,
        erp_cancelled_at: null,
        created_at: '2026-07-01T00:00:00Z',
        author_user_id: 'u-pm',
        author_user_ids: ['u-pm'],
        pmo_native: true,
        erp_payment_terms_days: 30,
        erp_due_date: null,
      },
      {
        id: 'inv-2',
        org_id: 'org-1',
        project_id: null,
        customer_id: 'cust-2',
        customer_name: 'Borealis Marine',
        si_number: 'ACC-SINV-2026-00002',
        reference_number: 'PO-67890',
        invoice_date: '2026-07-15',
        amount: 25000,
        currency: 'USD',
        tax_treatment: 'exclusive',
        erp_outstanding_amount: 0,
        status: 'Paid',
        erp_docstatus: 1,
        erp_modified: null,
        erp_amended_from: null,
        erp_cancelled_at: null,
        created_at: '2026-07-15T00:00:00Z',
        author_user_id: 'user-1',
        erp_payment_terms_days: 45,
        erp_due_date: '2026-09-15', // ERP-computed due date (takes precedence)
      },
    ] as SalesInvoiceRow[],
    isPending: false,
    isError: false,
    refetch: vi.fn(),
  },
}));

const salesInvoicesState = hoisted.salesInvoicesState;

vi.mock('@/src/hooks/useRevenue', () => ({
  useSalesInvoices: () => salesInvoicesState,
  useRevenueMutations: () => ({
    create: { mutateAsync: vi.fn(), isPending: false },
    submitInvoice: { mutateAsync: vi.fn(), isPending: false },
    cancelInvoice: { mutateAsync: vi.fn(), isPending: false },
    pendingPush: { status: 'idle', lastError: null, lastPushAt: null },
  }),
}));

vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: { id: 'u-pm', org_id: 'org-1' }, role: 'Project Manager' }),
}));

vi.mock('@/src/lib/adapterSeam/ownershipCache', () => ({
  routeDomainWrite: vi.fn(() => 'pmo'),
}));
vi.mock('@/src/hooks/useExternalDomainOwnership', () => ({ useExternalDomainOwnership: () => ({ data: [], isError: false }) }));
vi.mock('@/src/hooks/useFkOptions', () => ({ useInvoiceProjectOptions: () => ({ data: [] }) }));
vi.mock('@/src/hooks/useTasks', () => ({ useAssignableProfiles: () => ({ data: [] }) }));
vi.mock('@/pages/approvals/SalesInvoiceApprovalRow', () => ({
  SalesInvoiceApprovalPreview: ({ inv }: { inv: SalesInvoiceRow }) => <div>Invoice preview {inv.si_number}</div>,
}));

vi.mock('@/src/lib/analytics', () => ({
  trackFilterApplied: vi.fn(),
}));

import SalesInvoices from '../../pages/SalesInvoices';

const Location = () => {
  const location = useLocation();
  return <output data-testid="location">{location.pathname}{location.search}</output>;
};

const renderAt = (url: string) =>
  render(
    // The page's PDF hook reads the query cache (AC-PDF-011 list invalidation) — give it the
    // standard provider even though `useRevenue` itself is mocked here.
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}>
      <ImpersonationProvider realRole="Finance">
        <MemoryRouter initialEntries={[url]}>
          <ToastProvider>
            <Location />
            <Routes>
              <Route path="/sales-invoices" element={<SalesInvoices />} />
              <Route path="/sales-invoices/:invoiceId" element={<SalesInvoices />} />
            </Routes>
          </ToastProvider>
        </MemoryRouter>
      </ImpersonationProvider>
    </QueryClientProvider>,
  );

describe('SalesInvoices — deep link (#787)', () => {
  it('AC-AIN-015 ?q= seeds the search and filters the list to that invoice', () => {
    renderAt('/sales-invoices?q=ACC-SINV-2026-00002');
    expect(screen.getByDisplayValue('ACC-SINV-2026-00002')).toBeInTheDocument();
    const table = screen.getByRole('table').textContent ?? '';
    expect(table).toContain('ACC-SINV-2026-00002');
    expect(table).not.toContain('ACC-SINV-2026-00001');
  });
  it('no ?q= → empty search, both invoices', () => {
    renderAt('/sales-invoices');
    const table = screen.getByRole('table').textContent ?? '';
    expect(table).toContain('ACC-SINV-2026-00001');
    expect(table).toContain('ACC-SINV-2026-00002');
  });

  it('UXS-014 directly addresses an unnumbered draft by its customer and does not offer its author self-approval', () => {
    salesInvoicesState.data[0] = {
      ...salesInvoicesState.data[0],
      si_number: null,
      status: 'Draft',
      pmo_native: true,
      author_user_id: 'u-pm',
      author_user_ids: ['u-pm'],
    };
    renderAt('/sales-invoices/inv-1?q=ACC-SINV-2026-00002');
    expect(screen.getByTestId('location')).toHaveTextContent('/sales-invoices/inv-1?q=ACC-SINV-2026-00002');
    expect(screen.getByRole('heading', { name: 'Draft invoice · Acme Energy' })).toBeInTheDocument();
    expect(screen.getByText('Invoice preview')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Continue to approve' })).not.toBeInTheDocument();
    expect(screen.queryByText('inv-1')).not.toBeInTheDocument();
  });

  it('UXS-014 opens from the list and browser Back restores the search URL', async () => {
    const userInstance = userEvent.setup();
    renderAt('/sales-invoices?q=ACC-SINV-2026-00002');
    const row = screen.getByText('ACC-SINV-2026-00002').closest('tr');
    expect(row).not.toBeNull();
    await userInstance.click(within(row as HTMLElement).getByRole('button', { name: 'Row actions' }));
    await userInstance.click(screen.getByRole('menuitem', { name: 'View invoice' }));
    expect(screen.getByTestId('location')).toHaveTextContent('/sales-invoices/inv-2?q=ACC-SINV-2026-00002');
    await userInstance.click(screen.getByRole('button', { name: 'Back to Sales Invoices' }));
    expect(screen.getByTestId('location')).toHaveTextContent('/sales-invoices?q=ACC-SINV-2026-00002');
    expect(screen.getByDisplayValue('ACC-SINV-2026-00002')).toBeInTheDocument();
  });

  it('UXS-014 an unknown invoice id reads as not found', () => {
    renderAt('/sales-invoices/inv-missing');
    expect(screen.getByText('Invoice not found')).toBeInTheDocument();
  });

  it('UXS-014 a failed load on a record link is an error with retry, never "not found"', async () => {
    const prev = { isError: salesInvoicesState.isError, data: salesInvoicesState.data };
    Object.assign(salesInvoicesState, { isError: true, data: undefined });
    try {
      renderAt('/sales-invoices/inv-1');
      expect(screen.queryByText('Invoice not found')).not.toBeInTheDocument();
      expect(screen.getByText("Couldn't load sales invoices")).toBeInTheDocument();
      await userEvent.click(screen.getByRole('button', { name: /retry|try again/i }));
      expect(salesInvoicesState.refetch).toHaveBeenCalled();
    } finally {
      Object.assign(salesInvoicesState, prev);
    }
  });
});

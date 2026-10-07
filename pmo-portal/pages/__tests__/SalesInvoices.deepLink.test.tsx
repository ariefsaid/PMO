import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
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
        author_user_id: 'user-1',
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

vi.mock('@/src/lib/analytics', () => ({
  trackFilterApplied: vi.fn(),
}));

import SalesInvoices from '../../pages/SalesInvoices';

const renderAt = (url: string) =>
  render(
    // The page's PDF hook reads the query cache (AC-PDF-011 list invalidation) — give it the
    // standard provider even though `useRevenue` itself is mocked here.
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}>
      <ImpersonationProvider realRole="Finance">
        <MemoryRouter initialEntries={[url]}>
          <ToastProvider>
            <SalesInvoices />
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
});

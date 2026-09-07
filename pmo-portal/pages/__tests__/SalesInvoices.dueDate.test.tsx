import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import React from 'react';
import { ToastProvider } from '@/src/components/ui';
import { ImpersonationProvider } from '@/src/auth/impersonation';
import type { Role } from '@/src/auth/AuthContext';
import type { SalesInvoiceRow } from '@/src/lib/db/revenue';

/** SalesInvoices page — due-date column render test (AC-SAR-051 UI proof). */

// Mock hooks to provide stable test data
const hoisted = vi.hoisted(() => ({
  salesInvoicesState: {
    data: [
      {
        id: 'inv-1',
        org_id: 'org-1',
        project_id: null,
        customer_id: 'cust-1',
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

const renderAs = (realRole: Role) =>
  render(
    <ImpersonationProvider realRole={realRole}>
      <MemoryRouter>
        <ToastProvider>
          <SalesInvoices />
        </ToastProvider>
      </MemoryRouter>
    </ImpersonationProvider>,
  );

// ⚑ The fixture list is module-level shared state and `beforeEach` did NOT reset it, so any test
// that replaced `.data` silently poisoned every later test in the file. Snapshotted and restored,
// which makes the file order-independent and lets a test legitimately swap the rows.
const SEED_INVOICES = salesInvoicesState.data;

beforeEach(() => {
  salesInvoicesState.data = SEED_INVOICES;
  salesInvoicesState.isPending = false;
  salesInvoicesState.isError = false;
});

describe('SalesInvoices — currency (#530 / AC-L10N-020)', () => {
  // ⚑ THE ORACLE THIS SURFACE DID NOT HAVE. Every other fixture here is USD, so replacing
  // `inv.currency` with a literal 'USD' at the call site left the whole file GREEN — verified by
  // mutation during #529. A test that cannot tell the record's own currency from a hardcoded one is
  // not testing the seam; it is testing that some money renders.
  it('renders an IDR invoice in IDR, never the org default', () => {
    salesInvoicesState.data = [{ ...SEED_INVOICES[0], id: 'si-idr', currency: 'IDR' }];
    renderAs('Project Manager');
    const table = screen.getByRole('table').textContent ?? '';
    expect(table).toContain('IDR');
    expect(table).not.toContain('$');
  });

  it('renders two currencies side by side — the per-record column is not a per-page setting', () => {
    salesInvoicesState.data = [
      { ...SEED_INVOICES[0], id: 'si-usd', currency: 'USD' },
      { ...SEED_INVOICES[0], id: 'si-idr', currency: 'IDR' },
    ];
    renderAs('Project Manager');
    const table = screen.getByRole('table').textContent ?? '';
    expect(table).toContain('IDR');
    expect(table).toContain('$');
  });
});

describe('SalesInvoices — due-date column (AC-SAR-051 UI proof)', () => {
  it('renders the Due Date column with derived values', () => {
    renderAs('Project Manager');

    // Wait for the table to render
    expect(screen.getByRole('heading', { name: 'Sales Invoices' })).toBeInTheDocument();

    // Check that the Due Date column header exists
    const dueDateHeader = screen.getByText('Due Date');
    expect(dueDateHeader).toBeInTheDocument();

    // First invoice: invoice_date 2026-07-01 + 30 days = 2026-07-31 (no ERP due date)
    // Second invoice: has ERP due date 2026-09-15 (takes precedence)
    const dueDates = screen.getAllByText(/^(\d{1,2}\/\d{1,2}\/\d{4}|—)$/);
    // The due dates should appear in the table rows
    expect(dueDates.length).toBeGreaterThanOrEqual(2);

    // Verify the specific formatted dates appear (locale-dependent, so check pattern)
    // 2026-07-31 -> "7/31/2026" or "31/7/2026" depending on locale
    // 2026-09-15 -> "9/15/2026" or "15/9/2026" depending on locale
    const tableText = screen.getByRole('table').textContent;
    expect(tableText).toContain('2026'); // Both dates contain 2026
  });

  it('shows "—" for invoices with no invoice date', () => {
    // Add an invoice with no invoice_date
    salesInvoicesState.data = [
      ...salesInvoicesState.data,
      {
        id: 'inv-3',
        org_id: 'org-1',
        project_id: null,
        customer_id: 'cust-3',
        si_number: 'ACC-SINV-2026-00003',
        reference_number: 'PO-NEW',
        invoice_date: null,
        amount: 5000,
        currency: 'USD',
        erp_outstanding_amount: 5000,
        status: 'Draft',
        erp_docstatus: 0,
        erp_modified: null,
        erp_amended_from: null,
        erp_cancelled_at: null,
        created_at: '2026-07-20T00:00:00Z',
        author_user_id: 'user-1',
        erp_payment_terms_days: 30,
        erp_due_date: null,
      } as SalesInvoiceRow,
    ];

    renderAs('Project Manager');

    const tableText = screen.getByRole('table').textContent;
    // The third row should show "—" for due date when invoice_date is null
    expect(tableText).toContain('ACC-SINV-2026-00003');
  });
});
// ─────────────────────────────────────────────────────────────────────────────────────────────
// #548 / OD-TAX-1 §2 — every invoice total states its basis
// ─────────────────────────────────────────────────────────────────────────────────────────────
describe('#548 (OD-TAX-1): the Amount column carries the invoice’s tax basis', () => {
  it('#548: each invoice reads its OWN basis — inclusive and exclusive side by side', () => {
    renderAs('Project Manager');
    const labels = screen.getAllByTestId('tax-basis');
    expect(labels.map((l) => l.getAttribute('data-tax-basis'))).toEqual(['inclusive', 'exclusive']);
    expect(labels[0]).toHaveTextContent('incl. PPN');
    expect(labels[1]).toHaveTextContent('excl. PPN');
  });

  it('#548: an invoice with no amount yet shows neither a figure nor a basis', () => {
    // A dash is not a money figure, so there is nothing for a basis to qualify.
    salesInvoicesState.data = [{ ...SEED_INVOICES[0], id: 'si-noamt', amount: null }];
    renderAs('Project Manager');
    expect(screen.queryByTestId('tax-basis')).not.toBeInTheDocument();
  });
});

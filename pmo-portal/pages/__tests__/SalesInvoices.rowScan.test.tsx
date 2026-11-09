import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { ToastProvider } from '@/src/components/ui';
import { ImpersonationProvider } from '@/src/auth/impersonation';
import type { IncomingPaymentRow, SalesInvoiceRow } from '@/src/lib/db/revenue';

/**
 * #2103: the receivables list asked "is a receipt still awaiting the ERP for THIS invoice?" by scanning
 * every payment (and every allocation inside it) per row, and looked each row's Odoo command up with a
 * linear `find`. With 500 invoices and 500 payments that is ~418k predicate reads per keystroke.
 *
 * The counters below are reads of the fields those predicates compare, so they measure the scan itself
 * deterministically — no wall-clock threshold and nothing load-dependent.
 */
const h = vi.hoisted(() => ({
  invoices: [] as SalesInvoiceRow[],
  payments: [] as IncomingPaymentRow[],
  commands: [] as { kind: string; recordId: string; state: string; updatedAt: string; lastError: string | null }[],
}));
const reads = { payment: 0, command: 0 };

vi.mock('@/src/components/export', async () => {
  const React = await import('react');
  return {
    ExportButton: ({ label = 'Export' }: { label?: string }) => React.createElement('button', { type: 'button' }, label),
    withCurrencyColumn: <Row,>(columns: Row[]) => columns,
  };
});
vi.mock('@/src/hooks/useErpItemOptions', () => ({ useErpItemOptions: () => ({ connected: false, loadOptions: async () => [] }) }));
vi.mock('@/src/hooks/useOrgCurrency', () => ({
  useOrgCurrency: () => 'IDR',
  useOrgCurrencyState: () => ({ currency: 'IDR', isResolved: true, isError: false }),
}));
vi.mock('@/src/hooks/useFxOrgDay', () => ({ useFxOrgDay: () => ({ day: '2026-10-12', isPending: false, isError: false, retry: vi.fn() }) }));
vi.mock('@/src/hooks/useFxRates', () => ({ useFxRate: () => ({ data: null, isPending: false, isError: false, refetch: vi.fn() }) }));
vi.mock('@/src/hooks/useRevenue', () => ({
  useSalesInvoiceEvidence: () => ({ data: null, isPending: false, isError: false, refetch: vi.fn() }),
  useIncomingPayments: () => ({ data: h.payments, isPending: false, isError: false }),
  useAssignInvoiceProject: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useSalesInvoices: () => ({ data: h.invoices, isPending: false, isError: false, refetch: vi.fn() }),
  useRevenueMutations: () => ({
    create: { mutateAsync: vi.fn(), isPending: false },
    submitInvoice: { mutateAsync: vi.fn(), isPending: false },
    cancelInvoice: { mutateAsync: vi.fn(), isPending: false },
    setReceivedDate: { mutateAsync: vi.fn(), isPending: false },
    pendingPush: { status: 'idle', lastError: null, lastPushAt: null },
  }),
}));
vi.mock('@/src/hooks/useFkOptions', () => ({
  useClientCompanyOptions: () => ({ data: [{ value: 'cust-1', label: 'Acme Energy', sub: 'Client' }], isPending: false }),
  useInvoiceProjectOptions: () => ({ data: [{ value: 'proj-1', label: 'Alpha Platform', contractualName: 'Alpha Platform', sub: 'ALP-01', clientId: 'cust-1', subjectToVat: true, taxRate: 12, archived: false }], isPending: false, isError: false, refetch: vi.fn() }),
}));
vi.mock('@/src/hooks/useProjects', () => ({ useProjects: () => ({ data: [], isPending: false }) }));
vi.mock('@/src/hooks/useTasks', () => ({ useAssignableProfiles: () => ({ data: [], isPending: false }) }));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { id: 'u-fin', org_id: 'org-1' }, role: 'Finance' }) }));
vi.mock('@/src/lib/adapterSeam/ownershipCache', () => ({ routeDomainWrite: vi.fn(() => 'pmo') }));
vi.mock('@/src/hooks/useExternalDomainOwnership', () => ({ useExternalDomainOwnership: () => ({ data: [], isError: false }) }));
vi.mock('@/src/hooks/useOdooRevenue', () => ({ useOdooRevenueCommandsForInvoices: () => ({ data: h.commands }) }));
vi.mock('@/src/hooks/useOdooPurchase', () => ({ useOdooUnreachable: () => ({ unreachable: false }) }));
vi.mock('@/src/components/ui', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/src/components/ui')>();
  return { ...real, useToast: () => ({ toast: vi.fn() }) };
});

import SalesInvoices from '../SalesInvoices';
import { FinanceI18nTestProvider } from '@/test/financeI18nTestProvider';

const COUNT = 200;

function seed() {
  h.invoices.length = 0;
  h.payments.length = 0;
  h.commands.length = 0;
  reads.payment = 0;
  reads.command = 0;
  for (let i = 0; i < COUNT; i += 1) {
    h.invoices.push({
      id: `si-${i}`, org_id: 'org-1', project_id: 'proj-1', customer_id: 'cust-1', customer_name: `Client ${i % 40}`,
      si_number: `SI-${String(i).padStart(5, '0')}`, pmo_number: null, pmo_native: false, reference_number: `REF-${i}`,
      invoice_date: '2026-09-01', amount: 1_000_000 + i, currency: 'IDR', tax_treatment: 'exclusive', tax_amount: 110_000,
      tax_rate: 12, tax_base_numerator: 11, tax_base_denominator: 12, erp_outstanding_amount: 500_000,
      status: 'Submitted', erp_docstatus: 1, erp_modified: '2026-09-02 10:00:00',
      erp_amended_from: null, erp_cancelled_at: null, created_at: '2026-09-01T00:00:00Z', author_user_id: 'u-a',
      author_user_ids: ['u-a'], native_lines: null, erp_payment_terms_days: 30, erp_due_date: null, received_date: null,
    } as unknown as SalesInvoiceRow);
    const payment: Record<string, unknown> = {
      id: `ip-${i}`, org_id: 'org-1', customer_id: 'cust-1', customer_name: 'Acme Energy',
      sales_invoice_id: `si-${i}`, ip_number: `IP-${i}`, reference_number: null, date: '2026-09-10',
      amount: 250_000, currency: 'IDR', status: 'Paid', erp_docstatus: 1, erp_modified: null, erp_amended_from: null,
      erp_cancelled_at: null, created_at: '2026-09-10T00:00:00Z', pmo_native: true,
      allocation_details: [{ invoice_id: `si-${i}`, allocated_amount: 250_000 }],
      push_command_state: 'committed', push_command_created_at: '2026-09-10T00:00:00Z',
      push_command_external_record_id: null, push_command_matched_payment_refs: null,
    };
    const invoicePointer = payment.sales_invoice_id;
    Object.defineProperty(payment, 'sales_invoice_id', { get: () => { reads.payment += 1; return invoicePointer; }, enumerable: true });
    h.payments.push(payment as unknown as IncomingPaymentRow);
    const command: Record<string, unknown> = { kind: 'sales-invoice', recordId: `si-${i}`, state: 'committed', updatedAt: '2026-09-10T00:00:00Z', lastError: null };
    const recordId = command.recordId;
    Object.defineProperty(command, 'recordId', { get: () => { reads.command += 1; return recordId; }, enumerable: true });
    h.commands.push(command as never);
  }
}

const renderPage = () => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <FinanceI18nTestProvider>
      <ImpersonationProvider realRole="Finance">
        <MemoryRouter initialEntries={['/sales-invoices']}>
          <ToastProvider>
            <Routes>
              <Route path="/sales-invoices" element={<SalesInvoices />} />
            </Routes>
          </ToastProvider>
        </MemoryRouter>
      </ImpersonationProvider>
    </FinanceI18nTestProvider>
  </QueryClientProvider>,
);

beforeEach(seed);

describe('#2103 receivables row status does not scan every payment per invoice', () => {
  it('builds the payment and command indexes once per read, not per row', () => {
    renderPage();
    // At most one pass per render over each read — never COUNT × COUNT (40,000 here, ~418k on 500 rows).
    expect(reads.payment).toBeLessThanOrEqual(COUNT * 2);
    expect(reads.command).toBeLessThanOrEqual(COUNT * 2);
  });

  it('a keystroke re-renders rows without touching any payment or command', () => {
    renderPage();
    reads.payment = 0;
    reads.command = 0;
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search sales invoices' }), { target: { value: 'i' } });
    expect(reads.payment).toBeLessThan(COUNT);
    expect(reads.command).toBeLessThan(COUNT);
  });

  it('still shows a receipt awaiting the ERP, matched through the payment index', () => {
    renderPage();
    // Every seeded invoice has a committed receipt the invoice read has not caught up with.
    expect(screen.getAllByText('Receipt sent, awaiting Odoo').length).toBe(COUNT);
  });
});

import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { SalesInvoiceRow } from '@/src/lib/db/revenue';
import { FinanceI18nTestProvider } from '@/test/financeI18nTestProvider';

const h = vi.hoisted(() => ({
  getEvidence: vi.fn(),
  projectOptions: [{
    value: 'project-1', label: 'Northwind Build', contractualName: 'Northwind Build',
    sub: 'NW-1', clientId: 'customer-1', subjectToVat: false, taxRate: null,
    archived: false, customerContractRef: null,
  }],
}));

vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { id: 'user-1', org_id: 'org-1' } }) }));
vi.mock('@/src/lib/repositories/invoiceEvidence', () => ({ getSalesInvoiceEvidence: h.getEvidence }));
vi.mock('@/src/hooks/useRevenue', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/src/hooks/useRevenue')>();
  return {
    ...actual,
    useIncomingPayments: () => ({ data: [], isPending: false, isError: false }),
  };
});
vi.mock('@/src/hooks/useFkOptions', () => ({
  useInvoiceProjectOptions: () => ({ data: h.projectOptions }),
}));
vi.mock('@/src/hooks/useTasks', () => ({ useAssignableProfiles: () => ({ data: [{ id: 'author-1', full_name: 'Rina Author' }] }) }));
vi.mock('@/src/hooks/useOdooRevenue', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/src/hooks/useOdooRevenue')>()),
  useOdooRevenueCommands: () => ({ data: [] }),
  useOdooRevenueCreditNotes: () => ({ data: [] }),
}));
vi.mock('@/src/hooks/useOdooPurchase', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/src/hooks/useOdooPurchase')>()),
  useOdooUnreachable: () => ({ unreachable: false, lastOkAt: null }),
}));
vi.mock('@/src/components/fx/FxEquivalent', () => ({ default: () => null }));

import { SalesInvoiceDetail } from './SalesInvoiceDetail';
import { SalesInvoiceApprovalPreview } from '@/pages/approvals/SalesInvoiceApprovalRow';

const invoice = (over: Partial<SalesInvoiceRow> = {}): SalesInvoiceRow => ({
  id: 'invoice-1', org_id: 'org-1', project_id: 'project-1', erp_project: null,
  billing_kind: 'contract', customer_id: 'customer-1', customer_name: 'Acme Co',
  si_number: 'SI-2026-0001', pmo_number: 'PMO-2026-0001', pmo_native: false,
  reference_number: 'PO-77', invoice_date: '2026-10-01', amount: 1_110_000,
  currency: 'IDR', tax_treatment: 'inclusive', tax_amount: 110_000,
  erp_outstanding_amount: 1_110_000, status: 'Unpaid', erp_docstatus: 1,
  erp_modified: null, erp_amended_from: null, erp_cancelled_at: null,
  created_at: '2026-10-01T00:00:00Z', author_user_id: 'author-1', author_user_ids: ['author-1'],
  erp_payment_terms_days: 30, erp_due_date: null, received_date: null,
  efaktur_number: null, efaktur_date: null, native_lines: null,
  ...over,
});

function renderDetail(target = invoice()) {
  return render(
    <FinanceI18nTestProvider>
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter>
          <SalesInvoiceDetail
            viewTarget={target}
            isPending={false}
            isError={false}
            data={[target]}
            mode="erp"
            organizationToday="2026-10-16"
            onBack={vi.fn()}
            refetch={vi.fn()}
            recordPrimaryAction={null}
            invoiceDisplayLabel={() => 'SI-2026-0001'}
            may={(() => false) as never}
            pdfDownload={{ download: vi.fn(), inFlightIds: new Set<string>() } as never}
            dialogs={null}
          />
        </MemoryRouter>
      </QueryClientProvider>
    </FinanceI18nTestProvider>,
  );
}

describe('SalesInvoiceDetail invoice evidence', () => {
  beforeEach(() => {
    h.getEvidence.mockReset().mockResolvedValue({ lines: [{ item_code: 'SVC', description: 'Site survey', qty: 1, rate: 1_110_000, amount: 1_110_000 }] });
    h.projectOptions = [{
      value: 'project-1', label: 'Northwind Build', contractualName: 'Northwind Build',
      sub: 'NW-1', clientId: 'customer-1', subjectToVat: false, taxRate: null,
      archived: false, customerContractRef: null,
    }];
  });

  afterEach(cleanup);

  it('hides tax and total while invoice-line evidence is unavailable, then retries the same read', async () => {
    h.getEvidence.mockReset()
      .mockRejectedValueOnce(new Error('evidence unavailable'))
      .mockResolvedValueOnce({ lines: [{ item_code: 'SVC', description: 'Site survey', qty: 1, rate: 1_110_000, amount: 1_110_000 }] });
    const user = userEvent.setup();
    renderDetail();

    expect(await screen.findByRole('button', { name: 'Retry invoice evidence' })).toBeInTheDocument();
    expect(screen.getByText('Net (before tax)')).toBeInTheDocument();
    expect(screen.queryByText('Tax')).not.toBeInTheDocument();
    expect(screen.queryByText('Total due')).not.toBeInTheDocument();
    expect(h.getEvidence).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole('button', { name: 'Retry invoice evidence' }));

    expect(await screen.findByText('Total due')).toBeInTheDocument();
    await waitFor(() => expect(h.getEvidence).toHaveBeenCalledTimes(2));
  });

  it('shares one evidence request between the record and its evidence section on a normal load', async () => {
    renderDetail();

    expect(await screen.findByText('Tax')).toBeInTheDocument();
    await waitFor(() => expect(h.getEvidence).toHaveBeenCalledTimes(1));
  });

  it('keeps the approvals preview facts and rows unchanged when called without record-only props', () => {
    const nativeInvoice = invoice({
      id: 'native-1', pmo_native: true, erp_docstatus: null, invoice_date: null,
      native_lines: [{ item_code: 'SVC', description: 'Site survey', qty: 2, rate: 500_000, amount: 1_000_000 }],
    });
    render(
      <FinanceI18nTestProvider>
        <MemoryRouter>
          <SalesInvoiceApprovalPreview inv={nativeInvoice} />
        </MemoryRouter>
      </FinanceI18nTestProvider>,
    );

    expect(screen.getByText('Project')).toBeInTheDocument();
    expect(screen.getByText('Customer PO')).toBeInTheDocument();
    expect(screen.getByText('Raised by')).toBeInTheDocument();
    expect(screen.getByRole('list', { name: 'Line items' })).toHaveTextContent('Site survey');
    expect(screen.getByText('Net (before tax)')).toBeInTheDocument();
    expect(screen.getByText('Tax')).toBeInTheDocument();
    expect(screen.getByText('Total due')).toBeInTheDocument();
  });
});

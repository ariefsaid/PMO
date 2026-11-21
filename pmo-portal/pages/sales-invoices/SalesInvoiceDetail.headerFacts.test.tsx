import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import type { SalesInvoiceRow } from '@/src/lib/db/revenue';
import { FinanceI18nTestProvider } from '@/test/financeI18nTestProvider';
import { financeTestI18n } from '@/test/financeI18nTestInstance';

const orderState = vi.hoisted(() => ({ visible: true, payments: [] as unknown[] }));
vi.mock('@/src/hooks/useWorkOrderRecord', () => ({ useWorkOrder: () => ({ data: orderState.visible ? { id: 'wo1', wo_number: 'WO-1', title: 'Install' } : null }) }));
vi.mock('./SalesInvoiceEvidence', () => ({ SalesInvoiceEvidenceWithPayments: () => null }));
vi.mock('@/src/hooks/useRevenue', () => ({
  useSalesInvoiceEvidence: () => ({ data: { lines: [] }, isPending: false, isError: false, refetch: vi.fn() }),
  useIncomingPayments: () => ({ data: orderState.payments, isPending: false, isError: false }),
}));
vi.mock('@/src/hooks/useFkOptions', () => ({
  useInvoiceProjectOptions: () => ({ data: [{ value: 'project-1', label: 'Northwind Build', contractualName: 'Northwind Build' }] }),
}));
vi.mock('@/src/hooks/useTasks', () => ({ useAssignableProfiles: () => ({ data: [] }) }));
vi.mock('@/src/components/fx/FxEquivalent', () => ({ default: () => null }));

import { SalesInvoiceDetail } from './SalesInvoiceDetail';

const target: SalesInvoiceRow = {
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
};

afterEach(async () => {
  cleanup();
  orderState.visible = true;
  orderState.payments = [];
  await financeTestI18n.changeLanguage('en');
});

it('links the project in header facts and keeps Project and Invoice date facts once', () => {
  render(
    <FinanceI18nTestProvider>
      <MemoryRouter>
        <SalesInvoiceDetail
          viewTarget={target}
          projectName="Northwind Build"
          isPending={false}
          isError={false}
          data={[target]}
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
    </FinanceI18nTestProvider>,
  );

  const main = screen.getByRole('main');
  const header = screen.getByTestId('record-header');
  const projectLink = within(header).getByRole('link', { name: 'Open Northwind Build' });
  expect(projectLink).toHaveAttribute('href', '/projects/project-1');
  expect(within(main).getAllByText('Project')).toHaveLength(1);
  expect(within(main).getAllByText('Invoice date')).toHaveLength(1);
  expect(screen.getByText('Customer PO')).toBeInTheDocument();
});

it('keeps all four invoice lifecycle steps named in the timeline', () => {
  render(
    <FinanceI18nTestProvider>
      <MemoryRouter>
        <SalesInvoiceDetail
          viewTarget={target}
          projectName="Northwind Build"
          isPending={false}
          isError={false}
          data={[target]}
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
    </FinanceI18nTestProvider>,
  );

  const timeline = screen.getByRole('list', { name: 'Invoice status timeline' });
  expect(within(timeline).getAllByRole('listitem')).toHaveLength(4);
  expect(within(timeline).getByRole('listitem', { name: 'Draft: done' })).toBeInTheDocument();
  expect(within(timeline).getByRole('listitem', { name: 'Submitted: current' })).toBeInTheDocument();
  expect(within(timeline).getByRole('listitem', { name: 'Delivered to client: upcoming' })).toBeInTheDocument();
  expect(within(timeline).getByRole('listitem', { name: 'Paid: upcoming' })).toBeInTheDocument();
});

it('keeps the invoice number in one unbreakable text node in the record title', () => {
  const longNumberTarget = { ...target, si_number: 'DEMO-SI-2401-001' };
  render(
    <FinanceI18nTestProvider>
      <MemoryRouter>
        <SalesInvoiceDetail
          viewTarget={longNumberTarget}
          projectName="Northwind Build"
          isPending={false}
          isError={false}
          data={[longNumberTarget]}
          organizationToday="2026-10-16"
          onBack={vi.fn()}
          refetch={vi.fn()}
          recordPrimaryAction={null}
          invoiceDisplayLabel={() => 'DEMO-SI-2401-001'}
          may={(() => false) as never}
          pdfDownload={{ download: vi.fn(), inFlightIds: new Set<string>() } as never}
          dialogs={null}
        />
      </MemoryRouter>
    </FinanceI18nTestProvider>,
  );

  const heading = screen.getByRole('heading', { name: 'Invoice DEMO-SI-2401-001' });
  const invoiceNumber = within(heading).getByText('DEMO-SI-2401-001', { exact: true });
  expect(invoiceNumber.childNodes).toHaveLength(1);
  expect(invoiceNumber.firstChild?.nodeType).toBe(Node.TEXT_NODE);
  expect(invoiceNumber).toHaveStyle({ whiteSpace: 'nowrap' });
});

it('a paid invoice no longer prompts "Ready to send" — per the status rules a paid invoice is delivered (#2345 row 2)', () => {
  const paidTarget = { ...target, status: 'Paid' as const, erp_outstanding_amount: 0, received_date: null };
  render(
    <FinanceI18nTestProvider>
      <MemoryRouter>
        <SalesInvoiceDetail
          viewTarget={paidTarget}
          projectName="Northwind Build"
          isPending={false}
          isError={false}
          data={[paidTarget]}
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
    </FinanceI18nTestProvider>,
  );

  expect(screen.queryByText('Ready to send')).not.toBeInTheDocument();
  expect(screen.queryByText('Download the PDF and send it to your client yourself.')).not.toBeInTheDocument();
});

const mayDownload = ((action: string) => action === 'download_pdf') as never;

it('a paid invoice without a recorded receipt keeps the approved-PDF download while never claiming "Ready to send" (#2345 follow-up)', () => {
  const paidTarget = { ...target, status: 'Paid' as const, erp_outstanding_amount: 0, received_date: null };
  render(
    <FinanceI18nTestProvider>
      <MemoryRouter>
        <SalesInvoiceDetail
          viewTarget={paidTarget}
          projectName="Northwind Build"
          isPending={false}
          isError={false}
          data={[paidTarget]}
          organizationToday="2026-10-16"
          onBack={vi.fn()}
          refetch={vi.fn()}
          recordPrimaryAction={null}
          invoiceDisplayLabel={() => 'SI-2026-0001'}
          may={mayDownload}
          pdfDownload={{ download: vi.fn(), inFlightIds: new Set<string>() } as never}
          dialogs={null}
        />
      </MemoryRouter>
    </FinanceI18nTestProvider>,
  );

  expect(screen.queryByText('Ready to send')).not.toBeInTheDocument();
  expect(screen.queryByText('Download the PDF and send it to your client yourself.')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Download approved PDF' })).toBeInTheDocument();
});

it('an unpaid invoice keeps the "Ready to send" prompt with its handoff download (#2345 follow-up baseline)', () => {
  render(
    <FinanceI18nTestProvider>
      <MemoryRouter>
        <SalesInvoiceDetail
          viewTarget={target}
          projectName="Northwind Build"
          isPending={false}
          isError={false}
          data={[target]}
          organizationToday="2026-10-16"
          onBack={vi.fn()}
          refetch={vi.fn()}
          recordPrimaryAction={null}
          invoiceDisplayLabel={() => 'SI-2026-0001'}
          may={mayDownload}
          pdfDownload={{ download: vi.fn(), inFlightIds: new Set<string>() } as never}
          dialogs={null}
        />
      </MemoryRouter>
    </FinanceI18nTestProvider>,
  );

  expect(screen.getByText('Ready to send')).toBeInTheDocument();
  expect(screen.getByText('Download the PDF and send it to your client yourself.')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Download approved PDF' })).toBeInTheDocument();
});

it('AC-WORP-004 opens the readable work order named by an invoice', () => {
  render(<FinanceI18nTestProvider><MemoryRouter><SalesInvoiceDetail viewTarget={{ ...target, work_order_id: 'wo1' }} projectName="Northwind" isPending={false} isError={false} data={[target]} organizationToday="2026-10-16" onBack={vi.fn()} refetch={vi.fn()} recordPrimaryAction={null} invoiceDisplayLabel={() => 'INV'} may={(() => false) as never} pdfDownload={{ download: vi.fn(), inFlightIds: new Set<string>() } as never} dialogs={null} /></MemoryRouter></FinanceI18nTestProvider>);
  expect(screen.getByRole('link', { name: 'WO-1' })).toHaveAttribute('href', '/work-orders/wo1');
});

it('does not expose an unreadable work order on the invoice', () => {
  orderState.visible = false;
  render(<FinanceI18nTestProvider><MemoryRouter><SalesInvoiceDetail viewTarget={{ ...target, work_order_id: 'wo1' }} projectName="Northwind" isPending={false} isError={false} data={[target]} organizationToday="2026-10-16" onBack={vi.fn()} refetch={vi.fn()} recordPrimaryAction={null} invoiceDisplayLabel={() => 'INV'} may={(() => false) as never} pdfDownload={{ download: vi.fn(), inFlightIds: new Set<string>() } as never} dialogs={null} /></MemoryRouter></FinanceI18nTestProvider>);
  expect(screen.queryByRole('link', { name: 'WO-1' })).not.toBeInTheDocument();
});

describe('#2442 paid sales invoice wording', () => {
  const renderInvoice = (invoice: SalesInvoiceRow) => render(<FinanceI18nTestProvider><MemoryRouter>
    <SalesInvoiceDetail viewTarget={invoice} projectName="Northwind Build" isPending={false} isError={false}
      data={[invoice]} organizationToday="2026-10-16" onBack={vi.fn()} refetch={vi.fn()} recordPrimaryAction={null}
      invoiceDisplayLabel={() => 'SI-2026-0001'} may={mayDownload}
      pdfDownload={{ download: vi.fn(), inFlightIds: new Set<string>() } as never} dialogs={null} />
  </MemoryRouter></FinanceI18nTestProvider>);

  it('shows a native receipt date and known paid amount from a live allocation', () => {
    orderState.payments = [{ id: 'receipt-1', pmo_native: true, status: 'Paid', date: '2026-10-20', cancelled_at: null, erp_cancelled_at: null,
      allocations: [{ id: 'alloc-1', sales_invoice_id: 'invoice-1', amount: 1110000, cash_amount: 1110000, withheld_amount: 0, currency: 'IDR' }] }];
    renderInvoice({ ...target, pmo_native: true, status: 'Paid', erp_outstanding_amount: 0, received_date: '2026-10-15' });
    const header = screen.getByTestId('record-header');
    expect(within(header).getByText('20 Oct 2026')).toBeInTheDocument();
    expect(within(header).getByText('Amount paid')).toBeInTheDocument();
    expect(within(screen.getByTestId('invoice-delivery-note')).queryByText('Paid', { exact: true })).not.toBeInTheDocument();
    expect(screen.getByTestId('invoice-delivery-note')).toHaveTextContent(/1,110,000.*20 Oct 2026/);
    expect(within(header).queryByText('Ready to send')).not.toBeInTheDocument();
  });

  it.each([
    { pmo_native: false, amount: 1110000, erp_outstanding_amount: 0 },
    { pmo_native: true, amount: null, erp_outstanding_amount: 0 },
    { pmo_native: true, amount: 1110000, erp_outstanding_amount: null },
  ])('does not fabricate a payment amount or date from invoice facts %#', (facts) => {
    renderInvoice({ ...target, ...facts, status: 'Paid', received_date: '2026-10-15' });
    const header = screen.getByTestId('record-header');
    expect(within(header).getByText('Payment date not recorded')).toBeInTheDocument();
    expect(within(header).getByText('Amount not available')).toBeInTheDocument();
    expect(screen.getByTestId('invoice-delivery-note')).not.toHaveTextContent(/15 Oct 2026|1 Oct 2026|1,110,000|IDR\s*0/);
    expect(within(header).queryByText('Ready to send')).not.toBeInTheDocument();
  });

  it('does not choose between multiple receipt dates', () => {
    const allocation = { id: 'alloc', sales_invoice_id: 'invoice-1', amount: 555000, cash_amount: 555000, withheld_amount: 0, currency: 'IDR' };
    orderState.payments = ['2026-10-20', '2026-10-21'].map((date, index) => ({ id: String(index), pmo_native: true, status: 'Paid', date, cancelled_at: null, erp_cancelled_at: null, allocations: [allocation] }));
    renderInvoice({ ...target, pmo_native: true, status: 'Paid', erp_outstanding_amount: 0 });
    expect(within(screen.getByTestId('record-header')).getByText('Payment date not recorded')).toBeInTheDocument();
  });

  it('does not present a receipt date as the settlement date when the allocation covers only part', () => {
    orderState.payments = [{ id: 'receipt-1', pmo_native: true, status: 'Paid', date: '2026-10-20', cancelled_at: null, erp_cancelled_at: null,
      allocations: [{ id: 'alloc-1', sales_invoice_id: 'invoice-1', amount: 100, cash_amount: 100, withheld_amount: 0, currency: 'IDR' }] }];
    renderInvoice({ ...target, pmo_native: true, status: 'Paid', erp_outstanding_amount: 0 });
    expect(within(screen.getByTestId('record-header')).getByText('Payment date not recorded')).toBeInTheDocument();
  });

  it('shows the unavailable facts in Bahasa', async () => {
    await financeTestI18n.changeLanguage('id');
    renderInvoice({ ...target, status: 'Paid', erp_outstanding_amount: 0, received_date: '2026-10-15' });
    const header = screen.getByTestId('record-header');
    expect(within(header).getByText('Tanggal pembayaran belum dicatat')).toBeInTheDocument();
    expect(within(header).getByText('Jumlah tidak tersedia')).toBeInTheDocument();
    expect(within(header).queryByText('Siap dikirim')).not.toBeInTheDocument();
  });

  it('keeps the Paid status when a receipt is awaiting ERP confirmation', () => {
    const paid = { ...target, status: 'Paid' as const, erp_outstanding_amount: 0 };
    render(<FinanceI18nTestProvider><MemoryRouter><SalesInvoiceDetail viewTarget={paid} isPending={false} isError={false}
      data={[paid]} organizationToday="2026-10-16" onBack={vi.fn()} refetch={vi.fn()} recordPrimaryAction={null}
      invoiceDisplayLabel={() => 'INV'} may={mayDownload} pdfDownload={{ download: vi.fn(), inFlightIds: new Set<string>() } as never}
      receiptAwaitingOdoo dialogs={null} /></MemoryRouter></FinanceI18nTestProvider>);
    expect(within(screen.getByTestId('record-header')).queryByText('Receipt sent, awaiting Odoo')).not.toBeInTheDocument();
  });

  it('keeps partly paid invoices in the unpaid state', () => {
    renderInvoice({ ...target, pmo_native: true, status: 'Unpaid', erp_outstanding_amount: 500000 });
    const header = screen.getByTestId('record-header');
    expect(within(header).getByText('Partly paid')).toBeInTheDocument();
    expect(within(header).getByText('Due date')).toBeInTheDocument();
    expect(within(header).queryByText('Paid date')).not.toBeInTheDocument();
  });

  it('shows due date, outstanding, and send prompt for an unpaid invoice in English and Bahasa', async () => {
    await financeTestI18n.changeLanguage('en');
    const { unmount } = render(
      <FinanceI18nTestProvider>
        <MemoryRouter>
          <SalesInvoiceDetail
            viewTarget={target}
            projectName="Northwind Build"
            isPending={false}
            isError={false}
            data={[target]}
            organizationToday="2026-10-16"
            onBack={vi.fn()}
            refetch={vi.fn()}
            recordPrimaryAction={null}
            invoiceDisplayLabel={() => 'SI-2026-0001'}
            may={mayDownload}
            pdfDownload={{ download: vi.fn(), inFlightIds: new Set<string>() } as never}
            dialogs={null}
          />
        </MemoryRouter>
      </FinanceI18nTestProvider>,
    );

    const header = screen.getByTestId('record-header');
    expect(within(header).getByText('Due date')).toBeInTheDocument();
    expect(within(header).getByText('Outstanding')).toBeInTheDocument();
    expect(within(header).queryByText('Paid date')).not.toBeInTheDocument();
    expect(screen.getByText('Ready to send')).toBeInTheDocument();
    unmount();

    await financeTestI18n.changeLanguage('id');
    render(
      <FinanceI18nTestProvider>
        <MemoryRouter>
          <SalesInvoiceDetail
            viewTarget={target}
            projectName="Northwind Build"
            isPending={false}
            isError={false}
            data={[target]}
            organizationToday="2026-10-16"
            onBack={vi.fn()}
            refetch={vi.fn()}
            recordPrimaryAction={null}
            invoiceDisplayLabel={() => 'SI-2026-0001'}
            may={mayDownload}
            pdfDownload={{ download: vi.fn(), inFlightIds: new Set<string>() } as never}
            dialogs={null}
          />
        </MemoryRouter>
      </FinanceI18nTestProvider>,
    );

    const idHeader = screen.getByTestId('record-header');
    expect(within(idHeader).getByText('Tanggal jatuh tempo')).toBeInTheDocument();
    expect(within(idHeader).getAllByText('Belum dibayar').length).toBeGreaterThanOrEqual(1);
    expect(within(idHeader).queryByText('Tanggal dibayar')).not.toBeInTheDocument();
    expect(screen.getByText('Siap dikirim')).toBeInTheDocument();
  });
});


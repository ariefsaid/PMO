import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import type { SalesInvoiceRow } from '@/src/lib/db/revenue';
import { FinanceI18nTestProvider } from '@/test/financeI18nTestProvider';
import { financeTestI18n } from '@/test/financeI18nTestInstance';

const orderState = vi.hoisted(() => ({ visible: true }));
vi.mock('@/src/hooks/useWorkOrderRecord', () => ({ useWorkOrder: () => ({ data: orderState.visible ? { id: 'wo1', wo_number: 'WO-1', title: 'Install' } : null }) }));
vi.mock('./SalesInvoiceEvidence', () => ({ SalesInvoiceEvidenceSection: () => null }));
vi.mock('@/src/hooks/useRevenue', () => ({
  useSalesInvoiceEvidence: () => ({ data: { lines: [] }, isPending: false, isError: false, refetch: vi.fn() }),
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
  it('shows paid wording, paid amount and paid date in English, with no due date or outstanding or send prompt', async () => {
    await financeTestI18n.changeLanguage('en');
    const paidTarget: SalesInvoiceRow = {
      ...target,
      status: 'Paid',
      erp_outstanding_amount: 0,
      received_date: '2026-10-15',
    };
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

    const header = screen.getByTestId('record-header');
    expect(within(header).getByText('Paid date')).toBeInTheDocument();
    expect(within(header).getByText('15 Oct 2026')).toBeInTheDocument();
    expect(within(header).queryByText('Due date')).not.toBeInTheDocument();
    expect(within(header).queryByText('Outstanding')).not.toBeInTheDocument();
    expect(within(header).queryByText('Ready to send')).not.toBeInTheDocument();
    expect(within(header).queryByText('Download the PDF and send it to your client yourself.')).not.toBeInTheDocument();

    const note = screen.getByTestId('invoice-delivery-note');
    expect(within(note).getByText('Paid')).toBeInTheDocument();
    expect(note).toHaveTextContent(/Paid.*1,110,000.*15 Oct 2026/);
  });

  it('shows paid wording, paid amount and paid date in Bahasa, with no due date or outstanding or send prompt', async () => {
    await financeTestI18n.changeLanguage('id');
    const paidTarget: SalesInvoiceRow = {
      ...target,
      status: 'Paid',
      erp_outstanding_amount: 0,
      received_date: '2026-10-15',
    };
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

    const header = screen.getByTestId('record-header');
    expect(within(header).getByText('Tanggal dibayar')).toBeInTheDocument();
    expect(within(header).queryByText('Tanggal jatuh tempo')).not.toBeInTheDocument();
    expect(within(header).queryByText('Belum dibayar')).not.toBeInTheDocument();
    expect(within(header).queryByText('Siap dikirim')).not.toBeInTheDocument();

    const note = screen.getByTestId('invoice-delivery-note');
    expect(within(note).getByText('Dibayar')).toBeInTheDocument();
    expect(note).toHaveTextContent(/Dibayar.*1,110,000.*pada 15 Oct 2026/);
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


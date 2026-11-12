import { describe, expect, it, vi } from 'vitest';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18next from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { ToastProvider } from '@/src/components/ui';
import type { ProcurementDetail } from '@/src/lib/db/procurementLifecycle';
import type { LedgerRow } from '@/src/lib/db/procurementLedger';
import { buildLedgerRows } from '@/src/lib/db/procurementLedger';
import type { ErpPurchaseRow } from '@/src/lib/repositories/erpPurchases';
import enProcurementRecord from '../../../public/locales/en/procurementRecord.json';
import idProcurementRecord from '../../../public/locales/id/procurementRecord.json';
import { ProcurementBudgetSignal, ProcurementMoneySummary, ProcurementStageTracker, ProcurementTimeline } from './ProcurementDetailPanels';

vi.mock('@/src/auth/usePermission', () => ({ usePermission: () => () => true }));
vi.mock('@/src/hooks/useBudget', () => ({ useProjectBudget: () => ({ data: 1000, isPending: false, isError: false }) }));
vi.mock('@/src/hooks/useProcurements', () => ({
  useProjectCommittedSpend: () => ({ data: 100, isPending: false, isError: false }),
  useProjectReservedSpend: () => ({ data: 200, projectCurrency: 'USD', budgetCurrency: 'USD', isPending: false, isError: false }),
}));
vi.mock('@/src/hooks/useProcurementFiles', () => ({
  useProcurementFiles: () => ({
    list: { data: [], isPending: false, isError: false },
    upload: { mutate: vi.fn(), isPending: false },
    archive: { mutate: vi.fn(), isPending: false },
    download: vi.fn(),
    progress: null,
    uploadError: null,
    cancelUpload: vi.fn(),
    clearUploadError: vi.fn(),
    uploadDisabled: false,
  }),
}));

const dayOffset = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

const procurement = {
  id: 'p-1', currency: 'USD', total_value: 62_000, created_at: '2026-09-01T00:00:00.000Z',
  requested_by: { full_name: 'Diego Salvatierra' }, statusEvents: [],
  purchase_requests: [], purchase_orders: [], invoices: [], payments: [],
} as unknown as ProcurementDetail;

const overdueInvoice: ErpPurchaseRow = {
  id: 'inv-1', doctype: 'Purchase Invoice', name: 'ACC-PINV-1', supplier: 'SunVolt Modules Co.', docDate: dayOffset(-40),
  dueDate: dayOffset(-13), billNo: 'INV-88213', currency: 'USD', grandTotal: 62_000, netTotal: 62_000, outstanding: 62_000,
  erpStatus: 'Overdue', isReturn: false, projectIds: [], procurementId: 'p-1', linkId: 'l-1',
};

describe('procurement record panels', () => {
  it('L6 + C6: overdue is said once, and record figures show their currency', () => {
    render(
      <>
        <ProcurementMoneySummary procurement={procurement} linkedDocuments={[overdueInvoice]} isEngineer={false} budgetSignal={null} />
        <ProcurementTimeline procurement={procurement} ledgerRows={[]} linkedDocuments={[overdueInvoice]} isEngineer={false} canWriteFiles={false} uploadedById={null} onFullHistory={vi.fn()} />
      </>,
    );

    const money = screen.getByTestId('procurement-money-summary');
    expect(within(money).getByText(/Money · USD, before tax/)).toBeInTheDocument();
    expect(within(money).getByText(/Overdue 13 days/)).toBeInTheDocument();
    expect(within(money).getAllByText('$62,000').length).toBeGreaterThan(0);

    const row = screen.getAllByTestId('procurement-timeline-row').find((item) => /Supplier invoice/.test(item.textContent ?? '')) as HTMLElement;
    const summary = row.querySelector('summary') as HTMLElement;
    // Date and amount are the glance; the money card owns "overdue", so the row summary does not restate it.
    expect(summary).toHaveTextContent('$62,000');
    expect(summary).toHaveTextContent('Supplier invoice');
    expect(summary).not.toHaveTextContent(/Overdue|Due/);
  });

  it('shows a recorded procurement total when its request amount is missing', () => {
    const missingRequestAmount = {
      ...procurement,
      total_value: 3400,
      purchase_requests: [{ amount: null }],
    } as unknown as ProcurementDetail;
    render(<ProcurementMoneySummary procurement={missingRequestAmount} linkedDocuments={[]} isEngineer={false} budgetSignal={null} />);

    const money = screen.getByTestId('procurement-money-summary');
    expect(within(money).getByText('$3,400')).toBeInTheDocument();
    expect(money).not.toHaveTextContent('amount not recorded');
  });

  it('P5: the timeline note and the Full history link are both reachable and the link still works', async () => {
    const onFullHistory = vi.fn();
    render(<ProcurementTimeline procurement={procurement} ledgerRows={[]} linkedDocuments={[]} isEngineer={false} canWriteFiles={false} uploadedById={null} onFullHistory={onFullHistory} />);

    await userEvent.click(screen.getByRole('button', { name: 'Full history' }));
    expect(onFullHistory).toHaveBeenCalledTimes(1);
  });

  it('merges a document transition into its record row while retaining non-document transitions', () => {
    const detail = {
      ...procurement,
      status: 'Ordered',
      statusEvents: [
        {
          id: 'ordered-event', procurement_id: 'p-1', from_status: 'Quote Selected', to_status: 'Ordered',
          actor_id: 'buyer-1', notes: 'PO-112 placed with the supplier.', created_at: '2026-09-08T10:00:00.000Z',
          actor: { full_name: 'Procurement buyer' },
        },
        {
          id: 'approved-event', procurement_id: 'p-1', from_status: 'Requested', to_status: 'Approved',
          actor_id: 'approver-1', notes: 'Within the approved budget.', created_at: '2026-09-07T10:00:00.000Z',
          actor: { full_name: 'Procurement reviewer' },
        },
      ],
      purchase_orders: [{
        id: 'po-1', procurement_id: 'p-1', org_id: 'org-1', po_number: 'PO-112', reference_number: 'EXT-112',
        status: 'Issued', date: '2026-09-08', created_at: '2026-09-08T10:00:00.000Z', amount: 500, currency: 'USD',
      }],
    } as unknown as ProcurementDetail;
    const ledgerRows = buildLedgerRows(detail);
    render(
      <ToastProvider>
        <ProcurementTimeline
          procurement={detail}
          ledgerRows={ledgerRows}
          linkedDocuments={[]}
          isEngineer={false}
          canWriteFiles={false}
          uploadedById={null}
          onFullHistory={vi.fn()}
        />
      </ToastProvider>,
    );

    const timeline = screen.getByTestId('procurement-timeline');
    const rows = within(timeline).getAllByTestId('procurement-timeline-row');
    expect(rows).toHaveLength(3); // Raised + merged order + separate approval.

    const orderRow = rows.find((row) => row.textContent?.includes('PO-112')) as HTMLElement;
    expect(orderRow).toHaveTextContent('Purchase order');
    expect(orderRow).toHaveTextContent('Ordered');
    expect(orderRow).toHaveTextContent('Issued');
    expect(orderRow).toHaveTextContent('Procurement buyer');
    expect(orderRow).toHaveTextContent('PO-112 placed with the supplier.');
    expect(orderRow).toHaveTextContent('$500');
    expect(rows.some((row) => /Approved/.test(row.textContent ?? '') && !row.textContent?.includes('PO-112'))).toBe(true);
  });

  it('shows a matched transition once when it agrees with the document status', () => {
    const detail = {
      ...procurement,
      status: 'Ordered',
      statusEvents: [{
        id: 'ordered-event', procurement_id: 'p-1', from_status: 'Quote Selected', to_status: 'Ordered',
        actor_id: 'buyer-1', notes: null, created_at: '2026-09-08T10:00:00.000Z',
        actor: { full_name: 'Procurement buyer' },
      }],
      purchase_orders: [{
        id: 'po-1', procurement_id: 'p-1', org_id: 'org-1', po_number: 'PO-112', reference_number: 'EXT-112',
        status: 'Ordered', date: '2026-09-08', created_at: '2026-09-08T10:00:00.000Z', amount: 500, currency: 'USD',
      }],
    } as unknown as ProcurementDetail;
    render(
      <ToastProvider>
        <ProcurementTimeline procurement={detail} ledgerRows={buildLedgerRows(detail)} linkedDocuments={[]} isEngineer={false} canWriteFiles={false} uploadedById={null} onFullHistory={vi.fn()} />
      </ToastProvider>,
    );

    const orderRow = screen.getAllByTestId('procurement-timeline-row').find((row) => row.textContent?.includes('PO-112')) as HTMLElement;
    expect(within(orderRow).getAllByText('Ordered', { exact: true })).toHaveLength(1);
  });

  it('uses the locale catalogue plural forms for stage documents and attached files', async () => {
    const i18n = i18next.createInstance();
    await i18n.init({
      lng: 'en',
      fallbackLng: 'en',
      resources: {
        en: { procurementRecord: enProcurementRecord },
        id: { procurementRecord: idProcurementRecord },
      },
      ns: ['procurementRecord'],
      defaultNS: 'procurementRecord',
      interpolation: { escapeValue: false },
    });
    const detail = {
      ...procurement,
      status: 'Paid',
      purchase_requests: [{ id: 'request-1', amount: 100, date: '2026-09-02' }, { id: 'request-2', amount: 200, date: '2026-09-03' }],
      purchase_orders: [{ id: 'order-1', amount: 120, date: '2026-09-04' }, { id: 'order-2', amount: 130, date: '2026-09-05' }],
      receipts: [{ id: 'receipt-1', status: 'Partial', receipt_date: '2026-09-06' }],
      invoices: [
        { id: 'invoice-1', amount: 70, currency: 'USD', invoice_date: '2026-09-07', created_at: '2026-09-07T10:00:00Z' },
        { id: 'invoice-2', amount: 30, currency: 'USD', invoice_date: '2026-09-08', created_at: '2026-09-08T10:00:00Z' },
      ],
      payments: [{ id: 'payment-1', amount: 100, currency: 'USD', date: '2026-09-09', created_at: '2026-09-09T10:00:00Z' }],
    } as unknown as ProcurementDetail;
    const fileRow = {
      id: 'PR-pr-1', date: '2026-09-01', type: 'PR', systemNumber: 'PR-1', externalRef: null,
      amount: 100, status: 'Submitted', fileHref: 'request.pdf', fileTitle: 'request.pdf', fileCount: 1,
      financial: true, recordId: 'pr-1', currency: 'USD',
    } as LedgerRow;
    const secondFileRow = { ...fileRow, id: 'PR-pr-2', systemNumber: 'PR-2', recordId: 'pr-2', fileCount: 2 };

    render(
      <ToastProvider>
        <I18nextProvider i18n={i18n}>
          <ProcurementStageTracker procurement={detail} linkedDocuments={[]} />
          <ProcurementTimeline
            procurement={detail}
            ledgerRows={[fileRow, secondFileRow]}
            linkedDocuments={[]}
            isEngineer={false}
            canWriteFiles={false}
            uploadedById={null}
            onFullHistory={vi.fn()}
          />
        </I18nextProvider>
      </ToastProvider>,
    );

    const tracker = screen.getByTestId('procurement-stage-tracker');
    expect(within(tracker).getByText(/2 purchase requests/)).toBeInTheDocument();
    expect(within(tracker).getByText(/2 orders · \$250/)).toBeInTheDocument();
    expect(within(tracker).getByText(/1 of 2 orders received/)).toBeInTheDocument();
    expect(within(tracker).getByText(/2 invoices · 1 payment/)).toBeInTheDocument();
    expect(tracker).not.toHaveTextContent('$100 invoiced');

    const singleReceiptDetail = {
      ...detail,
      purchase_orders: [{ id: 'single-order', amount: 120, date: '2026-09-04' }],
      receipts: [{ id: 'single-receipt', status: 'Partial', receipt_date: '2026-09-06' }],
    } as unknown as ProcurementDetail;
    const singleReceiptView = render(
      <I18nextProvider i18n={i18n}>
        <ProcurementStageTracker procurement={singleReceiptDetail} linkedDocuments={[]} />
      </I18nextProvider>,
    );
    const singleTracker = singleReceiptView.container.querySelector('[data-testid="procurement-stage-tracker"]') as HTMLElement;
    expect(within(singleTracker).getByText(/1 of 1 order received/)).toBeInTheDocument();

    const timelineRows = screen.getAllByTestId('procurement-timeline-row');
    const oneFileRow = timelineRows.find((row) => row.textContent?.includes('PR-1')) as HTMLElement;
    const twoFilesRow = timelineRows.find((row) => row.textContent?.includes('PR-2')) as HTMLElement;
    expect(oneFileRow).toHaveTextContent('1 file');
    expect(twoFilesRow).toHaveTextContent('2 files');

    await act(async () => {
      await i18n.changeLanguage('id');
    });
    expect(await within(tracker).findByText(/2 permintaan pembelian/)).toBeInTheDocument();
    expect(within(tracker).getByText(/2 pesanan · \$250/)).toBeInTheDocument();
    expect(within(tracker).getByText(/1 dari 2 pesanan diterima/)).toBeInTheDocument();
    expect(await within(tracker).findByText(/2 faktur · 1 pembayaran/)).toBeInTheDocument();
    expect(tracker).not.toHaveTextContent('ditagih');
    expect(await within(singleTracker).findByText(/1 dari 1 pesanan diterima/)).toBeInTheDocument();
    expect(oneFileRow).toHaveTextContent('1 berkas');
    expect(twoFilesRow).toHaveTextContent('2 berkas');
  });
});


describe('procurement budget signal currency', () => {
  it('shows compatible project headroom', () => {
    render(<ProcurementBudgetSignal projectId="p-1" totalValue={50} status="Requested" currency="USD" />);
    expect(screen.getByText(/Budget not yet committed \$700/)).toBeInTheDocument();
  });
  it('does not compare a foreign request with project headroom', () => {
    render(<ProcurementBudgetSignal projectId="p-1" totalValue={50} status="Requested" currency="EUR" />);
    expect(screen.getByText(/comparison unavailable/i)).toBeInTheDocument();
  });
});

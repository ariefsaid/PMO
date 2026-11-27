import { describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ProcurementDetail } from '@/src/lib/db/procurementLifecycle';
import type { ErpPurchaseRow } from '@/src/lib/repositories/erpPurchases';
import { FigureScope } from '@/src/components/ui';
import { setHidePricesActive, setPricesHidden } from '@/src/lib/priceReadPath';
import { ProcurementBudgetSignal, ProcurementMoneySummary, ProcurementStageTracker, ProcurementTimeline } from './ProcurementDetailPanels';

vi.mock('../ProcurementFilesSubsection', () => ({ ProcurementFilesSubsection: () => null }));
vi.mock('@/src/hooks/useProcurementFilesBatch', () => ({ useProcurementFilesBatch: () => ({ data: undefined, isError: false }) }));

vi.mock('@/src/auth/usePermission', () => ({ usePermission: () => () => true }));
vi.mock('@/src/hooks/useBudget', () => ({ useProjectBudget: () => ({ data: 1000, isPending: false, isError: false }) }));
const positionsState = vi.hoisted(() => ({ spent: '0.00' as string | null }));
vi.mock('@/src/hooks/useProjectBudgetPositions', () => ({
  useProjectBudgetPositions: (ids: string[]) => ({
    data: Object.fromEntries(ids.map((id) => [id, { projectId: id, ledgerBasis: 'pmo', currency: 'USD', spent: positionsState.spent, openCommitment: '100.00' }])),
    isPending: false, isError: false,
  }),
}));
vi.mock('@/src/hooks/useProcurements', () => ({
  useProjectCommittedSpend: () => ({ data: 100, otherCurrencies: [], commitmentSource: 'pmo', ownershipPending: false, isPending: false, isError: false }),
  useProjectReservedSpend: () => ({ data: 200, projectCurrency: 'USD', budgetCurrency: 'USD', isPending: false, isError: false }),
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

beforeEach(() => { setHidePricesActive(false); setPricesHidden(false); });

describe('procurement record panels', () => {
  it.each([[1, 1], [1, 0], [0, 1]])('counts %i invoices and %i payments under their own labels', (invoices, payments) => {
    render(<ProcurementStageTracker procurement={{ ...procurement, status: 'Vendor Invoiced', receipts: [], invoices: Array.from({ length: invoices }, () => ({ amount: 100 })), payments: Array.from({ length: payments }, () => ({ amount: 100 })) } as unknown as ProcurementDetail} linkedDocuments={[]} />);
    const pay = screen.getByText('Pay').closest('li')!;
    if (invoices) expect(pay).toHaveTextContent('1 invoice');
    if (payments) expect(pay).toHaveTextContent('1 payment');
    expect(pay).not.toHaveTextContent('2 invoices');
  });
  it('a reader who cannot read payments sees the pay stage as paid from the purchase status, with no count or amount', () => {
    const paid = { ...procurement, status: 'Paid', receipts: [{ id: 'r1', status: 'Complete' }] } as unknown as ProcurementDetail;
    render(<ProcurementStageTracker procurement={paid} linkedDocuments={[]} isEngineer />);
    const pay = within(screen.getByTestId('procurement-stage-tracker')).getByText('Pay').closest('li')!;
    expect(pay).toHaveTextContent('Paid');
    expect(pay).not.toHaveTextContent(/payment|\d/);
  });

  it('PU14 one partial receipt against one order reads as partly received, never "1 of 1 orders received"', () => {
    const partlyReceived = {
      ...procurement, status: 'Ordered',
      purchase_orders: [{ amount: 100 }], receipts: [{ status: 'Partial', receipt_date: '2026-09-05' }],
    } as unknown as ProcurementDetail;
    render(<ProcurementStageTracker procurement={partlyReceived} linkedDocuments={[]} />);
    const tracker = screen.getByTestId('procurement-stage-tracker');
    expect(tracker).toHaveTextContent('Partly received');
    expect(tracker).not.toHaveTextContent(/1 of 1 orders received/);
  });

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

  it('links a named and readable work order from its cost record', () => {
    const row = { id: 'Invoice-bill', recordId: 'bill', type: 'Invoice', date: '2026-01-01', systemNumber: 'INV-1', amount: 25, currency: 'USD', status: 'Received', fileCount: 0 } as import('@/src/lib/db/procurementLedger').LedgerRow;
    render(<MemoryRouter><ProcurementTimeline procurement={procurement} ledgerRows={[row]} linkedDocuments={[]} isEngineer={false} canWriteFiles={false} uploadedById={null} onFullHistory={vi.fn()} focusedRecordId="bill" workOrderLinks={{ bill: { id: 'wo1', label: 'WO-1' } }} /></MemoryRouter>);
    expect(screen.getByRole('link', { name: 'WO-1' })).toHaveAttribute('href', '/work-orders/wo1');
  });
  it('opens the requested cost record on arrival from its work order', () => {
    const row = { id: 'Invoice-bill', recordId: 'bill', type: 'Invoice', date: '2026-01-01', systemNumber: 'INV-1', amount: 25, currency: 'USD', status: 'Received', fileCount: 0 } as import('@/src/lib/db/procurementLedger').LedgerRow;
    render(<ProcurementTimeline procurement={procurement} ledgerRows={[row]} linkedDocuments={[]} isEngineer={false} canWriteFiles={false} uploadedById={null} onFullHistory={vi.fn()} focusedRecordId="bill" />);
    expect(screen.getByText('INV-1').closest('details')).toHaveAttribute('open');
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

  it('a purchase that started at the order stage reports ONE hidden figure — the order — not the request (#2345 row 6)', async () => {
    const orderStarted = {
      ...procurement,
      total_value: null,
      purchase_orders: [{ amount: null }],
    } as unknown as ProcurementDetail;
    render(
      <FigureScope>
        <ProcurementMoneySummary procurement={orderStarted} linkedDocuments={[]} isEngineer={false} budgetSignal={null} />
      </FigureScope>,
    );

    // The order amount is genuinely unrecorded; a purchase with no request has no request figure to hide.
    // The record's one hidden-figures line sits in the Money block, under the figures it reports on.
    const line = within(screen.getByTestId('procurement-money-summary')).getByTestId('figures-hidden');
    expect(line).toHaveTextContent('1 figure hidden');
    await userEvent.click(within(line).getByRole('button', { name: 'Why' }));
    expect(await screen.findByText('purchase order amount not recorded')).toBeInTheDocument();
    expect(screen.queryByText(/purchase request/)).not.toBeInTheDocument();
  });

  it('a purchase with a request whose amount is missing still reports the request (#2345 row 6)', async () => {
    const requestOnly = {
      ...procurement,
      total_value: null,
      purchase_requests: [{ amount: null }],
    } as unknown as ProcurementDetail;
    render(
      <FigureScope>
        <ProcurementMoneySummary procurement={requestOnly} linkedDocuments={[]} isEngineer={false} budgetSignal={null} />
      </FigureScope>,
    );

    // The count is on the face; only the reason sits behind Why.
    const line = within(screen.getByTestId('procurement-money-summary')).getByTestId('figures-hidden');
    expect(line).toHaveTextContent('1 figure hidden');
    await userEvent.click(within(line).getByRole('button', { name: 'Why' }));
    expect(await screen.findByText('purchase request amount not recorded')).toBeInTheDocument();
  });

  it('P5: the timeline note and the Full history link are both reachable and the link still works', async () => {
    const onFullHistory = vi.fn();
    render(<ProcurementTimeline procurement={procurement} ledgerRows={[]} linkedDocuments={[]} isEngineer={false} canWriteFiles={false} uploadedById={null} onFullHistory={onFullHistory} />);

    await userEvent.click(screen.getByRole('button', { name: 'Full history' }));
    expect(onFullHistory).toHaveBeenCalledTimes(1);
  });
});


describe('procurement budget signal currency', () => {
  it('AC-RB-018: an ordered purchase is counted once: budget 1000, open orders 100 (include it), reserved 200, spent 0 → "Left in budget $700"', () => {
    positionsState.spent = '0.00';
    render(<ProcurementBudgetSignal projectId="p-1" totalValue={50} status="Ordered" currency="USD" />);
    expect(screen.getByText('Left in budget $700')).toBeInTheDocument();
  });
  it('recorded spending is subtracted too: spent 150 → $550', () => {
    positionsState.spent = '150.00';
    render(<ProcurementBudgetSignal projectId="p-1" totalValue={50} status="Ordered" currency="USD" />);
    expect(screen.getByText('Left in budget $550')).toBeInTheDocument();
  });
  it('spending not known → the amount without spending, in the panel\'s own wording, never under "Left in budget"', () => {
    positionsState.spent = null;
    render(<ProcurementBudgetSignal projectId="p-1" totalValue={50} status="Ordered" currency="USD" />);
    // budget 1000 − open orders 100 − reserved 200 = 700, the order already inside open orders
    expect(screen.getByText('Without spending: $700 left after orders, reserved and this purchase.')).toBeInTheDocument();
    expect(screen.queryByText(/left in budget/i)).toBeNull();
    expect(screen.queryByText(/not known/i)).toBeNull();
  });
  it('does not compare a foreign request with project headroom', () => {
    positionsState.spent = '0.00';
    render(<ProcurementBudgetSignal projectId="p-1" totalValue={50} status="Requested" currency="EUR" />);
    expect(screen.getByText(/comparison unavailable/i)).toBeInTheDocument();
  });
});

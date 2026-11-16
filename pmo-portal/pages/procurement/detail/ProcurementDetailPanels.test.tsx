import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ProcurementDetail } from '@/src/lib/db/procurementLifecycle';
import type { ErpPurchaseRow } from '@/src/lib/repositories/erpPurchases';
import { FigureHiddenLine, FigureScope } from '@/src/components/ui';
import { ProcurementBudgetSignal, ProcurementMoneySummary, ProcurementTimeline } from './ProcurementDetailPanels';

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

  it('a purchase that started at the order stage reports ONE hidden figure — the order — not the request (#2345 row 6)', () => {
    const orderStarted = {
      ...procurement,
      total_value: null,
      purchase_orders: [{ amount: null }],
    } as unknown as ProcurementDetail;
    render(
      <FigureScope>
        <ProcurementMoneySummary procurement={orderStarted} linkedDocuments={[]} isEngineer={false} budgetSignal={null} />
        <FigureHiddenLine />
      </FigureScope>,
    );

    // The order amount is genuinely unrecorded; a purchase with no request has no request figure to hide.
    const line = screen.getByTestId('figures-hidden');
    expect(line).toHaveTextContent('1 figure hidden');
    expect(line).toHaveTextContent('purchase order amount not recorded');
    expect(line).not.toHaveTextContent('purchase request');
  });

  it('a purchase with a request whose amount is missing still reports the request (#2345 row 6)', () => {
    const requestOnly = {
      ...procurement,
      total_value: null,
      purchase_requests: [{ amount: null }],
    } as unknown as ProcurementDetail;
    render(
      <FigureScope>
        <ProcurementMoneySummary procurement={requestOnly} linkedDocuments={[]} isEngineer={false} budgetSignal={null} />
        <FigureHiddenLine />
      </FigureScope>,
    );

    expect(screen.getByTestId('figures-hidden')).toHaveTextContent('purchase request amount not recorded');
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

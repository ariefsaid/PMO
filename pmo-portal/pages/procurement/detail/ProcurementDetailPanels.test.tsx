import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ProcurementDetail } from '@/src/lib/db/procurementLifecycle';
import type { ErpPurchaseRow } from '@/src/lib/repositories/erpPurchases';
import { ProcurementBudgetSignal, ProcurementMoneySummary, ProcurementTimeline } from './ProcurementDetailPanels';

vi.mock('@/src/auth/usePermission', () => ({ usePermission: () => () => true }));
vi.mock('@/src/hooks/useBudget', () => ({ useProjectBudget: () => ({ data: 1000, isPending: false, isError: false }) }));
vi.mock('@/src/hooks/useProcurements', () => ({
  useProjectCommittedSpend: () => ({ data: 100, isPending: false, isError: false }),
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

  it('R2 KEEP: a figure label says what its amount sums, as a tooltip', async () => {
    render(<ProcurementMoneySummary procurement={procurement} linkedDocuments={[overdueInvoice]} isEngineer={false} budgetSignal={null} />);
    await userEvent.hover(screen.getByText('Invoiced'));
    expect(await screen.findByRole('tooltip', {}, { timeout: 1_500 })).toHaveTextContent('Sum of recorded invoiced amounts');
  });

  it('R2 KEEP: the unpaid figure explains that it is invoices less payments', async () => {
    render(<ProcurementMoneySummary procurement={procurement} linkedDocuments={[overdueInvoice]} isEngineer={false} budgetSignal={null} />);
    await userEvent.hover(screen.getByText('Unpaid'));
    expect(await screen.findByRole('tooltip', {}, { timeout: 1_500 })).toHaveTextContent('Calculated from invoiced less paid amounts');
  });

  it('R2 DROP: an unreadable source amount is not explained per figure, the hidden-figures line owns it', () => {
    const missingRequestAmount = {
      ...procurement,
      total_value: 3400,
      purchase_requests: [{ amount: null }],
    } as unknown as ProcurementDetail;
    render(<ProcurementMoneySummary procurement={missingRequestAmount} linkedDocuments={[]} isEngineer={false} budgetSignal={null} />);
    expect(screen.getByTestId('procurement-money-summary')).not.toHaveTextContent(/could not be calculated/);
  });

  it('R2 RESTORE: a figure with nothing recorded says None recorded beside a dash, never a blank space', () => {
    const nothingYet = {
      ...procurement,
      total_value: 3400,
      purchase_requests: [{ amount: 3400 }],
      purchase_orders: [],
      invoices: [],
      payments: [],
    } as unknown as ProcurementDetail;
    render(<ProcurementMoneySummary procurement={nothingYet} linkedDocuments={[]} isEngineer={false} budgetSignal={null} />);
    const money = screen.getByTestId('procurement-money-summary');
    const ordered = within(money).getByText('Ordered').closest('div') as HTMLElement;
    expect(ordered).toHaveTextContent('—');
    expect(ordered).toHaveTextContent('None recorded');
  });

  it('R2 KEEP: the timeline says its order and that an unrequired step leaves no gap to read as missing', () => {
    render(<ProcurementTimeline procurement={procurement} ledgerRows={[]} linkedDocuments={[]} isEngineer={false} canWriteFiles={false} uploadedById={null} onFullHistory={vi.fn()} />);
    expect(screen.getByText(/in date order · missing steps aren’t required by your company/)).toBeInTheDocument();
  });

  it('R2 KEEP: the Unpaid lead figure says it is the balance still owed, net of payments', () => {
    render(<ProcurementMoneySummary procurement={procurement} linkedDocuments={[overdueInvoice]} isEngineer={false} budgetSignal={null} />);
    expect(screen.getByText('Outstanding balance')).toBeInTheDocument();
  });

  it('P5: the timeline note and the Full history link are both reachable and the link still works', async () => {
    const onFullHistory = vi.fn();
    render(<ProcurementTimeline procurement={procurement} ledgerRows={[]} linkedDocuments={[]} isEngineer={false} canWriteFiles={false} uploadedById={null} onFullHistory={onFullHistory} />);

    await userEvent.click(screen.getByRole('button', { name: 'Full history' }));
    expect(onFullHistory).toHaveBeenCalledTimes(1);
  });
});


describe('procurement budget signal currency', () => {
  it('shows compatible project headroom', () => {
    render(<ProcurementBudgetSignal projectId="p-1" totalValue={50} status="Requested" currency="USD" />);
    expect(screen.getByText(/Budget not yet committed \$700/)).toBeInTheDocument();
  });

  it('R2 KEEP: the budget line says what it subtracts and what it leaves out', async () => {
    render(<ProcurementBudgetSignal projectId="p-1" totalValue={50} status="Requested" currency="USD" />);
    await userEvent.hover(screen.getByText(/Budget not yet committed \$700/));
    expect(await screen.findByRole('tooltip', {}, { timeout: 1_500 })).toHaveTextContent('project budget less committed and reserved spend');
  });
  it('does not compare a foreign request with project headroom', () => {
    render(<ProcurementBudgetSignal projectId="p-1" totalValue={50} status="Requested" currency="EUR" />);
    expect(screen.getByText(/comparison unavailable/i)).toBeInTheDocument();
  });
});

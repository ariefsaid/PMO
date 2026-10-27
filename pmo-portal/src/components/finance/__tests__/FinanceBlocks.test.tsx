import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { MemoryRouter, useLocation } from 'react-router';
import type { FinancePosition } from '@/src/lib/finance/financePosition';
import { FinanceAttention } from '../FinanceAttention';
import { AgeingStrip } from '../AgeingStrip';
import { PayablesList } from '../PayablesList';

const withLayout = (path: string) => `${path}${path.includes('?') ? '&' : '?'}layout=c`;
vi.mock('@/src/hooks/useOrgCurrency', () => ({ useOrgCurrencyState: () => ({ currency: 'IDR', isResolved: true, isError: false }) }));

function CurrentLocation() {
  const location = useLocation();
  return <output aria-label="Current location">{`${location.pathname}${location.search}`}</output>;
}

const emptyPosition: FinancePosition = {
  receivablesCount: 0,
  overdue: [], overdueTotals: {}, overdueUnknownCount: 0,
  drafts: { canApprove: [], awaitingOther: [], all: [] }, toSend: [],
  unappliedPayments: [], unappliedTotals: {}, payables: [], payablesTotals: {},
  receivablesAgeing: {}, payablesAgeing: {},
};

describe('Finance blocks', () => {
  it('shows one quiet empty line when nothing is overdue or waiting', () => {
    render(
      <MemoryRouter>
        <FinanceAttention position={emptyPosition} scope="receivables" canAct isPending={false} isError={false} onRetry={() => {}} withLayout={withLayout} />
      </MemoryRouter>,
    );
    expect(screen.getByText('Nothing overdue or waiting.')).toBeInTheDocument();
  });

  it('shows ageing buckets per currency without combining their values', () => {
    render(
      <AgeingStrip
        kind="receivables"
        values={{
          IDR: { notDue: 20_000, d1_30: 20_000, d31_60: 20_000, d61_90: 20_000, over90: 20_000 },
          USD: { notDue: 100, d1_30: 100, d31_60: 100, d61_90: 100, over90: 100 },
        }}
      />,
    );
    expect(screen.getByText('Client balances by age · tax included')).toBeInTheDocument();
    expect(screen.getByText('IDR')).toBeInTheDocument();
    expect(screen.getByText('USD')).toBeInTheDocument();
    expect(screen.getAllByText(/IDR\s?200/)).toHaveLength(5);
    expect(screen.getAllByRole('button', { name: 'How this age balance is calculated' })).toHaveLength(1);
    expect(screen.queryByRole('button', { name: /bucket.*calculated/i })).not.toBeInTheDocument();
    const bar = screen.getByTestId('ageing-bar-IDR');
    expect(bar).toHaveClass('h-[10px]', 'rounded-full');
    expect(bar.querySelectorAll('[data-bucket]')).toHaveLength(5);
    expect(bar.querySelector('[data-bucket="notDue"]')).toHaveStyle({ width: '20%' });
    expect(bar.querySelector('[data-bucket="over90"]')).toHaveClass('bg-destructive');
  });

  it('opens an overdue invoice from the finance receivables list with its amount, due date and project', () => {
    const overdue = {
      id: 'invoice-1', org_id: 'org-1', project_id: 'project-1', erp_project: null,
      customer_id: null, customer_name: 'Northstar Client', si_number: 'INV-104', reference_number: null,
      invoice_date: '2026-06-15', amount: 1_110_000, currency: 'IDR', tax_treatment: 'inclusive',
      tax_amount: 110_000, erp_outstanding_amount: 625_000, status: 'Unpaid', erp_docstatus: 1,
      erp_modified: null, erp_amended_from: null, erp_cancelled_at: null, created_at: '2026-06-15T00:00:00Z',
      author_user_id: null, author_user_ids: [], erp_payment_terms_days: 0, erp_due_date: '2026-07-15',
      received_date: null, efaktur_number: null, efaktur_date: null,
    } as FinancePosition['overdue'][number]['invoice'];
    const position: FinancePosition = {
      ...emptyPosition,
      overdue: [{ invoice: overdue, daysOverdue: 104, outstanding: 62_500_000 }],
      overdueTotals: { IDR: 62_500_000 },
      receivablesCount: 1,
    };
    const projects = new Map([['project-1', { name: 'North delivery', short_name: 'North delivery', pm: { full_name: 'Alex Rivera' } }]]);

    render(
      <MemoryRouter>
        <FinanceAttention
          position={position}
          scope="all"
          canAct
          isPending={false}
          isError={false}
          onRetry={() => {}}
          withLayout={(path) => path}
          orgCurrency="IDR"
          projects={projects}
        />
      </MemoryRouter>,
    );

    expect(screen.getByRole('link', { name: /Northstar Client.*INV-104/ })).toHaveAttribute('href', '/finance/receivables?open=invoice-1');
    expect(screen.getByText('North delivery')).toBeInTheDocument();
    expect(screen.getByText(/Due/)).toBeInTheDocument();
    expect(screen.getByText('Partly paid · 104 days late')).toBeInTheDocument();
    expect(screen.getByText(/of IDR/)).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Alex Rivera' })).toHaveTextContent('AR');
  });

  it('gives Finance compact actions for each waiting count and keeps executives read-only', async () => {
    const position: FinancePosition = {
      ...emptyPosition,
      drafts: { canApprove: [{ id: 'draft-1' } as never], awaitingOther: [{ id: 'draft-2' } as never], all: [{ id: 'draft-1' } as never, { id: 'draft-2' } as never] },
      toSend: [{ id: 'send-1' } as never],
      unappliedPayments: [{ payment: { id: 'payment-1' } as never, amount: 50_000 }],
      unappliedTotals: { IDR: 50_000 },
      payables: [{ procurement: { id: 'proc-1', vendor_id: 'supplier-1', vendor: { name: 'Supplier A' } } as never, ageDays: 40, amount: 100_000 }],
      payablesTotals: { IDR: 100_000 },
    };
    const props = {
      position, scope: 'all' as const, isPending: false, isError: false, onRetry: () => {},
      withLayout: (path: string) => path, orgCurrency: 'IDR', projects: new Map(),
    };
    const user = userEvent.setup();
    const { rerender } = render(<MemoryRouter><FinanceAttention {...props} canAct /><CurrentLocation /></MemoryRouter>);

    expect(screen.getByText('1 draft to approve')).toBeInTheDocument();
    await user.click(screen.getAllByRole('button', { name: 'Review' })[0]!);
    expect(screen.getByLabelText('Current location')).toHaveTextContent('/finance/receivables?todo=approve');
    await user.click(screen.getByRole('button', { name: 'Mark received' }));
    expect(screen.getByLabelText('Current location')).toHaveTextContent('/finance/receivables?todo=send');
    await user.click(screen.getByRole('button', { name: 'Apply' }));
    expect(screen.getByLabelText('Current location')).toHaveTextContent('/finance/receivables?view=payments&todo=unapplied');
    expect(screen.getByRole('link', { name: 'Open payables' })).toHaveAttribute('href', '/finance/payables');

    rerender(<MemoryRouter><FinanceAttention {...props} canAct={false} /></MemoryRouter>);
    expect(screen.queryByRole('button', { name: /Review|Mark received|Apply/ })).not.toBeInTheDocument();
  });

  it('uses the supplier invoice empty state when no procurement is awaiting payment', () => {
    render(
      <MemoryRouter>
        <PayablesList position={emptyPosition} isPending={false} isError={false} onRetry={() => {}} withLayout={withLayout} />
      </MemoryRouter>,
    );
    expect(screen.getByText('No supplier invoices waiting to be paid.')).toBeInTheDocument();
  });
});

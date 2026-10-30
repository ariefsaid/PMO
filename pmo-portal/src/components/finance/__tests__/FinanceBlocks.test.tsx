import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { MemoryRouter, useLocation } from 'react-router';
import type { FinancePosition } from '@/src/lib/finance/financePosition';
import { FinanceAttention } from '../FinanceAttention';
import { AgeingStrip } from '../AgeingStrip';

const withLayout = (path: string) => `${path}${path.includes('?') ? '&' : '?'}layout=c`;
vi.mock('@/src/hooks/useOrgCurrency', () => ({ useOrgCurrencyState: () => ({ currency: 'IDR', isResolved: true, isError: false }) }));

function CurrentLocation() {
  const location = useLocation();
  return <output aria-label="Current location">{`${location.pathname}${location.search}`}</output>;
}

const emptyPosition: FinancePosition = {
  receivablesCount: 0, receivablesUnknownCount: 0,
  overdue: [], overdueTotals: {}, overdueUnknownCount: 0,
  drafts: { canApprove: [], awaitingOther: [], all: [] }, toSend: [],
  unappliedPayments: [], unappliedTotals: {}, payables: [], payablesTotals: {}, payablesUnknownCount: 0,
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
      receivablesCount: 1, receivablesUnknownCount: 0,
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

  it('L12(b): an invoice with an unknown balance is counted in its age group, never shown as 0 there', () => {
    render(
      <AgeingStrip
        kind="payables"
        values={{ USD: { d0_30: 3_000_000, d31_60: 0, d61_90: 0, over90: 0 } }}
        unknownCounts={{ USD: { over90: 2, d0_30: 1 }, IDR: { d31_60: 1 } }}
      />,
    );
    expect(screen.getByTestId('ageing-bucket-USD-over90')).toHaveTextContent('2 balances unknown');
    expect(screen.getByTestId('ageing-bucket-USD-over90')).not.toHaveTextContent('$0');
    expect(screen.getByTestId('ageing-bucket-USD-d0_30')).toHaveTextContent('$30,000');
    expect(screen.getByTestId('ageing-bucket-USD-d0_30')).toHaveTextContent('+ 1 balance unknown');
    expect(screen.getByTestId('ageing-bucket-USD-d31_60')).toHaveTextContent('$0');
    // A currency whose balances are all unknown still gets its row.
    expect(screen.getByTestId('ageing-bucket-IDR-d31_60')).toHaveTextContent('1 balance unknown');
  });

  it('C4: an overdue invoice with an unknown balance carries no per-row placeholder; the heading counts it once', () => {
    const invoice = { id: 'invoice-9', project_id: null, customer_name: 'Cascade Foods', si_number: 'DEMO-SI-1', invoice_date: '2026-07-01', erp_payment_terms_days: 14, erp_due_date: '2026-07-15', received_date: null, amount: 7_700_000, tax_amount: 0, currency: 'USD', status: 'Unpaid', erp_outstanding_amount: null } as never;
    const position: FinancePosition = { ...emptyPosition, overdue: [{ invoice, daysOverdue: 105, outstanding: null }], overdueUnknownCount: 1, receivablesCount: 1 };
    render(<MemoryRouter><FinanceAttention position={position} scope="all" canAct isPending={false} isError={false} onRetry={() => {}} withLayout={(path) => path} orgCurrency="USD" /></MemoryRouter>);

    expect(screen.getByRole('heading', { name: /1 balance unknown/ })).toBeInTheDocument();
    const row = screen.getByRole('link', { name: /Cascade Foods/ });
    expect(row).not.toHaveTextContent(/Balance unknown|—|\$0\b/);
  });

  it('SEC-RS-2: a waiting supplier invoice with an unknown balance reads as unknown, not as a blank amount', () => {
    const position: FinancePosition = {
      ...emptyPosition,
      payables: [{ procurement: { id: 'proc-1', vendor_id: 'supplier-1', vendor: { name: 'Supplier A' } } as never, ageDays: 40, amount: null }],
      payablesTotals: {},
      payablesUnknownCount: 1,
    };
    render(<MemoryRouter><FinanceAttention position={position} scope="all" isPending={false} isError={false} onRetry={() => {}} withLayout={(path: string) => path} orgCurrency="IDR" projects={new Map()} canAct /></MemoryRouter>);

    expect(screen.getByText('Balance unknown · oldest 40 days')).toBeInTheDocument();
  });
});

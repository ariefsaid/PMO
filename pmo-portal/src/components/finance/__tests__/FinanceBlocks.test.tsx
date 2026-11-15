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
          IDR: { notDue: 20_000, noDueDate: 0, d1_30: 20_000, d31_60: 20_000, d61_90: 20_000, over90: 20_000 },
          USD: { notDue: 100, noDueDate: 0, d1_30: 100, d31_60: 100, d61_90: 100, over90: 100 },
        }}
      />,
    );
    expect(screen.getByText('Client balances by age')).toBeInTheDocument();
    expect(screen.getByText('IDR')).toBeInTheDocument();
    expect(screen.getByText('USD')).toBeInTheDocument();
    expect(screen.getAllByText(/IDR\s?200/)).toHaveLength(5);
    // The age basis lives in the page's one help control: no per-strip "?".
    expect(screen.queryByRole('button', { name: 'How this age balance is calculated' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /bucket.*calculated/i })).not.toBeInTheDocument();
    const bar = screen.getByTestId('ageing-bar-IDR');
    expect(bar).toHaveClass('h-9', 'rounded-md');
    const chartLabel = bar.getAttribute('aria-label')?.replace(/\u00a0/g, ' ');
    expect(chartLabel).toContain('Not yet due IDR 200');
    expect(chartLabel).toContain('Over 90 days IDR 200');
  });

  it('uses Payables status hues for the age buckets when requested', () => {
    render(
      <AgeingStrip
        kind="payables"
        payablesStatusColors
        values={{ IDR: { d0_30: 10_000, d31_60: 20_000, d61_90: 30_000, over90: 40_000 } }}
      />,
    );

    expect(screen.getByTestId('ageing-bucket-IDR-d0_30').firstElementChild).toHaveStyle({ background: 'hsl(var(--muted-foreground) / 0.55)' });
    expect(screen.getByTestId('ageing-bucket-IDR-d31_60').firstElementChild).toHaveStyle({ background: 'hsl(var(--warning) / 0.48)' });
    expect(screen.getByTestId('ageing-bucket-IDR-d61_90').firstElementChild).toHaveStyle({ background: 'hsl(var(--warning) / 0.72)' });
    expect(screen.getByTestId('ageing-segment-IDR-d31_60')).toHaveStyle({ background: 'hsl(var(--warning) / 0.48)' });
    expect(screen.getByTestId('ageing-segment-IDR-d61_90')).toHaveStyle({ background: 'hsl(var(--warning) / 0.72)' });
    expect(screen.getByTestId('ageing-bucket-IDR-over90').firstElementChild).toHaveStyle({ background: 'hsl(var(--destructive))' });
  });

  it('F8: displays the receivables no-due-date amount and invoice count in its own bucket', () => {
    render(
      <AgeingStrip
        kind="receivables"
        values={{ IDR: { notDue: 0, noDueDate: 10_000, d1_30: 0, d31_60: 0, d61_90: 0, over90: 0 } }}
        noDueDateCounts={{ IDR: 1 }}
      />,
    );

    const noDueDate = screen.getByTestId('ageing-bucket-IDR-noDueDate');
    expect(noDueDate).toHaveTextContent('No due date');
    expect(noDueDate).toHaveTextContent('1 invoice');
    expect(noDueDate.querySelector('.tabular')).toHaveTextContent(/IDR\s?100\b/);
    expect(screen.getByTestId('ageing-bucket-IDR-notDue')).toHaveTextContent(/IDR\s?0\b/);
  });

  it('opens an overdue invoice from the finance receivables list with its amount, due date and project', () => {
    const overdue = {
      id: 'invoice-1', org_id: 'org-1', project_id: 'project-1', erp_project: null, billing_kind: 'contract',
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
    // Client · number on the first line; project · due date on the second; no initials avatar.
    expect(screen.getByText(/North delivery · Due /)).toBeInTheDocument();
    const row = screen.getByRole('link', { name: /Northstar Client.*INV-104/ });
    const late = screen.getByText('Partly paid · 104 days overdue');
    expect(late).toHaveClass('text-destructive-text');
    expect(late.parentElement).toBe(row);
    const amount = screen.getByText('IDR 625,000');
    expect(amount).toHaveClass('text-metric', 'font-semibold', 'tabular');
    expect(row).toHaveClass('grid-cols-[minmax(0,1fr)_auto]');
    expect(screen.getByText(/of IDR/)).toBeInTheDocument();
    expect(screen.queryByRole('img', { name: 'Alex Rivera' })).toBeNull();
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
    await user.click(screen.getByRole('button', { name: 'Record delivery' }));
    expect(screen.getByLabelText('Current location')).toHaveTextContent('/finance/receivables?todo=send');
    await user.click(screen.getByRole('button', { name: 'Apply' }));
    expect(screen.getByLabelText('Current location')).toHaveTextContent('/finance/receivables?view=payments&todo=unapplied');
    expect(screen.getByRole('link', { name: 'Open payables' })).toHaveAttribute('href', '/finance/payables');

    rerender(<MemoryRouter><FinanceAttention {...props} canAct={false} /></MemoryRouter>);
    expect(screen.queryByRole('button', { name: /Review|Record delivery|Apply/ })).not.toBeInTheDocument();
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

  it('F6 omits unknown supplier age but retains known zero days', () => {
    const row = { procurement: { id: 'proc-1' } as never, ageDays: null, amount: null };
    const props = { scope: 'all' as const, isPending: false, isError: false, onRetry: () => {}, withLayout: (path: string) => path, orgCurrency: 'IDR', canAct: true };
    const view = render(<MemoryRouter><FinanceAttention {...props} position={{ ...emptyPosition, payables: [row], payablesUnknownCount: 1 }} /></MemoryRouter>);
    expect(screen.getByText('Balance unknown')).toBeInTheDocument();
    expect(screen.queryByText(/oldest 0 days/i)).not.toBeInTheDocument();
    view.rerender(<MemoryRouter><FinanceAttention {...props} position={{ ...emptyPosition, payables: [{ ...row, ageDays: 0, amount: 0 }], payablesTotals: { IDR: 0 } }} /></MemoryRouter>);
    expect(screen.getByText('Oldest 0 days')).toBeInTheDocument();
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

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { MemoryRouter } from 'react-router';
import type { FinancePosition } from '@/src/lib/finance/financePosition';
import { FinanceAttention } from '../FinanceAttention';
import { AgeingStrip } from '../AgeingStrip';
import { PayablesList } from '../PayablesList';

const withLayout = (path: string) => `${path}${path.includes('?') ? '&' : '?'}layout=c`;
const emptyPosition: FinancePosition = {
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
          IDR: { notDue: 10_000, d1_30: 20_000, d31_60: 30_000, d61_90: 40_000, over90: 50_000 },
          USD: { notDue: 100, d1_30: 200, d31_60: 300, d61_90: 400, over90: 500 },
        }}
      />,
    );
    expect(screen.getByText('Client balances by age · tax included')).toBeInTheDocument();
    expect(screen.getByText('IDR')).toBeInTheDocument();
    expect(screen.getByText('USD')).toBeInTheDocument();
    expect(screen.getByText(/IDR\s?10,000\.00/)).toBeInTheDocument();
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

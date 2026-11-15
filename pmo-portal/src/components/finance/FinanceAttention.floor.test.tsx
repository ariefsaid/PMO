import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, useLocation } from 'react-router';
import type { FinancePosition } from '@/src/lib/finance/financePosition';
import { FinanceAttention } from './FinanceAttention';

function CurrentLocation() {
  const location = useLocation();
  return <output aria-label="Current location">{`${location.pathname}${location.search}`}</output>;
}

const emptyPosition: FinancePosition = {
  receivablesCount: 0,
  receivablesUnknownCount: 0,
  overdue: [],
  overdueTotals: {},
  overdueUnknownCount: 0,
  drafts: { canApprove: [], awaitingOther: [], all: [] },
  toSend: [],
  unappliedPayments: [],
  unappliedTotals: {},
  payables: [],
  payablesTotals: {},
  payablesUnknownCount: 0,
  receivablesAgeing: {},
  payablesAgeing: {},
};

function invoice(id: string) {
  return {
    id,
    org_id: 'org-1',
    project_id: null,
    customer_id: null,
    customer_name: `Client ${id}`,
    si_number: `INV-${id}`,
    invoice_date: '2026-06-15',
    amount: 1_110_000,
    currency: 'IDR',
    tax_treatment: 'inclusive',
    tax_amount: 110_000,
    erp_outstanding_amount: 625_000,
    status: 'Unpaid',
    erp_docstatus: 1,
    erp_modified: null,
    erp_amended_from: null,
    erp_cancelled_at: null,
    created_at: '2026-06-15T00:00:00Z',
    author_user_id: null,
    author_user_ids: [],
    erp_payment_terms_days: 0,
    erp_due_date: '2026-07-15',
    received_date: null,
    efaktur_number: null,
    efaktur_date: null,
  } as unknown as FinancePosition['overdue'][number]['invoice'];
}

function mount(position: FinancePosition, onRetry = vi.fn()) {
  render(
    <MemoryRouter>
      <FinanceAttention
        position={position}
        scope="all"
        canAct
        isPending={false}
        isError={false}
        onRetry={onRetry}
        withLayout={(path) => path}
        orgCurrency="IDR"
      />
      <CurrentLocation />
    </MemoryRouter>,
  );
  return onRetry;
}

function route() {
  return screen.getByLabelText('Current location').textContent;
}

afterEach(cleanup);

describe('Finance attention floor controls', () => {
  it('floor: overdue invoice row opens that invoice drawer', () => {
    const position: FinancePosition = {
      ...emptyPosition,
      overdue: [{ invoice: invoice('104'), daysOverdue: 104, outstanding: 625_000 }],
      overdueTotals: { IDR: 625_000 },
      receivablesCount: 1,
    };
    mount(position);
    fireEvent.click(screen.getByRole('link', { name: 'Open Client 104 invoice INV-104' }));
    expect(route()).toBe('/finance/receivables?open=104');
  });

  it('floor: Show all overdue opens the overdue invoice list', () => {
    const position: FinancePosition = {
      ...emptyPosition,
      overdue: Array.from({ length: 6 }, (_, index) => ({ invoice: invoice(String(index + 1)), daysOverdue: 30, outstanding: 10_000 })),
      overdueTotals: { IDR: 60_000 },
      receivablesCount: 6,
    };
    mount(position);
    fireEvent.click(screen.getByRole('link', { name: 'Show all 6 overdue' }));
    expect(route()).toBe('/finance/receivables?overdue=true');
  });

  it('floor: second approver Review opens the second approval queue', () => {
    const position: FinancePosition = {
      ...emptyPosition,
      drafts: { canApprove: [], awaitingOther: [{ id: 'draft-2' } as never], all: [{ id: 'draft-2' } as never] },
    };
    mount(position);
    fireEvent.click(screen.getByRole('button', { name: 'Review' }));
    expect(route()).toBe('/finance/receivables?todo=second');
  });

  it('floor: Open payables opens the unpaid supplier invoice list', () => {
    const position: FinancePosition = {
      ...emptyPosition,
      payables: [{ procurement: { id: 'proc-1', vendor_id: 'supplier-1', vendor: { name: 'Supplier A' } } as never, ageDays: 40, amount: 100_000 }],
      payablesTotals: { IDR: 100_000 },
    };
    mount(position);
    fireEvent.click(screen.getByRole('link', { name: 'Open payables' }));
    expect(route()).toBe('/finance/payables');
  });

  it('floor: attention Retry requests the finance data again', () => {
    const retry = vi.fn();
    render(
      <MemoryRouter>
        <FinanceAttention position={emptyPosition} scope="all" canAct isPending={false} isError onRetry={retry} withLayout={(path) => path} />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(retry).toHaveBeenCalledOnce();
  });
});

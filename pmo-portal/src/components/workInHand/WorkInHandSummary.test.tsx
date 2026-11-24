import React from 'react';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { deriveWorkInHand, type WipInputRow } from '@/src/lib/workInHand';
import type { WorkInHand as WorkInHandFacts } from '@/src/lib/db/workInHand';

const state = vi.hoisted(() => ({
  role: 'Executive' as string,
  loading: false,
  error: false,
  facts: undefined as WorkInHandFacts | undefined,
  rows: [] as ReturnType<typeof deriveWorkInHand>,
  refetch: vi.fn(),
  readEnabled: false,
}));

vi.mock('@/src/auth/impersonation', () => ({
  useEffectiveRole: () => ({ effectiveRole: state.role, realRole: state.role }),
}));
vi.mock('@/src/hooks/useWorkInHand', () => ({
  useWorkInHand: (enabled: boolean) => {
    state.readEnabled = enabled;
    return {
      facts: enabled ? state.facts : undefined,
      rows: enabled ? state.rows : [],
      isLoading: enabled && state.loading,
      isError: enabled && state.error,
      isSuccess: enabled && !state.loading && !state.error,
      error: null,
      refetch: state.refetch,
    };
  },
}));

import { WorkInHandSummary } from './WorkInHandSummary';

const AS_OF = '2026-12-10';
const row = (id: string, currency: string, value: string): WipInputRow => ({
  kind: 'contract', parentId: null, id, name: id, code: null, status: 'Ongoing Project',
  currency, value, incomplete: false, foreignCurrencyInvoiceCount: 0, unpricedInvoiceCount: 0,
  billedToDate: '0.00', firstBillingMonth: null, windowMonths: [],
});

function setData(inputs: WipInputRow[], monthlyCapacity: string | null) {
  state.facts = {
    asOf: AS_OF, timezone: 'Asia/Jakarta', orgCurrency: 'IDR', monthlyCapacity,
    windowFrom: '2026-06-01', windowTo: '2026-11-01', truncated: false,
    undatedInvoiceCount: 0, noValueContractCount: 0, noValue: [], rows: inputs,
  };
  state.rows = deriveWorkInHand(inputs, AS_OF);
}

beforeEach(() => {
  state.role = 'Executive';
  state.loading = false;
  state.error = false;
  state.facts = undefined;
  state.rows = [];
  state.readEnabled = false;
  state.refetch.mockReset();
});
afterEach(cleanup);

describe('WorkInHandSummary (M8)', () => {
  it('AC-M8-005 shows org-currency value, months divided by capacity, and other currencies labelled as not included in months', () => {
    setData([row('c1', 'IDR', '25000000.00'), row('c2', 'USD', '900000.00')], '2500000.00');
    render(<MemoryRouter><WorkInHandSummary /></MemoryRouter>);
    expect(screen.getByTestId('work-in-hand-summary-value')).toHaveTextContent('IDR 25,000,000');
    expect(screen.getByTestId('work-in-hand-summary-other-currencies')).toHaveTextContent('Other currencies (not included in months): $900,000');
    const months = screen.getByTestId('work-in-hand-summary-months');
    expect(months).toHaveTextContent('10.0 months');
    expect(months).toHaveTextContent('USD not included in months (no conversion)');
    expect(screen.getByTestId('work-in-hand-summary-link')).toHaveAttribute('href', '/projects/work-in-hand');
  });

  it('AC-M8-005 shows a sensible empty state when monthly capacity is unset, with a settings link for Admin only', () => {
    state.role = 'Admin';
    setData([row('c1', 'IDR', '25000000.00')], null);
    const { rerender } = render(<MemoryRouter><WorkInHandSummary /></MemoryRouter>);
    const months = screen.getByTestId('work-in-hand-summary-months');
    expect(months).toHaveTextContent('No monthly capacity set');
    expect(within(months).getByRole('link', { name: 'Set capacity' })).toHaveAttribute('href', '/administration/projects#work-in-hand-capacity');

    state.role = 'Finance';
    rerender(<MemoryRouter><WorkInHandSummary /></MemoryRouter>);
    expect(within(screen.getByTestId('work-in-hand-summary-months')).queryByRole('link', { name: 'Set capacity' })).toBeNull();
  });

  it('AC-M8-005 labels Project Manager view as My work in hand and hides everything from Engineer', () => {
    state.role = 'Project Manager';
    setData([row('c1', 'IDR', '5000000.00')], '2500000.00');
    const { rerender } = render(<MemoryRouter><WorkInHandSummary /></MemoryRouter>);
    expect(screen.getByRole('heading', { name: 'My work in hand' })).toBeInTheDocument();
    expect(screen.getByTestId('work-in-hand-summary-months')).toHaveTextContent('2.0 months');

    state.role = 'Engineer';
    rerender(<MemoryRouter><WorkInHandSummary /></MemoryRouter>);
    expect(state.readEnabled).toBe(false);
    expect(screen.queryByTestId('work-in-hand-summary')).toBeNull();
  });

  it('retries cleanly on error', async () => {
    state.error = true;
    render(<MemoryRouter><WorkInHandSummary /></MemoryRouter>);
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(state.refetch).toHaveBeenCalledTimes(1);
  });

  it('plainly states how many incomplete or truncated contracts are excluded and why', () => {
    setData([
      row('c1', 'IDR', '5000000.00'),
      { ...row('c2', 'IDR', '9000000.00'), incomplete: true, foreignCurrencyInvoiceCount: 1, billedToDate: null },
      { ...row('c3', 'IDR', '3000000.00'), incomplete: true, unpricedInvoiceCount: 1, billedToDate: null },
    ], '2500000.00');
    state.facts = { ...state.facts!, truncated: true };
    const { rerender } = render(<MemoryRouter><WorkInHandSummary /></MemoryRouter>);

    const notice = screen.getByTestId('work-in-hand-summary-exclusions');
    expect(notice).toHaveTextContent('2 contracts excluded because their invoices cannot be totalled');
    expect(notice).toHaveTextContent('Contracts beyond the 500-contract limit are excluded because the list is capped at 500 contracts.');

    setData([row('c1', 'IDR', '5000000.00')], '2500000.00');
    rerender(<MemoryRouter><WorkInHandSummary /></MemoryRouter>);
    expect(screen.queryByTestId('work-in-hand-summary-exclusions')).toBeNull();
  });
});

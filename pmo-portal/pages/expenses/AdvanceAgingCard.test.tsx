import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import React from 'react';
import { formatCurrencyAuto } from '@/src/lib/format';
// The DOM matchers collapse NBSP to a space; Intl emits NBSP between code and digits.
const money = (v: number, c: string) => formatCurrencyAuto(v, c).replace(/\u00a0/g, ' ');

const h = vi.hoisted(() => ({
  aging: { data: undefined as unknown, isPending: false, isError: false, refetch: vi.fn() },
  totals: { data: undefined as unknown, isPending: false, isError: false, refetch: vi.fn() },
}));
vi.mock('@/src/hooks/useExpenseClaims', () => ({ useExpenseAdvanceAging: () => h.aging, useExpenseAdvanceAgingTotals: () => h.totals }));

import { AdvanceAgingCard } from './AdvanceAgingCard';

const row = (o: Record<string, unknown>) => ({
  advanceId: 'a1', claimNumber: 'ADV-1', claimantId: 'u1', claimantName: 'Budi Field', projectId: null, projectName: null,
  currency: 'IDR', amount: 500, settled: 0, returned: 0, outstanding: 100, paidOn: '2026-09-01', ageDays: 10, bucket: '0-30', ...o,
});
const renderCard = () => render(<MemoryRouter><AdvanceAgingCard /></MemoryRouter>);

const bucketsOf = (o: Record<string, number>) => ({ '0-30': 0, '31-60': 0, '61-90': 0, '90+': 0, ...o });
beforeEach(() => {
  h.aging.isError = false; h.aging.isPending = false; h.aging.refetch = vi.fn();
  h.totals.isError = false; h.totals.isPending = false; h.totals.refetch = vi.fn();
  h.totals.data = undefined;
});

describe('AdvanceAgingCard', () => {
  it('AC-EXP-063 shows bucket totals per currency and the rows', () => {
    h.aging.data = { rows: [row({}), row({ advanceId: 'a2', claimNumber: 'ADV-2', outstanding: 200.5, ageDays: 45, bucket: '31-60' })], truncated: false };
    h.totals.data = { IDR: bucketsOf({ '0-30': 100, '31-60': 200.5 }) };
    renderCard();
    expect(screen.getByTestId('aging-IDR-0-30')).toHaveTextContent(money(100, 'IDR'));
    expect(screen.getByTestId('aging-IDR-31-60')).toHaveTextContent(money(200.5, 'IDR'));
    const table = screen.getByRole('table');
    expect(within(table).getByRole('columnheader', { name: 'Outstanding' })).toBeInTheDocument();
    expect(within(table).getByText(formatCurrencyAuto(200.5, 'IDR').replace(/\u00a0/g, ' '))).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'ADV-2' })).toHaveAttribute('href', '/expenses/a2');
  });
  it('AC-EXP-063 keeps advance details in cards on phones', () => {
    h.aging.data = { rows: [row({})], truncated: false };
    h.totals.data = { IDR: bucketsOf({ '0-30': 100 }) };
    vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
    renderCard();
    const cards = screen.getByTestId('dt-card-branch');
    expect(within(cards).getByRole('link', { name: 'ADV-1' })).toHaveAttribute('href', '/expenses/a1');
    expect(within(cards).getByText(formatCurrencyAuto(100, 'IDR').replace(/\u00a0/g, ' '))).toBeInTheDocument();
    vi.unstubAllGlobals();
  });
  it('AC-EXP-063 renders nothing when no advance is outstanding', () => {
    h.aging.data = { rows: [], truncated: false };
    h.totals.data = {};
    const { container } = renderCard();
    expect(container).toBeEmptyDOMElement();
  });
  it('AC-EXP-063 a failed read shows an error, never an empty state', () => {
    h.aging.data = undefined;
    h.aging.isError = true;
    renderCard();
    expect(screen.getByText("Couldn't load outstanding advances")).toBeInTheDocument();
  });
  it('AC-EXP-062 bucket totals are the aggregate over every advance, not the sum of the listed rows', () => {
    h.aging.data = { rows: [row({})], truncated: true };
    h.totals.data = { IDR: bucketsOf({ '0-30': 750000, '90+': 1250000.5 }) };
    renderCard();
    expect(screen.getByTestId('aging-IDR-0-30')).toHaveTextContent(money(750000, 'IDR'));
    expect(screen.getByTestId('aging-IDR-90+')).toHaveTextContent(money(1250000.5, 'IDR'));
    expect(screen.getByRole('status')).toHaveTextContent('Showing the oldest 500 advances.');
  });
  it('AC-EXP-062 a failed totals read shows an error and retries both reads, never the partial row sum', () => {
    h.aging.data = { rows: [row({})], truncated: false };
    h.totals.isError = true;
    renderCard();
    expect(screen.getByText("Couldn't load outstanding advances")).toBeInTheDocument();
    expect(screen.queryByTestId('aging-IDR-0-30')).not.toBeInTheDocument();
    screen.getByRole('button', { name: 'Retry' }).click();
    expect(h.totals.refetch).toHaveBeenCalledTimes(1);
    expect(h.aging.refetch).toHaveBeenCalledTimes(1);
  });
  it('AC-EXP-062 waits for the totals before drawing the card', () => {
    h.aging.data = { rows: [row({})], truncated: false };
    h.totals.isPending = true;
    const { container } = renderCard();
    expect(container).toBeEmptyDOMElement();
  });
});

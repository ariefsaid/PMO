import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import React from 'react';
import { formatCurrencyCents } from '@/src/lib/format';
// The DOM matchers collapse NBSP to a space; Intl emits NBSP between code and digits.
const money = (v: number, c: string) => formatCurrencyCents(v, c).replace(/\u00a0/g, ' ');

const h = vi.hoisted(() => ({
  aging: { data: undefined as unknown, isPending: false, isError: false, refetch: vi.fn() },
}));
vi.mock('@/src/hooks/useExpenseClaims', () => ({ useExpenseAdvanceAging: () => h.aging }));

import { AdvanceAgingCard } from './AdvanceAgingCard';

const row = (o: Record<string, unknown>) => ({
  advanceId: 'a1', claimNumber: 'ADV-1', claimantId: 'u1', claimantName: 'Budi Field', projectId: null, projectName: null,
  currency: 'IDR', amount: 500, settled: 0, returned: 0, outstanding: 100, paidOn: '2026-09-01', ageDays: 10, bucket: '0-30', ...o,
});
const renderCard = () => render(<MemoryRouter><AdvanceAgingCard /></MemoryRouter>);

beforeEach(() => { h.aging.isError = false; h.aging.isPending = false; });

describe('AdvanceAgingCard', () => {
  it('AC-EXP-063 shows bucket totals per currency and the rows', () => {
    h.aging.data = { rows: [row({}), row({ advanceId: 'a2', claimNumber: 'ADV-2', outstanding: 200.5, ageDays: 45, bucket: '31-60' })], truncated: false };
    renderCard();
    expect(screen.getByTestId('aging-IDR-0-30')).toHaveTextContent(money(100, 'IDR'));
    expect(screen.getByTestId('aging-IDR-31-60')).toHaveTextContent(money(200.5, 'IDR'));
    expect(screen.getByRole('link', { name: 'ADV-2' })).toHaveAttribute('href', '/expenses/a2');
  });
  it('AC-EXP-063 renders nothing when no advance is outstanding', () => {
    h.aging.data = { rows: [], truncated: false };
    const { container } = renderCard();
    expect(container).toBeEmptyDOMElement();
  });
  it('AC-EXP-063 a failed read shows an error, never an empty state', () => {
    h.aging.data = undefined;
    h.aging.isError = true;
    renderCard();
    expect(screen.getByText("Couldn't load outstanding advances")).toBeInTheDocument();
  });
});

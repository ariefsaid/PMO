import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import React from 'react';
import { formatCurrencyAuto } from '@/src/lib/format';

const h = vi.hoisted(() => ({
  aging: { data: undefined as unknown, isPending: false, isError: false, refetch: vi.fn() },
}));
vi.mock('@/src/hooks/useExpenseClaims', () => ({ useExpenseAdvanceAging: () => h.aging }));

import { AdvanceAgingCard } from './AdvanceAgingCard';

const row = (o: Record<string, unknown>) => ({
  advanceId: 'a1', claimNumber: 'ADV-1', claimantId: 'u1', claimantName: 'Budi Field', projectId: null, projectName: null,
  currency: 'IDR', amount: 500, settled: 0, returned: 0, outstanding: 100, paidOn: '2026-09-01', ageDays: 10, bucket: '0-30', ...o,
});
const renderCard = (props: React.ComponentProps<typeof AdvanceAgingCard> = { active: true }) => render(<MemoryRouter><AdvanceAgingCard {...props} /></MemoryRouter>);
const RecordContextProbe = () => {
  const location = useLocation();
  return <p data-testid="record-context-probe">{`${location.pathname}${location.search} ${JSON.stringify(location.state)}`}</p>;
};

beforeEach(() => { h.aging.isError = false; h.aging.isPending = false; });

describe('AdvanceAgingCard', () => {
  it('AC-806 shows outstanding advances oldest paid date first, leaves unknown dates last, and keeps exact amounts without bucket totals', () => {
    h.aging.data = { rows: [
      row({ advanceId: 'a3', claimNumber: 'ADV-3', paidOn: null, ageDays: null, bucket: '90+' }),
      row({ advanceId: 'a2', claimNumber: 'ADV-2', paidOn: '2026-08-01', outstanding: 200.5, ageDays: 45, bucket: '31-60' }),
      row({ advanceId: 'a1', paidOn: '2026-07-01' }),
    ], truncated: false };
    renderCard();
    const table = screen.getByRole('table');
    expect(within(table).getByRole('columnheader', { name: 'Outstanding' })).toBeInTheDocument();
    expect(within(table).getByText(formatCurrencyAuto(200.5, 'IDR').replace(/\u00a0/g, ' '))).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'ADV-2' })).toHaveAttribute('href', '/expenses/a2');
    const links = within(table).getAllByRole('link');
    expect(links.map((link) => link.textContent)).toEqual(['ADV-1', 'ADV-2', 'ADV-3']);
    expect(screen.queryByTestId(/aging-IDR-/)).not.toBeInTheDocument();
  });
  it('AC-EXP-063 keeps advance details in cards on phones', () => {
    h.aging.data = { rows: [row({})], truncated: false };
    vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
    renderCard();
    const cards = screen.getByTestId('dt-card-branch');
    expect(within(cards).getByRole('link', { name: 'ADV-1' })).toHaveAttribute('href', '/expenses/a1');
    expect(within(cards).getByText(formatCurrencyAuto(100, 'IDR').replace(/\u00a0/g, ' '))).toBeInTheDocument();
    vi.unstubAllGlobals();
  });
  it('AC-EXP-063 renders nothing when no advance is outstanding', () => {
    h.aging.data = { rows: [], truncated: false };
    const { container } = renderCard();
    expect(screen.getByText('No outstanding advances')).toBeInTheDocument();
    expect(container.querySelector('table')).not.toBeInTheDocument();
  });
  it('AC-EXP-063 a failed read shows an error, never an empty state', () => {
    h.aging.data = undefined;
    h.aging.isError = true;
    renderCard();
    expect(screen.getByText("Couldn't load outstanding advances")).toBeInTheDocument();
  });

  it('AC-806 keeps outstanding advances inside the selected view only', () => {
    h.aging.data = { rows: [row({})], truncated: false };
    const { container } = renderCard({ active: false });
    expect(container).toBeEmptyDOMElement();
  });

  it('AC-806 narrows the bounded outstanding set by project, age and advance identity search', () => {
    h.aging.data = { rows: [
      row({ advanceId: 'a1', projectId: 'p1', projectName: 'Harbour', claimNumber: 'ADV-1', paidOn: '2026-07-01', bucket: '0-30' }),
      row({ advanceId: 'a2', projectId: 'p1', projectName: 'Harbour', claimNumber: 'ADV-2', paidOn: '2026-08-01', bucket: '31-60' }),
      row({ advanceId: 'a3', projectId: 'p2', projectName: 'Terminal', claimNumber: 'ADV-3', paidOn: '2026-07-02', bucket: '0-30' }),
    ], truncated: true };
    renderCard({ active: true, projectId: 'p1', age: '0-30', query: 'ADV-1' });
    expect(screen.getByRole('link', { name: 'ADV-1' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'ADV-2' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'ADV-3' })).not.toBeInTheDocument();
    expect(screen.getByText(/Search and filters apply within this set/)).toBeInTheDocument();
  });

  it('AC-806 shows an explicit bounded-result notice', () => {
    h.aging.data = { rows: [row({})], truncated: true };
    renderCard();
    expect(screen.getByText(/Showing up to 500 advances from the bounded outstanding list/)).toBeInTheDocument();
  });

  it('AC-806 carries the outstanding register working set into the opened advance', async () => {
    h.aging.data = { rows: [row({ projectId: 'p1', projectName: 'Harbour', ageDays: 45, bucket: '31-60' })], truncated: false };
    render(
      <MemoryRouter initialEntries={['/expenses?view=outstanding&project=p1&age=31-60&advanceSort=oldest']}>
        <Routes>
          <Route path="/expenses" element={<AdvanceAgingCard active projectId="p1" age="31-60" sortOrder="oldest" />} />
          <Route path="/expenses/:claimId" element={<RecordContextProbe />} />
        </Routes>
      </MemoryRouter>,
    );

    await userEvent.click(screen.getByRole('link', { name: 'ADV-1' }));
    const probe = await screen.findByTestId('record-context-probe');
    expect(probe).toHaveTextContent('/expenses/a1?view=outstanding&project=p1&age=31-60&advanceSort=oldest');
    expect(probe).toHaveTextContent('/expenses?view=outstanding&project=p1&age=31-60&advanceSort=oldest');
  });
});

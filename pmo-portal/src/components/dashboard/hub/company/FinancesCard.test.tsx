import React from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { FinancesCard, LeftToBillSection } from './FinancesCard';
import type { OwedSplit } from '@/src/components/dashboard/restructure/useCompanyFigures';

const split = (over: Partial<OwedSplit> = {}): OwedSplit => ({
  count: 6, notDue: [{ currency: 'USD', amount: 511_000 }], overdue: [{ currency: 'USD', amount: 640_000 }], overdueCount: 3, unknownBalances: 0, oldestDays: 92, ...over,
});

describe('FinancesCard', () => {
  it('reads each part of the invoice count line whole, so the line can only break at the separator', () => {
    render(
      <MemoryRouter>
        <FinancesCard currency="USD" receivables={split()} receivablesPending={false} receivablesError={false}
          payables={split({ count: 4, oldestDays: 105 })} payablesPending={false} payablesError={false} retry={() => {}} />
      </MemoryRouter>,
    );
    const owedToUs = screen.getByTestId('owed-to-us');
    expect(within(owedToUs).getByText('6 invoices')).toBeInTheDocument();
    expect(within(owedToUs).getByText('oldest 92 days overdue')).toBeInTheDocument();
    expect(within(owedToUs).getByText('6 invoices').parentElement).toHaveTextContent('6 invoices · oldest 92 days overdue');
    expect(within(screen.getByTestId('owed-to-suppliers')).getByText('oldest 105 days')).toBeInTheDocument();
  });
});

describe('LeftToBillSection', () => {
  const rows = Array.from({ length: 7 }, (_, index) => ({ id: `p${index}`, name: `Project ${index + 1}`, amount: 1000 * (7 - index) }));

  it('names as many projects as it is given room for, with reports one tap away for the rest', () => {
    render(<MemoryRouter><LeftToBillSection currency="USD" rows={rows} pending={false} error={false} retry={() => {}} limit={5} /></MemoryRouter>);
    const section = screen.getByTestId('left-to-bill-projects');
    const chart = within(section).getByRole('img');
    for (const name of ['Project 1:', 'Project 5:']) expect(chart.getAttribute('aria-label')).toContain(name);
    expect(chart.getAttribute('aria-label')).not.toContain('Project 6');
    expect(within(section).getByRole('link', { name: /open reports/i })).toHaveAttribute('href', '/finance/reports');
  });
});

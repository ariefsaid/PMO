import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { EarnedAgainstContract, EarnedInvoicedTrend } from './ReportCharts';

describe('report charts', () => {
  it('draws one bar per project, largest contract first, with both figures written on the row', () => {
    render(<EarnedAgainstContract rows={[
      { key: 'a', name: 'Small', currency: 'USD', contract: 100_000_00, earned: 50_000_00 },
      { key: 'b', name: 'Large', currency: 'USD', contract: 400_000_00, earned: 100_000_00 },
    ]} />);
    const items = within(screen.getByTestId('pack-earned-bars')).getAllByRole('listitem');
    expect(items.map((li) => li.textContent)).toEqual([expect.stringMatching(/^Large.*\$100K \/ \$400K/), expect.stringMatching(/^Small.*\$50K \/ \$100K/)]);
    expect(screen.getByRole('img', { name: 'Large: earned $100K of $400K' })).toBeInTheDocument();
  });

  it('does not draw a one-project comparison', () => {
    const { container } = render(<EarnedAgainstContract rows={[{ key: 'a', name: 'Only', currency: 'USD', contract: 100, earned: 0 }]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('draws the earned and invoiced trend from three months, and says both end figures', () => {
    const months = ['2026-01-01', '2026-02-01', '2026-03-01'].map((month, i) => ({ month, earnedToDate: (i + 1) * 100_00, invoicedToDate: i * 50_00 }));
    render(<EarnedInvoicedTrend currency="USD" months={months} />);
    expect(screen.getByTestId('pack-trend')).toHaveTextContent(/Earned\s*\$300/);
    expect(screen.getByTestId('pack-trend')).toHaveTextContent(/Invoiced\s*\$100/);
    expect(screen.getByRole('img')).toBeInTheDocument();
  });

  it('keeps two months as figures, no line', () => {
    const { container } = render(<EarnedInvoicedTrend currency="USD" months={[{ month: '2026-01-01', earnedToDate: 1, invoicedToDate: 1 }, { month: '2026-02-01', earnedToDate: 2, invoicedToDate: 1 }]} />);
    expect(container).toBeEmptyDOMElement();
  });
});

import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { chartTheme } from '@/src/components/ui/chartTheme';
import { formatNumberExact } from '@/src/lib/format';
import { ProjectedMarginBars } from './ProjectedMarginBars';
import type { PipelineStage } from '@/src/lib/db/dashboard';

const stages: PipelineStage[] = [
  { status: 'Tender Submitted', count: 2, total_value: 2_000_000, win_probability: 0.3, weighted_value: 600_000 },
  { status: 'Negotiation', count: 1, total_value: 1_000_000, win_probability: 0.5, weighted_value: 500_000 },
  { status: 'Won, Pending KoM', count: 1, total_value: 800_000, win_probability: 1, weighted_value: 800_000 },
  { status: 'Loss Tender', count: 1, total_value: 400_000, win_probability: 0, weighted_value: 0 },
];

const wrap = (ui: React.ReactElement) => render(<MemoryRouter>{ui}</MemoryRouter>);

describe('Pipeline margin and stage evidence', () => {
  it('AC-806-PIPELINE pairs the weighted and gross amounts with an unavailable forecast note', () => {
    wrap(<ProjectedMarginBars projectedMargin={null} stages={stages} currency="USD" currencyTotals={[
      { currency: 'USD', weightedValue: 7_680_000, grossValue: 17_550_000, forecastMargin: null },
    ]} />);
    expect(screen.getByText('Weighted')).toBeInTheDocument();
    expect(screen.getByText('7,680,000')).toBeInTheDocument();
    expect(screen.getByText('17,550,000')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Forecast margin unavailable; see data note' })).toHaveAttribute('href', '#executive-data-note');
    expect(screen.queryByText('USD', { exact: true })).not.toBeInTheDocument();
  });

  it('shows the measured forecast margin headline from the executive payload', () => {
    wrap(<ProjectedMarginBars projectedMargin={0.141} stages={stages} currency="USD" />);
    expect(screen.getByText('14.1%')).toBeInTheDocument();
    expect(screen.getByText('Forecast margin')).toBeInTheDocument();
  });

  it('AC-RD-UNAVAIL-001 keeps an unknown margin as a dash without drawing a false percentage', () => {
    wrap(<ProjectedMarginBars projectedMargin={null} stages={stages} currency="IDR" />);
    const group = screen.getByRole('group', { name: /Pipeline projected margin/i });
    expect(within(group).getByText('Forecast margin').parentElement).toHaveTextContent('—');
    expect(within(group).queryByText('0.0%')).toBeNull();
  });

  it('AC-RD-MONEY-001 keeps the full weighted amount visible beside each open stage', () => {
    wrap(<ProjectedMarginBars projectedMargin={null} stages={stages} currency="IDR" />);
    expect(screen.getByText('Open stage values')).toBeInTheDocument();
    expect(screen.getByText(formatNumberExact(600_000))).toBeInTheDocument();
    expect(screen.queryByText(/600\.0K/)).toBeNull();
  });

  it('AC-RD-GEOM-001 keeps long exact amounts intact and untruncated', () => {
    wrap(<ProjectedMarginBars projectedMargin={0.141} stages={stages} currency="USD" />);
    const amount = screen.getByText(formatNumberExact(600_000));
    expect(amount.className).not.toMatch(/truncate|(^|\s)w-\[68px\]/);
    expect(amount.className).toContain('whitespace-nowrap');
  });

  it('renders one open-stage bar per non-terminal stage with its weighted value', () => {
    wrap(<ProjectedMarginBars projectedMargin={0.141} stages={stages} currency="USD" />);
    expect(screen.getByText('Tender Submitted')).toBeInTheDocument();
    expect(screen.getByText('Negotiation')).toBeInTheDocument();
    expect(screen.getByText(formatNumberExact(600_000))).toBeInTheDocument();
    expect(screen.queryByText('Won, Pending KoM')).toBeNull();
    expect(screen.queryByText('Loss Tender')).toBeNull();
  });

  it('labels the section and each weighted bar for assistive technology', () => {
    wrap(<ProjectedMarginBars projectedMargin={0.141} stages={stages} currency="USD" />);
    expect(screen.getByRole('group', { name: /Pipeline projected margin/i })).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: /Tender Submitted:.*weighted/i })).toBeInTheDocument();
  });

  it('uses the neutral chart token for stage bars, with labels carrying status meaning', () => {
    const { container } = wrap(<ProjectedMarginBars projectedMargin={0.141} stages={stages} currency="USD" />);
    const fills = Array.from(container.querySelectorAll<HTMLElement>('[role="progressbar"] > span'));
    expect(fills.length).toBeGreaterThan(0);
    for (const fill of fills) {
      expect(fill.style.background).toBe(chartTheme.axis);
      expect(fill.style.background).not.toBe(chartTheme.series.primary);
    }
    expect(screen.getByText('Negotiation')).toBeInTheDocument();
  });
});

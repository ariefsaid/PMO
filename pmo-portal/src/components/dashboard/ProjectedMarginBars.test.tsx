import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { formatCurrency } from '@/src/lib/format';
import { chartTheme } from '@/src/components/ui/chartTheme';
import { ProjectedMarginBars } from './ProjectedMarginBars';
import type { PipelineStage } from '@/src/lib/db/dashboard';

const stages: PipelineStage[] = [
  { status: 'Tender Submitted', count: 2, total_value: 2_000_000, win_probability: 0.3, weighted_value: 600_000 },
  { status: 'Negotiation', count: 1, total_value: 1_000_000, win_probability: 0.5, weighted_value: 500_000 },
  // terminal — must be excluded
  { status: 'Won, Pending KoM', count: 1, total_value: 800_000, win_probability: 1, weighted_value: 800_000 },
  { status: 'Loss Tender', count: 1, total_value: 400_000, win_probability: 0, weighted_value: 0 },
];

// D-1: rows are now Links; wrap in MemoryRouter.
const wrap = (ui: React.ReactElement) => render(<MemoryRouter>{ui}</MemoryRouter>);

describe('ProjectedMarginBars (Exec — real useSalesPipeline)', () => {
  it('renders the projected-margin headline from the exec payload', () => {
    wrap(<ProjectedMarginBars projectedMargin={0.141} stages={stages} />);
    expect(screen.getByText('14.1%')).toBeInTheDocument();
  });

  it('renders one bar per OPEN stage (Won/Lost excluded) with its weighted value', () => {
    wrap(<ProjectedMarginBars projectedMargin={0.141} stages={stages} />);
    expect(screen.getByText('Tender Submitted')).toBeInTheDocument();
    expect(screen.getByText('Negotiation')).toBeInTheDocument();
    expect(screen.getByText(formatCurrency(600_000))).toBeInTheDocument();
    // terminal stages excluded
    expect(screen.queryByText('Won, Pending KoM')).toBeNull();
    expect(screen.queryByText('Loss Tender')).toBeNull();
  });

  it('labels the section and each bar for assistive tech', () => {
    wrap(<ProjectedMarginBars projectedMargin={0.141} stages={stages} />);
    expect(screen.getByRole('group', { name: /Pipeline projected margin/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/Tender Submitted:/i)).toBeInTheDocument();
  });

  it('batch-3: colors every weighted-value bar with the neutral chart tone (not action-blue)', () => {
    const { container } = wrap(<ProjectedMarginBars projectedMargin={0.141} stages={stages} />);
    const fills = Array.from(
      container.querySelectorAll<HTMLElement>('[role="progressbar"] > span'),
    );
    expect(fills.length).toBeGreaterThan(0);
    for (const fill of fills) {
      expect(fill.style.background).toBe(chartTheme.axis);
      expect(fill.style.background).toBe('hsl(var(--muted-foreground))');
      expect(fill.style.background).not.toBe(chartTheme.series.primary);
    }
    // No categorical hue (the violet PQ bar the audit flagged) leaks through.
    for (const cat of chartTheme.categorical) {
      expect(fills.some((f) => f.style.background === cat)).toBe(false);
    }
    // Per-stage label still present (color-not-only).
    expect(screen.getByText('Negotiation')).toBeInTheDocument();
  });
});

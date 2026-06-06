import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { chartTheme } from '@/src/components/ui/chartTheme';
import { procurementStatusTone } from './procurementStatusTone';
import { StatusBarChart } from './StatusBarChart';

const data = [
  { status: 'Draft' as const, count: 1 },
  { status: 'Ordered' as const, count: 3 },
  { status: 'Paid' as const, count: 5 },
];

describe('StatusBarChart (new AC — status-toned procurement chart)', () => {
  it('exposes an aria-label insight summary naming the top status by count', () => {
    render(
      <StatusBarChart
        data={data}
        toneFor={procurementStatusTone}
        label="Procurement by status"
        noun="requests"
      />,
    );
    const region = screen.getByRole('img', { name: /Procurement by status/i });
    // top status by count = Paid (5), total = 9
    expect(region).toHaveAccessibleName(/9 requests/i);
    expect(region).toHaveAccessibleName(/most in Paid/i);
  });

  it('renders a dot+text legend entry per status (color-not-only)', () => {
    render(
      <StatusBarChart data={data} toneFor={procurementStatusTone} label="Procurement by status" noun="requests" />,
    );
    // each status name appears as text in the legend (not color-only)
    expect(screen.getByText('Draft')).toBeInTheDocument();
    expect(screen.getByText('Ordered')).toBeInTheDocument();
    expect(screen.getByText('Paid')).toBeInTheDocument();
  });

  it('tones each status distinctly via chartTheme (not all the same green fill)', () => {
    render(
      <StatusBarChart data={data} toneFor={procurementStatusTone} label="Procurement by status" noun="requests" />,
    );
    // legend dots carry the per-status token color, proving distinct fills
    const dots = screen.getAllByTestId('legend-dot');
    const colors = dots.map((d) => d.style.background);
    const unique = new Set(colors);
    expect(unique.size).toBeGreaterThan(1);
    // Paid → success, Rejected mapping is destructive (distinct from success)
    expect(colors).toContain(chartTheme.series.success);
    expect(colors).not.toContain('#10b981'); // the old raw-hex all-green bug
  });
});

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { chartTheme, tintStatusFill, STATUS_BAR_TINT } from '@/src/components/ui/chartTheme';
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

  it('AS-4 regression: the figcaption pairs every status text with its dot (never color alone)', () => {
    const { container } = render(
      <StatusBarChart data={data} toneFor={procurementStatusTone} label="Procurement by status" noun="requests" />,
    );
    const caption = container.querySelector('figcaption');
    expect(caption).not.toBeNull();
    // one legend item per datum, each carrying both a dot and its status label text
    const items = Array.from(caption!.querySelectorAll(':scope > span'));
    expect(items).toHaveLength(data.length);
    for (const d of data) {
      const item = items.find((el) => el.textContent?.includes(d.status));
      expect(item, `legend item for ${d.status}`).toBeDefined();
      // the dot is aria-hidden and paired with the visible status text
      const dot = item!.querySelector('[data-testid="legend-dot"]');
      expect(dot).not.toBeNull();
      expect(dot!.getAttribute('aria-hidden')).toBe('true');
    }
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

  // Item E: the bars must be the status's OWN hue TINTED (Tinted-Status Rule),
  // never a fully-saturated categorical fill. The solid hue stays on the dot.
  it('tintStatusFill tints a status hue (~12-18%) on-token, never a raw hex', () => {
    expect(STATUS_BAR_TINT).toBeGreaterThanOrEqual(12);
    expect(STATUS_BAR_TINT).toBeLessThanOrEqual(18);
    const fill = tintStatusFill(chartTheme.series.warning);
    // derived from the token via color-mix (resolves against :root at render)
    expect(fill).toContain('color-mix');
    expect(fill).toContain(chartTheme.series.warning);
    expect(fill).toContain(`${STATUS_BAR_TINT}%`);
    // never a saturated solid fill, never a raw hex
    expect(fill).not.toBe(chartTheme.series.warning);
    expect(fill).not.toMatch(/#[0-9a-f]{3,6}/i);
  });

  it('legend dot stays the SOLID hue while the bar uses the tint (dot+tint pattern)', () => {
    render(
      <StatusBarChart data={data} toneFor={procurementStatusTone} label="Procurement by status" noun="requests" />,
    );
    // the legend dot is the solid status hue (matches StatusPill dot), so the
    // tinted bar + solid dot mirror the documented Tinted-Status treatment.
    const dotColors = screen.getAllByTestId('legend-dot').map((d) => d.style.background);
    expect(dotColors).toContain(chartTheme.series.success); // Paid → solid success dot
    // and none of the dots are themselves a color-mix tint (those go on the bars)
    expect(dotColors.every((c) => !c.includes('color-mix'))).toBe(true);
  });
});

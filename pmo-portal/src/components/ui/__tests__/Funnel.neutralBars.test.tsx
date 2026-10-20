import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { Funnel } from '../Funnel';

const fill = (bar: Element) => (bar.firstElementChild as HTMLElement).style.background;

describe('Funnel bars (AC-RD-SALES-001)', () => {
  it('AC-RD-SALES-001 draws every unselected bar neutral and only the selected stage in the action blue', () => {
    const { container } = render(
      <Funnel
        selectedIndex={1}
        onSelect={() => {}}
        stages={[
          { name: 'Leads', value: '1', barPct: 40 },
          { name: 'Quote', value: '2', barPct: 70 },
          { name: 'Tender', value: '3', barPct: 100 },
        ]}
      />,
    );
    const bars = Array.from(container.querySelectorAll('[data-funnel-stage-bar]'));
    expect(bars).toHaveLength(3);
    expect(fill(bars[0])).toBe('hsl(var(--muted-foreground))');
    expect(fill(bars[1])).toBe('hsl(var(--primary))');
    expect(fill(bars[2])).toBe('hsl(var(--muted-foreground))');
  });

  it('AC-RD-SALES-001 keeps an explicit per-stage bar colour override', () => {
    const { container } = render(
      <Funnel stages={[{ name: 'Won', value: '1', barPct: 50, barColor: 'hsl(var(--success))' }]} />,
    );
    expect(fill(container.querySelector('[data-funnel-stage-bar]')!)).toBe('hsl(var(--success))');
  });
});

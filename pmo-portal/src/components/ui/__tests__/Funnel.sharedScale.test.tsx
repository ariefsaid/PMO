import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { Funnel } from '../Funnel';

const trackWidth = (bar: Element) => (bar as HTMLElement).style.width;
const fillPct = (bar: Element) => parseFloat(((bar.firstElementChild as HTMLElement).style.width));

// #2199: a fill is a share of ITS OWN track, and tracks sized to their own content, so equal values
// drew unequal bars. Every bar track now has the same fixed length, and every stage the same floor.
describe('Funnel bars share one physical scale (#2199)', () => {
  const stages = [
    { name: 'A', value: 'IDR 9,999,999,999,999', barPct: 50 },
    { name: 'B', value: '$5', barPct: 50 },
    { name: 'C', value: 'IDR 20,000,000,000,000', barPct: 100 },
  ];

  it('gives every bar track the same length, whatever its stage content', () => {
    const { container } = render(<Funnel stages={stages} />);
    const bars = Array.from(container.querySelectorAll('[data-funnel-stage-bar]'));
    expect(bars).toHaveLength(3);
    expect(new Set(bars.map(trackWidth)).size).toBe(1);
    expect(trackWidth(bars[0])).toMatch(/^\d+(\.\d+)?rem$/);
  });

  it('draws equal values at equal fill and unequal ones in proportion to the largest', () => {
    const { container } = render(<Funnel stages={stages} />);
    const fills = Array.from(container.querySelectorAll('[data-funnel-stage-bar]')).map(fillPct);
    expect(fills[0]).toBe(fills[1]);
    expect(fills[2]).toBe(100);
    expect(fills[0] / fills[2]).toBeCloseTo(0.5, 6);
  });

  it('keeps every stage at least as wide as the bar track so the track never overflows its stage', () => {
    const { container } = render(<Funnel stages={stages} />);
    const track = parseFloat(trackWidth(container.querySelector('[data-funnel-stage-bar]')!));
    for (const stage of Array.from(container.querySelectorAll('[data-funnel-stage]'))) {
      expect(parseFloat((stage as HTMLElement).style.minWidth)).toBeGreaterThan(track);
    }
  });
});

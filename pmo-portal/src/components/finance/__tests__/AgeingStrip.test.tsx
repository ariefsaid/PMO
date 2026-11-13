import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AgeingStrip } from '../AgeingStrip';

vi.mock('@/src/hooks/useOrgCurrency', () => ({ useOrgCurrencyState: () => ({ currency: 'IDR', isResolved: true, isError: false }) }));

/** One currency's payables buckets, in the strip's bar order. */
function payables(amounts: { d0_30: number; d31_60: number; d61_90: number; over90: number }) {
  return { IDR: amounts };
}

/** Every painted segment of one currency's bar, in bar order. */
function segmentsOf(currency = 'IDR'): HTMLElement[] {
  const bar = screen.getByTestId(`ageing-bar-${currency}`);
  return Array.from(bar.querySelectorAll<HTMLElement>('[data-testid^="ageing-segment-"]'));
}

/** The percentage one edge of a segment names in its inline geometry. */
function percentageOf(value: string): number {
  const match = /(-?\d+(?:\.\d+)?)%/.exec(value);
  return match ? Number.parseFloat(match[1] ?? '0') : Number.NaN;
}

/** Four decimals is the precision the bar paints at, so comparisons happen there. */
const round = (value: number) => Math.round(value * 10_000) / 10_000;

const leftOf = (segment: HTMLElement) => percentageOf(segment.style.left);
const widthOf = (segment: HTMLElement) => percentageOf(segment.style.width);
const rightOf = (segment: HTMLElement) => leftOf(segment) + widthOf(segment);
// The segment widths tiling 100 percent is the shared bar's own promise, so that test lives beside it
// in `../__tests__/SplitBar.test.tsx` (round 4: the extraction moved the geometry there).

describe('Ageing strip bar', () => {
  it('item 1: the bar is painted from its column’s left edge to its right edge', () => {
    render(
      <AgeingStrip
        kind="payables"
        payablesStatusColors
        values={payables({ d0_30: 1_000_000, d31_60: 2_000_000, d61_90: 3_000_000, over90: 4_000_000 })}
      />,
    );

    const bar = screen.getByTestId('ageing-bar-IDR');
    const legend = screen.getByTestId('ageing-legend-IDR');
    // The bar and the amount legend are the two rows of one column, so the bar's box is exactly as
    // wide as the amounts under it: nothing is inset between them.
    expect(bar.parentElement).toBe(legend.parentElement);

    const painted = segmentsOf();
    expect(painted).toHaveLength(4);
    // A person reads the bar against the amounts below it, so the paint starts on the column's left
    // edge and finishes on its right edge — never a few pixels short of it.
    expect(round(leftOf(painted[0]!))).toBe(0);
    expect(round(rightOf(painted[painted.length - 1]!))).toBe(100);
  });

  it('item 2: adjacent segments share one edge, so no lighter seam shows between them', () => {
    render(
      <AgeingStrip
        kind="payables"
        payablesStatusColors
        values={payables({ d0_30: 3, d31_60: 7, d61_90: 11, over90: 13 })}
      />,
    );

    const painted = segmentsOf();
    expect(painted).toHaveLength(4);
    for (let index = 1; index < painted.length; index += 1) {
      // The next segment starts exactly where the previous one ends: the surface behind the bar has
      // no room to show through, which is what a 1px lighter column at a join is.
      expect(round(leftOf(painted[index]!))).toBe(round(rightOf(painted[index - 1]!)));
    }
    for (let index = 0; index < painted.length - 1; index += 1) {
      // The same edge, from the other side: a segment never paints over the one after it.
      expect(round(rightOf(painted[index]!))).toBeLessThanOrEqual(round(leftOf(painted[index + 1]!)));
    }
  });
});

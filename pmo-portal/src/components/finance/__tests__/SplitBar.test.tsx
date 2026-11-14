import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SplitBar, type SplitBarPart } from '../SplitBar';

/** One part of a bar, with only what a test cares about spelled out. */
const part = (partIn: Partial<SplitBarPart> & Pick<SplitBarPart, 'key'>): SplitBarPart => ({
  amount: 0,
  color: 'hsl(var(--primary))',
  label: partIn.key,
  amountLabel: '0',
  ...partIn,
});

/** Owed to us: 300 not yet due, 100 overdue — the two parts a reader sees named. */
const owed: SplitBarPart[] = [
  part({ key: 'notDue', amount: 300, label: 'Not yet due', amountLabel: '$300', testId: 'segment-notDue' }),
  part({ key: 'overdue', amount: 100, label: 'Overdue', amountLabel: '$100', testId: 'segment-overdue' }),
];

/** Every painted segment of a bar, in bar order. */
const segmentsIn = (bar: HTMLElement): HTMLElement[] =>
  Array.from(bar.querySelectorAll<HTMLElement>('[data-testid^="segment-"]'));

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

describe('Split bar', () => {
  it('names each part it draws and that part’s amount, as one picture', () => {
    render(<SplitBar label="Owed to us, split by due date" parts={owed} />);

    const bar = screen.getByRole('img', { name: 'Owed to us, split by due date. Not yet due $300, Overdue $100' });
    // The bar is a picture to a reader who cannot see it: the words, not the paint, carry the split.
    expect(bar).toBeInTheDocument();
  });

  it('a part with no known amount is not drawn and not named', () => {
    render(
      <SplitBar
        label="Owed to us, split by due date"
        parts={[owed[0]!, part({ key: 'overdue', label: 'Overdue', amount: 0, amountLabel: '$0', testId: 'segment-overdue' })]}
      />,
    );

    const bar = screen.getByRole('img');
    // A zero part is absent from the alternative: nothing paints, so nothing is claimed.
    expect(bar).toHaveAccessibleName('Owed to us, split by due date. Not yet due $300');
    expect(screen.queryByTestId('segment-overdue')).toBeNull();
    expect(segmentsIn(bar)).toHaveLength(1);
  });

  it('draws no bar at all when no part has a known amount', () => {
    const allUnknown = [part({ key: 'notDue', label: 'Not yet due', amount: 0, amountLabel: '$0', testId: 'segment-notDue' })];

    const plain = render(<SplitBar label="Owed to us, split by due date" parts={allUnknown} />);
    // Every part unknown: there is no picture to name, so there is no picture.
    expect(screen.queryByRole('img')).toBeNull();
    plain.unmount();

    const { container } = render(<SplitBar label="Owed to us, split by due date" parts={allUnknown} emptyClassName="bg-muted" />);
    // A caller may keep its empty track on screen, but it claims nothing and names nothing.
    expect(screen.queryByRole('img')).toBeNull();
    expect(container.querySelectorAll('[data-testid^="segment-"]')).toHaveLength(0);
  });

  it('draws a single part as the whole bar', () => {
    render(<SplitBar label="Owed to us, split by due date" parts={[owed[0]!]} />);

    const bar = screen.getByRole('img', { name: 'Owed to us, split by due date. Not yet due $300' });
    const painted = segmentsIn(bar);
    expect(painted).toHaveLength(1);
    expect(round(leftOf(painted[0]!))).toBe(0);
    expect(round(rightOf(painted[0]!))).toBe(100);
  });

  it('the painted parts tile the bar exactly, whatever the mix of amounts', () => {
    const mixes = [
      { name: 'one part only', amounts: [0, 0, 0, 987_654] },
      { name: 'three equal parts that do not divide evenly', amounts: [1, 1, 1, 0] },
      { name: 'amounts with no common divisor', amounts: [3, 7, 11, 13] },
      { name: 'empty parts in the middle', amounts: [0, 5, 0, 5] },
      { name: 'large amounts that do not divide evenly', amounts: [1_000_000, 1_000_001, 1_000_002, 7_000_003] },
    ];

    for (const mix of mixes) {
      const parts = mix.amounts.map((amount, index) => part({ key: `p${index}`, amount, label: `Part ${index + 1}`, amountLabel: String(amount), testId: `segment-${index}` }));
      const view = render(<SplitBar label="A mix" parts={parts} />);

      const painted = segmentsIn(screen.getByRole('img'));
      expect(painted, mix.name).toHaveLength(mix.amounts.filter((amount) => amount > 0).length);
      const widths = painted.map(widthOf);
      const sum = widths.reduce((running, width) => running + width, 0);
      // The painted shares add up to the whole bar, so no rounded remainder is left unpainted at either end.
      expect(round(sum), mix.name).toBe(100);
      expect(round(leftOf(painted[0]!)), mix.name).toBe(0);
      expect(round(rightOf(painted[painted.length - 1]!)), mix.name).toBe(100);
      // Neighbours share one edge, so the surface behind the bar has no room to show through a join.
      for (let index = 1; index < painted.length; index += 1) {
        expect(round(leftOf(painted[index]!)), mix.name).toBe(round(rightOf(painted[index - 1]!)));
      }

      view.unmount();
    }
  });
});

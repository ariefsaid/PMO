import React from 'react';
import { render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BarList, MonthColumns } from './charts';

const seen: Array<Record<string, unknown>> = [];

vi.mock('recharts', () => ({
  Bar: (props: Record<string, unknown> & { children?: React.ReactNode }) => {
    seen.push(props);
    return <g>{props.children}</g>;
  },
  BarChart: ({ children }: { children?: React.ReactNode }) => <g>{children}</g>,
  Cell: () => null,
  LabelList: () => null,
  ResponsiveContainer: ({ children }: { children?: React.ReactNode }) => <svg>{children}</svg>,
  Tooltip: () => null,
  XAxis: () => null,
  YAxis: () => null,
}));

/** #2125: every series charts.tsx hands to recharts is drawn on the first frame. */
describe('charts.tsx series render without entrance animation', () => {
  beforeEach(() => {
    seen.length = 0;
  });

  it('BarList passes isAnimationActive={false} to its single and paired series', () => {
    render(<BarList ariaLabel="One" rows={[{ id: 'r', name: 'R', value: 3, label: '3' }]} />);
    render(<BarList ariaLabel="Two" rows={[{ id: 'r', name: 'R', value: 3, label: '3', value2: 2, label2: '2' }]} />);
    expect(seen).toHaveLength(3);
    for (const props of seen) expect(props.isAnimationActive).toBe(false);
  });

  it('MonthColumns passes isAnimationActive={false} to its single and paired series', () => {
    render(<MonthColumns ariaLabel="One" points={[{ key: 'j', tick: 'Jan', a: 1, labelA: '1' }]} />);
    render(<MonthColumns ariaLabel="Two" points={[{ key: 'j', tick: 'Jan', a: 1, labelA: '1', b: 2, labelB: '2' }]} />);
    expect(seen).toHaveLength(3);
    for (const props of seen) expect(props.isAnimationActive).toBe(false);
  });
});

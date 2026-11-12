/** The column that carries a label in `peak` mode: the tallest column of either series, and the latest month's first series. */
export function peakLabelIndexes(data: Array<{ a: number | null; b?: number | null }>): { peak: { index: number; series: 'a' | 'b' } | null; last: number } {
  let peak: { index: number; series: 'a' | 'b' } | null = null;
  let peakValue = 0;
  let last = -1;
  for (let index = 0; index < data.length; index += 1) {
    for (const series of ['a', 'b'] as const) {
      const value = data[index][series];
      if (value != null && value > peakValue) { peak = { index, series }; peakValue = value; }
    }
    if (data[index].a != null && data[index].a !== 0) last = index;
  }
  return { peak, last };
}

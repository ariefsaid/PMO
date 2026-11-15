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

/** Height of one value-label row (the label's 14px type plus 2px air). */
export const PAIRED_ROW = 16;
/** Plot top for paired labels: the usual label room plus the second row. */
export const PAIRED_TOP_MARGIN = 22 + PAIRED_ROW;

/**
 * `centerOnBar` rows: both labels of a month sit ABOVE the taller of its two columns, the first series one row
 * higher than the second, so they never touch each other or a column, however close the two amounts are.
 * The other column's top comes from the same scale as this one (its height per unit of value).
 */
export function pairedLabelY(data: Array<{ a: number | null; b?: number | null }>, series: 'a' | 'b', props: { y?: number | string; height?: number | string; index?: number }): number {
  const y = Number(props.y ?? 0);
  const height = Number(props.height ?? 0);
  const point = data[props.index ?? 0];
  const self = Number(point?.[series] ?? 0);
  const other = Number(point?.[series === 'a' ? 'b' : 'a'] ?? 0);
  const base = y + height;
  const otherTop = self > 0 && other > 0 ? base - (other / self) * height : y;
  // A tiny column drawn at its minimum height can overstate the scale; no column rises above the plot top.
  const top = Math.max(Math.min(y, otherTop), PAIRED_TOP_MARGIN);
  // The first series takes the upper row only when the second series has a label of its own.
  return top - 5 - (series === 'a' && other > 0 ? PAIRED_ROW : 0);
}

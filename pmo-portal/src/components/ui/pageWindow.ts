/** Page numbers to show: first, last, the current page and `siblings` pages each side; 'gap' stands for a skipped run. */
export function pageWindow(page: number, pageCount: number, siblings = 1): Array<number | 'gap'> {
  const keep = new Set([1, pageCount, ...Array.from({ length: siblings * 2 + 1 }, (_, i) => page - siblings + i)].filter((p) => p >= 1 && p <= pageCount));
  const sorted = [...keep].sort((a, b) => a - b);
  const out: Array<number | 'gap'> = [];
  sorted.forEach((p, i) => {
    const prev = sorted[i - 1];
    if (prev !== undefined && p - prev === 2) out.push(prev + 1);
    else if (prev !== undefined && p - prev > 2) out.push('gap');
    out.push(p);
  });
  return out;
}

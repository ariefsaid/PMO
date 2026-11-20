import { describe, it, expect } from 'vitest';
import { deriveScopeProgress } from './workOrderProgress';

const item = (id: string, rate: number, extra: Partial<{ item_code: string; unit: string; earning_basis: string; description: string }> = {}) =>
  ({ id, rate, item_code: extra.item_code ?? id, unit: extra.unit ?? 'm', earning_basis: extra.earning_basis ?? 'measured', description: extra.description ?? id });
const line = (boq: string, qty: number) => ({ id: `l-${boq}`, boq_item_id: boq, quantity: qty });
const bast = (status: string, lines: Array<[string, number]>) => ({ status, lines: lines.map(([b, q]) => ({ boq_item_id: b, quantity: q })) });

describe('AC-WORP-005 deriveScopeProgress', () => {
  it('counts only confirmed acceptances toward accepted quantity and percent per line', () => {
    const r = deriveScopeProgress(
      [line('a', 100), line('b', 10)],
      [item('a', 5), item('b', 50)],
      [bast('Confirmed', [['a', 25]]), bast('Confirmed', [['a', 25]]), bast('Draft', [['a', 40]]), bast('Withdrawn', [['b', 10]])],
    );
    expect(r.lines.map((l) => [l.boqItemId, l.allocated, l.accepted, l.percent])).toEqual([['a', 100, 50, 50], ['b', 10, 0, 0]]);
  });
  it('weights the overall percent by value (rate x quantity)', () => {
    const r = deriveScopeProgress([line('a', 100), line('b', 10)], [item('a', 5), item('b', 50)], [bast('Confirmed', [['b', 10]])]);
    // a: 500 allocated, 0 accepted; b: 500 allocated, 500 accepted => 50%
    expect(r.overallPercent).toBe(50);
  });
  it('has no overall percent when nothing is allocated, and never divides by zero', () => {
    expect(deriveScopeProgress([], [], []).overallPercent).toBeNull();
    expect(deriveScopeProgress([line('a', 0)], [item('a', 5)], []).lines[0].percent).toBeNull();
  });
  it('caps displayed percent at 100 but keeps the raw accepted quantity', () => {
    const r = deriveScopeProgress([line('a', 10)], [item('a', 1)], [bast('Confirmed', [['a', 12]])]);
    expect(r.lines[0]).toMatchObject({ accepted: 12, percent: 100 });
  });
  it('keeps a line whose BoQ item cannot be read, without a code', () => {
    const r = deriveScopeProgress([line('x', 4)], [], []);
    expect(r.lines[0]).toMatchObject({ boqItemId: 'x', itemCode: null, percent: 0 });
    expect(r.overallPercent).toBeNull();
  });
});

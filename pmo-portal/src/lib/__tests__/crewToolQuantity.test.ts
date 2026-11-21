import { describe, expect, it } from 'vitest';
import {
  applyClose,
  canReport,
  summariseLine,
  type ToolReport,
} from '@/src/lib/crewToolQuantity';

const rep = (over: Partial<ToolReport> & Pick<ToolReport, 'id' | 'kind' | 'qty'>): ToolReport => ({
  status: 'open',
  due_on: '2026-12-01',
  ...over,
});

describe('crew tool quantities', () => {
  // The hand calculation of the spec: crew A holds 6 hammers.
  it('AC-CTR-001 usable is 5 after one damaged, 3 after two lost, and a further 4 is refused', () => {
    const damaged = rep({ id: 'a', kind: 'damaged', qty: 1 });
    const lost = rep({ id: 'b', kind: 'lost', qty: 2 });
    expect(summariseLine(6, [], '2026-11-20').usable).toBe(6);
    expect(summariseLine(6, [damaged], '2026-11-20').usable).toBe(5);
    expect(summariseLine(6, [damaged, lost], '2026-11-20').usable).toBe(3);
    expect(canReport(6, [damaged, lost], 4)).toEqual({ ok: false, usable: 3 });
    expect(canReport(6, [damaged, lost], 3)).toEqual({ ok: true, usable: 3 });
  });

  it('AC-CTR-001 only whole positive numbers can be reported', () => {
    expect(canReport(6, [], 0).ok).toBe(false);
    expect(canReport(6, [], 1.5).ok).toBe(false);
    expect(canReport(6, [], -1).ok).toBe(false);
  });

  it('AC-CTR-011 an open report past its due date reads overdue and still keeps its quantity out of usable', () => {
    const late = rep({ id: 'a', kind: 'damaged', qty: 2, due_on: '2026-11-19' });
    const onTime = rep({ id: 'b', kind: 'lost', qty: 1, due_on: '2026-11-20' });
    const s = summariseLine(6, [late, onTime], '2026-11-20');
    expect(s.overdueIds).toEqual(['a']);
    expect(s.usable).toBe(3);
    expect(s.damaged).toBe(2);
    expect(s.lost).toBe(1);
  });

  it('closed reports leave the open sums and are never overdue', () => {
    const closed = rep({ id: 'a', kind: 'damaged', qty: 2, status: 'closed', due_on: '2026-11-01' });
    const s = summariseLine(6, [closed], '2026-11-20');
    expect(s).toMatchObject({ damaged: 0, lost: 0, usable: 6, overdueIds: [] });
  });

  it('usable is never negative', () => {
    expect(summariseLine(1, [rep({ id: 'a', kind: 'damaged', qty: 5 })], '2026-11-20').usable).toBe(0);
  });

  it('AC-CTR-007 repaired and replaced keep held; written_off lowers it by the report quantity', () => {
    const damaged = rep({ id: 'a', kind: 'damaged', qty: 1 });
    const lost = rep({ id: 'b', kind: 'lost', qty: 2 });
    const both = [damaged, lost];
    // repaired the damaged one: held 6, open lost 2, usable 4
    let held = applyClose(6, damaged, 'repaired');
    expect(held).toBe(6);
    expect(summariseLine(held, [lost], '2026-11-20').usable).toBe(4);
    // lost closed replaced: held 6, usable 6
    expect(summariseLine(applyClose(held, lost, 'replaced'), [], '2026-11-20').usable).toBe(6);
    // lost closed written_off: held 4, usable 4
    held = applyClose(held, lost, 'written_off');
    expect(held).toBe(4);
    expect(summariseLine(held, [], '2026-11-20').usable).toBe(4);
    expect(both).toHaveLength(2);
  });

  it('AC-CTR-007 repaired is refused for a lost report and written_off may take held to 0', () => {
    expect(() => applyClose(6, rep({ id: 'b', kind: 'lost', qty: 2 }), 'repaired')).toThrow();
    expect(applyClose(2, rep({ id: 'c', kind: 'damaged', qty: 2 }), 'written_off')).toBe(0);
  });
});

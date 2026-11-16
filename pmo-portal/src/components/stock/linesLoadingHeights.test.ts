import { describe, expect, it } from 'vitest';
import { MOVEMENT_LINES_RESERVE, writeOffLinesReserve } from './linesLoadingHeights';

describe('line editor loading reserve (#2197)', () => {
  it('a new count with no warehouse reserves the smaller form, and grows by the fill action once one is chosen', () => {
    expect(writeOffLinesReserve({ kind: 'count', hasWarehouse: false })).toEqual({ phone: 234, md: 134 });
    expect(writeOffLinesReserve({ kind: 'count', hasWarehouse: true })).toEqual({ phone: 290, md: 176 });
  });
  it('a new adjustment is the same with or without a warehouse', () => {
    expect(writeOffLinesReserve({ kind: 'adjustment', hasWarehouse: false })).toEqual(writeOffLinesReserve({ kind: 'adjustment', hasWarehouse: true }));
  });
  it('a reopened draft sizes to its lines, and an adjustment adds a cost field per in-direction line', () => {
    expect(writeOffLinesReserve({ kind: 'count', hasWarehouse: true, draftLines: 2 })).toEqual({ phone: 640, md: 412 });
    expect(writeOffLinesReserve({ kind: 'adjustment', hasWarehouse: true, draftLines: 2, inDirectionLines: 0 })).toEqual({ phone: 756, md: 370 });
    expect(writeOffLinesReserve({ kind: 'adjustment', hasWarehouse: true, draftLines: 1, inDirectionLines: 1 })).toEqual({ phone: 456, md: 210 });
  });
  it('every movement kind has a reserve', () => {
    for (const k of ['receive', 'issue', 'return', 'transfer']) expect(MOVEMENT_LINES_RESERVE[k].md).toBeGreaterThan(0);
  });
});

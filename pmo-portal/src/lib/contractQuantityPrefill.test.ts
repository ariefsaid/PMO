import { describe, expect, it } from 'vitest';
import type { AllocationFacts, ContractLineFacts } from './progressBilling';
import { prefillForWorkOrder } from './contractQuantityPrefill';

const alloc = (over: Partial<AllocationFacts>): AllocationFacts => ({
  workOrderId: 'wo-1', boqItemId: 'b1', quantity: 10, claimedQuantity: 0, acceptedQuantity: null, final: false, ...over,
});
const line = (...allocations: AllocationFacts[]): ContractLineFacts[] => {
  const ids = [...new Set(allocations.map((a) => a.boqItemId))];
  return ids.map((id) => ({
    boqItemId: id, earningBasis: 'unit_rate', lineNo: 1, orderedQuantity: 10, acceptedQuantity: 0, closedFinal: 0,
    earnedQuantity: 0, contractBalance: 0, allocations: allocations.filter((a) => a.boqItemId === id),
  } as ContractLineFacts));
};
const run = (rows: AllocationFacts[], assessed: Record<string, number>, claimedAll: Record<string, number>) =>
  prefillForWorkOrder('wo-1', [...new Set(rows.map((a) => a.boqItemId))], line(...rows), assessed, claimedAll);

describe('work-order claim pre-fill (AC-CQ-013)', () => {
  it('AC-CQ-013 with a confirmed BAST the suggestion is accepted less claimed on this work order', () => {
    const out = run([alloc({ acceptedQuantity: 8.125, claimedQuantity: 3 })], {}, {});
    expect(out.quantities).toEqual({ b1: 5.125 });
    expect(out.fromBast).toBe(true);
  });

  it('AC-CQ-013 a BAST of zero is a BAST: it suggests nothing even where assessment is higher', () => {
    expect(run([alloc({ acceptedQuantity: 0 })], { b1: 9 }, {})).toEqual({ quantities: {}, fromBast: false });
  });

  it('AC-CQ-013 without a BAST the suggestion is the smaller of assessed-less-claimed-everywhere and allocated-less-claimed-here', () => {
    expect(run([alloc({ claimedQuantity: 2 })], { b1: 9 }, { b1: 4 }).quantities).toEqual({ b1: 5 });
    expect(run([alloc({ claimedQuantity: 2 })], { b1: 9 }, { b1: 0 }).quantities).toEqual({ b1: 8 });
  });

  it('AC-CQ-013 an unassessed line (no entry) is omitted, and so is an assessed-zero line', () => {
    expect(run([alloc({})], {}, {}).quantities).toEqual({});
    expect(run([alloc({})], { b1: 0 }, {}).quantities).toEqual({});
  });

  it('AC-CQ-013 non-positive suggestions are omitted and arithmetic is exact in milli-units', () => {
    const rows = [alloc({ boqItemId: 'b1', acceptedQuantity: 1, claimedQuantity: 2 }), alloc({ boqItemId: 'b2', acceptedQuantity: 0.3, claimedQuantity: 0.1 })];
    expect(run(rows, {}, {}).quantities).toEqual({ b2: 0.2 });
  });

  it('AC-CQ-013 a line not allocated to this work order is skipped', () => {
    expect(prefillForWorkOrder('wo-2', ['b1'], line(alloc({ acceptedQuantity: 5 })), {}, {}).quantities).toEqual({});
  });
});

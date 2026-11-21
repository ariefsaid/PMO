import { describe, it, expect } from 'vitest';
import { computeConsumablePlan, remainingQuantity, diffPlan, type PlanLineInput, type UsageStandard } from './consumablePlan';

const rod: UsageStandard = { id: 's-rod', itemId: 'rod', workUnit: 'dia-inch', boqCodePrefix: 'WLD', qtyPerUnit: '0.05', marginPct: '10' };
const disc: UsageStandard = { id: 's-disc', itemId: 'disc', workUnit: 'dia-inch', boqCodePrefix: null, qtyPerUnit: '0.2', marginPct: '0' };
const lines: PlanLineInput[] = [
  { boqItemId: 'b1', code: 'WLD-01', unit: 'dia-inch', quantity: '120' },
  { boqItemId: 'b2', code: 'WLD-02', unit: ' Dia-Inch ', quantity: '40' },
  { boqItemId: 'b3', code: 'CIV-01', unit: 'm3', quantity: '10' },
];

describe('computeConsumablePlan (#2577)', () => {
  it('AC-CUS-001 the hand-worked work order: rod 8.800, disc 32.000, CIV-01 has no standard', () => {
    const r = computeConsumablePlan(lines, [rod, disc]);
    expect(r.items.map((i) => [i.itemId, i.generatedQty])).toEqual([['disc', '32.000'], ['rod', '8.800']]);
    expect(r.noStandard.map((l) => l.code)).toEqual(['CIV-01']);
    const rodBasis = r.items.find((i) => i.itemId === 'rod')!.basis;
    expect(rodBasis.map((b) => b.workQty)).toEqual(['120', '40']);
    expect(rodBasis.reduce((n, b) => n + Number(b.workQty), 0)).toBe(160);
  });

  it('AC-CUS-002 rounds once per item, not per line (0.3 + 0.3 at 1.05 = 0.630, per-line rounding would give 0.64)', () => {
    const std: UsageStandard = { id: 's', itemId: 'x', workUnit: 'm', boqCodePrefix: null, qtyPerUnit: '1.05', marginPct: '0' };
    const r = computeConsumablePlan([
      { boqItemId: 'a', code: 'A', unit: 'm', quantity: '0.3' },
      { boqItemId: 'b', code: 'B', unit: 'm', quantity: '0.3' },
    ], [std]);
    expect(r.items[0].generatedQty).toBe('0.630');
    // each line alone is 0.315, which rounds up to 0.32 and would sum to 0.64
    expect(computeConsumablePlan([{ boqItemId: 'a', code: 'A', unit: 'm', quantity: '0.3' }], [std]).items[0].generatedQty).toBe('0.315');
  });

  it('rounds half up at the third decimal, in exact decimals (no float drift)', () => {
    const std: UsageStandard = { id: 's', itemId: 'x', workUnit: 'm', boqCodePrefix: null, qtyPerUnit: '0.0005', marginPct: '0' };
    expect(computeConsumablePlan([{ boqItemId: 'a', code: 'A', unit: 'm', quantity: '1' }], [std]).items[0].generatedQty).toBe('0.001');
    const std2: UsageStandard = { ...std, qtyPerUnit: '1.005' };
    expect(computeConsumablePlan([{ boqItemId: 'a', code: 'A', unit: 'm', quantity: '1' }], [std2]).items[0].generatedQty).toBe('1.005');
  });

  it('AC-CUS-003 the longest prefix wins per line and item; archived-looking duplicates are the server\'s concern', () => {
    const longer: UsageStandard = { id: 's-long', itemId: 'rod', workUnit: 'dia-inch', boqCodePrefix: 'WLD-01', qtyPerUnit: '0.1', marginPct: '0' };
    const r = computeConsumablePlan([{ boqItemId: 'b1', code: 'wld-01-b', unit: 'dia-inch', quantity: '10' }], [rod, longer]);
    expect(r.items).toHaveLength(1);
    expect(r.items[0].generatedQty).toBe('1.000');
    expect(r.items[0].basis[0].standardId).toBe('s-long');
  });

  it('matches the prefix case-blind and not by a wildcard', () => {
    const wild: UsageStandard = { ...rod, boqCodePrefix: 'W%' };
    expect(computeConsumablePlan(lines, [wild]).items).toHaveLength(0);
    expect(computeConsumablePlan(lines, [{ ...rod, boqCodePrefix: 'wld' }]).items[0].generatedQty).toBe('8.800');
  });

  it('a unit that differs matches nothing; no standards lists every line', () => {
    expect(computeConsumablePlan(lines, [{ ...rod, workUnit: 'kg' }]).items).toEqual([]);
    expect(computeConsumablePlan(lines, []).noStandard).toHaveLength(3);
  });
});

describe('remainingQuantity (#2577)', () => {
  it('AC-CUS-013 remaining = planned - already requested', () => {
    expect(remainingQuantity('8.800', '3.000')).toBe('5.8');
  });
  it('AC-CUS-013 is shown even when negative, never clamped to zero', () => {
    expect(remainingQuantity('8.800', '9.000')).toBe('-0.2');
    expect(remainingQuantity('0', '1.5')).toBe('-1.5');
  });
});

describe('diffPlan (#2577, FR-CUS-007)', () => {
  it('lists the old and new generated quantity per item before a regeneration', () => {
    const d = diffPlan(
      [{ itemId: 'rod', generatedQty: '8.800', adjustedQty: '12.000' }, { itemId: 'gone', generatedQty: '2.000', adjustedQty: null }],
      [{ itemId: 'rod', generatedQty: '9.350' }, { itemId: 'new', generatedQty: '1.000' }],
    );
    expect(d).toEqual([
      { itemId: 'gone', oldQty: '2.000', newQty: null, change: 'removed', keepsAdjustment: false },
      { itemId: 'new', oldQty: null, newQty: '1.000', change: 'added', keepsAdjustment: false },
      { itemId: 'rod', oldQty: '8.800', newQty: '9.350', change: 'changed', keepsAdjustment: true },
    ]);
  });
  it('an adjusted item whose standard no longer matches is kept at generated 0', () => {
    expect(diffPlan([{ itemId: 'rod', generatedQty: '8.800', adjustedQty: '12.000' }], [])).toEqual([
      { itemId: 'rod', oldQty: '8.800', newQty: '0.000', change: 'changed', keepsAdjustment: true },
    ]);
  });
  it('unchanged items are not listed', () => {
    expect(diffPlan([{ itemId: 'a', generatedQty: '1.000', adjustedQty: null }], [{ itemId: 'a', generatedQty: '1.000' }])).toEqual([]);
  });
});

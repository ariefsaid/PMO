import { describe, it, expect } from 'vitest';
import { calculatedPct, effectivePct, projectDeliveryPct } from './delivery';

describe('delivery derivation (AC-DEL-001..007)', () => {
  it('AC-DEL-001: calculatedPct(3,5) → 60', () => {
    expect(calculatedPct(3, 5)).toBe(60);
  });

  it('AC-DEL-002: calculatedPct(0,0) → null (no tasks)', () => {
    expect(calculatedPct(0, 0)).toBeNull();
  });

  it('AC-DEL-003: effectivePct({input:75,calculated:40}) → 75', () => {
    expect(effectivePct({ input: 75, calculated: 40 })).toBe(75);
  });

  it('AC-DEL-004: effectivePct({input:null,calculated:40}) → 40', () => {
    expect(effectivePct({ input: null, calculated: 40 })).toBe(40);
  });

  it('AC-DEL-005: effectivePct({input:null,calculated:null}) → 0', () => {
    expect(effectivePct({ input: null, calculated: null })).toBe(0);
  });

  it('AC-DEL-006: projectDeliveryPct([{w:20,eff:100},{w:30,eff:40},{w:50,eff:0}]) → 32', () => {
    expect(
      projectDeliveryPct([
        { weight: 20, effective: 100 },
        { weight: 30, effective: 40 },
        { weight: 50, effective: 0 },
      ]),
    ).toBe(32);
  });

  it('AC-DEL-007: projectDeliveryPct([]) → null', () => {
    expect(projectDeliveryPct([])).toBeNull();
  });
});

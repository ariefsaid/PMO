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

  it('I-1: projectDeliveryPct returns null when ALL milestones have no signal (null calculated + null input)', () => {
    // All milestones have effective=0 but the signal is null — no tasks, no input.
    // This should return null (misleading 0% chip suppressed).
    expect(
      projectDeliveryPct([
        { weight: 1, effective: 0, hasSignal: false },
        { weight: 1, effective: 0, hasSignal: false },
      ]),
    ).toBeNull();
  });

  it('I-1: projectDeliveryPct returns 0 when at least one milestone has real signal (e.g. tasks but none done)', () => {
    // One milestone has tasks (calculated=0), so there IS signal.
    expect(
      projectDeliveryPct([
        { weight: 1, effective: 0, hasSignal: true },
        { weight: 1, effective: 0, hasSignal: false },
      ]),
    ).toBe(0);
  });

  it('I-1: projectDeliveryPct returns correct value when mixed signal (some null-signal, some real)', () => {
    expect(
      projectDeliveryPct([
        { weight: 20, effective: 100, hasSignal: true },
        { weight: 30, effective: 40, hasSignal: true },
        { weight: 50, effective: 0, hasSignal: false },
      ]),
    ).toBe(32);
  });
});

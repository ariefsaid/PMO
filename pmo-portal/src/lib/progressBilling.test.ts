import { describe, expect, it } from 'vitest';
import { fromCents, pctOf, toCents } from '@/src/lib/reports/managementPack';
import { claimNet, prefillFromAssessment, remainingQuantity, suggestedRecoveryPct, summarizeBilling } from './progressBilling';

const FACTS = {
  currency: 'IDR', contractNet: 1_000_000, workBilled: 200_000, dpBilled: 200_000,
  dpRecovered: 40_000, notSubmitted: 40_000, assessment: null,
  claimedByBoqItem: { b1: 5 }, assessedByBoqItem: {},
};

describe('progress billing helpers', () => {
  it('AC-PB-016 down payment held and contract not yet billed are exact', () => {
    expect(summarizeBilling(FACTS)).toMatchObject({ dpHeld: 160_000, remaining: 800_000 });
    expect(summarizeBilling({ ...FACTS, contractNet: 0.3, workBilled: 0.1 }).remaining).toBe(0.2);
  });

  it('AC-PB-016 nothing is clamped: billing past the contract and over-recovery read negative', () => {
    expect(summarizeBilling({ ...FACTS, workBilled: 1_100_000, dpRecovered: 250_000 })).toMatchObject({ remaining: -100_000, dpHeld: -50_000 });
  });

  it("AC-PB-016 assessed to date is the management pack's recognised figure and the gap is assessed less billed", () => {
    const summary = summarizeBilling({ ...FACTS, assessment: { month: '2026-10-01', pctComplete: 60 } });
    expect(summary.assessedToDate).toBe(fromCents(pctOf(toCents(1_000_000), 60)));
    expect(summary.assessedToDate).toBe(600_000);
    expect(summary.unbilledWork).toBe(400_000);
  });

  it('AC-PB-016 without an assessment there is no assessed figure and no gap — never 0', () => {
    expect(summarizeBilling(FACTS)).toMatchObject({ assessedToDate: null, unbilledWork: null });
  });

  it('AC-PB-016 billing ahead of the assessment reads a negative gap', () => {
    expect(summarizeBilling({ ...FACTS, assessment: { month: '2026-10-01', pctComplete: 10 } }).unbilledWork).toBe(-100_000);
  });

  it('AC-PB-016 remaining quantity is exact to 3 decimals and negative when over-claimed', () => {
    expect(remainingQuantity(10, 4.125)).toBe(5.875);
    expect(remainingQuantity(10, 12)).toBe(-2);
    expect(remainingQuantity(0.3, 0.1)).toBe(0.2);
  });

  it('AC-PB-016 the proportional percentage is DP / contract x 100 to 3 decimals', () => {
    expect(suggestedRecoveryPct(200_000, 1_000_000)).toBe(20);
    expect(suggestedRecoveryPct(100_000, 300_000)).toBe(33.333);
    expect(suggestedRecoveryPct(200_000, 0)).toBeNull();
    expect(suggestedRecoveryPct(0, 1_000_000)).toBeNull();
    expect(suggestedRecoveryPct(2_000_000, 1_000_000)).toBe(100);
  });

  it('AC-PB-016 a claim net is gross less recovery in cents', () => {
    expect(claimNet(200_000, 40_000)).toBe(160_000);
    expect(claimNet(0.3, 0.1)).toBe(0.2);
  });

  it('AC-PB-016 the assessment pre-fill is assessed less claimed, omitting lines not above zero', () => {
    expect(prefillFromAssessment(['b1', 'b2', 'b3'], { b1: 6, b2: 1, b3: 0.3 }, { b1: 4, b2: 3, b3: 0.1 })).toEqual({ b1: 2, b3: 0.2 });
    expect(prefillFromAssessment(['b1'], {}, { b1: 1 })).toEqual({});
  });
});

/**
 * AC-RB-004..007 (helper layer) — computeBudgetSignal
 *
 * Pure-unit proof of the Reserved-budget derivations extracted from
 * DecisionSupportPanel (ADR-0034 §5). The discriminating numbers mirror the
 * panel's AC-RB-006/007 rendered tests so the helper unit-proves the same
 * double-count boundary the panel currently proves through rendering.
 */
import { describe, it, expect } from 'vitest';
import { computeBudgetSignal } from './computeBudgetSignal';

describe('computeBudgetSignal — Available = Budget − Committed − Reserved (AC-RB-004)', () => {
  it('AC-RB-004: budget 1000 / committed 300 / reserved 200 → available $500', () => {
    const s = computeBudgetSignal({
      budget: 1000,
      committed: 300,
      reserved: 200,
      totalValue: 0,
      status: 'Requested',
    });
    expect(s.available).toBe(500);
  });

  it('AC-RB-004: available is negative when committed + reserved exceed budget', () => {
    const s = computeBudgetSignal({
      budget: 1000,
      committed: 800,
      reserved: 400,
      totalValue: 0,
      status: 'Requested',
    });
    expect(s.available).toBe(-200);
  });
});

describe('computeBudgetSignal — otherReserved excludes this case (AC-RB-005)', () => {
  it('AC-RB-005: total reserved 200, this case 50 (Approved → in reserved) → otherReserved 150', () => {
    const s = computeBudgetSignal({
      budget: 1000,
      committed: 0,
      reserved: 200,
      totalValue: 50,
      status: 'Approved',
    });
    expect(s.caseInReserved).toBe(true);
    expect(s.otherReserved).toBe(150);
  });

  it('AC-RB-005: at Requested the case is NOT in reserved → otherReserved equals total reserved', () => {
    const s = computeBudgetSignal({
      budget: 1000,
      committed: 0,
      reserved: 200,
      totalValue: 50,
      status: 'Requested',
    });
    expect(s.caseInReserved).toBe(false);
    expect(s.otherReserved).toBe(200);
  });
});

describe('computeBudgetSignal — the double-count boundary (AC-RB-006 / AC-RB-007)', () => {
  // Same discriminating numbers as the panel's rendered AC-RB-006/007 tests:
  // budget 700, committed 100, reserved 100 → available 500; thisRequest 120.
  it('AC-RB-006: Requested (caseInReserved=false) → afterRequest = available − totalValue = $380', () => {
    const s = computeBudgetSignal({
      budget: 700,
      committed: 100,
      reserved: 100,
      totalValue: 120,
      status: 'Requested',
    });
    expect(s.available).toBe(500);
    expect(s.caseInReserved).toBe(false);
    expect(s.afterRequest).toBe(380);
  });

  it('AC-RB-007: Approved (caseInReserved=true) → afterRequest = available = $500 (NOT $380, no double-subtract)', () => {
    const s = computeBudgetSignal({
      budget: 700,
      committed: 100,
      reserved: 100,
      totalValue: 120,
      status: 'Approved',
    });
    expect(s.available).toBe(500);
    expect(s.caseInReserved).toBe(true);
    expect(s.afterRequest).toBe(500);
  });
});

describe('computeBudgetSignal — advisory flags (FR-RB-040 / FR-RB-041)', () => {
  it('FR-RB-040: overAvailable when NOT in reserved AND request exceeds available', () => {
    const s = computeBudgetSignal({
      budget: 700,
      committed: 100,
      reserved: 100,
      totalValue: 600,
      status: 'Requested',
    });
    // available 500, request 600 → over by 100
    expect(s.overAvailable).toBe(true);
    expect(s.overAvailableAmount).toBe(100);
    expect(s.overBudgetReserved).toBe(false);
  });

  it('FR-RB-040: no overAvailable when request fits within available', () => {
    const s = computeBudgetSignal({
      budget: 700,
      committed: 100,
      reserved: 100,
      totalValue: 400,
      status: 'Requested',
    });
    expect(s.overAvailable).toBe(false);
    expect(s.overAvailableAmount).toBe(0);
  });

  it('FR-RB-040: never overAvailable when the case is already in reserved (Approved)', () => {
    const s = computeBudgetSignal({
      budget: 700,
      committed: 100,
      reserved: 100,
      totalValue: 600,
      status: 'Approved',
    });
    expect(s.overAvailable).toBe(false);
    expect(s.overAvailableAmount).toBe(0);
  });

  it('FR-RB-041: overBudgetReserved when in reserved AND available is negative', () => {
    const s = computeBudgetSignal({
      budget: 1000,
      committed: 800,
      reserved: 400, // available = -200
      totalValue: 50,
      status: 'Approved',
    });
    expect(s.overBudgetReserved).toBe(true);
    expect(s.overAvailable).toBe(false);
  });

  it('FR-RB-041: no overBudgetReserved when in reserved AND available is non-negative', () => {
    const s = computeBudgetSignal({
      budget: 1000,
      committed: 300,
      reserved: 200, // available = 500
      totalValue: 50,
      status: 'Approved',
    });
    expect(s.overBudgetReserved).toBe(false);
  });
});

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
    const s = computeBudgetSignal({ projectCurrency: 'USD', budgetCurrency: 'USD', requestCurrency: 'USD',
      budget: 1000,
      spent: 0,
      openOrders: 300,
      reserved: 200,
      totalValue: 0,
      status: 'Requested',
    });
    expect(s.left).toBe(500);
  });

  it('AC-RB-004: available is negative when committed + reserved exceed budget', () => {
    const s = computeBudgetSignal({ projectCurrency: 'USD', budgetCurrency: 'USD', requestCurrency: 'USD',
      budget: 1000,
      spent: 0,
      openOrders: 800,
      reserved: 400,
      totalValue: 0,
      status: 'Requested',
    });
    expect(s.left).toBe(-200);
  });
});

describe('computeBudgetSignal — otherReserved excludes this case (AC-RB-005)', () => {
  it('AC-RB-005: total reserved 200, this case 50 (Approved → in reserved) → otherReserved 150', () => {
    const s = computeBudgetSignal({ projectCurrency: 'USD', budgetCurrency: 'USD', requestCurrency: 'USD',
      budget: 1000,
      spent: 0,
      openOrders: 0,
      reserved: 200,
      totalValue: 50,
      status: 'Approved',
    });
    expect(s.otherReserved).toBe(150);
  });

  it('AC-RB-005: at Requested the case is NOT in reserved → otherReserved equals total reserved', () => {
    const s = computeBudgetSignal({ projectCurrency: 'USD', budgetCurrency: 'USD', requestCurrency: 'USD',
      budget: 1000,
      spent: 0,
      openOrders: 0,
      reserved: 200,
      totalValue: 50,
      status: 'Requested',
    });
    expect(s.otherReserved).toBe(200);
  });
});

describe('computeBudgetSignal — the double-count boundary (AC-RB-006 / AC-RB-007)', () => {
  // Same discriminating numbers as the panel's rendered AC-RB-006/007 tests:
  // budget 700, committed 100, reserved 100 → available 500; thisRequest 120.
  it('AC-RB-006: Requested (caseInReserved=false) → afterRequest = available − totalValue = $380', () => {
    const s = computeBudgetSignal({ projectCurrency: 'USD', budgetCurrency: 'USD', requestCurrency: 'USD',
      budget: 700,
      spent: 0,
      openOrders: 100,
      reserved: 100,
      totalValue: 120,
      status: 'Requested',
    });
    expect(s.left).toBe(500);
    expect(s.afterRequest).toBe(380);
  });

  it('AC-RB-007: Approved (caseInReserved=true) → afterRequest = available = $500 (NOT $380, no double-subtract)', () => {
    const s = computeBudgetSignal({ projectCurrency: 'USD', budgetCurrency: 'USD', requestCurrency: 'USD',
      budget: 700,
      spent: 0,
      openOrders: 100,
      reserved: 100,
      totalValue: 120,
      status: 'Approved',
    });
    expect(s.left).toBe(500);
    expect(s.afterRequest).toBe(500);
  });
});

it('keeps decimal budget positions exact', () => {
  const result = computeBudgetSignal({ projectCurrency: 'USD', budgetCurrency: 'USD', requestCurrency: 'USD', budget: 1, spent: 0, openOrders: 0.1, reserved: 0.2, totalValue: 0.3, status: 'Requested' });
  expect(result.left).toBe(0.7);
  expect(result.afterRequest).toBe(0.4);
});

it('requires matching project, budget and request currencies', () => {
  expect(() => computeBudgetSignal({
    budget: 1000, spent: 0, openOrders: 100, reserved: 200, totalValue: 50, status: 'Requested',
    projectCurrency: 'USD', budgetCurrency: 'USD', requestCurrency: 'EUR',
  })).toThrow();
});

it('rejects derived positions at the cent representation boundary', () => {
  const base = { projectCurrency: 'USD', budgetCurrency: 'USD', requestCurrency: 'USD', status: 'Requested' as const };
  const limit = 2 ** 46;
  expect(computeBudgetSignal({ ...base, budget: limit - 0.01, spent: 0, openOrders: 0, reserved: 0, totalValue: 0 }).left).toBe(limit - 0.01);
  expect(() => computeBudgetSignal({ ...base, budget: 1, spent: 0, openOrders: limit - 1, reserved: 2.01, totalValue: 0 })).toThrow();
  expect(() => computeBudgetSignal({ ...base, budget: limit - 1, spent: 0, openOrders: -1, reserved: -0.01, totalValue: 0 })).toThrow();
  expect(() => computeBudgetSignal({ ...base, budget: 0, spent: 0, openOrders: limit - 1, reserved: 0, totalValue: 1.01 })).toThrow();
  expect(() => computeBudgetSignal({ ...base, status: 'Approved', budget: 0, spent: 0, openOrders: 0, reserved: limit - 1, totalValue: -1.01 })).toThrow();
  expect(() => computeBudgetSignal({ ...base, budget: 0, spent: 0, openOrders: limit - 1, reserved: 0, totalValue: 1.01 })).toThrow();
});

describe('APPROVAL-LEFT AC-RB-015..018 — whole budget, each amount once', () => {
  const base = { projectCurrency: 'USD', budgetCurrency: 'USD', requestCurrency: 'USD' };

  it('AC-RB-015: budget 1000 / spent 500 / open orders 400 / reserved 50 / new request 25 → 50 left, 25 after, 97.5% in use', () => {
    const s = computeBudgetSignal({ ...base, budget: 1000, spent: 500, openOrders: 400, reserved: 50, totalValue: 25, status: 'Requested' });
    expect(s.left).toBe(50);
    expect(s.afterRequest).toBe(25);
    expect(s.otherReserved).toBe(50);
    expect(((1000 - s.afterRequest) / 1000) * 100).toBe(97.5);
  });

  it('AC-RB-016: a request already inside Reserved is not subtracted again (Approved 25, reserved 75 → 25 after)', () => {
    const s = computeBudgetSignal({ ...base, budget: 1000, spent: 500, openOrders: 400, reserved: 75, totalValue: 25, status: 'Approved' });
    expect(s.left).toBe(25);
    expect(s.afterRequest).toBe(25);
    expect(s.otherReserved).toBe(50);
  });

  it('AC-RB-018: an Ordered purchase is already in open orders, so after = left (50, not -350)', () => {
    const s = computeBudgetSignal({ ...base, budget: 1000, spent: 500, openOrders: 400, reserved: 50, totalValue: 400, status: 'Ordered' });
    expect(s.left).toBe(50);
    expect(s.afterRequest).toBe(50);
  });

  it('half-paid order: budget 2000, spent 500, open 500, request 100 → 900', () => {
    const s = computeBudgetSignal({ ...base, budget: 2000, spent: 500, openOrders: 500, reserved: 0, totalValue: 100, status: 'Requested' });
    expect(s.afterRequest).toBe(900);
  });

  it('ERP with a held bill: spent 650 (includes the 150 bill), open 250 (400 less 150), reserved 50, request 25 → 25', () => {
    const s = computeBudgetSignal({ ...base, budget: 1000, spent: 650, openOrders: 250, reserved: 50, totalValue: 25, status: 'Requested' });
    expect(s.afterRequest).toBe(25);
  });

  it('over budget: 1000 / spent 1040 / open 300 / reserved 200 / request 440 → -980', () => {
    const s = computeBudgetSignal({ ...base, budget: 1000, spent: 1040, openOrders: 300, reserved: 200, totalValue: 440, status: 'Requested' });
    expect(s.afterRequest).toBe(-980);
  });
});

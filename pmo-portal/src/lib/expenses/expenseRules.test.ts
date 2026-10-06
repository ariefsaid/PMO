import { describe, it, expect } from 'vitest';
import { availableExpenseActions, settlementPreview, claimsAwaitingViewer, agingTotals } from './expenseRules';

const claim = (o: Partial<{ kind: 'claim' | 'advance'; status: string; claimant_id: string; approved_by_id: string | null }> = {}) =>
  ({ kind: 'claim', status: 'Draft', claimant_id: 'eng', approved_by_id: null, ...o }) as never;
const named = (id: string) => ({ route: 'project' as const, approvers: [{ id, fullName: 'N' }] });

describe('AC-EXP-052 availableExpenseActions mirrors transition_expense_claim', () => {
  it('AC-EXP-052 the claimant submits a Draft and cancels it; nobody else submits', () => {
    expect(availableExpenseActions({ claim: claim(), userId: 'eng', realRole: 'Engineer' })).toEqual(['submit', 'cancel']);
    expect(availableExpenseActions({ claim: claim(), userId: 'pm', realRole: 'Project Manager' })).toEqual([]);
  });
  it('AC-EXP-052 approve/reject: approval rank, not the claimant, and allowed by the route', () => {
    const submitted = claim({ status: 'Submitted' });
    expect(availableExpenseActions({ claim: submitted, userId: 'pm', realRole: 'Project Manager', route: null })).toEqual(['approve', 'reject']);
    expect(availableExpenseActions({ claim: submitted, userId: 'pm', realRole: 'Project Manager', route: named('other') })).toEqual([]);
    expect(availableExpenseActions({ claim: submitted, userId: 'pm', realRole: 'Project Manager', route: named('pm') })).toEqual(['approve', 'reject']);
    expect(availableExpenseActions({ claim: submitted, userId: 'e2', realRole: 'Engineer', route: null })).toEqual([]);
    expect(availableExpenseActions({ claim: claim({ status: 'Submitted', claimant_id: 'ad' }), userId: 'ad', realRole: 'Admin', route: null })).toEqual(['cancel']);
  });
  it('AC-EXP-052 pay: Finance or Admin, never the claimant or the approver', () => {
    const approved = claim({ status: 'Approved', approved_by_id: 'f1' });
    expect(availableExpenseActions({ claim: approved, userId: 'f2', realRole: 'Finance' })).toEqual(['pay', 'cancel']);
    expect(availableExpenseActions({ claim: approved, userId: 'f1', realRole: 'Finance' })).toEqual(['cancel']);
    expect(availableExpenseActions({ claim: approved, userId: 'eng', realRole: 'Engineer' })).toEqual([]);
  });
  it("AC-EXP-052 reopen is the claimant's; a paid advance with money out takes a return from Finance", () => {
    expect(availableExpenseActions({ claim: claim({ status: 'Rejected' }), userId: 'eng', realRole: 'Engineer' })).toEqual(['reopen']);
    const paidAdvance = claim({ kind: 'advance', status: 'Paid' });
    expect(availableExpenseActions({ claim: paidAdvance, userId: 'f1', realRole: 'Finance', advanceOutstanding: 400 })).toEqual(['recordReturn']);
    expect(availableExpenseActions({ claim: paidAdvance, userId: 'f1', realRole: 'Finance', advanceOutstanding: 0 })).toEqual([]);
  });
});

describe('AC-EXP-052 money is cent-exact', () => {
  it('AC-EXP-052 the advance pays first, the rest is cash', () => {
    expect(settlementPreview(300, 1000)).toEqual({ applied: 300, cash: 0 });
    expect(settlementPreview(900, 700)).toEqual({ applied: 700, cash: 200 });
    expect(settlementPreview(0.3, 0.1)).toEqual({ applied: 0.1, cash: 0.2 });
    expect(settlementPreview(50, null)).toEqual({ applied: 0, cash: 50 });
  });
  it('AC-EXP-052 aging totals sum per currency per bucket in cents', () => {
    expect(agingTotals([
      { currency: 'IDR', bucket: '0-30', outstanding: 0.1 },
      { currency: 'IDR', bucket: '0-30', outstanding: 0.2 },
      { currency: 'USD', bucket: '90+', outstanding: 5 },
    ])).toEqual({
      IDR: { '0-30': 0.3, '31-60': 0, '61-90': 0, '90+': 0 },
      USD: { '0-30': 0, '31-60': 0, '61-90': 0, '90+': 5 },
    });
  });
});

describe('AC-EXP-052 claimsAwaitingViewer', () => {
  it('AC-EXP-052 keeps unrouted, flat and named rows; drops own and routed-elsewhere rows', () => {
    const row = (id: string, claimant: string, route: unknown) => ({ id, claim: { status: 'Submitted', claimant_id: claimant }, route }) as never;
    const rows = [
      row('own', 'pm', null), row('unrouted', 'e', null), row('flat', 'e', { route: 'flat', approvers: [] }),
      row('named', 'e', named('pm')), row('elsewhere', 'e', named('x')), row('adminOnly', 'e', { route: 'admin', approvers: [] }),
    ];
    expect(claimsAwaitingViewer(rows, 'pm', 'Project Manager').map((r: { id: string }) => r.id)).toEqual(['unrouted', 'flat', 'named']);
  });
});

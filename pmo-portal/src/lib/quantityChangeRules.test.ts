import { describe, expect, it } from 'vitest';
import {
  approvalBlock, countsTowardLimit, limitReached, lineValueCents, overContract, reportedProgress, sumMoney, validateRequestedQuantity,
  versionValueChanges,
} from './quantityChangeRules';

// Hand calculation (spec): Excavation, rate 50,000, C = 1,000.000. Assessed 1,040; accepted 980; claimed 900. R = 1,100.
describe('quantityChangeRules', () => {
  it('AC-QCR-001 P is the greatest source and names it', () => {
    expect(reportedProgress({ assessment: 1040, acceptance: 980, claim: 900, daily_report: 0 })).toEqual({ quantity: 1040, source: 'assessment' });
    expect(reportedProgress({ assessment: 0, acceptance: 0, claim: 0, daily_report: 0 })).toEqual({ quantity: 0, source: null });
    expect(reportedProgress({ assessment: 500, acceptance: 500, claim: 500, daily_report: 500 }).source).toBe('assessment');
  });

  it('AC-QCR-001 over by 40, and exactly C is not over', () => {
    expect(overContract({ contract: 1000, progress: 1040, forecast: null, earningBasis: 'unit_rate' })).toEqual({ over: true, kind: 'progress', figure: 1040 });
    expect(overContract({ contract: 1000, progress: 1000, forecast: null, earningBasis: 'unit_rate' }).over).toBe(false);
  });

  it('AC-QCR-002 a forecast above C with P at or below C is over with kind forecast', () => {
    expect(overContract({ contract: 1000, progress: 900, forecast: 1100, earningBasis: 'unit_rate' })).toEqual({ over: true, kind: 'forecast', figure: 1100 });
  });

  it('AC-QCR-029 a lump-sum line is never over-contract', () => {
    expect(overContract({ contract: 1, progress: 5, forecast: 5, earningBasis: 'lump_sum' }).over).toBe(false);
  });

  it('AC-QCR-005 R must be above C and not below the trigger figure, with at most 3 decimals', () => {
    expect(validateRequestedQuantity('1100', 1000, 1040)).toBeNull();
    expect(validateRequestedQuantity('1000', 1000, 1040)).toBe('not_above_contract');
    expect(validateRequestedQuantity('1030', 1000, 1040)).toBe('below_trigger');
    expect(validateRequestedQuantity('1100.0001', 1000, 1040)).toBe('invalid');
    expect(validateRequestedQuantity('', 1000, 1040)).toBe('invalid');
    expect(validateRequestedQuantity('-5', 1000, 1040)).toBe('invalid');
  });

  it('AC-QCR-023 the value change for 1,000 to 1,100 at rate 50,000 reads 5,000,000.00 and sums to current minus baseline', () => {
    const rows = versionValueChanges([
      { version_no: 2, quantity: 1100, source: 'change_request', request_id: 'r', created_by: null, created_at: '2026-02-01' },
      { version_no: 1, quantity: 1000, source: 'baseline', request_id: null, created_by: null, created_at: '2026-01-01' },
    ], 50000);
    expect(rows.map((r) => r.version_no)).toEqual([1, 2]);
    expect(rows[0].value).toBe('50000000.00');
    expect(rows[0].change).toBeNull();
    expect(rows[1].value).toBe('55000000.00');
    expect(rows[1].change).toBe('5000000.00');
    expect(sumMoney(rows.map((r) => r.change))).toBe('5000000.00');
  });

  it('NFR-QCR-001 value is rounded once per version so changes always telescope', () => {
    expect(lineValueCents('1.005', '10.01')).toBe(1006n); // 1.005 x 10.01 = 10.06005, rounded once to 10.06
    const rows = versionValueChanges([
      { version_no: 1, quantity: '100.333', source: 'baseline', request_id: null, created_by: null, created_at: 'a' },
      { version_no: 2, quantity: '100.999', source: 'setup_edit', request_id: null, created_by: null, created_at: 'b' },
      { version_no: 3, quantity: '150.5', source: 'change_request', request_id: 'r', created_by: null, created_at: 'c' },
    ], '0.37');
    const current = rows[2].valueCents as bigint;
    const baseline = rows[0].valueCents as bigint;
    expect(rows.slice(1).reduce((s, r) => s + (r.changeCents as bigint), 0n)).toBe(current - baseline);
  });

  it('AC-QCR-011/027 approval is blocked for the author, any editor and the submitter, with the reason', () => {
    const base = { status: 'pending_approval' as const, authorId: 'a', editorIds: ['a', 'e1', 'e2'], submittedBy: 'e2' };
    expect(approvalBlock({ ...base, role: 'Finance', userId: 'a' }).reason).toBe('author');
    expect(approvalBlock({ ...base, role: 'Finance', userId: 'e1' }).reason).toBe('editor');
    expect(approvalBlock({ ...base, role: 'Finance', userId: 'e2' }).reason).toBe('editor');
    expect(approvalBlock({ ...base, editorIds: ['a'], role: 'Finance', userId: 'e2' }).reason).toBe('submitter');
    expect(approvalBlock({ ...base, role: 'Engineer', userId: 'z' }).reason).toBe('role');
    expect(approvalBlock({ ...base, role: 'Project Manager', userId: 'z' }).reason).toBe('role');
    expect(approvalBlock({ ...base, role: 'Admin', userId: 'z' }).reason).toBeNull();
    expect(approvalBlock({ ...base, status: 'approved', role: 'Admin', userId: 'z' }).reason).toBe('status');
  });

  it('AC-QCR-008 only a draft withdrawn before it was ever submitted is left out of the limit', () => {
    expect(countsTowardLimit({ status: 'withdrawn', withdrawn_from: 'draft', first_submitted_at: null })).toBe(false);
    expect(countsTowardLimit({ status: 'withdrawn', withdrawn_from: 'returned', first_submitted_at: '2026-01-01' })).toBe(true);
    expect(countsTowardLimit({ status: 'withdrawn', withdrawn_from: 'draft', first_submitted_at: '2026-01-01' })).toBe(true);
    expect(countsTowardLimit({ status: 'draft', withdrawn_from: null, first_submitted_at: null })).toBe(true);
  });

  it('AC-QCR-006 the limit is reached at the count, and an empty limit never is', () => {
    expect(limitReached(2, 2)).toBe(true);
    expect(limitReached(1, 2)).toBe(false);
    expect(limitReached(50, null)).toBe(false);
  });
});

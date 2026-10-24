import { describe, expect, it } from 'vitest';
import { EMPTY_RULE_VALUES, percentUnits, toDraft, validateRule, type RuleFormValues } from './costAttributionDraft';

const ok: RuleFormValues = {
  ...EMPTY_RULE_VALUES, name: 'Payroll', matchValue: 'Salary - RIS', effectiveFrom: '2025-01-01',
  targets: [{ projectId: 'p1', percent: '60.1' }, { projectId: 'p2', percent: '39.9' }],
};

describe('cost attribution draft (FR-CAT-005, FR-CAT-010)', () => {
  it('accepts targets that total exactly 100 to 4 decimals, rejects 99.9999 and 100.0001', () => {
    expect(validateRule(ok)).toEqual({});
    expect(validateRule({ ...ok, targets: [{ projectId: 'p1', percent: '33.3333' }, { projectId: 'p2', percent: '66.6666' }] }).targets).toBe('total-not-100');
    expect(validateRule({ ...ok, targets: [{ projectId: 'p1', percent: '50' }, { projectId: 'p2', percent: '50.0001' }] }).targets).toBe('total-not-100');
  });

  it('rejects a percent that is zero, over 100, or has more than 4 decimals', () => {
    for (const bad of ['0', '100.1', '12.34567', '-5', 'abc', '']) expect(percentUnits(bad)).toBeNull();
    expect(percentUnits('100')).toBe(1_000_000);
  });

  it('refuses a repeated project and an unpicked project', () => {
    expect(validateRule({ ...ok, targets: [{ projectId: 'p1', percent: '50' }, { projectId: 'p1', percent: '50' }] }).targets).toBe('duplicate-project');
    expect(validateRule({ ...ok, targets: [{ projectId: '', percent: '100' }] }).targets).toBe('no-project');
  });

  it('allows effective_to one day before effective_from (voids a rule) but nothing earlier', () => {
    expect(validateRule({ ...ok, effectiveTo: '2024-12-31' }).effectiveTo).toBeUndefined();
    expect(validateRule({ ...ok, effectiveTo: '2024-12-30' }).effectiveTo).toBe('before-from');
  });

  it('builds the RPC JSON: group vs account, blank narrowing as null, party_type only with a party', () => {
    const draft = toDraft({ ...ok, matchBy: 'account_group', matchValue: ' Payroll - RIS ', partyType: 'Employee' }, { rule_key: 'k', version: 2 });
    expect(draft).toMatchObject({ rule_key: 'k', expected_version: 2, account_group: 'Payroll - RIS', party: null, party_type: null, cost_center: null, effective_to: null });
    expect(draft).not.toHaveProperty('account');
    expect(draft.targets).toEqual([{ project_id: 'p1', percent: 60.1 }, { project_id: 'p2', percent: 39.9 }]);
  });
});

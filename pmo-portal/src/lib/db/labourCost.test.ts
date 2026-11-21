import { describe, expect, it } from 'vitest';
import { validateRateInput, type LabourRateInput } from './labourCost';

const base: LabourRateInput = {
  subjectKind: 'role', roleKey: 'Engineer', classId: 'c1', basis: 'hourly', amount: '50000', overtimeMultiplier: '1.5',
  dayHours: '8', monthHours: '173', effectiveFrom: '2026-11-01',
};

describe('validateRateInput (#2670, mirrors save_labour_cost_rate; the database re-checks)', () => {
  it('AC-LCM-016 accepts a complete rate', () => expect(validateRateInput(base)).toBeNull());
  it('AC-LCM-016 refuses a zero, negative or three-decimal amount', () => {
    for (const amount of ['0', '-5', '10.123', 'abc', '']) expect(validateRateInput({ ...base, amount })).toBe('amount');
  });
  it('AC-LCM-016 refuses a multiplier below 1 or above 5', () => {
    expect(validateRateInput({ ...base, overtimeMultiplier: '0.9' })).toBe('multiplier');
    expect(validateRateInput({ ...base, overtimeMultiplier: '5.1' })).toBe('multiplier');
  });
  it('AC-LCM-016 refuses a day or month length out of range and reversed dates', () => {
    expect(validateRateInput({ ...base, dayHours: '25' })).toBe('dayHours');
    expect(validateRateInput({ ...base, monthHours: '0' })).toBe('monthHours');
    expect(validateRateInput({ ...base, effectiveTo: '2026-10-01' })).toBe('dates');
  });
  it('AC-LCM-016 needs a subject and a class', () => {
    expect(validateRateInput({ ...base, roleKey: null })).toBe('subject');
    expect(validateRateInput({ ...base, subjectKind: 'person', personId: null })).toBe('subject');
    expect(validateRateInput({ ...base, classId: '' })).toBe('class');
  });
});

import { describe, expect, it } from 'vitest';
import { moneyText, moneyUnits } from './projectFinances';

describe('exact project-finance money', () => {
  it('AC-PFIN-013 subtracts scale-2 amounts without floating-point drift', () => {
    const revenue = moneyUnits('0.30');
    const cost = moneyUnits('0.10');
    expect(revenue).not.toBeNull();
    expect(cost).not.toBeNull();
    expect(moneyText(revenue! - cost!)).toBe('0.20');
  });

  it('AC-PFIN-013 preserves amounts beyond JavaScript safe integer precision', () => {
    expect(moneyText(moneyUnits('9007199254740993.99')!)).toBe('9007199254740993.99');
  });

  it.each([null, 'NaN', 'Infinity', '-Infinity', '', '1.234', '1.', '.25', '--1', ' 1']) (
    'AC-PFIN-013 rejects invalid or unsupported exact money input %s', (value) => {
      expect(moneyUnits(value)).toBeNull();
    },
  );

  it('AC-PFIN-013 formats negative minor-unit values with a stable scale', () => {
    expect(moneyText(-1n)).toBe('-0.01');
    expect(moneyText(-12345n)).toBe('-123.45');
  });
});

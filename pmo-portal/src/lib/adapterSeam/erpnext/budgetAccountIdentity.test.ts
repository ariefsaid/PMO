import { describe, expect, it } from 'vitest';
import { encodeFiscalYear } from './fiscalYearEncoding';
import {
  budgetAccountIdentity,
  budgetAccountPushKey,
  decodeBudgetAccount,
  encodeBudgetAccount,
  isBudgetAccountPushKey,
  parseBudgetIdentity,
} from './budgetAccountIdentity';

const VERSION = '3f1b0c9e-1a2b-4c3d-8e4f-5a6b7c8d9e0f';

describe('budgetAccountIdentity', () => {
  it('frames encoded FY and round-trips distinct Unicode accounts without changing legacy identities', () => {
    const fiscalYear = 'FY/2026: α';
    const first = budgetAccountIdentity(VERSION, fiscalYear, 'Salary: East/α');
    const second = budgetAccountIdentity(VERSION, fiscalYear, 'Salary: East/β');

    expect(first).not.toBe(second);
    expect(first).toContain(`:a:${encodeFiscalYear(fiscalYear).length}:${encodeFiscalYear(fiscalYear)}:`);
    expect(parseBudgetIdentity(first)).toEqual({
      versionId: VERSION,
      fiscalYear,
      erpAccount: 'Salary: East/α',
    });
    expect(parseBudgetIdentity(VERSION)).toEqual({ versionId: VERSION, fiscalYear: null, erpAccount: null });
    expect(parseBudgetIdentity(`${VERSION}:${encodeFiscalYear(fiscalYear)}`)).toEqual({
      versionId: VERSION,
      fiscalYear,
      erpAccount: null,
    });
    expect(decodeBudgetAccount(encodeBudgetAccount('Salary: East/α'))).toBe('Salary: East/α');
  });

  it('derives one key for equivalent timestamp renderings and rejects malformed dimensions', () => {
    const identity = budgetAccountIdentity(VERSION, '2026', 'COGS');
    const timestamps = [
      '2026-10-15T10:00:00+00:00',
      '2026-10-15 10:00:00+00',
      '2026-10-15T17:00:00+07:00',
      '2026-10-15T10:00:00Z',
    ];
    const keys = timestamps.map((timestamp) => budgetAccountPushKey(identity, timestamp));
    expect(new Set(keys).size).toBe(1);
    expect(isBudgetAccountPushKey(keys[0])).toBe(true);

    const separator = identity.lastIndexOf(':');
    const tokenStart = identity.slice(0, separator);
    const invalid = [
      `${tokenStart}:f`,
      `${tokenStart}:FF`,
      `${tokenStart}:ff`,
      `${VERSION}:a:08:${encodeFiscalYear('2026')}:434f4753`,
      `${VERSION}:a:4:${encodeFiscalYear('2026')}:434f4753:trailer`,
    ];
    for (const malformed of invalid) expect(() => parseBudgetIdentity(malformed)).toThrow();
    expect(() => budgetAccountIdentity(VERSION, '2026', '')).toThrow();
    expect(() => parseBudgetIdentity(`${VERSION}:a:4:${encodeFiscalYear('2026')}:ff`)).toThrow();
    expect(() => parseBudgetIdentity(`${VERSION}:a:4${encodeFiscalYear('2026')}:434f4753`)).toThrow();
    expect(isBudgetAccountPushKey(`bud16:${identity}:01x`)).toBe(false);
    expect(() => budgetAccountPushKey(identity, null)).toThrow();
  });
});

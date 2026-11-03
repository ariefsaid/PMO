import { describe, expect, it } from 'vitest';
import { encodeFiscalYear } from './fiscalYearEncoding';
import {
  budgetAccountIdentity,
  budgetRangeIdentity,
  budgetAccountArchiveKey,
  budgetAccountPushKey,
  budgetLegacyArchiveKey,
  budgetLegacyIdentity,
  decodeBudgetAccount,
  encodeBudgetAccount,
  isBudgetAccountPushKey,
  isBudgetAccountArchiveKey,
  isBudgetLegacyArchiveKey,
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
      toFiscalYear: null,
      erpAccount: 'Salary: East/α',
      kind: 'annual',
    });
    expect(parseBudgetIdentity(VERSION)).toEqual({ versionId: VERSION, fiscalYear: null, toFiscalYear: null, erpAccount: null, kind: 'bare' });
    expect(parseBudgetIdentity(`${VERSION}:${encodeFiscalYear(fiscalYear)}`)).toEqual({
      versionId: VERSION,
      fiscalYear,
      toFiscalYear: null,
      erpAccount: null,
      kind: 'legacy',
    });
    expect(decodeBudgetAccount(encodeBudgetAccount('Salary: East/α'))).toBe('Salary: East/α');
  });

  it('AC-010 uses a distinct canonical identity for the whole fiscal range, including same-year ranges', () => {
    const annual = budgetAccountIdentity(VERSION, 'FY/27:α', 'Salary: East/α');
    const range = budgetRangeIdentity(VERSION, 'FY/27:α', 'FY/28 β', 'Salary: East/α');
    const sameYearRange = budgetRangeIdentity(VERSION, 'FY/27:α', 'FY/27:α', 'Salary: East/α');

    expect(range).not.toBe(annual);
    expect(sameYearRange).not.toBe(annual);
    expect(parseBudgetIdentity(range)).toEqual({
      versionId: VERSION,
      fiscalYear: 'FY/27:α',
      toFiscalYear: 'FY/28 β',
      erpAccount: 'Salary: East/α',
      kind: 'range',
    });
    expect(parseBudgetIdentity(sameYearRange).kind).toBe('range');
  });

  it('AC-010 range keys round-trip through the shared money-outbox identity and archive-key shapes', () => {
    const identity = budgetRangeIdentity(VERSION, 'FY/27:α', 'FY/28 β', 'Salary: East/α');
    const activatedAt = '2026-10-15T10:00:00Z';

    expect(parseBudgetIdentity(identity).erpAccount).toBe('Salary: East/α');
    expect(isBudgetAccountPushKey(budgetAccountPushKey(identity, activatedAt))).toBe(true);
    expect(isBudgetAccountArchiveKey(budgetAccountArchiveKey(identity, activatedAt))).toBe(true);
  });

  it('AC-010 rejects malformed and noncanonical range identities', () => {
    const valid = budgetRangeIdentity(VERSION, '2026', '2027', 'COGS');
    const encoded = valid.slice(VERSION.length + 1);
    const invalid = [
      `${VERSION}:r:0::4:32303237:434f4753`,
      `${VERSION}:r:04:32303236:4:32303237:434f4753`,
      `${VERSION}:r:4:32303236:4:32303237:ff`,
      `${valid}:trailer`,
    ];
    expect(() => budgetRangeIdentity(VERSION, '', '2027', 'COGS')).toThrow();
    expect(() => budgetRangeIdentity(VERSION, '2026', '', 'COGS')).toThrow();
    expect(() => budgetRangeIdentity('not-a-uuid', '2026', '2027', 'COGS')).toThrow();
    expect(encoded.startsWith('r:')).toBe(true);
    for (const malformed of invalid) expect(() => parseBudgetIdentity(malformed)).toThrow();
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

  it('gives archived Budget cancellations a stable key separate from the ensure key', () => {
    const identity = budgetAccountIdentity(VERSION, '2026', 'COGS');
    const activatedAt = '2026-10-15T10:00:00Z';
    const key = budgetAccountArchiveKey(identity, activatedAt);

    expect(key).not.toBe(budgetAccountPushKey(identity, activatedAt));
    expect(key).toBe(budgetAccountArchiveKey(identity, activatedAt));
    expect(isBudgetAccountArchiveKey(key)).toBe(true);
    expect(isBudgetAccountArchiveKey(`bud16-archive:${identity}:01x`)).toBe(false);
    expect(() => budgetAccountArchiveKey(identity, null)).toThrow();
  });

  it('AC-BUD-122 gives a year-qualified legacy Budget its own archive key', () => {
    const identity = budgetLegacyIdentity(VERSION, '2026');
    const activatedAt = '2026-10-15T10:00:00Z';
    const key = budgetLegacyArchiveKey(identity, activatedAt);

    // The legacy identity is the SHIPPED pre-v16 year-qualified identity, and its key is distinct from
    // the account key so the two never collide on one outbox record.
    expect(identity).toBe(`${VERSION}:${encodeFiscalYear('2026')}`);
    expect(parseBudgetIdentity(identity)).toEqual({ versionId: VERSION, fiscalYear: '2026', toFiscalYear: null, erpAccount: null, kind: 'legacy' });
    expect(key).toBe(`bud15-archive:${identity}:${Date.parse('2026-10-15T10:00:00Z')}`);
    expect(key).not.toBe(budgetAccountArchiveKey(budgetAccountIdentity(VERSION, '2026', 'COGS'), activatedAt));
    expect(isBudgetLegacyArchiveKey(key)).toBe(true);
    expect(isBudgetLegacyArchiveKey(budgetLegacyArchiveKey(identity, '2026-10-15T17:00:00+07:00'))).toBe(true);
  });

  it('AC-BUD-122 rejects bare, account-framed and malformed legacy archive identities', () => {
    // A bare version id cannot prove WHICH old ERP document the year-grained cancellation names.
    expect(() => budgetLegacyArchiveKey(VERSION, '2026-10-15T10:00:00Z')).toThrow();
    // An account-framed identity is the v16 unit, never a legacy one.
    expect(() => budgetLegacyArchiveKey(budgetAccountIdentity(VERSION, '2026', 'COGS'), '2026-10-15T10:00:00Z')).toThrow();
    expect(isBudgetLegacyArchiveKey(`bud15-archive:${VERSION}:01x`)).toBe(false);
    expect(isBudgetLegacyArchiveKey(`bud15-archive:${VERSION}:${encodeFiscalYear('2026')}:01x`)).toBe(false);
    expect(isBudgetLegacyArchiveKey(`bud16-archive:${budgetAccountIdentity(VERSION, '2026', 'COGS')}:1`)).toBe(false);
    expect(() => budgetLegacyArchiveKey(budgetLegacyIdentity(VERSION, '2026'), null)).toThrow();
    expect(() => budgetLegacyIdentity(VERSION, '')).toThrow();
    expect(() => budgetLegacyIdentity('not-a-uuid', '2026')).toThrow();
  });
});

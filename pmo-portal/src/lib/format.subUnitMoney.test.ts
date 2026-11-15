import { describe, it, expect, afterEach } from 'vitest';
import { setActiveLocale, resetActiveLocale } from '@/src/lib/locale/activeLocale';
import { formatExactMoney, formatTableMoney, formatTileMoney } from './format';

/**
 * #2199 (screen rules, Numbers): "Never show a non-zero amount or difference as zero: show its
 * exact value". Tile and table money print whole units, so an amount under half a unit used to
 * round to "$0". It now keeps its exact value. And a weighted forecast carries more than two
 * decimals (value x probability), which the whole-unit path must round, not reject.
 */
const norm = (s: string | null) => s?.replace(/[\u00a0\u202f]/g, ' ') ?? null;
const EN = { locale: 'en', numberLocale: 'en-US', timezone: 'UTC' };
const ID = { locale: 'id', numberLocale: 'id-ID', timezone: 'Asia/Jakarta' };

afterEach(() => resetActiveLocale());

describe('sub-unit money is never shown as zero (#2199)', () => {
  it('tile: an amount under one unit keeps its exact value', () => {
    setActiveLocale(EN);
    expect(norm(formatTileMoney(0.25, 'USD'))).toBe('$0.25');
    expect(norm(formatTileMoney(0.4, 'USD'))).toBe('$0.40');
    expect(norm(formatTileMoney(-0.25, 'USD'))).toBe('−$0.25');
    expect(norm(formatTileMoney(0.004, 'USD'))).toBe('$0.004');
    expect(norm(formatTileMoney(0.25, 'IDR', { code: true }))).toBe('IDR 0.25');
  });

  it('tile: a true zero still reads zero, and a whole amount is unchanged', () => {
    setActiveLocale(EN);
    expect(norm(formatTileMoney(0, 'USD'))).toBe('$0');
    expect(norm(formatTileMoney(856, 'USD'))).toBe('$856');
  });

  it('table: a number or exact string under one unit keeps its exact value', () => {
    setActiveLocale(EN);
    expect(norm(formatTableMoney(0.4, 'USD'))).toBe('$0.40');
    expect(norm(formatTableMoney('0.40', 'USD'))).toBe('$0.40');
    expect(norm(formatTableMoney('-0.49', 'USD'))).toBe('−$0.49');
    expect(norm(formatTableMoney(0.25, 'USD', { code: true }))).toBe('USD 0.25');
    expect(norm(formatTableMoney(0, 'USD'))).toBe('$0');
    setActiveLocale(ID);
    expect(norm(formatTableMoney(0.4, 'IDR'))).toBe('Rp 0,40');
  });

  it('table: more than two decimals rounds to whole units instead of losing the figure', () => {
    setActiveLocale(EN);
    expect(norm(formatTableMoney(1_420_000.1234, 'USD'))).toBe('$1,420,000');
    expect(norm(formatTableMoney(1_234.5675, 'USD'))).toBe('$1,235');
    expect(norm(formatTableMoney('1234.4999', 'USD'))).toBe('$1,234');
    expect(norm(formatTableMoney(0.1234, 'USD'))).toBe('$0.12');
  });

  it('exact money: whole units accept any number of decimals; exact cents still refuse them', () => {
    expect(norm(formatExactMoney('1234.5675', 'USD', 'en-US', { wholeUnits: true }))).toBe('$1,235');
    expect(norm(formatExactMoney('-1234.5675', 'USD', 'en-US', { wholeUnits: true }))).toBe('−$1,235');
    expect(formatExactMoney('1.001', 'USD', 'en-US')).toBeNull();
  });
});

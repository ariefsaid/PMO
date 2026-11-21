import { afterEach, describe, expect, it } from 'vitest';
import { resetActiveLocale, setActiveLocale } from '@/src/lib/locale/activeLocale';
import { formatMoneyLines, formatTableMoney, formatTileMoney } from './format';

const norm = (s: string) => s.replace(/[\u00a0\u202f]/g, ' ');
afterEach(() => resetActiveLocale());

// screen-rules "Numbers": never show a non-zero amount as zero; show its exact value (or a "less than" mark
// when it is smaller than the smallest unit shown). Same formatters feed tiles, tables, and hover titles.
describe('sub-unit and many-decimal money never reads as zero or fails (#2199)', () => {
  it('a tile shows 0.40 and 0.25 exactly, not $0', () => {
    expect(norm(formatTileMoney(0.4, 'USD')!)).toBe('$0.40');
    expect(norm(formatTileMoney(0.25, 'USD')!)).toBe('$0.25');
    expect(norm(formatTileMoney(-0.4, 'USD')!)).toBe('−$0.40');
    expect(norm(formatTileMoney(0.4, 'USD', { code: true })!)).toBe('USD 0.40');
  });

  it('an amount smaller than the smallest displayed unit shows a less-than mark, never zero', () => {
    expect(norm(formatTileMoney(0.004, 'USD')!)).toBe('<$0.01');
    expect(norm(formatTableMoney(0.004, 'USD')!)).toBe('<$0.01');
    expect(norm(formatTableMoney('0.001', 'USD')!)).toBe('<$0.01');
  });

  it('a true zero still reads zero', () => {
    expect(norm(formatTileMoney(0, 'USD')!)).toBe('$0');
    expect(norm(formatTableMoney(0, 'USD')!)).toBe('$0');
    expect(norm(formatTableMoney('0.00', 'USD')!)).toBe('$0');
  });

  it('a table shows 0.40 exactly (string and number), in code form too', () => {
    expect(norm(formatTableMoney(0.4, 'USD')!)).toBe('$0.40');
    expect(norm(formatTableMoney('0.4', 'USD')!)).toBe('$0.40');
    expect(norm(formatTableMoney(0.4, 'USD', { code: true })!)).toBe('USD 0.40');
    expect(norm(formatTableMoney('-0.40', 'USD')!)).toBe('−$0.40');
  });

  it('a whole-unit figure with more than two decimals still formats (hover/screen-reader exact value)', () => {
    expect(norm(formatTableMoney(160000.123456, 'USD')!)).toBe('$160,000');
    expect(norm(formatTableMoney(1234.5678, 'USD')!)).toBe('$1,235');
    expect(norm(formatTableMoney('1234.4999', 'USD')!)).toBe('$1,234');
    expect(norm(formatTableMoney(1e-7 + 5, 'USD')!)).toBe('$5');
  });

  it('whole amounts are unchanged', () => {
    expect(norm(formatTableMoney(1_467_628_320.47, 'IDR')!)).toBe('IDR 1,467,628,320');
  });

  it('id-ID keeps its own separators for a sub-unit amount', () => {
    setActiveLocale({ locale: 'id', numberLocale: 'id-ID', timezone: 'Asia/Jakarta' });
    expect(norm(formatTableMoney(0.4, 'USD')!)).toContain('0,40');
  });

  it('money lines carry the sub-unit figure on tile and table', () => {
    expect(formatMoneyLines([{ currency: 'USD', amount: 0.4 }], 'USD', 'tile').lines.map(norm)).toEqual(['$0.40']);
    expect(formatMoneyLines([{ currency: 'USD', amount: 0.4 }], 'USD', 'table').lines.map(norm)).toEqual(['$0.40']);
  });
});

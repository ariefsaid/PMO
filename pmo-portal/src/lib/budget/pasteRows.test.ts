import { describe, expect, it } from 'vitest';
import enCommon from '../../../public/locales/en/common.json';
import enFinance from '../../../public/locales/en/finance.json';
import idCommon from '../../../public/locales/id/common.json';
import idFinance from '../../../public/locales/id/finance.json';
import { budgetCategoryLabel } from '../i18n/budgetCategoryLabel';
import { Constants } from '../supabase/database.types';
import {
  multiplyPasteAmount,
  parsePasteAmount,
  isAmbiguousCommaNumber,
  parsePasteTsv,
  PasteRowsParseError,
  previewPasteRows,
  type PasteCategoryAliases,
  type PasteMapping,
  type PasteMode,
} from './pasteRows';

type BudgetCategory = (typeof Constants.public.Enums.budget_category)[number];
type LocaleResources = { common: Record<string, unknown>; finance: Record<string, unknown> };

const categories = Constants.public.Enums.budget_category as readonly BudgetCategory[];
const mapping = (overrides: Partial<PasteMapping> = {}): PasteMapping => ({
  category: 0,
  description: null,
  amount: 1,
  quantity: null,
  rate: null,
  ...overrides,
});

function getPath(source: Record<string, unknown>, path: string): unknown {
  return path.split('.').reduce<unknown>((current, part) => {
    if (current === null || typeof current !== 'object') return undefined;
    return (current as Record<string, unknown>)[part];
  }, source);
}

function translator(resources: LocaleResources) {
  return (key: string, fallback: string): string => {
    const separator = key.indexOf(':');
    const namespace = separator < 0 ? 'common' : key.slice(0, separator);
    const path = separator < 0 ? key : key.slice(separator + 1);
    const value = getPath(resources[namespace as keyof LocaleResources], path);
    return typeof value === 'string' ? value : fallback;
  };
}

function categoryAliasesFor(resources: LocaleResources): PasteCategoryAliases {
  const t = translator(resources);
  const aliases: Record<string, BudgetCategory | BudgetCategory[]> = {};
  for (const category of categories) {
    const label = budgetCategoryLabel(category, t);
    const existing = aliases[label];
    if (existing === undefined) aliases[label] = category;
    else aliases[label] = [...(Array.isArray(existing) ? existing : [existing]), category];
  }
  return aliases;
}

const rows = (...sourceRows: string[][]) => sourceRows.map((cells, index) => ({ rowNumber: index + 1, cells }));

describe('budget paste rows', () => {
  it('AC-001 quoted TSV and original row numbers', () => {
    const text = 'Category\tDescription\tAmount\r\nLabor\t"two\tparts\r\nnext ""quoted"""\t12.30\r\n\r\nTravel\t\t5\r\n\r\nMaterials\t=SUM(1,2)\t9.00\r\nEquipment\t';

    expect(parsePasteTsv(text)).toEqual([
      { rowNumber: 1, cells: ['Category', 'Description', 'Amount'] },
      { rowNumber: 2, cells: ['Labor', 'two\tparts\r\nnext "quoted"', '12.30'] },
      { rowNumber: 5, cells: ['Travel', '', '5'] },
      { rowNumber: 7, cells: ['Materials', '=SUM(1,2)', '9.00'] },
      { rowNumber: 8, cells: ['Equipment', ''] },
    ]);

    for (const malformed of ['a"b\t1', '"closed"tail\t1', '"unclosed\t1']) {
      expect(() => parsePasteTsv(malformed)).toThrow(PasteRowsParseError);
    }
  });

  it('AC-002 accepts exact positive amounts and rejects malformed, rounded, or out-of-range values', () => {
    expect(parsePasteAmount(' 1,234.50 ')).toBe('1234.50');
    expect(parsePasteAmount('1.2300')).toBe('1.23');
    expect(parsePasteAmount('999999999999.99')).toBe('999999999999.99');

    for (const invalid of ['0', '-1', '1,23', 'NaN', '1.001', '1000000000000.00', '1e3', '1.']) {
      expect(parsePasteAmount(invalid), invalid).toBeNull();
    }
  });

  it('AC-002 enforces the 128-character direct amount input boundary', () => {
    const atLimit = `1.${'0'.repeat(126)}`;
    const overLimit = `1.${'0'.repeat(127)}`;

    expect(atLimit).toHaveLength(128);
    expect(overLimit).toHaveLength(129);
    expect(parsePasteAmount(atLimit)).toBe('1.00');
    expect(parsePasteAmount(overLimit)).toBeNull();
  });

  it('AC-002 multiplies decimal operands using exact cents and rejects non-cent products', () => {
    expect(multiplyPasteAmount('0.1', '0.2')).toBe('0.02');
    expect(multiplyPasteAmount('0.1', '0.1')).toBe('0.01');
    expect(multiplyPasteAmount('2.50', '4')).toBe('10.00');
    expect(multiplyPasteAmount('0.001', '10')).toBe('0.01');
    expect(multiplyPasteAmount('0.1', '0.01')).toBeNull();

    for (const [quantity, rate] of [['0', '2'], ['2', '0'], ['-1', '3'], ['Infinity', '2'], ['2', 'NaN']]) {
      expect(multiplyPasteAmount(quantity, rate), `${quantity} × ${rate}`).toBeNull();
    }
  });

  it('AC-002 enforces the 128-character quantity and rate input boundaries', () => {
    const atLimit = `1.${'0'.repeat(126)}`;
    const overLimit = `1.${'0'.repeat(127)}`;

    expect(multiplyPasteAmount(atLimit, '1')).toBe('1.00');
    expect(multiplyPasteAmount(overLimit, '1')).toBeNull();
    expect(multiplyPasteAmount('1', atLimit)).toBe('1.00');
    expect(multiplyPasteAmount('1', overLimit)).toBeNull();
  });

  it('AC-001 AC-002 resolves active English and Indonesian labels against the budget enum', () => {
    const localeResources: LocaleResources[] = [
      { common: enCommon, finance: enFinance },
      { common: idCommon, finance: idFinance },
    ];

    for (const resources of localeResources) {
      const aliases = categoryAliasesFor(resources);
      const inputRows = categories.map((category) => [budgetCategoryLabel(category, translator(resources)), '1.00']);
      const preview = previewPasteRows(rows(...inputRows), mapping(), false, 'amount', aliases);

      expect(preview.rows.map((row) => row.category)).toEqual(categories);
      expect(preview.validCount).toBe(categories.length);
      expect(preview.invalidCount).toBe(0);
    }
  });

  it('AC-001 maps arbitrary columns, skips an included header and ignores unrelated cells', () => {
    const inputRows = [
      { rowNumber: 1, cells: ['Budget category', 'Notes', 'Budget', 'Other'] },
      { rowNumber: 2, cells: ['Office support', 'first line', '12.00', 'ignored'] },
    ];
    const customMapping = mapping({ category: 0, description: 1, amount: 2 });
    const preview = previewPasteRows(inputRows, customMapping, true, 'amount', { 'Office support': 'Labor' });
    const headerAsData = previewPasteRows(inputRows, customMapping, false, 'amount', { 'Office support': 'Labor' });

    expect(preview.rows).toHaveLength(1);
    expect(preview.rows[0]).toMatchObject({
      rowNumber: 2,
      raw: { category: 'Office support', description: 'first line', amount: '12.00' },
      category: 'Labor',
      description: 'first line',
      amount: '12.00',
      errors: [],
    });
    expect(preview.errors).toEqual([]);
    expect(headerAsData.rows).toHaveLength(2);
    expect(headerAsData.rows[0].errors).toContainEqual({ field: 'category', code: 'unknown-category' });
  });

  it('AC-001 requires an explicit category choice for ambiguous aliases', () => {
    const inputRows = rows(['Central', '3.00']);
    const ambiguous = previewPasteRows(inputRows, mapping(), false, 'amount', {
      Central: ['Labor', 'Materials'],
    });
    const resolved = previewPasteRows(inputRows, mapping(), false, 'amount', { Central: 'Materials' });

    expect(ambiguous.rows[0].category).toBeNull();
    expect(ambiguous.rows[0].errors).toContainEqual({ field: 'category', code: 'ambiguous-category' });
    expect(resolved.rows[0].category).toBe('Materials');
  });

  it('AC-002 uses the selected amount mode even when the other source is present or invalid', () => {
    const inputRows = rows(['Labor', '10.00', '2', '3'], ['Materials', 'not money', '0.1', '0.2']);
    const bothMappings = mapping({ amount: 1, quantity: 2, rate: 3 });
    const direct = previewPasteRows(inputRows, bothMappings, false, 'amount', {});
    const calculated = previewPasteRows(inputRows, bothMappings, false, 'quantity-rate', {});

    expect(direct.rows.map((row) => row.amount)).toEqual(['10.00', null]);
    expect(calculated.rows.map((row) => row.amount)).toEqual(['6.00', '0.02']);
    expect(direct.validCount).toBe(1);
    expect(calculated.validCount).toBe(2);
  });

  it('AC-002 requires a mode when direct and calculated inputs are both mapped', () => {
    const inputRows = rows(['Labor', '10.00', '2', '3']);
    const bothMappings = mapping({ amount: 1, quantity: 2, rate: 3 });
    const preview = previewPasteRows(inputRows, bothMappings, false, null as PasteMode | null, {});

    expect(preview.validCount).toBe(0);
    expect(preview.invalidCount).toBe(1);
    expect(preview.errors).toContainEqual({ field: 'mode', code: 'mode-required' });
    expect(preview.rows[0].errors).toContainEqual({ field: 'mode', code: 'mode-required' });
  });

  it('AC-001 AC-002 keeps identical valid rows distinct and sums only valid cents', () => {
    const inputRows = [
      { rowNumber: 3, cells: ['Labor', '2.50'] },
      { rowNumber: 4, cells: ['Labor', '2.50'] },
      { rowNumber: 5, cells: ['Materials', '1.001'] },
    ];
    const preview = previewPasteRows(inputRows, mapping(), false, 'amount', {});

    expect(preview.rows.map((row) => row.rowNumber)).toEqual([3, 4, 5]);
    expect(preview.validCount).toBe(2);
    expect(preview.invalidCount).toBe(1);
    expect(preview.totalCents).toBe(500n);
    expect(preview.rows[2].errors).toContainEqual({ field: 'amount', code: 'invalid-amount' });
    expect(Object.isFrozen(preview)).toBe(true);
    expect(Object.isFrozen(preview.rows[0].raw)).toBe(true);
  });

  it('AC-001 AC-002 reports missing required mappings and unknown categories', () => {
    const inputRows = rows(['Office support', '12.00']);
    const missingCategory = previewPasteRows(inputRows, mapping({ category: null }), false, 'amount', {});
    const missingAmount = previewPasteRows(inputRows, mapping({ amount: null }), false, 'amount', {});
    const unknownCategory = previewPasteRows(inputRows, mapping(), false, 'amount', {});

    expect(missingCategory.errors).toContainEqual({ field: 'category', code: 'mapping-required' });
    expect(missingCategory.invalidCount).toBe(1);
    expect(missingAmount.errors).toContainEqual({ field: 'amount', code: 'mapping-required' });
    expect(missingAmount.invalidCount).toBe(1);
    expect(unknownCategory.rows[0].errors).toContainEqual({ field: 'category', code: 'unknown-category' });
  });

  it('AC-001 AC-002 marks rows invalid when no money source is mapped and mode is unset', () => {
    const inputRows = rows(['Labor']);
    const noMoneyMapping = mapping({ amount: null, quantity: null, rate: null });
    const preview = previewPasteRows(inputRows, noMoneyMapping, false, null, {});

    expect(preview.errors).toContainEqual({ field: 'amount', code: 'mapping-required' });
    expect(preview.rows[0].amount).toBeNull();
    expect(preview.rows[0].errors).toContainEqual({ field: 'amount', code: 'mapping-required' });
    expect(preview.validCount).toBe(0);
    expect(preview.invalidCount).toBe(1);
    expect(preview.totalCents).toBe(0n);
  });

  it('AC-001 AC-002 accepts 500 nonblank rows and rejects 501 without truncating', () => {
    const inputRows = Array.from({ length: 502 }, (_, index) => ({
      rowNumber: index + 2,
      cells: index === 250 ? ['', ''] : ['Labor', '1.00'],
    }));
    const atLimit = previewPasteRows(inputRows.slice(0, 501), mapping(), false, 'amount', {});
    const overLimit = previewPasteRows(inputRows, mapping(), false, 'amount', {});

    expect(atLimit.rows).toHaveLength(500);
    expect(atLimit.validCount).toBe(500);
    expect(atLimit.totalCents).toBe(50000n);
    expect(overLimit.rows).toHaveLength(501);
    expect(overLimit.errors).toContainEqual({ field: 'rows', code: 'too-many-rows' });
    expect(overLimit.validCount).toBe(0);
    expect(overLimit.invalidCount).toBe(501);
  });
});

describe('isAmbiguousCommaNumber', () => {
  it('flags a single comma with exactly three trailing digits only', () => {
    for (const yes of ['12,345', ' 1,000 ', '999,999']) expect(isAmbiguousCommaNumber(yes), yes).toBe(true);
    for (const no of ['1,200.50', '1,234,567', '12,34', '12,3456', '12345', '1.234', '1234,567']) expect(isAmbiguousCommaNumber(no), no).toBe(false);
  });
});

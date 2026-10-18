import { describe, expect, it } from 'vitest';
import type { BudgetPostingAccount } from '@/src/lib/budget/categoryAccountMap';
import { taxSetupChoices, type TaxSetupPurpose } from './taxSetupChoices';

const account = (
  value: string,
  rootType: string,
  overrides: Partial<BudgetPostingAccount> = {},
): BudgetPostingAccount => ({
  account: value,
  accountName: value,
  accountNumber: null,
  parentAccount: null,
  rootType,
  isGroup: false,
  disabled: false,
  ...overrides,
});

const chart: BudgetPostingAccount[] = [
  account('1200 - Tax Receivable', 'Asset', { accountNumber: '1200', parentAccount: 'Current Assets' }),
  account('1210 - PPh 23 Expense', 'Expense'),
  account('2100 - Input VAT Liability', 'Liability', { accountNumber: '2100', parentAccount: 'Current Liabilities' }),
  account('2200 - PPh 23 Payable', 'Liability'),
  account('2300 - PPh 42 Payable', 'Liability'),
  account('4000 - Tax Income', 'Income'),
  account('1000 - Assets', 'Asset', { isGroup: true }),
  account('1250 - Disabled Asset', 'Asset', { disabled: true }),
  account('9000 - Unknown Root', 'Unknown'),
];

describe('taxSetupChoices', () => {
  it.each([
    ['receipt-withholding', '1200 - Tax Receivable'],
    ['input-vat', '1200 - Tax Receivable'],
  ] as const)('AC-S11-001: %s keeps enabled non-group Asset candidates with their account identity', (purpose, expected) => {
    const choices = taxSetupChoices(chart, purpose);

    expect(choices.map(({ account: value }) => value)).toEqual([expected]);
    expect(choices[0]).toBe(chart[0]);
  });

  it.each([
    ['pph23', ['2100 - Input VAT Liability', '2200 - PPh 23 Payable', '2300 - PPh 42 Payable']],
    ['pph42', ['2100 - Input VAT Liability', '2200 - PPh 23 Payable', '2300 - PPh 42 Payable']],
  ] as const)('AC-S11-001: %s keeps enabled non-group Liability candidates without guessing a tax subtype', (purpose, expected) => {
    const choices = taxSetupChoices(chart, purpose);

    expect(choices.map(({ account: value }) => value)).toEqual(expected);
    expect(choices.every((choice) => chart.includes(choice))).toBe(true);
  });

  it('AC-S11-001: each purpose accepts only its broad root type, not a tax-like account name', () => {
    const receiptChoices = taxSetupChoices(chart, 'receipt-withholding' satisfies TaxSetupPurpose);
    const pphChoices = taxSetupChoices(chart, 'pph23');

    expect(receiptChoices.some(({ account: value }) => value === '1210 - PPh 23 Expense')).toBe(false);
    expect(pphChoices.some(({ account: value }) => value === '1210 - PPh 23 Expense')).toBe(false);
    expect(pphChoices.some(({ account: value }) => value === '2100 - Input VAT Liability')).toBe(true);
  });
});

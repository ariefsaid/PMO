import { describe, expect, it } from 'vitest';
import type { BudgetPostingAccount } from '@/src/lib/budget/categoryAccountMap';
import { accountOption } from './accountOption';

const account = (overrides: Partial<BudgetPostingAccount> = {}): BudgetPostingAccount => ({
  account: 'Tax Prepaid - DEMO',
  accountName: 'Tax Prepaid',
  accountNumber: null,
  parentAccount: null,
  rootType: 'Asset',
  isGroup: false,
  disabled: false,
  ...overrides,
});

describe('accountOption', () => {
  it('labels the choice with the account name and joins number and parent as the secondary text', () => {
    const option = accountOption(account({ accountNumber: '1150', parentAccount: 'Current Assets' }));
    expect(option).toEqual({
      value: 'Tax Prepaid - DEMO',
      label: 'Tax Prepaid - DEMO',
      sub: '1150 · Current Assets',
    });
  });

  it('keeps a lone account number or parent account as the secondary text', () => {
    expect(accountOption(account({ accountNumber: '1150' })).sub).toBe('1150');
    expect(accountOption(account({ parentAccount: 'Current Assets' })).sub).toBe('Current Assets');
  });

  it('falls back to the provided context text only when the account has neither number nor parent', () => {
    expect(accountOption(account(), 'Asset account for client withholding received').sub).toBe(
      'Asset account for client withholding received',
    );
    expect(accountOption(account({ accountNumber: '1150' }), 'unused context').sub).toBe('1150');
  });
});

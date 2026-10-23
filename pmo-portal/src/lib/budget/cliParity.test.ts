/**
 * AC-CLI-B2 — `pmo accounts map set` (scripts/lib/pmo-accounts.mjs) applies the SAME account rules as the Admin
 * Accounting screen. The CLI cannot import this module (Node runs plain .mjs), so it carries a copy; this test binds
 * the copy to the app: same direct-cost verdict on every case, same category list as the database enum.
 */
import { describe, expect, it } from 'vitest';
import { Constants } from '../supabase/database.types';
import { isDirectCostPostingAccount, type BudgetPostingAccount } from './categoryAccountMap';

const cliUrl = new URL('../../../../scripts/lib/pmo-accounts.mjs', import.meta.url).href;
const loadCli = async () => (await import(/* @vite-ignore */ cliUrl)) as {
  BUDGET_CATEGORIES: readonly string[];
  isDirectCostPostingAccount: (a: BudgetPostingAccount) => boolean;
};

const base: BudgetPostingAccount = {
  account: 'a', accountName: 'a', accountNumber: null, parentAccount: null, rootType: 'Expense', isGroup: false, disabled: false,
};
const cases: BudgetPostingAccount[] = [
  base,
  { ...base, parentAccount: 'Direct Costs - X' },
  { ...base, parentAccount: 'Cost of Sales - X' },
  { ...base, parentAccount: 'COST OF GOODS SOLD - X' },
  { ...base, parentAccount: 'Overheads - X' },
  { ...base, accountNumber: '5100' },
  { ...base, accountNumber: '51' },
  { ...base, accountNumber: '51.1' },
  { ...base, accountNumber: '5200' },
  { ...base, accountNumber: '511-A' },
  { ...base, accountNumber: '510', parentAccount: 'Direct Costs' },
  { ...base, accountNumber: '5100', disabled: true },
  { ...base, accountNumber: '5100', isGroup: true },
  { ...base, accountNumber: '5100', rootType: 'Asset' },
];

describe('AC-CLI-B2 CLI copy of the account rules matches the app', () => {
  it('gives the same direct-cost verdict as the app on every case', async () => {
    const cli = await loadCli();
    for (const c of cases) expect(cli.isDirectCostPostingAccount(c), JSON.stringify(c)).toBe(isDirectCostPostingAccount(c));
  });

  it('lists the same budget categories as the database enum', async () => {
    const cli = await loadCli();
    expect([...cli.BUDGET_CATEGORIES]).toEqual([...Constants.public.Enums.budget_category]);
  });
});

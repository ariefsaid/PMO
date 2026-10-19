import type { BudgetPostingAccount } from '@/src/lib/budget/categoryAccountMap';

export type TaxSetupPurpose = 'receipt-withholding' | 'input-vat' | 'pph23' | 'pph42';

const rootTypeByPurpose: Record<TaxSetupPurpose, string> = {
  'receipt-withholding': 'Asset',
  'input-vat': 'Asset',
  pph23: 'Liability',
  pph42: 'Liability',
};

/** Keep only enabled ledger accounts of the broad root type supported by the tax setting. */
export function taxSetupChoices(
  accounts: readonly BudgetPostingAccount[],
  purpose: TaxSetupPurpose,
): BudgetPostingAccount[] {
  const rootType = rootTypeByPurpose[purpose];
  return accounts.filter((account) =>
    !account.disabled && !account.isGroup && account.rootType === rootType,
  );
}

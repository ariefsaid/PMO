import type { ComboboxOption } from '@/src/components/ui';
import type { BudgetPostingAccount } from '@/src/lib/budget/categoryAccountMap';

/** Combobox choice for a chart account: the account name labels the option; number and parent join as the secondary text, falling back to the given context. */
export function accountOption(account: BudgetPostingAccount, fallbackSub?: string): ComboboxOption {
  return {
    value: account.account,
    label: account.account,
    sub: [account.accountNumber, account.parentAccount].filter(Boolean).join(' · ') || fallbackSub,
  };
}

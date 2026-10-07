/**
 * #775 phase B — FR-EXP-112 / DD-EXP-16: which ERPNext account may back each expense posting key. ONE rule, run by
 * `external-set-company` when an Admin saves the map AND by the sweep before every posting (an account can be
 * re-typed in ERPNext after it was mapped). Spike 2026-10-07 §3d/§7: ERPNext ACCEPTS the supplier control account
 * `Creditors` and an untyped advance account (no Payment Ledger rows ⇒ no open-item trail), so PMO refuses both.
 * Fail closed: when the company's default payable account is unknown, nothing can be accepted as employee payable.
 */
export const EXPENSE_ACCOUNT_KEYS = ['employee_payable', 'employee_advance', 'Travel', 'Accommodation', 'Meals', 'Local transport', 'Other'] as const;
export type ExpenseAccountKey = (typeof EXPENSE_ACCOUNT_KEYS)[number];

export function isExpenseAccountKey(value: unknown): value is ExpenseAccountKey {
  return typeof value === 'string' && (EXPENSE_ACCOUNT_KEYS as readonly string[]).includes(value);
}

/** The Account fields the rule reads (one `getDoc('Account', name)` returns all of them). */
export interface ErpAccountFacts {
  name: string;
  root_type?: unknown;
  account_type?: unknown;
  is_group?: unknown;
  disabled?: unknown;
  company?: unknown;
  account_currency?: unknown;
}

export interface ExpenseAccountContext {
  company: string;
  companyCurrency: string | null;
  defaultPayableAccount: string | null;
}

/** `null` = acceptable; otherwise a client-safe sentence naming the account and the rule it breaks. */
export function expenseAccountProblem(key: ExpenseAccountKey, account: ErpAccountFacts | null, ctx: ExpenseAccountContext): string | null {
  if (!account) return `${key}: the account does not exist in ERPNext`;
  if (account.company !== ctx.company) return `${key}: ${account.name} belongs to another company`;
  if (Number(account.is_group) === 1) return `${key}: ${account.name} is a group account; choose a ledger account`;
  if (Number(account.disabled) === 1) return `${key}: ${account.name} is disabled`;
  if (ctx.companyCurrency && typeof account.account_currency === 'string' && account.account_currency
      && account.account_currency !== ctx.companyCurrency) {
    return `${key}: ${account.name} is kept in ${account.account_currency}, not ${ctx.companyCurrency}`;
  }
  if (key === 'employee_payable') {
    if (account.root_type !== 'Liability' || account.account_type !== 'Payable') {
      return `employee_payable: ${account.name} must be a Liability account of type Payable`;
    }
    if (!ctx.defaultPayableAccount) {
      return 'employee_payable: PMO cannot confirm this is not the supplier payable account — the company has no default payable account';
    }
    if (account.name === ctx.defaultPayableAccount) {
      return `employee_payable: ${account.name} is the company's supplier payable account; use a separate employee payable account`;
    }
    return null;
  }
  if (key === 'employee_advance') {
    if (account.root_type !== 'Asset' || account.account_type !== 'Payable') {
      return `employee_advance: ${account.name} must be an Asset account of type Payable`;
    }
    return null;
  }
  if (account.root_type !== 'Expense') return `${key}: ${account.name} must be an Expense account`;
  return null;
}

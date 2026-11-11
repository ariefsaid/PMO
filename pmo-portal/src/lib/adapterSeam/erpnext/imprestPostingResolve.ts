/**
 * #1515 §9 — resolve the two ends of a replenishment transfer BEFORE the outbox row exists, fail closed: the head office
 * bank from the binding, and the float's cash account re-checked with the rule that bound it (an account re-typed,
 * disabled or moved in ERPNext since is refused, not posted to). Pure over injected reads (Vitest- and Deno-importable).
 */
import type { ImprestGateTruth, ImprestResolvedRefs } from './imprestPostingCommand.ts';
import { imprestCashAccountFits, type ErpAccountFacts } from './expenseAccountRules.ts';

export interface ImprestResolveDeps {
  readBinding(): Promise<{ company: string | null; headOfficeAccount: string | null }>;
  readErpAccounts(names: string[]): Promise<ErpAccountFacts[]>;
  readErpCompany(company: string): Promise<{ currency: string | null } | null>;
}

export type ImprestResolution =
  | { outcome: 'ready'; refs: ImprestResolvedRefs }
  | { outcome: 'refuse'; code: string; message: string };

const refuse = (code: string, message: string): ImprestResolution => ({ outcome: 'refuse', code, message });

export async function resolveImprestPosting(truth: ImprestGateTruth, deps: ImprestResolveDeps): Promise<ImprestResolution> {
  const binding = await deps.readBinding();
  if (!binding.company) return refuse('config-rejected', 'the ERPNext binding names no company');
  if (!binding.headOfficeAccount) {
    return refuse('imprest-head-office-account-unconfigured', 'the ERPNext binding has no default bank account to fund site floats from');
  }
  const company = await deps.readErpCompany(binding.company);
  if (!company?.currency) return refuse('config-rejected', 'ERPNext states no default currency for the company');
  if (company.currency !== truth.currency) {
    return refuse('config-rejected', `the float is in ${truth.currency} but the ERPNext company keeps its books in ${company.currency}`);
  }
  const facts = await deps.readErpAccounts([truth.float_cash_account, binding.headOfficeAccount]);
  const floatAccount = facts.find((f) => f.name === truth.float_cash_account) ?? null;
  if (!imprestCashAccountFits(floatAccount, binding.company)) {
    return refuse('imprest-cash-account-unfit', `${truth.float_cash_account} is no longer a cash account of ${binding.company} that can take site cash`);
  }
  const bank = facts.find((f) => f.name === binding.headOfficeAccount);
  if (!bank || bank.company !== binding.company || Number(bank.is_group) === 1 || Number(bank.disabled) === 1) {
    return refuse('imprest-head-office-account-unfit', `${binding.headOfficeAccount} is missing, disabled, a group or another company's account`);
  }
  if (binding.headOfficeAccount === truth.float_cash_account) {
    return refuse('imprest-head-office-account-unfit', 'the head office account and the float cash account are the same account');
  }
  return { outcome: 'ready', refs: { company: binding.company, headOfficeAccount: binding.headOfficeAccount } };
}

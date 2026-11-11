/**
 * #775 phase B — FR-EXP-106/110/111/119/120: resolve every reference an expense posting needs, BEFORE the outbox row exists
 * (DD-EXP-15), fail closed. Pure orchestration over injected reads so it is Vitest- and Deno-importable; the sweep
 * wires the live reads (erpnext-sweep/index.ts `expenseResolveDepsLive`).
 * Outcomes: `ready` (drive it), `wait` (a dependency has not posted yet — leave the intent untouched), `refuse`
 * (record failed with the named code), `already-done` (a cancel ERPNext already shows, or a cancel of an approval
 * that never posted and never will — record pushed).
 */
import { expenseAccountProblem, imprestCashAccountFits, type ErpAccountFacts, type ExpenseAccountKey } from './expenseAccountRules.ts';
import type { ExpenseGateTruth, ExpenseResolvedRefs } from './expensePostingCommand.ts';

export interface ExpenseBindingFacts {
  company: string | null;
  /** `default_cash_account ?? default_bank_account` of the binding (the account supplier payments use). */
  cashAccount: string | null;
  costCenter: string | null;
  projectMap: Record<string, string>;
}

/** What the sweep reads from the ERPNext Company document before every posting (one read). */
export interface ErpCompanyFacts {
  currency: string | null;
  /** The company's supplier payable account (`default_payable_account`, usually `Creditors`) — read LIVE, so an
   *  account an accountant re-points in ERPNext after the binding was set up is still refused as employee payable. */
  defaultPayableAccount: string | null;
}

export interface ExpenseApprovalPostingFacts {
  push_state: string;
  erp_name: string | null;
  erp_cancelled_at: string | null;
}

export interface ExpenseResolveDeps {
  readBinding(): Promise<ExpenseBindingFacts>;
  /** The claimant's CONFIRMED ERP Employee name (P3b link, 0148), or null. */
  readConfirmedEmployee(profileId: string): Promise<string | null>;
  readAccountMap(): Promise<Partial<Record<ExpenseAccountKey, string>>>;
  readApprovalPosting(claimId: string): Promise<ExpenseApprovalPostingFacts | null>;
  /** Whether the claim's approval ever reached the outbox (any state): only then can it still post. */
  readApprovalOutboxExists(claimId: string): Promise<boolean>;
  /** One fact row per account that exists; a missing account is simply absent. */
  readErpAccounts(names: string[]): Promise<ErpAccountFacts[]>;
  /** The ERPNext Company document's facts, or null when the company does not exist. */
  readErpCompany(company: string): Promise<ErpCompanyFacts | null>;
  readErpJournalDocstatus(name: string): Promise<number | null>;
}

export type ExpenseResolution =
  | { outcome: 'ready'; refs: ExpenseResolvedRefs }
  | { outcome: 'wait'; reason: string }
  | { outcome: 'refuse'; code: string; message: string }
  | { outcome: 'already-done'; erpName: string | null };

const refuse = (code: string, message: string): ExpenseResolution => ({ outcome: 'refuse', code, message });
const NOT_POSTED: ExpenseResolution = { outcome: 'wait', reason: 'expense-approval-journal-not-posted' };

/**
 * OD-EXP-PB-1 (owner 2026-10-07, confirmed 2026-10-23) — FR-EXP-119: an approval of a claim on a DELIVERY project (any
 * status but `Internal Project`) debits the single project direct-cost account; an Internal Project or untagged claim
 * debits the overhead account of each expense type. `project_is_internal` is the database gate's read of the project
 * row at this attempt (0354) — never a client value, never a frozen one.
 */
export function postsToProjectDirectCost(truth: ExpenseGateTruth): boolean {
  return truth.posting === 'approval' && truth.project_id !== null && !truth.project_is_internal;
}

/** The account keys a posting needs (FR-EXP-106). */
export function accountKeysFor(truth: ExpenseGateTruth): ExpenseAccountKey[] {
  switch (truth.posting) {
    case 'approval':
      return postsToProjectDirectCost(truth)
        ? ['employee_payable', 'project_direct_cost']
        : ['employee_payable', ...Array.from(new Set(truth.lines.map((l) => l.expense_type as ExpenseAccountKey)))];
    case 'settlement':
      return ['employee_payable', 'employee_advance'];
    case 'claim-payment':
      return ['employee_payable'];
    case 'advance-payment':
    case 'advance-return':
      return ['employee_advance'];
    case 'approval-cancel':
      return [];
  }
}

export async function resolveExpensePosting(truth: ExpenseGateTruth, deps: ExpenseResolveDeps): Promise<ExpenseResolution> {
  const binding = await deps.readBinding();
  if (!binding.company) return refuse('config-rejected', 'the ERPNext binding names no company');

  if (truth.posting === 'approval-cancel') {
    const approval = await deps.readApprovalPosting(truth.claim_id);
    if (!approval || approval.push_state !== 'pushed' || !approval.erp_name) {
      // The claim is Cancelled (the gate asserted it), so an approval with no outbox command is refused fresh and
      // never posts: there is nothing to cancel. One that reached the outbox may still land — wait for it.
      return (await deps.readApprovalOutboxExists(truth.claim_id)) ? NOT_POSTED : { outcome: 'already-done', erpName: null };
    }
    if ((await deps.readErpJournalDocstatus(approval.erp_name)) === 2) return { outcome: 'already-done', erpName: approval.erp_name };
    return { outcome: 'ready', refs: {
      company: binding.company, employee: null, payableAccount: null, advanceAccount: null, expenseAccounts: {},
      erpProject: null, costCenter: null, cashAccount: null, approvalJournal: approval.erp_name } };
  }

  const isPaymentEntry = truth.posting === 'claim-payment' || truth.posting === 'advance-payment' || truth.posting === 'advance-return';
  // #1515 §9: a float record pays through the float's own account, so the company default is not needed for it.
  if (isPaymentEntry && !binding.cashAccount && !truth.float_cash_account) {
    return refuse('expense-cash-account-unconfigured', 'the ERPNext binding has no default cash or bank account');
  }
  const employee = await deps.readConfirmedEmployee(truth.claimant_id);
  if (!employee) return refuse('employee-unlinked', 'the claimant has no confirmed ERPNext employee link — an Admin must confirm it');

  const keys = accountKeysFor(truth);
  const map = await deps.readAccountMap();
  const missing = keys.filter((key) => !map[key]);
  if (missing.length > 0) {
    return refuse('expense-account-unmapped', `map these accounts in Administration › Accounting: ${missing.join(', ')}`);
  }

  let erpProject: string | null = null;
  if (truth.posting === 'approval' && truth.project_id) {
    erpProject = binding.projectMap[truth.project_id] ?? null;
    // FR-EXP-120: an unlinked Internal Project posts as overhead with no project tag; an unlinked delivery project is
    // refused — its cost must not reach the direct-cost account without the project that carries it.
    if (!erpProject && !truth.project_is_internal) {
      return refuse('project-unmapped', 'the claim’s project is not linked to an ERPNext project');
    }
  }

  let approvalJournal: string | null = null;
  if ((truth.posting === 'claim-payment' || truth.posting === 'settlement') && truth.approval_posting_exists) {
    const approval = await deps.readApprovalPosting(truth.claim_id);
    if (!approval || approval.push_state !== 'pushed' || !approval.erp_name) return NOT_POSTED;
    if (approval.erp_cancelled_at) {
      return refuse('expense-approval-journal-cancelled', 'the approval journal entry was cancelled in ERPNext');
    }
    approvalJournal = approval.erp_name;
  }

  const company = await deps.readErpCompany(binding.company);
  const companyCurrency = company?.currency ?? null;
  if (!companyCurrency) return refuse('config-rejected', 'ERPNext states no default currency for the company');
  if (companyCurrency !== truth.currency) {
    return refuse('config-rejected', `the claim is in ${truth.currency} but the ERPNext company keeps its books in ${companyCurrency}`);
  }
  // The same check that bound the float's account, re-run before every posting (spec §9): an account re-typed,
  // disabled or moved in ERPNext since it was bound is refused here, not posted to.
  const floatAccount = isPaymentEntry ? truth.float_cash_account : null;
  const facts = await deps.readErpAccounts(Array.from(new Set([...keys.map((key) => map[key] as string), ...(floatAccount ? [floatAccount] : [])])));
  if (floatAccount && !imprestCashAccountFits(facts.find((f) => f.name === floatAccount) ?? null, binding.company)) {
    return refuse('imprest-cash-account-unfit', `${floatAccount} is no longer a cash account of ${binding.company} that can take site cash`);
  }
  for (const key of keys) {
    const problem = expenseAccountProblem(key, facts.find((f) => f.name === map[key]) ?? null, {
      company: binding.company, companyCurrency, defaultPayableAccount: company?.defaultPayableAccount ?? null,
    });
    if (problem) return refuse('expense-account-invalid', problem);
  }

  const expenseAccounts: Record<string, string> = {};
  if (postsToProjectDirectCost(truth)) {
    // One debit row per expense type (the body builder keys rows by type), each on the direct-cost account.
    for (const line of truth.lines) expenseAccounts[line.expense_type] = map.project_direct_cost as string;
  } else {
    for (const key of keys) if (key !== 'employee_payable' && key !== 'employee_advance') expenseAccounts[key] = map[key] as string;
  }
  return { outcome: 'ready', refs: {
    company: binding.company,
    employee,
    payableAccount: keys.includes('employee_payable') ? (map.employee_payable as string) : null,
    advanceAccount: keys.includes('employee_advance') ? (map.employee_advance as string) : null,
    expenseAccounts,
    erpProject,
    costCenter: binding.costCenter,
    cashAccount: binding.cashAccount,
    approvalJournal,
  } };
}

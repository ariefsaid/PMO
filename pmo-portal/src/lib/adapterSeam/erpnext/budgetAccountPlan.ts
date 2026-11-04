import { AdapterError, type PmoRecord } from '../contract.ts';
import {
  resolveBudgetAccounts,
  type BudgetLineItem,
  type BudgetAccountRow,
  type CategoryAccountMapRow,
} from '../../budget/categoryAccountMap.ts';

export interface BudgetAccountUnitRecord extends PmoRecord {
  id: string;
  erp_doc_kind: 'budget';
  projectId: string;
  fiscal_year: string;
  erp_account: string;
  budget_intent: 'ensure' | 'remove';
  budget_predecessor: string | null;
  outbox_identity: string;
  activated_at: string;
  project_start_date: string;
  project_end_date: string | null;
  line_items: BudgetLineItem[];
}

export interface BudgetAccountIntent {
  fiscalYear: string;
  erpAccount: string;
  intent: 'ensure' | 'remove';
  amount: string | null;
  predecessor: string | null;
}

export interface BudgetRange {
  fromFiscalYear: string;
  toFiscalYear: string;
}

export interface BudgetRangeAccountIntent extends BudgetAccountIntent {
  toFiscalYear: string;
  predecessorModified: string | null;
}

export interface PriorBudgetAccount {
  fiscalYear: string;
  toFiscalYear?: string | null;
  erpAccount: string;
  erpBudgetName: string;
  cancelledAt: string | null;
  /** True only after the caller matched this mirror against the exact PMO range identity and ref. */
  pmoWitnessed?: boolean;
  /** Only a submitted ERP Budget is a live predecessor eligible for an in-place revision. */
  docstatus?: number | null;
  /** Exact latest ERP modified stamp cached with the source mirror. */
  erpModified?: string | null;
}

export function resolveV16BudgetAccounts(
  lines: readonly BudgetLineItem[],
  map: readonly CategoryAccountMapRow[],
): BudgetAccountRow[] {
  const rows = resolveBudgetAccounts(lines, map);
  const seen = new Set<string>();
  for (const row of rows) {
    if (seen.has(row.account)) {
      throw new AdapterError(
        'commit-rejected',
        `budget push: multiple non-zero categories resolve to account ${row.account}`,
      );
    }
    seen.add(row.account);
  }
  return rows;
}

export function planBudgetAccountIntents(
  fiscalYear: string,
  desired: readonly BudgetAccountRow[],
  prior: readonly PriorBudgetAccount[],
): BudgetAccountIntent[] {
  const desiredAccounts = new Set(desired.map((row) => row.account));
  const intents: BudgetAccountIntent[] = desired.map((row) => ({
    fiscalYear,
    erpAccount: row.account,
    intent: 'ensure',
    amount: row.budget_amount,
    predecessor: null,
  }));
  const seenHistory = new Set<string>();
  const predecessors = new Map<string, string>();

  for (const row of prior) {
    if (row.fiscalYear !== fiscalYear || !row.erpAccount || !row.erpBudgetName || row.cancelledAt !== null) continue;
    const historyKey = JSON.stringify([row.fiscalYear, row.erpAccount, row.erpBudgetName]);
    if (seenHistory.has(historyKey)) continue;
    seenHistory.add(historyKey);
    const predecessor = predecessors.get(row.erpAccount);
    if (predecessor !== undefined && predecessor !== row.erpBudgetName) {
      throw new AdapterError(
        'commit-rejected',
        `budget push: conflicting live predecessor names for account ${row.erpAccount}`,
      );
    }
    predecessors.set(row.erpAccount, row.erpBudgetName);
  }

  for (const [erpAccount, predecessor] of predecessors) {
    if (!desiredAccounts.has(erpAccount)) {
      intents.push({ fiscalYear, erpAccount, intent: 'remove', amount: null, predecessor });
    }
  }
  return intents;
}

/** Build range ensures/removals without ever adopting a different range as the same-range predecessor. */
export function planRangeAccountIntents(
  range: BudgetRange,
  desired: readonly BudgetAccountRow[],
  prior: readonly PriorBudgetAccount[],
): BudgetRangeAccountIntent[] {
  if (typeof range.fromFiscalYear !== 'string' || range.fromFiscalYear.trim() === ''
    || typeof range.toFiscalYear !== 'string' || range.toFiscalYear.trim() === '') {
    throw new AdapterError('commit-rejected', 'budget push: the fiscal-year range is unresolved');
  }

  const desiredAccounts = new Set<string>();
  for (const row of desired) {
    if (typeof row.account !== 'string' || row.account.trim() === '' || parseExactAmount(row.budget_amount) === null) {
      throw new AdapterError('commit-rejected', 'budget push: a desired range account is malformed');
    }
    if (desiredAccounts.has(row.account)) {
      throw new AdapterError('commit-rejected', `budget push: duplicate desired range account ${row.account}`);
    }
    desiredAccounts.add(row.account);
  }

  const livePredecessors = new Map<string, { name: string; modified: string | null }>();
  const seenHistory = new Set<string>();
  for (const row of prior) {
    if (row.fiscalYear !== range.fromFiscalYear || row.toFiscalYear !== range.toFiscalYear
      || row.pmoWitnessed !== true || row.docstatus !== 1 || row.cancelledAt !== null
      || typeof row.erpAccount !== 'string' || row.erpAccount.trim() === ''
      || typeof row.erpBudgetName !== 'string' || row.erpBudgetName.trim() === '') continue;
    const historyKey = JSON.stringify([row.erpAccount, row.erpBudgetName]);
    if (seenHistory.has(historyKey)) continue;
    seenHistory.add(historyKey);
    const predecessor = livePredecessors.get(row.erpAccount);
    if (predecessor !== undefined && (predecessor.name !== row.erpBudgetName
        || (predecessor.modified !== null && row.erpModified != null && predecessor.modified !== row.erpModified))) {
      throw new AdapterError(
        'commit-rejected',
        `budget push: conflicting live predecessor names for account ${row.erpAccount}`,
      );
    }
    livePredecessors.set(row.erpAccount, {
      name: row.erpBudgetName,
      modified: typeof row.erpModified === 'string' && row.erpModified !== '' ? row.erpModified : null,
    });
  }

  const intents: BudgetRangeAccountIntent[] = desired.map((row) => ({
    fiscalYear: range.fromFiscalYear,
    toFiscalYear: range.toFiscalYear,
    erpAccount: row.account,
    intent: 'ensure',
    amount: row.budget_amount,
    predecessor: livePredecessors.get(row.account)?.name ?? null,
    predecessorModified: livePredecessors.get(row.account)?.modified ?? null,
  }));
  for (const [erpAccount, predecessor] of livePredecessors) {
    if (!desiredAccounts.has(erpAccount)) {
      intents.push({
        fiscalYear: range.fromFiscalYear,
        toFiscalYear: range.toFiscalYear,
        erpAccount,
        intent: 'remove',
        amount: null,
        predecessor: predecessor.name,
        predecessorModified: predecessor.modified,
      });
    }
  }
  return intents;
}

function parseExactAmount(value: string): bigint | null {
  if (typeof value !== 'string') return null;
  const match = /^\d+(?:\.\d{1,2})?$/.exec(value);
  if (!match) return null;
  const [whole, fraction = ''] = value.split('.');
  return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
}


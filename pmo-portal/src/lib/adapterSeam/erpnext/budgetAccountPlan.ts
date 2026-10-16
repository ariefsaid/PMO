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

export interface PriorBudgetAccount {
  fiscalYear: string;
  erpAccount: string;
  erpBudgetName: string;
  cancelledAt: string | null;
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


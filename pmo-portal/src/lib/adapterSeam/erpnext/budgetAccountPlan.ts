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

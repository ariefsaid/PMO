/** Expense claim, receipt and posting repository contracts (#775). */
import type {
  ExpenseClaimWithRefs,
  ExpenseClaimLineRow,
  ExpenseClaimFilters,
  ExpenseClaimInput,
  ExpenseClaimPatch,
  ExpenseLineInput,
  ExpenseClaimStatus,
  ExpenseKind,
  ExpenseClaimRoute,
  ExpenseAdvanceAgingRow,
} from '@/src/lib/db/expenseClaims';
import type { ExpenseReceiptRow } from '@/src/lib/db/expenseReceipts';
import type { ExpenseAccountMapRow, ExpensePostingRow } from '../expensePostings';

/**
 * Expense claims and cash advances (#775, migration 0247). One-to-one with the DAL: header writes over granted
 * columns, lines as plain writes, every status move through the transition RPC, a cash return through its own
 * RPC — collapsing any pair would hide a control behind a convenience.
 */
export interface ExpenseClaimRepository {
  list(filters?: ExpenseClaimFilters): Promise<{ rows: ExpenseClaimWithRefs[]; truncated: boolean }>;
  get(id: string): Promise<ExpenseClaimWithRefs | null>;
  lines(claimId: string): Promise<ExpenseClaimLineRow[]>;
  create(input: ExpenseClaimInput): Promise<ExpenseClaimWithRefs>;
  update(id: string, kind: ExpenseKind, patch: ExpenseClaimPatch): Promise<void>;
  addLine(claimId: string, input: ExpenseLineInput): Promise<ExpenseClaimLineRow>;
  updateLine(id: string, input: ExpenseLineInput): Promise<void>;
  removeLine(id: string): Promise<void>;
  transition(id: string, to: ExpenseClaimStatus, opts?: { notes?: string | null; paymentReference?: string | null }): Promise<void>;
  recordReturn(id: string, amount: number, reference: string | null): Promise<void>;
  outstanding(advanceId: string): Promise<number | null>;
  routes(ids: string[]): Promise<ExpenseClaimRoute[]>;
  aging(): Promise<{ rows: ExpenseAdvanceAgingRow[]; truncated: boolean }>;
}

export interface ExpenseReceiptRepository {
  list(claimId: string): Promise<ExpenseReceiptRow[]>;
  prepareUpload(claimId: string, fileName: string): Promise<{ signedUrl: string; path: string }>;
  confirmUpload(claimId: string, path: string, title: string | null): Promise<ExpenseReceiptRow>;
  archive(id: string): Promise<void>;
  getSignedUrl(path: string, opts?: { download?: boolean }): Promise<string>;
  cleanupObject(path: string): Promise<void>;
}

export interface ExpensePostingRepository {
  /** What one claim posted to ERPNext (FR-EXP-117). */
  listForClaim(claimId: string): Promise<ExpensePostingRow[]>;
  /** The org's expense account map (FR-EXP-116). Writes go through `integrations.saveExpenseAccount`. */
  listAccountMap(): Promise<ExpenseAccountMapRow[]>;
}

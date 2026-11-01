/** Expense claim and receipt repository implementations (#775). */
import {
  listExpenseClaims,
  getExpenseClaim,
  listExpenseClaimLines,
  createExpenseClaim,
  updateExpenseClaim,
  addExpenseLine,
  updateExpenseLine,
  removeExpenseLine,
  transitionExpenseClaim,
  recordExpenseAdvanceReturn,
  getExpenseAdvanceOutstanding,
  getExpenseClaimRoutes,
  getExpenseAdvanceAging,
} from '@/src/lib/db/expenseClaims';
import {
  listExpenseReceipts,
  prepareExpenseReceiptUpload,
  confirmExpenseReceiptUpload,
  archiveExpenseReceipt,
  getExpenseReceiptUrl,
  cleanupExpenseReceiptObject,
} from '@/src/lib/db/expenseReceipts';
import { wrap } from './repositoryErrors';
import type { ExpenseClaimRepository, ExpenseReceiptRepository } from './contracts/expenses';

export const expenseClaimRepository: ExpenseClaimRepository = {
  list: (filters) => wrap(() => listExpenseClaims(filters)),
  get: (id) => wrap(() => getExpenseClaim(id)),
  lines: (claimId) => wrap(() => listExpenseClaimLines(claimId)),
  create: (input) => wrap(() => createExpenseClaim(input)),
  update: (id, kind, patch) => wrap(() => updateExpenseClaim(id, kind, patch)),
  addLine: (claimId, input) => wrap(() => addExpenseLine(claimId, input)),
  updateLine: (id, input) => wrap(() => updateExpenseLine(id, input)),
  removeLine: (id) => wrap(() => removeExpenseLine(id)),
  transition: (id, to, opts) => wrap(() => transitionExpenseClaim(id, to, opts)),
  recordReturn: (id, amount, reference) => wrap(() => recordExpenseAdvanceReturn(id, amount, reference)),
  outstanding: (advanceId) => wrap(() => getExpenseAdvanceOutstanding(advanceId)),
  routes: (ids) => wrap(() => getExpenseClaimRoutes(ids)),
  aging: () => wrap(() => getExpenseAdvanceAging()),
};

export const expenseReceiptsRepository: ExpenseReceiptRepository = {
  list: (claimId) => wrap(() => listExpenseReceipts(claimId)),
  prepareUpload: (claimId, fileName) => wrap(() => prepareExpenseReceiptUpload(claimId, fileName)),
  confirmUpload: (claimId, path, title) => wrap(() => confirmExpenseReceiptUpload(claimId, path, title)),
  archive: (id) => wrap(() => archiveExpenseReceipt(id)),
  getSignedUrl: (path, opts) => wrap(() => getExpenseReceiptUrl(path, opts)),
  cleanupObject: (path) => wrap(() => cleanupExpenseReceiptObject(path)),
};

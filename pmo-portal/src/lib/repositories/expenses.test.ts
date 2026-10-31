import { describe, vi } from 'vitest';
import * as claims from '@/src/lib/db/expenseClaims';
import * as receipts from '@/src/lib/db/expenseReceipts';
import { expenseClaimRepository, expenseReceiptsRepository } from './expenses';
import { itDelegates } from './__tests__/delegation';

vi.mock('@/src/lib/db/expenseClaims');
vi.mock('@/src/lib/db/expenseReceipts');

describe('expenseClaimRepository', () => {
  itDelegates(expenseClaimRepository as never, claims, [
    ['list', 'listExpenseClaims', [{ status: 'draft' }]],
    ['get', 'getExpenseClaim', ['c1']],
    ['lines', 'listExpenseClaimLines', ['c1']],
    ['create', 'createExpenseClaim', [{ kind: 'reimbursement' }]],
    ['update', 'updateExpenseClaim', ['c1', 'reimbursement', { title: 'T' }]],
    ['addLine', 'addExpenseLine', ['c1', { amount: 10 }]],
    ['updateLine', 'updateExpenseLine', ['l1', { amount: 20 }]],
    ['removeLine', 'removeExpenseLine', ['l1']],
    ['transition', 'transitionExpenseClaim', ['c1', 'submitted', { note: 'n' }]],
    ['recordReturn', 'recordExpenseAdvanceReturn', ['c1', 50, 'REF-1']],
    ['outstanding', 'getExpenseAdvanceOutstanding', ['adv1']],
    ['routes', 'getExpenseClaimRoutes', [['c1', 'c2']]],
    ['aging', 'getExpenseAdvanceAging', []],
  ]);
});

describe('expenseReceiptsRepository', () => {
  itDelegates(expenseReceiptsRepository as never, receipts, [
    ['list', 'listExpenseReceipts', ['c1']],
    ['prepareUpload', 'prepareExpenseReceiptUpload', ['c1', 'a.pdf']],
    ['confirmUpload', 'confirmExpenseReceiptUpload', ['c1', 'path/a.pdf', 'Receipt']],
    ['archive', 'archiveExpenseReceipt', ['r1']],
    ['getSignedUrl', 'getExpenseReceiptUrl', ['path/a.pdf', { download: true }]],
    ['cleanupObject', 'cleanupExpenseReceiptObject', ['path/a.pdf']],
  ]);
});

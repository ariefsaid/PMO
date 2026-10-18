import { AppError, toAppError } from '@/src/lib/appError';
import {
  cleanupExpenseCaptureReceiptObject, confirmExpenseCaptureReceiptUpload, createExpenseCapture,
  expenseCaptureReceiptObjectExists, getExpenseCaptureReceipt, prepareExpenseCaptureReceiptUpload,
  type ExpenseCaptureCommand, type ExpenseCaptureReceiptMetadata,
} from '@/src/lib/db/expenseCapture';

function assertCapturePath(claimId: string, fileId: string, path: string): void {
  const parts = path.split('/');
  if (parts.length !== 4 || parts[1] !== claimId || parts[2] !== fileId || parts.some((part) => !part)) {
    throw new AppError('Receipt recovery path does not match this saved draft.', '22023');
  }
}

function reconcile(
  existing: ExpenseCaptureReceiptMetadata | null,
  claimId: string,
  path: string,
): ExpenseCaptureReceiptMetadata | null {
  if (!existing) return null;
  if (existing.claim_id !== claimId || existing.file_path !== path) {
    throw new AppError('A different receipt already uses this attachment ID.', '23505');
  }
  return existing;
}

async function readForReconciliation(fileId: string): Promise<ExpenseCaptureReceiptMetadata | null> {
  try {
    return await getExpenseCaptureReceipt(fileId);
  } catch (error) {
    const appError = toAppError(error);
    throw new AppError('Receipt attachment status could not be verified. Keep the saved draft and retry.', appError.code);
  }
}

export const expenseCaptureRepository = {
  create: (input: ExpenseCaptureCommand) => createExpenseCapture(input),
  prepareReceipt: (claimId: string, fileId: string, fileName: string) => prepareExpenseCaptureReceiptUpload(claimId, fileId, fileName),
  objectExists: (path: string) => expenseCaptureReceiptObjectExists(path),
};

/** A lost insert response is resolved by stable file ID, then one safe retry only if no row exists. */
export async function confirmExpenseCaptureReceipt(
  claimId: string,
  fileId: string,
  path: string,
): Promise<ExpenseCaptureReceiptMetadata> {
  assertCapturePath(claimId, fileId, path);
  try {
    const row = await confirmExpenseCaptureReceiptUpload(claimId, fileId, path);
    return { id: row.id, claim_id: row.claim_id, file_path: row.file_path };
  } catch (firstError) {
    const existing = reconcile(await readForReconciliation(fileId), claimId, path);
    if (existing) return existing;
    try {
      const row = await confirmExpenseCaptureReceiptUpload(claimId, fileId, path);
      return { id: row.id, claim_id: row.claim_id, file_path: row.file_path };
    } catch (retryError) {
      const afterRetry = reconcile(await readForReconciliation(fileId), claimId, path);
      if (afterRetry) return afterRetry;
      throw toAppError(retryError ?? firstError);
    }
  }
}

/** Removes only the exact captured object after the same file ID proves that no metadata row is linked. */
export async function cleanupUnlinkedExpenseCaptureReceipt(
  claimId: string,
  fileId: string,
  path: string,
): Promise<void> {
  assertCapturePath(claimId, fileId, path);
  const existing = await getExpenseCaptureReceipt(fileId);
  if (existing) {
    reconcile(existing, claimId, path);
    throw new AppError('This receipt is already attached and will be preserved.', '23505');
  }
  await cleanupExpenseCaptureReceiptObject(path);
}

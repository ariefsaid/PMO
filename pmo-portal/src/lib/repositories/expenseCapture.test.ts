import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  create: vi.fn(),
  prepare: vi.fn(),
  confirm: vi.fn(),
  read: vi.fn(),
  objectExists: vi.fn(),
  cleanup: vi.fn(),
}));
vi.mock('@/src/lib/db/expenseCapture', () => ({
  createExpenseCapture: h.create,
  prepareExpenseCaptureReceiptUpload: h.prepare,
  confirmExpenseCaptureReceiptUpload: h.confirm,
  getExpenseCaptureReceipt: h.read,
  expenseCaptureReceiptObjectExists: h.objectExists,
  cleanupExpenseCaptureReceiptObject: h.cleanup,
}));

import {
  confirmExpenseCaptureReceipt,
  cleanupUnlinkedExpenseCaptureReceipt,
} from './expenseCapture';

const receipt = { id: 'file-29', claim_id: 'claim-29', file_path: 'org-29/claim-29/file-29/receipt.pdf' };

describe('AC-S29-003 expense capture receipt recovery repository', () => {
  beforeEach(() => {
    for (const fn of Object.values(h)) fn.mockReset();
  });

  it('AC-S29-003 reconciles a lost metadata response against the same stable file ID and path', async () => {
    h.confirm.mockRejectedValueOnce(new Error('connection lost'));
    h.read.mockResolvedValue(receipt);

    await expect(confirmExpenseCaptureReceipt('claim-29', 'file-29', receipt.file_path)).resolves.toEqual(receipt);
    expect(h.confirm).toHaveBeenCalledTimes(1);
    expect(h.read).toHaveBeenCalledWith('file-29');
  });

  it('AC-S29-003 retries metadata once with the same IDs only after reconciliation proves it absent', async () => {
    h.confirm.mockRejectedValueOnce(new Error('response lost'))
      .mockResolvedValueOnce(receipt);
    h.read.mockResolvedValue(null);

    await expect(confirmExpenseCaptureReceipt('claim-29', 'file-29', receipt.file_path)).resolves.toEqual(receipt);
    expect(h.confirm).toHaveBeenNthCalledWith(1, 'claim-29', 'file-29', receipt.file_path);
    expect(h.read).toHaveBeenCalledWith('file-29');
    expect(h.confirm).toHaveBeenNthCalledWith(2, 'claim-29', 'file-29', receipt.file_path);
  });

  it('AC-S29-003 refuses conflicting metadata and never retries or deletes a valid attachment', async () => {
    h.confirm.mockRejectedValue(new Error('duplicate ID'));
    h.read.mockResolvedValue({ ...receipt, file_path: 'org-29/claim-other/file-29/other.pdf' });

    await expect(confirmExpenseCaptureReceipt('claim-29', 'file-29', receipt.file_path)).rejects.toMatchObject({ code: '23505' });
    expect(h.confirm).toHaveBeenCalledTimes(1);
    expect(h.cleanup).not.toHaveBeenCalled();
  });

  it('AC-S29-003 deletes only the exact path after a metadata read proves it is unlinked', async () => {
    h.read.mockResolvedValue(null);
    h.cleanup.mockResolvedValue(undefined);

    await expect(cleanupUnlinkedExpenseCaptureReceipt('claim-29', 'file-29', receipt.file_path)).resolves.toBeUndefined();
    expect(h.read).toHaveBeenCalledWith('file-29');
    expect(h.cleanup).toHaveBeenCalledWith(receipt.file_path);
  });

  it('AC-S29-003 surfaces cleanup failure so the caller retains recovery state', async () => {
    h.read.mockResolvedValue(null);
    h.cleanup.mockRejectedValue(new Error('storage refused removal'));

    await expect(cleanupUnlinkedExpenseCaptureReceipt('claim-29', 'file-29', receipt.file_path))
      .rejects.toThrow('storage refused removal');
  });
});

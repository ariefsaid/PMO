import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn(), storageFrom: vi.fn() }));
vi.mock('@/src/lib/supabase/client', () => ({
  supabase: { rpc: h.rpc, from: h.from, storage: { from: h.storageFrom } },
}));

import { AppError } from '@/src/lib/appError';
import { supabase } from '@/src/lib/supabase/client';
import {
  cleanupExpenseCaptureReceiptObject, confirmExpenseCaptureReceiptUpload, createExpenseCapture,
  expenseCaptureReceiptObjectExists, getExpenseCaptureReceipt, prepareExpenseCaptureReceiptUpload,
} from './expenseCapture';

const command = {
  claimId: '00000000-0000-4000-8000-000000000029',
  lineId: '00000000-0000-4000-8000-000000000030',
  header: {
    kind: 'claim' as const,
    title: 'Taxi to project site',
    purpose: null,
    projectId: '00000000-0000-4000-8000-000000000031',
    budgetCategory: 'Special expenses' as const,
    advanceId: null,
  },
  firstLine: {
    expenseDate: '2026-10-07',
    expenseType: 'Travel' as const,
    description: 'Taxi to project site',
    amount: 150000,
  },
};

const receiptPath = 'org-29/claim-29/file-29/receipt.pdf';
const receiptRow = { id: 'file-29', claim_id: 'claim-29', file_path: receiptPath, title: 'Taxi receipt' };

function mockClaimRead(result: { data: unknown; error: { message: string; code?: string } | null }) {
  const maybeSingle = vi.fn().mockResolvedValue(result);
  const eq = vi.fn().mockReturnValue({ maybeSingle });
  const select = vi.fn().mockReturnValue({ eq });
  h.from.mockReturnValue({ select });
  return { select, eq, maybeSingle };
}

describe('AC-S29-003 expense capture DAL', () => {
  beforeEach(() => {
    h.rpc.mockReset().mockResolvedValue({ data: command.claimId, error: null });
    h.from.mockReset();
    h.storageFrom.mockReset();
  });

  it('AC-S29-003 sends one claim-and-line intent without client authority fields', async () => {
    await expect(createExpenseCapture(command)).resolves.toBe(command.claimId);
    expect(h.rpc).toHaveBeenCalledWith('create_expense_capture', {
      p_claim_id: command.claimId,
      p_line_id: command.lineId,
      p_header: {
        title: 'Taxi to project site',
        purpose: null,
        projectId: command.header.projectId,
        budgetCategory: 'Special expenses',
        advanceId: null,
      },
      p_first_line: command.firstLine,
    });
    const serializedArgs = JSON.stringify(h.rpc.mock.calls[0][1].p_header);
    for (const forbidden of ['org_id', 'claimant_id', 'status', 'currency', 'amount']) {
      expect(serializedArgs).not.toContain(forbidden);
    }
  });

  it('AC-S29-003 preserves the Supabase client receiver when invoking the RPC', async () => {
    h.rpc.mockImplementation(function (this: unknown) {
      if (this !== supabase) throw new TypeError('Supabase RPC receiver was not preserved');
      return Promise.resolve({ data: command.claimId, error: null });
    });

    await expect(createExpenseCapture(command)).resolves.toBe(command.claimId);
  });

  it('AC-S29-003 preserves the fixed claim ID for header-only capture', async () => {
    const headerOnly = { ...command, lineId: null, firstLine: null };
    await expect(createExpenseCapture(headerOnly)).resolves.toBe(command.claimId);
    expect(h.rpc.mock.calls[0][1]).toMatchObject({ p_claim_id: command.claimId, p_line_id: null, p_first_line: null });
  });

  it('AC-S29-003 rejects an advance and inconsistent line identifiers before RPC', async () => {
    await expect(createExpenseCapture({ ...command, lineId: null })).rejects.toBeInstanceOf(AppError);
    await expect(createExpenseCapture({ ...command, header: { ...command.header, kind: 'advance' } })).rejects.toBeInstanceOf(AppError);
    expect(h.rpc).not.toHaveBeenCalled();
  });

  it('AC-S29-003 preserves a server failure code for the recovery surface', async () => {
    h.rpc.mockResolvedValue({ data: null, error: { message: 'Capture rejected', code: '42501' } });
    await expect(createExpenseCapture(command)).rejects.toMatchObject({ message: 'Capture rejected', code: '42501' });
  });

  it('AC-S29-003 prepares a receipt path from the authorized claim organization and stable IDs', async () => {
    const read = mockClaimRead({ data: { org_id: 'org-29' }, error: null });
    const createSignedUploadUrl = vi.fn().mockResolvedValue({ data: { signedUrl: 'signed-upload', path: receiptPath }, error: null });
    h.storageFrom.mockReturnValue({ createSignedUploadUrl });

    await expect(prepareExpenseCaptureReceiptUpload('claim-29', 'file-29', 'receipt.pdf'))
      .resolves.toEqual({ signedUrl: 'signed-upload', path: receiptPath });

    expect(h.from).toHaveBeenCalledWith('expense_claims');
    expect(read.select).toHaveBeenCalledWith('org_id');
    expect(read.eq).toHaveBeenCalledWith('id', 'claim-29');
    expect(h.storageFrom).toHaveBeenCalledWith('expense-receipts');
    expect(createSignedUploadUrl).toHaveBeenCalledWith(receiptPath);
  });

  it('AC-S29-003 rejects unsupported files or missing stable file IDs before reading or uploading', async () => {
    await expect(prepareExpenseCaptureReceiptUpload('claim-29', 'file-29', 'receipt.txt'))
      .rejects.toThrow('File type not allowed (.txt)');
    await expect(prepareExpenseCaptureReceiptUpload('claim-29', '', 'receipt.pdf'))
      .rejects.toMatchObject({ code: '22023' });
    expect(h.from).not.toHaveBeenCalled();
    expect(h.storageFrom).not.toHaveBeenCalled();
  });

  it('AC-S29-003 reports an inaccessible claim and rejects a signed URL for a different path', async () => {
    mockClaimRead({ data: null, error: null });
    await expect(prepareExpenseCaptureReceiptUpload('claim-29', 'file-29', 'receipt.pdf'))
      .rejects.toThrow('Expense claim not found');

    mockClaimRead({ data: { org_id: 'org-29' }, error: null });
    h.storageFrom.mockReturnValue({
      createSignedUploadUrl: vi.fn().mockResolvedValue({ data: { signedUrl: 'signed-upload', path: 'org-29/other/file-29/receipt.pdf' }, error: null }),
    });
    await expect(prepareExpenseCaptureReceiptUpload('claim-29', 'file-29', 'receipt.pdf'))
      .rejects.toThrow('Could not create a stable receipt upload URL.');
  });

  it('AC-S29-003 inserts receipt metadata with the caller-stable file ID and normalized title', async () => {
    const single = vi.fn().mockResolvedValue({ data: receiptRow, error: null });
    const select = vi.fn().mockReturnValue({ single });
    const insert = vi.fn().mockReturnValue({ select });
    h.from.mockReturnValue({ insert });

    await expect(confirmExpenseCaptureReceiptUpload('claim-29', 'file-29', receiptPath, ' Taxi receipt ')).resolves.toEqual(receiptRow);
    expect(h.from).toHaveBeenCalledWith('expense_claim_files');
    expect(insert).toHaveBeenCalledWith({ id: 'file-29', claim_id: 'claim-29', file_path: receiptPath, title: 'Taxi receipt' });
  });

  it('AC-S29-003 reads one stable receipt ID for retry reconciliation', async () => {
    const read = mockClaimRead({ data: receiptRow, error: null });
    await expect(getExpenseCaptureReceipt('file-29')).resolves.toEqual(receiptRow);
    expect(read.select).toHaveBeenCalledWith('id, claim_id, file_path');
    expect(read.eq).toHaveBeenCalledWith('id', 'file-29');
  });

  it('AC-S29-003 checks the exact object name in its parent folder', async () => {
    const list = vi.fn().mockResolvedValue({ data: [{ name: 'another.pdf' }, { name: 'receipt.pdf' }], error: null });
    h.storageFrom.mockReturnValue({ list });
    await expect(expenseCaptureReceiptObjectExists(receiptPath)).resolves.toBe(true);
    expect(h.storageFrom).toHaveBeenCalledWith('expense-receipts');
    expect(list).toHaveBeenCalledWith('org-29/claim-29/file-29', { search: 'receipt.pdf' });
  });

  it('AC-S29-003 rejects malformed paths and removes only the exact confirmed-unlinked path', async () => {
    await expect(expenseCaptureReceiptObjectExists('receipt.pdf')).rejects.toMatchObject({ code: '22023' });
    expect(h.storageFrom).not.toHaveBeenCalled();

    const remove = vi.fn().mockResolvedValue({ error: null });
    h.storageFrom.mockReturnValue({ remove });
    await expect(cleanupExpenseCaptureReceiptObject(receiptPath)).resolves.toBeUndefined();
    expect(remove).toHaveBeenCalledWith([receiptPath]);
  });

  it('AC-S29-003 keeps Storage API errors observable as application errors', async () => {
    h.storageFrom.mockReturnValue({
      createSignedUploadUrl: vi.fn().mockResolvedValue({ data: null, error: { name: 'StorageError', message: 'Storage denied' } }),
    });
    mockClaimRead({ data: { org_id: 'org-29' }, error: null });
    await expect(prepareExpenseCaptureReceiptUpload('claim-29', 'file-29', 'receipt.pdf'))
      .rejects.toMatchObject({ message: 'Storage denied', code: '42501' });

    h.storageFrom.mockReturnValue({
      list: vi.fn().mockResolvedValue({ data: null, error: { name: 'StorageError', message: 'List denied' } }),
      remove: vi.fn().mockResolvedValue({ error: { name: 'StorageError', message: 'Remove denied' } }),
    });
    await expect(expenseCaptureReceiptObjectExists(receiptPath)).rejects.toMatchObject({ message: 'List denied', code: '42501' });
    await expect(cleanupExpenseCaptureReceiptObject(receiptPath)).rejects.toMatchObject({ message: 'Remove denied', code: '42501' });
  });
});

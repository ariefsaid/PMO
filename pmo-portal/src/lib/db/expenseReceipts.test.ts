import { describe, it, expect, vi, beforeEach } from 'vitest';

/** AC-EXP-051 — receipt objects land under the claim's org (read from the row, never the caller). */
const h = vi.hoisted(() => {
  const result = { value: { data: null as unknown, error: null as unknown } };
  const calls = { from: [] as string[], insert: [] as unknown[], update: [] as unknown[], signed: [] as string[] };
  const builder: Record<string, unknown> = {};
  const pass = () => builder;
  builder.select = pass; builder.eq = pass; builder.is = pass; builder.order = pass;
  builder.single = pass; builder.maybeSingle = pass;
  builder.insert = (b: unknown) => { calls.insert.push(b); return builder; };
  builder.update = (b: unknown) => { calls.update.push(b); return builder; };
  builder.then = (resolve: (v: unknown) => unknown) => resolve(result.value);
  const from = vi.fn((t: string) => { calls.from.push(t); return builder; });
  const storageFrom = vi.fn(() => ({
    createSignedUploadUrl: async (p: string) => { calls.signed.push(p); return { data: { signedUrl: 'https://signed', path: p }, error: null }; },
    createSignedUrl: async () => ({ data: { signedUrl: 'https://dl' }, error: null }),
    remove: async () => ({ data: null, error: null }),
  }));
  return { from, storageFrom, calls, result };
});
vi.mock('@/src/lib/supabase/client', () => ({ supabase: { from: h.from, storage: { from: h.storageFrom } } }));

import { prepareExpenseReceiptUpload, confirmExpenseReceiptUpload, archiveExpenseReceipt } from './expenseReceipts';

beforeEach(() => {
  h.from.mockClear(); h.storageFrom.mockClear();
  h.calls.from.length = 0; h.calls.insert.length = 0; h.calls.update.length = 0; h.calls.signed.length = 0;
  h.result.value = { data: null, error: null };
});

describe('AC-EXP-051 receipts', () => {
  it('AC-EXP-051 the object path is org/claim/file/name with the org read from the claim row', async () => {
    h.result.value = { data: { org_id: 'org-9' }, error: null };
    const out = await prepareExpenseReceiptUpload('claim-1', 'taxi receipt.pdf');
    expect(h.calls.from).toEqual(['expense_claims']);
    expect(h.storageFrom).toHaveBeenCalledWith('expense-receipts');
    const segments = out.path.split('/');
    expect(segments).toHaveLength(4);
    expect(segments[0]).toBe('org-9');
    expect(segments[1]).toBe('claim-1');
  });
  it('AC-EXP-051 a disallowed extension is refused before any call', async () => {
    await expect(prepareExpenseReceiptUpload('claim-1', 'evil.exe')).rejects.toThrow('File type not allowed (.exe)');
    expect(h.from).not.toHaveBeenCalled();
  });
  it('AC-EXP-051 confirm inserts only claim_id, file_path and title', async () => {
    h.result.value = { data: { id: 'f1' }, error: null };
    await confirmExpenseReceiptUpload('claim-1', 'org/claim-1/f/r.pdf', '  ');
    expect(h.calls.insert[0]).toEqual({ claim_id: 'claim-1', file_path: 'org/claim-1/f/r.pdf', title: null });
  });
  it('AC-EXP-051 an archive that lands nothing is a 42501', async () => {
    h.result.value = { data: [], error: null };
    await expect(archiveExpenseReceipt('f1')).rejects.toMatchObject({ code: '42501' });
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';

/** AC-EXP-051 — receipt objects land under the claim's org (read from the row, never the caller). */
const h = vi.hoisted(() => {
  const result = { value: { data: null as unknown, error: null as unknown } };
  const calls = { from: [] as string[], insert: [] as unknown[], update: [] as unknown[], signed: [] as string[], order: [] as unknown[], is: [] as unknown[], eq: [] as unknown[], gt: [] as unknown[], limit: [] as unknown[] };
  /**
   * AC-DATA28 — OPT-IN table-backed read fake, off unless a test sets `query.table` (every existing write
   * fixture keeps resolving `result.value`). `.eq` and `.is(col, null)` filter BEFORE the cap, `.gt('id',
   * cursor)` resumes after the named row, and one request never returns more than `cap` rows. Only the id
   * order is modelled: the DAL scans by unique id and must restore newest-first ordering in memory, so a
   * fake that also sorted by date would hide the sort under test.
   */
  const query = {
    table: null as string | null,
    rows: [] as Array<Record<string, unknown>>,
    cap: 1000,
    failAtCursor: null as string | null,
    error: { message: 'statement timeout', code: '57014' },
    reads: [] as Array<{
      table: string; eq: Array<[string, unknown]>; isNull: string[]; cursor: string | null;
      orders: Array<[string, unknown]>; limit: number | null;
    }>,
  };
  const state = {
    table: '', eq: [] as Array<[string, unknown]>, isNull: [] as string[], cursor: null as string | null,
    orders: [] as Array<[string, unknown]>, limit: null as number | null,
  };
  const serveTable = () => {
    query.reads.push({
      table: state.table, eq: [...state.eq], isNull: [...state.isNull], cursor: state.cursor,
      orders: [...state.orders], limit: state.limit,
    });
    if (query.failAtCursor !== null && state.cursor === query.failAtCursor) return { data: null, error: query.error };
    const rows = query.rows
      .filter((r) => state.eq.every(([c, v]) => r[c] === v) && state.isNull.every((c) => r[c] == null))
      .filter((r) => state.cursor === null || String(r.id) > state.cursor)
      .sort((a, b) => (String(a.id) < String(b.id) ? -1 : String(a.id) > String(b.id) ? 1 : 0));
    const take = Math.min(state.limit ?? query.cap, query.cap);
    return { data: rows.slice(0, take), error: null };
  };
  const builder: Record<string, unknown> = {};
  const pass = () => builder;
  builder.select = pass; builder.single = pass; builder.maybeSingle = pass;
  builder.eq = (col: string, val: unknown) => { calls.eq.push([col, val]); state.eq.push([col, val]); return builder; };
  builder.is = (col: string, val: unknown) => { calls.is.push([col, val]); if (val === null) state.isNull.push(col); return builder; };
  builder.order = (...args: unknown[]) => { calls.order.push(args.length === 1 ? args[0] : args); state.orders.push(args as [string, unknown]); return builder; };
  builder.gt = (...args: unknown[]) => { calls.gt.push(args.length === 1 ? args[0] : args); state.cursor = String(args[1]); return builder; };
  builder.limit = (...args: unknown[]) => { calls.limit.push(args.length === 1 ? args[0] : args); state.limit = Number(args[0]); return builder; };
  builder.insert = (b: unknown) => { calls.insert.push(b); return builder; };
  builder.update = (b: unknown) => { calls.update.push(b); return builder; };
  builder.then = (resolve: (v: unknown) => unknown) => {
    if (query.table !== null && state.table === query.table) return resolve(serveTable());
    return resolve(result.value);
  };
  const from = vi.fn((t: string) => {
    calls.from.push(t);
    state.table = t; state.eq = []; state.isNull = []; state.cursor = null; state.orders = []; state.limit = null;
    return builder;
  });
  const storageFrom = vi.fn(() => ({
    createSignedUploadUrl: async (p: string) => { calls.signed.push(p); return { data: { signedUrl: 'https://signed', path: p }, error: null }; },
    createSignedUrl: async () => ({ data: { signedUrl: 'https://dl' }, error: null }),
    remove: async () => ({ data: null, error: null }),
  }));
  return { from, storageFrom, calls, result, query };
});
vi.mock('@/src/lib/supabase/client', () => ({ supabase: { from: h.from, storage: { from: h.storageFrom } } }));

import { prepareExpenseReceiptUpload, confirmExpenseReceiptUpload, archiveExpenseReceipt, listExpenseReceipts } from './expenseReceipts';

beforeEach(() => {
  h.from.mockClear(); h.storageFrom.mockClear();
  h.calls.from.length = 0; h.calls.insert.length = 0; h.calls.update.length = 0; h.calls.signed.length = 0;
  h.calls.order.length = 0; h.calls.is.length = 0; h.calls.eq.length = 0; h.calls.gt.length = 0; h.calls.limit.length = 0;
  h.result.value = { data: null, error: null };
  h.query.table = null; h.query.rows = []; h.query.failAtCursor = null; h.query.reads.length = 0;
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
  it('preserves claim read and storage errors and reports a missing upload URL', async () => {
    h.result.value = { data: null, error: { message: 'Read denied', code: '42501' } };
    await expect(prepareExpenseReceiptUpload('claim-1', 'receipt.pdf')).rejects.toMatchObject({ message: 'Read denied', code: '42501' });
    h.result.value = { data: { org_id: 'org-9' }, error: null };
    h.storageFrom.mockReturnValueOnce({ createSignedUploadUrl: async () => ({ data: null, error: { name: 'StorageError', message: 'Storage denied', status: 403 } }) } as never);
    await expect(prepareExpenseReceiptUpload('claim-1', 'receipt.pdf')).rejects.toMatchObject({ message: 'The file service could not complete the request.', code: '42501' });
    h.storageFrom.mockReturnValueOnce({ createSignedUploadUrl: async () => ({ data: null, error: null }) } as never);
    await expect(prepareExpenseReceiptUpload('claim-1', 'receipt.pdf')).rejects.toThrow('Could not create upload URL');
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

/** AC-DATA28 — the receipt read is a whole-set read of the claim's live files, newest first. */
const uid = (i: number) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`;
const CLAIM = 'claim-a';

function receipt(i: number, over: Record<string, unknown> = {}) {
  return {
    id: uid(i), org_id: 'org-1', claim_id: CLAIM, title: `Receipt ${i}`,
    file_path: `org-1/${CLAIM}/${uid(i)}/receipt-${i}.pdf`,
    uploaded_by_id: 'user-1', created_at: '2026-05-01T00:00:00+00:00', archived_at: null, ...over,
  };
}

describe('AC-DATA28 complete claim receipt reads', () => {
  it('AC-DATA28 reads all 1001 unarchived receipts once and excludes archived and other-claim files', async () => {
    const visible = Array.from({ length: 1001 }, (_, i) => receipt(i));
    h.query.table = 'expense_claim_files';
    h.query.rows = [
      ...visible,
      receipt(2000, { claim_id: 'claim-b' }),
      receipt(2001, { archived_at: '2026-06-01T00:00:00+00:00' }),
      receipt(2002, { archived_at: '2026-06-02T00:00:00+00:00' }),
    ];
    const out = await listExpenseReceipts(CLAIM);
    expect(out).toHaveLength(1001);
    expect(new Set(out.map((r) => r.id)).size).toBe(1001);
    for (const row of out) {
      expect(row.claim_id).toBe(CLAIM);
      expect(row.archived_at).toBeNull();
    }
    const byId = new Map(visible.map((r) => [r.id, r]));
    // Filename, stored path and title survive exactly as stored — the link the object is fetched with.
    for (const row of out) expect(row).toEqual(byId.get(row.id));
  });

  it('AC-DATA28 scans by unique id keyset with the claim and archived filters, a cursor and the page limit', async () => {
    h.query.table = 'expense_claim_files';
    h.query.rows = Array.from({ length: 1001 }, (_, i) => receipt(i));
    await listExpenseReceipts(CLAIM);
    expect(h.query.reads).toHaveLength(2);
    expect(h.query.reads[0]).toMatchObject({
      table: 'expense_claim_files', eq: [['claim_id', CLAIM]], isNull: ['archived_at'], cursor: null, limit: 1000,
    });
    expect(h.query.reads[0]!.orders).toEqual([['id', { ascending: true }]]);
    expect(h.query.reads[1]).toMatchObject({ eq: [['claim_id', CLAIM]], isNull: ['archived_at'], cursor: uid(999), limit: 1000 });
  });

  it('AC-DATA28 orders newest actual timestamp first, with equal instants tied by id', async () => {
    // Scrambled ids; two pairs pit the offset text against the real instant, so a lexicographic
    // timestamp compare would order them wrongly.
    const fixtures = [
      receipt(3, { created_at: '2026-05-01T01:00:00Z' }),
      receipt(6, { created_at: '2026-05-01T08:00:00+07:00' }), // = 01:00Z, ties with id 3
      receipt(1, { created_at: '2026-05-01T09:00:00+07:00' }), // = 02:00Z, the newest
      receipt(5, { created_at: '2026-04-30T23:00:00Z' }),
      receipt(4, { created_at: '2026-05-01T03:00:00+07:00' }), // = 2026-04-30T20:00Z, the oldest
    ];
    h.query.table = 'expense_claim_files';
    h.query.rows = fixtures;
    const out = await listExpenseReceipts(CLAIM);
    expect(out.map((r) => r.id)).toEqual([uid(1), uid(3), uid(6), uid(5), uid(4)]);
    expect(out[0]).toEqual(fixtures[2]);
  });

  it('AC-DATA28 a claim with no live receipts returns an empty array', async () => {
    h.query.table = 'expense_claim_files';
    h.query.rows = [receipt(1, { archived_at: '2026-06-01T00:00:00+00:00' })];
    await expect(listExpenseReceipts(CLAIM)).resolves.toEqual([]);
  });

  it('AC-DATA28 exactly 1000 receipts needs the extra empty read and returns them all once', async () => {
    h.query.table = 'expense_claim_files';
    h.query.rows = Array.from({ length: 1000 }, (_, i) => receipt(i));
    const out = await listExpenseReceipts(CLAIM);
    expect(out).toHaveLength(1000);
    expect(new Set(out.map((r) => r.id)).size).toBe(1000);
    expect(h.query.reads).toHaveLength(2);
    expect(h.query.reads[1]!.cursor).toBe(uid(999));
  });

  it('AC-DATA28 a page-2 error rejects with the real code instead of returning a partial list', async () => {
    h.query.table = 'expense_claim_files';
    h.query.rows = Array.from({ length: 1001 }, (_, i) => receipt(i));
    h.query.failAtCursor = uid(999);
    await expect(listExpenseReceipts(CLAIM)).rejects.toMatchObject({
      name: 'AppError', message: 'statement timeout', code: '57014',
    });
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Chainable supabase query-builder + storage mock — same harness shape as documents.test.ts.
const h = vi.hoisted(() => {
  const result = { value: { data: null as unknown, error: null as unknown } };
  const calls = {
    from: [] as unknown[],
    select: [] as unknown[],
    eq: [] as unknown[],
    is: [] as unknown[],
    order: [] as unknown[],
    insert: [] as unknown[],
    update: [] as unknown[],
    maybeSingle: 0,
    single: 0,
  };
  const builder: Record<string, unknown> = {};
  const chain = (name: keyof typeof calls) => (...args: unknown[]) => {
    if (name === 'maybeSingle' || name === 'single') {
      (calls[name] as number)++;
    } else {
      (calls[name] as unknown[]).push(args.length === 1 ? args[0] : args);
    }
    return builder;
  };
  builder.select = chain('select');
  builder.eq = chain('eq');
  builder.is = chain('is');
  builder.order = chain('order');
  builder.insert = chain('insert');
  builder.update = chain('update');
  builder.maybeSingle = chain('maybeSingle');
  builder.single = chain('single');
  builder.then = (resolve: (v: unknown) => unknown) => resolve(result.value);
  const from = vi.fn((table: string) => {
    calls.from.push(table);
    return builder;
  });

  // Storage mock — records the bucket + the createSignedUploadUrl path.
  const storageResult = {
    value: { data: { signedUrl: 'https://signed/url', path: 'PATH' }, error: null as unknown },
  };
  const storageCalls = {
    bucket: [] as unknown[],
    createSignedUploadUrl: [] as unknown[],
    createSignedUrl: [] as unknown[],
    remove: [] as unknown[],
  };
  const dlResult = { value: { data: { signedUrl: 'https://dl/url' }, error: null as unknown } };
  const storageBuilder = {
    createSignedUploadUrl: vi.fn((path: string) => {
      storageCalls.createSignedUploadUrl.push(path);
      return Promise.resolve(storageResult.value);
    }),
    createSignedUrl: vi.fn((...args: unknown[]) => {
      storageCalls.createSignedUrl.push(args);
      return Promise.resolve(dlResult.value);
    }),
    remove: vi.fn((paths: unknown) => {
      storageCalls.remove.push(paths);
      return Promise.resolve({ data: [], error: null });
    }),
  };
  const storage = {
    from: vi.fn((bucket: string) => {
      storageCalls.bucket.push(bucket);
      return storageBuilder;
    }),
  };
  return { from, calls, result, storage, storageCalls, storageResult, dlResult };
});

vi.mock('@/src/lib/supabase/client', () => ({ supabase: { from: h.from, storage: h.storage } }));

import {
  listProcurementFiles,
  prepareUpload,
  confirmUpload,
  archiveProcurementFile,
  buildProcurementFilePath,
  getSignedDownloadUrl,
  cleanupStorageObject,
} from './procurementFiles';
import { AppError } from '@/src/lib/appError';

beforeEach(() => {
  h.from.mockClear();
  for (const k of Object.keys(h.calls) as (keyof typeof h.calls)[]) {
    if (typeof h.calls[k] === 'number') (h.calls[k] as unknown) = 0;
    else (h.calls[k] as unknown[]).length = 0;
  }
  h.result.value = { data: null, error: null };
  h.storage.from.mockClear();
  h.storageCalls.bucket.length = 0;
  h.storageCalls.createSignedUploadUrl.length = 0;
  h.storageCalls.createSignedUrl.length = 0;
  h.storageCalls.remove.length = 0;
  h.storageResult.value = {
    data: { signedUrl: 'https://signed/url', path: 'PATH' },
    error: null,
  };
  h.dlResult.value = { data: { signedUrl: 'https://dl/url' }, error: null };
});

describe('AC-PF-008 listProcurementFiles', () => {
  it('AC-PF-008: selects procurement_quotation_files, filters archived_at is null, orders created_at desc', async () => {
    h.result.value = {
      data: [{ id: 'f1', org_id: 'o1', quotation_id: 'q1', file_path: 'p', created_at: 't' }],
      error: null,
    };
    const rows = await listProcurementFiles('quotation', 'q1');
    expect(h.calls.from).toEqual(['procurement_quotation_files']);
    // parent column eq + archived_at is null + order created_at desc
    expect(h.calls.eq).toContainEqual(['quotation_id', 'q1']);
    expect(h.calls.is).toContainEqual(['archived_at', null]);
    expect(h.calls.order).toContainEqual(['created_at', { ascending: false }]);
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe('f1');
    // The parent FK (quotation_id) is normalized to parent_id.
    expect(rows[0].parent_id).toBe('q1');
  });

  it('AC-PF-008: receipt phase targets procurement_receipt_files with receipt_id', async () => {
    h.result.value = { data: [], error: null };
    await listProcurementFiles('receipt', 'r1');
    expect(h.calls.from).toEqual(['procurement_receipt_files']);
    expect(h.calls.eq).toContainEqual(['receipt_id', 'r1']);
  });
});

describe('AC-PF-009 prepareUpload', () => {
  it('AC-PF-009: returns {signedUrl, path, fileId} with a 5-segment path and uses the procurement-files bucket', async () => {
    const res = await prepareUpload('quotation', 'q1', 'proc1', 'org1', 'My Quote.pdf');
    expect(res.signedUrl).toBe('https://signed/url');
    expect(h.storageCalls.bucket).toContain('procurement-files');
    // The path passed to createSignedUploadUrl is the 5-segment path.
    const path = h.storageCalls.createSignedUploadUrl[0] as string;
    expect(path.split('/')).toHaveLength(5);
    expect(path.startsWith('org1/proc1/quotation/')).toBe(true); // org=seg1, proc=seg2
    expect(path.endsWith('/my-quote.pdf')).toBe(true);
    expect(typeof res.fileId).toBe('string');
  });

  it('AC-PF-009: rejects a denied extension before touching storage', async () => {
    await expect(prepareUpload('quotation', 'q1', 'proc1', 'org1', 'evil.exe')).rejects.toThrow();
    expect(h.storageCalls.createSignedUploadUrl).toHaveLength(0);
  });

  it('AC-PF-009: a storage error throws an AppError (code 42501)', async () => {
    h.storageResult.value = { data: null, error: { message: 'no access', name: 'StorageError' } };
    await expect(prepareUpload('receipt', 'r1', 'proc1', 'org1', 'gr.pdf')).rejects.toMatchObject({
      code: '42501',
    });
  });
});

describe('AC-PF-010 archiveProcurementFile', () => {
  it('AC-PF-010: updates archived_at on procurement_invoice_files for the given id', async () => {
    await archiveProcurementFile('invoice', 'inv-file-1');
    expect(h.calls.from).toEqual(['procurement_invoice_files']);
    const patch = h.calls.update[0] as { archived_at?: string };
    expect(patch.archived_at).toBeTruthy();
    expect(h.calls.eq).toContainEqual(['id', 'inv-file-1']);
  });
});

describe('AC-PF-011 buildProcurementFilePath', () => {
  it('AC-PF-011: returns {org}/{proc}/{phase}/{fileId}/{sanitized-name}', () => {
    const path = buildProcurementFilePath('org1', 'proc1', 'receipt', 'file9', 'GR Scan.PDF');
    expect(path).toBe('org1/proc1/receipt/file9/gr-scan.pdf');
    expect(path.split('/')).toHaveLength(5);
  });

  it('AC-PF-011: sanitizes path-traversal in the filename segment', () => {
    const path = buildProcurementFilePath('org1', 'proc1', 'quotation', 'file9', '../../etc/passwd');
    expect(path.split('/')).toHaveLength(5);
    expect(path).not.toContain('..');
  });
});

describe('AC-PF-003 confirmUpload (insert child row, org_id never sent)', () => {
  it('AC-PF-003: quotation insert targets procurement_quotation_files with quotation_id + file_path', async () => {
    h.result.value = { data: { id: 'row1', quotation_id: 'q1', file_path: 'p' }, error: null };
    const row = await confirmUpload('quotation', 'q1', 'org/proc/quotation/f/q.pdf', 'Quote', 'u1');
    expect(h.calls.from).toEqual(['procurement_quotation_files']);
    const insert = h.calls.insert[0] as Record<string, unknown>;
    expect(insert.quotation_id).toBe('q1');
    expect(insert.file_path).toBe('org/proc/quotation/f/q.pdf');
    expect(insert.uploaded_by_id).toBe('u1');
    expect('org_id' in insert).toBe(false); // org_id is NEVER client-sent
    expect(row.id).toBe('row1');
  });

  it('AC-PF-003: receipt insert targets procurement_receipt_files with receipt_id', async () => {
    h.result.value = { data: { id: 'row2', receipt_id: 'r1' }, error: null };
    await confirmUpload('receipt', 'r1', 'p', null, 'u1');
    expect(h.calls.from).toEqual(['procurement_receipt_files']);
    expect((h.calls.insert[0] as Record<string, unknown>).receipt_id).toBe('r1');
  });

  it('AC-PF-003: invoice insert targets procurement_invoice_files with invoice_id', async () => {
    h.result.value = { data: { id: 'row3', invoice_id: 'i1' }, error: null };
    await confirmUpload('invoice', 'i1', 'p', '  ', 'u1');
    expect(h.calls.from).toEqual(['procurement_invoice_files']);
    expect((h.calls.insert[0] as Record<string, unknown>).invoice_id).toBe('i1');
    // a blank title trims to null
    expect((h.calls.insert[0] as Record<string, unknown>).title).toBeNull();
  });

  it('AC-PF-003: a write error throws an AppError preserving the Postgres code', async () => {
    h.result.value = { data: null, error: { message: 'denied', code: '42501' } };
    await expect(confirmUpload('quotation', 'q1', 'p', null, 'u1')).rejects.toMatchObject({
      code: '42501',
    });
  });
});

describe('AC-PF-010 archiveProcurementFile (all phases)', () => {
  it('AC-PF-010: quotation archive targets procurement_quotation_files', async () => {
    await archiveProcurementFile('quotation', 'qf1');
    expect(h.calls.from).toEqual(['procurement_quotation_files']);
    expect(h.calls.eq).toContainEqual(['id', 'qf1']);
  });

  it('AC-PF-010: receipt archive targets procurement_receipt_files', async () => {
    await archiveProcurementFile('receipt', 'rf1');
    expect(h.calls.from).toEqual(['procurement_receipt_files']);
  });

  it('AC-PF-010: a failure throws an AppError', async () => {
    h.result.value = { data: null, error: { message: 'nope', code: '42501' } };
    await expect(archiveProcurementFile('invoice', 'x')).rejects.toBeInstanceOf(AppError);
  });
});

describe('AC-PF-006 getSignedDownloadUrl', () => {
  it('AC-PF-006: returns a signed URL from the procurement-files bucket', async () => {
    const url = await getSignedDownloadUrl('org/proc/quotation/f/q.pdf');
    expect(url).toBe('https://dl/url');
    expect(h.storageCalls.bucket).toContain('procurement-files');
  });

  it('AC-PF-006: download option forces an attachment filename', async () => {
    await getSignedDownloadUrl('org/proc/quotation/f/q.pdf', { download: true });
    const args = h.storageCalls.createSignedUrl[0] as unknown[];
    expect(args[2]).toEqual({ download: 'q.pdf' });
  });

  it('AC-PF-006: a storage error throws', async () => {
    h.dlResult.value = { data: null, error: { message: 'bad', name: 'StorageError' } };
    await expect(getSignedDownloadUrl('p')).rejects.toBeInstanceOf(AppError);
  });
});

describe('cleanupStorageObject', () => {
  it('removes the object path from the procurement-files bucket', async () => {
    await cleanupStorageObject('org/proc/quotation/f/q.pdf');
    expect(h.storageCalls.bucket).toContain('procurement-files');
    expect(h.storageCalls.remove[0]).toEqual(['org/proc/quotation/f/q.pdf']);
  });

  it('is a no-op for an empty path', async () => {
    await cleanupStorageObject('');
    expect(h.storageCalls.remove).toHaveLength(0);
  });
});

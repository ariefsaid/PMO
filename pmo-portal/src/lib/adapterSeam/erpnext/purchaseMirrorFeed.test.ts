import { describe, expect, it, vi } from 'vitest';
import { feedPurchaseMirror, purchaseWmDomain } from './purchaseMirrorFeed.ts';
import { FakePostgrest } from '@/test/postgrestFake.ts';

const PO = { name: 'PUR-ORD-1', supplier: 'SUP-1', supplier_name: 'Acme', transaction_date: '2026-01-05', schedule_date: '2026-01-20',
  currency: 'IDR', grand_total: 900000, status: 'To Bill', docstatus: 1, project: 'ERP-A', modified: '2026-01-05 09:00:00' };
const PI = { name: 'ACC-PINV-1', supplier: 'SUP-1', supplier_name: 'Acme', posting_date: '2026-02-01', due_date: '2026-03-01',
  bill_no: 'INV-77', currency: 'IDR', grand_total: 500000, outstanding_amount: 500000, status: 'Unpaid', docstatus: 1,
  is_return: 0, project: null, modified: '2026-02-01 10:00:00' };
const PURCHASE_CURSOR_DOMAINS = ['Purchase Order', 'Purchase Invoice'].map((doctype) => `purchases::v2::${doctype}`);

function harness(docs: Record<string, unknown[]>) {
  const fake = new FakePostgrest({ external_sync_watermarks: [] }, { upsertKeys: { external_sync_watermarks: ['org_id', 'external_tier', 'domain'] } });
  const rpc = vi.fn().mockImplementation(async (_n: string, a: { p_rows: unknown[] }) => ({ data: a.p_rows.length, error: null }));
  const urls: string[] = [];
  const fetchImpl = vi.fn(async (url: string) => {
    const decoded = decodeURIComponent(url);
    urls.push(decoded);
    const doctype = decodeURIComponent(new URL(url).pathname.split('/').pop()!);
    const filters = JSON.parse(new URL(url).searchParams.get('filters') ?? '[]') as Array<[string, string, unknown]>;
    const selected = ((docs[doctype] ?? []) as Array<Record<string, unknown>>).filter((doc) => filters.every(([field, op, value]) => {
      if (field === 'modified' && op === '=') return doc.modified === value;
      if (field === 'modified' && op === '>') return String(doc.modified) > String(value);
      if (field === 'name' && op === '>') return String(doc.name) > String(value);
      return true;
    })).sort((a, b) => String(a.modified).localeCompare(String(b.modified)) || String(a.name).localeCompare(String(b.name)));
    const start = Number(new URL(url).searchParams.get('limit_start') ?? 0);
    const pageLength = Number(new URL(url).searchParams.get('limit_page_length') ?? 500);
    return new Response(JSON.stringify({ data: selected.slice(start, start + pageLength) }), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as unknown as typeof fetch;
  const sc = { from: (t: string) => fake.from(t), rpc } as never;
  const client = { fetchImpl, apiKey: 'k', apiSecret: 's', baseUrl: 'https://erp.example.test', maxRetries: 0 };
  return { fake, rpc, urls, sc, client, fetchImpl: fetchImpl as unknown as ReturnType<typeof vi.fn> };
}

describe('erpnext/purchaseMirrorFeed', () => {
  it('AC-EPR-001 mirrors ERP-native POs and PIs with ERP figures and advances each watermark', async () => {
    const h = harness({ 'Purchase Order': [PO], 'Purchase Invoice': [PI] });
    const result = await feedPurchaseMirror(h.sc, { client: h.client, orgId: 'org-1', company: 'Example Co' });

    expect(result).toEqual({ fed: 2, caughtUp: true });
    expect(h.rpc.mock.calls.flatMap((call) => call[1].p_rows)).toHaveLength(2);
    expect(h.rpc.mock.calls.flatMap((call) => call[1].p_rows)).toEqual([expect.objectContaining({
      erp_doctype: 'Purchase Order', erp_name: 'PUR-ORD-1', supplier_name: 'Acme', doc_date: '2026-01-05', due_date: '2026-01-20',
      grand_total: '900000', outstanding_amount: null, bill_no: null, erp_status: 'To Bill', erp_project: 'ERP-A', erp_docstatus: 1 }),
    expect.objectContaining({
      erp_doctype: 'Purchase Invoice', erp_name: 'ACC-PINV-1', doc_date: '2026-02-01', due_date: '2026-03-01', bill_no: 'INV-77',
      grand_total: '500000', outstanding_amount: '500000', erp_status: 'Unpaid', erp_project: null, is_return: false })]);
    const wm = Object.fromEntries(h.fake.rowsOf('external_sync_watermarks').map((r) => [r.domain, r.watermark_cursor]));
    expect(wm).toEqual({
      'purchases::v2::Purchase Order': JSON.stringify({ version: 2, modified: PO.modified }),
      'purchases::v2::Purchase Invoice': JSON.stringify({ version: 2, modified: PI.modified }),
    });
    // Company-scoped, drafts never listed.
    expect(h.urls.every((u) => u.includes('["company","=","Example Co"]') && u.includes('["docstatus","in",[1,2]]'))).toBe(true);
  });

  it('AC-EPR-001 resumes from the stored watermark without issuing a no-op RPC', async () => {
    const h = harness({});
    h.fake.rowsOf('external_sync_watermarks').push({ org_id: 'org-1', external_tier: 'erpnext', domain: purchaseWmDomain('Purchase Invoice'), watermark_cursor: '2026-02-01 10:00:00' });
    await feedPurchaseMirror(h.sc, { client: h.client, orgId: 'org-1', company: 'Example Co' });
    expect(h.urls.find((u) => u.includes('Purchase Invoice'))).toContain('["modified","=","2026-02-01 10:00:00"]');
    expect(h.rpc).not.toHaveBeenCalled();
    expect(h.fake.rowsOf('external_sync_watermarks')).toContainEqual(expect.objectContaining({
      domain: 'purchases::v2::Purchase Invoice',
      watermark_cursor: JSON.stringify({ version: 2, modified: '2026-02-01 10:00:00' }),
    }));
  });

  it('does nothing on an idle tick with canonical cursors', async () => {
    const h = harness({ 'Purchase Order': [PO], 'Purchase Invoice': [PI] });
    for (const [domain, modified] of [[PURCHASE_CURSOR_DOMAINS[0], PO.modified], [PURCHASE_CURSOR_DOMAINS[1], PI.modified]]) {
      h.fake.rowsOf('external_sync_watermarks').push({ org_id: 'org-1', external_tier: 'erpnext', domain,
        watermark_cursor: JSON.stringify({ version: 2, modified }) });
    }
    let cursorWrites = 0;
    const from = (table: string) => {
      const builder = h.fake.from(table) as Record<string, (...args: unknown[]) => unknown>;
      return new Proxy(builder, { get(target, key, receiver) {
        if (key === 'upsert' || key === 'update') return (...args: unknown[]) => {
          cursorWrites += 1;
          return Reflect.get(target, key, receiver).apply(target, args);
        };
        return Reflect.get(target, key, receiver);
      } });
    };
    const sc = { from, rpc: h.rpc } as never;

    await feedPurchaseMirror(sc, { client: h.client, orgId: 'org-1', company: 'Example Co' });

    expect(h.rpc).not.toHaveBeenCalled();
    expect(cursorWrites).toBe(0);
  });

  it('fails closed on a malformed ERP response without moving the watermark', async () => {
    const h = harness({ 'Purchase Order': [{ name: 'X' }] });
    await expect(feedPurchaseMirror(h.sc, { client: h.client, orgId: 'org-1', company: 'Example Co' })).rejects.toThrow(/malformed/);
    expect(h.rpc).not.toHaveBeenCalled();
    expect(h.fake.rowsOf('external_sync_watermarks')).toHaveLength(0);
  });

  it('fails closed when the RPC errors, leaving the watermark behind', async () => {
    const h = harness({ 'Purchase Order': [PO] });
    h.rpc.mockResolvedValueOnce({ data: null, error: { message: 'boom' } });
    await expect(feedPurchaseMirror(h.sc, { client: h.client, orgId: 'org-1', company: 'Example Co' })).rejects.toThrow('boom');
    expect(h.fake.rowsOf('external_sync_watermarks')).toHaveLength(0);
  });

  it('keeps the newest copy of a document delivered twice, nulls unparseable fields, and takes the max modified as the cursor', async () => {
    const h = harness({ 'Purchase Invoice': [
      { ...PI, modified: '2026-02-03 00:00:00', status: 'Paid', outstanding_amount: 0 },
      { ...PI, modified: '2026-02-01 10:00:00' },
      { ...PI, name: 'ACC-PINV-2', grand_total: 'n/a', due_date: '03/01/2026', modified: '2026-02-02 00:00:00' },
    ] });
    await feedPurchaseMirror(h.sc, { client: h.client, orgId: 'org-1', company: 'Example Co' });
    const rows = h.rpc.mock.calls.flatMap((call) => call[1].p_rows) as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.erp_name === 'ACC-PINV-1')).toMatchObject({ erp_status: 'Paid', outstanding_amount: '0' });
    expect(rows.find((r) => r.erp_name === 'ACC-PINV-2')).toMatchObject({ grand_total: null, due_date: null });
    const wm = h.fake.rowsOf('external_sync_watermarks').find((r) => r.domain === 'purchases::v2::Purchase Invoice');
    expect(wm?.watermark_cursor).toBe(JSON.stringify({ version: 2, modified: '2026-02-03 00:00:00' }));
  });

  it('keeps valid documents flowing when ERP returns unsupported status or overflowing money values', async () => {
    const h = harness({ 'Purchase Invoice': [
      { ...PI, name: 'ACC-PINV-CANCELLED', docstatus: 2 },
      { ...PI, name: 'ACC-PINV-BAD-STATUS', docstatus: 3 },
      { ...PI, name: 'ACC-PINV-OVERFLOW', grand_total: '10000000000000000.00', due_date: '2026-02-30' },
      { ...PI, name: 'ACC-PINV-THREE-DECIMALS', grand_total: '12.345', outstanding_amount: '10.000000001' },
      { ...PI, name: 'ACC-PINV-16-DIGITS', grand_total: '1000000000000000' },
      { ...PI, name: 'ACC-PINV-VALID' },
    ] });

    await feedPurchaseMirror(h.sc, { client: h.client, orgId: 'org-1', company: 'Example Co' });

    const mirrored = h.rpc.mock.calls.flatMap((call) => call[1].p_rows);
    expect(mirrored).toHaveLength(5);
    expect(mirrored).toContainEqual(expect.objectContaining({ erp_name: 'ACC-PINV-CANCELLED', erp_docstatus: 2 }));
    expect(mirrored).toContainEqual(expect.objectContaining({ erp_name: 'ACC-PINV-OVERFLOW', grand_total: null, due_date: null }));
    expect(mirrored).toContainEqual(expect.objectContaining({ erp_name: 'ACC-PINV-THREE-DECIMALS', grand_total: '12.345', outstanding_amount: '10.000000001' }));
    expect(mirrored).toContainEqual(expect.objectContaining({ erp_name: 'ACC-PINV-16-DIGITS', grand_total: null }));
    expect(mirrored).toContainEqual(expect.objectContaining({ erp_name: 'ACC-PINV-VALID' }));
    expect(h.fake.rowsOf('external_sync_watermarks')).toContainEqual(expect.objectContaining({
      domain: 'purchases::v2::Purchase Invoice', watermark_cursor: JSON.stringify({ version: 2, modified: PI.modified }),
    }));
  });

  it('streams bounded pages and resumes equal-timestamp names across ticks before replaying the boundary', async () => {
    const names = Array.from({ length: 12503 }, (_, i) => `PO-${String(i).padStart(5, '0')}`);
    let reads = 0;
    const events: string[] = [];
    const fake = new FakePostgrest({ external_sync_watermarks: [] }, { upsertKeys: { external_sync_watermarks: ['org_id', 'external_tier', 'domain'] } });
    const rpc = vi.fn(async (_n: string, args: { p_rows: unknown[] }) => { events.push('write'); return { data: args.p_rows.length, error: null }; });
    const fetchImpl = vi.fn(async (url: string) => {
      reads += 1;
      events.push('read');
      const decoded = decodeURIComponent(url);
      const equalPhase = decoded.includes('["modified","=","2026-04-01 00:00:00"]');
      const afterName = decoded.match(/\["name",">","([^"]+)"\]/)?.[1];
      const laterPhase = decoded.includes('["modified",">","2026-04-01 00:00:00"]');
      const doctype = decodeURIComponent(new URL(url).pathname.split('/').pop()!);
      const selected = doctype !== 'Purchase Order' ? [] : equalPhase ? names.filter((name) => !afterName || name > afterName)
        : laterPhase ? [] : names;
      const start = Number(new URL(url).searchParams.get('limit_start') ?? '0');
      const rows = selected.slice(start, start + 500).map((name) => ({ ...PO, name, modified: '2026-04-01 00:00:00' }));
      return new Response(JSON.stringify({ data: rows }), { status: 200 });
    }) as unknown as typeof fetch;
    const sc = { from: (t: string) => fake.from(t), rpc } as never;
    const client = { fetchImpl, apiKey: 'k', apiSecret: 's', baseUrl: 'https://erp.example.test', maxRetries: 0 };

    const first = await feedPurchaseMirror(sc, { client, orgId: 'org-1', company: 'Example Co' });
    expect(first.caughtUp).toBe(false);
    expect(rpc.mock.calls.flatMap((call) => call[1].p_rows)).toHaveLength(5500);
    const firstCount = rpc.mock.calls.flatMap((call) => call[1].p_rows).length;
    const second = await feedPurchaseMirror(sc, { client, orgId: 'org-1', company: 'Example Co' });
    expect(second.caughtUp).toBe(false);
    const secondCount = rpc.mock.calls.flatMap((call) => call[1].p_rows).length;
    expect(secondCount - firstCount).toBe(5500);
    const third = await feedPurchaseMirror(sc, { client, orgId: 'org-1', company: 'Example Co' });
    expect(third.caughtUp).toBe(true);
    expect(rpc.mock.calls.flatMap((call) => call[1].p_rows)).toHaveLength(12503);
    expect(12503 - secondCount).toBe(1503);
    expect(reads).toBeGreaterThan(2);
    expect(events.slice(0, 3)).toEqual(['read', 'write', 'read']);
    const callUrls = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls.map((call: unknown[]) => decodeURIComponent(String(call[0])));
    expect(callUrls.some((url: string) => url.includes('/Purchase Order?') && url.includes('["modified","=","2026-04-01 00:00:00"]'))).toBe(true);
  });

  it('does not overwrite a cursor advanced by a concurrent sweep', async () => {
    const initial = JSON.stringify({ version: 2, modified: PI.modified });
    const winner = JSON.stringify({ version: 2, modified: '2026-03-01 00:00:00' });
    const fake = new FakePostgrest({ external_sync_watermarks: [{ org_id: 'org-1', external_tier: 'erpnext',
      domain: 'purchases::v2::Purchase Invoice', watermark_cursor: initial }] },
    { upsertKeys: { external_sync_watermarks: ['org_id', 'external_tier', 'domain'] } });
    const rpc = vi.fn(async (_n: string, args: { p_rows: unknown[] }) => ({ data: args.p_rows.length, error: null }));
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ data: [{ ...PI, name: 'ACC-PINV-2' }] }), { status: 200 }));
    const from = (table: string) => {
      const builder = fake.from(table) as Record<string, (...args: unknown[]) => unknown>;
      return { ...builder, update: (...args: unknown[]) => {
        fake.rowsOf('external_sync_watermarks')[0].watermark_cursor = winner;
        return builder.update(...args);
      } };
    };
    const sc = { from, rpc } as never;
    const client = { fetchImpl, apiKey: 'k', apiSecret: 's', baseUrl: 'https://erp.example.test', maxRetries: 0 };

    await expect(feedPurchaseMirror(sc, { client, orgId: 'org-1', company: 'Example Co' })).rejects.toThrow(/concurrently/);
    expect(fake.rowsOf('external_sync_watermarks')[0].watermark_cursor).toBe(winner);
  });

  it('persists a complete page before a later fetch fails', async () => {
    const rows = Array.from({ length: 500 }, (_, i) => ({ ...PO, name: `PO-${String(i).padStart(3, '0')}`, modified: '2026-04-02 00:00:00' }));
    const fake = new FakePostgrest({ external_sync_watermarks: [] }, { upsertKeys: { external_sync_watermarks: ['org_id', 'external_tier', 'domain'] } });
    const rpc = vi.fn(async (_n: string, args: { p_rows: unknown[] }) => ({ data: args.p_rows.length, error: null }));
    const fetchImpl = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ data: rows }), { status: 200 }))
      .mockRejectedValueOnce(new Error('later read failed'));
    const sc = { from: (t: string) => fake.from(t), rpc } as never;
    const client = { fetchImpl, apiKey: 'k', apiSecret: 's', baseUrl: 'https://erp.example.test', maxRetries: 0 };

    await expect(feedPurchaseMirror(sc, { client, orgId: 'org-1', company: 'Example Co' })).rejects.toThrow('later read failed');

    const saved = fake.rowsOf('external_sync_watermarks').find((row) => row.domain === 'purchases::v2::Purchase Order');
    expect(JSON.parse(String(saved?.watermark_cursor))).toEqual({ version: 2, modified: rows[499].modified, name: rows[499].name });
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('replays a legacy timestamp boundary once, then keeps the canonical cursor idle', async () => {
    const h = harness({ 'Purchase Invoice': [{ ...PI, modified: '2026-02-01 10:00:00', status: 'Corrected' }] });
    h.fake.rowsOf('external_sync_watermarks').push({ org_id: 'org-1', external_tier: 'erpnext', domain: purchaseWmDomain('Purchase Invoice'), watermark_cursor: PI.modified });
    await feedPurchaseMirror(h.sc, { client: h.client, orgId: 'org-1', company: 'Example Co' });
    await feedPurchaseMirror(h.sc, { client: h.client, orgId: 'org-1', company: 'Example Co' });
    expect(h.rpc.mock.calls.flatMap((call) => call[1].p_rows)).toHaveLength(1);
    expect(h.rpc.mock.calls[0][1].p_rows).toContainEqual(expect.objectContaining({ erp_name: PI.name, erp_status: 'Corrected' }));
    expect(h.fake.rowsOf('external_sync_watermarks')).toContainEqual(expect.objectContaining({
      domain: expect.stringContaining('v2'), watermark_cursor: expect.stringContaining('2026-02-01 10:00:00'),
    }));
  });

  it('does not repeat a remote read after a page write fails and uses a bounded no-retry transport', async () => {
    const h = harness({ 'Purchase Order': [PO] });
    h.client.maxRetries = 3;
    h.fetchImpl.mockRejectedValueOnce(new Error('temporary transport failure'));
    await expect(feedPurchaseMirror(h.sc, { client: h.client, orgId: 'org-1', company: 'Example Co' })).rejects.toThrow('temporary transport failure');
    expect(h.fetchImpl).toHaveBeenCalledTimes(1);
    expect(h.urls).toHaveLength(0);
    const failedWrite = harness({ 'Purchase Order': [PO] });
    failedWrite.client.maxRetries = 3;
    failedWrite.rpc.mockResolvedValueOnce({ data: null, error: { message: 'write failed' } });
    await expect(feedPurchaseMirror(failedWrite.sc, { client: failedWrite.client, orgId: 'org-1', company: 'Example Co' })).rejects.toThrow('write failed');
    expect(failedWrite.fetchImpl).toHaveBeenCalledTimes(1);
    expect(failedWrite.urls).toHaveLength(1);
    expect(failedWrite.fake.rowsOf('external_sync_watermarks')).toHaveLength(0);
  });

  it('makes progress on invoices while orders still have a full backlog', async () => {
    const orders = Array.from({ length: 12503 }, (_, i) => ({ ...PO, name: `PO-${String(i).padStart(5, '0')}` }));
    const h = harness({ 'Purchase Order': orders, 'Purchase Invoice': [PI] });
    const result = await feedPurchaseMirror(h.sc, { client: h.client, orgId: 'org-1', company: 'Example Co' });
    expect(result.caughtUp).toBe(false);
    expect(h.urls.slice(0, 2).map((url) => decodeURIComponent(new URL(url).pathname.split('/').pop()!))).toEqual(['Purchase Order', 'Purchase Invoice']);
    expect(h.rpc.mock.calls.flatMap((call) => call[1].p_rows)).toContainEqual(expect.objectContaining({ erp_doctype: 'Purchase Invoice', erp_name: PI.name }));
    expect(h.rpc.mock.calls.every((call) => call[1].p_rows.length <= 500)).toBe(true);
  });

  it('bounds a stalled request to the remaining pass time after persisting the previous page', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const h = harness({});
      const rows = Array.from({ length: 500 }, (_, i) => ({ ...PO, name: `PO-${String(i).padStart(3, '0')}` }));
      let reads = 0;
      let pendingSignal: AbortSignal | undefined;
      const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
        reads += 1;
        if (reads === 1) {
          vi.setSystemTime(24500);
          return new Response(JSON.stringify({ data: rows }), { status: 200 });
        }
        pendingSignal = init?.signal ?? undefined;
        return new Promise<Response>((_resolve, reject) => pendingSignal?.addEventListener('abort', () => reject(pendingSignal?.reason), { once: true }));
      });
      const promise = feedPurchaseMirror(h.sc, { client: { ...h.client, maxRetries: 3, fetchImpl: fetchImpl as unknown as typeof fetch }, orgId: 'org-1', company: 'Example Co' });
      const rejected = expect(promise).rejects.toThrow('500ms deadline');
      await vi.advanceTimersByTimeAsync(0);
      expect(fetchImpl).toHaveBeenCalledTimes(2);
      await vi.advanceTimersByTimeAsync(499);
      expect(pendingSignal?.aborted).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      await rejected;
      expect(fetchImpl).toHaveBeenCalledTimes(2);
      expect(h.rpc).toHaveBeenCalledTimes(1);
      expect(JSON.parse(String(h.fake.rowsOf('external_sync_watermarks')[0].watermark_cursor))).toMatchObject({ name: rows[499].name });
    } finally {
      consoleError.mockRestore();
      vi.useRealTimers();
    }
  });

  it.each(['read', 'rpc', 'checkpoint'] as const)('bounds a stalled database %s operation to the pass budget', async (phase) => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    try {
      const h = harness({ 'Purchase Order': [PO] });
      const pending = () => new Promise<never>(() => {});
      if (phase === 'rpc') h.rpc.mockImplementationOnce(pending);
      const read = { select: () => read, eq: () => read, maybeSingle: pending };
      const sc = {
        rpc: h.rpc,
        from: (table: string) => phase === 'read' ? read : phase === 'checkpoint' ? { ...(h.fake.from(table) as Record<string, unknown>), upsert: pending } : h.fake.from(table),
      };
      let settled = false;
      const result = feedPurchaseMirror(sc as never, { client: h.client, orgId: 'org-1', company: 'Example Co' }).then(
        () => { settled = true; return null; },
        (error: unknown) => { settled = true; return error; },
      );
      await vi.advanceTimersByTimeAsync(25000);
      expect(settled).toBe(true);
      expect(await result).toMatchObject({ code: 'external-unreachable', message: 'Purchase mirror pass deadline exceeded' });
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not begin a page write after its budget has elapsed', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    try {
      const h = harness({});
      h.client.fetchImpl = vi.fn(async () => {
        vi.setSystemTime(25000);
        return new Response(JSON.stringify({ data: [PO] }), { status: 200 });
      }) as unknown as typeof fetch;
      await expect(feedPurchaseMirror(h.sc, { client: h.client, orgId: 'org-1', company: 'Example Co' })).rejects.toThrow('Purchase mirror pass deadline exceeded');
      expect(h.rpc).not.toHaveBeenCalled();
      expect(h.fake.rowsOf('external_sync_watermarks')).toHaveLength(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('leaves the cursor replayable if a timed-out page write completes later', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    try {
      const h = harness({ 'Purchase Order': [PO] });
      let acknowledge!: (value: { data: number; error: null }) => void;
      h.rpc.mockImplementationOnce(() => new Promise((resolve) => { acknowledge = resolve; }));
      const result = expect(feedPurchaseMirror(h.sc, { client: h.client, orgId: 'org-1', company: 'Example Co' })).rejects.toThrow('Purchase mirror pass deadline exceeded');
      await vi.advanceTimersByTimeAsync(25000);
      await result;
      acknowledge({ data: 1, error: null });
      await vi.advanceTimersByTimeAsync(0);
      expect(h.fake.rowsOf('external_sync_watermarks')).toHaveLength(0);
      await feedPurchaseMirror(h.sc, { client: h.client, orgId: 'org-1', company: 'Example Co' });
      expect(h.rpc.mock.calls.flatMap((call) => call[1].p_rows)).toHaveLength(2);
      expect(h.fake.rowsOf('external_sync_watermarks')).toContainEqual(expect.objectContaining({ watermark_cursor: JSON.stringify({ version: 2, modified: PO.modified }) }));
    } finally {
      vi.useRealTimers();
    }
  });

  it('observes a late database rejection after its deadline has already answered', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    try {
      const h = harness({ 'Purchase Order': [PO] });
      let rejectLater!: (reason: Error) => void;
      h.rpc.mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectLater = reject; }));
      const result = expect(feedPurchaseMirror(h.sc, { client: h.client, orgId: 'org-1', company: 'Example Co' })).rejects.toThrow('Purchase mirror pass deadline exceeded');
      await vi.advanceTimersByTimeAsync(25000);
      await result;
      rejectLater(new Error('late database failure'));
      await vi.advanceTimersByTimeAsync(0);
      expect(h.fake.rowsOf('external_sync_watermarks')).toHaveLength(0);
      expect(h.rpc).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('refuses to run without a company', async () => {
    const h = harness({});
    await expect(feedPurchaseMirror(h.sc, { client: h.client, orgId: 'org-1', company: ' ' })).rejects.toThrow(/company/);
  });
});

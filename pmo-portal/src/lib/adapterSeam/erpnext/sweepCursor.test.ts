/**
 * AC-ENA-071 [Vitest unit] — erpnext/sweepCursor.ts: the modified-poll list+dedupe mechanics the
 * convergence-authority sweep runs per (org × doctype). Proves (FR-ENA-080/081/083, NFR-ENA-FEED-001):
 *   • inclusive `>=` boundary: two changes sharing the watermark `modified` are BOTH listed (none
 *     skipped at the seam — FR-ENA-081);
 *   • dedupe by ERP `name`: the same name surfacing on two pages is emitted exactly once (the P1
 *     inclusive-cursor + idempotent-apply pattern, FR-CUA-007/046);
 *   • `nextCursor` = max `modified` observed, monotonic (never rewinds — FR-ENA-081);
 *   • paging advances `limit_start` until a short page ends the fetch;
 *   • a `null` cursor (fresh org / full backfill) lists everything (no `modified` filter);
 *   • each emitted `SweepChange` carries the ERP-derived routing fields (`erp_docstatus`,
 *     `erp_amended_from`) on its canonical record so the lineage-aware apply (8.5) can route
 *     cancel/amend — and a strictly-older row still flows as a `SweepChange` whose `sourceModMs` the
 *     per-row `erp_modified >=` guard (applyEngine.applyInboundChange) drops downstream (FR-ENA-053).
 *
 * Pure + mocked-fetch (NFR-ENA-CONTRACT-001) — no live bench. Frappe vocabulary confined to erpnext/**.
 */
import { describe, it, expect, vi } from 'vitest';
import { listErpChangesSinceWatermark } from './sweepCursor.ts';
import { applyInboundChange } from '../applyEngine.ts';
import type { ErpClientDeps } from './client.ts';

/** Builds a fake ErpClientDeps whose fetchImpl answers a scripted list of pages per request. Each
 *  scripted page is the `data` array of a Frappe list response; the last (short) page ends the loop. */
function clientWithPages(pages: Array<Array<Record<string, unknown>>>): ErpClientDeps {
  let call = 0;
  const seen: Record<string, string | null>[] = [];
  const fetchImpl = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => {
    const page = pages[Math.min(call, pages.length - 1)];
    call += 1;
    seen.push({}); // (unused — keep the fn shape simple)
    return new Response(JSON.stringify({ data: page }), { status: 200 });
  });
  return { fetchImpl: fetchImpl as unknown as typeof fetch, apiKey: 'k', apiSecret: 's', baseUrl: 'http://erp.test' };
}

const FROM_DOC = (doc: unknown) => {
  const d = doc as Record<string, unknown>;
  return { id: String(d.name), name: String(d.name), erp_docstatus: d.docstatus ?? null, erp_amended_from: d.amended_from ?? null };
};

describe('erpnext/sweepCursor — listErpChangesSinceWatermark (AC-ENA-071)', () => {
  it('inclusive >= boundary: two changes sharing the watermark modified are BOTH listed (none skipped)', async () => {
    const boundary = '2026-07-12 12:00:00.000000';
    const client = clientWithPages([
      [
        { name: 'MAT-REQ-0001', modified: boundary, docstatus: 1, amended_from: null },
        { name: 'MAT-REQ-0002', modified: boundary, docstatus: 1, amended_from: null },
      ],
    ]);
    const { changes, nextCursor } = await listErpChangesSinceWatermark(
      { client, doctype: 'Material Request', fields: ['name', 'modified', 'docstatus', 'amended_from'], fromDoc: FROM_DOC },
      boundary,
    );
    expect(changes.map((c) => c.record.id).sort()).toEqual(['MAT-REQ-0001', 'MAT-REQ-0002']);
    expect(nextCursor).toBe(boundary);
  });

  it('dedupes by ERP name across pages: the same name on two pages is emitted exactly once', async () => {
    // Page 1 is full (pageSize 2) → the loop fetches page 2, which repeats MAT-REQ-0001 at the boundary.
    const client = clientWithPages([
      [
        { name: 'MAT-REQ-0001', modified: '2026-07-12 12:00:00.000000', docstatus: 1, amended_from: null },
        { name: 'MAT-REQ-0002', modified: '2026-07-12 12:00:01.000000', docstatus: 1, amended_from: null },
      ],
      [
        { name: 'MAT-REQ-0001', modified: '2026-07-12 12:00:00.000000', docstatus: 1, amended_from: null },
        { name: 'MAT-REQ-0003', modified: '2026-07-12 12:00:02.000000', docstatus: 1, amended_from: null },
      ],
    ]);
    const { changes, nextCursor } = await listErpChangesSinceWatermark(
      { client, doctype: 'Material Request', fields: ['name', 'modified', 'docstatus', 'amended_from'], fromDoc: FROM_DOC, pageSize: 2 },
      '2026-07-12 12:00:00.000000',
    );
    const ids = changes.map((c) => c.record.id);
    expect(ids).toEqual(['MAT-REQ-0001', 'MAT-REQ-0002', 'MAT-REQ-0003']); // MAT-REQ-0001 appears once
    expect(nextCursor).toBe('2026-07-12 12:00:02.000000'); // max modified
  });

  it('nextCursor is the max modified observed (monotonic, never rewinds)', async () => {
    const client = clientWithPages([
      [
        { name: 'A', modified: '2026-07-12 12:00:05.000000', docstatus: 1, amended_from: null },
        { name: 'B', modified: '2026-07-12 12:00:10.000000', docstatus: 1, amended_from: null },
        { name: 'C', modified: '2026-07-12 12:00:03.000000', docstatus: 1, amended_from: null },
      ],
    ]);
    const { nextCursor } = await listErpChangesSinceWatermark(
      { client, doctype: 'Material Request', fields: ['name', 'modified', 'docstatus', 'amended_from'], fromDoc: FROM_DOC },
      '2026-07-12 12:00:00.000000',
    );
    expect(nextCursor).toBe('2026-07-12 12:00:10.000000');
  });

  it('pages until a short page ends the fetch (limit_start advances by pageSize)', async () => {
    let calls = 0;
    const fetchImpl = vi.fn(async (_url: string | URL | Request) => {
      calls += 1;
      // page 1 full (2 rows), page 2 short (1 row) → stop.
      const data = calls === 1
        ? [
          { name: 'A', modified: '2026-07-12 12:00:01.000000', docstatus: 1, amended_from: null },
          { name: 'B', modified: '2026-07-12 12:00:02.000000', docstatus: 1, amended_from: null },
        ]
        : [{ name: 'C', modified: '2026-07-12 12:00:03.000000', docstatus: 1, amended_from: null }];
      return new Response(JSON.stringify({ data }), { status: 200 });
    });
    const client = { fetchImpl: fetchImpl as unknown as typeof fetch, apiKey: 'k', apiSecret: 's', baseUrl: 'http://erp.test' };
    const { changes } = await listErpChangesSinceWatermark(
      { client, doctype: 'Material Request', fields: ['name', 'modified', 'docstatus', 'amended_from'], fromDoc: FROM_DOC, pageSize: 2 },
      '2026-07-12 12:00:00.000000',
    );
    expect(calls).toBe(2);
    expect(changes.map((c) => c.record.id)).toEqual(['A', 'B', 'C']);
  });

  it('a null cursor (fresh org) lists everything — no modified FILTER (fields still requested)', async () => {
    const seenUrls: string[] = [];
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      seenUrls.push(String(url));
      return new Response(
        JSON.stringify({ data: [{ name: 'X', modified: '2026-07-12 12:00:00.000000', docstatus: 1, amended_from: null }] }),
        { status: 200 },
      );
    });
    const client = { fetchImpl: fetchImpl as unknown as typeof fetch, apiKey: 'k', apiSecret: 's', baseUrl: 'http://erp.test' };
    const { changes, nextCursor } = await listErpChangesSinceWatermark(
      { client, doctype: 'Material Request', fields: ['name', 'modified', 'docstatus', 'amended_from'], fromDoc: FROM_DOC },
      null,
    );
    expect(changes).toHaveLength(1);
    expect(nextCursor).toBe('2026-07-12 12:00:00.000000');
    // No modified FILTER on a fresh backfill: the filters query param (decoded) has no `modified` clause.
    // 'modified' still appears in the FIELDS list — that is correct (the apply path needs the value).
    const filtersParam = new URL(seenUrls[0]).searchParams.get('filters') ?? '[]';
    const filters = JSON.parse(filtersParam) as unknown[];
    expect(filters.some((f) => Array.isArray(f) && f[0] === 'modified')).toBe(false);
  });

  it('emits each SweepChange carrying erp_docstatus + erp_amended_from for the lineage apply + a parseable sourceModMs', async () => {
    const client = clientWithPages([
      [
        { name: 'ACC-PINV-2026-00002', modified: '2026-07-12 12:00:00.000000', docstatus: 2, amended_from: null },
        { name: 'ACC-PINV-2026-00003', modified: '2026-07-12 12:05:00.000000', docstatus: 0, amended_from: 'ACC-PINV-2026-00002' },
      ],
    ]);
    const { changes } = await listErpChangesSinceWatermark(
      { client, doctype: 'Purchase Invoice', fields: ['name', 'modified', 'docstatus', 'amended_from'], fromDoc: FROM_DOC },
      '2026-07-12 12:00:00.000000',
    );
    expect(changes[0].record).toMatchObject({ id: 'ACC-PINV-2026-00002', erp_docstatus: 2, erp_amended_from: null });
    expect(changes[1].record).toMatchObject({ id: 'ACC-PINV-2026-00003', erp_amended_from: 'ACC-PINV-2026-00002' });
    expect(changes[0].sourceModMs).toBe(Date.parse('2026-07-12 12:00:00.000000'));
  });

  it('Luna BLOCK A1: extraFilters conjoin with the modified >= cursor filter (Payment Entry payment_type discriminator)', async () => {
    const seenUrls: string[] = [];
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      seenUrls.push(String(url));
      return new Response(
        JSON.stringify({ data: [{ name: 'ACC-PAY-2026-00001', modified: '2026-07-12 12:00:00.000000', docstatus: 1, amended_from: null, payment_type: 'Receive' }] }),
        { status: 200 },
      );
    });
    const client = { fetchImpl: fetchImpl as unknown as typeof fetch, apiKey: 'k', apiSecret: 's', baseUrl: 'http://erp.test' };
    await listErpChangesSinceWatermark(
      {
        client,
        doctype: 'Payment Entry',
        fields: ['name', 'modified', 'docstatus', 'amended_from', 'payment_type'],
        fromDoc: FROM_DOC,
        extraFilters: [['payment_type', '=', 'Receive']],
      },
      '2026-07-12 12:00:00.000000',
    );
    const filtersParam = new URL(seenUrls[0]).searchParams.get('filters') ?? '[]';
    const filters = JSON.parse(filtersParam) as unknown[];
    expect(filters).toContainEqual(['payment_type', '=', 'Receive']);
    expect(filters).toContainEqual(['modified', '>=', '2026-07-12 12:00:00.000000']);
  });

  it('Luna BLOCK A1: filterRow SKIPS a fetched doc whose payment_type does not match the kind discriminator (a Pay doc must never be emitted for an incoming-payment poll)', async () => {
    const client = clientWithPages([
      [
        { name: 'ACC-PAY-2026-00002', modified: '2026-07-12 12:00:00.000000', docstatus: 1, amended_from: null, payment_type: 'Pay' },
        { name: 'ACC-PAY-2026-00003', modified: '2026-07-12 12:00:01.000000', docstatus: 1, amended_from: null, payment_type: 'Receive' },
      ],
    ]);
    const { changes } = await listErpChangesSinceWatermark(
      {
        client,
        doctype: 'Payment Entry',
        fields: ['name', 'modified', 'docstatus', 'amended_from', 'payment_type'],
        fromDoc: FROM_DOC,
        extraFilters: [['payment_type', '=', 'Receive']],
        filterRow: (row) => row.payment_type === 'Receive',
      },
      '2026-07-12 12:00:00.000000',
    );
    // The Pay doc (ACC-PAY-2026-00002) MUST be skipped — never adopted into the incoming-payment feed —
    // even though it was fetched (defense-in-depth beyond the server-side extraFilters).
    expect(changes.map((c) => c.record.id)).toEqual(['ACC-PAY-2026-00003']);
  });

  it('a strictly-older row still flows as a SweepChange whose sourceModMs the per-row apply guard drops (FR-ENA-053)', async () => {
    // sweepCursor LISTS the older row (it does not apply the per-row guard — that is applyEngine's
    // job). The proof here is that the older row's sourceModMs is the EXACT value applyInboundChange
    // compares against a fresher stored mirror source-mod → the downstream no-op.
    const client = clientWithPages([
      [{ name: 'OLD-001', modified: '2026-07-12 11:00:00.000000', docstatus: 1, amended_from: null }],
    ]);
    const { changes } = await listErpChangesSinceWatermark(
      { client, doctype: 'Material Request', fields: ['name', 'modified', 'docstatus', 'amended_from'], fromDoc: FROM_DOC },
      '2026-07-12 11:00:00.000000',
    );
    const older = changes[0];
    // The per-row guard (applyEngine.applyInboundChange): a stored fresher source-mod drops this.
    const applyDeps = {
      resolvePmoRecordId: async () => 'pmo-1',
      readMirrorSourceMod: async () => Date.parse('2026-07-12 12:00:00.000000'), // fresher than the row
      updateMirror: async () => {},
      mintMirror: async () => 'x',
      recordExternalRef: async () => {},
    };
    const outcome = await applyInboundChange({ tier: 'erpnext', domain: 'procurement' }, older.record.id, older.record, older.sourceModMs, applyDeps);
    expect(outcome).toEqual({ kind: 'no-op' });
  });
});

// ────────────────────────────────────────────────────────────────────────────────────────────────
// Luna BLOCK 6 — a kind whose canonical depends on a CHILD TABLE cannot be mapped from the list
// endpoint alone (Frappe list responses omit child tables). A Receive Payment Entry's `references`
// rows carry the Sales Invoice it pays — the money link behind `incoming_payments.sales_invoice_id` —
// so the poll must re-read those docs in full before mapping them.
// ────────────────────────────────────────────────────────────────────────────────────────────────
describe('erpnext/sweepCursor — full-doc hydration for child-table-dependent kinds (Luna BLOCK 6)', () => {
  const PE_FROM_DOC = (doc: unknown) => {
    const d = doc as Record<string, unknown>;
    return { id: String(d.name), amount: (d.paid_amount as string) ?? null, references: (d.references as unknown[]) ?? [] };
  };

  it('maps each change from the HYDRATED doc, so the child-table references survive into the canonical', async () => {
    const client = clientWithPages([
      [{ name: 'ACC-PAY-0001', modified: '2026-07-18 10:00:00.000000', docstatus: 1, amended_from: null, paid_amount: '5000.00' }],
      [],
    ]);
    const hydrateDoc = vi.fn(async (name: string) => ({
      name,
      docstatus: 1,
      paid_amount: '5000.00',
      references: [{ reference_doctype: 'Sales Invoice', reference_name: 'ACC-SINV-0007', allocated_amount: '5000.00' }],
    }));

    const { changes } = await listErpChangesSinceWatermark(
      { client, doctype: 'Payment Entry', fields: ['name', 'modified', 'docstatus', 'paid_amount'], fromDoc: PE_FROM_DOC, hydrateDoc },
      null,
    );

    expect(hydrateDoc).toHaveBeenCalledWith('ACC-PAY-0001');
    expect(changes).toHaveLength(1);
    expect(changes[0].record.references).toEqual([
      { reference_doctype: 'Sales Invoice', reference_name: 'ACC-SINV-0007', allocated_amount: '5000.00' },
    ]);
    // The routing fields + the cursor still come from the LIST row (the poll's own contract).
    expect(changes[0].record.erp_docstatus).toBe(1);
    expect(changes[0].sourceModMs).toBe(Date.parse('2026-07-18 10:00:00.000000'));
  });

  it('hydrates only the rows it emits — a row filtered out by the kind discriminator is never re-read', async () => {
    const client = clientWithPages([
      [
        { name: 'ACC-PAY-PAY-1', modified: '2026-07-18 10:00:00.000000', docstatus: 1, payment_type: 'Pay' },
        { name: 'ACC-PAY-RCV-1', modified: '2026-07-18 11:00:00.000000', docstatus: 1, payment_type: 'Receive' },
      ],
      [],
    ]);
    const hydrateDoc = vi.fn(async (name: string) => ({ name, docstatus: 1, references: [] }));

    const { changes } = await listErpChangesSinceWatermark(
      {
        client,
        doctype: 'Payment Entry',
        fields: ['name', 'modified', 'docstatus', 'payment_type'],
        fromDoc: PE_FROM_DOC,
        filterRow: (row) => row.payment_type === 'Receive',
        hydrateDoc,
      },
      null,
    );

    expect(changes).toHaveLength(1);
    expect(hydrateDoc).toHaveBeenCalledTimes(1);
    expect(hydrateDoc).toHaveBeenCalledWith('ACC-PAY-RCV-1');
  });

  it('without hydrateDoc the list row IS the doc (no needless extra ERP round-trip)', async () => {
    const client = clientWithPages([
      [{ name: 'ACC-SINV-0001', modified: '2026-07-18 10:00:00.000000', docstatus: 1, grand_total: '125000.00' }],
      [],
    ]);
    const { changes } = await listErpChangesSinceWatermark(
      { client, doctype: 'Sales Invoice', fields: ['name', 'modified', 'docstatus', 'grand_total'], fromDoc: FROM_DOC },
      null,
    );
    expect(changes).toHaveLength(1);
    expect((client.fetchImpl as unknown as { mock: { calls: unknown[] } }).mock.calls).toHaveLength(1); // the single short list page — no per-doc read
  });
});

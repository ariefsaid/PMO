/**
 * AC-ENA-150/162 (the feed basis) [Vitest unit] — erpnext/ledgerMirrorFeed.ts: the sweep-side feed
 * that populates erp_gl_entry_mirror / erp_payment_ledger_mirror from ERPNext `GL Entry` / `Payment
 * Ledger Entry` truth. Actuals (7.3) + the aging fallback (7.4) read the MIRROR, never live ERP, so
 * this feed is what makes "mirrored ledger rows" real. Proves:
 *   • a fixed fetched GL/PLE set lands as mirror rows (decimal-strings intact, R4);
 *   • a re-feed of an OLDER `modified` is a no-op (the per-row `erp_modified >=` source-mod guard — a
 *     stale re-fed row never overwrites a fresher mirror row, FR-CUA-049 pattern);
 *   • the per-source watermark advances monotonically to max `modified` (never rewinds);
 *   • a cancelled row (`is_cancelled`/`docstatus=2`) never reaches the feed — ledgerFetch filters at
 *     fetch (7.2), so the feed forwards only live rows.
 *
 * Pure + mocked service client + mocked ERP fetch; the service-client seam is structural (matches
 * supabase-js at runtime, cast `as never` at the boundary, the actualsSnapshot.ts idiom).
 */
import { describe, it, expect, vi } from 'vitest';
import { feedLedgerMirrors, LEDGER_GL_WM_DOMAIN, LEDGER_PLE_WM_DOMAIN } from './ledgerMirrorFeed.ts';
import * as ledgerFetch from './ledgerFetch.ts';

/** A minimal in-memory fake of the two mirror tables + the watermarks table, exercising the feed's
 *  read-existing → filter-stale → upsert → advance-watermark logic end-to-end. */
function fakeServiceClient(existingGl: Array<Record<string, unknown>> = [], existingPle: Array<Record<string, unknown>> = []) {
  const gl = new Map(existingGl.map((r) => [String(r.erp_name), { ...r }]));
  const ple = new Map(existingPle.map((r) => [String(r.erp_name), { ...r }]));
  const watermarks = new Map<string, string>();

  const mirrorTable = (store: Map<string, Record<string, unknown>>) => {
    const api = {
      // select(cols).eq('org_id', orgId) → await { data, error } (the impl reads erp_name,erp_modified).
      select: (cols: string) => {
        const colsList = cols.split(',').map((s) => s.trim());
        const filters: Array<{ col: string; val: unknown }> = [];
        const selectChain = {
          eq: (col: string, val: unknown) => { filters.push({ col, val }); return selectChain; },
          then: (resolve: (v: { data: Array<Record<string, unknown>>; error: null }) => void) => {
            const rows = Array.from(store.values())
              .filter((r) => filters.every((f) => r[f.col] === f.val))
              .map((r) => Object.fromEntries(colsList.map((c) => [c, r[c] ?? null])) as Record<string, unknown>);
            resolve({ data: rows, error: null });
          },
        };
        return selectChain;
      },
      upsert: async (rows: Array<Record<string, unknown>>) => {
        for (const row of rows) store.set(String(row.erp_name), { ...row });
        return { error: null };
      },
    };
    return api;
  };

  const watermarksApi = {
    select: () => {
      const f: Record<string, unknown> = {};
      const chain = {
        eq: (c: string, v: unknown) => { f[c] = v; return chain; },
        maybeSingle: async () => {
          const key = `${f.external_tier}::${f.domain}`;
          return { data: watermarks.has(key) ? { watermark_cursor: watermarks.get(key) } : null, error: null };
        },
      };
      return chain;
    },
    upsert: async (row: { external_tier: string; domain: string; watermark_cursor: string }) => {
      watermarks.set(`${row.external_tier}::${row.domain}`, row.watermark_cursor);
      return { error: null };
    },
  };

  return {
    gl,
    ple,
    watermarks,
    from: (name: string) => {
      if (name === 'erp_gl_entry_mirror') return mirrorTable(gl) as never;
      if (name === 'erp_payment_ledger_mirror') return mirrorTable(ple) as never;
      return watermarksApi as never;
    },
  } as unknown as Parameters<typeof feedLedgerMirrors>[0];
}

describe('erpnext/ledgerMirrorFeed — feedLedgerMirrors (AC-ENA-150/162 basis)', () => {
  it('a fixed fetched GL/PLE set lands as mirror rows (decimal-strings intact) + advances both watermarks', async () => {
    const sc = fakeServiceClient();
    const glSpy = vi.spyOn(ledgerFetch, 'fetchGlEntries').mockResolvedValue([
      { name: 'GLE-1', account: 'Creditors - PSC', cost_center: 'Main - PSC', fiscal_year: '2026', project: null,
        party_type: 'Supplier', party: 'Spike Supplier', voucher_type: 'Purchase Invoice', voucher_no: 'ACC-PINV-2026-00018',
        posting_date: '2026-07-12', debit: '50000.00', credit: '0.00', is_cancelled: false, docstatus: 1, modified: '2026-07-12 12:00:00.000000' },
    ]);
    const pleSpy = vi.spyOn(ledgerFetch, 'fetchPaymentLedgerEntries').mockResolvedValue([
      { name: 'PLE-1', account: 'Creditors - PSC', party_type: 'Supplier', party: 'Spike Supplier',
        against_voucher_type: 'Purchase Invoice', against_voucher_no: 'ACC-PINV-2026-00018', amount: '-50000.00',
        posting_date: '2026-07-12', due_date: '2026-08-12', docstatus: 1, modified: '2026-07-12 12:05:00.000000' },
    ]);
    const res = await feedLedgerMirrors(sc, { client: { fetchImpl: fetch, apiKey: 'k', apiSecret: 's', baseUrl: 'http://erp.test' }, orgId: 'org-1', company: 'PMO Smoke Co' });
    expect(res.glFed).toBe(1);
    expect(res.pleFed).toBe(1);
    // Decimal-string money preserved verbatim into numeric(14,2) columns (no PMO recompute, R4).
    expect(Array.from((sc as unknown as { gl: Map<string, Record<string, unknown>> }).gl.values())).toEqual([
      expect.objectContaining({ erp_name: 'GLE-1', account: 'Creditors - PSC', debit: '50000.00', credit: '0.00', erp_modified: '2026-07-12 12:00:00.000000' }),
    ]);
    expect(Array.from((sc as unknown as { ple: Map<string, Record<string, unknown>> }).ple.values())).toEqual([
      expect.objectContaining({ erp_name: 'PLE-1', amount: '-50000.00', erp_modified: '2026-07-12 12:05:00.000000' }),
    ]);
    // Watermarks advanced to max modified per source.
    expect((sc as unknown as { watermarks: Map<string, string> }).watermarks.get(`erpnext::${LEDGER_GL_WM_DOMAIN}`)).toBe('2026-07-12 12:00:00.000000');
    expect((sc as unknown as { watermarks: Map<string, string> }).watermarks.get(`erpnext::${LEDGER_PLE_WM_DOMAIN}`)).toBe('2026-07-12 12:05:00.000000');
    // The fetch is scoped by the (absent ⇒ full-backfill) cursor + the binding's company.
    expect(glSpy).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ company: 'PMO Smoke Co', since: undefined }));
    expect(pleSpy).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ company: 'PMO Smoke Co', since: undefined }));
  });

  it('a re-feed of an OLDER modified is a no-op (the per-row erp_modified >= guard never overwrites a fresher row)', async () => {
    const sc = fakeServiceClient(
      [{ org_id: 'org-1', erp_name: 'GLE-1', account: 'Creditors - PSC', erp_modified: '2026-07-12 12:00:00.000000' }],
      [],
    );
    vi.spyOn(ledgerFetch, 'fetchGlEntries').mockResolvedValue([
      { name: 'GLE-1', account: 'STALE-ACCOUNT', cost_center: null, fiscal_year: null, project: null, party_type: null,
        party: null, voucher_type: null, voucher_no: null, posting_date: null, debit: '1.00', credit: '0.00',
        is_cancelled: false, docstatus: 1, modified: '2026-07-12 11:00:00.000000' }, // older
    ]);
    vi.spyOn(ledgerFetch, 'fetchPaymentLedgerEntries').mockResolvedValue([]);
    const res = await feedLedgerMirrors(sc, { client: { fetchImpl: fetch, apiKey: 'k', apiSecret: 's', baseUrl: 'http://erp.test' }, orgId: 'org-1', company: 'PMO Smoke Co' });
    expect(res.glFed).toBe(0); // the stale row was dropped by the guard
    // The fresher mirror row is intact (account NOT overwritten with STALE-ACCOUNT).
    const glRow = Array.from((sc as unknown as { gl: Map<string, Record<string, unknown>> }).gl.values())[0];
    expect(glRow.account).toBe('Creditors - PSC');
  });

  it('the per-source watermark never rewinds (a stale re-feed does not lower the cursor)', async () => {
    const sc = fakeServiceClient();
    // Pre-set a higher GL watermark.
    (sc as unknown as { watermarks: Map<string, string> }).watermarks.set(`erpnext::${LEDGER_GL_WM_DOMAIN}`, '2026-07-12 13:00:00.000000');
    vi.spyOn(ledgerFetch, 'fetchGlEntries').mockResolvedValue([
      { name: 'GLE-1', account: 'A', cost_center: null, fiscal_year: null, project: null, party_type: null, party: null,
        voucher_type: null, voucher_no: null, posting_date: null, debit: '1.00', credit: '0.00', is_cancelled: false,
        docstatus: 1, modified: '2026-07-12 12:30:00.000000' }, // older than the existing 13:00 watermark
    ]);
    vi.spyOn(ledgerFetch, 'fetchPaymentLedgerEntries').mockResolvedValue([]);
    await feedLedgerMirrors(sc, { client: { fetchImpl: fetch, apiKey: 'k', apiSecret: 's', baseUrl: 'http://erp.test' }, orgId: 'org-1', company: 'PMO Smoke Co' });
    expect((sc as unknown as { watermarks: Map<string, string> }).watermarks.get(`erpnext::${LEDGER_GL_WM_DOMAIN}`)).toBe('2026-07-12 13:00:00.000000');
  });

  it('forwards ledgerFetch\'s already-filtered rows — a cancelled row never reaches the feed (7.2 filters is_cancelled/docstatus=2 at fetch)', async () => {
    const sc = fakeServiceClient();
    // ledgerFetch returns ONLY live rows (it filters cancelled at the source). The feed forwards them
    // verbatim — no second cancellation filter here (single responsibility: 7.2 owns the filter).
    vi.spyOn(ledgerFetch, 'fetchGlEntries').mockResolvedValue([
      { name: 'GLE-LIVE', account: 'A', cost_center: null, fiscal_year: null, project: null, party_type: null, party: null,
        voucher_type: null, voucher_no: null, posting_date: null, debit: '1.00', credit: '0.00', is_cancelled: false,
        docstatus: 1, modified: '2026-07-12 12:00:00.000000' },
    ]);
    vi.spyOn(ledgerFetch, 'fetchPaymentLedgerEntries').mockResolvedValue([]);
    const res = await feedLedgerMirrors(sc, { client: { fetchImpl: fetch, apiKey: 'k', apiSecret: 's', baseUrl: 'http://erp.test' }, orgId: 'org-1', company: 'PMO Smoke Co' });
    expect(res.glFed).toBe(1);
    expect(Array.from((sc as unknown as { gl: Map<string, Record<string, unknown>> }).gl.values())).toHaveLength(1);
  });

  it('no new rows ⇒ watermark stays put (no rewind, no spurious advance)', async () => {
    const sc = fakeServiceClient();
    (sc as unknown as { watermarks: Map<string, string> }).watermarks.set(`erpnext::${LEDGER_GL_WM_DOMAIN}`, '2026-07-12 12:00:00.000000');
    vi.spyOn(ledgerFetch, 'fetchGlEntries').mockResolvedValue([]);
    vi.spyOn(ledgerFetch, 'fetchPaymentLedgerEntries').mockResolvedValue([]);
    const res = await feedLedgerMirrors(sc, { client: { fetchImpl: fetch, apiKey: 'k', apiSecret: 's', baseUrl: 'http://erp.test' }, orgId: 'org-1', company: 'PMO Smoke Co' });
    expect(res.glFed).toBe(0);
    expect((sc as unknown as { watermarks: Map<string, string> }).watermarks.get(`erpnext::${LEDGER_GL_WM_DOMAIN}`)).toBe('2026-07-12 12:00:00.000000');
  });
});

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
import { FakePostgrest, type FakeRow } from '@/test/postgrestFake.ts';

/**
 * An in-memory fake of the two mirror tables + the watermarks table, exercising the feed's
 * read-existing → filter-stale → upsert → advance-watermark logic end-to-end.
 *
 * ⚑ It is built on the PostgREST-FAITHFUL fake (`test/postgrestFake.ts`), which CAPS every response
 * at `db-max-rows` (1000) exactly as PostgREST does. The previous hand-rolled fake returned the whole
 * store on every read, so the staleness guard's own tests could only ever exercise the branch where
 * it works — see the MEDIUM-1 block at the bottom of this file (audit round 8).
 */
function fakeServiceClient(existingGl: Array<Record<string, unknown>> = [], existingPle: Array<Record<string, unknown>> = []) {
  const withIds = (rows: Array<Record<string, unknown>>, prefix: string): FakeRow[] =>
    rows.map((r, i) => ({ id: `${prefix}-${String(i).padStart(8, '0')}`, ...r }));
  const fake = new FakePostgrest(
    {
      erp_gl_entry_mirror: withIds(existingGl, 'gl'),
      erp_payment_ledger_mirror: withIds(existingPle, 'ple'),
      external_sync_watermarks: [],
    },
    {
      upsertKeys: {
        erp_gl_entry_mirror: ['org_id', 'erp_name'],
        erp_payment_ledger_mirror: ['org_id', 'erp_name'],
        external_sync_watermarks: ['org_id', 'external_tier', 'domain'],
      },
    },
  );
  const byName = (table: string) =>
    new Map(fake.rowsOf(table).map((r) => [String(r.erp_name), r]));
  return {
    fake,
    get gl() { return byName('erp_gl_entry_mirror'); },
    get ple() { return byName('erp_payment_ledger_mirror'); },
    get watermarks() {
      return new Map(fake.rowsOf('external_sync_watermarks')
        .map((r) => [`${String(r.external_tier)}::${String(r.domain)}`, String(r.watermark_cursor)]));
    },
    /** Pre-set a watermark, as the previous fake's `watermarks.set(...)` did. */
    setWatermark(tier: string, domain: string, cursor: string) {
      fake.rowsOf('external_sync_watermarks').push({ org_id: 'org-1', external_tier: tier, domain, watermark_cursor: cursor });
    },
    from: (name: string) => fake.from(name),
  } as unknown as Parameters<typeof feedLedgerMirrors>[0];
}

type FakeHandle = {
  gl: Map<string, Record<string, unknown>>;
  ple: Map<string, Record<string, unknown>>;
  watermarks: Map<string, string>;
  fake: FakePostgrest;
  setWatermark(tier: string, domain: string, cursor: string): void;
};
const h = (sc: Parameters<typeof feedLedgerMirrors>[0]): FakeHandle => sc as unknown as FakeHandle;

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
    expect(Array.from(h(sc).gl.values())).toEqual([
      expect.objectContaining({ erp_name: 'GLE-1', account: 'Creditors - PSC', debit: '50000.00', credit: '0.00', erp_modified: '2026-07-12 12:00:00.000000' }),
    ]);
    expect(Array.from(h(sc).ple.values())).toEqual([
      expect.objectContaining({ erp_name: 'PLE-1', amount: '-50000.00', erp_modified: '2026-07-12 12:05:00.000000' }),
    ]);
    // Watermarks advanced to max modified per source.
    expect(h(sc).watermarks.get(`erpnext::${LEDGER_GL_WM_DOMAIN}`)).toBe('2026-07-12 12:00:00.000000');
    expect(h(sc).watermarks.get(`erpnext::${LEDGER_PLE_WM_DOMAIN}`)).toBe('2026-07-12 12:05:00.000000');
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
    const glRow = Array.from(h(sc).gl.values())[0];
    expect(glRow.account).toBe('Creditors - PSC');
  });

  it('the per-source watermark never rewinds (a stale re-feed does not lower the cursor)', async () => {
    const sc = fakeServiceClient();
    // Pre-set a higher GL watermark.
    h(sc).setWatermark('erpnext', LEDGER_GL_WM_DOMAIN, '2026-07-12 13:00:00.000000');
    vi.spyOn(ledgerFetch, 'fetchGlEntries').mockResolvedValue([
      { name: 'GLE-1', account: 'A', cost_center: null, fiscal_year: null, project: null, party_type: null, party: null,
        voucher_type: null, voucher_no: null, posting_date: null, debit: '1.00', credit: '0.00', is_cancelled: false,
        docstatus: 1, modified: '2026-07-12 12:30:00.000000' }, // older than the existing 13:00 watermark
    ]);
    vi.spyOn(ledgerFetch, 'fetchPaymentLedgerEntries').mockResolvedValue([]);
    await feedLedgerMirrors(sc, { client: { fetchImpl: fetch, apiKey: 'k', apiSecret: 's', baseUrl: 'http://erp.test' }, orgId: 'org-1', company: 'PMO Smoke Co' });
    expect(h(sc).watermarks.get(`erpnext::${LEDGER_GL_WM_DOMAIN}`)).toBe('2026-07-12 13:00:00.000000');
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
    expect(Array.from(h(sc).gl.values())).toHaveLength(1);
  });

  it('no new rows ⇒ watermark stays put (no rewind, no spurious advance)', async () => {
    const sc = fakeServiceClient();
    h(sc).setWatermark('erpnext', LEDGER_GL_WM_DOMAIN, '2026-07-12 12:00:00.000000');
    vi.spyOn(ledgerFetch, 'fetchGlEntries').mockResolvedValue([]);
    vi.spyOn(ledgerFetch, 'fetchPaymentLedgerEntries').mockResolvedValue([]);
    const res = await feedLedgerMirrors(sc, { client: { fetchImpl: fetch, apiKey: 'k', apiSecret: 's', baseUrl: 'http://erp.test' }, orgId: 'org-1', company: 'PMO Smoke Co' });
    expect(res.glFed).toBe(0);
    expect(h(sc).watermarks.get(`erpnext::${LEDGER_GL_WM_DOMAIN}`)).toBe('2026-07-12 12:00:00.000000');
  });
});

/**
 * ⚑ MEDIUM-1 (Luna audit round 8, 2026-07-22) — THE GUARD THAT GOES INERT, NOT RED.
 *
 * `upsertMirrorRows` built its `erp_modified >=` staleness map from ONE unpaged read of the whole
 * mirror. PostgREST caps that response at `db-max-rows` (1000) and signals nothing, so past 1000
 * mirrored rows every UNSEEN row looked like `stored === undefined` — "not yet mirrored" — and the
 * freshness check was SKIPPED entirely for it. A stale re-delivery (a webhook replay, a watermark
 * that re-covers a boundary `modified`, a Frappe list page serving a pre-edit snapshot) then
 * overwrote the mirror's NEWER debit/credit with older money, which `refreshActuals` sums on the
 * next tick. Same root cause as HIGH-1, same fix discipline.
 *
 * The guard's own tests could never see this: they handed it a 1-row store, so they only ever
 * exercised the branch where it works. This block puts the target row past the cap.
 *
 * A read ERROR was the same shape of hole: it was never checked, so a failed read produced an EMPTY
 * map and the guard was skipped for EVERY row. It must fail CLOSED (throw), never wave money through.
 */
describe('erpnext/ledgerMirrorFeed — MEDIUM-1: the staleness guard sees the WHOLE mirror', () => {
  const client = { fetchImpl: fetch, apiKey: 'k', apiSecret: 's', baseUrl: 'http://erp.test' };

  /** 1,500 mirrored GL rows — past PostgREST's 1000-row cap — with the target at index 1400. */
  function bigMirror() {
    const rows: Array<Record<string, unknown>> = [];
    for (let i = 0; i < 1500; i += 1) {
      rows.push({
        org_id: 'org-1',
        erp_name: i === 1400 ? 'GLE-TARGET' : `GLE-${String(i).padStart(6, '0')}`,
        account: i === 1400 ? 'Creditors - PSC' : 'Filler - PSC',
        debit: i === 1400 ? '50000.00' : '1.00',
        erp_modified: '2026-07-12 12:00:00.000000',
      });
    }
    return rows;
  }

  it('drops a STALE re-delivery of a row mirrored past the 1000-row cap (never overwrites newer money)', async () => {
    const sc = fakeServiceClient(bigMirror(), []);
    vi.spyOn(ledgerFetch, 'fetchGlEntries').mockResolvedValue([
      { name: 'GLE-TARGET', account: 'STALE-ACCOUNT', cost_center: null, fiscal_year: null, project: null, party_type: null,
        party: null, voucher_type: null, voucher_no: null, posting_date: null, debit: '1.00', credit: '0.00',
        is_cancelled: false, docstatus: 1, modified: '2026-07-12 11:00:00.000000' }, // OLDER than what is mirrored
    ]);
    vi.spyOn(ledgerFetch, 'fetchPaymentLedgerEntries').mockResolvedValue([]);

    const res = await feedLedgerMirrors(sc, { client, orgId: 'org-1', company: 'PMO Smoke Co' });

    expect(res.glFed).toBe(0); // the guard fired — the stale row was dropped
    const target = h(sc).gl.get('GLE-TARGET')!;
    expect(target.account).toBe('Creditors - PSC'); // NOT 'STALE-ACCOUNT'
    expect(target.debit).toBe('50000.00');          // the newer money survived
  });

  it('still applies a FRESHER re-delivery of a row past the cap (the guard is a filter, not a wall)', async () => {
    const sc = fakeServiceClient(bigMirror(), []);
    vi.spyOn(ledgerFetch, 'fetchGlEntries').mockResolvedValue([
      { name: 'GLE-TARGET', account: 'Creditors - PSC', cost_center: null, fiscal_year: null, project: null, party_type: null,
        party: null, voucher_type: null, voucher_no: null, posting_date: null, debit: '75000.00', credit: '0.00',
        is_cancelled: false, docstatus: 1, modified: '2026-07-12 13:00:00.000000' }, // NEWER
    ]);
    vi.spyOn(ledgerFetch, 'fetchPaymentLedgerEntries').mockResolvedValue([]);

    const res = await feedLedgerMirrors(sc, { client, orgId: 'org-1', company: 'PMO Smoke Co' });

    expect(res.glFed).toBe(1);
    expect(h(sc).gl.get('GLE-TARGET')!.debit).toBe('75000.00');
  });

  it('fails CLOSED on a mirror read error — never an empty map that waves every stale row through', async () => {
    const fake = new FakePostgrest(
      { erp_gl_entry_mirror: [{ id: 'gl-1', org_id: 'org-1', erp_name: 'GLE-1', erp_modified: '2026-07-12 12:00:00.000000' }], external_sync_watermarks: [] },
      { readErrors: { erp_gl_entry_mirror: { message: 'connection reset', code: '08006' } } },
    );
    vi.spyOn(ledgerFetch, 'fetchGlEntries').mockResolvedValue([
      { name: 'GLE-1', account: 'STALE-ACCOUNT', cost_center: null, fiscal_year: null, project: null, party_type: null,
        party: null, voucher_type: null, voucher_no: null, posting_date: null, debit: '1.00', credit: '0.00',
        is_cancelled: false, docstatus: 1, modified: '2026-07-12 11:00:00.000000' },
    ]);
    vi.spyOn(ledgerFetch, 'fetchPaymentLedgerEntries').mockResolvedValue([]);

    await expect(
      feedLedgerMirrors(fake as unknown as Parameters<typeof feedLedgerMirrors>[0], { client, orgId: 'org-1', company: 'PMO Smoke Co' }),
    ).rejects.toThrow('connection reset');
  });
});

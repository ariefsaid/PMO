/**
 * AC-ENA-150/162 (the feed basis) [Vitest unit] — erpnext/ledgerMirrorFeed.ts: the sweep-side feed
 * that populates erp_gl_entry_mirror / erp_payment_ledger_mirror from ERPNext `GL Entry` / `Payment
 * Ledger Entry` truth. Actuals (7.3) + the aging fallback (7.4) read the MIRROR, never live ERP, so
 * this feed is what makes "mirrored ledger rows" real. Proves:
 *   • a fixed fetched GL/PLE set lands as mirror rows (decimal-strings intact, R4);
 *   • a re-feed of an OLDER `modified` is a no-op (the per-row `erp_modified >=` source-mod guard — a
 *     stale re-fed row never overwrites a fresher mirror row, FR-CUA-049 pattern);
 *   • the per-source watermark advances monotonically to max `modified` (never rewinds);
 *   • #901: a cancelled row is FED with its flag (ledgerFetch no longer filters it out) and a
 *     re-delivered row UPDATES its mirror copy in place (upsert on `(org_id, erp_name)`) — the
 *     readers, not the fetch, exclude cancelled/delinked rows.
 *
 * Pure + mocked service client + mocked ERP fetch; the service-client seam is structural (matches
 * supabase-js at runtime, cast `as never` at the boundary, the actualsSnapshot.ts idiom).
 */
import { afterEach, describe, it, expect, vi } from 'vitest';
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
    rpc: (name: string, args: Record<string, unknown>) => replaceVoucherInFake(fake, name, args),
  } as unknown as Parameters<typeof feedLedgerMirrors>[0];
}

/**
 * The in-memory model of `replace_erp_{gl,ple}_voucher_rows` (migration 0382): ONE step that upserts the
 * voucher's re-delivered rows (per-row `erp_modified >=` guard) and deletes that voucher's mirror rows
 * whose name is absent from ERPNext's current set. pgTAP (0382_ledger_voucher_replace.test.sql) proves
 * the SQL itself; this lets the feed tests assert what the mirror ends up holding.
 */
function replaceVoucherInFake(fake: FakePostgrest, name: string, args: Record<string, unknown>) {
  fake.rpcCalls.push({ fn: name, args: { ...args } });
  const table = name === 'replace_erp_gl_voucher_rows' ? 'erp_gl_entry_mirror'
    : name === 'replace_erp_ple_voucher_rows' ? 'erp_payment_ledger_mirror' : null;
  if (!table) return Promise.resolve({ data: null, error: { message: `unmodelled rpc: ${name}` } });
  const rows = fake.rowsOf(table);
  let upserted = 0;
  for (const incoming of args.p_rows as FakeRow[]) {
    const at = rows.findIndex((r) => r.org_id === args.p_org_id && r.erp_name === incoming.erp_name);
    if (at === -1) { rows.push({ id: `rpc-${String(incoming.erp_name)}`, ...incoming, org_id: args.p_org_id }); upserted += 1; }
    else if (String(rows[at].erp_modified) <= String(incoming.erp_modified)) { rows[at] = { ...rows[at], ...incoming }; upserted += 1; }
  }
  const current = new Set(args.p_current_names as string[]);
  let deleted = 0;
  for (let i = rows.length - 1; i >= 0; i -= 1) {
    const r = rows[i];
    if (r.org_id === args.p_org_id && r.voucher_type === args.p_voucher_type && r.voucher_no === args.p_voucher_no
      && !current.has(String(r.erp_name))) { rows.splice(i, 1); deleted += 1; }
  }
  return Promise.resolve({ data: { upserted, deleted }, error: null });
}

afterEach(() => vi.restoreAllMocks());

type FakeHandle = {
  gl: Map<string, Record<string, unknown>>;
  ple: Map<string, Record<string, unknown>>;
  watermarks: Map<string, string>;
  fake: FakePostgrest;
  setWatermark(tier: string, domain: string, cursor: string): void;
};
const h = (sc: Parameters<typeof feedLedgerMirrors>[0]): FakeHandle => sc as unknown as FakeHandle;

function glRow(name: string, over: Partial<ledgerFetch.GlEntryRow> = {}): ledgerFetch.GlEntryRow {
  return { name, account: 'Cost of Goods Sold - PSC', cost_center: 'Main - PSC', fiscal_year: '2026', project: 'PROJ-0001',
    party_type: null, party: null, voucher_type: 'Purchase Invoice', voucher_no: 'ACC-PINV-2026-00042', posting_date: '2026-10-07',
    debit: '0.00', credit: '0.00', is_cancelled: false, docstatus: 1, modified: '2026-10-07 10:00:00.000000', ...over };
}

function pleRow(name: string, over: Partial<ledgerFetch.PaymentLedgerEntryRow> = {}): ledgerFetch.PaymentLedgerEntryRow {
  return { name, account: 'Creditors - PSC', party_type: 'Supplier', party: 'Spike Supplier', against_voucher_type: 'Purchase Invoice',
    against_voucher_no: 'ACC-PINV-2026-00042', amount: '125000.00', posting_date: '2026-10-07', due_date: '2026-10-07',
    voucher_type: null, voucher_no: null, docstatus: 1, delinked: false, modified: '2026-10-07 10:00:00.000000', ...over };
}

describe('erpnext/ledgerMirrorFeed — feedLedgerMirrors (AC-ENA-150/162 basis)', () => {
  it('AC-005: a complete full replay marks fetched rows and finishes atomically before watermark promotion', async () => {
    const base = fakeServiceClient();
    const rpc = vi.fn().mockResolvedValue({ data: { deleted: 2 }, error: null });
    const sc = Object.assign(base, { rpc });
    vi.spyOn(ledgerFetch, 'fetchGlEntries').mockResolvedValue({ rows: [glRow('GL-FULL', { company: 'Synthetic Co' })], caughtUp: true });
    vi.spyOn(ledgerFetch, 'fetchPaymentLedgerEntries').mockResolvedValue({ rows: [], caughtUp: true });
    const result = await feedLedgerMirrors(sc as never, { client: { fetchImpl: fetch, apiKey: 'k', apiSecret: 's', baseUrl: 'https://erp.example.test' }, orgId: 'org-1', company: 'Synthetic Co', fullReplay: true });
    expect(result.glCursor).toBe('2026-10-07 10:00:00.000000');
    expect(h(base).gl.get('GL-FULL')).toMatchObject({ replay_seen_id: expect.any(String) });
    expect(rpc).toHaveBeenCalledWith('finish_erp_gl_replay', expect.objectContaining({ p_org_id: 'org-1', p_company: 'Synthetic Co', p_watermark: '2026-10-07 10:00:00.000000' }));
  });

  it('AC-005: an empty caught-up full replay finishes without inventing or advancing a watermark', async () => {
    const base = fakeServiceClient();
    const rpc = vi.fn().mockResolvedValue({ data: { deleted: 0 }, error: null });
    const sc = Object.assign(base, { rpc });
    vi.spyOn(ledgerFetch, 'fetchGlEntries').mockResolvedValue({ rows: [], caughtUp: true });
    vi.spyOn(ledgerFetch, 'fetchPaymentLedgerEntries').mockResolvedValue({ rows: [], caughtUp: true });
    const result = await feedLedgerMirrors(sc as never, { client: { fetchImpl: fetch, apiKey: 'k', apiSecret: 's', baseUrl: 'https://erp.example.test' }, orgId: 'org-1', company: 'Synthetic Co', fullReplay: true });
    expect(rpc).toHaveBeenCalledWith('finish_erp_gl_replay', expect.objectContaining({ p_watermark: null }));
    expect(result.glCursor).toBeNull();
    expect(h(base).watermarks.has(`erpnext::${LEDGER_GL_WM_DOMAIN}`)).toBe(false);
  });

  it('AC-005: an incomplete full replay fails before mirror or watermark mutation', async () => {
    const sc = fakeServiceClient();
    const fetchSpy = vi.spyOn(ledgerFetch, 'fetchGlEntries').mockResolvedValue({ rows: [glRow('GL-PARTIAL')], caughtUp: false });
    await expect(feedLedgerMirrors(sc, { client: { fetchImpl: fetch, apiKey: 'k', apiSecret: 's', baseUrl: 'https://erp.example.test' }, orgId: 'org-1', company: 'Synthetic Co', fullReplay: true })).rejects.toThrow(/page budget exhausted/i);
    expect(h(sc).gl.size).toBe(0);
    expect(h(sc).watermarks.size).toBe(0);
    expect(fetchSpy).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ since: undefined, maxPages: 300 }));
  });

  it('AC-005: a returned stale-binding refusal cannot claim replay completion or continue to PLE', async () => {
    const base = fakeServiceClient();
    let replayNeeded = true;
    const rpc = vi.fn(async () => {
      const result = { data: { deleted: 0, stale_binding: true }, error: null };
      if (result.data.stale_binding !== true) replayNeeded = false;
      return result;
    });
    const sc = Object.assign(base, { rpc });
    vi.spyOn(ledgerFetch, 'fetchGlEntries').mockResolvedValue({ rows: [glRow('GL-STALE', { company: 'Synthetic Co' })], caughtUp: true });
    const pleFetch = vi.spyOn(ledgerFetch, 'fetchPaymentLedgerEntries').mockResolvedValue({ rows: [], caughtUp: true });
    let returnedCaughtUp = false;
    try {
      await feedLedgerMirrors(sc as never, { client: { fetchImpl: fetch, apiKey: 'k', apiSecret: 's', baseUrl: 'https://erp.example.test' }, orgId: 'org-1', company: 'Synthetic Co', fullReplay: true });
      returnedCaughtUp = true;
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toMatch(/stale.*binding/i);
    }
    expect(returnedCaughtUp).toBe(false);
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(pleFetch).not.toHaveBeenCalled();
    expect(h(base).gl.get('GL-STALE')).toMatchObject({ replay_seen_id: expect.any(String) });
    expect(h(base).watermarks.size).toBe(0);
    expect(replayNeeded).toBe(true);
  });

  it('a fixed fetched GL/PLE set lands as mirror rows (decimal-strings intact) + advances both watermarks', async () => {
    const sc = fakeServiceClient();
    const glSpy = vi.spyOn(ledgerFetch, 'fetchGlEntries').mockResolvedValue({ rows: [
      { name: 'GLE-1', account: 'Creditors - PSC', cost_center: 'Main - PSC', fiscal_year: '2026', project: null,
        party_type: 'Supplier', party: 'Spike Supplier', voucher_type: 'Purchase Invoice', voucher_no: 'ACC-PINV-2026-00018',
        posting_date: '2026-07-12', debit: '50000.00', credit: '0.00', is_cancelled: false, docstatus: 1, modified: '2026-07-12 12:00:00.000000' },
    ], caughtUp: true });
    const pleSpy = vi.spyOn(ledgerFetch, 'fetchPaymentLedgerEntries').mockResolvedValue({ rows: [
      { name: 'PLE-1', account: 'Creditors - PSC', party_type: 'Supplier', party: 'Spike Supplier',
        against_voucher_type: 'Purchase Invoice', against_voucher_no: 'ACC-PINV-2026-00018', amount: '-50000.00',
        posting_date: '2026-07-12', due_date: '2026-08-12', voucher_type: 'Payment Entry', voucher_no: 'ACC-PAY-2026-00018', docstatus: 1, delinked: false, modified: '2026-07-12 12:05:00.000000' },
    ], caughtUp: true });
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
    vi.spyOn(ledgerFetch, 'fetchGlEntries').mockResolvedValue({ rows: [
      { name: 'GLE-1', account: 'STALE-ACCOUNT', cost_center: null, fiscal_year: null, project: null, party_type: null,
        party: null, voucher_type: null, voucher_no: null, posting_date: null, debit: '1.00', credit: '0.00',
        is_cancelled: false, docstatus: 1, modified: '2026-07-12 11:00:00.000000' }, // older
    ], caughtUp: true });
    vi.spyOn(ledgerFetch, 'fetchPaymentLedgerEntries').mockResolvedValue({ rows: [], caughtUp: true });
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
    vi.spyOn(ledgerFetch, 'fetchGlEntries').mockResolvedValue({ rows: [
      { name: 'GLE-1', account: 'A', cost_center: null, fiscal_year: null, project: null, party_type: null, party: null,
        voucher_type: null, voucher_no: null, posting_date: null, debit: '1.00', credit: '0.00', is_cancelled: false,
        docstatus: 1, modified: '2026-07-12 12:30:00.000000' }, // older than the existing 13:00 watermark
    ], caughtUp: true });
    vi.spyOn(ledgerFetch, 'fetchPaymentLedgerEntries').mockResolvedValue({ rows: [], caughtUp: true });
    await feedLedgerMirrors(sc, { client: { fetchImpl: fetch, apiKey: 'k', apiSecret: 's', baseUrl: 'http://erp.test' }, orgId: 'org-1', company: 'PMO Smoke Co' });
    expect(h(sc).watermarks.get(`erpnext::${LEDGER_GL_WM_DOMAIN}`)).toBe('2026-07-12 13:00:00.000000');
  });

  it('#901 forwards cancelled rows WITH their flag — the feed never drops a row for its cancellation state', async () => {
    const sc = fakeServiceClient();
    vi.spyOn(ledgerFetch, 'fetchGlEntries').mockResolvedValue({ rows: [
      glRow('GLE-LIVE', { debit: '1.00', modified: '2026-07-12 12:00:00.000000' }),
      glRow('GLE-REV', { credit: '1.00', is_cancelled: true, modified: '2026-07-12 12:00:00.000000' }),
    ], caughtUp: true });
    vi.spyOn(ledgerFetch, 'fetchPaymentLedgerEntries').mockResolvedValue({ rows: [], caughtUp: true });
    const res = await feedLedgerMirrors(sc, { client: { fetchImpl: fetch, apiKey: 'k', apiSecret: 's', baseUrl: 'http://erp.test' }, orgId: 'org-1', company: 'PMO Smoke Co' });
    expect(res.glFed).toBe(2);
    expect(h(sc).gl.get('GLE-LIVE')).toMatchObject({ is_cancelled: false });
    expect(h(sc).gl.get('GLE-REV')).toMatchObject({ is_cancelled: true });
  });

  it('no new rows ⇒ watermark stays put (no rewind, no spurious advance)', async () => {
    const sc = fakeServiceClient();
    h(sc).setWatermark('erpnext', LEDGER_GL_WM_DOMAIN, '2026-07-12 12:00:00.000000');
    vi.spyOn(ledgerFetch, 'fetchGlEntries').mockResolvedValue({ rows: [], caughtUp: true });
    vi.spyOn(ledgerFetch, 'fetchPaymentLedgerEntries').mockResolvedValue({ rows: [], caughtUp: true });
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
    vi.spyOn(ledgerFetch, 'fetchGlEntries').mockResolvedValue({ rows: [
      { name: 'GLE-TARGET', account: 'STALE-ACCOUNT', cost_center: null, fiscal_year: null, project: null, party_type: null,
        party: null, voucher_type: null, voucher_no: null, posting_date: null, debit: '1.00', credit: '0.00',
        is_cancelled: false, docstatus: 1, modified: '2026-07-12 11:00:00.000000' }, // OLDER than what is mirrored
    ], caughtUp: true });
    vi.spyOn(ledgerFetch, 'fetchPaymentLedgerEntries').mockResolvedValue({ rows: [], caughtUp: true });

    const res = await feedLedgerMirrors(sc, { client, orgId: 'org-1', company: 'PMO Smoke Co' });

    expect(res.glFed).toBe(0); // the guard fired — the stale row was dropped
    const target = h(sc).gl.get('GLE-TARGET')!;
    expect(target.account).toBe('Creditors - PSC'); // NOT 'STALE-ACCOUNT'
    expect(target.debit).toBe('50000.00');          // the newer money survived
  });

  it('still applies a FRESHER re-delivery of a row past the cap (the guard is a filter, not a wall)', async () => {
    const sc = fakeServiceClient(bigMirror(), []);
    vi.spyOn(ledgerFetch, 'fetchGlEntries').mockResolvedValue({ rows: [
      { name: 'GLE-TARGET', account: 'Creditors - PSC', cost_center: null, fiscal_year: null, project: null, party_type: null,
        party: null, voucher_type: null, voucher_no: null, posting_date: null, debit: '75000.00', credit: '0.00',
        is_cancelled: false, docstatus: 1, modified: '2026-07-12 13:00:00.000000' }, // NEWER
    ], caughtUp: true });
    vi.spyOn(ledgerFetch, 'fetchPaymentLedgerEntries').mockResolvedValue({ rows: [], caughtUp: true });

    const res = await feedLedgerMirrors(sc, { client, orgId: 'org-1', company: 'PMO Smoke Co' });

    expect(res.glFed).toBe(1);
    expect(h(sc).gl.get('GLE-TARGET')!.debit).toBe('75000.00');
  });

  it('fails CLOSED on a mirror read error — never an empty map that waves every stale row through', async () => {
    const fake = new FakePostgrest(
      { erp_gl_entry_mirror: [{ id: 'gl-1', org_id: 'org-1', erp_name: 'GLE-1', erp_modified: '2026-07-12 12:00:00.000000' }], external_sync_watermarks: [] },
      { readErrors: { erp_gl_entry_mirror: { message: 'connection reset', code: '08006' } } },
    );
    vi.spyOn(ledgerFetch, 'fetchGlEntries').mockResolvedValue({ rows: [
      { name: 'GLE-1', account: 'STALE-ACCOUNT', cost_center: null, fiscal_year: null, project: null, party_type: null,
        party: null, voucher_type: null, voucher_no: null, posting_date: null, debit: '1.00', credit: '0.00',
        is_cancelled: false, docstatus: 1, modified: '2026-07-12 11:00:00.000000' },
    ], caughtUp: true });
    vi.spyOn(ledgerFetch, 'fetchPaymentLedgerEntries').mockResolvedValue({ rows: [], caughtUp: true });

    await expect(
      feedLedgerMirrors(fake as unknown as Parameters<typeof feedLedgerMirrors>[0], { client, orgId: 'org-1', company: 'PMO Smoke Co' }),
    ).rejects.toThrow('connection reset');
  });
});

/**
 * #901 — a cancel in ERPNext must reach the mirror. ERPNext flips the ORIGINAL GL rows to
 * `is_cancelled=1` (and the original PLE rows to `delinked=1`), bumping `modified`, and adds reversal
 * rows. The feed must re-read those originals (ledgerFetch no longer filters them out) and UPDATE the
 * mirror copies in place — keyed on the mirror's real unique key `(org_id, erp_name)`, not the uuid PK
 * the rows never carry (a PK-targeted upsert of an already-mirrored name is a 23505 on PostgREST).
 */
describe('erpnext/ledgerMirrorFeed — #901 a cancel reaches the mirror', () => {
  const client = { fetchImpl: fetch, apiKey: 'k', apiSecret: 's', baseUrl: 'http://erp.test' };

  it('flips is_cancelled on the already-mirrored GL original and lands the reversal, with no feed error', async () => {
    const sc = fakeServiceClient(
      [{ org_id: 'org-1', erp_name: 'GLE-ORIG', account: 'Cost of Goods Sold - PSC', debit: '125000.00', credit: '0.00', is_cancelled: false, erp_modified: '2026-10-07 10:00:00.000000' }],
      [],
    );
    h(sc).setWatermark('erpnext', LEDGER_GL_WM_DOMAIN, '2026-10-07 10:00:00.000000');
    vi.spyOn(ledgerFetch, 'fetchGlEntries').mockResolvedValue({ rows: [
      glRow('GLE-ORIG', { debit: '125000.00', is_cancelled: true, modified: '2026-10-07 10:05:00.000000' }),
      glRow('GLE-REV', { credit: '125000.00', is_cancelled: true, modified: '2026-10-07 10:05:00.000000' }),
    ], caughtUp: true });
    vi.spyOn(ledgerFetch, 'fetchPaymentLedgerEntries').mockResolvedValue({ rows: [], caughtUp: true });

    const res = await feedLedgerMirrors(sc, { client, orgId: 'org-1', company: 'PMO Smoke Co' });

    expect(res.glFed).toBe(2);
    expect(h(sc).fake.rowsOf('erp_gl_entry_mirror')).toHaveLength(2); // updated in place, never duplicated
    expect(h(sc).gl.get('GLE-ORIG')).toMatchObject({ is_cancelled: true, debit: '125000.00', erp_modified: '2026-10-07 10:05:00.000000' });
    expect(h(sc).gl.get('GLE-REV')).toMatchObject({ is_cancelled: true, credit: '125000.00' });
    expect(res.glCursor).toBe('2026-10-07 10:05:00.000000');
  });

  it('flips delinked on the already-mirrored PLE original and lands the delinked reversal', async () => {
    const sc = fakeServiceClient(
      [],
      [{ org_id: 'org-1', erp_name: 'PLE-ORIG', account: 'Creditors - PSC', amount: '125000.00', delinked: false, erp_modified: '2026-10-07 10:00:00.000000' }],
    );
    vi.spyOn(ledgerFetch, 'fetchGlEntries').mockResolvedValue({ rows: [], caughtUp: true });
    vi.spyOn(ledgerFetch, 'fetchPaymentLedgerEntries').mockResolvedValue({ rows: [
      pleRow('PLE-ORIG', { delinked: true, modified: '2026-10-07 10:05:00.000000' }),
      pleRow('PLE-REV', { amount: '-125000.00', delinked: true, modified: '2026-10-07 10:05:00.000000' }),
    ], caughtUp: true });

    const res = await feedLedgerMirrors(sc, { client, orgId: 'org-1', company: 'PMO Smoke Co' });

    expect(res.pleFed).toBe(2);
    expect(h(sc).fake.rowsOf('erp_payment_ledger_mirror')).toHaveLength(2);
    expect(h(sc).ple.get('PLE-ORIG')).toMatchObject({ delinked: true, amount: '125000.00' });
    expect(h(sc).ple.get('PLE-REV')).toMatchObject({ delinked: true, amount: '-125000.00' });
  });

  it('the boundary row the >= cursor re-delivers every tick does not fail the feed (idempotent re-apply)', async () => {
    const sc = fakeServiceClient(
      [{ org_id: 'org-1', erp_name: 'GLE-LAST', account: 'Cost of Goods Sold - PSC', is_cancelled: false, erp_modified: '2026-10-07 10:00:00.000000' }],
      [{ org_id: 'org-1', erp_name: 'PLE-LAST', account: 'Creditors - PSC', delinked: false, erp_modified: '2026-10-07 10:00:00.000000' }],
    );
    vi.spyOn(ledgerFetch, 'fetchGlEntries').mockResolvedValue({ rows: [glRow('GLE-LAST'), glRow('GLE-NEW', { modified: '2026-10-07 10:01:00.000000' })], caughtUp: true });
    vi.spyOn(ledgerFetch, 'fetchPaymentLedgerEntries').mockResolvedValue({ rows: [pleRow('PLE-LAST')], caughtUp: true });

    const res = await feedLedgerMirrors(sc, { client, orgId: 'org-1', company: 'PMO Smoke Co' });

    expect(res).toMatchObject({ glFed: 2, pleFed: 1, glCursor: '2026-10-07 10:01:00.000000' });
    expect(h(sc).fake.rowsOf('erp_gl_entry_mirror')).toHaveLength(2);
    expect(h(sc).fake.rowsOf('erp_payment_ledger_mirror')).toHaveLength(1);
  });
});

/**
 * #901 fix round — bounded, resumable, ordered backfill + a watermark that never rewinds under
 * overlapping ticks. These tests drive the REAL fetchers (no spy) against a fake ERPNext list
 * endpoint, so paging order, the per-tick page budget and the watermark advance are exercised
 * end-to-end with the FakePostgrest mirror.
 */
describe('erpnext/ledgerMirrorFeed — #901 fix round: bounded + ordered + monotonic', () => {
  /** Rows pre-sorted `modified asc` — the fake ERP honours the order_by the fetcher must send. */
  function glSource(n: number): ledgerFetch.GlEntryRow[] {
    return Array.from({ length: n }, (_, i) => glRow(`GLE-${i}`, { modified: `2026-10-07 10:0${i}:00.000000` }));
  }

  /** A fake ERPNext list endpoint serving the REAL fetchers (filters/limit_page_length/limit_start). */
  function fakeErp(rows: ledgerFetch.GlEntryRow[], pleRows: ledgerFetch.PaymentLedgerEntryRow[] = []) {
    const urls: string[] = [];
    const fetchImpl = async (url: string): Promise<Response> => {
      urls.push(url);
      const u = new URL(url);
      const doctype = decodeURIComponent(u.pathname.replace('/api/resource/', ''));
      const filters = JSON.parse(u.searchParams.get('filters') ?? '[]') as Array<[string, string, string]>;
      const since = filters.find(([col]) => col === 'modified')?.[2];
      const start = Number(u.searchParams.get('limit_start') ?? 0);
      const len = Number(u.searchParams.get('limit_page_length') ?? 500);
      const src = (doctype === 'GL Entry' ? rows : pleRows).filter((r) => since === undefined || r.modified >= since);
      return new Response(JSON.stringify({ data: src.slice(start, start + len) }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    };
    return { client: { fetchImpl: fetchImpl as unknown as typeof fetch, apiKey: 'k', apiSecret: 's', baseUrl: 'http://erp.test' }, urls };
  }

  /** Overwrite the STORED watermark in place (a concurrent tick landing mid-flight). */
  function bumpWatermark(sc: Parameters<typeof feedLedgerMirrors>[0], domain: string, cursor: string) {
    const row = h(sc).fake.rowsOf('external_sync_watermarks').find((r) => r.domain === domain);
    if (!row) throw new Error(`no watermark row for ${domain}`);
    row.watermark_cursor = cursor;
  }

  it('ordered pages: a multi-page backfill advances the watermark to the LAST row\'s modified, and every page request carries the stable order', async () => {
    const sc = fakeServiceClient();
    const erp = fakeErp(glSource(5));
    const res = await feedLedgerMirrors(sc, { client: erp.client, orgId: 'org-1', company: 'PMO Smoke Co', pageSize: 2 });
    const glUrls = erp.urls.filter((u) => u.includes('/api/resource/GL%20Entry'));
    expect(glUrls).toHaveLength(3); // 5 rows / pageSize 2
    for (const u of glUrls) expect(new URL(u).searchParams.get('order_by')).toBe('modified asc, name asc');
    expect(res.glFed).toBe(5);
    expect(res.glCaughtUp).toBe(true);
    // Pages arrive `modified asc`, so the advanced watermark IS the last row read — never a mid-page value.
    expect(h(sc).watermarks.get(`erpnext::${LEDGER_GL_WM_DOMAIN}`)).toBe('2026-10-07 10:04:00.000000');
  });

  it('per-tick page budget: tick 1 stops at the budget and advances the watermark; later ticks resume (each bounded); the union is the FULL set with nothing skipped', async () => {
    const sc = fakeServiceClient();
    const erp = fakeErp(glSource(8)); // 4 full pages at pageSize 2 — more than one tick's budget of 2

    const tick1 = await feedLedgerMirrors(sc, { client: erp.client, orgId: 'org-1', company: 'PMO Smoke Co', pageSize: 2, maxPages: 2 });
    expect(tick1.glFed).toBe(4);
    expect(tick1.glCaughtUp).toBe(false); // the budget, not a short page, stopped the fetch
    expect(tick1.glCursor).toBe('2026-10-07 10:03:00.000000'); // max modified READ (the last row of page 2)
    expect(h(sc).watermarks.get(`erpnext::${LEDGER_GL_WM_DOMAIN}`)).toBe('2026-10-07 10:03:00.000000');
    const after1 = Array.from(h(sc).gl.keys()).sort();
    expect(after1).toEqual(['GLE-0', 'GLE-1', 'GLE-2', 'GLE-3']);

    // Tick 2 resumes from the watermark. The inclusive `>=` cursor re-delivers the boundary row
    // (GLE-3, idempotent re-apply) and carries on past it.
    // The budget binds EVERY tick, not only the first activation: a long-frozen cursor catches up in steps.
    const tick2 = await feedLedgerMirrors(sc, { client: erp.client, orgId: 'org-1', company: 'PMO Smoke Co', pageSize: 2, maxPages: 2 });
    expect(tick2.glCaughtUp).toBe(false);
    expect(tick2.glFed).toBe(4); // the re-delivered boundary GLE-3 + GLE-4..6
    expect(tick2.glCursor).toBe('2026-10-07 10:06:00.000000');
    const tick3 = await feedLedgerMirrors(sc, { client: erp.client, orgId: 'org-1', company: 'PMO Smoke Co', pageSize: 2, maxPages: 2 });
    expect(tick3.glCaughtUp).toBe(true);
    expect(tick3.glCursor).toBe('2026-10-07 10:07:00.000000');
    // UNION across the ticks = the full source, NOTHING skipped, NO duplicates:
    expect(Array.from(h(sc).gl.keys()).sort()).toEqual(['GLE-0', 'GLE-1', 'GLE-2', 'GLE-3', 'GLE-4', 'GLE-5', 'GLE-6', 'GLE-7']);
  });

  it('overlapping ticks: a watermark write that is OLDER than the stored cursor leaves the stored value unchanged (never rewinds)', async () => {
    const sc = fakeServiceClient();
    h(sc).setWatermark('erpnext', LEDGER_GL_WM_DOMAIN, '2026-07-12 10:00:00.000000');
    vi.spyOn(ledgerFetch, 'fetchGlEntries').mockImplementation(async () => {
      // A concurrent tick lands MID-FLIGHT: the stored cursor moves to 13:00 after THIS tick read 10:00.
      bumpWatermark(sc, LEDGER_GL_WM_DOMAIN, '2026-07-12 13:00:00.000000');
      return { rows: [glRow('GLE-MID', { modified: '2026-07-12 12:30:00.000000' })], caughtUp: true };
    });
    vi.spyOn(ledgerFetch, 'fetchPaymentLedgerEntries').mockResolvedValue({ rows: [], caughtUp: true });

    const res = await feedLedgerMirrors(sc, { client: { fetchImpl: fetch, apiKey: 'k', apiSecret: 's', baseUrl: 'http://erp.test' }, orgId: 'org-1', company: 'PMO Smoke Co' });

    // This tick's max (12:30) is OLDER than what the concurrent tick stored (13:00): the write must not land.
    expect(h(sc).watermarks.get(`erpnext::${LEDGER_GL_WM_DOMAIN}`)).toBe('2026-07-12 13:00:00.000000');
    expect(res.glCursor).toBe('2026-07-12 13:00:00.000000'); // the report reflects the STORED truth
  });
});

/**
 * DEFECT (2026-10-25): ERPNext's "Repost Accounting Ledger" re-creates a voucher's GL rows, and a SECOND
 * repost HARD-DELETES the first repost's rows (no Deleted Document). The mirror upserts by name, so the
 * deleted rows stayed live and the voucher's project spend was counted twice. Whenever the feed sees a
 * voucher whose mirror holds rows the fetched batch did not re-deliver, it reads ERPNext's CURRENT full
 * row set for that voucher and replaces the mirror's copy of it in one atomic RPC.
 */
describe('erpnext/ledgerMirrorFeed — a reposted voucher is replaced, never double counted', () => {
  const client = { fetchImpl: fetch, apiKey: 'k', apiSecret: 's', baseUrl: 'http://erp.test' };
  const JV = { voucher_type: 'Journal Entry', voucher_no: 'ACC-JV-2026-00070' };
  const line = { ...JV, account: '519101 - Other Direct Expenses - SYN', project: 'PROJ-0004', company: 'Synthetic Co' };

  /** Mirror state after the FIRST repost: the original (cancelled), its hash-named reversal, and the
   *  first repost's live hash-named row — the row ERPNext later hard-deletes. */
  function mirrorAfterFirstRepost() {
    return [
      { org_id: 'org-1', erp_name: 'ACC-GLE-2026-00231', ...line, project: null, debit: '241999959.00', credit: '0.00', is_cancelled: true, erp_modified: '2026-10-25 07:37:41.941175' },
      { org_id: 'org-1', erp_name: '90b076b758', ...line, debit: '0.00', credit: '241999959.00', is_cancelled: true, erp_modified: '2026-10-25 07:37:41.951217' },
      { org_id: 'org-1', erp_name: '9a24980bf8', ...line, debit: '241999959.00', credit: '0.00', is_cancelled: false, erp_modified: '2026-10-25 07:37:57.013202' },
    ];
  }
  /** ERPNext's current rows for the voucher after the SECOND repost (the 07:37 hash rows are gone). */
  const erpCurrent = [
    glRow('ACC-GLE-2026-00231', { ...line, project: null, debit: '241999959.00', is_cancelled: true, modified: '2026-10-25 07:37:41.941175' }),
    glRow('ACC-GLE-2026-01435', { ...line, credit: '241999959.00', is_cancelled: true, modified: '2026-10-25 08:32:12.248890' }),
    glRow('ACC-GLE-2026-01438', { ...line, debit: '241999959.00', is_cancelled: false, modified: '2026-10-25 08:32:12.251858' }),
  ];
  /** The incremental batch since the 07:37:57 watermark re-delivers only the second repost's rows. */
  const batch = erpCurrent.slice(1);

  function liveProjectDebit(sc: Parameters<typeof feedLedgerMirrors>[0], project: string): number {
    return Array.from(h(sc).gl.values())
      .filter((r) => r.project === project && r.is_cancelled !== true)
      .reduce((sum, r) => sum + Number(r.debit ?? 0) - Number(r.credit ?? 0), 0);
  }

  function mockGl(voucherResult: () => Promise<ledgerFetch.LedgerFetchResult<ledgerFetch.GlEntryRow>>) {
    return vi.spyOn(ledgerFetch, 'fetchGlEntries').mockImplementation(async (_c, opts) =>
      opts.voucher ? voucherResult() : { rows: batch, caughtUp: true });
  }

  it('a voucher reposted twice leaves exactly ERPNext\'s current rows in the mirror, so the project spend counts once', async () => {
    const sc = fakeServiceClient(mirrorAfterFirstRepost());
    h(sc).setWatermark('erpnext', LEDGER_GL_WM_DOMAIN, '2026-10-25 07:37:57.013202');
    const gl = mockGl(async () => ({ rows: erpCurrent, caughtUp: true }));
    vi.spyOn(ledgerFetch, 'fetchPaymentLedgerEntries').mockResolvedValue({ rows: [], caughtUp: true });

    const res = await feedLedgerMirrors(sc, { client, orgId: 'org-1', company: 'Synthetic Co' });

    expect(Array.from(h(sc).gl.keys()).sort()).toEqual(['ACC-GLE-2026-00231', 'ACC-GLE-2026-01435', 'ACC-GLE-2026-01438']);
    expect(liveProjectDebit(sc, 'PROJ-0004')).toBe(241999959);
    const voucherRead = gl.mock.calls.map(([, o]) => o).find((o) => o.voucher);
    expect(voucherRead).toMatchObject({ company: 'Synthetic Co', voucher: { type: 'Journal Entry', no: 'ACC-JV-2026-00070' } });
    expect(voucherRead?.since).toBeUndefined(); // the full current set, never the modified cursor
    expect(res.glCursor).toBe('2026-10-25 08:32:12.251858');
    expect(res.glCaughtUp).toBe(true);
  });

  it('a partial voucher fetch (page budget hit) removes nothing and does not advance the watermark', async () => {
    const sc = fakeServiceClient(mirrorAfterFirstRepost());
    h(sc).setWatermark('erpnext', LEDGER_GL_WM_DOMAIN, '2026-10-25 07:37:57.013202');
    mockGl(async () => ({ rows: erpCurrent.slice(2), caughtUp: false }));
    vi.spyOn(ledgerFetch, 'fetchPaymentLedgerEntries').mockResolvedValue({ rows: [], caughtUp: true });

    await expect(feedLedgerMirrors(sc, { client, orgId: 'org-1', company: 'Synthetic Co' })).rejects.toThrow(/incomplete/i);

    expect(Array.from(h(sc).gl.keys()).sort()).toEqual(['90b076b758', '9a24980bf8', 'ACC-GLE-2026-00231']);
    expect(h(sc).watermarks.get(`erpnext::${LEDGER_GL_WM_DOMAIN}`)).toBe('2026-10-25 07:37:57.013202');
  });

  it('a failed voucher fetch removes nothing and writes nothing', async () => {
    const sc = fakeServiceClient(mirrorAfterFirstRepost());
    h(sc).setWatermark('erpnext', LEDGER_GL_WM_DOMAIN, '2026-10-25 07:37:57.013202');
    mockGl(async () => { throw new Error('ERP timeout'); });
    vi.spyOn(ledgerFetch, 'fetchPaymentLedgerEntries').mockResolvedValue({ rows: [], caughtUp: true });

    await expect(feedLedgerMirrors(sc, { client, orgId: 'org-1', company: 'Synthetic Co' })).rejects.toThrow('ERP timeout');

    expect(Array.from(h(sc).gl.keys()).sort()).toEqual(['90b076b758', '9a24980bf8', 'ACC-GLE-2026-00231']);
    expect(h(sc).watermarks.get(`erpnext::${LEDGER_GL_WM_DOMAIN}`)).toBe('2026-10-25 07:37:57.013202');
  });

  it('an empty current set (the voucher vanished between reads) removes nothing', async () => {
    const sc = fakeServiceClient(mirrorAfterFirstRepost());
    mockGl(async () => ({ rows: [], caughtUp: true }));
    vi.spyOn(ledgerFetch, 'fetchPaymentLedgerEntries').mockResolvedValue({ rows: [], caughtUp: true });

    await feedLedgerMirrors(sc, { client, orgId: 'org-1', company: 'Synthetic Co' });

    expect(h(sc).gl.has('9a24980bf8')).toBe(true);
    expect(h(sc).fake.rpcCalls.filter((c) => c.fn === 'replace_erp_gl_voucher_rows')).toHaveLength(0);
  });

  it('a replace RPC error fails the feed before the watermark advances', async () => {
    const base = fakeServiceClient(mirrorAfterFirstRepost());
    h(base).setWatermark('erpnext', LEDGER_GL_WM_DOMAIN, '2026-10-25 07:37:57.013202');
    const sc = Object.assign(base, { rpc: vi.fn().mockResolvedValue({ data: null, error: { message: 'deadlock', code: '40P01' } }) });
    mockGl(async () => ({ rows: erpCurrent, caughtUp: true }));
    vi.spyOn(ledgerFetch, 'fetchPaymentLedgerEntries').mockResolvedValue({ rows: [], caughtUp: true });

    await expect(feedLedgerMirrors(sc as never, { client, orgId: 'org-1', company: 'Synthetic Co' })).rejects.toThrow('deadlock');
    expect(h(base).watermarks.get(`erpnext::${LEDGER_GL_WM_DOMAIN}`)).toBe('2026-10-25 07:37:57.013202');
  });

  it('a stale-binding refusal from the replace RPC fails the feed', async () => {
    const base = fakeServiceClient(mirrorAfterFirstRepost());
    const sc = Object.assign(base, { rpc: vi.fn().mockResolvedValue({ data: { stale_binding: true }, error: null }) });
    mockGl(async () => ({ rows: erpCurrent, caughtUp: true }));
    vi.spyOn(ledgerFetch, 'fetchPaymentLedgerEntries').mockResolvedValue({ rows: [], caughtUp: true });

    await expect(feedLedgerMirrors(sc as never, { client, orgId: 'org-1', company: 'Synthetic Co' })).rejects.toThrow(/stale binding/i);
  });

  it('a batch whose vouchers hold no unseen mirror rows costs no extra ERP read', async () => {
    const sc = fakeServiceClient();
    const gl = vi.spyOn(ledgerFetch, 'fetchGlEntries').mockResolvedValue({ rows: batch, caughtUp: true });
    vi.spyOn(ledgerFetch, 'fetchPaymentLedgerEntries').mockResolvedValue({ rows: [], caughtUp: true });

    const res = await feedLedgerMirrors(sc, { client, orgId: 'org-1', company: 'Synthetic Co' });

    expect(gl).toHaveBeenCalledTimes(1);
    expect(res.glFed).toBe(2);
  });

  it('only this company\'s mirror rows make a voucher a candidate', async () => {
    const other = mirrorAfterFirstRepost().map((r) => ({ ...r, company: 'Other Co' }));
    const sc = fakeServiceClient(other);
    const gl = vi.spyOn(ledgerFetch, 'fetchGlEntries').mockResolvedValue({ rows: batch, caughtUp: true });
    vi.spyOn(ledgerFetch, 'fetchPaymentLedgerEntries').mockResolvedValue({ rows: [], caughtUp: true });

    await feedLedgerMirrors(sc, { client, orgId: 'org-1', company: 'Synthetic Co' });

    expect(gl).toHaveBeenCalledTimes(1);
  });

  it('PLE: a reposted voucher\'s hard-deleted payment-ledger rows stop counting', async () => {
    const PI = { voucher_type: 'Purchase Invoice', voucher_no: 'ACC-PINV-2026-00006' };
    const sc = fakeServiceClient([], [
      { org_id: 'org-1', erp_name: 'ple-old', ...PI, account: 'Creditors - SYN', amount: '5811783.49', delinked: false, erp_modified: '2026-10-25 07:00:00.000000' },
    ]);
    const current = [pleRow('ple-new', { ...PI, amount: '5811783.49', modified: '2026-10-25 11:52:16.308551' })];
    vi.spyOn(ledgerFetch, 'fetchGlEntries').mockResolvedValue({ rows: [], caughtUp: true });
    const ple = vi.spyOn(ledgerFetch, 'fetchPaymentLedgerEntries').mockResolvedValue({ rows: current, caughtUp: true });

    await feedLedgerMirrors(sc, { client, orgId: 'org-1', company: 'Synthetic Co' });

    expect(Array.from(h(sc).ple.keys())).toEqual(['ple-new']);
    expect(h(sc).ple.get('ple-new')).toMatchObject({ voucher_type: 'Purchase Invoice', voucher_no: 'ACC-PINV-2026-00006' });
    expect(ple).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ voucher: { type: 'Purchase Invoice', no: 'ACC-PINV-2026-00006' } }));
  });
});

/**
 * The one-off repair (0382). A per-source repair marker (`<domain>::repair`) re-reads from its cursor
 * once, independently of the ordinary cursor — so an old-code tick that runs between the DB and the
 * edge-function deploy cannot consume the repair (old code never reads the marker).
 */
describe('erpnext/ledgerMirrorFeed — the one-off repair re-read', () => {
  const client = { fetchImpl: fetch, apiKey: 'k', apiSecret: 's', baseUrl: 'http://erp.test' };
  const GL_REPAIR = `${LEDGER_GL_WM_DOMAIN}::repair`;
  const PLE_REPAIR = `${LEDGER_PLE_WM_DOMAIN}::repair`;

  it('reads from the repair marker, keeps the ordinary cursor monotonic, and clears the marker once caught up', async () => {
    const sc = fakeServiceClient();
    h(sc).setWatermark('erpnext', LEDGER_GL_WM_DOMAIN, '2026-10-25 11:52:16.353591');
    h(sc).setWatermark('erpnext', GL_REPAIR, '2026-10-24 00:00:00');
    h(sc).setWatermark('erpnext', LEDGER_PLE_WM_DOMAIN, '2026-10-25 11:52:16.308551');
    h(sc).setWatermark('erpnext', PLE_REPAIR, '2000-01-01 00:00:00');
    const gl = vi.spyOn(ledgerFetch, 'fetchGlEntries').mockResolvedValue({ rows: [glRow('G1', { modified: '2026-10-25 08:32:12.251858' })], caughtUp: true });
    const ple = vi.spyOn(ledgerFetch, 'fetchPaymentLedgerEntries').mockResolvedValue({ rows: [], caughtUp: true });

    const res = await feedLedgerMirrors(sc, { client, orgId: 'org-1', company: 'Synthetic Co' });

    expect(gl.mock.calls[0][1].since).toBe('2026-10-24 00:00:00');
    expect(ple.mock.calls[0][1].since).toBe('2000-01-01 00:00:00');
    expect(res.glCursor).toBe('2026-10-25 11:52:16.353591'); // never rewound
    expect(h(sc).watermarks.has(`erpnext::${GL_REPAIR}`)).toBe(false);
    expect(h(sc).watermarks.has(`erpnext::${PLE_REPAIR}`)).toBe(false);
  });

  it('a repair that hits the page budget advances its marker and resumes next tick', async () => {
    const sc = fakeServiceClient();
    h(sc).setWatermark('erpnext', LEDGER_GL_WM_DOMAIN, '2026-10-25 11:52:16.353591');
    h(sc).setWatermark('erpnext', GL_REPAIR, '2026-10-24 00:00:00');
    vi.spyOn(ledgerFetch, 'fetchGlEntries').mockResolvedValue({ rows: [glRow('G1', { modified: '2026-10-24 09:00:00' })], caughtUp: false });
    vi.spyOn(ledgerFetch, 'fetchPaymentLedgerEntries').mockResolvedValue({ rows: [], caughtUp: true });

    await feedLedgerMirrors(sc, { client, orgId: 'org-1', company: 'Synthetic Co' });

    expect(h(sc).watermarks.get(`erpnext::${GL_REPAIR}`)).toBe('2026-10-24 09:00:00');
    expect(h(sc).watermarks.get(`erpnext::${LEDGER_GL_WM_DOMAIN}`)).toBe('2026-10-25 11:52:16.353591');
  });

  it('a failed repair tick keeps the marker', async () => {
    const sc = fakeServiceClient();
    h(sc).setWatermark('erpnext', GL_REPAIR, '2026-10-24 00:00:00');
    vi.spyOn(ledgerFetch, 'fetchGlEntries').mockRejectedValue(new Error('ERP down'));

    await expect(feedLedgerMirrors(sc, { client, orgId: 'org-1', company: 'Synthetic Co' })).rejects.toThrow('ERP down');
    expect(h(sc).watermarks.get(`erpnext::${GL_REPAIR}`)).toBe('2026-10-24 00:00:00');
  });

  it('a marker NEWER than the ordinary cursor is ignored (the cursor already covers it) and cleared', async () => {
    const sc = fakeServiceClient();
    h(sc).setWatermark('erpnext', LEDGER_GL_WM_DOMAIN, '2026-10-20 00:00:00');
    h(sc).setWatermark('erpnext', GL_REPAIR, '2026-10-24 00:00:00');
    const gl = vi.spyOn(ledgerFetch, 'fetchGlEntries').mockResolvedValue({ rows: [], caughtUp: true });
    vi.spyOn(ledgerFetch, 'fetchPaymentLedgerEntries').mockResolvedValue({ rows: [], caughtUp: true });

    await feedLedgerMirrors(sc, { client, orgId: 'org-1', company: 'Synthetic Co' });

    expect(gl.mock.calls[0][1].since).toBe('2026-10-20 00:00:00');
    expect(h(sc).watermarks.has(`erpnext::${GL_REPAIR}`)).toBe(false);
  });
});

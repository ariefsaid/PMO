/**
 * erpnext/ledgerFetch.ts (task 7.2): the confined ERP ledger fetchers — the source the slice-8 sweep
 * feed reads to populate erp_gl_entry_mirror / erp_payment_ledger_mirror. All Frappe vocabulary
 * (doctype names, list-endpoint filter/field shapes) stays HERE in erpnext/**. Every ERP call is an
 * injected `fetchImpl` — no real bench required (NFR-ENA-CONTRACT-001).
 *
 * Asserts: paging accumulates all rows; ONLY the scope filters (modified>=since / company=<co>) + the
 * field list are sent — never a cancellation filter (#901: a row that leaves the fetched set on cancel
 * can never be re-read, so its mirror copy stays live); the cancellation state crosses as a flag;
 * money fields are decimal-strings (R4); and nothing is persisted here (pure fetch — the feed's
 * job is 8.x, so the fetcher takes ONLY the client + opts and returns rows).
 */
import { describe, expect, it, vi } from 'vitest';
import { fetchGlEntries, fetchPaymentLedgerEntries } from './ledgerFetch.ts';
import { AppError } from '../../appError.ts';
import type { ErpClientDeps } from './client.ts';

function client(fetchImpl: (url: string, init?: RequestInit) => Promise<Response>): ErpClientDeps {
  return { fetchImpl: vi.fn(fetchImpl) as unknown as typeof fetch, apiKey: 'k', apiSecret: 's', baseUrl: 'https://erp.example.com' };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

describe('erpnext/ledgerFetch — fetchGlEntries', () => {
  it('OD-INT-6 throws config-rejected when company is missing (null)', async () => {
    const fetchImpl = async () => jsonResponse({ data: [] });
    await expect(
      fetchGlEntries(client(fetchImpl), { company: null as unknown as string })
    ).rejects.toThrow(AppError);
    await expect(
      fetchGlEntries(client(fetchImpl), { company: null as unknown as string })
    ).rejects.toHaveProperty('code', 'config-rejected');
  });

  it('OD-INT-6 throws config-rejected when company is empty string', async () => {
    const fetchImpl = async () => jsonResponse({ data: [] });
    await expect(
      fetchGlEntries(client(fetchImpl), { company: '' })
    ).rejects.toThrow(AppError);
    await expect(
      fetchGlEntries(client(fetchImpl), { company: '' })
    ).rejects.toHaveProperty('code', 'config-rejected');
  });

  it('OD-INT-6 throws config-rejected when company is undefined', async () => {
    const fetchImpl = async () => jsonResponse({ data: [] });
    await expect(
      fetchGlEntries(client(fetchImpl), { company: undefined as unknown as string })
    ).rejects.toThrow(AppError);
    await expect(
      fetchGlEntries(client(fetchImpl), { company: undefined as unknown as string })
    ).rejects.toHaveProperty('code', 'config-rejected');
  });

  it('AC-ENA-060/162 #901 sends ONLY the scope filters (company, modified>=since) — never a cancellation filter — + the field list on page 0', async () => {
    const urls: string[] = [];
    const fetchImpl = async (url: string) => {
      urls.push(url);
      // Short first page (1 row, < pageSize) → single request.
      return jsonResponse({ data: [{ name: 'GLE-1', account: 'Creditors - PSC', debit: '50000.0', credit: '0', modified: '2026-07-12 12:00:00', is_cancelled: 0, docstatus: 1 }] });
    };
    const { rows } = await fetchGlEntries(client(fetchImpl), { company: 'PMO Smoke Co', since: '2026-07-01 00:00:00' });
    expect(urls).toHaveLength(1);
    expect(urls[0]).toContain('/api/resource/GL%20Entry'); // doctype confined here (raw, encoded path)
    const params = new URL(urls[0]).searchParams;
    // #901 fix round (High-1): a STABLE page order on every request — without it, ties on `modified`
    // or concurrent ERP edits let one page repeat and another be SKIPPED, and a skipped row older than
    // the advanced `modified >=` cursor is excluded forever.
    expect(params.get('order_by')).toBe('modified asc, name asc');
    // #901: a cancel flips the ORIGINAL rows to is_cancelled=1 (bumping `modified`). A fetch that filters
    // on cancellation never re-reads them, so the mirror keeps them live and actuals overstate.
    expect(JSON.parse(params.get('filters') ?? '')).toEqual([
      ['company', '=', 'PMO Smoke Co'],
      ['modified', '>=', '2026-07-01 00:00:00'],
    ]);
    const fields = JSON.parse(params.get('fields') ?? '') as string[];
    // the field list requests the money + provenance + cancellation-state fields the mirror consumes
    expect(fields).toEqual(expect.arrayContaining(['name', 'company', 'account', 'cost_center', 'debit', 'credit', 'posting_date', 'is_cancelled', 'is_opening', 'finance_book', 'docstatus', 'modified']));
    expect(rows).toHaveLength(1);
    expect(rows[0].is_cancelled).toBe(false);
  });

  it('#901 a cancelled original AND its reversal come back flagged is_cancelled (never dropped at fetch)', async () => {
    const fetchImpl = async () => jsonResponse({ data: [
      { name: 'GLE-ORIG', account: 'Cost of Goods Sold - PSC', debit: '125000', credit: '0', modified: '2026-10-07 10:05:00', is_cancelled: 1, docstatus: 1 },
      { name: 'GLE-REV', account: 'Cost of Goods Sold - PSC', debit: '0', credit: '125000', modified: '2026-10-07 10:05:00', is_cancelled: 1, docstatus: 1 },
      { name: 'GLE-LIVE', account: 'Cost of Goods Sold - PSC', debit: '7', credit: '0', modified: '2026-10-07 10:06:00', is_cancelled: 0, docstatus: 1 },
    ] });
    const { rows } = await fetchGlEntries(client(fetchImpl), { company: 'PMO Smoke Co', since: '2026-10-07 10:00:00' });
    expect(rows.map((r) => [r.name, r.is_cancelled])).toEqual([['GLE-ORIG', true], ['GLE-REV', true], ['GLE-LIVE', false]]);
  });

  it('#901 a GL row in docstatus 2 crosses as cancelled (the old fetch excluded it; it must never read as live)', async () => {
    const fetchImpl = async () => jsonResponse({ data: [
      { name: 'GLE-D2', account: 'A', debit: '1', credit: '0', modified: '2026-10-07', is_cancelled: 0, docstatus: 2 },
    ] });
    const { rows } = await fetchGlEntries(client(fetchImpl), { company: 'PMO Smoke Co' });
    expect(rows[0]).toMatchObject({ name: 'GLE-D2', is_cancelled: true, docstatus: 2 });
  });

  it('AC-001: preserves raw JSON numeric tokens at full GL precision before Number conversion', async () => {
    const raw = '{"data":[{"name":"GL-DECIMAL","company":"Synthetic Co","account":"Cash","debit":0.123456789,"credit":12345678901234567890.123456789,"modified":"2026-01-01"}]}';
    const fetchImpl = async () => new Response(raw, { status: 200, headers: { 'Content-Type': 'application/json' } });
    const { rows } = await fetchGlEntries(client(fetchImpl), { company: 'Synthetic Co' });
    expect(rows[0].debit).toBe('0.123456789');
    expect(rows[0].credit).toBe('12345678901234567890.123456789');
  });

  it('AC-001: captures explicit company, opening and finance-book fields without defaults for unknown values', async () => {
    const fetchImpl = async () => jsonResponse({ data: [
      { name: 'GL-1', company: 'Synthetic Co', account: 'Cash', debit: '0.123456789', credit: '0', is_opening: 'Yes', finance_book: 'Accrual', modified: '2026-01-01' },
      { name: 'GL-2', company: 'Synthetic Co', account: 'Cash', debit: '0', credit: '0', is_opening: 'Unknown', finance_book: null, modified: '2026-01-01' },
    ] });
    const { rows } = await fetchGlEntries(client(fetchImpl), { company: 'Synthetic Co' });
    expect(rows).toMatchObject([
      { company: 'Synthetic Co', is_opening: 'Yes', finance_book: 'Accrual', debit: '0.123456789' },
      { company: 'Synthetic Co', is_opening: null, finance_book: null },
    ]);
  });

  it('a full backfill (no since) sends only the company filter', async () => {
    const urls: string[] = [];
    const fetchImpl = async (url: string) => { urls.push(url); return jsonResponse({ data: [] }); };
    await fetchGlEntries(client(fetchImpl), { company: 'PMO Smoke Co' });
    expect(JSON.parse(new URL(urls[0]).searchParams.get('filters') ?? '')).toEqual([['company', '=', 'PMO Smoke Co']]);
  });

  it('paging accumulates ALL rows across pages (a full page 0 → a page-1 request with limit_start=pageSize → a short page stops the loop), and EVERY page request carries the stable order', async () => {
    const urls: string[] = [];
    const fullPage = Array.from({ length: 2 }, (_, i) => ({ name: `GLE-${i}`, account: 'A', debit: '1.0', credit: '0', modified: '2026-07-12 00:00:0' + i, is_cancelled: 0, docstatus: 1 }));
    const shortPage = [{ name: 'GLE-2', account: 'A', debit: '3.0', credit: '0', modified: '2026-07-12 00:00:02', is_cancelled: 0, docstatus: 1 }];
    const fetchImpl = async (url: string) => {
      urls.push(url);
      return jsonResponse({ data: url.includes('limit_start=0') || !url.includes('limit_start=') ? fullPage : shortPage });
    };
    // page 0 returns exactly pageSize (2) → must request page 1; page 1 returns 1 (< pageSize) → stop.
    const { rows, caughtUp } = await fetchGlEntries(client(fetchImpl), { company: 'PMO Smoke Co', since: '2026-07-01', pageSize: 2 });
    expect(urls).toHaveLength(2);
    expect(decodeURIComponent(urls[0])).toContain('limit_start=0');
    expect(decodeURIComponent(urls[1])).toContain('limit_start=2');
    // #901 fix round (High-1): the stable `modified asc, name asc` order rides on EVERY page request
    // (URL-encoded Frappe order_by) — page N+1 is defined relative to page N only if the order is total.
    for (const u of urls) expect(new URL(u).searchParams.get('order_by')).toBe('modified asc, name asc');
    expect(rows).toHaveLength(3); // 2 + 1 — ALL rows accumulated
    expect(rows.map((r) => r.name)).toEqual(['GLE-0', 'GLE-1', 'GLE-2']);
    expect(caughtUp).toBe(true); // the short page (not the budget) ended the fetch
  });

  it('#901 fix round (High-2) the per-tick page budget stops a full-page source: what was read is returned, caughtUp=false, and NO further page is requested', async () => {
    const urls: string[] = [];
    // 3 full pages' worth of rows at pageSize 2 — more than one tick's budget of 2 pages.
    const rowsSource = Array.from({ length: 6 }, (_, i) => ({ name: `GLE-${i}`, account: 'A', debit: '1.0', credit: '0', modified: `2026-07-12 00:00:${String(i).padStart(2, '0')}`, is_cancelled: 0, docstatus: 1 }));
    const fetchImpl = async (url: string) => {
      urls.push(url);
      const start = Number(new URL(url).searchParams.get('limit_start') ?? 0);
      return jsonResponse({ data: rowsSource.slice(start, start + 2) });
    };
    const { rows, caughtUp } = await fetchGlEntries(client(fetchImpl), { company: 'PMO Smoke Co', pageSize: 2, maxPages: 2 });
    expect(urls).toHaveLength(2); // the budget, not a short page, ended the fetch
    expect(rows.map((r) => r.name)).toEqual(['GLE-0', 'GLE-1', 'GLE-2', 'GLE-3']);
    expect(caughtUp).toBe(false); // the source was NOT drained — resume from the watermark next tick
  });

  it('money fields are returned as decimal-strings (R4) — a Frappe number is coerced, null stays null', async () => {
    const fetchImpl = async () =>
      jsonResponse({
        data: [
          { name: 'GLE-1', account: 'A', debit: 50000, credit: '0.00', modified: '2026-07-12', is_cancelled: 0, docstatus: 1 },
          { name: 'GLE-2', account: 'A', debit: null, credit: null, modified: '2026-07-12', is_cancelled: 0, docstatus: 1 },
        ],
      });
    const { rows } = await fetchGlEntries(client(fetchImpl), { company: 'PMO Smoke Co' });
    expect(rows[0].debit).toBe('50000'); // number coerced to decimal-string
    expect(rows[0].credit).toBe('0.00');
    expect(rows[1].debit).toBeNull();
    expect(rows[1].credit).toBeNull();
  });

  it('is pure fetch — NEVER persists (the function signature takes ONLY the client + opts; slice 8 owns the mirror feed)', async () => {
    // Structural: fetchGlEntries has no service-client / DB param — persistence is 8.x's job.
    const fetchImpl = async () => jsonResponse({ data: [] });
    const { rows, caughtUp } = await fetchGlEntries(client(fetchImpl), { company: 'PMO Smoke Co', since: '2026-07-01' });
    expect(rows).toEqual([]);
    expect(caughtUp).toBe(true); // an empty page IS the drained source
  });
});

describe('erpnext/ledgerFetch — fetchPaymentLedgerEntries', () => {
  it('AC-ENA-162 #901 fetches Payment Ledger Entry with ONLY company + modified>=since (no cancellation filter) and returns decimal-string amounts', async () => {
    const urls: string[] = [];
    const fetchImpl = async (url: string) => {
      urls.push(url);
      return jsonResponse({ data: [{ name: 'PLE-1', account: 'Creditors - PSC', amount: '-75000.0', modified: '2026-07-12 11:36:00', docstatus: 1, delinked: 0 }] });
    };
    const { rows } = await fetchPaymentLedgerEntries(client(fetchImpl), { company: 'PMO Smoke Co', since: '2026-07-01 00:00:00' });
    expect(urls).toHaveLength(1);
    expect(urls[0]).toContain('/api/resource/Payment%20Ledger%20Entry'); // doctype confined here
    const params = new URL(urls[0]).searchParams;
    expect(params.get('order_by')).toBe('modified asc, name asc'); // #901 fix round (High-1)
    expect(JSON.parse(params.get('filters') ?? '')).toEqual([
      ['company', '=', 'PMO Smoke Co'],
      ['modified', '>=', '2026-07-01 00:00:00'],
    ]);
    expect(JSON.parse(params.get('fields') ?? '')).toEqual(expect.arrayContaining(['delinked', 'docstatus', 'modified', 'amount']));
    expect(rows[0].amount).toBe('-75000.0'); // decimal-string preserved (the aging fallback's signed amount)
    expect(rows[0].delinked).toBe(false);
  });

  it('#901 a delinked PLE (cancel / unreconcile — docstatus stays 1) crosses as delinked; docstatus 2 also reads delinked', async () => {
    const fetchImpl = async () => jsonResponse({ data: [
      { name: 'PLE-ORIG', account: 'Creditors - PSC', amount: '125000', modified: '2026-10-07 10:05:00', docstatus: 1, delinked: 1 },
      { name: 'PLE-REV', account: 'Creditors - PSC', amount: '-125000', modified: '2026-10-07 10:05:00', docstatus: 1, delinked: 1 },
      { name: 'PLE-D2', account: 'Creditors - PSC', amount: '9', modified: '2026-10-07 10:05:00', docstatus: 2, delinked: 0 },
      { name: 'PLE-LIVE', account: 'Creditors - PSC', amount: '5', modified: '2026-10-07 10:06:00', docstatus: 1, delinked: 0 },
    ] });
    const { rows } = await fetchPaymentLedgerEntries(client(fetchImpl), { company: 'PMO Smoke Co' });
    expect(rows.map((r) => [r.name, r.delinked])).toEqual([['PLE-ORIG', true], ['PLE-REV', true], ['PLE-D2', true], ['PLE-LIVE', false]]);
  });

  it('paging accumulates Payment Ledger Entry rows across pages, carrying the stable order on EVERY page request', async () => {
    const urls: string[] = [];
    const full = Array.from({ length: 2 }, (_, i) => ({ name: `PLE-${i}`, account: 'A', amount: '1.0', modified: '2026-07-12 00:00:0' + i, docstatus: 1 }));
    const short = [{ name: 'PLE-2', account: 'A', amount: '3.0', modified: '2026-07-12 00:00:02', docstatus: 1 }];
    const fetchImpl = async (url: string) => {
      urls.push(url);
      return jsonResponse({ data: url.includes('limit_start=0') || !url.includes('limit_start=') ? full : short });
    };
    const { rows } = await fetchPaymentLedgerEntries(client(fetchImpl), { company: 'PMO Smoke Co', pageSize: 2 });
    expect(rows).toHaveLength(3);
    for (const u of urls) expect(new URL(u).searchParams.get('order_by')).toBe('modified asc, name asc');
  });
});

// T1a: these cases use the shipped client with real Response bytes. A successful-but-invalid
// list body must not become a caught-up prefix that the ledger mirror feed can publish.
const ledgerSourceCases: Array<{
  name: string;
  fetch: (
    deps: ErpClientDeps,
    opts: { company: string; pageSize?: number; maxPages?: number },
  ) => Promise<{ rows: Array<{ name: string; account: string; modified: string }>; caughtUp: boolean }>;
  row: (name: string) => Record<string, unknown>;
}> = [
  {
    name: 'GL',
    fetch: fetchGlEntries,
    row: (name) => ({ name, account: 'Cash', modified: '2026-01-01' }),
  },
  {
    name: 'PLE',
    fetch: fetchPaymentLedgerEntries,
    row: (name) => ({ name, account: 'Creditors', modified: '2026-01-01' }),
  },
];

const malformedLedgerEnvelopes: Array<[string, string]> = [
  ['empty body', ''],
  ['truncated JSON', '{"data":[]'],
  ['null root', 'null'],
  ['missing data', '{}'],
  ['null data', '{"data":null}'],
  ['object data', '{"data":{}}'],
  ['scalar root', '17'],
  ['array root', '[]'],
  ['native exc_type envelope with empty data', '{"exc_type":"DoesNotExistError","data":[]}'],
  ['native exception envelope with empty data', '{"exception":"server traceback","data":[]}'],
  ['native exc envelope with empty data', '{"exc":"server traceback","data":[]}'],
];

function rawLedgerResponse(raw: string): Response {
  return new Response(raw, { status: 200, headers: { 'Content-Type': 'application/json' } });
}

describe('erpnext/ledgerFetch — T1a real-response source boundary', () => {
  for (const source of ledgerSourceCases) {
    describe(`${source.name} list response`, () => {
      it.each(malformedLedgerEnvelopes)('rejects %s as external-unreachable', async (_label, raw) => {
        const fetchImpl = vi.fn(async () => rawLedgerResponse(raw));
        await expect(source.fetch(client(fetchImpl), { company: 'Synthetic Co' })).rejects.toMatchObject({
          name: 'AppError',
          code: 'external-unreachable',
          message: 'ERPNext ledger response was malformed',
        });
        expect(fetchImpl).toHaveBeenCalledTimes(1);
      });

      const malformedRows: Array<[string, unknown]> = [
        ['null row', null],
        ['scalar row', 'not-a-record'],
        ['array row', ['not-a-record']],
        ['missing name', { account: 'Cash', modified: '2026-01-01' }],
        ['nonstring name', { name: 7, account: 'Cash', modified: '2026-01-01' }],
        ['empty name', { name: '', account: 'Cash', modified: '2026-01-01' }],
        ['missing account', { name: 'ROW-1', modified: '2026-01-01' }],
        ['nonstring account', { name: 'ROW-1', account: 7, modified: '2026-01-01' }],
        ['empty account', { name: 'ROW-1', account: '', modified: '2026-01-01' }],
        ['missing modified', { name: 'ROW-1', account: 'Cash' }],
        ['nonstring modified', { name: 'ROW-1', account: 'Cash', modified: 7 }],
        ['empty modified', { name: 'ROW-1', account: 'Cash', modified: '' }],
      ];

      it.each(malformedRows)('rejects a %s before normalization', async (_label, row) => {
        const fetchImpl = vi.fn(async () => rawLedgerResponse(JSON.stringify({ data: [row] })));
        await expect(source.fetch(client(fetchImpl), { company: 'Synthetic Co' })).rejects.toMatchObject({
          name: 'AppError',
          code: 'external-unreachable',
          message: 'ERPNext ledger response was malformed',
        });
        expect(fetchImpl).toHaveBeenCalledTimes(1);
      });

      it('rejects a malformed later page instead of returning a valid prefix', async () => {
        const fetchImpl = vi.fn(async (url: string) => {
          const start = Number(new URL(url).searchParams.get('limit_start') ?? 0);
          return start === 0
            ? rawLedgerResponse(JSON.stringify({ data: [source.row('ROW-1'), source.row('ROW-2')] }))
            : rawLedgerResponse('{"data":[');
        });
        await expect(source.fetch(client(fetchImpl), { company: 'Synthetic Co', pageSize: 2 })).rejects.toMatchObject({
          name: 'AppError',
          code: 'external-unreachable',
          message: 'ERPNext ledger response was malformed',
        });
        expect(fetchImpl).toHaveBeenCalledTimes(2);
      });

      it('accepts an explicit empty data array as caught up', async () => {
        const fetchImpl = vi.fn(async () => rawLedgerResponse('{"data":[]}'));
        await expect(source.fetch(client(fetchImpl), { company: 'Synthetic Co' })).resolves.toMatchObject({ rows: [], caughtUp: true });
        expect(fetchImpl).toHaveBeenCalledTimes(1);
      });

      it('accepts a validated short page as caught up', async () => {
        const fetchImpl = vi.fn(async () => rawLedgerResponse(JSON.stringify({ data: [source.row('ROW-1')] })));
        await expect(source.fetch(client(fetchImpl), { company: 'Synthetic Co', pageSize: 2 })).resolves.toMatchObject({
          rows: [{ name: 'ROW-1', account: expect.any(String), modified: expect.any(String) }],
          caughtUp: true,
        });
        expect(fetchImpl).toHaveBeenCalledTimes(1);
      });

      it('reads an explicit empty page after exact-multiple full pages', async () => {
        const fetchImpl = vi.fn(async (url: string) => {
          const start = Number(new URL(url).searchParams.get('limit_start') ?? 0);
          if (start === 0) return rawLedgerResponse(JSON.stringify({ data: [source.row('ROW-1'), source.row('ROW-2')] }));
          if (start === 2) return rawLedgerResponse(JSON.stringify({ data: [source.row('ROW-3'), source.row('ROW-4')] }));
          return rawLedgerResponse('{"data":[]}');
        });
        const result = await source.fetch(client(fetchImpl), { company: 'Synthetic Co', pageSize: 2 });
        expect(result).toMatchObject({ rows: [
          { name: 'ROW-1' }, { name: 'ROW-2' }, { name: 'ROW-3' }, { name: 'ROW-4' },
        ], caughtUp: true });
        expect(fetchImpl).toHaveBeenCalledTimes(3);
      });

      it('rejects a response page larger than the requested page size', async () => {
        const fetchImpl = vi.fn(async () => rawLedgerResponse(JSON.stringify({
          data: [source.row('ROW-1'), source.row('ROW-2'), source.row('ROW-3')],
        })));
        await expect(source.fetch(client(fetchImpl), { company: 'Synthetic Co', pageSize: 2 })).rejects.toMatchObject({
          name: 'AppError',
          code: 'external-unreachable',
          message: 'ERPNext ledger response was malformed',
        });
        expect(fetchImpl).toHaveBeenCalledTimes(1);
      });

      it('keeps a full final page at the page budget incomplete without another request', async () => {
        const fetchImpl = vi.fn(async () => rawLedgerResponse(JSON.stringify({
          data: [source.row('ROW-1'), source.row('ROW-2')],
        })));
        await expect(source.fetch(client(fetchImpl), { company: 'Synthetic Co', pageSize: 2, maxPages: 2 })).resolves.toMatchObject({
          rows: [{ name: 'ROW-1' }, { name: 'ROW-2' }, { name: 'ROW-1' }, { name: 'ROW-2' }],
          caughtUp: false,
        });
        expect(fetchImpl).toHaveBeenCalledTimes(2);
      });

      it.each([
        ['pageSize zero', { pageSize: 0 }],
        ['pageSize negative', { pageSize: -1 }],
        ['pageSize fractional', { pageSize: 1.5 }],
        ['pageSize NaN', { pageSize: Number.NaN }],
        ['pageSize infinity', { pageSize: Number.POSITIVE_INFINITY }],
        ['pageSize unsafe integer', { pageSize: Number.MAX_SAFE_INTEGER + 1 }],
        ['maxPages zero', { maxPages: 0 }],
        ['maxPages negative', { maxPages: -1 }],
        ['maxPages fractional', { maxPages: 1.5 }],
        ['maxPages NaN', { maxPages: Number.NaN }],
        ['maxPages infinity', { maxPages: Number.POSITIVE_INFINITY }],
        ['maxPages unsafe integer', { maxPages: Number.MAX_SAFE_INTEGER + 1 }],
      ])('rejects invalid configuration (%s) before making a request', async (_label, override) => {
        const fetchImpl = vi.fn(async () => rawLedgerResponse('{"data":[]}'));
        await expect(source.fetch(client(fetchImpl), { company: 'Synthetic Co', ...override })).rejects.toMatchObject({
          name: 'AppError',
          code: 'config-rejected',
        });
        expect(fetchImpl).not.toHaveBeenCalled();
      });
    });
  }

  it('does not mutate mirror or watermark state or finish a full replay after a real GL page is followed by malformed JSON', async () => {
    const [{ feedLedgerMirrors }, { FakePostgrest }] = await Promise.all([
      import('./ledgerMirrorFeed.ts'),
      import('@/test/postgrestFake.ts'),
    ]);
    const initialTables = {
      erp_gl_entry_mirror: [{ id: 'gl-existing', org_id: 'org-1', erp_name: 'GL-EXISTING', erp_modified: '2026-01-01' }],
      erp_payment_ledger_mirror: [{ id: 'ple-existing', org_id: 'org-1', erp_name: 'PLE-EXISTING', erp_modified: '2026-01-01' }],
      external_sync_watermarks: [
        { id: 'wm-gl', org_id: 'org-1', external_tier: 'erpnext', domain: 'ledger::GL Entry', watermark_cursor: '2026-01-01' },
        { id: 'wm-ple', org_id: 'org-1', external_tier: 'erpnext', domain: 'ledger::Payment Ledger Entry', watermark_cursor: '2026-01-01' },
      ],
    };
    const fake = new FakePostgrest(initialTables, {
      upsertKeys: {
        erp_gl_entry_mirror: ['org_id', 'erp_name'],
        erp_payment_ledger_mirror: ['org_id', 'erp_name'],
        external_sync_watermarks: ['org_id', 'external_tier', 'domain'],
      },
    });
    const before = Object.fromEntries(Object.keys(initialTables).map((table) => [table, structuredClone(fake.rowsOf(table))]));
    const urls: string[] = [];
    const fetchImpl = vi.fn(async (url: string) => {
      urls.push(url);
      const start = Number(new URL(url).searchParams.get('limit_start') ?? 0);
      if (start === 0) {
        return rawLedgerResponse(JSON.stringify({ data: [
          { name: 'GL-1', company: 'Synthetic Co', account: 'Cash', debit: '1.00', credit: '0.00', modified: '2026-01-02' },
          { name: 'GL-2', company: 'Synthetic Co', account: 'Cash', debit: '2.00', credit: '0.00', modified: '2026-01-03' },
        ] }));
      }
      return rawLedgerResponse('{"data":[');
    });
    const rpc = vi.fn(async () => ({ data: { deleted: 0 }, error: null }));
    const serviceClient = Object.assign(fake, { rpc });

    await expect(feedLedgerMirrors(serviceClient as never, {
      client: client(fetchImpl), orgId: 'org-1', company: 'Synthetic Co', fullReplay: true, pageSize: 2, maxPages: 2,
    })).rejects.toMatchObject({ name: 'AppError', code: 'external-unreachable' });

    for (const table of Object.keys(initialTables)) expect(fake.rowsOf(table)).toEqual(before[table as keyof typeof before]);
    expect(rpc).not.toHaveBeenCalledWith('finish_erp_gl_replay', expect.anything());
    expect(urls).toHaveLength(2);
    expect(urls.every((url) => url.includes('/api/resource/GL%20Entry'))).toBe(true);
  });
});

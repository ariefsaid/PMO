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
    expect(fields).toEqual(expect.arrayContaining(['name', 'account', 'cost_center', 'debit', 'credit', 'posting_date', 'is_cancelled', 'docstatus', 'modified']));
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

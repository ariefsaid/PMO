/**
 * erpnext/ledgerFetch.ts (task 7.2): the confined ERP ledger fetchers — the source the slice-8 sweep
 * feed reads to populate erp_gl_entry_mirror / erp_payment_ledger_mirror. All Frappe vocabulary
 * (doctype names, list-endpoint filter/field shapes) stays HERE in erpnext/**. Every ERP call is an
 * injected `fetchImpl` — no real bench required (NFR-ENA-CONTRACT-001).
 *
 * RED until ledgerFetch.ts exists. Asserts: paging accumulates all rows; the filters
 * (is_cancelled=0 / docstatus!=2 / modified>=since / company=<co>) + the field list are sent;
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

  it('AC-ENA-060/162 sends the GL Entry filters (is_cancelled=0, docstatus!=2, modified>=since, company) + the field list on page 0', async () => {
    const urls: string[] = [];
    const fetchImpl = async (url: string) => {
      urls.push(url);
      // Short first page (1 row, < pageSize) → single request.
      return jsonResponse({ data: [{ name: 'GLE-1', account: 'Creditors - PSC', debit: '50000.0', credit: '0', modified: '2026-07-12 12:00:00', is_cancelled: 0, docstatus: 1 }] });
    };
    const rows = await fetchGlEntries(client(fetchImpl), { company: 'PMO Smoke Co', since: '2026-07-01 00:00:00' });
    expect(urls).toHaveLength(1);
    expect(urls[0]).toContain('/api/resource/GL%20Entry'); // doctype confined here (raw, encoded path)
    const decoded = decodeURIComponent(urls[0]);
    expect(decoded).toContain('"is_cancelled","=",0');
    expect(decoded).toContain('"docstatus","!=",2]'); // docstatus!=2 (exclude cancelled)
    expect(decoded).toContain('"modified",">=","2026-07-01 00:00:00"');
    expect(decoded).toContain('"company","=","PMO Smoke Co"');
    // the field list requests the money + provenance fields the mirror consumes
    expect(decoded).toContain('"name"');
    expect(decoded).toContain('"account"');
    expect(decoded).toContain('"cost_center"');
    expect(decoded).toContain('"debit"');
    expect(decoded).toContain('"credit"');
    expect(decoded).toContain('"posting_date"');
    expect(decoded).toContain('"modified"');
    expect(rows).toHaveLength(1);
  });

  it('paging accumulates ALL rows across pages (a full page 0 → a page-1 request with limit_start=pageSize → a short page stops the loop)', async () => {
    const urls: string[] = [];
    const fullPage = Array.from({ length: 2 }, (_, i) => ({ name: `GLE-${i}`, account: 'A', debit: '1.0', credit: '0', modified: '2026-07-12 00:00:0' + i, is_cancelled: 0, docstatus: 1 }));
    const shortPage = [{ name: 'GLE-2', account: 'A', debit: '3.0', credit: '0', modified: '2026-07-12 00:00:02', is_cancelled: 0, docstatus: 1 }];
    const fetchImpl = async (url: string) => {
      urls.push(url);
      return jsonResponse({ data: url.includes('limit_start=0') || !url.includes('limit_start=') ? fullPage : shortPage });
    };
    // page 0 returns exactly pageSize (2) → must request page 1; page 1 returns 1 (< pageSize) → stop.
    const rows = await fetchGlEntries(client(fetchImpl), { company: 'PMO Smoke Co', since: '2026-07-01', pageSize: 2 });
    expect(urls).toHaveLength(2);
    expect(decodeURIComponent(urls[0])).toContain('limit_start=0');
    expect(decodeURIComponent(urls[1])).toContain('limit_start=2');
    expect(rows).toHaveLength(3); // 2 + 1 — ALL rows accumulated
    expect(rows.map((r) => r.name)).toEqual(['GLE-0', 'GLE-1', 'GLE-2']);
  });

  it('money fields are returned as decimal-strings (R4) — a Frappe number is coerced, null stays null', async () => {
    const fetchImpl = async () =>
      jsonResponse({
        data: [
          { name: 'GLE-1', account: 'A', debit: 50000, credit: '0.00', modified: '2026-07-12', is_cancelled: 0, docstatus: 1 },
          { name: 'GLE-2', account: 'A', debit: null, credit: null, modified: '2026-07-12', is_cancelled: 0, docstatus: 1 },
        ],
      });
    const rows = await fetchGlEntries(client(fetchImpl), { company: 'PMO Smoke Co' });
    expect(rows[0].debit).toBe('50000'); // number coerced to decimal-string
    expect(rows[0].credit).toBe('0.00');
    expect(rows[1].debit).toBeNull();
    expect(rows[1].credit).toBeNull();
  });

  it('is pure fetch — NEVER persists (the function signature takes ONLY the client + opts; slice 8 owns the mirror feed)', async () => {
    // Structural: fetchGlEntries has no service-client / DB param — persistence is 8.x's job.
    const fetchImpl = async () => jsonResponse({ data: [] });
    const rows = await fetchGlEntries(client(fetchImpl), { company: 'PMO Smoke Co', since: '2026-07-01' });
    expect(rows).toEqual([]);
  });
});

describe('erpnext/ledgerFetch — fetchPaymentLedgerEntries', () => {
  it('AC-ENA-162 fetches Payment Ledger Entry with docstatus!=2 + company + modified>=since filters and returns decimal-string amounts', async () => {
    const urls: string[] = [];
    const fetchImpl = async (url: string) => {
      urls.push(url);
      return jsonResponse({ data: [{ name: 'PLE-1', account: 'Creditors - PSC', amount: '-75000.0', modified: '2026-07-12 11:36:00', docstatus: 1 }] });
    };
    const rows = await fetchPaymentLedgerEntries(client(fetchImpl), { company: 'PMO Smoke Co', since: '2026-07-01 00:00:00' });
    expect(urls).toHaveLength(1);
    expect(urls[0]).toContain('/api/resource/Payment%20Ledger%20Entry'); // doctype confined here
    const decoded = decodeURIComponent(urls[0]);
    expect(decoded).toContain('"docstatus","!=",2]');
    expect(decoded).toContain('"modified",">=","2026-07-01 00:00:00"');
    expect(decoded).toContain('"company","=","PMO Smoke Co"');
    expect(rows[0].amount).toBe('-75000.0'); // decimal-string preserved (the aging fallback's signed amount)
  });

  it('paging accumulates Payment Ledger Entry rows across pages', async () => {
    const full = Array.from({ length: 2 }, (_, i) => ({ name: `PLE-${i}`, account: 'A', amount: '1.0', modified: '2026-07-12 00:00:0' + i, docstatus: 1 }));
    const short = [{ name: 'PLE-2', account: 'A', amount: '3.0', modified: '2026-07-12 00:00:02', docstatus: 1 }];
    const fetchImpl = async (url: string) =>
      jsonResponse({ data: url.includes('limit_start=0') || !url.includes('limit_start=') ? full : short });
    const rows = await fetchPaymentLedgerEntries(client(fetchImpl), { company: 'PMO Smoke Co', pageSize: 2 });
    expect(rows).toHaveLength(3);
  });
});

/**
 * task 3.9 — erpnext/onboarding.ts. `onboardParties`'s idempotency is proved at
 * `supabase/functions/erpnext-onboard/index.test.ts` (Deno, the plan's named RED file); this file
 * covers `listErpPartySources` — the confined GET-list mapping (ERPNext vocabulary stays inside
 * erpnext/**, never in the edge-fn wrapper).
 */
import { describe, expect, it } from 'vitest';
import { listErpPartySources } from './onboarding.ts';
import type { ErpClientDeps } from './client.ts';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

describe('erpnext/onboarding — listErpPartySources (confined GET-list mapping)', () => {
  it('AC-ONB-002 fetches Supplier + Customer lists and maps them into ErpPartySource[] (ID == name: id and name agree, as before)', async () => {
    const calls: string[] = [];
    const fetchImpl = async (url: string) => {
      calls.push(url);
      if (url.includes('Supplier')) {
        return jsonResponse(200, { data: [{ name: 'Acme Co', supplier_name: 'Acme Co', tax_id: 'TAX-1', is_internal_supplier: 0 }] });
      }
      return jsonResponse(200, {
        data: [{ name: 'Acme Buyer', customer_name: 'Acme Buyer', tax_id: null, is_internal_customer: 1, payment_terms: null }],
      });
    };
    const deps: ErpClientDeps = { fetchImpl: fetchImpl as unknown as typeof fetch, apiKey: 'k', apiSecret: 's', baseUrl: 'https://erp.example.com' };
    const sources = await listErpPartySources(deps);
    expect(calls.some((u) => u.includes('/api/resource/Supplier'))).toBe(true);
    expect(calls.some((u) => u.includes('/api/resource/Customer'))).toBe(true);
    expect(sources).toEqual([
      { doctype: 'Supplier', id: 'Acme Co', name: 'Acme Co', taxId: 'TAX-1', isInternal: false },
      { doctype: 'Customer', id: 'Acme Buyer', name: 'Acme Buyer', taxId: null, isInternal: true, paymentTermsDays: undefined },
    ]);
  });

  it('AC-ONB-001 numbered party IDs: carries the ERPNext document name as id and the display name as name', async () => {
    const fetchImpl = async (url: string) =>
      url.includes('Supplier')
        ? jsonResponse(200, { data: [{ name: 'S-000001', supplier_name: 'PT Vendor', tax_id: null, is_internal_supplier: 0 }] })
        : jsonResponse(200, { data: [{ name: 'C-000001', customer_name: 'PT Example', tax_id: null, is_internal_customer: 0, payment_terms: null }] });
    const deps: ErpClientDeps = { fetchImpl: fetchImpl as unknown as typeof fetch, apiKey: 'k', apiSecret: 's', baseUrl: 'https://erp.example.com' };
    const sources = await listErpPartySources(deps);
    expect(sources.map((s) => [s.doctype, s.id, s.name])).toEqual([
      ['Supplier', 'S-000001', 'PT Vendor'],
      ['Customer', 'C-000001', 'PT Example'],
    ]);
  });

  it('a row without a display name falls back to the ID for both id and name', async () => {
    const fetchImpl = async (url: string) =>
      url.includes('Supplier') ? jsonResponse(200, { data: [{ name: 'Acme Co' }] }) : jsonResponse(200, { data: [{ name: 'Acme Buyer' }] });
    const deps: ErpClientDeps = { fetchImpl: fetchImpl as unknown as typeof fetch, apiKey: 'k', apiSecret: 's', baseUrl: 'https://erp.example.com' };
    const sources = await listErpPartySources(deps);
    expect(sources.map((s) => [s.id, s.name])).toEqual([
      ['Acme Co', 'Acme Co'],
      ['Acme Buyer', 'Acme Buyer'],
    ]);
  });

  it('handles an empty data array gracefully', async () => {
    const deps: ErpClientDeps = {
      fetchImpl: (async () => jsonResponse(200, { data: [] })) as unknown as typeof fetch,
      apiKey: 'k',
      apiSecret: 's',
      baseUrl: 'https://erp.example.com',
    };
    const sources = await listErpPartySources(deps);
    expect(sources).toEqual([]);
  });
});

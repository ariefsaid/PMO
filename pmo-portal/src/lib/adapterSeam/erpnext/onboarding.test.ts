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
  it('fetches Supplier + Customer lists and maps them into ErpPartySource[]', async () => {
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
      { doctype: 'Supplier', name: 'Acme Co', taxId: 'TAX-1', isInternal: false },
      { doctype: 'Customer', name: 'Acme Buyer', taxId: null, isInternal: true, paymentTermsDays: undefined },
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

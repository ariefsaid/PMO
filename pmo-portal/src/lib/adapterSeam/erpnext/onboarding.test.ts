/**
 * task 3.9 — erpnext/onboarding.ts. `onboardParties`'s idempotency is proved at
 * `supabase/functions/erpnext-onboard/index.test.ts` (Deno, the plan's named RED file); this file
 * covers `listErpPartySources` — the confined GET-list mapping (ERPNext vocabulary stays inside
 * erpnext/**, never in the edge-fn wrapper).
 */
import { describe, expect, it } from 'vitest';
import { listErpContactSources, listErpPartySources, onboardParties, type OnboardPartiesDeps } from './onboarding.ts';
import type { PmoRecord } from '../contract.ts';
import type { ErpClientDeps } from './client.ts';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

describe('ERP Contact onboarding hydration', () => {
  it('AC-CON-001 reads each full Contact to retain primary child tables and company links', async () => {
    const calls: URL[] = [];
    const fetchImpl = async (input: string | URL | Request) => {
      const url = new URL(String(input));
      calls.push(url);
      return jsonResponse(200, { data: url.pathname.endsWith('/Contact')
        ? [{ name: 'CONTACT-001', modified: '2026-10-05 09:00:00', first_name: 'List-only' }]
        : { name: 'CONTACT-001', modified: '2026-10-05 09:00:00', full_name: 'Synthetic Contact',
          email_ids: [{ email_id: 'synthetic@example.test', is_primary: 1 }],
          links: [{ link_doctype: 'Customer', link_name: 'C-001' }] } });
    };
    const changes = await listErpContactSources({ fetchImpl: fetchImpl as typeof fetch,
      apiKey: 'fixture', apiSecret: 'fixture', baseUrl: 'https://erp.example.test' });
    expect(calls.map((url) => url.pathname)).toEqual(['/api/resource/Contact', '/api/resource/Contact/CONTACT-001']);
    expect(JSON.parse(calls[0].searchParams.get('fields')!)).not.toContain('links');
    expect(changes).toHaveLength(1);
    expect(changes[0].record).toMatchObject({ id: 'Contact:CONTACT-001', full_name: 'Synthetic Contact',
      email: 'synthetic@example.test', erp_contact_links: [{ link_doctype: 'Customer', link_name: 'C-001' }] });
  });

  it('does not hydrate a document when the Contact list is empty', async () => {
    let calls = 0;
    const changes = await listErpContactSources({ fetchImpl: (async () => {
      calls += 1;
      return jsonResponse(200, { data: [] });
    }) as typeof fetch, apiKey: 'fixture', apiSecret: 'fixture', baseUrl: 'https://erp.example.test' });
    expect(changes).toEqual([]);
    expect(calls).toBe(1);
  });
});

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

describe('erpnext/onboarding — onboardParties (keyed by ERPNext ID)', () => {
  function fakeDeps(refs: Record<string, string>) {
    const calls = { inserted: [] as PmoRecord[], updated: [] as string[], refs: [] as { pmoRecordId: string; externalRecordId: string }[], lookups: [] as string[] };
    const deps: OnboardPartiesDeps = {
      findPmoRecordId: async (ext) => { calls.lookups.push(ext); return refs[ext] ?? null; },
      findCandidates: async () => [],
      insertCompaniesMirror: async (c) => { calls.inserted.push(c); },
      updateCompaniesMirror: async (id) => { calls.updated.push(id); },
      recordExternalRef: async (m) => { calls.refs.push(m); },
    };
    return { deps, calls };
  }
  const source = { doctype: 'Customer' as const, id: 'C-000001', name: 'PT Example', taxId: null };

  it('AC-ONB-001 a first-time adopt records the ref by the ERPNext ID and names the company by its display name', async () => {
    const { deps, calls } = fakeDeps({});
    const res = await onboardParties([source], deps);
    expect(res).toEqual({ adopted: 1, reconciled: 0 });
    expect(calls.lookups).toEqual(['Customer:C-000001']);
    expect(calls.refs[0].externalRecordId).toBe('Customer:C-000001');
    expect(calls.inserted[0].name).toBe('PT Example');
  });

  it('AC-ONB-003 a re-run over a party already mapped by its ID updates it and mints nothing', async () => {
    const { deps, calls } = fakeDeps({ 'Customer:C-000001': 'pmo-1' });
    const res = await onboardParties([source], deps);
    expect(res).toEqual({ adopted: 0, reconciled: 1 });
    expect(calls.updated).toEqual(['pmo-1']);
    expect(calls.inserted).toHaveLength(0);
    expect(calls.refs).toHaveLength(0);
  });
});

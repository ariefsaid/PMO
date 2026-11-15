/**
 * task 3.9 — erpnext/onboarding.ts. `onboardParties`'s idempotency is proved at
 * `supabase/functions/erpnext-onboard/index.test.ts` (Deno, the plan's named RED file); this file
 * covers `listErpPartySources` — the confined GET-list mapping (ERPNext vocabulary stays inside
 * erpnext/**, never in the edge-fn wrapper).
 */
import { describe, expect, it } from 'vitest';
import { listErpContactSources, listErpPartySources, onboardParties, type OnboardPartiesDeps } from './onboarding.ts';
import type { PmoRecord } from '../contract.ts';
import { AppError } from '../../appError.ts';
import { ERP_RESPONSE_MAX_BYTES, type ErpClientDeps } from './client.ts';

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

  it('#918 the party pull reads a body over the SHARED default cap — its raised per-call cap is wired, not assumed', async () => {
    // `limit_page_length=0` is unbounded by pagination, so onboarding raises the client's 5 MiB
    // default to ERP_PARTY_PULL_MAX_BYTES. Feeding a body OVER the default cap proves the wiring:
    // the pull only succeeds because the caller really passes the raised cap — dropping the option
    // from either party request makes this RED (the client refuses the body as over-cap).
    const hugeSupplierName = 'A'.repeat(ERP_RESPONSE_MAX_BYTES); // JSON total lands just over 5 MiB
    const fetchImpl = async (url: string) => {
      if (url.includes('Supplier')) {
        return new Response(
          JSON.stringify({ data: [{ name: 'SUP-1', supplier_name: hugeSupplierName, tax_id: null, is_internal_supplier: 0 }] }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      return jsonResponse(200, { data: [{ name: 'CUS-1' }] });
    };
    const deps: ErpClientDeps = { fetchImpl: fetchImpl as unknown as typeof fetch, apiKey: 'k', apiSecret: 's', baseUrl: 'https://erp.example.com' };
    const sources = await listErpPartySources(deps);
    expect(sources).toEqual([
      { doctype: 'Supplier', id: 'SUP-1', name: hugeSupplierName, taxId: null, isInternal: false },
      { doctype: 'Customer', id: 'CUS-1', name: 'CUS-1', taxId: null, isInternal: false, paymentTermsDays: undefined },
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
      findPmoRecordIds: async (ids) => { calls.lookups.push(...ids); return new Map(ids.filter((ext) => refs[ext]).map((ext) => [ext, refs[ext]])); },
      findPmoRecordId: async (ext) => refs[ext] ?? null,
      findCandidates: async () => [],
      insertCompaniesMirror: async (c) => { calls.inserted.push(c); },
      updateCompaniesMirror: async (id) => { calls.updated.push(id); },
      recordExternalRef: async (m) => { calls.refs.push(m); },
      mirrorExists: async () => true,
      notifyUnclearMatch: async () => {},
      recordReview: async () => {},
    };
    return { deps, calls };
  }
  const source = { doctype: 'Customer' as const, id: 'C-000001', name: 'PT Example', taxId: null };

  it('AC-ONB-001 a first-time adopt records the ref by the ERPNext ID and names the company by its display name', async () => {
    const { deps, calls } = fakeDeps({});
    const res = await onboardParties([source], deps);
    expect(res).toEqual({ adopted: 1, reconciled: 0, needsDecision: [], skippedInternal: 0 });
    expect(calls.lookups).toEqual(['Customer:C-000001']);
    expect(calls.refs[0].externalRecordId).toBe('Customer:C-000001');
    expect(calls.inserted[0].name).toBe('PT Example');
  });

  it('AC-ONB-003 a re-run over a party already mapped by its ID updates it and mints nothing', async () => {
    const { deps, calls } = fakeDeps({ 'Customer:C-000001': 'pmo-1' });
    const res = await onboardParties([source], deps);
    expect(res).toEqual({ adopted: 0, reconciled: 1, needsDecision: [], skippedInternal: 0 });
    expect(calls.updated).toEqual(['pmo-1']);
    expect(calls.inserted).toHaveLength(0);
    expect(calls.refs).toHaveLength(0);
  });
});

describe('#2119 onboardParties: one mapping read, bounded concurrency, one mapping per external id', () => {
  /** A latency-bearing in-memory (companies, external_refs) store that refuses duplicates like Postgres, and counts
   *  every round trip and the peak number of parties in flight. */
  function store(opts: { latencyMs?: number; candidates?: (name: string) => string[] } = {}) {
    const refs = new Map<string, string>(); const companies = new Set<string>();
    const trips: Record<string, number> = {}; let inFlight = 0; let peak = 0;
    const trip = async <T>(name: string, fn: () => T): Promise<T> => {
      trips[name] = (trips[name] ?? 0) + 1; inFlight += 1; peak = Math.max(peak, inFlight);
      try { await new Promise((r) => setTimeout(r, opts.latencyMs ?? 1)); return fn(); } finally { inFlight -= 1; }
    };
    const deps: OnboardPartiesDeps = {
      findPmoRecordIds: (ids) => trip('findPmoRecordIds', () => new Map(ids.filter((id) => refs.has(id)).map((id) => [id, refs.get(id)!]))),
      findPmoRecordId: (ext) => trip('findPmoRecordId', () => refs.get(ext) ?? null),
      findCandidates: (_d, name) => trip('findCandidates', () => (opts.candidates?.(name) ?? []).filter((id) => ![...refs.values()].includes(id)).map((pmoRecordId) => ({ pmoRecordId, taxId: null }))),
      insertCompaniesMirror: (c) => trip('insert', () => { if (companies.has(c.id)) throw Object.assign(new Error('dup'), { code: '23505' }); companies.add(c.id); }),
      updateCompaniesMirror: (id) => trip('update', () => { if (!companies.has(id)) throw new Error('update of a missing company'); }),
      recordExternalRef: ({ pmoRecordId, externalRecordId }) => trip('recordExternalRef', () => {
        if (refs.has(externalRecordId) || [...refs.values()].includes(pmoRecordId)) throw Object.assign(new Error('dup'), { code: '23505' });
        refs.set(externalRecordId, pmoRecordId);
      }),
      mirrorExists: (id) => trip('mirrorExists', () => companies.has(id)),
      notifyUnclearMatch: async () => {},
      recordReview: async () => {},
    };
    return { deps, refs, companies, trips, peak: () => peak };
  }
  const parties = (n: number) => Array.from({ length: n }, (_, i) => ({ doctype: (i % 2 ? 'Customer' : 'Supplier') as 'Customer' | 'Supplier', id: `P-${i}`, name: `Party ${i}`, taxId: null }));

  it('#2119 500 fresh parties: the mappings are read once, never per party, and each party costs 3 round trips (was 4)', async () => {
    const s = store();
    const res = await onboardParties(parties(500), s.deps);
    expect(res.adopted).toBe(500);
    expect(s.trips.findPmoRecordIds).toBe(1);
    expect(s.trips.findPmoRecordId ?? 0).toBe(0);
    expect(s.trips).toEqual({ findPmoRecordIds: 1, findCandidates: 500, recordExternalRef: 500, insert: 500 });
    expect(s.refs.size).toBe(500);
  });

  it('#2119 a re-run over 500 mapped parties: one mapping read, then 2 round trips each (was 3), nothing minted', async () => {
    const s = store();
    await onboardParties(parties(500), s.deps);
    for (const k of Object.keys(s.trips)) delete s.trips[k];
    const res = await onboardParties(parties(500), s.deps);
    expect(res).toEqual({ adopted: 0, reconciled: 500, needsDecision: [], skippedInternal: 0 });
    expect(s.trips).toEqual({ findPmoRecordIds: 1, mirrorExists: 500, update: 500 });
  });

  it('#2119 parties run with bounded concurrency (more than one, at most 8 in flight)', async () => {
    const s = store({ latencyMs: 5 });
    await onboardParties(parties(100), s.deps);
    expect(s.peak()).toBeGreaterThan(1);
    expect(s.peak()).toBeLessThanOrEqual(8);
  });

  it('#2119 AC-ENA-041 two sources with the SAME external id, processed concurrently, mint exactly one mapping and one company', async () => {
    const s = store({ latencyMs: 5 });
    const dup = { doctype: 'Supplier' as const, id: 'DUP-1', name: 'Same Party', taxId: null };
    const res = await onboardParties([dup, { ...dup }, { ...dup, name: 'Same Party renamed' }, ...parties(20)], s.deps); // adjacent: same worker wave
    expect([...s.refs.keys()].filter((k) => k === 'Supplier:DUP-1')).toHaveLength(1);
    expect(s.refs.size).toBe(21);
    expect(s.companies.size).toBe(21);
    expect(res).toMatchObject({ adopted: 21, reconciled: 2, needsDecision: [] });
    // the repeats run after the first in one group: they never race it for the link claim
    expect(s.trips.recordExternalRef).toBe(21);
    expect(s.trips.findPmoRecordId ?? 0).toBe(0);
  });

  it('#2119 two ERP parties that could be the same PMO company are decided one after the other, as when serial', async () => {
    // both match the one existing company by name: serially the second sees it taken and mints its own; run at
    // once, both would claim it and the loser would be wrongly flagged "already-linked"
    const s = store({ latencyMs: 5, candidates: (name) => (name === 'Acme' ? ['pmo-acme'] : []) });
    s.companies.add('pmo-acme');
    const res = await onboardParties([
      { doctype: 'Supplier', id: 'S-A', name: 'Acme', taxId: null },
      { doctype: 'Supplier', id: 'S-B', name: 'Acme', taxId: null },
    ], s.deps);
    expect(res.needsDecision).toEqual([]);
    expect(res.adopted).toBe(2);
    expect(s.refs.get('Supplier:S-A')).toBe('pmo-acme');
  });

  it('#2119 needsDecision keeps source order even when parties finish out of order', async () => {
    const s = store({ latencyMs: 2 });
    s.deps.findCandidates = async (_d, name) => {
      await new Promise((r) => setTimeout(r, name === 'Early' ? 30 : 1));
      throw new AppError('unclear', 'action-required', 'ambiguous');
    };
    const res = await onboardParties([
      { doctype: 'Supplier', id: 'E', name: 'Early', taxId: null },
      { doctype: 'Supplier', id: 'L', name: 'Late', taxId: null },
    ], s.deps);
    expect(res.needsDecision.map((d) => d.id)).toEqual(['E', 'L']);
  });
});

/**
 * erpnext/recoveryProbe.ts (task 6.4 + Slice-6 completion, ADR-0057 §3): the per-doctype anchor-key
 * recovery probe. Every ERP call is an injected `fetchImpl` — no real bench required.
 */
import { describe, expect, it, vi } from 'vitest';
import { probeErpByAnchorKey, probeErpByPaymentComposite } from './recoveryProbe.ts';
import type { ErpClientDeps } from './client.ts';

function client(fetchImpl: (url: string, init?: RequestInit) => Promise<Response>): ErpClientDeps {
  return { fetchImpl: vi.fn(fetchImpl) as unknown as typeof fetch, apiKey: 'k', apiSecret: 's', baseUrl: 'https://erp.example.com' };
}

describe('erpnext/recoveryProbe — probeErpByAnchorKey', () => {
  it('filters the doctype by the ANCHOR field (remarks for PI) and adopts the found doc (re-fetch + fromDoc + PMO id)', async () => {
    const urls: string[] = [];
    const fetchImpl = async (url: string) => {
      urls.push(url);
      if (url.includes('filters=')) {
        return new Response(JSON.stringify({ data: [{ name: 'ACC-PINV-2026-00007' }] }), { status: 200 });
      }
      return new Response(JSON.stringify({ name: 'ACC-PINV-2026-00007', outstanding_amount: 0, docstatus: 1 }), { status: 200 });
    };
    const result = await probeErpByAnchorKey(
      {
        client: client(fetchImpl),
        doctype: 'Purchase Invoice',
        anchorField: 'remarks',
        fromDoc: (doc) => ({ id: (doc as { name: string }).name, vi_number: (doc as { name: string }).name, erp_docstatus: (doc as { docstatus: number }).docstatus }),
        pmoRecordId: 'pmo-pi-1',
      },
      'idem-key-abc',
    );
    // the list query carried the remarks-like filter for the key…
    expect(urls[0]).toContain('filters=');
    expect(decodeURIComponent(urls[0])).toContain('"remarks","like","%idem-key-abc%"');
    // …and the second call re-fetched the found doc by name.
    expect(urls[1]).toContain('Purchase%20Invoice/ACC-PINV-2026-00007');
    expect(result).toEqual({
      externalRecordId: 'ACC-PINV-2026-00007',
      canonical: { id: 'pmo-pi-1', vi_number: 'ACC-PINV-2026-00007', erp_docstatus: 1 },
    });
  });

  it('DIRECTOR RULING: a Payment Entry probe filters on reference_no (NOT remarks) — the per-doctype anchor override', async () => {
    const urls: string[] = [];
    const fetchImpl = async (url: string) => {
      urls.push(url);
      if (url.includes('filters=')) {
        return new Response(JSON.stringify({ data: [{ name: 'ACC-PAY-2026-00001' }] }), { status: 200 });
      }
      return new Response(JSON.stringify({ name: 'ACC-PAY-2026-00001', docstatus: 1, reference_no: 'idem-key-xyz' }), { status: 200 });
    };
    const result = await probeErpByAnchorKey(
      {
        client: client(fetchImpl),
        doctype: 'Payment Entry',
        anchorField: 'reference_no',
        fromDoc: (doc) => ({ id: (doc as { name: string }).name, pay_number: (doc as { name: string }).name, erp_docstatus: (doc as { docstatus: number }).docstatus }),
        pmoRecordId: 'pmo-pe-1',
      },
      'idem-key-xyz',
    );
    expect(urls[0]).toContain('filters=');
    // the filter is on reference_no, NOT remarks (PE's remarks is overwritten by ERPNext validate).
    expect(decodeURIComponent(urls[0])).toContain('"reference_no","like","%idem-key-xyz%"');
    expect(decodeURIComponent(urls[0])).not.toContain('remarks');
    expect(result).toEqual({
      externalRecordId: 'ACC-PAY-2026-00001',
      canonical: { id: 'pmo-pe-1', pay_number: 'ACC-PAY-2026-00001', erp_docstatus: 1 },
    });
  });

  it('returns null when ERP holds no doc for the key (the signal to POST a fresh create)', async () => {
    const fetchImpl = async () => new Response(JSON.stringify({ data: [] }), { status: 200 });
    const result = await probeErpByAnchorKey(
      { client: client(fetchImpl), doctype: 'Payment Entry', anchorField: 'reference_no', fromDoc: () => ({ id: 'x' }), pmoRecordId: 'pmo-pe-1' },
      'no-such-key',
    );
    expect(result).toBeNull();
  });
});

describe('C-1 DIRECTOR RULING: probeErpByPaymentComposite — reference_no anchor OR the deterministic conjunction', () => {
  const compositeInput = {
    partyType: 'Supplier',
    party: 'ACME',
    paidAmount: '250.00',
    piNames: ['ACC-PINV-2026-00007'],
    createdAfter: '2026-07-12 00:00:00',
  };

  it('an anchor-wiped PE whose landed POST is found by the party/amount/PI-reference conjunction is ADOPTED (no second POST)', async () => {
    // The accountant edited reference_no after commit → the anchor filter returns NOTHING; the composite
    // conjunction must still find the landed PE via party+amount+creation, then confirm it references our PI.
    const urls: string[] = [];
    const fetchImpl = async (url: string) => {
      urls.push(url);
      const decoded = decodeURIComponent(url);
      if (decoded.includes('"reference_no","like"')) {
        return new Response(JSON.stringify({ data: [] }), { status: 200 }); // anchor wiped → miss
      }
      if (decoded.includes('"party_type"')) {
        // the composite conjunction list returns one candidate name…
        return new Response(JSON.stringify({ data: [{ name: 'ACC-PAY-2026-00042' }] }), { status: 200 });
      }
      // …and the getDoc carries the references child table citing our PI + the ERP-derived fields.
      return new Response(
        JSON.stringify({ name: 'ACC-PAY-2026-00042', docstatus: 1, references: [{ reference_name: 'ACC-PINV-2026-00007' }] }),
        { status: 200 },
      );
    };
    const result = await probeErpByPaymentComposite(
      {
        client: client(fetchImpl),
        doctype: 'Payment Entry',
        anchorField: 'reference_no',
        fromDoc: (doc) => ({ id: (doc as { name: string }).name, pay_number: (doc as { name: string }).name, erp_docstatus: (doc as { docstatus: number }).docstatus }),
        pmoRecordId: 'pmo-pe-1',
      },
      'idem-wiped-key',
      compositeInput,
    );
    // the conjunction filter carried party_type/party/paid_amount/creation (all from OUR payload)…
    const conjUrl = urls.map(decodeURIComponent).find((u) => u.includes('"party_type"'))!;
    expect(conjUrl).toContain('"party","=","ACME"');
    expect(conjUrl).toContain('"paid_amount","=","250.00"');
    expect(conjUrl).toContain('"creation",">=","2026-07-12 00:00:00"');
    // …and the landed PE was adopted (its ERP name + canonical, id re-stamped to the PMO record).
    expect(result).toEqual({
      externalRecordId: 'ACC-PAY-2026-00042',
      canonical: { id: 'pmo-pe-1', pay_number: 'ACC-PAY-2026-00042', erp_docstatus: 1 },
    });
  });

  it('a truly-orphaned PE (conjunction finds a candidate that does NOT cite our PI) returns null (inconclusive → hold, never reissue)', async () => {
    const fetchImpl = async (url: string) => {
      const decoded = decodeURIComponent(url);
      if (decoded.includes('"reference_no","like"')) return new Response(JSON.stringify({ data: [] }), { status: 200 });
      if (decoded.includes('"party_type"')) return new Response(JSON.stringify({ data: [{ name: 'ACC-PAY-2026-99999' }] }), { status: 200 });
      // the candidate references a DIFFERENT invoice → not our PE.
      return new Response(JSON.stringify({ name: 'ACC-PAY-2026-99999', docstatus: 1, references: [{ reference_name: 'ACC-PINV-2026-00001' }] }), { status: 200 });
    };
    const result = await probeErpByPaymentComposite(
      { client: client(fetchImpl), doctype: 'Payment Entry', anchorField: 'reference_no', fromDoc: () => ({ id: 'x' }), pmoRecordId: 'pmo-pe-1' },
      'idem-orphan-key',
      compositeInput,
    );
    expect(result).toBeNull();
  });

  it('the reference_no anchor fast-path short-circuits the conjunction when the key survived', async () => {
    let conjunctionQueried = false;
    const fetchImpl = async (url: string) => {
      const decoded = decodeURIComponent(url);
      if (decoded.includes('"reference_no","like"')) return new Response(JSON.stringify({ data: [{ name: 'ACC-PAY-2026-00001' }] }), { status: 200 });
      if (decoded.includes('"party_type"')) { conjunctionQueried = true; return new Response(JSON.stringify({ data: [] }), { status: 200 }); }
      return new Response(JSON.stringify({ name: 'ACC-PAY-2026-00001', docstatus: 1 }), { status: 200 });
    };
    const result = await probeErpByPaymentComposite(
      { client: client(fetchImpl), doctype: 'Payment Entry', anchorField: 'reference_no', fromDoc: (d) => ({ id: (d as { name: string }).name }), pmoRecordId: 'pmo-pe-1' },
      'idem-key-survived',
      compositeInput,
    );
    expect(result?.externalRecordId).toBe('ACC-PAY-2026-00001');
    expect(conjunctionQueried).toBe(false); // the anchor hit short-circuited — no conjunction query
  });
});

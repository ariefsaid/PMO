/**
 * erpnext/recoveryProbe.ts (task 6.4 + Slice-6 completion, ADR-0058 §3): the per-doctype anchor-key
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
    siNames: [] as string[],
    createdAfter: '2026-07-12 00:00:00',
    paymentType: 'Pay' as const,
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
    // NOTE (Luna BLOCK 1): the anchor fast-path now ALSO filters party_type, so select the
    // conjunction URL by its conjunction-ONLY field `paid_amount` (the anchor query lacks it).
    const conjUrl = urls.map(decodeURIComponent).find((u) => u.includes('"paid_amount"'))!;
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
      if (decoded.includes('"party_type"') && decoded.includes('"paid_amount"')) { conjunctionQueried = true; return new Response(JSON.stringify({ data: [] }), { status: 200 }); }
      // Luna BLOCK 1: the anchor fast-path now re-validates the fetched doc's payment_type/party_type
      // (a real PE doc carries both) — include them so the same-type anchor hit is adopted.
      return new Response(JSON.stringify({ name: 'ACC-PAY-2026-00001', docstatus: 1, payment_type: 'Pay', party_type: 'Supplier' }), { status: 200 });
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

// ============================================================================
// Task 2.5 — Recovery probe payment_type discriminator (FR-SAR-083, AC-SAR-014)
// ============================================================================

describe('Task 2.5 — ErpPaymentCompositeInput payment_type discriminator (FR-SAR-083)', () => {
  const baseInput = {
    partyType: 'Customer',
    party: 'Spike Customer',
    paidAmount: '150000.00',
    piNames: [] as string[],
    siNames: ['ACC-SINV-2026-00001'],
    createdAfter: '2026-07-14 00:00:00',
    paymentType: 'Receive' as const,
  };

  it('a Receive probe matches only PE-receive docs (payment_type=Receive) and cites SI refs', async () => {
    const urls: string[] = [];
    const fetchImpl = async (url: string) => {
      urls.push(url);
      const decoded = decodeURIComponent(url);
      if (decoded.includes('"reference_no","like"')) return new Response(JSON.stringify({ data: [] }), { status: 200 });
      if (decoded.includes('"party_type"')) {
        // Verify the filter includes payment_type=Receive
        expect(decoded).toContain('"payment_type","=","Receive"');
        return new Response(JSON.stringify({ data: [{ name: 'ACC-PE-REC-2026-00001' }] }), { status: 200 });
      }
      // getDoc with references citing our SI
      return new Response(
        JSON.stringify({ name: 'ACC-PE-REC-2026-00001', docstatus: 1, payment_type: 'Receive', references: [{ reference_name: 'ACC-SINV-2026-00001' }] }),
        { status: 200 },
      );
    };

    const result = await probeErpByPaymentComposite(
      { client: client(fetchImpl), doctype: 'Payment Entry', anchorField: 'reference_no', fromDoc: (d) => ({ id: (d as { name: string }).name }), pmoRecordId: 'pmo-pe-1' },
      'idem-recv-key',
      baseInput,
    );
    expect(result).not.toBeNull();
    expect(result!.externalRecordId).toBe('ACC-PE-REC-2026-00001');
  });

  it('a Pay probe does NOT match a Receive doc (payment_type discriminator prevents cross-match)', async () => {
    const urls: string[] = [];
    const fetchImpl = async (url: string) => {
      urls.push(url);
      const decoded = decodeURIComponent(url);
      if (decoded.includes('"reference_no","like"')) return new Response(JSON.stringify({ data: [] }), { status: 200 });
      if (decoded.includes('"party_type"')) {
        // Verify the filter includes payment_type=Pay
        expect(decoded).toContain('"payment_type","=","Pay"');
        // The ERP has a Receive doc for this customer/amount — but it should NOT match a Pay probe
        return new Response(JSON.stringify({ data: [{ name: 'ACC-PE-REC-2026-00001' }] }), { status: 200 });
      }
      // getDoc — this is a Receive doc (payment_type=Receive), should not be adopted by Pay probe
      return new Response(
        JSON.stringify({ name: 'ACC-PE-REC-2026-00001', docstatus: 1, payment_type: 'Receive', references: [{ reference_name: 'ACC-SINV-2026-00001' }] }),
        { status: 200 },
      );
    };

    const payInput = { ...baseInput, paymentType: 'Pay' as const, partyType: 'Supplier' as const, party: 'ACME', piNames: ['ACC-PINV-2026-00001'], siNames: [] };
    const result = await probeErpByPaymentComposite(
      { client: client(fetchImpl), doctype: 'Payment Entry', anchorField: 'reference_no', fromDoc: (d) => ({ id: (d as { name: string }).name }), pmoRecordId: 'pmo-pe-1' },
      'idem-pay-key',
      payInput,
    );
    // Should return null because the found doc has payment_type=Receive, not Pay
    expect(result).toBeNull();
  });

  it('a Receive probe does NOT match a Pay doc (payment_type discriminator prevents cross-match)', async () => {
    const urls: string[] = [];
    const fetchImpl = async (url: string) => {
      urls.push(url);
      const decoded = decodeURIComponent(url);
      if (decoded.includes('"reference_no","like"')) return new Response(JSON.stringify({ data: [] }), { status: 200 });
      if (decoded.includes('"party_type"')) {
        // Verify the filter includes payment_type=Receive
        expect(decoded).toContain('"payment_type","=","Receive"');
        // The ERP has a Pay doc for this customer/amount — but it should NOT match a Receive probe
        return new Response(JSON.stringify({ data: [{ name: 'ACC-PE-PAY-2026-00001' }] }), { status: 200 });
      }
      // getDoc — this is a Pay doc (payment_type=Pay), should not be adopted by Receive probe
      return new Response(
        JSON.stringify({ name: 'ACC-PE-PAY-2026-00001', docstatus: 1, payment_type: 'Pay', references: [{ reference_name: 'ACC-PINV-2026-00001' }] }),
        { status: 200 },
      );
    };

    const result = await probeErpByPaymentComposite(
      { client: client(fetchImpl), doctype: 'Payment Entry', anchorField: 'reference_no', fromDoc: (d) => ({ id: (d as { name: string }).name }), pmoRecordId: 'pmo-pe-1' },
      'idem-recv-key-2',
      baseInput,
    );
    // Should return null because the found doc has payment_type=Pay, not Receive
    expect(result).toBeNull();
  });
});

// ============================================================================
// Task 2.7 — Held-on-inconclusive for Receive (OWNS AC-SAR-013)
// ============================================================================

describe('Task 2.7 — PE-receive held-on-inconclusive (AC-SAR-013, C-1 verbatim)', () => {
  const receiveInput = {
    partyType: 'Customer',
    party: 'Spike Customer',
    paidAmount: '150000.00',
    piNames: [] as string[],
    siNames: ['ACC-SINV-2026-00001'],
    createdAfter: '2026-07-14 00:00:00',
    paymentType: 'Receive' as const,
  };

  it('a quarantined PE-receive outbox row past window with composite probe 0 matches → held (never auto-reissue)', async () => {
    // Simulate the recovery path: probeErpByPaymentComposite returns null (0 matches)
    // The dispatch layer (task 2.6) will call markOutboxHeld with reason'recovery-inconclusive-absence'
    const urls: string[] = [];
    const fetchImpl = async (url: string) => {
      urls.push(url);
      const decoded = decodeURIComponent(url);
      if (decoded.includes('"reference_no","like"')) return new Response(JSON.stringify({ data: [] }), { status: 200 });
      if (decoded.includes('"party_type"')) {
        // The probe filters correctly but finds NO candidate
        return new Response(JSON.stringify({ data: [] }), { status: 200 });
      }
      return new Response(JSON.stringify({}), { status: 200 });
    };

    const result = await probeErpByPaymentComposite(
      { client: client(fetchImpl), doctype: 'Payment Entry', anchorField: 'reference_no', fromDoc: (d) => ({ id: (d as { name: string }).name }), pmoRecordId: 'pmo-pe-1' },
      'idem-recv-key',
      receiveInput,
    );
    // Probe returns null (inconclusive absence) → dispatch will HOLD the row (C-1)
    expect(result).toBeNull();
    // Verify the conjunction filter included payment_type=Receive
    const conjUrl = urls.map(decodeURIComponent).find((u) => u.includes('"party_type"'));
    expect(conjUrl).toContain('"payment_type","=","Receive"');
  });

  it('a quarantined PE-receive outbox row with composite probe >1 matches (ambiguous) → held (never auto-reissue)', async () => {
    const urls: string[] = [];
    const fetchImpl = async (url: string) => {
      urls.push(url);
      const decoded = decodeURIComponent(url);
      if (decoded.includes('"reference_no","like"')) return new Response(JSON.stringify({ data: [] }), { status: 200 });
      if (decoded.includes('"party_type"')) {
        // Two candidates with same party/amount/creation — ambiguous
        return new Response(JSON.stringify({ data: [{ name: 'ACC-PE-REC-2026-00001' }, { name: 'ACC-PE-REC-2026-00002' }] }), { status: 200 });
      }
      // Both getDoc calls return docs citing our SI (ambiguous)
      return new Response(
        JSON.stringify({ name: 'ACC-PE-REC-2026-00001', docstatus: 1, payment_type: 'Receive', references: [{ reference_name: 'ACC-SINV-2026-00001' }] }),
        { status: 200 },
      );
    };

    const result = await probeErpByPaymentComposite(
      { client: client(fetchImpl), doctype: 'Payment Entry', anchorField: 'reference_no', fromDoc: (d) => ({ id: (d as { name: string }).name }), pmoRecordId: 'pmo-pe-1' },
      'idem-recv-key-ambiguous',
      receiveInput,
    );
    // Probe returns null (ambiguous) → dispatch will HOLD the row (C-1)
    expect(result).toBeNull();
  });
});

// ============================================================================
// Luna money audit — BLOCK 1: anchor-collision cross-domain corruption guard.
// probeErpByAnchorKey (the immutable-intent fast path inside probeErpByPaymentComposite) used to
// adopt ANY Payment Entry whose reference_no carried the idempotency key — including a Pay doc for a
// Receive command (and vice-versa). The anchor-candidate fetch must ALSO filter/validate payment_type
// + party_type so a Receive probe never matches a Pay doc.
// ============================================================================

describe('Luna BLOCK 1 — anchor collision: a Receive probe never adopts a Pay PE (cross-domain guard)', () => {
  it('a Receive recovery probe filters the anchor candidate by payment_type=Receive + party_type=Customer → a colliding Pay PE is NOT adopted', async () => {
    const urls: string[] = [];
    const fetchImpl = async (url: string) => {
      urls.push(url);
      const decoded = decodeURIComponent(url);
      // The anchor list query for a Receive probe MUST carry payment_type=Receive + party_type=Customer.
      // ERP holds ONLY a Pay PE with this colliding reference_no — the (correct) filter excludes it.
      if (decoded.includes('"reference_no","like"')) {
        expect(decoded).toContain('"payment_type","=","Receive"');
        expect(decoded).toContain('"party_type","=","Customer"');
        return new Response(JSON.stringify({ data: [] }), { status: 200 });
      }
      return new Response(JSON.stringify({}), { status: 200 });
    };
    const result = await probeErpByPaymentComposite(
      { client: client(fetchImpl), doctype: 'Payment Entry', anchorField: 'reference_no', fromDoc: (d) => ({ id: (d as { name: string }).name }), pmoRecordId: 'pmo-pe-recv-1' },
      'colliding-key',
      { partyType: 'Customer', party: 'Spike Customer', paidAmount: '150000.00', piNames: [], siNames: ['ACC-SINV-2026-00001'], createdAfter: '2026-07-14 00:00:00', paymentType: 'Receive' },
    );
    // The Pay PE with the colliding reference_no is NOT adopted (anchor filtered it out).
    expect(result).toBeNull();
  });

  it('a Pay recovery probe filters the anchor candidate by payment_type=Pay + party_type=Supplier → a colliding Receive PE is NOT adopted', async () => {
    const urls: string[] = [];
    const fetchImpl = async (url: string) => {
      urls.push(url);
      const decoded = decodeURIComponent(url);
      if (decoded.includes('"reference_no","like"')) {
        expect(decoded).toContain('"payment_type","=","Pay"');
        expect(decoded).toContain('"party_type","=","Supplier"');
        return new Response(JSON.stringify({ data: [] }), { status: 200 });
      }
      return new Response(JSON.stringify({}), { status: 200 });
    };
    const result = await probeErpByPaymentComposite(
      { client: client(fetchImpl), doctype: 'Payment Entry', anchorField: 'reference_no', fromDoc: (d) => ({ id: (d as { name: string }).name }), pmoRecordId: 'pmo-pe-pay-1' },
      'colliding-key',
      { partyType: 'Supplier', party: 'ACME', paidAmount: '250.00', piNames: ['ACC-PINV-2026-00007'], siNames: [], createdAfter: '2026-07-12 00:00:00', paymentType: 'Pay' },
    );
    expect(result).toBeNull();
  });

  it('the anchor fast-path still adopts a SAME-payment_type PE (the filter does not over-narrow the happy path)', async () => {
    const fetchImpl = async (url: string) => {
      const decoded = decodeURIComponent(url);
      if (decoded.includes('"reference_no","like"')) {
        // ERP holds a Receive PE carrying the key — the Receive-probe filter matches it.
        expect(decoded).toContain('"payment_type","=","Receive"');
        return new Response(JSON.stringify({ data: [{ name: 'ACC-PE-REC-2026-00001' }] }), { status: 200 });
      }
      return new Response(
        JSON.stringify({ name: 'ACC-PE-REC-2026-00001', docstatus: 1, payment_type: 'Receive', party_type: 'Customer', references: [{ reference_name: 'ACC-SINV-2026-00001' }] }),
        { status: 200 },
      );
    };
    const result = await probeErpByPaymentComposite(
      { client: client(fetchImpl), doctype: 'Payment Entry', anchorField: 'reference_no', fromDoc: (d) => ({ id: (d as { name: string }).name }), pmoRecordId: 'pmo-pe-recv-1' },
      'same-type-key',
      { partyType: 'Customer', party: 'Spike Customer', paidAmount: '150000.00', piNames: [], siNames: ['ACC-SINV-2026-00001'], createdAfter: '2026-07-14 00:00:00', paymentType: 'Receive' },
    );
    expect(result).not.toBeNull();
    expect(result!.externalRecordId).toBe('ACC-PE-REC-2026-00001');
  });

  it('defense-in-depth: even if the anchor list returned a wrong-payment_type name, the post-fetch validator rejects it (null, never adopted)', async () => {
    // Simulate an ERP filter that failed to exclude (e.g. a stale index): the anchor list returns a
    // PAY doc name despite the Receive filter. The post-fetch guard must still refuse to adopt it.
    const fetchImpl = async (url: string) => {
      const decoded = decodeURIComponent(url);
      if (decoded.includes('"reference_no","like"')) {
        return new Response(JSON.stringify({ data: [{ name: 'ACC-PE-PAY-2026-00001' }] }), { status: 200 });
      }
      // The fetched doc is a Pay doc — a Receive probe must NOT adopt it.
      return new Response(
        JSON.stringify({ name: 'ACC-PE-PAY-2026-00001', docstatus: 1, payment_type: 'Pay', party_type: 'Supplier', references: [{ reference_name: 'ACC-PINV-2026-00001' }] }),
        { status: 200 },
      );
    };
    const result = await probeErpByPaymentComposite(
      { client: client(fetchImpl), doctype: 'Payment Entry', anchorField: 'reference_no', fromDoc: (d) => ({ id: (d as { name: string }).name }), pmoRecordId: 'pmo-pe-recv-1' },
      'filter-leak-key',
      { partyType: 'Customer', party: 'Spike Customer', paidAmount: '150000.00', piNames: [], siNames: ['ACC-SINV-2026-00001'], createdAfter: '2026-07-14 00:00:00', paymentType: 'Receive' },
    );
    expect(result).toBeNull();
  });

  // Luna BLOCK 1: the composite path builds the anchor `like` tuple ITSELF (to conjoin the
  // payment_type/party_type discriminators) — it must escape the caller-supplied key just like
  // `listDocNamesByAnchor` does, or a key carrying `%`/`_` turns the PE anchor probe into a wildcard
  // search that can adopt a DIFFERENT Payment Entry (then submit/cancel the wrong money document).
  it('escapes LIKE metacharacters in the key on the composite anchor filter (wildcard-injection guard)', async () => {
    let anchorFilters: unknown;
    const fetchImpl = async (url: string) => {
      const raw = new URL(url).searchParams.get('filters');
      const parsed = JSON.parse(raw ?? '[]') as Array<[string, string, string]>;
      if (parsed.some(([field, op]) => field === 'reference_no' && op === 'like')) {
        anchorFilters = parsed;
        return new Response(JSON.stringify({ data: [] }), { status: 200 });
      }
      return new Response(JSON.stringify({ data: [] }), { status: 200 });
    };
    const result = await probeErpByPaymentComposite(
      { client: client(fetchImpl), doctype: 'Payment Entry', anchorField: 'reference_no', fromDoc: () => ({ id: 'x' }), pmoRecordId: 'pmo-pe-1' },
      'evil%key_1',
      {
        partyType: 'Supplier',
        party: 'ACME',
        paidAmount: '250.00',
        piNames: ['ACC-PINV-2026-00007'],
        siNames: [],
        createdAfter: '2026-07-14 00:00:00',
        paymentType: 'Pay',
      },
    );
    expect(result).toBeNull();
    expect(anchorFilters).toEqual([
      ['reference_no', 'like', '%evil\\%key\\_1%'],
      ['payment_type', '=', 'Pay'],
      ['party_type', '=', 'Supplier'],
    ]);
  });
});

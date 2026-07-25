// Luna round-5 BLOCK 4 [Deno unit] — the SWEEP's outbox-recovery probe must carry the `payment_type`
// discriminator on its FALLBACK anchor probe.
//
// `payment` (Pay / supplier) and `incoming-payment` (Receive / customer) share the ONE `Payment Entry`
// doctype, and the recovery anchor (`reference_no`) is ERP-side editable — so a BARE anchor `like`
// probe can adopt a document of the WRONG direction whenever the two share a reference_no. The
// synchronous dispatch path wraps its fallback in `withPaymentTypeDiscriminator` (dispatchFactory.ts);
// the sweep's `buildReconcileDepsLive` fell back to a bare `probeErpByAnchorKey` whenever the persisted
// payload lacked `party`/`paid_amount`. A Receive recovery could then adopt a Pay Payment Entry — PMO
// maps an outgoing supplier payment as an incoming customer receipt, and a later `cancelPayment`
// cancels the WRONG (outgoing) payment.
//
// Verify: cd supabase/functions/erpnext-sweep && deno test outboxProbeDiscriminator.test.ts

// Stub Deno.serve so importing index.ts (top-level Deno.serve) does not bind a port under deno test.
(Deno as unknown as { serve: (...a: unknown[]) => unknown }).serve = () => ({ finished: Promise.resolve() });
const { buildOutboxProbe } = await import('./index.ts');

import type { ErpClientDeps } from '../../../pmo-portal/src/lib/adapterSeam/erpnext/client.ts';
import type { PmoRecord } from '../../../pmo-portal/src/lib/adapterSeam/contract.ts';

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

const KEY = 'idem-key-123';

/** A fake ERP bench holding ONE Payment Entry whose `reference_no` carries our idempotency key.
 *  Records every request path so the test can assert what the probe actually queried. */
function fakeBench(doc: Record<string, unknown>): { client: ErpClientDeps; paths: string[] } {
  const paths: string[] = [];
  const fetchImpl = ((url: string) => {
    const path = decodeURIComponent(String(url));
    paths.push(path);
    // The list query: honor the server-side filters the probe sent (that is the behavior under test).
    const filtersMatch = path.match(/filters=(\[.*?\])(?:&|$)/);
    if (filtersMatch) {
      const filters = JSON.parse(filtersMatch[1]) as Array<[string, string, string | number]>;
      const hit = filters.every(([field, op, value]) => {
        if (op === 'like') return String(doc[field] ?? '').includes(String(value).replaceAll('%', ''));
        return doc[field] === value;
      });
      return Promise.resolve(new Response(JSON.stringify({ data: hit ? [{ name: doc.name }] : [] }), { status: 200 }));
    }
    // The single-doc GET.
    return Promise.resolve(new Response(JSON.stringify({ data: doc }), { status: 200 }));
  }) as unknown as typeof fetch;
  return { client: { fetchImpl, apiKey: 'k', apiSecret: 's', baseUrl: 'https://erp.test' }, paths };
}

function probeFor(kind: string, doc: Record<string, unknown>) {
  const bench = fakeBench(doc);
  const probe = buildOutboxProbe({
    kind,
    anchorField: 'reference_no',
    anchorMutable: true,
    // The exact BLOCK-4 precondition: a persisted payload WITHOUT party/paid_amount, so the composite
    // probe cannot run and the fallback anchor probe is taken.
    payload: { erp_doc_kind: kind },
    probeDeps: {
      client: bench.client,
      doctype: 'Payment Entry',
      anchorField: 'reference_no',
      fromDoc: (d: unknown) => ({ id: 'x', ...(d as Record<string, unknown>) }) as PmoRecord,
      pmoRecordId: 'pmo-1',
    },
  });
  return { probe, bench };
}

Deno.test('Luna BLOCK 4: an incoming-payment (Receive) recovery does NOT adopt a Pay Payment Entry sharing its reference_no', async () => {
  const { probe, bench } = probeFor('incoming-payment', { name: 'PE-PAY-001', reference_no: KEY, payment_type: 'Pay', party_type: 'Supplier' });
  const adopted = await probe('revenue', KEY);
  assert(adopted === null, `a Receive recovery adopted an outgoing Pay document: ${JSON.stringify(adopted)}`);
  const listPath = bench.paths.find((p) => p.includes('filters='))!;
  assert(listPath.includes('["payment_type","=","Receive"]'), `the fallback anchor probe sent no payment_type=Receive filter: ${listPath}`);
});

Deno.test('Luna BLOCK 4: a payment (Pay) recovery does NOT adopt a Receive Payment Entry sharing its reference_no', async () => {
  const { probe, bench } = probeFor('payment', { name: 'PE-RCV-001', reference_no: KEY, payment_type: 'Receive', party_type: 'Customer' });
  const adopted = await probe('procurement', KEY);
  assert(adopted === null, `a Pay recovery adopted an incoming Receive document: ${JSON.stringify(adopted)}`);
  const listPath = bench.paths.find((p) => p.includes('filters='))!;
  assert(listPath.includes('["payment_type","=","Pay"]'), `the fallback anchor probe sent no payment_type=Pay filter: ${listPath}`);
});

Deno.test('Luna BLOCK 4: a Payment Entry that does not STATE its payment_type is refused, never adopted', async () => {
  // Defense in depth: even if the server-side filter leaked the candidate (a stale/odd bench), the
  // post-fetch validator must refuse a doc that does not positively state the expected direction.
  const bench = fakeBench({ name: 'PE-UNKNOWN-001', reference_no: KEY });
  const probe = buildOutboxProbe({
    kind: 'incoming-payment',
    anchorField: 'reference_no',
    anchorMutable: true,
    payload: { erp_doc_kind: 'incoming-payment' },
    probeDeps: {
      client: {
        ...bench.client,
        // Force the list query to RETURN the candidate regardless of filters (leak simulation).
        fetchImpl: ((url: string) => {
          const path = decodeURIComponent(String(url));
          if (path.includes('filters=')) return Promise.resolve(new Response(JSON.stringify({ data: [{ name: 'PE-UNKNOWN-001' }] }), { status: 200 }));
          return Promise.resolve(new Response(JSON.stringify({ data: { name: 'PE-UNKNOWN-001', reference_no: KEY } }), { status: 200 }));
        }) as unknown as typeof fetch,
      },
      doctype: 'Payment Entry',
      anchorField: 'reference_no',
      fromDoc: (d: unknown) => ({ id: 'x', ...(d as Record<string, unknown>) }) as PmoRecord,
      pmoRecordId: 'pmo-1',
    },
  });
  const adopted = await probe('revenue', KEY);
  assert(adopted === null, `a doc with no payment_type was adopted: ${JSON.stringify(adopted)}`);
});

Deno.test('Luna BLOCK 4: a MATCHING-direction Payment Entry is still adopted (the probe stays useful)', async () => {
  const { probe } = probeFor('incoming-payment', { name: 'PE-RCV-002', reference_no: KEY, payment_type: 'Receive', party_type: 'Customer' });
  const adopted = await probe('revenue', KEY);
  assert(adopted?.externalRecordId === 'PE-RCV-002', `the matching Receive document was not adopted: ${JSON.stringify(adopted)}`);
  assert(adopted?.canonical?.id === 'pmo-1', 'the adopted canonical must key on the PMO record id');
});

Deno.test('Luna BLOCK 4: the COMPOSITE branch takes its direction from the KIND, not a bare "Pay" payload default', async () => {
  // A Receive row whose persisted payload carries party/paid_amount but no `payment_type` previously
  // probed as 'Pay' (the old default) — the same cross-kind hazard one layer down. The kind is the
  // authoritative statement of what PMO commanded, so it wins.
  const bench = fakeBench({ name: 'PE-RCV-003', reference_no: 'other-ref', payment_type: 'Receive', party_type: 'Customer' });
  const probe = buildOutboxProbe({
    kind: 'incoming-payment',
    anchorField: 'reference_no',
    anchorMutable: true,
    payload: { erp_doc_kind: 'incoming-payment', party: 'ACME', party_type: 'Customer', paid_amount: 100, si_names: ['SINV-1'], created_after: '2026-07-01' },
    probeDeps: {
      client: bench.client,
      doctype: 'Payment Entry',
      anchorField: 'reference_no',
      fromDoc: (d: unknown) => ({ id: 'x', ...(d as Record<string, unknown>) }) as PmoRecord,
      pmoRecordId: 'pmo-4',
    },
  });
  await probe('revenue', KEY);
  const filterPaths = bench.paths.filter((p) => p.includes('filters='));
  assert(filterPaths.length > 0, 'the composite probe issued no list query');
  for (const p of filterPaths) {
    assert(p.includes('["payment_type","=","Receive"]'), `a composite query probed the WRONG direction: ${p}`);
  }
});

Deno.test('Luna BLOCK 4: an IMMUTABLE-anchor kind (purchase-invoice) keeps the bare anchor probe — byte-for-byte', async () => {
  const bench = fakeBench({ name: 'PINV-001', remarks: `posted ${KEY}` });
  const probe = buildOutboxProbe({
    kind: 'purchase-invoice',
    anchorField: 'remarks',
    anchorMutable: false,
    payload: { erp_doc_kind: 'purchase-invoice' },
    probeDeps: {
      client: bench.client,
      doctype: 'Purchase Invoice',
      anchorField: 'remarks',
      fromDoc: (d: unknown) => ({ id: 'x', ...(d as Record<string, unknown>) }) as PmoRecord,
      pmoRecordId: 'pmo-2',
    },
  });
  const adopted = await probe('procurement', KEY);
  assert(adopted?.externalRecordId === 'PINV-001', `the PI anchor probe stopped working: ${JSON.stringify(adopted)}`);
  const listPath = bench.paths.find((p) => p.includes('filters='))!;
  assert(!listPath.includes('payment_type'), `a payment_type filter leaked onto a non-Payment-Entry probe: ${listPath}`);
});

Deno.test('Luna BLOCK 4: an anchor-LESS kind still probes nothing (null anchor ⇒ no ERP call)', async () => {
  const bench = fakeBench({ name: 'MR-001' });
  const probe = buildOutboxProbe({
    kind: 'purchase-request',
    anchorField: null,
    anchorMutable: false,
    payload: { erp_doc_kind: 'purchase-request' },
    probeDeps: {
      client: bench.client,
      doctype: 'Material Request',
      anchorField: '',
      fromDoc: (d: unknown) => ({ id: 'x', ...(d as Record<string, unknown>) }) as PmoRecord,
      pmoRecordId: 'pmo-3',
    },
  });
  assert((await probe('procurement', KEY)) === null, 'an anchor-less kind must never probe');
  assert(bench.paths.length === 0, `an anchor-less kind issued ERP calls: ${bench.paths.join(', ')}`);
});

// THEME-BACK-40 (#1643): the sweep's money-write wiring, imported from its own module.
import type { PmoRecord } from '../../../pmo-portal/src/lib/adapterSeam/contract.ts';
import { buildOutboxProbe, moneyWriteReplayOptions } from './moneyWriteLive.ts';

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

const KEY = 'idem-key-456';

function probeFor(kind: string, anchorField: string | null, doc: Record<string, unknown>) {
  const paths: string[] = [];
  const fetchImpl = ((url: string) => {
    const path = decodeURIComponent(String(url));
    paths.push(path);
    const filters = path.match(/filters=(\[.*?\])(?:&|$)/);
    if (filters) {
      const hit = (JSON.parse(filters[1]) as Array<[string, string, unknown]>).every(([field, op, value]) =>
        op === 'like' ? String(doc[field] ?? '').includes(String(value).replaceAll('%', '')) : doc[field] === value);
      return Promise.resolve(new Response(JSON.stringify({ data: hit ? [{ name: doc.name }] : [] }), { status: 200 }));
    }
    return Promise.resolve(new Response(JSON.stringify({ data: doc }), { status: 200 }));
  }) as unknown as typeof fetch;
  const probe = buildOutboxProbe({
    kind,
    anchorField,
    anchorMutable: true,
    payload: { erp_doc_kind: kind },
    probeDeps: {
      client: { fetchImpl, apiKey: 'k', apiSecret: 's', baseUrl: 'https://erp.test' },
      doctype: 'Payment Entry',
      anchorField: anchorField ?? 'reference_no',
      fromDoc: (d: unknown) => ({ id: 'x', ...(d as Record<string, unknown>) }) as PmoRecord,
      pmoRecordId: 'pmo-1',
    },
  });
  return { probe, paths };
}

Deno.test('Luna BLOCK 4 a Receive recovery filters on its direction and never adopts a Pay entry sharing its key', async () => {
  const { probe, paths } = probeFor('incoming-payment', 'reference_no', { name: 'PE-PAY-9', reference_no: KEY, payment_type: 'Pay' });
  assert((await probe('revenue', KEY)) === null, 'a Receive recovery adopted a Pay document');
  assert(paths.some((p) => p.includes('["payment_type","=","Receive"]')), `no Receive filter sent: ${paths}`);
});

Deno.test('a kind with no recovery anchor never probes ERP', async () => {
  const { probe, paths } = probeFor('purchase-request', null, { name: 'MR-1' });
  assert((await probe('procurement', KEY)) === null && paths.length === 0, `paths: ${paths}`);
});

Deno.test('a fresh command persists its payload; a recovery replays the row it already has', () => {
  assert(moneyWriteReplayOptions(true).replay === false && moneyWriteReplayOptions(false).replay === true, 'replay flag');
});

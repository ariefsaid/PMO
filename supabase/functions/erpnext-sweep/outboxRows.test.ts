// THEME-BACK-40: one outbox-row projection and mapper serve the keyed lookup and the candidate listing.
import { findOutboxRowByKey, outboxRowOf } from './outboxRows.ts';

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

const RECORD = {
  id: 'o1', domain: 'budgets', pmo_record_id: 'v1', idempotency_key: 'k1', state: 'held',
  external_record_id: 'BUD-1', canonical: null, claim_generation: 3, payload_digest: 'abc',
};

function fakeClient(result: { data: unknown; error: { message: string; code?: string } | null }, seen: string[]) {
  const q: Record<string, unknown> = {
    select: (cols: string) => { seen.push(`select:${cols}`); return q; },
    eq: (c: string, v: string) => { seen.push(`${c}=${v}`); return q; },
    maybeSingle: () => Promise.resolve(result),
  };
  return { from: () => q } as never;
}

Deno.test('the keyed lookup filters on org, domain, record and key, and maps every recovery field', async () => {
  const seen: string[] = [];
  const row = await findOutboxRowByKey(fakeClient({ data: RECORD, error: null }, seen), 'org', 'budgets', 'v1', 'k1');
  assert(['org_id=org', 'domain=budgets', 'pmo_record_id=v1', 'idempotency_key=k1'].every((p) => seen.includes(p)), `predicates: ${seen}`);
  assert(row?.claimGeneration === 3 && row.payloadDigest === 'abc' && row.externalRecordId === 'BUD-1' && row.state === 'held', JSON.stringify(row));
});

Deno.test('a missing row is null and a database error throws', async () => {
  assert(await findOutboxRowByKey(fakeClient({ data: null, error: null }, []), 'o', 'd', 'r', 'k') === null, 'missing -> null');
  let threw = false;
  try { await findOutboxRowByKey(fakeClient({ data: null, error: { message: 'down', code: 'X' } }, []), 'o', 'd', 'r', 'k'); } catch { threw = true; }
  assert(threw, 'error must throw');
});

Deno.test('the candidate mapper defaults the fields an RPC row may omit', () => {
  const { claim_generation: _g, payload_digest: _p, ...rpc } = RECORD;
  const row = outboxRowOf(rpc);
  assert(row.claimGeneration === 0 && row.payloadDigest === null, JSON.stringify(row));
});

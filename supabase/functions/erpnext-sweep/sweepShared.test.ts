// THEME-BACK-40 (#1643): the helpers every sweep pass shares, imported from their own module.
import { byQueueFairness, featureDisabled, listCandidatesLive } from './sweepShared.ts';

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

Deno.test('FR-PLN-006 an entitlement read that failed holds every gated key; a clean read holds only the OFF keys', () => {
  assert(featureDisabled({ featuresUnreadable: true }, 'revenue'), 'an unreadable read must hold revenue');
  assert(featureDisabled({ disabledFeatureKeys: ['crm'] }, 'crm'), 'an OFF key is held');
  assert(!featureDisabled({ disabledFeatureKeys: ['crm'] }, 'revenue'), 'an ON key is not held');
  assert(!featureDisabled({}, 'revenue'), 'no entitlement data holds nothing');
});

Deno.test('the queues serve never-attempted rows first, then the longest-waiting, then the oldest, then id', () => {
  const rows = [
    { id: 'c', last_attempt_at: '2026-01-02', created_at: '2026-01-01' },
    { id: 'b', last_attempt_at: '2026-01-01', created_at: '2026-01-03' },
    { id: 'a', last_attempt_at: null, created_at: '2026-01-05' },
    { id: 'd', last_attempt_at: '2026-01-01', created_at: '2026-01-02' },
  ];
  const order = [...rows].sort(byQueueFairness).map((r) => r.id).join('');
  assert(order === 'adbc', `fair order: ${order}`);
});

Deno.test('the candidate listing maps the reconcile RPC rows and throws on a database error', async () => {
  const rpcRow = { id: 'o1', domain: 'revenue', pmo_record_id: 'r1', idempotency_key: 'k1', state: 'committed', external_record_id: 'SI-1', canonical: null };
  let called = '';
  const ok = { rpc: (fn: string, args: { p_org_id: string }) => { called = `${fn}:${args.p_org_id}`; return Promise.resolve({ data: [rpcRow], error: null }); } } as never;
  const [row] = await listCandidatesLive(ok)('org-1');
  assert(called === 'outbox_reconcile_candidates:org-1', called);
  assert(row.pmoRecordId === 'r1' && row.externalRecordId === 'SI-1' && row.claimGeneration === 0, JSON.stringify(row));
  const down = { rpc: () => Promise.resolve({ data: null, error: { message: 'down', code: 'X' } }) } as never;
  let threw = false;
  try { await listCandidatesLive(down)('org-1'); } catch { threw = true; }
  assert(threw, 'a database error must throw');
});

// AC-005: a failed chart/metadata scan keeps the old statement state and leaves a safe 'delayed' status.
(Deno as unknown as { serve: (...a: unknown[]) => unknown }).serve = () => ({ finished: Promise.resolve() });
const originalFetch = globalThis.fetch;
const { feedOrgLedgersLive } = await import('./index.ts');
import type { SupabaseClient } from '@supabase/supabase-js';

Deno.test('AC-005: ERP outage keeps old chart/ledger state and the status delayed', async () => {
  const updates: Record<string, unknown>[] = [];
  const rpcs: string[] = [];
  const builder = (table: string) => {
    const b = {
      update: (v: Record<string, unknown>) => { updates.push({ table, ...v }); return b; },
      eq: () => b, select: () => b,
      then: (resolve: (v: unknown) => unknown) => resolve({ data: [], error: null }),
    };
    return b;
  };
  const sc = { from: builder, rpc: (name: string) => { rpcs.push(name); return Promise.resolve({ data: null, error: null }); } } as unknown as SupabaseClient;
  globalThis.fetch = () => Promise.resolve(new Response('{"exc":"down"}', { status: 503 }));
  try {
    const cache = new Map([['org-x', Promise.resolve({ apiKey: 'k', apiSecret: 's' })]]);
    const org = { orgId: 'org-x', siteUrl: 'https://erp.example.test', secretRef: 'r', company: 'Synthetic Co', config: {}, ownedDomains: [], versionMajor: 16, statementReplayNeeded: true };
    const r = await feedOrgLedgersLive(sc, org, cache);
    if (!r.error) throw new Error('outage must surface as an error');
    if (!updates.some((u) => u.statement_update_delayed === true)) throw new Error('status must be marked delayed first');
    if (updates.some((u) => u.statement_update_delayed === false)) throw new Error('failed scan must not clear delayed');
    if (updates.some((u) => 'statement_calendar' in u)) throw new Error('calendar must not change on failure');
    if (rpcs.length > 0) throw new Error(`no chart/ledger/replay RPC may run after a failed scan: ${rpcs}`);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

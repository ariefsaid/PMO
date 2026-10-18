// AC-005: a failed chart/metadata scan preserves prior native status; native batch RPCs own delay state.
(Deno as unknown as { serve: (...a: unknown[]) => unknown }).serve = () => ({ finished: Promise.resolve() });
const originalFetch = globalThis.fetch;
const { feedOrgLedgersLive } = await import('./index.ts');
import type { SupabaseClient } from '@supabase/supabase-js';

Deno.test('AC-005: ERP outage keeps old chart/ledger state without mutating native status', async () => {
  const updates: Record<string, unknown>[] = [];
  const rpcs: string[] = [];
  const originalNativeStatus = {
    statement_update_delayed: true,
    statement_calendar: [{ name: 'Retained FY', start: '2025-01-01', end: '2025-12-31' }],
  };
  const nativeStatus: Record<string, unknown> = structuredClone(originalNativeStatus);
  const builder = (table: string) => {
    const b = {
      update: (v: Record<string, unknown>) => {
        updates.push({ table, ...v });
        if (table === 'external_org_bindings') {
          if ('statement_update_delayed' in v) nativeStatus.statement_update_delayed = v.statement_update_delayed;
          if ('statement_calendar' in v) nativeStatus.statement_calendar = v.statement_calendar;
        }
        return b;
      },
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
    if (JSON.stringify(nativeStatus) !== JSON.stringify(originalNativeStatus)) throw new Error('failed ordinary source scan changed seeded native status/calendar');
    if (updates.some((u) => 'statement_update_delayed' in u || 'statement_calendar' in u)) throw new Error('ordinary source failure wrote native status/calendar fields');
    if (rpcs.length > 0) throw new Error(`no chart/ledger/replay RPC may run after a failed scan: ${rpcs}`);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

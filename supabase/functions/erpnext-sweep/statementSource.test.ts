// AC-005 sweep source state is loaded from the shipped handler and remains company-scoped.
(Deno as unknown as { serve: (...args: unknown[]) => unknown }).serve = () => ({ finished: Promise.resolve() });
const originalFetch = globalThis.fetch;
globalThis.fetch = () => Promise.resolve(new Response(JSON.stringify({ data: [] }), { status: 200 }));
const { listEmployingOrgsLive } = await import('./index.ts');
import type { SupabaseClient } from '@supabase/supabase-js';

Deno.test('AC-005: the sweep loads persisted replay state for the bound company', async () => {
  try {
  const results: Record<string, { data: unknown; error: null }> = {
    external_org_bindings: { data: [{ org_id: 'org-synthetic', site_url: 'https://example.test', secret_ref: 'synthetic-ref', config: { company: 'Synthetic Co' }, activated_at: '2026-01-01T00:00:00Z', version_major: 16, statement_full_ledger_replay_needed: true }], error: null },
    external_domain_ownership: { data: [{ org_id: 'org-synthetic', domain: 'finance' }], error: null },
    external_sync_watermarks: { data: [], error: null },
  };
  const client = { from(table: string) {
    const result = results[table] ?? { data: [], error: null };
    const builder = { select: () => builder, eq: () => builder, in: () => Promise.resolve(result), then: (resolve: (value: unknown) => unknown) => resolve(result) };
    return builder;
  } } as unknown as SupabaseClient;
  const orgs = await listEmployingOrgsLive(client);
  if (orgs.length !== 1 || orgs[0].company !== 'Synthetic Co' || orgs[0].statementReplayNeeded !== true) {
    throw new Error(`replay state/company not mapped from binding: ${JSON.stringify(orgs)}`);
  }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

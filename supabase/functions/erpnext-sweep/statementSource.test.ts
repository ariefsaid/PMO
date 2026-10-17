// AC-005 sweep source state is loaded from the shipped handler and remains company-scoped.
(Deno as unknown as { serve: (...args: unknown[]) => unknown }).serve = () => ({ finished: Promise.resolve() });
const originalFetch = globalThis.fetch;
globalThis.fetch = () => Promise.resolve(new Response(JSON.stringify({ data: [] }), { status: 200 }));
const { listEmployingOrgsLive, feedOrgLedgersLive } = await import('./index.ts');
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

Deno.test('AC-005: shipped live sweep checks chart before full ledger replay and completes status', async () => {
  const events: string[] = [];
  const statusUpdates: Record<string, unknown>[] = [];
  const rpcCalls: { name: string; args: Record<string, unknown> }[] = [];
  const results: Record<string, { data: unknown; error: null }> = {
    external_org_bindings: { data: [{ org_id: 'org-synthetic', site_url: 'https://example.test', secret_ref: 'synthetic-ref', config: { company: 'Synthetic Co' }, activated_at: '2026-01-01T00:00:00Z', version_major: 16, statement_full_ledger_replay_needed: true }], error: null },
    external_domain_ownership: { data: [{ org_id: 'org-synthetic', domain: 'finance' }], error: null },
    external_sync_watermarks: { data: [], error: null },
  };
  const client = {
    from(table: string) {
      let mode = 'select';
      const builder: Record<string, unknown> = {
        select: () => builder,
        update: (values: Record<string, unknown>) => { mode = 'update'; if (table === 'external_org_bindings') statusUpdates.push(values); return builder; },
        eq: () => builder, in: () => builder, order: () => builder, gt: () => builder, limit: () => builder,
        maybeSingle: async () => ({ data: { secret_ref: 'synthetic-ref' }, error: null }),
        upsert: async () => ({ error: null }),
        then: (resolve: (value: unknown) => unknown) => resolve(mode === 'update' ? { count: 1, error: null } : (results[table] ?? { data: [], error: null })),
      };
      return builder;
    },
    async rpc(name: string, args: Record<string, unknown>) {
      rpcCalls.push({ name, args });
      if (name === 'mark_erp_statement_replay_for_missing_accounts') return { data: false, error: null };
      if (name === 'replace_erp_account_chart') return { data: { upserted: 0 }, error: null };
      if (name === 'finish_erp_gl_replay') return { data: { deleted: 0 }, error: null };
      return { data: null, error: null };
    },
  } as unknown as SupabaseClient;
  const response = (data: unknown) => new Response(JSON.stringify({ data }), { status: 200 });
  const previousFetch = globalThis.fetch;
  globalThis.fetch = ((input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('/Account?')) { events.push('chart'); return Promise.resolve(response([])); }
    if (url.includes('/Company/')) return Promise.resolve(response({ default_currency: 'IDR', default_finance_book: null }));
    if (url.includes('/Fiscal%20Year?')) return Promise.resolve(response([{ name: 'FY26', year_start_date: '2026-01-01', year_end_date: '2026-12-31' }]));
    if (url.includes('/Accounts%20Settings/')) return Promise.resolve(response({ ignore_is_opening_check: false, ignore_account_closing_balance: false }));
    if (url.includes('/System%20Settings/')) return Promise.resolve(response({ currency_precision: 2, float_precision: 3, rounding_method: "Banker's Rounding" }));
    if (url.includes('/Currency/')) return Promise.resolve(response({ smallest_currency_fraction_value: 100 }));
    if (url.includes('/GL%20Entry?')) { events.push('ledger'); return Promise.resolve(response([])); }
    if (url.includes('/Payment%20Ledger%20Entry?')) return Promise.resolve(response([]));
    throw new Error(`Unexpected ERP request ${url}`);
  }) as typeof fetch;
  try {
    const orgs = await listEmployingOrgsLive(client);
    if (orgs.length !== 1 || orgs[0].company !== 'Synthetic Co' || orgs[0].statementReplayNeeded !== true) throw new Error('loaded binding/replay state was not preserved');
    const cache = new Map([['org-synthetic', Promise.resolve({ apiKey: 'synthetic-key', apiSecret: 'synthetic-secret' })]]);
    const result = await feedOrgLedgersLive(client, orgs[0], cache);
    if (result.error) throw new Error(result.error);
    if (events.join(',') !== 'chart,ledger') throw new Error(`chart must precede ledger; observed ${events.join(',')}`);
    if (result.gl !== 0 || result.glCaughtUp !== true) throw new Error(`full replay did not finish: ${JSON.stringify(result)}`);
    const finish = rpcCalls.find((call) => call.name === 'finish_erp_gl_replay');
    if (!finish || finish.args.p_company !== 'Synthetic Co' || finish.args.p_watermark !== null) throw new Error(`loaded company/full replay was not passed to completion: ${JSON.stringify(rpcCalls)}`);
    if (!statusUpdates.some((u) => u.statement_update_delayed === false)) throw new Error('successful source sweep did not complete delayed status');
  } finally {
    globalThis.fetch = previousFetch;
  }
});

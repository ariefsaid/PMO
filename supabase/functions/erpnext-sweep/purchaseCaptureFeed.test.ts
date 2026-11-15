// Tests the shipped sweep entry point with network boundaries mocked.
import { createClient } from '@supabase/supabase-js';
import { describe, it } from '@std/testing/bdd';
import { assertEquals } from '@std/assert';
import { withFetchMock, supabaseSelect, supabaseRpc, jsonResponse, erp, type MockRoute } from '../_shared/testing/edgeTestKit.ts';

(Deno as unknown as { serve: (...args: unknown[]) => unknown }).serve = () => ({ finished: Promise.resolve() });
const { feedOrgPurchasesLive, feedOrgLedgersLive } = await import('./index.ts');
const org = { orgId: 'org-1', bindingId: 'binding-1', siteUrl: 'https://erp.example.test', secretRef: 'ref', company: 'Example', config: {}, ownedDomains: [], versionMajor: null };
const pair = new Map([['org-1', Promise.resolve({ apiKey: 'test', apiSecret: 'test' })]]);
const client = () => createClient('https://supabase.example.test', 'test', { auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false } });

function routes(partial: boolean, writes: unknown[]): MockRoute[] {
  const watermarks = new Map<string, string>();
  const fullPage = Array.from({ length: 500 }, (_, i) => ({ name: `PO-${String(i).padStart(5,'0')}`, supplier: 'S', supplier_name: 'S',
    transaction_date: '2026-01-01', currency: 'USD', grand_total: 1, status: 'To Bill', docstatus: 1, modified: '2026-01-01 00:00:00' }));
  return [
    supabaseSelect('external_sync_watermarks', (call) => {
      const domain = call.url.searchParams.get('domain')?.replace(/^eq\./,'') ?? '';
      return jsonResponse(watermarks.has(domain) ? { watermark_cursor: watermarks.get(domain) } : null);
    }),
    { label: 'watermark-upsert', method: 'POST', pathname: '/rest/v1/external_sync_watermarks', response: (call) => {
      const row = call.bodyJson as { domain: string; watermark_cursor: string };
      watermarks.set(row.domain, row.watermark_cursor); return jsonResponse(null, { status: 201 });
    } },
    { label: 'watermark-update', method: 'PATCH', pathname: '/rest/v1/external_sync_watermarks', response: (call) => {
      const domain = call.url.searchParams.get('domain')?.replace(/^eq\./,'') ?? '';
      const row = call.bodyJson as { watermark_cursor: string }; watermarks.set(domain, row.watermark_cursor);
      return jsonResponse(null, { headers: { 'content-range': '0-0/1' } });
    } },
    supabaseRpc('upsert_erp_purchase_documents', () => jsonResponse(0)),
    supabaseRpc('record_capture_feed_start', (call) => { writes.push({ event: 'start', ...call.bodyJson as object }); return jsonResponse(null); }),
    supabaseRpc('record_capture_feed_completion', (call) => { writes.push({ event: 'complete', ...call.bodyJson as object }); return jsonResponse(null); }),
    erp('erp.example.test', /^\/api\/resource\//, (call) => {
      const path = decodeURIComponent(call.url.pathname);
      return jsonResponse({ data: partial && path.endsWith('/Purchase Order') ? fullPage : [] });
    }),
  ];
}

async function run(partial: boolean) {
  const writes: unknown[] = [];
  const originalResolver = Deno.resolveDns;
  try {
    const result = await withFetchMock(routes(partial, writes), async () => {
      Deno.resolveDns = (async () => ['8.8.8.8']) as unknown as typeof Deno.resolveDns;
      return await feedOrgPurchasesLive(client(), org, pair);
    });
    return { result, writes };
  } finally { Deno.resolveDns = originalResolver; }
}

describe('AC-ROP-018 purchase feed completion witness', () => {
  it('records the pass start when all source pages are caught up', async () => {
    const { result, writes } = await run(false);
    assertEquals(result.error, undefined);
    assertEquals(writes.map((write) => (write as { event: string }).event), ['start', 'complete']);
    assertEquals((writes[0] as { p_kind: string }).p_kind, 'purchases');
  });
  it('does not mark a bounded partial pass complete', async () => {
    const { result, writes } = await run(true);
    assertEquals(result.error, undefined);
    assertEquals(writes.map((write) => (write as { event: string }).event), ['start']);
  });
});

// AC-ROP-071 the ledger feed run records the ERPNext company currency with its completion witness.
type LedgerCall = { name: string; args: Record<string, unknown> };
async function runLedgerFeed(companyResponse: () => Response, replayNeeded = true): Promise<{ calls: LedgerCall[]; result: { error?: string; statementReady?: boolean } }> {
  const calls: LedgerCall[] = [];
  const serviceClient = {
    from() {
      const builder: Record<string, unknown> = {
        select: () => builder, update: () => builder, eq: () => builder, in: () => builder, order: () => builder, gt: () => builder, limit: () => builder,
        maybeSingle: async () => ({ data: { secret_ref: 'ref' }, error: null }), upsert: async () => ({ error: null }),
        then: (resolve: (value: unknown) => unknown) => resolve({ data: [], count: 1, error: null }),
      };
      return builder;
    },
    async rpc(name: string, args: Record<string, unknown>) {
      calls.push({ name, args });
      if (name === 'mark_erp_statement_replay_for_missing_accounts') return { data: false, error: null };
      if (name === 'replace_erp_account_chart') return { data: { upserted: 0 }, error: null };
      if (name === 'finish_erp_gl_replay') return { data: { deleted: 0 }, error: null };
      return { data: null, error: null };
    },
  };
  const ok = (data: unknown) => new Response(JSON.stringify({ data }), { status: 200 });
  const previousFetch = globalThis.fetch;
  globalThis.fetch = ((input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('/Company/')) return Promise.resolve(companyResponse());
    if (url.includes('/Account?') || url.includes('/GL%20Entry?') || url.includes('/Payment%20Ledger%20Entry?')) return Promise.resolve(ok([]));
    if (url.includes('/System%20Settings/')) return Promise.resolve(ok({ currency_precision: 2, float_precision: 3, rounding_method: "Banker's Rounding" }));
    throw new Error(`Unexpected ERP request ${url}`);
  }) as typeof fetch;
  const originalResolver = Deno.resolveDns;
  try {
    Deno.resolveDns = (async () => ['8.8.8.8']) as unknown as typeof Deno.resolveDns;
    const result = await feedOrgLedgersLive(serviceClient as never, { ...org, statementReplayNeeded: replayNeeded }, pair);
    return { calls, result };
  } finally { globalThis.fetch = previousFetch; Deno.resolveDns = originalResolver; }
}
const completion = (calls: LedgerCall[]) => calls.filter((call) => call.name === 'record_capture_feed_completion');

describe('AC-ROP-071 ledger feed completion carries the ledger currency', () => {
  for (const replayNeeded of [true, false]) {
    it(`sends the company currency read from the ERP (replay ${replayNeeded ? 'needed' : 'not needed'})`, async () => {
      const { calls, result } = await runLedgerFeed(() => new Response(JSON.stringify({ data: { name: 'Example', default_currency: 'IDR' } }), { status: 200 }), replayNeeded);
      assertEquals(result.error, undefined);
      assertEquals(completion(calls).length, 1);
      assertEquals(completion(calls)[0].args.p_currency, 'IDR');
      assertEquals(completion(calls)[0].args.p_kind, 'ledger');
    });
  }
  it('sends no currency when the company read fails, and still records the completion', async () => {
    const { calls } = await runLedgerFeed(() => new Response('{}', { status: 500 }));
    assertEquals(completion(calls).length, 1);
    assertEquals(completion(calls)[0].args.p_currency, null);
  });
  it('sends no currency when the company has a blank one, and still records the completion', async () => {
    const { calls } = await runLedgerFeed(() => new Response(JSON.stringify({ data: { name: 'Example', default_currency: '  ' } }), { status: 200 }));
    assertEquals(completion(calls).length, 1);
    assertEquals(completion(calls)[0].args.p_currency, null);
  });
});

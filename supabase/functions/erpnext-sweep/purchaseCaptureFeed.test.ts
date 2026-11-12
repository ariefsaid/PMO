// Tests the shipped sweep entry point with network boundaries mocked.
import { createClient } from '@supabase/supabase-js';
import { describe, it } from '@std/testing/bdd';
import { assertEquals } from '@std/assert';
import { withFetchMock, supabaseSelect, supabaseRpc, jsonResponse, erp, type MockRoute } from '../_shared/testing/edgeTestKit.ts';

(Deno as unknown as { serve: (...args: unknown[]) => unknown }).serve = () => ({ finished: Promise.resolve() });
const { feedOrgPurchasesLive } = await import('./index.ts');
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
    supabaseRpc('record_purchase_capture_feed_completion', (call) => { writes.push(call.bodyJson); return jsonResponse(null); }),
    erp('erp.example.test', /^\/api\/resource\//, (call) => {
      const path = decodeURIComponent(call.url.pathname);
      return jsonResponse({ data: partial && path.endsWith('/Purchase Order') ? fullPage : [] });
    }),
  ];
}

async function run(partial: boolean) {
  const writes: unknown[] = [];
  const result = await withFetchMock(routes(partial, writes), async () => {
    Deno.resolveDns = (async () => ['8.8.8.8']) as unknown as typeof Deno.resolveDns;
    return await feedOrgPurchasesLive(client(), org, pair);
  });
  return { result, writes };
}

describe('AC-ROP-018 purchase feed completion witness', () => {
  it('records the pass start when all source pages are caught up', async () => {
    const { result, writes } = await run(false);
    assertEquals(result.error, undefined);
    assertEquals(writes.length, 1);
  });
  it('does not mark a bounded partial pass complete', async () => {
    const { result, writes } = await run(true);
    assertEquals(result.error, undefined);
    assertEquals(writes.length, 0);
  });
});

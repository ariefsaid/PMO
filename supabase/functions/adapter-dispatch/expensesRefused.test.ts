// AC-EXP-123 [Deno, served handler] — no client can originate an expense posting (ADR-0081): adapter-dispatch has
// no `expenses` route, so a well-formed command from an authenticated user is refused before any outbox or ERP
// call. Guards against someone "helpfully" adding the domain to ADAPTER_REGISTRY / isErpDomain.
// Verify: cd supabase/functions/adapter-dispatch && deno test expensesRefused.test.ts --config deno.json --allow-env --allow-net --allow-read
import { assertEquals } from '@std/assert';
import { createJwtAuthority, createTestJwksResolver, installEdgeEnv, jsonResponse, withFetchMock, type FetchCall } from '../_shared/testing/edgeTestKit.ts';

const env = installEdgeEnv();
Deno.env.set('SUPABASE_ANON_KEY', 'synthetic-anon');
Deno.env.set('EXTERNAL_CONNECT_ENABLED', 'true');
const auth = await createJwtAuthority(env.SUPABASE_URL);
let handler: (req: Request) => Promise<Response>;
(Deno as unknown as { serve: (h: typeof handler) => unknown }).serve = (h) => {
  handler = h;
  return { finished: Promise.resolve() };
};
const { setTestJwks } = await import('./index.ts');
setTestJwks(createTestJwksResolver(auth));
addEventListener('unload', () => env.restore());

const ORG = '00000000-0000-4000-8000-000000000a01';
const USER = '00000000-0000-4000-8000-000000000a02';
const CLAIM = '00000000-0000-4000-8000-000000000a03';

Deno.test('AC-EXP-123 an expenses command is refused with UNSUPPORTED_DOMAIN before any outbox or ERP call', async () => {
  const jwt = await auth.mintJwt({ sub: USER });
  const result = await withFetchMock([{
    label: 'expenses refused',
    response: (call: FetchCall) => {
      if (call.url.pathname === '/rest/v1/profiles') return jsonResponse({ org_id: ORG });
      if (call.url.pathname.startsWith('/rest/v1/')) return jsonResponse(null);
      throw new Error(`unexpected ${call.method} ${call.url.pathname}`);
    },
  }], async ({ calls }) => {
    const res = await handler(new Request('https://edge.example.test/adapter-dispatch', {
      method: 'POST',
      headers: { authorization: `Bearer ${jwt}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        domain: 'expenses', operation: 'create', idempotencyKey: `expj:${CLAIM}:1791367200123`,
        record: { id: CLAIM, erp_doc_kind: 'expense-journal', posting: 'approval' },
      }),
    }));
    return { status: res.status, body: await res.json(), calls };
  });
  assertEquals(result.status, 400, JSON.stringify(result.body));
  assertEquals((result.body as { error?: string }).error, 'UNSUPPORTED_DOMAIN');
  assertEquals(
    result.calls.filter((c) => c.url.pathname.includes('external_command_outbox') || c.url.pathname.startsWith('/api/resource/')).length,
    0,
  );
});

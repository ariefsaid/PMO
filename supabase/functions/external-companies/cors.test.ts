// #637 — the browser client (supabase-js functions.invoke) sends X-Client-Info and apikey on every call;
// a preflight that does not allow them fails in the browser before the function runs. Local Kong answers
// OPTIONS itself, so only the shipped handler's own preflight proves this.
import { assertEquals } from '@std/assert';
import { handleCompaniesRequest } from './index.ts';

Deno.test('AC-CORS-001: OPTIONS allows x-client-info and apikey (the supabase-js request headers)', async () => {
  const res = await handleCompaniesRequest(new Request('http://x/external-companies', { method: 'OPTIONS' }));
  const allowed = (res.headers.get('Access-Control-Allow-Headers') ?? '').toLowerCase();
  for (const h of ['authorization', 'x-client-info', 'apikey', 'content-type']) {
    assertEquals(allowed.includes(h), true, `preflight must allow ${h}; got "${allowed}"`);
  }
});

Deno.test('AC-CORS-002 (#641): a non-preflight answer — here an unauthenticated 401 — carries Access-Control-Allow-Origin, or the browser drops it', async () => {
  const res = await handleCompaniesRequest(new Request('http://x/external-companies', { method: 'POST', body: '{}' }));
  assertEquals(res.status >= 400, true, 'unauthenticated call must be refused');
  assertEquals(res.headers.get('Access-Control-Allow-Origin'), '*', 'error responses must be CORS-readable');
});

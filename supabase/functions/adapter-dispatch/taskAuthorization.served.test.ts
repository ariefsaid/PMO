import { assertEquals } from 'jsr:@std/assert';
import { createJwtAuthority, createTestJwksResolver, installEdgeEnv, withFetchMock, jsonResponse } from '../_shared/testing/edgeTestKit.ts';

const env = installEdgeEnv();
Deno.env.set('SUPABASE_ANON_KEY', 'synthetic-anon');
Deno.env.set('CLICKUP_API_TOKEN', 'synthetic-token');
Deno.env.set('EXTERNAL_CONNECT_ENABLED', 'true');
const auth = await createJwtAuthority(env.SUPABASE_URL);
let handler: (req: Request) => Promise<Response>;
(Deno as unknown as { serve: (h: typeof handler) => unknown }).serve = (h) => { handler = h; return {}; };
const { setTestJwks } = await import('./index.ts');
setTestJwks(createTestJwksResolver(auth));
addEventListener('unload', () => env.restore());

Deno.test('AC-SEC-A1 a denied task command returns before any ClickUp request', async () => {
  const jwt = await auth.mintJwt({ sub: '00000000-0000-4000-8000-000000000074' });
  const response = await withFetchMock([{
    label: 'task authorization request flow',
    response: (call) => {
      const path = call.url.pathname;
      if (path.startsWith('/rest/v1/rpc/actor_authorization_state')) {
        return jsonResponse({ role: 'Engineer', active: true });
      }
      if (path.startsWith('/rest/v1/profiles')) return jsonResponse({ org_id: '00000000-0000-4000-8000-000000000073' });
      if (path.startsWith('/rest/v1/tasks')) {
        return jsonResponse({ id: '00000000-0000-4000-8000-000000000075', org_id: '00000000-0000-4000-8000-000000000073', project_id: '00000000-0000-4000-8000-000000000076', created_by: '00000000-0000-4000-8000-000000000077' });
      }
      throw new Error(`unexpected request ${call.method} ${path}`);
    },
  }], async ({ calls }) => {
    const res = await handler(new Request('https://edge.example.test/adapter-dispatch', {
      method: 'POST',
      headers: { authorization: `Bearer ${jwt}`, 'content-type': 'application/json' },
      body: JSON.stringify({ domain: 'tasks', operation: 'update', record: {
        id: '00000000-0000-4000-8000-000000000075', project_id: '00000000-0000-4000-8000-000000000076', name: 'Updated task',
      } }),
    }));
    assertEquals(res.status, 403);
    assertEquals(calls.filter((call) => call.url.pathname.includes('actor_authorization_state')).length, 1);
    assertEquals(calls.filter((call) => call.url.pathname.includes('/tasks')).length, 1);
    assertEquals(calls.filter((call) => call.url.pathname.includes('external_org_bindings') || call.url.pathname.includes('read_vault_secret')).length, 0);
    assertEquals(calls.filter((call) => call.url.hostname === 'api.clickup.com').length, 0);
  });
});

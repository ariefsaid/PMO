import { assert, assertEquals } from 'jsr:@std/assert';
import { createJwtAuthority, createTestJwksResolver, installEdgeEnv, withFetchMock, jsonResponse } from '../_shared/testing/edgeTestKit.ts';

const env = installEdgeEnv();
Deno.env.set('SUPABASE_ANON_KEY', 'synthetic-anon');
Deno.env.set('CLICKUP_API_TOKEN', 'synthetic-global-token');
Deno.env.set('EXTERNAL_CONNECT_ENABLED', 'true');
const auth = await createJwtAuthority(env.SUPABASE_URL);
let handler: (req: Request) => Promise<Response>;
(Deno as unknown as { serve: (h: typeof handler) => unknown }).serve = (h) => { handler = h; return {}; };
const { setTestJwks } = await import('./index.ts');
setTestJwks(createTestJwksResolver(auth));
addEventListener('unload', () => env.restore());

const ORG = '00000000-0000-4000-8000-000000000083';
const PROJECT = '00000000-0000-4000-8000-000000000086';
const TASK = '00000000-0000-4000-8000-000000000085';

Deno.test('FN2-006 a failed org-binding read fails closed: no ClickUp request carries the global token', async () => {
  const jwt = await auth.mintJwt({ sub: '00000000-0000-4000-8000-000000000084' });
  await withFetchMock([{
    label: 'authorized task update, binding read fails',
    response: (call) => {
      const path = call.url.pathname;
      if (path.startsWith('/rest/v1/rpc/actor_authorization_state')) return jsonResponse({ role: 'Admin', active: true });
      if (path.startsWith('/rest/v1/profiles')) return jsonResponse({ org_id: ORG });
      if (path.startsWith('/rest/v1/tasks')) return jsonResponse({ id: TASK, org_id: ORG, project_id: PROJECT, created_by: null, assignee_id: null });
      if (path.startsWith('/rest/v1/rpc/task_domain_externally_owned')) return jsonResponse(false);
      if (path.startsWith('/rest/v1/external_project_bindings')) return jsonResponse({ id: 'b1' });
      if (path.startsWith('/rest/v1/external_org_bindings')) return jsonResponse({ message: 'db blip', code: '57P03' }, { status: 500 });
      // any other request is a tripwire: it must not be reached on the fail-closed path
      return jsonResponse([]);
    },
  }], async ({ calls }) => {
    const res = await handler(new Request('https://edge.example.test/adapter-dispatch', {
      method: 'POST',
      headers: { authorization: `Bearer ${jwt}`, 'content-type': 'application/json' },
      body: JSON.stringify({ domain: 'tasks', operation: 'update', record: { id: TASK, project_id: PROJECT, name: 'Updated task' } }),
    }));
    await res.text();
    assert(calls.some((c) => c.url.pathname.includes('external_org_bindings')), 'binding read must be reached');
    assertEquals(calls.filter((c) => c.url.hostname === 'api.clickup.com').length, 0);
    assert(res.status >= 400, `expected failure, got ${res.status}`);
  });
});

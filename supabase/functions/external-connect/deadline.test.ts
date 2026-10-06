/** AC-OUT-841 — external-connect ClickUp validation is deadline-bounded and surfaces external-unreachable. */
import { assertEquals, assertRejects } from '@std/assert';
import { handleConnectRequest, setTestJwks, validateClickUpToken } from './index.ts';
import {
  createAuthedRequest,
  createJwtAuthority,
  createTestJwksResolver,
  installEdgeEnv,
  jsonResponse,
  rpcCall,
  supabaseSelect,
  withFetchMock,
} from '../_shared/testing/edgeTestKit.ts';
import { AppError } from '../../../pmo-portal/src/lib/appError.ts';
import { hungFetch, withShortOutboundDeadline } from '../_shared/testing/hungFetch.ts';

Deno.test('AC-OUT-841: external-connect token validation rejects within the deadline as external-unreachable (not "invalid token")', async () => {
  await withShortOutboundDeadline(async () => {
    const err = await assertRejects(() => validateClickUpToken('t', { fetchImpl: hungFetch() }), AppError);
    assertEquals((err as AppError).code, 'external-unreachable');
  });
});

Deno.test('AC-OUT-841: a hung ClickUp during external-connect returns 502 external-unreachable and writes nothing', async () => {
  const env = installEdgeEnv();
  try {
    const auth = await createJwtAuthority(env.SUPABASE_URL);
    setTestJwks(createTestJwksResolver(auth));
    const jwt = await auth.mintJwt({ sub: 'user-1' });
    await withFetchMock(
      [
        supabaseSelect('profiles', () =>
          jsonResponse({ org_id: 'org-1', role: 'Admin' }, {
            headers: { 'content-type': 'application/vnd.pgrst.object+json' },
          })),
        supabaseSelect('platform_operators', () =>
          new Response('null', { status: 200, headers: { 'content-type': 'application/json' } })),
      ],
      async ({ calls }) => {
        // Only ClickUp hangs; every other (mocked Supabase) call still goes through the kit's fetch.
        const mocked = globalThis.fetch;
        const hung = hungFetch();
        globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) =>
          String(input instanceof Request ? input.url : input).includes('api.clickup.com')
            ? hung(input, init)
            : mocked(input, init)) as typeof fetch;
        try {
          await withShortOutboundDeadline(async () => {
            const res = await handleConnectRequest(
              createAuthedRequest('http://edge.test/connect', { tier: 'clickup', credential: { token: 't' } }, jwt),
            );
            assertEquals(res.status, 502);
            assertEquals((await res.json()).error, 'external-unreachable');
          });
        } finally {
          globalThis.fetch = mocked;
        }
        assertEquals(rpcCall(calls, 'create_vault_secret_for_org').length, 0);
      },
    );
  } finally {
    env.restore();
  }
});

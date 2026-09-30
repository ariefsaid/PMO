/**
 * #655 — the budget push's live `Fiscal Year` read refuses to follow a redirect.
 *
 * That read bypasses the shared ERPNext client, so it carries its own redirect policy. The site URL is
 * admin-nominated: a followed redirect would carry the credentials to another host and read ITS
 * calendar. The mock models a real runtime — a request that allows redirects gets the followed 200; one
 * sent with `redirect: 'manual'` sees the 302 — so the goal oracle is behavioural: no push proceeds.
 *
 * Drives the SHIPPED served handler (index.ts via the Deno.serve stub), like bfyColonFyRoundtrip.test.ts.
 */
import { describe, it } from '@std/testing/bdd';
import { assert, assertEquals } from '@std/assert';
import {
  createJwtAuthority,
  createTestJwksResolver,
  installEdgeEnv,
  jsonResponse,
  restCall,
  withFetchMock,
  type MockRoute,
} from '../_shared/testing/edgeTestKit.ts';
import {
  ERP_HOST,
  installErpCredentials,
  servedRoutes,
  twoYearPhasedSeed,
  USER_ID,
  VERSION_ID,
} from './bfyServedFixture.ts';

const env = installEdgeEnv();
Deno.env.set('SUPABASE_ANON_KEY', 'test-anon-key');
const restoreCreds = installErpCredentials();
const auth = await createJwtAuthority(env.SUPABASE_URL);

let servedHandler: ((req: Request) => Promise<Response>) | null = null;
(Deno as unknown as { serve: (h: unknown) => unknown }).serve = (h: unknown) => {
  servedHandler = h as (req: Request) => Promise<Response>;
  return { finished: Promise.resolve() };
};
const { setTestJwks } = await import('./index.ts');
setTestJwks(createTestJwksResolver(auth));

addEventListener('unload', () => {
  restoreCreds();
  env.restore();
});

describe('#655 — the budget push Fiscal Year read never follows a redirect', () => {
  it('a redirected Fiscal Year read refuses the push: nothing is queued and nothing is POSTed to ERP', async () => {
    const seed = twoYearPhasedSeed();
    const redirectedCalendar: MockRoute = {
      label: 'Fiscal Year behind a redirect',
      host: ERP_HOST,
      pathname: '/api/resource/Fiscal%20Year',
      response: (call) => call.redirect === 'manual'
        ? new Response(null, { status: 302, headers: { Location: 'https://elsewhere.example/api/resource/Fiscal%20Year' } })
        // What a runtime that FOLLOWS the redirect would hand back: the other host's calendar.
        : jsonResponse({ data: seed.fiscalYears }),
    };
    const { routes } = servedRoutes(seed);
    const { res, calls } = await withFetchMock([redirectedCalendar, ...routes], async ({ calls }) => {
      const jwt = await auth.mintJwt({ sub: USER_ID });
      const res = await servedHandler!(
        new Request('http://edge.test/adapter-dispatch', {
          method: 'POST',
          headers: { authorization: `Bearer ${jwt}`, 'content-type': 'application/json' },
          body: JSON.stringify({ domain: 'budget', operation: 'create', record: { id: VERSION_ID, erp_doc_kind: 'budget' } }),
        }),
      );
      await res.body?.cancel();
      return { res, calls };
    });

    assert(res.status !== 200, `a redirected calendar must refuse the push — got ${res.status}`);
    assertEquals(restCall(calls, 'external_command_outbox', 'POST').length, 0, 'nothing may be queued');
    assertEquals(calls.filter((c) => c.url.host === ERP_HOST && c.method === 'POST').length, 0, 'nothing may be POSTed to ERP');
    const fiscalReads = calls.filter((c) => c.url.pathname === '/api/resource/Fiscal%20Year');
    assert(fiscalReads.length >= 1, 'the calendar read was made');
    for (const c of fiscalReads) assertEquals(c.redirect, 'manual');
  });
});

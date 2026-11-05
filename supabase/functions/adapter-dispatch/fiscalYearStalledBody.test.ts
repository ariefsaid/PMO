/**
 * AC-OUT-841 — the budget push's live `Fiscal Year` read: a body that stalls after headers fails closed as external-unreachable.
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
import { withShortOutboundDeadline } from '../_shared/testing/hungFetch.ts';
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

describe('AC-OUT-841 — a stalled Fiscal Year body fails the budget push closed as external-unreachable', () => {
  it('headers arrive, body never does: classified external-unreachable, nothing queued, nothing POSTed to ERP', async () => {
    const seed = twoYearPhasedSeed();
    const stalledCalendar: MockRoute = {
      label: 'Fiscal Year with a stalled body',
      host: ERP_HOST,
      pathname: '/api/resource/Fiscal%20Year',
      response: () => new Response(new ReadableStream<Uint8Array>({ pull: () => new Promise(() => {}) }), { status: 200 }),
    };
    const { routes } = servedRoutes(seed);
    const { res, text, calls } = await withFetchMock([stalledCalendar, ...routes], async ({ calls }) =>
      await withShortOutboundDeadline(async () => {
        const jwt = await auth.mintJwt({ sub: USER_ID });
        const res = await servedHandler!(
          new Request('http://edge.test/adapter-dispatch', {
            method: 'POST',
            headers: { authorization: `Bearer ${jwt}`, 'content-type': 'application/json' },
            body: JSON.stringify({ domain: 'budget', operation: 'create', record: { id: VERSION_ID, erp_doc_kind: 'budget' } }),
          }),
        );
        return { res, text: await res.text(), calls };
      }));
    assert(res.status !== 200, `a stalled calendar must refuse the push — got ${res.status}`);
    assert(text.includes('could not read the ERPNext fiscal calendar (unreachable)'), `expected the classified calendar-unreachable refusal, got ${res.status} ${text}`);
    assertEquals(restCall(calls, 'external_command_outbox', 'POST').length, 0, 'nothing may be queued');
    assertEquals(calls.filter((c) => c.url.host === ERP_HOST && c.method === 'POST').length, 0, 'nothing may be POSTed to ERP');
  });
});

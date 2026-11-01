/**
 * AC-TSP-010 — the Approved-only gate, proven through the SHIPPED served handler (not the guard in
 * isolation): a hand-crafted push for a Draft, Submitted or Rejected sheet, whose payload lies by
 * asserting `status: 'Approved'` plus a forged approver and author, is refused 422
 * `commit-rejected` / `timesheet-not-approved`. Every unexpected fetch throws in the mock kit, so
 * "refused" also proves the handler never reached the outbox, the mirror, a sheet write or ERPNext:
 * the only requests it may make are the org/actor reads and the server-side approval read.
 */
import { describe, it } from '@std/testing/bdd';
import { assertEquals, assert } from '@std/assert';
import {
  createJwtAuthority,
  createTestJwksResolver,
  installEdgeEnv,
  jsonResponse,
  supabaseRpc,
  supabaseSelect,
  withFetchMock,
} from '../_shared/testing/edgeTestKit.ts';

const env = installEdgeEnv();
Deno.env.set('SUPABASE_ANON_KEY', 'test-anon-key');
const auth = await createJwtAuthority(env.SUPABASE_URL);

let servedHandler: ((req: Request) => Promise<Response>) | null = null;
(Deno as unknown as { serve: (handler: unknown) => unknown }).serve = (handler: unknown) => {
  servedHandler = handler as (req: Request) => Promise<Response>;
  return { finished: Promise.resolve() };
};
const { setTestJwks } = await import('./index.ts');
setTestJwks(createTestJwksResolver(auth));
addEventListener('unload', () => env.restore());

const ORG_ID = '11111111-1111-4111-8111-111111111111';
const CALLER_ID = '22222222-2222-4222-8222-222222222222';
const FORGED_APPROVER = '33333333-3333-4333-8333-333333333333';
const PROJECT_ID = '44444444-4444-4444-8444-444444444444';
const SHEETS = [
  { status: 'Draft', id: '55555555-5555-4555-8555-555555555501' },
  { status: 'Submitted', id: '55555555-5555-4555-8555-555555555502' },
  { status: 'Rejected', id: '55555555-5555-4555-8555-555555555503' },
] as const;

describe('AC-TSP-010 forged timesheet push through the served handler', () => {
  for (const sheet of SHEETS) {
    it(`a forged push for a ${sheet.status} sheet is refused 422 timesheet-not-approved and touches nothing else`, async () => {
      const approvalReads: unknown[] = [];
      const routes = [
        supabaseSelect('profiles', () => jsonResponse({ org_id: ORG_ID })),
        supabaseRpc('domain_owned_by_tier', () => jsonResponse(true)),
        supabaseRpc('actor_authorization_state', () => jsonResponse({ role: 'Admin', active: true })),
        // The database is the only witness of approval: it says this sheet is not Approved.
        supabaseRpc('approved_timesheet_for_push', (call) => {
          approvalReads.push(call.bodyJson);
          return new Response(
            JSON.stringify({ code: 'P0001', message: `timesheet-not-approved (status ${sheet.status})`, details: null, hint: null }),
            { status: 400, headers: { 'content-type': 'application/json' } },
          );
        }),
      ];
      const result = await withFetchMock(routes, async ({ calls }) => {
        const jwt = await auth.mintJwt({ sub: CALLER_ID });
        const response = await servedHandler!(new Request('http://edge.test/adapter-dispatch', {
          method: 'POST',
          headers: { authorization: `Bearer ${jwt}`, 'content-type': 'application/json' },
          body: JSON.stringify({
            domain: 'timesheets',
            operation: 'create',
            idempotencyKey: '66666666-6666-4666-8666-666666666666',
            record: {
              id: sheet.id,
              erp_doc_kind: 'timesheet',
              status: 'Approved',
              approved_by: FORGED_APPROVER,
              approved_at: '2026-03-20T10:00:00.000000+00:00',
              user_id: FORGED_APPROVER,
              entries: [{ project_id: PROJECT_ID, entry_date: '2026-03-16', hours: '8.00', project_org_id: ORG_ID }],
            },
          }),
        }));
        return { response, body: await response.json() as { error?: string; message?: string }, calls };
      });

      assertEquals(result.response.status, 422, JSON.stringify(result.body));
      assertEquals(result.body.error, 'commit-rejected');
      assert(result.body.message?.includes('timesheet-not-approved'), `the gate names what it refused on: ${result.body.message}`);
      // The verdict came from a server-side read of THIS sheet, not from the payload's claim.
      assertEquals(approvalReads, [{ p_timesheet_id: sheet.id }]);
      // No write of any kind: only reads and RPC reads were made (the kit throws on anything unrouted).
      assertEquals(result.calls.filter((call) => call.method !== 'GET' && !call.url.pathname.includes('/rpc/')).length, 0);
      assertEquals(result.calls.filter((call) => /external_command_outbox|timesheet_erp_mirror|\/timesheets/.test(call.url.pathname)).length, 0);
    });
  }
});

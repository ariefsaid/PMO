/** #2286 — serves a capture10x fixture to the real handler through the fetch mock (shared by volume.test.ts and volume.bench.ts). */
import { createAuthedRequest, jwksRoute, jsonResponse, supabaseSelect, supabaseRpc, erp, withFetchMock, type FetchCall, type JwtAuthority } from '../../_shared/testing/edgeTestKit.ts';
import { captureRelevant, otherSummary, page, REVISION, type Fixture } from './capture10x.ts';

/** The RPC answers for one fixture: sources and ledger paged after the cursor; the ledger in whichever scope the handler asks for. */
export function fixtureRoutes(fixture: Fixture, auth: JwtAuthority) {
  const capture = fixture.ledger.filter(row => captureRelevant(row));
  const summary = otherSummary(fixture.ledger);
  return [
    jwksRoute(auth),
    supabaseSelect('profiles', () => jsonResponse({ org_id: 'org-10x', role: 'Admin', status: 'active' }, { headers: { 'content-type': 'application/vnd.pgrst.object+json' } })),
    supabaseRpc('actor_authorization_state', () => jsonResponse({ role: 'Admin', active: true })),
    supabaseSelect('external_org_bindings', () => jsonResponse([fixture.binding])),
    supabaseRpc('read_vault_secret', () => jsonResponse('synthetic-key:synthetic-secret')),
    supabaseRpc('purchase_capture_source_page', (call: FetchCall) => {
      const request = call.bodyJson as { p_cursor: string | null; p_limit: number };
      const { items, next } = page(fixture.sources as Array<{ id: string }>, request.p_cursor, request.p_limit);
      return jsonResponse({ sources: items, revision: REVISION, next_cursor: next });
    }),
    supabaseRpc('purchase_capture_ledger_page', (call: FetchCall) => {
      const request = call.bodyJson as { p_cursor: string | null; p_limit: number; p_scope?: string };
      const scoped = request.p_scope === 'capture';
      const { items, next } = page(scoped ? capture : fixture.ledger, request.p_cursor, request.p_limit);
      return jsonResponse({ lines: items, revision: REVISION, next_cursor: next, ...(scoped && request.p_cursor === null ? { other_summary: summary } : {}) });
    }),
    supabaseRpc('purchase_capture_assignment_report', () => jsonResponse({ assignments: fixture.assignments })),
    supabaseRpc('purchase_capture_feed_health', () => jsonResponse(fixture.health)),
    erp('8.8.8.8', '/api/resource/System%20Settings/System%20Settings', () => jsonResponse({ data: { currency_precision: '2', float_precision: '3', number_format: '#,###.##' } })),
  ];
}

/** One whole-org request through the handler the caller imports (the shipped `handlePurchaseCaptureRequest`). */
export async function runAction(handler: (req: Request) => Promise<Response>, fixture: Fixture, auth: JwtAuthority, action: 'preview' | 'report'): Promise<{ body: Record<string, unknown>; calls: FetchCall[] }> {
  const token = await auth.mintJwt({ sub: 'user-10x' });
  return await withFetchMock(fixtureRoutes(fixture, auth), async ({ calls }) => {
    const response = await handler(createAuthedRequest('http://edge.test/purchase-capture', { action, scope: { projectId: null } }, token));
    return { body: await response.json(), calls };
  });
}

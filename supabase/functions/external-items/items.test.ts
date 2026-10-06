import { describe, it, afterAll } from '@std/testing/bdd';
import { assertEquals } from '@std/assert';
import { handleItemsRequest, setTestJwks } from './index.ts';
import {
  createJwtAuthority,
  installEdgeEnv,
  withFetchMock,
  supabaseSelect,
  supabaseRpc,
  jsonResponse,
  createAuthedRequest,
  createTestJwksResolver,
  erp,
} from '../_shared/testing/edgeTestKit.ts';

const env = installEdgeEnv();
const auth = await createJwtAuthority(env.SUPABASE_URL);
setTestJwks(createTestJwksResolver(auth));
afterAll(() => env.restore());
const objectHeaders = { 'content-type': 'application/vnd.pgrst.object+json' };
const profile = () =>
  supabaseSelect('profiles', (call) => {
    assertEquals(call.url.searchParams.get('id'), 'eq.user-test');
    assertEquals(call.headers.get('authorization')?.startsWith('Bearer ey'), true);
    return jsonResponse({ org_id: 'org-test' }, { headers: objectHeaders });
  });
const binding = (status = 'active') =>
  supabaseSelect('external_org_bindings', (call) => {
    assertEquals(call.url.searchParams.get('org_id'), 'eq.org-test');
    assertEquals(call.url.searchParams.get('external_tier'), 'eq.erpnext');
    return jsonResponse(
      {
        secret_ref: 'test-ref',
        site_url: 'https://erp.example.com',
        status,
        activated_at: '2026-10-05',
      },
      { headers: objectHeaders },
    );
  });
async function request(body: unknown = { purpose: 'sales' }) {
  return createAuthedRequest(
    'http://edge.test/items',
    body,
    await auth.mintJwt({ sub: 'user-test' }),
  );
}

describe('external-items shipped handler', () => {
  it('AC-ITM-001 reads enabled ERP sales items using only the verified caller org', async () => {
    await withFetchMock(
      [
        profile(),
        binding(),
        supabaseRpc('read_vault_secret', () => jsonResponse('test:test')),
        erp('erp.example.com', '/api/resource/Item', (call) => {
          assertEquals(call.method, 'GET');
          assertEquals(JSON.parse(call.url.searchParams.get('filters')!), [
            ['disabled', '=', 0],
            ['is_sales_item', '=', 1],
          ]);
          return jsonResponse({
            data: [
              {
                name: 'ITEM-TEST',
                item_name: 'Test service',
                disabled: 0,
                is_sales_item: 1,
                is_purchase_item: 0,
              },
            ],
          });
        }),
      ],
      async () => {
        const response = await handleItemsRequest(
          await request({ purpose: 'sales', orgId: 'org-other' }),
        );
        assertEquals(response.status, 200);
        assertEquals(await response.json(), {
          items: [{ code: 'ITEM-TEST', name: 'Test service' }],
        });
      },
    );
  });

  it('refuses a missing JWT before any read', async () => {
    await withFetchMock([], async ({ calls }) => {
      assertEquals(
        (await handleItemsRequest(new Request('http://edge.test/items', { method: 'POST' })))
          .status,
        401,
      );
      assertEquals(calls.length, 0);
    });
  });

  it('refuses a forged JWT before any profile or ERP read', async () => {
    await withFetchMock([], async ({ calls }) => {
      assertEquals(
        (
          await handleItemsRequest(
            createAuthedRequest('http://edge.test/items', { purpose: 'sales' }, 'forged-token'),
          )
        ).status,
        401,
      );
      assertEquals(calls.length, 0);
    });
  });

  it('returns only enabled purchase items and handles preflight CORS', async () => {
    await withFetchMock(
      [
        profile(),
        binding(),
        supabaseRpc('read_vault_secret', () => jsonResponse('test:test')),
        erp('erp.example.com', '/api/resource/Item', (call) => {
          assertEquals(JSON.parse(call.url.searchParams.get('filters')!), [
            ['disabled', '=', 0],
            ['is_purchase_item', '=', 1],
          ]);
          return jsonResponse({
            data: [
              {
                name: 'ITEM-TEST',
                item_name: 'Test goods',
                disabled: 0,
                is_sales_item: 0,
                is_purchase_item: 1,
              },
              { name: 'ITEM-DISABLED', disabled: 1, is_sales_item: 1, is_purchase_item: 1 },
            ],
          });
        }),
      ],
      async () => {
        const response = await handleItemsRequest(await request({ purpose: 'purchase' }));
        assertEquals(response.status, 200);
        assertEquals(await response.json(), { items: [{ code: 'ITEM-TEST', name: 'Test goods' }] });
        assertEquals(response.headers.get('Access-Control-Allow-Origin'), '*');
        assertEquals(
          (await handleItemsRequest(new Request('http://edge.test/items', { method: 'OPTIONS' })))
            .status,
          200,
        );
      },
    );
  });

  it('refuses a profile hidden by active-member RLS before binding/ERP reads', async () => {
    await withFetchMock(
      [supabaseSelect('profiles', () => jsonResponse(null))],
      async ({ calls }) => {
        assertEquals((await handleItemsRequest(await request())).status, 403);
        assertEquals(calls.filter((c) => c.url.host === 'erp.example.com').length, 0);
      },
    );
  });

  it('refuses inactive binding and invalid purpose without ERP reads', async () => {
    await withFetchMock([profile(), binding('disconnected')], async ({ calls }) => {
      assertEquals((await handleItemsRequest(await request())).status, 422);
      assertEquals(calls.filter((c) => c.url.host === 'erp.example.com').length, 0);
    });
    await withFetchMock([profile()], async () => {
      assertEquals((await handleItemsRequest(await request({ purpose: 'other' }))).status, 400);
    });
  });
});

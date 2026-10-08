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
const originalResolveDns = Deno.resolveDns;
Deno.resolveDns = ((hostname: string, recordType: string) => {
  if (recordType === 'A') return Promise.resolve(['8.8.8.8']);
  if (recordType === 'AAAA') return Promise.resolve(['2001:4860:4860::8888']);
  return Promise.reject(new Error('unexpected DNS query'));
}) as typeof Deno.resolveDns;
const auth = await createJwtAuthority(env.SUPABASE_URL);
setTestJwks(createTestJwksResolver(auth));
afterAll(() => { env.restore(); Deno.resolveDns = originalResolveDns; });
const objectHeaders = { 'content-type': 'application/vnd.pgrst.object+json' };
const profile = () =>
  supabaseSelect('profiles', (call) => {
    assertEquals(call.url.searchParams.get('id'), 'eq.user-test');
    assertEquals(call.headers.get('authorization')?.startsWith('Bearer ey'), true);
    return jsonResponse({ org_id: 'org-test' }, { headers: objectHeaders });
  });
const binding = (status = 'active', config: Record<string, unknown> = { company: 'Test Co' }) =>
  supabaseSelect('external_org_bindings', (call) => {
    assertEquals(call.url.searchParams.get('org_id'), 'eq.org-test');
    assertEquals(call.url.searchParams.get('external_tier'), 'eq.erpnext');
    return jsonResponse(
      {
        secret_ref: 'test-ref',
        site_url: 'https://erp.example.com',
        status,
        activated_at: '2026-10-05',
        config,
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
  it('AC-520-7 lists the binding company\'s enabled purchase tax templates for the vendor-invoice picker', async () => {
    await withFetchMock(
      [
        profile(),
        binding(),
        supabaseRpc('read_vault_secret', () => jsonResponse('test:test')),
        erp('erp.example.com', '/api/resource/Purchase%20Taxes%20and%20Charges%20Template', (call) => {
          assertEquals(call.method, 'GET');
          assertEquals(JSON.parse(call.url.searchParams.get('filters')!), [
            ['company', '=', 'Test Co'],
            ['disabled', '=', 0],
          ]);
          return jsonResponse({ data: [{ name: 'Input VAT 11' }, { name: 'Input VAT 0' }] });
        }),
      ],
      async () => {
        const response = await handleItemsRequest(
          await request({ purpose: 'purchase-tax-templates', company: 'Other Co' }),
        );
        assertEquals(response.status, 200);
        assertEquals(await response.json(), {
          templates: [{ name: 'Input VAT 11' }, { name: 'Input VAT 0' }],
        });
      },
    );
  });

  it('AC-520-7 refuses the template list without an ERP company and makes no ERP read', async () => {
    await withFetchMock([profile(), binding('active', {})], async ({ calls }) => {
      const response = await handleItemsRequest(await request({ purpose: 'purchase-tax-templates' }));
      assertEquals(response.status, 422);
      assertEquals(calls.filter((c) => c.url.host === 'erp.example.com').length, 0);
    });
  });
});

// ── #751: the binding's host is judged by the ADDRESS it resolves to, not just its text ──

/** Swap the module DNS mock for one guard scenario; restore the module mock afterwards. */
async function withDns(
  records: { A?: string[]; AAAA?: string[] } | 'failure',
  run: () => Promise<void>,
): Promise<void> {
  const moduleMock = Deno.resolveDns;
  Deno.resolveDns = ((hostname: string, recordType: string) => {
    if (records === 'failure') return Promise.reject(new Error('dns unavailable'));
    const answer = records[recordType as 'A' | 'AAAA'];
    if (!answer) return Promise.reject(new Deno.errors.NotFound('no record'));
    return Promise.resolve(answer);
  }) as typeof Deno.resolveDns;
  try {
    await run();
  } finally {
    Deno.resolveDns = moduleMock;
  }
}

describe('external-items — host guard (#751)', () => {
  const HOST = 'rebind.erp.test';
  const routes = () => [
    profile(),
    supabaseSelect('external_org_bindings', (call) => {
      assertEquals(call.url.searchParams.get('org_id'), 'eq.org-test');
      assertEquals(call.url.searchParams.get('external_tier'), 'eq.erpnext');
      return jsonResponse(
        { secret_ref: 'test-ref', site_url: `https://${HOST}`, status: 'active', activated_at: '2026-10-05', config: {} },
        { headers: objectHeaders },
      );
    }),
  ];

  const resolvingPrivate: Array<[string, { A?: string[]; AAAA?: string[] }]> = [
    ['the loopback (127.0.0.1)', { A: ['127.0.0.1'] }],
    ['a private 10/8 address (10.x)', { A: ['10.1.2.3'] }],
    ['a link-local address (169.254.x)', { A: ['169.254.169.254'] }],
    ['an IPv4-mapped loopback (::ffff:127.0.0.1)', { A: ['203.0.113.9'], AAAA: ['::ffff:127.0.0.1'] }],
  ];
  for (const [where, records] of resolvingPrivate) {
    it(`#751 refuses a binding whose site name resolves to ${where} — no Vault read, no ERP call`, async () => {
      await withDns(records, () =>
        withFetchMock(routes(), async ({ calls }) => {
          const response = await handleItemsRequest(await request({ purpose: 'sales' }));
          assertEquals(response.status, 422);
          assertEquals(await response.json(), {
            error: 'config-rejected',
            message: 'ERPNext site URL is not permitted',
          });
          assertEquals(calls.filter((c) => c.url.pathname === '/rest/v1/rpc/read_vault_secret').length, 0);
          assertEquals(calls.filter((c) => c.url.host === HOST).length, 0);
        }));
    });
  }

  it('#751 fails closed when the resolver errors — no Vault read, no ERP call', async () => {
    await withDns('failure', () =>
      withFetchMock(routes(), async ({ calls }) => {
        const response = await handleItemsRequest(await request({ purpose: 'sales' }));
        assertEquals(response.status, 422);
        assertEquals(await response.json(), {
          error: 'config-rejected',
          message: 'ERPNext site URL is not permitted',
        });
        assertEquals(calls.filter((c) => c.url.pathname === '/rest/v1/rpc/read_vault_secret').length, 0);
        assertEquals(calls.filter((c) => c.url.host === HOST).length, 0);
      }));
  });
});

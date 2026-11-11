import { describe, it, afterAll } from '@std/testing/bdd';
import { assertEquals, assert } from '@std/assert';
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
  type MockRoute,
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
const PROJECT_ID = '11111111-1111-4111-8111-111111111111';
const profile = () => supabaseSelect('profiles', (call) => {
  assertEquals(call.headers.get('authorization')?.startsWith('Bearer ey'), true);
  return jsonResponse({ org_id: 'org-test' }, { headers: objectHeaders });
});
const project = (row: Record<string, unknown> | null, error = false) => supabaseSelect('projects', (call) => {
  assertEquals(call.headers.get('authorization')?.startsWith('Bearer ey'), true);
  assertEquals(call.url.searchParams.get('id'), `eq.${PROJECT_ID}`);
  return error
    ? jsonResponse({ message: 'database detail must remain private' }, { status: 500 })
    : jsonResponse(row, { headers: objectHeaders });
});
const actor = (active = true) => supabaseRpc('actor_authorization_state', () =>
  jsonResponse({ role: 'Finance', active }));
const binding = (versionMajor = 16, config: Record<string, unknown> = { company: 'Test Co' }) =>
  supabaseSelect('external_org_bindings', (call) => {
    assertEquals(call.url.searchParams.get('org_id'), 'eq.org-test');
    assertEquals(call.url.searchParams.get('external_tier'), 'eq.erpnext');
    return jsonResponse({
      secret_ref: 'test-ref', site_url: 'https://erp.example.com', status: 'active',
      activated_at: '2026-10-05', version_major: versionMajor, config,
    }, { headers: objectHeaders });
  });
const detail = (name: string, start: string, end: string, companies: unknown[] = []) =>
  erp('erp.example.com', `/api/resource/Fiscal%20Year/${encodeURIComponent(name)}`, (call) => {
    assertEquals(call.method, 'GET');
    return jsonResponse({ data: {
      name, disabled: 0, year_start_date: start, year_end_date: end, companies,
    } });
  });
const projectRow = (overrides: Record<string, unknown> = {}) => ({
  id: PROJECT_ID, org_id: 'org-test', start_date: '2025-06-15', end_date: '2027-02-15', archived_at: null,
  ...overrides,
});
async function request(body: unknown, role = 'Finance') {
  return createAuthedRequest(
    'http://edge.test/items', body,
    await auth.mintJwt({ sub: 'user-test', role }),
  );
}
const calendarList = () => erp('erp.example.com', /^\/api\/resource\/Fiscal%20Year$/, (call) => {
  assertEquals(call.method, 'GET');
  assertEquals(call.url.searchParams.get('limit_page_length'), '100');
  return jsonResponse({ data: [{ name: 'FY opaque A' }, { name: 'FY opaque B' }] });
});
const twoYearCalendar = () => [
  calendarList(),
  detail('FY opaque A', '2025-04-01', '2026-03-31'),
  detail('FY opaque B', '2026-04-01', '2027-03-31'),
];
const bindingAndSecret = (versionMajor = 16, config: Record<string, unknown> = { company: 'Test Co' }) => [
  binding(versionMajor, config),
  supabaseRpc('read_vault_secret', () => jsonResponse('test:test')),
];

describe('external-items project fiscal calendar served read', () => {
  it('refuses a deactivated member before any ERP or binding read', async () => {
    await withFetchMock([profile(), project(projectRow()), actor(false)], async ({ calls }) => {
      const response = await handleItemsRequest(await request({ purpose: 'budget-project-calendar', projectId: PROJECT_ID }));
      assertEquals(response.status, 403);
      assertEquals(calls.some((call) => call.url.pathname === '/rest/v1/external_org_bindings'), false);
    });
  });


  it('AC-013/015 resolves unobserved current years from caller-visible project dates for every active role', async () => {
    for (const role of ['Admin', 'Executive', 'Project Manager', 'Finance', 'Engineer']) {
      await withFetchMock([
        profile(), project(projectRow()), actor(), ...bindingAndSecret(), ...twoYearCalendar(),
      ], async ({ calls }) => {
        const response = await handleItemsRequest(await request({ purpose: 'budget-project-calendar', projectId: PROJECT_ID }, role));
        assertEquals(response.status, 200);
        assertEquals(await response.json(), {
          status: 'resolved',
          project: { start: '2025-06-15', end: '2027-02-15' },
          years: [
            { name: 'FY opaque A', start: '2025-04-01', end: '2026-03-31' },
            { name: 'FY opaque B', start: '2026-04-01', end: '2027-03-31' },
          ],
        });
        const projectRead = calls.findIndex((call) => call.url.pathname === '/rest/v1/projects');
        const bindingRead = calls.findIndex((call) => call.url.pathname === '/rest/v1/external_org_bindings');
        const secretRead = calls.findIndex((call) => call.url.pathname === '/rest/v1/rpc/read_vault_secret');
        const erpRead = calls.findIndex((call) => call.url.host === 'erp.example.com');
        assert(projectRead >= 0 && projectRead < bindingRead, 'caller-RLS project read must precede binding access');
        assert(bindingRead < secretRead && secretRead < erpRead, 'project proof must precede credentials and ERP');
      });
    }
  });

  it('allows an archived project whose row remains visible under caller RLS', async () => {
    await withFetchMock([
      profile(), project(projectRow({ archived_at: '2026-01-01T00:00:00Z' })), actor(),
      ...bindingAndSecret(), ...twoYearCalendar(),
    ], async () => {
      const response = await handleItemsRequest(await request({ purpose: 'budget-project-calendar', projectId: PROJECT_ID }));
      assertEquals(response.status, 200);
      assertEquals((await response.json() as { status: string }).status, 'resolved');
    });
  });

  it('rejects caller-supplied org, dates, version, URL, credentials, and extra command fields before project access', async () => {
    for (const field of [
      'orgId', 'startDate', 'endDate', 'versionId', 'siteUrl', 'apiKey', 'apiSecret', 'command',
    ]) {
      await withFetchMock([profile()], async ({ calls }) => {
        const response = await handleItemsRequest(await request({
          purpose: 'budget-project-calendar', projectId: PROJECT_ID, [field]: 'forged',
        }));
        assertEquals(response.status, 400);
        assertEquals(calls.some((call) => call.url.pathname === '/rest/v1/projects'), false);
      });
    }
  });

  it('refuses disabled membership and hidden or missing projects before binding or credentials', async () => {
    await withFetchMock([
      supabaseSelect('profiles', () => jsonResponse(null)),
    ], async ({ calls }) => {
      assertEquals((await handleItemsRequest(await request({ purpose: 'budget-project-calendar', projectId: PROJECT_ID }))).status, 403);
      assertEquals(calls.some((call) => call.url.pathname.includes('projects') || call.url.pathname.includes('external_org_bindings')), false);
    });

    for (const row of [null, projectRow({ org_id: 'foreign-org' })]) {
      await withFetchMock([profile(), project(row)], async ({ calls }) => {
        const response = await handleItemsRequest(await request({ purpose: 'budget-project-calendar', projectId: PROJECT_ID }));
        assert([403, 404].includes(response.status));
        assertEquals(calls.some((call) => call.url.pathname.includes('external_org_bindings') || call.url.pathname.includes('read_vault_secret')), false);
      });
    }
  });

  it('does not treat a caller-RLS project lookup error as authorization', async () => {
    await withFetchMock([profile(), project(null, true)], async ({ calls }) => {
      const response = await handleItemsRequest(await request({ purpose: 'budget-project-calendar', projectId: PROJECT_ID }));
      assertEquals(response.status, 500);
      assertEquals(calls.some((call) => call.url.pathname.includes('external_org_bindings')), false);
    });
  });

  it('returns bad project dates without reading a binding or ERP calendar', async () => {
    for (const projectDates of [
      { start_date: null, end_date: '2027-02-15' },
      { start_date: '2027-02-15', end_date: '2027-02-14' },
      { start_date: '2025-02-29', end_date: null },
    ]) {
      await withFetchMock([profile(), project(projectRow(projectDates)), actor()], async ({ calls }) => {
        const response = await handleItemsRequest(await request({ purpose: 'budget-project-calendar', projectId: PROJECT_ID }));
        assertEquals(response.status, 200);
        assertEquals((await response.json() as { status: string }).status, 'bad-project-dates');
        assertEquals(calls.some((call) => call.url.pathname.includes('external_org_bindings') || call.url.host === 'erp.example.com'), false);
      });
    }
  });

  it('returns a project-current open-ended year instead of every year in the ERP calendar', async () => {
    await withFetchMock([
      profile(), project(projectRow({ start_date: '2025-10-01', end_date: null })), actor(),
      ...bindingAndSecret(), ...twoYearCalendar(),
    ], async () => {
      const response = await handleItemsRequest(await request({ purpose: 'budget-project-calendar', projectId: PROJECT_ID }));
      assertEquals(await response.json(), {
        status: 'resolved',
        project: { start: '2025-10-01', end: null },
        years: [{ name: 'FY opaque A', start: '2025-04-01', end: '2026-03-31' }],
      });
    });
  });

  it('treats unsupported bindings as unavailable and does not call ERP', async () => {
    await withFetchMock([
      profile(), project(projectRow()), actor(), ...bindingAndSecret(14),
    ], async ({ calls }) => {
      const response = await handleItemsRequest(await request({ purpose: 'budget-project-calendar', projectId: PROJECT_ID }));
      assertEquals(response.status, 200);
      assertEquals((await response.json() as { status: string }).status, 'binding-unavailable');
      assertEquals(calls.some((call) => call.url.host === 'erp.example.com'), false);
    });
  });

  it('fails closed on malformed, duplicate, or incomplete fiscal calendar reads', async () => {
    const rows = [
      { name: 'FY opaque A', year_start_date: '2025-04-01', year_end_date: '2026-03-31', companies: [] },
      { name: 'FY opaque B', year_start_date: '2026-05-01', year_end_date: '2027-03-31', companies: [] },
    ];
    await withFetchMock([
      profile(), project(projectRow()), actor(), ...bindingAndSecret(),
      calendarList(),
      detail(rows[0].name, rows[0].year_start_date, rows[0].year_end_date),
      detail(rows[1].name, rows[1].year_start_date, rows[1].year_end_date),
    ], async () => {
      const response = await handleItemsRequest(await request({ purpose: 'budget-project-calendar', projectId: PROJECT_ID }));
      assertEquals(response.status, 200);
      assertEquals((await response.json() as { status: string }).status, 'unresolved');
    });

    await withFetchMock([
      profile(), project(projectRow({ start_date: '2025-06-15', end_date: '2026-02-15' })), actor(), ...bindingAndSecret(),
      erp('erp.example.com', /^\/api\/resource\/Fiscal%20Year$/, () => jsonResponse({ data: [{ name: 'FY duplicate' }, { name: 'FY duplicate' }] })),
    ], async ({ calls }) => {
      const response = await handleItemsRequest(await request({ purpose: 'budget-project-calendar', projectId: PROJECT_ID }));
      assertEquals((await response.json() as { status: string }).status, 'unresolved');
      assertEquals(calls.filter((call) => call.url.pathname.startsWith('/api/resource/Fiscal%20Year/')).length, 0);
    });

    await withFetchMock([
      profile(), project(projectRow()), actor(), ...bindingAndSecret(),
      erp('erp.example.com', /^\/api\/resource\/Fiscal%20Year$/, () => jsonResponse({ data: [{ name: 'FY malformed' }] })),
      erp('erp.example.com', /^\/api\/resource\/Fiscal%20Year\/[^/]+$/, () => jsonResponse({ data: { name: 'FY other' } })),
    ], async () => {
      const response = await handleItemsRequest(await request({ purpose: 'budget-project-calendar', projectId: PROJECT_ID }));
      assertEquals((await response.json() as { status: string }).status, 'unresolved');
    });

    await withFetchMock([
      profile(), project(projectRow()), actor(), ...bindingAndSecret(),
      erp('erp.example.com', /^\/api\/resource\/Fiscal%20Year$/, () => jsonResponse({ data: [{ name: 'FY overlap A' }, { name: 'FY overlap B' }] })),
      detail('FY overlap A', '2025-04-01', '2026-06-30'),
      detail('FY overlap B', '2026-04-01', '2027-03-31'),
    ], async () => {
      const response = await handleItemsRequest(await request({ purpose: 'budget-project-calendar', projectId: PROJECT_ID }));
      assertEquals((await response.json() as { status: string }).status, 'unresolved');
    });
  });

  it('does not accept a full final page as a complete ERP calendar', async () => {
    await withFetchMock([
      profile(), project(projectRow()), actor(), ...bindingAndSecret(),
      erp('erp.example.com', /^\/api\/resource\/Fiscal%20Year$/, (call) => {
        assertEquals(call.url.searchParams.get('limit_page_length'), '100');
        const offset = Number(call.url.searchParams.get('limit_start'));
        const page = Array.from({ length: 100 }, (_, index) => ({ name: `FY-${offset + index}` }));
        return jsonResponse({ data: page });
      }),
    ], async ({ calls }) => {
      const response = await handleItemsRequest(await request({ purpose: 'budget-project-calendar', projectId: PROJECT_ID }));
      assertEquals((await response.json() as { status: string }).status, 'unresolved');
      assertEquals(calls.filter((call) => call.url.host === 'erp.example.com' && call.url.pathname === '/api/resource/Fiscal%20Year').length, 10);
      assertEquals(calls.some((call) => call.url.pathname.startsWith('/api/resource/Fiscal%20Year/')), false);
    });
  });

  it('filters company-linked years and returns unavailable on ERP transport failure', async () => {
    await withFetchMock([
      profile(), project(projectRow({ start_date: '2025-06-15', end_date: '2026-02-15' })), actor(), ...bindingAndSecret(),
      erp('erp.example.com', /^\/api\/resource\/Fiscal%20Year$/, () => jsonResponse({ data: [{ name: 'FY other' }, { name: 'FY current' }] })),
      detail('FY other', '2025-04-01', '2026-03-31', [{ company: 'Another Co' }]),
      detail('FY current', '2025-04-01', '2026-03-31', [{ company: 'Test Co' }]),
    ], async () => {
      const response = await handleItemsRequest(await request({ purpose: 'budget-project-calendar', projectId: PROJECT_ID }));
      assertEquals(await response.json(), {
        status: 'resolved', project: { start: '2025-06-15', end: '2026-02-15' },
        years: [{ name: 'FY current', start: '2025-04-01', end: '2026-03-31' }],
      });
    });

    await withFetchMock([
      profile(), project(projectRow()), actor(), ...bindingAndSecret(),
      erp('erp.example.com', /^\/api\/resource\/Fiscal%20Year$/, () => { throw new Error('private network detail'); }),
    ], async () => {
      const response = await handleItemsRequest(await request({ purpose: 'budget-project-calendar', projectId: PROJECT_ID }));
      assertEquals(response.status, 200);
      assertEquals((await response.json() as { status: string }).status, 'unavailable');
    });

    const deadlineRoute: MockRoute = {
      label: 'calendar-deadline',
      host: 'erp.example.com',
      pathname: /^\/api\/resource\/Fiscal%20Year$/,
      response: (call) => new Promise<Response>((resolve) => {
        call.signal.addEventListener('abort', () => resolve(jsonResponse({ message: 'timeout' }, { status: 504 })), { once: true });
      }),
    };
    await withFetchMock([
      profile(), project(projectRow()), actor(), ...bindingAndSecret(),
      deadlineRoute,
    ], async ({ calls }) => {
      const response = await handleItemsRequest(await request({ purpose: 'budget-project-calendar', projectId: PROJECT_ID }));
      assertEquals((await response.json() as { status: string }).status, 'unavailable');
      assertEquals(calls.filter((call) => call.url.host === 'erp.example.com').length, 1);
    });
  });

  it('classifies deadline expiry between Fiscal Year requests as unavailable', async () => {
    const originalNow = Date.now;
    const list = erp('erp.example.com', /^\/api\/resource\/Fiscal%20Year$/, () => {
      const afterDeadline = originalNow() + 15_001;
      Date.now = () => afterDeadline;
      return jsonResponse({ data: [{ name: 'FY expired' }] });
    });
    await withFetchMock([
      profile(), project(projectRow()), actor(), ...bindingAndSecret(), list,
    ], async ({ calls }) => {
      try {
        const response = await handleItemsRequest(await request({ purpose: 'budget-project-calendar', projectId: PROJECT_ID }));
        assertEquals(await response.json(), {
          status: 'unavailable', project: { start: '2025-06-15', end: '2027-02-15' },
        });
        assertEquals(calls.filter((call) => call.url.host === 'erp.example.com').length, 1);
      } finally {
        Date.now = originalNow;
      }
    });
  });

  it('classifies an ERP error mentioning Fiscal Year as unavailable, not malformed calendar data', async () => {
    await withFetchMock([
      profile(), project(projectRow()), actor(), ...bindingAndSecret(),
      erp('erp.example.com', /^\/api\/resource\/Fiscal%20Year$/, () =>
        jsonResponse({ message: 'Fiscal Year service temporarily unavailable' }, { status: 503 })),
    ], async () => {
      const response = await handleItemsRequest(await request({ purpose: 'budget-project-calendar', projectId: PROJECT_ID }));
      assertEquals(await response.json(), {
        status: 'unavailable', project: { start: '2025-06-15', end: '2027-02-15' },
      });
    });
  });
});
